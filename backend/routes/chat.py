from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime, timezone
import uuid
import json
import logging

from core.db import db
from core.deps import get_current_user, decode_token, require_store_access

router = APIRouter()
api_router = router

logger = logging.getLogger(__name__)

# ====== Models ======
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

# ====== Routes ======
@api_router.get("/chat/messages", response_model=List[ChatMessageOut])
async def chat_history(store_id: str = Query(...), limit: int = 50, user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    cursor = db.messages.find({"store_id": store_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    msgs = [m async for m in cursor]
    msgs.reverse()
    return [ChatMessageOut(**m) for m in msgs]


# ====== WebSocket ======
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


@router.websocket("/ws/chat")
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

