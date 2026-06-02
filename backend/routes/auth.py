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



# ====== Routes ======
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


