"""Reports / analytics aggregations.

Currently exposes a single summary endpoint that combines:
  • Cash Accounting credit/debit totals + per-head + per-day breakdowns
  • Shopping spend (from shopped_records) totals + by-supplier + by-month
over a chosen [from, to] date window.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel

from core.db import db
from core.deps import get_current_user, require_store_access
from core.helpers import today_str, entry_total, money_round

router = APIRouter()


def _parse_date(s: str, default: str) -> str:
    """Validate YYYY-MM-DD format, fall back to default."""
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return s
    except Exception:
        return default


def _month_key(iso_or_date: str) -> str:
    """Return 'YYYY-MM' from a YYYY-MM-DD or ISO datetime string."""
    return iso_or_date[:7]


@router.get("/reports/summary")
async def reports_summary(
    store_id: str = Query(...),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD (inclusive). Defaults to first day of current month."),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD (inclusive). Defaults to today."),
    user: Dict[str, Any] = Depends(get_current_user),
):
    await require_store_access(user, store_id)
    is_employee = user.get("role") == "employee"

    today = today_str()
    today_dt = datetime.now(timezone.utc)
    first_of_month = today_dt.replace(day=1).strftime("%Y-%m-%d")
    dfrom = _parse_date(date_from or first_of_month, first_of_month)
    dto = _parse_date(date_to or today, today)
    if dfrom > dto:
        dfrom, dto = dto, dfrom

    # ---------- Accounting ----------
    # Pull all account_heads for the store (used as labels) — even if no entries yet.
    head_map: Dict[str, Dict[str, Any]] = {}
    async for h in db.account_heads.find({"store_id": store_id}, {"_id": 0}):
        head_map[h["id"]] = h

    credit_total = 0.0
    debit_total = 0.0
    by_head_acc: Dict[str, Dict[str, Any]] = {}
    by_day_acc: Dict[str, Dict[str, float]] = {}

    cursor = db.accounting_entries.find(
        {"store_id": store_id, "date": {"$gte": dfrom, "$lte": dto}},
        {"_id": 0},
    ).sort("date", 1)
    async for rec in cursor:
        day = rec["date"]
        entries = rec.get("entries", {}) or {}
        day_credit = 0.0
        day_debit = 0.0
        for head_id, val in entries.items():
            amt = entry_total(val)
            head = head_map.get(head_id) or {"id": head_id, "name": "(deleted)", "type": "debit"}
            htype = head.get("type", "debit")
            slot = by_head_acc.setdefault(head_id, {
                "head_id": head_id,
                "head_name": head.get("name") or "(deleted)",
                "type": htype,
                "total": 0.0,
            })
            slot["total"] += amt
            if htype == "credit":
                credit_total += amt
                day_credit += amt
            else:
                debit_total += amt
                day_debit += amt
        by_day_acc[day] = {
            "date": day,
            "credit": money_round(day_credit),
            "debit": money_round(day_debit),
            "net": money_round(day_credit - day_debit),
        }

    by_head_list = sorted(
        ({**v, "total": money_round(v["total"])} for v in by_head_acc.values()),
        key=lambda x: (-x["total"], x["head_name"]),
    )
    by_day_list = sorted(by_day_acc.values(), key=lambda d: d["date"])

    accounting_block: Dict[str, Any] = {
        "credit_total": money_round(credit_total),
        "debit_total": money_round(debit_total),
        "net": money_round(credit_total - debit_total),
        "by_head": by_head_list,
        "by_day": by_day_list,
        "days_with_entries": len(by_day_acc),
    }
    if is_employee:
        # Employees do not see cash totals
        accounting_block = {"hidden": True}

    # ---------- Shopping (from shopped_records) ----------
    # shopped_at is a datetime; we filter by ISO range.
    start_dt = datetime.strptime(dfrom, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end_dt = datetime.strptime(dto, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
    shop_cursor = db.shopped_records.find(
        {"store_id": store_id, "shopped_at": {"$gte": start_dt, "$lt": end_dt}},
        {"_id": 0},
    )

    spent = 0.0
    tax = 0.0
    items = 0
    by_supplier: Dict[str, Dict[str, Any]] = {}
    by_month: Dict[str, float] = {}
    batches_seen = set()

    async for r in shop_cursor:
        line_total = float(r.get("line_total") or 0)
        line_tax = float(r.get("tax_amount") or 0)
        line_with_tax = float(r.get("total_with_tax") or (line_total + line_tax))
        qty = int(r.get("quantity") or 0)
        spent += line_with_tax
        tax += line_tax
        items += 1
        batches_seen.add(r.get("batch_id"))

        sid = r.get("supplier_id") or "__none__"
        sup = by_supplier.setdefault(sid, {
            "supplier_id": r.get("supplier_id"),
            "supplier_name": r.get("supplier_name") or "No supplier",
            "spent": 0.0,
            "tax": 0.0,
            "items": 0,
            "quantity": 0,
        })
        sup["spent"] += line_with_tax
        sup["tax"] += line_tax
        sup["items"] += 1
        sup["quantity"] += qty

        shopped_at = r.get("shopped_at")
        if isinstance(shopped_at, datetime):
            mk = shopped_at.strftime("%Y-%m")
        elif isinstance(shopped_at, str):
            mk = _month_key(shopped_at)
        else:
            mk = "?"
        by_month[mk] = by_month.get(mk, 0.0) + line_with_tax

    by_supplier_list = sorted(
        ({
            "supplier_id": v["supplier_id"],
            "supplier_name": v["supplier_name"],
            "spent": money_round(v["spent"]),
            "tax": money_round(v["tax"]),
            "items": v["items"],
            "quantity": v["quantity"],
        } for v in by_supplier.values()),
        key=lambda x: -x["spent"],
    )
    by_month_list = [
        {"month": k, "spent": money_round(v)}
        for k, v in sorted(by_month.items())
    ]

    shopping_block: Dict[str, Any] = {
        "total_spent": money_round(spent),
        "total_tax": money_round(tax),
        "batches": len(batches_seen),
        "items": items,
        "by_supplier": by_supplier_list,
        "by_month": by_month_list,
    }

    return {
        "period": {"from": dfrom, "to": dto},
        "store_id": store_id,
        "accounting": accounting_block,
        "shopping": shopping_block,
    }
