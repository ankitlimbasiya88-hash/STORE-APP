"""Pure utility helpers used across routes."""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP


def money_round(v: float) -> float:
    """Round to 2 decimal places using half-away-from-zero (standard money rules)."""
    return float(Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
