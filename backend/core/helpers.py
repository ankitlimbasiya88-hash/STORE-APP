"""Pure utility helpers used across routes."""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any


def money_round(v: float) -> float:
    """Round to 2 decimal places using half-away-from-zero (standard money rules)."""
    return float(Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def entry_total(value: Any) -> float:
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
