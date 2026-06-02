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
class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class Task(BaseModel):
    id: str
    store_id: str
    title: str
    type: Literal["opening", "closing"]
    created_at: str


# ====== Routes ======
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


