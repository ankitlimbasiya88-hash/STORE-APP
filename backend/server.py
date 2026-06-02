from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query, Response
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
import json
import uuid
import bcrypt
import jwt
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Annotated, Dict, Any, Union
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get("JWT_SECRET", "grocery-store-secret-key-change-in-prod")
JWT_ALG = "HS256"
JWT_EXP_DAYS = 30

app = FastAPI(
    title="Grocery Store Ops API",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)
api_router = APIRouter(prefix="/api")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


# ============ Models ============
class StoreCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class Store(BaseModel):
    id: str
    name: str
    created_at: str


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    pin: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")
    role: Literal["admin", "employee"] = "employee"
    allowed_stores: List[str] = Field(default_factory=list)


class LoginRequest(BaseModel):
    name: str
    pin: str


class UserOut(BaseModel):
    id: str
    name: str
    role: str
    allowed_stores: List[str] = Field(default_factory=list)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class StoreAssignRequest(BaseModel):
    allowed_stores: List[str]


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class Task(BaseModel):
    id: str
    store_id: str
    title: str
    type: Literal["opening", "closing"]
    created_at: str


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


class ChatMessageOut(BaseModel):
    id: str
    store_id: str
    sender_id: str
    sender_name: str
    text: Optional[str] = None
    attachment_base64: Optional[str] = None
    attachment_type: Optional[str] = None
    attachment_content_type: Optional[str] = None
    attachment_filename: Optional[str] = None
    created_at: str


# ============ Helpers ============
def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_pin(pin: str, pin_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode(), pin_hash.encode())
    except Exception:
        return False


