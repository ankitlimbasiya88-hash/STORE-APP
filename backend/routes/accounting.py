from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Any, Dict, Union
from datetime import datetime, timezone, timedelta
import uuid
import math
import re

from core.db import db
from core.deps import (
    get_current_user, require_admin, require_store_access,
    hash_pin, verify_pin, create_token, decode_token,
)
from core.helpers import money_round, today_str, now_utc

router = APIRouter()
api_router = router  # alias so existing @api_router.* code keeps working

# ====== Models ======
class AccountHeadCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: Literal["credit", "debit"]
    allow_notes: bool = False
    multiple_entries: bool = False


class AccountHead(BaseModel):
    id: str
    store_id: str
    name: str
    type: str
    is_cash: bool = False
    allow_notes: bool = False
    multiple_entries: bool = False
    created_at: str


class EntryUpdate(BaseModel):
    head_id: str
    amount: float = 0.0


class EntryValueUpdate(BaseModel):
    """Replace the entire value for a head. Value can be:
    - number (legacy / single amount)
    - {amount: number, note?: string} (single with note)
    - [{id, label?, note?, amount}] (multiple entries)
    """
    head_id: str
    value: Any = None



# ====== Routes ======
@api_router.get("/accounting/heads", response_model=List[AccountHead])
async def list_heads(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    cursor = db.account_heads.find({"store_id": store_id}, {"_id": 0}).sort("created_at", 1)
    return [AccountHead(**h) async for h in cursor]


@api_router.post("/accounting/heads", response_model=AccountHead, status_code=201)
async def create_head(payload: AccountHeadCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    head = {
        "id": str(uuid.uuid4()), "store_id": store_id, "name": payload.name,
        "type": payload.type, "is_cash": False,
        "allow_notes": bool(payload.allow_notes),
        "multiple_entries": bool(payload.multiple_entries),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.account_heads.insert_one(dict(head))
    return AccountHead(**head)


@api_router.delete("/accounting/heads/{head_id}")
async def delete_head(head_id: str, _=Depends(require_admin)):
    head = await db.account_heads.find_one({"id": head_id}, {"_id": 0})
    if head and head.get("is_cash"):
        raise HTTPException(status_code=400, detail="Cannot delete the Cash head")
    await db.account_heads.delete_one({"id": head_id})
    return {"ok": True}


def _entry_total(value: Any) -> float:
    """Compute the total amount for an entries[head_id] value which may be:
    - number/string: legacy scalar amount
    - dict with 'amount': single amount + note
    - list of items with 'amount': multiple line items
    """
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except Exception:
            return 0.0
    if isinstance(value, dict):
        try:
            return float(value.get("amount", 0) or 0)
        except Exception:
            return 0.0
    if isinstance(value, list):
        total = 0.0
        for item in value:
            if isinstance(item, dict):
                try:
                    total += float(item.get("amount", 0) or 0)
                except Exception:
                    pass
        return total
    return 0.0


async def _compute_closing_for_date(store_id: str, day: str) -> float:
    rec = await db.accounting_entries.find_one({"store_id": store_id, "date": day}, {"_id": 0})
    if not rec:
        return 0.0
    opening = float(rec.get("opening_balance", 0.0))
    entries = rec.get("entries", {})
    heads = {h["id"]: h async for h in db.account_heads.find({"store_id": store_id}, {"_id": 0})}
    total_credit = 0.0
    total_debit = 0.0
    for hid, val in entries.items():
        h = heads.get(hid)
        if not h:
            continue
        amt = _entry_total(val)
        if h["type"] == "credit":
            total_credit += amt
        else:
            total_debit += amt
    return opening + total_credit - total_debit


async def _get_opening_balance(store_id: str, day: str) -> float:
    rec = await db.accounting_entries.find_one(
        {"store_id": store_id, "date": {"$lt": day}}, {"_id": 0}, sort=[("date", -1)]
    )
    if not rec:
        return 0.0
    return await _compute_closing_for_date(store_id, rec["date"])


@api_router.get("/accounting/today")
async def get_today_accounting(
    store_id: str = Query(...),
    date: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    """Return accounting record for given date (defaults to today).
    For today: auto-creates and carries opening balance.
    For historical: returns existing record or empty shell (read-only)."""
    await require_store_access(user, store_id)
    day = date or today_str()
    is_today = day == today_str()
    rec = await db.accounting_entries.find_one({"store_id": store_id, "date": day}, {"_id": 0})
    if not rec:
        if is_today:
            opening = await _get_opening_balance(store_id, day)
            rec = {"store_id": store_id, "date": day, "opening_balance": opening, "entries": {}, "submitted": False}
            await db.accounting_entries.insert_one(dict(rec))
        else:
            rec = {"store_id": store_id, "date": day, "opening_balance": 0.0, "entries": {}, "submitted": False}
    heads = []
    async for h in db.account_heads.find({"store_id": store_id}, {"_id": 0}).sort("created_at", 1):
        heads.append(h)
    entries = rec.get("entries", {})
    total_credit = 0.0
    total_debit = 0.0
    for h in heads:
        amt = _entry_total(entries.get(h["id"]))
        if h["type"] == "credit":
            total_credit += amt
        else:
            total_debit += amt
    opening = float(rec.get("opening_balance", 0.0))
    closing = opening + total_credit - total_debit

    is_employee = user["role"] == "employee"
    return {
        "date": day,
        "store_id": store_id,
        "historical": not is_today,
        "heads": heads,
        # For employees: hide entries map (individual amounts) and balances
        "entries": {} if is_employee else entries,
        "total_credit": total_credit,
        "total_debit": total_debit,
        "net": total_credit - total_debit,
        # Sensitive — admin only
        "opening_balance": None if is_employee else opening,
        "closing_balance": None if is_employee else closing,
        "submitted": bool(rec.get("submitted")),
        "submitted_by": rec.get("submitted_by"),
        "submitted_at": rec.get("submitted_at"),
    }


@api_router.post("/accounting/entry")
async def update_entry(payload: EntryUpdate, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    day = today_str()
    rec = await db.accounting_entries.find_one({"store_id": store_id, "date": day}, {"_id": 0})
    if rec and rec.get("submitted"):
        raise HTTPException(status_code=400, detail="Accounting already submitted for today")
    if not rec:
        opening = await _get_opening_balance(store_id, day)
        await db.accounting_entries.insert_one({
            "store_id": store_id, "date": day, "opening_balance": opening, "entries": {}, "submitted": False,
        })
    await db.accounting_entries.update_one(
        {"store_id": store_id, "date": day},
        {"$set": {f"entries.{payload.head_id}": float(payload.amount)}},
    )
    return {"ok": True}


def _sanitize_entry_value(value: Any) -> Any:
    """Coerce client value into safe storage form."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except Exception:
            return 0.0
    if isinstance(value, dict):
        amt = value.get("amount", 0) or 0
        try:
            amt = float(amt)
        except Exception:
            amt = 0.0
        note = str(value.get("note", "") or "")[:1000]
        return {"amount": amt, "note": note}
    if isinstance(value, list):
        items = []
        for it in value[:50]:  # cap items
            if not isinstance(it, dict):
                continue
            try:
                amt = float(it.get("amount", 0) or 0)
            except Exception:
                amt = 0.0
            items.append({
                "id": str(it.get("id") or uuid.uuid4()),
                "label": str(it.get("label", "") or "")[:120],
                "note": str(it.get("note", "") or "")[:1000],
                "amount": amt,
            })
        return items
    return 0.0


@api_router.post("/accounting/entry/set")
async def set_entry_value(payload: EntryValueUpdate, store_id: str = Query(...), user=Depends(get_current_user)):
    """Replace the entire entries[head_id] value. Supports number, object (single+note), or list (multiple)."""
    await require_store_access(user, store_id)
    day = today_str()
    rec = await db.accounting_entries.find_one({"store_id": store_id, "date": day}, {"_id": 0})
    if rec and rec.get("submitted"):
        raise HTTPException(status_code=400, detail="Accounting already submitted for today")
    if not rec:
        opening = await _get_opening_balance(store_id, day)
        await db.accounting_entries.insert_one({
            "store_id": store_id, "date": day, "opening_balance": opening, "entries": {}, "submitted": False,
        })
    safe = _sanitize_entry_value(payload.value)
    await db.accounting_entries.update_one(
        {"store_id": store_id, "date": day},
        {"$set": {f"entries.{payload.head_id}": safe}},
    )
    return {"ok": True, "value": safe}


@api_router.post("/accounting/submit")
async def submit_accounting(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    day = today_str()
    rec = await db.accounting_entries.find_one({"store_id": store_id, "date": day}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="No entries to submit")
    await db.accounting_entries.update_one(
        {"store_id": store_id, "date": day},
        {"$set": {
            "submitted": True, "submitted_by": user["name"],
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True}


# ============ Inventory (Phase 3) ============

# ---------- Models ----------

