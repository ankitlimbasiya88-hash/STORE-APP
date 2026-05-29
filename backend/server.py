from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import uuid
import bcrypt
import jwt
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Annotated, Dict
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


class AccountHead(BaseModel):
    id: str
    store_id: str
    name: str
    type: str
    is_cash: bool = False
    created_at: str


class EntryUpdate(BaseModel):
    head_id: str
    amount: float = 0.0


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


async def _compute_closing_for_date(store_id: str, day: str) -> float:
    rec = await db.accounting_entries.find_one({"store_id": store_id, "date": day}, {"_id": 0})
    if not rec:
        return 0.0
    opening = float(rec.get("opening_balance", 0.0))
    entries = rec.get("entries", {})
    heads = {h["id"]: h async for h in db.account_heads.find({"store_id": store_id}, {"_id": 0})}
    total_credit = 0.0
    total_debit = 0.0
    for hid, amt in entries.items():
        h = heads.get(hid)
        if not h:
            continue
        if h["type"] == "credit":
            total_credit += float(amt)
        else:
            total_debit += float(amt)
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
        amt = float(entries.get(h["id"], 0.0))
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
