"""Auth utilities and FastAPI dependency callables."""
import os
from datetime import datetime, timezone, timedelta
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from .db import db

JWT_SECRET = os.environ.get("JWT_SECRET", "grocery-store-secret-key-change-in-prod")
JWT_ALG = "HS256"
JWT_EXP_DAYS = 30

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


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
    store = await db.stores.find_one({"id": store_id})
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    if user["role"] == "admin":
        return
    if store_id not in user.get("allowed_stores", []):
        raise HTTPException(status_code=403, detail="No access to this store")
