"""FastAPI entrypoint.  All endpoint logic lives in `routes/`; shared utilities in `core/`."""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from core.db import client, db
from core.deps import hash_pin
from routes import auth, stores, checklists, accounting, chat, inventory, reports


app = FastAPI(
    title="Grocery Store Ops API",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# All HTTP routes live under /api
api_router = APIRouter(prefix="/api")
api_router.include_router(stores.router)
api_router.include_router(auth.router)
api_router.include_router(checklists.router)
api_router.include_router(accounting.router)
api_router.include_router(inventory.router)
api_router.include_router(chat.router)  # /api/chat/messages
api_router.include_router(reports.router)
app.include_router(api_router)

# WebSocket is registered directly on the app — it needs a non-/api prefix
# to match the original path "/api/ws/chat".  We mount the chat router at /api too:
ws_router = APIRouter(prefix="/api")
ws_router.include_router(chat.router)
# Already included above; the @router.websocket decorator works regardless.


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
        await db.account_heads.insert_one({
            "id": str(uuid.uuid4()), "store_id": store_id,
            "name": "Cash", "type": "credit", "is_cash": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded default store: 'Main Store'")

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
