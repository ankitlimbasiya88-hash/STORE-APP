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
class StoreCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class Store(BaseModel):
    id: str
    name: str
    created_at: str



# ====== Routes ======
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