def create_token(user_id: str, name: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id, "name": name, "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=JWT_EXP_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> dict:
    payload = decode_token(token)
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "pin_hash": 0, "name_lower": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user.setdefault("allowed_stores", [])
    return user


async def require_admin(user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_store_access(user: dict, store_id: str) -> None:
    # Verify store exists
    store = await db.stores.find_one({"id": store_id})
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    # Admin has access to all stores
    if user["role"] == "admin":
        return
    # Employees: must be in allowed_stores
    if store_id not in user.get("allowed_stores", []):
        raise HTTPException(status_code=403, detail="No access to this store")


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ============ Stores ============
@api_router.get("/stores", response_model=List[Store])
async def list_stores(user=Depends(get_current_user)):
    """Admin sees all stores; employees see only their allowed stores."""
    if user["role"] == "admin":
        cursor = db.stores.find({}, {"_id": 0}).sort("created_at", 1)
    else:
        allowed = user.get("allowed_stores", [])
        if not allowed:
            return []
        cursor = db.stores.find({"id": {"$in": allowed}}, {"_id": 0}).sort("created_at", 1)
    return [Store(**s) async for s in cursor]


@api_router.post("/stores", response_model=Store, status_code=201)
async def create_store(payload: StoreCreate, _=Depends(require_admin)):
    store_id = str(uuid.uuid4())
    store = {
        "id": store_id,
        "name": payload.name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stores.insert_one(dict(store))
    # Seed default Cash head for this store
    await db.account_heads.insert_one({
        "id": str(uuid.uuid4()),
        "store_id": store_id,
        "name": "Cash",
        "type": "credit",
        "is_cash": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return Store(**store)


@api_router.delete("/stores/{store_id}")
async def delete_store(store_id: str, _=Depends(require_admin)):
    result = await db.stores.delete_one({"id": store_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Store not found")
    # Cascade delete all per-store data
    await db.tasks.delete_many({"store_id": store_id})
    await db.account_heads.delete_many({"store_id": store_id})
    await db.accounting_entries.delete_many({"store_id": store_id})
    await db.checklist_submissions.delete_many({"store_id": store_id})
    await db.messages.delete_many({"store_id": store_id})
    # Remove from user allowed_stores
    await db.users.update_many({}, {"$pull": {"allowed_stores": store_id}})
    return {"ok": True}


# ============ Auth ============
@api_router.post("/auth/register", response_model=UserOut, status_code=201)
async def register_user(payload: RegisterRequest, current=Depends(get_current_user)):
    if current["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admin can create users")
    existing = await db.users.find_one({"name_lower": payload.name.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Name already taken")
    # Validate stores exist
    if payload.allowed_stores:
        valid_ids = {s["id"] async for s in db.stores.find({"id": {"$in": payload.allowed_stores}}, {"_id": 0, "id": 1})}
        if len(valid_ids) != len(set(payload.allowed_stores)):
            raise HTTPException(status_code=400, detail="One or more stores not found")
    user_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": user_id,
        "name": payload.name,
        "name_lower": payload.name.lower(),
        "pin_hash": hash_pin(payload.pin),
        "role": payload.role,
        "allowed_stores": payload.allowed_stores,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return UserOut(id=user_id, name=payload.name, role=payload.role, allowed_stores=payload.allowed_stores)


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    user = await db.users.find_one({"name_lower": payload.name.lower()})
    if not user or not verify_pin(payload.pin, user["pin_hash"]):
        raise HTTPException(status_code=401, detail="Invalid name or PIN")
    token = create_token(user["id"], user["name"], user["role"])
    return TokenResponse(
        access_token=token,
        user=UserOut(
            id=user["id"], name=user["name"], role=user["role"],
            allowed_stores=user.get("allowed_stores", []),
        ),
    )


@api_router.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(id=user["id"], name=user["name"], role=user["role"], allowed_stores=user.get("allowed_stores", []))


@api_router.get("/users", response_model=List[UserOut])
async def list_users(_=Depends(require_admin)):
    cursor = db.users.find({}, {"_id": 0, "pin_hash": 0, "name_lower": 0})
    out = []
    async for u in cursor:
        out.append(UserOut(
            id=u["id"], name=u["name"], role=u["role"],
            allowed_stores=u.get("allowed_stores", []),
        ))
    return out


@api_router.put("/users/{user_id}/stores", response_model=UserOut)
async def assign_user_stores(user_id: str, payload: StoreAssignRequest, _=Depends(require_admin)):
    if payload.allowed_stores:
        valid_ids = {s["id"] async for s in db.stores.find({"id": {"$in": payload.allowed_stores}}, {"_id": 0, "id": 1})}
        if len(valid_ids) != len(set(payload.allowed_stores)):
            raise HTTPException(status_code=400, detail="One or more stores not found")
    res = await db.users.find_one_and_update(
        {"id": user_id},
        {"$set": {"allowed_stores": payload.allowed_stores}},
        projection={"_id": 0, "pin_hash": 0, "name_lower": 0},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(id=res["id"], name=res["name"], role=res["role"], allowed_stores=res.get("allowed_stores", []))


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin=Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


# ============ Checklists ============
@api_router.get("/checklists/{type}/tasks", response_model=List[Task])
async def list_tasks(type: Literal["opening", "closing"], store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    cursor = db.tasks.find({"type": type, "store_id": store_id}, {"_id": 0}).sort("created_at", 1)
    return [Task(**t) async for t in cursor]


@api_router.post("/checklists/{type}/tasks", response_model=Task, status_code=201)
async def create_task(type: Literal["opening", "closing"], payload: TaskCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    task = {
        "id": str(uuid.uuid4()), "store_id": store_id, "title": payload.title,
        "type": type, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tasks.insert_one(dict(task))
    return Task(**task)


@api_router.delete("/checklists/{type}/tasks/{task_id}")
async def delete_task(type: Literal["opening", "closing"], task_id: str, _=Depends(require_admin)):
    await db.tasks.delete_one({"id": task_id, "type": type})
    return {"ok": True}


@api_router.get("/checklists/{type}/today")
async def get_today_checklist(
    type: Literal["opening", "closing"],
    store_id: str = Query(...),
    date: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    await require_store_access(user, store_id)
    day = date or today_str()
    historical = day != today_str()
    submission = await db.checklist_submissions.find_one(
        {"type": type, "date": day, "store_id": store_id}, {"_id": 0}
    )
    tasks = []
    async for t in db.tasks.find({"type": type, "store_id": store_id}, {"_id": 0}).sort("created_at", 1):
        tasks.append(t)
    completed_ids = set(submission["completed_ids"]) if submission else set()
    return {
        "date": day,
        "store_id": store_id,
        "historical": historical,
        "tasks": tasks,
        "completed_ids": list(completed_ids),
        "submitted": bool(submission and submission.get("submitted")),
        "submitted_by": submission.get("submitted_by") if submission else None,
        "submitted_at": submission.get("submitted_at") if submission else None,
    }


class ToggleRequest(BaseModel):
    task_id: str
    completed: bool


@api_router.post("/checklists/{type}/toggle")
async def toggle_task(type: Literal["opening", "closing"], payload: ToggleRequest, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    day = today_str()
    sub = await db.checklist_submissions.find_one({"type": type, "date": day, "store_id": store_id})
    if sub and sub.get("submitted"):
        raise HTTPException(status_code=400, detail="Already submitted for today")
    completed_ids = set(sub["completed_ids"]) if sub else set()
    if payload.completed:
        completed_ids.add(payload.task_id)
    else:
        completed_ids.discard(payload.task_id)
    await db.checklist_submissions.update_one(
        {"type": type, "date": day, "store_id": store_id},
        {"$set": {"completed_ids": list(completed_ids), "submitted": False, "store_id": store_id}},
        upsert=True,
    )
    return {"ok": True, "completed_ids": list(completed_ids)}


@api_router.post("/checklists/{type}/submit")
async def submit_checklist(type: Literal["opening", "closing"], store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    day = today_str()
    sub = await db.checklist_submissions.find_one({"type": type, "date": day, "store_id": store_id})
    completed_ids = set(sub["completed_ids"]) if sub else set()
    all_task_ids = set()
    async for t in db.tasks.find({"type": type, "store_id": store_id}, {"_id": 0, "id": 1}):
        all_task_ids.add(t["id"])
    pending = all_task_ids - completed_ids
    if pending:
        raise HTTPException(status_code=400, detail=f"{len(pending)} task(s) still pending")
    if not all_task_ids:
        raise HTTPException(status_code=400, detail="No tasks configured")
    now = datetime.now(timezone.utc).isoformat()
    await db.checklist_submissions.update_one(
        {"type": type, "date": day, "store_id": store_id},
        {"$set": {
            "submitted": True, "submitted_by": user["name"], "submitted_at": now,
            "completed_ids": list(completed_ids), "store_id": store_id,
        }},
        upsert=True,
    )
    return {"ok": True, "submitted_at": now}


# ============ Accounting ============
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

class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact: str = ""
    notes: str = ""


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


class Supplier(BaseModel):
    id: str
    store_id: str
    name: str
    contact: str = ""
    notes: str = ""
    created_at: str


class TaxonomyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TaxonomyUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class Taxonomy(BaseModel):
    id: str
    store_id: str
    kind: Literal["category", "purchase_type"]
    name: str
    created_at: str


class PurchasePriceEntry(BaseModel):
    id: str
    date: str
    price: float
    supplier_id: Optional[str] = None
    source: str = "manual"   # manual | shopping | adjustment
    note: str = ""


class PurchasePriceCreate(BaseModel):
    price: float = Field(ge=0)
    date: Optional[str] = None      # ISO date; defaults to today
    supplier_id: Optional[str] = None
    source: str = "manual"
    note: str = ""


class AvgSales(BaseModel):
    quantity: float = 0
    period_days: int = 0
    per_day: float = 0


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    barcode: Optional[str] = None
    size: str = ""
    company: str = ""
    pack_size: str = ""
    category_id: Optional[str] = None
    ideal_profit_margin: float = 0       # %
    selling_price: float = 0
    tax_pct: float = 0
    preferred_supplier_ids: List[str] = []
    images: List[str] = []                # base64 strings
    barcode_image: Optional[str] = None   # base64
    avg_sales: AvgSales = Field(default_factory=AvgSales)
    expiry_sensitivity_days: int = 0
    min_inventory_days: int = 0
    max_inventory_days: int = 0
    purchase_type_ids: List[str] = []
    keywords: List[str] = []


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    barcode: Optional[str] = None
    size: Optional[str] = None
    company: Optional[str] = None
    pack_size: Optional[str] = None
    category_id: Optional[str] = None
    ideal_profit_margin: Optional[float] = None
    selling_price: Optional[float] = None
    tax_pct: Optional[float] = None
    preferred_supplier_ids: Optional[List[str]] = None
    images: Optional[List[str]] = None
    barcode_image: Optional[str] = None
    avg_sales: Optional[AvgSales] = None
    expiry_sensitivity_days: Optional[int] = None
    min_inventory_days: Optional[int] = None
    max_inventory_days: Optional[int] = None
    purchase_type_ids: Optional[List[str]] = None
    keywords: Optional[List[str]] = None


class Product(BaseModel):
    id: str
    store_id: str
    name: str
    barcode: Optional[str] = None
    size: str = ""
    company: str = ""
    pack_size: str = ""
    category_id: Optional[str] = None
    ideal_profit_margin: float = 0
    selling_price: float = 0
    tax_pct: float = 0
    preferred_supplier_ids: List[str] = []
    images: List[str] = []
    barcode_image: Optional[str] = None
    purchase_prices: List[PurchasePriceEntry] = []
    avg_sales: AvgSales = Field(default_factory=AvgSales)
    expiry_sensitivity_days: int = 0
    min_inventory_days: int = 0
    max_inventory_days: int = 0
    purchase_type_ids: List[str] = []
    keywords: List[str] = []
    created_at: str
    updated_at: str


# ---------- Suppliers ----------

@api_router.get("/inventory/suppliers", response_model=List[Supplier])
async def list_suppliers(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    out = []
    async for s in db.suppliers.find({"store_id": store_id}, {"_id": 0}).sort("name", 1):
        out.append(s)
    return out


@api_router.post("/inventory/suppliers", response_model=Supplier, status_code=201)
async def create_supplier(payload: SupplierCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    doc = {
        "id": str(uuid.uuid4()), "store_id": store_id,
        "name": payload.name.strip(), "contact": payload.contact, "notes": payload.notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.suppliers.insert_one(dict(doc))
    return Supplier(**doc)


@api_router.patch("/inventory/suppliers/{sid}", response_model=Supplier)
async def update_supplier(sid: str, payload: SupplierUpdate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.suppliers.update_one({"id": sid, "store_id": store_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    doc = await db.suppliers.find_one({"id": sid}, {"_id": 0})
    return Supplier(**doc)


@api_router.delete("/inventory/suppliers/{sid}", status_code=204)
async def delete_supplier(sid: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.suppliers.delete_one({"id": sid, "store_id": store_id})
    # Remove the supplier id from products' preferred lists
    await db.products.update_many(
        {"store_id": store_id, "preferred_supplier_ids": sid},
        {"$pull": {"preferred_supplier_ids": sid}},
    )
    return Response(status_code=204)


# ---------- Taxonomies (category + purchase-type) ----------

async def _list_taxonomy(store_id: str, kind: str) -> List[dict]:
    out: List[dict] = []
    async for t in db.taxonomies.find({"store_id": store_id, "kind": kind}, {"_id": 0}).sort("name", 1):
        out.append(t)
    return out


@api_router.get("/inventory/categories", response_model=List[Taxonomy])
async def list_categories(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    return await _list_taxonomy(store_id, "category")


@api_router.get("/inventory/purchase-types", response_model=List[Taxonomy])
async def list_purchase_types(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    return await _list_taxonomy(store_id, "purchase_type")


async def _create_taxonomy(store_id: str, kind: str, name: str) -> dict:
    doc = {
        "id": str(uuid.uuid4()), "store_id": store_id, "kind": kind,
        "name": name.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.taxonomies.insert_one(dict(doc))
    return doc


@api_router.post("/inventory/categories", response_model=Taxonomy, status_code=201)
async def create_category(payload: TaxonomyCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    return await _create_taxonomy(store_id, "category", payload.name)


@api_router.post("/inventory/purchase-types", response_model=Taxonomy, status_code=201)
async def create_purchase_type(payload: TaxonomyCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    return await _create_taxonomy(store_id, "purchase_type", payload.name)


@api_router.patch("/inventory/categories/{tid}", response_model=Taxonomy)
async def update_category(tid: str, payload: TaxonomyUpdate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    res = await db.taxonomies.update_one(
        {"id": tid, "store_id": store_id, "kind": "category"},
        {"$set": {"name": payload.name.strip()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    doc = await db.taxonomies.find_one({"id": tid}, {"_id": 0})
    return Taxonomy(**doc)


@api_router.patch("/inventory/purchase-types/{tid}", response_model=Taxonomy)
async def update_purchase_type(tid: str, payload: TaxonomyUpdate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    res = await db.taxonomies.update_one(
        {"id": tid, "store_id": store_id, "kind": "purchase_type"},
        {"$set": {"name": payload.name.strip()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Purchase type not found")
    doc = await db.taxonomies.find_one({"id": tid}, {"_id": 0})
    return Taxonomy(**doc)


@api_router.delete("/inventory/categories/{tid}", status_code=204)
async def delete_category(tid: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.taxonomies.delete_one({"id": tid, "store_id": store_id, "kind": "category"})
    await db.products.update_many({"store_id": store_id, "category_id": tid}, {"$set": {"category_id": None}})
    return Response(status_code=204)


@api_router.delete("/inventory/purchase-types/{tid}", status_code=204)
async def delete_purchase_type(tid: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.taxonomies.delete_one({"id": tid, "store_id": store_id, "kind": "purchase_type"})
    await db.products.update_many({"store_id": store_id, "purchase_type_ids": tid}, {"$pull": {"purchase_type_ids": tid}})
    return Response(status_code=204)


# ---------- Products ----------

def _product_search_filter(store_id: str, q: Optional[str], barcode: Optional[str]) -> dict:
    f: dict = {"store_id": store_id}
    if barcode:
        f["barcode"] = barcode.strip()
        return f
    if q:
        s = q.strip()
        if not s:
            return f
        regex = {"$regex": re.escape(s), "$options": "i"}
        # numeric (selling price) matching
        try:
            num = float(s)
            f["$or"] = [
                {"name": regex}, {"company": regex},
                {"keywords": regex}, {"size": regex}, {"pack_size": regex},
                {"selling_price": num},
            ]
        except Exception:
            f["$or"] = [
                {"name": regex}, {"company": regex},
                {"keywords": regex}, {"size": regex}, {"pack_size": regex},
            ]
    return f


def _strip_images_for_list(p: dict) -> dict:
    """Return product without large image blobs (for list views)."""
    out = dict(p)
    imgs = out.get("images") or []
    out["images_count"] = len(imgs)
    out["thumbnail"] = imgs[0] if imgs else None
    out["images"] = []
    out["barcode_image"] = None
    return out


@api_router.get("/inventory/products")
async def list_products(
    store_id: str = Query(...),
    q: Optional[str] = None,
    barcode: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user),
):
    await require_store_access(user, store_id)
    flt = _product_search_filter(store_id, q, barcode)
    out: List[dict] = []
    async for p in db.products.find(flt, {"_id": 0}).sort("name", 1).limit(limit):
        out.append(_strip_images_for_list(p))
    return out


@api_router.get("/inventory/products/{pid}", response_model=Product)
async def get_product(pid: str, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    p = await db.products.find_one({"id": pid, "store_id": store_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    # Ensure all required default fields
    p.setdefault("purchase_prices", [])
    p.setdefault("avg_sales", {"quantity": 0, "period_days": 0, "per_day": 0})
    return Product(**p)


def _compute_avg_sales(avg: dict | AvgSales | None) -> dict:
    if not avg:
        return {"quantity": 0, "period_days": 0, "per_day": 0}
    if isinstance(avg, AvgSales):
        avg = avg.model_dump()
    qty = float(avg.get("quantity") or 0)
    days = int(avg.get("period_days") or 0)
    per_day = qty / days if days > 0 else 0.0
    return {"quantity": qty, "period_days": days, "per_day": round(per_day, 4)}


def _auto_keywords(name: str, company: str, selling_price: float, category_name: Optional[str] = None) -> List[str]:
    """Build search keywords automatically from product attributes."""
    parts: List[str] = []
    for src in (name or "", company or "", category_name or ""):
        for tok in re.split(r"[^A-Za-z0-9]+", src.lower()):
            if tok and len(tok) >= 2 and tok not in parts:
                parts.append(tok)
    if selling_price:
        parts.append(str(round(float(selling_price), 2)))
        parts.append(str(int(round(float(selling_price)))))
    # dedupe preserving order
    seen = set()
    out: List[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


async def _category_name(store_id: str, category_id: Optional[str]) -> Optional[str]:
    if not category_id:
        return None
    t = await db.taxonomies.find_one({"id": category_id, "store_id": store_id}, {"_id": 0, "name": 1})
    return t["name"] if t else None


@api_router.post("/inventory/products", response_model=Product, status_code=201)
async def create_product(payload: ProductCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    if payload.barcode:
        dup = await db.products.find_one({"store_id": store_id, "barcode": payload.barcode.strip()})
        if dup:
            raise HTTPException(status_code=409, detail="A product with this barcode already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["store_id"] = store_id
    doc["barcode"] = (payload.barcode or "").strip() or None
    doc["purchase_prices"] = []
    doc["avg_sales"] = _compute_avg_sales(payload.avg_sales)
    cat = await _category_name(store_id, payload.category_id)
    doc["keywords"] = _auto_keywords(payload.name, payload.company, payload.selling_price, cat)
    doc["created_at"] = now
    doc["updated_at"] = now
    await db.products.insert_one(dict(doc))
    return Product(**doc)


@api_router.patch("/inventory/products/{pid}", response_model=Product)
async def update_product(pid: str, payload: ProductUpdate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "barcode" in upd and upd["barcode"]:
        upd["barcode"] = upd["barcode"].strip()
        dup = await db.products.find_one({
            "store_id": store_id, "barcode": upd["barcode"], "id": {"$ne": pid},
        })
        if dup:
            raise HTTPException(status_code=409, detail="A product with this barcode already exists")
    if "avg_sales" in upd:
        upd["avg_sales"] = _compute_avg_sales(upd["avg_sales"])
    # Always recompute keywords when name/company/selling_price/category changes
    if any(k in upd for k in ("name", "company", "selling_price", "category_id")):
        existing = await db.products.find_one({"id": pid, "store_id": store_id}, {"_id": 0})
        if existing:
            merged = {**existing, **upd}
            cat = await _category_name(store_id, merged.get("category_id"))
            upd["keywords"] = _auto_keywords(merged.get("name", ""), merged.get("company", ""), merged.get("selling_price", 0), cat)
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.products.update_one({"id": pid, "store_id": store_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    return Product(**p)


@api_router.delete("/inventory/products/{pid}", status_code=204)
async def delete_product(pid: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.products.delete_one({"id": pid, "store_id": store_id})
    return Response(status_code=204)


@api_router.post("/inventory/products/{pid}/purchase-price", response_model=Product)
async def add_purchase_price(pid: str, payload: PurchasePriceCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    p = await db.products.find_one({"id": pid, "store_id": store_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    entry = {
        "id": str(uuid.uuid4()),
        "date": (payload.date or today_str()),
        "price": float(payload.price),
        "supplier_id": payload.supplier_id,
        "source": payload.source or "manual",
        "note": payload.note or "",
    }
    await db.products.update_one(
        {"id": pid, "store_id": store_id},
        {
            "$push": {"purchase_prices": entry},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    return Product(**p)


@api_router.delete("/inventory/products/{pid}/purchase-price/{entry_id}", response_model=Product)
async def delete_purchase_price(pid: str, entry_id: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    res = await db.products.update_one(
        {"id": pid, "store_id": store_id},
        {
            "$pull": {"purchase_prices": {"id": entry_id}},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    return Product(**p)


# ---------- Shopping List ----------

class ShoppingListItemCreate(BaseModel):
    product_id: Optional[str] = None
    text: str = ""
    quantity: float = 1
    note: str = ""


class ShoppingListItemUpdate(BaseModel):
    text: Optional[str] = None
    quantity: Optional[float] = None
    note: Optional[str] = None
    status: Optional[Literal["pending", "done"]] = None


class ShoppingListItem(BaseModel):
    id: str
    store_id: str
    product_id: Optional[str] = None
    product_name: Optional[str] = None
    text: str = ""
    quantity: float = 1
    note: str = ""
    status: str = "pending"  # pending | done
    added_by: str
    created_at: str
    updated_at: str


@api_router.get("/inventory/shopping-list", response_model=List[ShoppingListItem])
async def list_shopping_items(store_id: str = Query(...), status: Optional[str] = None, user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    flt: dict = {"store_id": store_id}
    if status:
        flt["status"] = status
    out: List[dict] = []
    async for it in db.shopping_list.find(flt, {"_id": 0}).sort("created_at", -1):
        out.append(it)
    return out


@api_router.post("/inventory/shopping-list", response_model=ShoppingListItem, status_code=201)
async def create_shopping_item(payload: ShoppingListItemCreate, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    if not payload.product_id and not (payload.text or "").strip():
        raise HTTPException(status_code=400, detail="Provide a product_id or text")
    product_name: Optional[str] = None
    if payload.product_id:
        p = await db.products.find_one({"id": payload.product_id, "store_id": store_id}, {"_id": 0, "name": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Product not found")
        product_name = p["name"]
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "store_id": store_id,
        "product_id": payload.product_id,
        "product_name": product_name,
        "text": (payload.text or "").strip(),
        "quantity": float(payload.quantity or 1),
        "note": payload.note or "",
        "status": "pending",
        "added_by": user["name"],
        "created_at": now,
        "updated_at": now,
    }
    await db.shopping_list.insert_one(dict(doc))
    return ShoppingListItem(**doc)


@api_router.patch("/inventory/shopping-list/{iid}", response_model=ShoppingListItem)
async def update_shopping_item(iid: str, payload: ShoppingListItemUpdate, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.shopping_list.update_one({"id": iid, "store_id": store_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await db.shopping_list.find_one({"id": iid}, {"_id": 0})
    return ShoppingListItem(**doc)


@api_router.delete("/inventory/shopping-list/{iid}", status_code=204)
async def delete_shopping_item(iid: str, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    # Employees can only delete their own items; admin can delete any
    item = await db.shopping_list.find_one({"id": iid, "store_id": store_id})
    if not item:
        return Response(status_code=204)
    if user["role"] != "admin" and item.get("added_by") != user["name"]:
        raise HTTPException(status_code=403, detail="Only the admin or the original adder can delete this item")
    await db.shopping_list.delete_one({"id": iid, "store_id": store_id})
    return Response(status_code=204)


# ============ Chat ============
@api_router.get("/chat/messages", response_model=List[ChatMessageOut])
async def chat_history(store_id: str = Query(...), limit: int = 50, user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    cursor = db.messages.find({"store_id": store_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    msgs = [m async for m in cursor]
    msgs.reverse()
    return [ChatMessageOut(**m) for m in msgs]


class ConnectionManager:
    def __init__(self):
        # Map store_id -> list of WebSockets
        self.active: Dict[str, List[WebSocket]] = {}

    async def connect(self, ws: WebSocket, store_id: str):
        await ws.accept()
        self.active.setdefault(store_id, []).append(ws)

    def disconnect(self, ws: WebSocket, store_id: str):
        if store_id in self.active and ws in self.active[store_id]:
            self.active[store_id].remove(ws)

    async def broadcast(self, store_id: str, message: str):
        for ws in list(self.active.get(store_id, [])):
            try:
                await ws.send_text(message)
            except Exception:
                self.disconnect(ws, store_id)


manager = ConnectionManager()


@app.websocket("/api/ws/chat")
async def ws_chat(websocket: WebSocket, token: str = Query(...), store_id: str = Query(...)):
    try:
        payload = decode_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return
    user_id = payload["sub"]
    name = payload["name"]
    role = payload["role"]
    # Verify store access
    if role != "admin":
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "allowed_stores": 1})
        if not u or store_id not in (u.get("allowed_stores") or []):
            await websocket.close(code=4403)
            return
    # Verify store exists
    store = await db.stores.find_one({"id": store_id})
    if not store:
        await websocket.close(code=4404)
        return

    await manager.connect(websocket, store_id)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except Exception:
                continue
            msg_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            doc = {
                "id": msg_id, "store_id": store_id,
                "sender_id": user_id, "sender_name": name,
                "text": data.get("text"),
                "attachment_base64": data.get("attachment_base64"),
                "attachment_type": data.get("attachment_type"),
                "attachment_content_type": data.get("attachment_content_type"),
                "attachment_filename": data.get("attachment_filename"),
                "created_at": now,
            }
            await db.messages.insert_one(dict(doc))
            await manager.broadcast(store_id, json.dumps(doc))
    except WebSocketDisconnect:
        manager.disconnect(websocket, store_id)
    except Exception as e:
        logger.exception("WebSocket error: %s", e)
        manager.disconnect(websocket, store_id)


# ============ Startup: seed admin + default store ============
@app.on_event("startup")
async def seed_defaults():
    # Backfill: add allowed_stores: [] to any user missing it
    await db.users.update_many({"allowed_stores": {"$exists": False}}, {"$set": {"allowed_stores": []}})

    # Seed default store if none exist
    store_count = await db.stores.count_documents({})
    if store_count == 0:
        store_id = str(uuid.uuid4())
        await db.stores.insert_one({
            "id": store_id, "name": "Main Store",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        # Seed Cash head for the default store
        await db.account_heads.insert_one({
            "id": str(uuid.uuid4()), "store_id": store_id,
            "name": "Cash", "type": "credit", "is_cash": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded default store: 'Main Store'")

    # Seed default admin if no users exist
    user_count = await db.users.count_documents({})
    if user_count == 0:
        admin_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": admin_id, "name": "Admin", "name_lower": "admin",
            "pin_hash": hash_pin("1234"), "role": "admin",
            "allowed_stores": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded default admin: name='Admin' pin='1234'")

    # Ensure every store has a Cash head (idempotent)
    async for store in db.stores.find({}, {"_id": 0, "id": 1}):
        has_cash = await db.account_heads.find_one({"store_id": store["id"], "is_cash": True})
        if not has_cash:
            await db.account_heads.insert_one({
                "id": str(uuid.uuid4()), "store_id": store["id"],
                "name": "Cash", "type": "credit", "is_cash": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
