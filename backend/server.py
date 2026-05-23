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
from typing import List, Optional, Literal, Annotated
from datetime import datetime, timezone, date, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get("JWT_SECRET", "grocery-store-secret-key-change-in-prod")
JWT_ALG = "HS256"
JWT_EXP_DAYS = 30

app = FastAPI()
api_router = APIRouter(prefix="/api")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


# ============ Models ============
class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    pin: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")
    role: Literal["admin", "employee"] = "employee"


class LoginRequest(BaseModel):
    name: str
    pin: str


class UserOut(BaseModel):
    id: str
    name: str
    role: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class Task(BaseModel):
    id: str
    title: str
    type: Literal["opening", "closing"]
    created_at: str


class AccountHeadCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: Literal["credit", "debit"]


class AccountHead(BaseModel):
    id: str
    name: str
    type: str
    created_at: str


class EntryUpdate(BaseModel):
    head_id: str
    amount: float = 0.0


class ChatMessageOut(BaseModel):
    id: str
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
        "sub": user_id,
        "name": name,
        "role": role,
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
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "pin_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_admin(user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def yesterday_str() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")


# ============ Auth ============
@api_router.post("/auth/register", response_model=UserOut, status_code=201)
async def register_user(payload: RegisterRequest, current=Depends(get_current_user)):
    # Only admin can register new users via this endpoint
    if current["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admin can create users")
    existing = await db.users.find_one({"name_lower": payload.name.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Name already taken")
    user_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": user_id,
        "name": payload.name,
        "name_lower": payload.name.lower(),
        "pin_hash": hash_pin(payload.pin),
        "role": payload.role,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return UserOut(id=user_id, name=payload.name, role=payload.role)


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    user = await db.users.find_one({"name_lower": payload.name.lower()})
    if not user or not verify_pin(payload.pin, user["pin_hash"]):
        raise HTTPException(status_code=401, detail="Invalid name or PIN")
    token = create_token(user["id"], user["name"], user["role"])
    return TokenResponse(
        access_token=token,
        user=UserOut(id=user["id"], name=user["name"], role=user["role"]),
    )


@api_router.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(id=user["id"], name=user["name"], role=user["role"])


@api_router.get("/users", response_model=List[UserOut])
async def list_users(_=Depends(require_admin)):
    cursor = db.users.find({}, {"_id": 0, "pin_hash": 0, "name_lower": 0})
    return [UserOut(id=u["id"], name=u["name"], role=u["role"]) async for u in cursor]


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
async def list_tasks(type: Literal["opening", "closing"], _=Depends(get_current_user)):
    cursor = db.tasks.find({"type": type}, {"_id": 0}).sort("created_at", 1)
    return [Task(**t) async for t in cursor]


@api_router.post("/checklists/{type}/tasks", response_model=Task, status_code=201)
async def create_task(type: Literal["opening", "closing"], payload: TaskCreate, _=Depends(require_admin)):
    task = {
        "id": str(uuid.uuid4()),
        "title": payload.title,
        "type": type,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tasks.insert_one(task)
    return Task(**task)


@api_router.delete("/checklists/{type}/tasks/{task_id}")
async def delete_task(type: Literal["opening", "closing"], task_id: str, _=Depends(require_admin)):
    await db.tasks.delete_one({"id": task_id, "type": type})
    return {"ok": True}


@api_router.get("/checklists/{type}/today")
async def get_today_checklist(type: Literal["opening", "closing"], user=Depends(get_current_user)):
    day = today_str()
    submission = await db.checklist_submissions.find_one(
        {"type": type, "date": day}, {"_id": 0}
    )
    tasks = []
    cursor = db.tasks.find({"type": type}, {"_id": 0}).sort("created_at", 1)
    async for t in cursor:
        tasks.append(t)
    completed_ids = set(submission["completed_ids"]) if submission else set()
    return {
        "date": day,
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
async def toggle_task(type: Literal["opening", "closing"], payload: ToggleRequest, user=Depends(get_current_user)):
    day = today_str()
    sub = await db.checklist_submissions.find_one({"type": type, "date": day})
    if sub and sub.get("submitted"):
        raise HTTPException(status_code=400, detail="Already submitted for today")
    completed_ids = set(sub["completed_ids"]) if sub else set()
    if payload.completed:
        completed_ids.add(payload.task_id)
    else:
        completed_ids.discard(payload.task_id)
    await db.checklist_submissions.update_one(
        {"type": type, "date": day},
        {"$set": {"completed_ids": list(completed_ids), "submitted": False}},
        upsert=True,
    )
    return {"ok": True, "completed_ids": list(completed_ids)}


@api_router.post("/checklists/{type}/submit")
async def submit_checklist(type: Literal["opening", "closing"], user=Depends(get_current_user)):
    day = today_str()
    sub = await db.checklist_submissions.find_one({"type": type, "date": day})
    completed_ids = set(sub["completed_ids"]) if sub else set()
    all_task_ids = set()
    async for t in db.tasks.find({"type": type}, {"_id": 0, "id": 1}):
        all_task_ids.add(t["id"])
    pending = all_task_ids - completed_ids
    if pending:
        raise HTTPException(status_code=400, detail=f"{len(pending)} task(s) still pending")
    if not all_task_ids:
        raise HTTPException(status_code=400, detail="No tasks configured")
    now = datetime.now(timezone.utc).isoformat()
    await db.checklist_submissions.update_one(
        {"type": type, "date": day},
        {"$set": {
            "submitted": True,
            "submitted_by": user["name"],
            "submitted_at": now,
            "completed_ids": list(completed_ids),
        }},
        upsert=True,
    )
    return {"ok": True, "submitted_at": now}


# ============ Accounting ============
@api_router.get("/accounting/heads", response_model=List[AccountHead])
async def list_heads(_=Depends(get_current_user)):
    cursor = db.account_heads.find({}, {"_id": 0}).sort("created_at", 1)
    return [AccountHead(**h) async for h in cursor]


@api_router.post("/accounting/heads", response_model=AccountHead, status_code=201)
async def create_head(payload: AccountHeadCreate, _=Depends(require_admin)):
    head = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "type": payload.type,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.account_heads.insert_one(head)
    return AccountHead(**head)


@api_router.delete("/accounting/heads/{head_id}")
async def delete_head(head_id: str, _=Depends(require_admin)):
    await db.account_heads.delete_one({"id": head_id})
    return {"ok": True}


async def _compute_closing_for_date(day: str) -> float:
    """Compute closing balance for a given date. Returns 0 if no record."""
    rec = await db.accounting_entries.find_one({"date": day}, {"_id": 0})
    if not rec:
        return 0.0
    opening = float(rec.get("opening_balance", 0.0))
    entries = rec.get("entries", {})  # head_id -> amount
    heads = {h["id"]: h async for h in db.account_heads.find({}, {"_id": 0})}
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


async def _get_opening_balance(day: str) -> float:
    """Get opening balance = previous day's closing. Walks back to find last record."""
    # Look for the most recent record before `day`
    rec = await db.accounting_entries.find_one(
        {"date": {"$lt": day}}, {"_id": 0}, sort=[("date", -1)]
    )
    if not rec:
        return 0.0
    last_day = rec["date"]
    return await _compute_closing_for_date(last_day)


@api_router.get("/accounting/today")
async def get_today_accounting(user=Depends(get_current_user)):
    day = today_str()
    rec = await db.accounting_entries.find_one({"date": day}, {"_id": 0})
    if not rec:
        opening = await _get_opening_balance(day)
        rec = {"date": day, "opening_balance": opening, "entries": {}, "submitted": False}
        await db.accounting_entries.insert_one(dict(rec))
    heads = []
    async for h in db.account_heads.find({}, {"_id": 0}).sort("created_at", 1):
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
    return {
        "date": day,
        "opening_balance": opening,
        "heads": heads,
        "entries": entries,
        "total_credit": total_credit,
        "total_debit": total_debit,
        "closing_balance": closing,
        "submitted": bool(rec.get("submitted")),
    }


@api_router.post("/accounting/entry")
async def update_entry(payload: EntryUpdate, user=Depends(get_current_user)):
    day = today_str()
    rec = await db.accounting_entries.find_one({"date": day}, {"_id": 0})
    if rec and rec.get("submitted"):
        raise HTTPException(status_code=400, detail="Accounting already submitted for today")
    if not rec:
        opening = await _get_opening_balance(day)
        await db.accounting_entries.insert_one({
            "date": day, "opening_balance": opening, "entries": {}, "submitted": False,
        })
    await db.accounting_entries.update_one(
        {"date": day},
        {"$set": {f"entries.{payload.head_id}": float(payload.amount)}},
    )
    return {"ok": True}


@api_router.post("/accounting/submit")
async def submit_accounting(user=Depends(get_current_user)):
    day = today_str()
    rec = await db.accounting_entries.find_one({"date": day}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="No entries to submit")
    await db.accounting_entries.update_one(
        {"date": day},
        {"$set": {
            "submitted": True,
            "submitted_by": user["name"],
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True}


# ============ Chat ============
@api_router.get("/chat/messages", response_model=List[ChatMessageOut])
async def chat_history(limit: int = 50, _=Depends(get_current_user)):
    cursor = db.messages.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    msgs = [m async for m in cursor]
    msgs.reverse()
    return [ChatMessageOut(**m) for m in msgs]


class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: str):
        for ws in list(self.active):
            try:
                await ws.send_text(message)
            except Exception:
                self.disconnect(ws)


manager = ConnectionManager()


@app.websocket("/api/ws/chat")
async def ws_chat(websocket: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return
    user_id = payload["sub"]
    name = payload["name"]
    await manager.connect(websocket)
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
                "id": msg_id,
                "sender_id": user_id,
                "sender_name": name,
                "text": data.get("text"),
                "attachment_base64": data.get("attachment_base64"),
                "attachment_type": data.get("attachment_type"),
                "attachment_content_type": data.get("attachment_content_type"),
                "attachment_filename": data.get("attachment_filename"),
                "created_at": now,
            }
            await db.messages.insert_one(dict(doc))
            await manager.broadcast(json.dumps(doc))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.exception("WebSocket error: %s", e)
        manager.disconnect(websocket)


# ============ Startup: seed admin ============
@app.on_event("startup")
async def seed_admin():
    count = await db.users.count_documents({})
    if count == 0:
        admin_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": admin_id,
            "name": "Admin",
            "name_lower": "admin",
            "pin_hash": hash_pin("1234"),
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded default admin: name='Admin' pin='1234'")


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
