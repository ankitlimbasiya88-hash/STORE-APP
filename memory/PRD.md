# Grocery Store Ops — Iteration 2

## Overview
Multi-store grocery operations app (React Native Expo + FastAPI + MongoDB). Roles: Admin / Employee. Login by name + 4-digit PIN. **Phase 1 (Store Operations) complete**; Inventory & Order Management remains the next phase.

## What's new in iteration 2
1. **Multi-store** — admin sees all stores, employees are assigned to one or more stores. Each store has its own tasks, accounting heads, accounting entries, and chat.
2. **Store picker** appears right after login. Stored selection persists across sessions.
3. **PDF reports** — opening checklist, closing checklist, and accounting reports can be downloaded/shared as PDFs (expo-print + expo-sharing).
4. **Historical reports** — Reports screen with a date picker lets you generate PDFs for any past date.
5. **Cash counter modal** — under Credits, a special seeded "Cash" head opens a denominations counter (5¢ / 10¢ / 25¢ / $1 / $2 / $5 / $10 / $50 / $100). Total auto-fills the Cash credit amount.
6. **Employee restriction** — employees see only `total_credit`, `total_debit`, and `net` (credit − debit) in the accounting summary. Opening balance, closing balance, and individual head amounts are hidden.
7. **Per-head options when admin creates an account head**:
   - **Notes box** (`allow_notes`) — adds a small notes field beneath the amount so context can be recorded with each entry.
   - **Multiple entries** (`multiple_entries`) — turns the head into a multi-line list. Admin/employee can add several `{label, note, amount}` items per day; head total is the sum of items. Useful for misc expenses, multiple sales channels, etc.
   - The two options are mutually exclusive in the UI.

## New API endpoints (iter 2.1)
- `POST /api/accounting/entry/set?store_id=…` — body `{head_id, value}`. `value` may be a number, an object `{amount, note}`, or a list of items `[{id, label, note, amount}]`. Replaces the entire stored value for that head.

## Architecture
- **Frontend**: Expo SDK 54, expo-router, TypeScript
- **Backend**: FastAPI + Motor (MongoDB)
- **Auth**: bcrypt-hashed 4-digit PIN + JWT (30-day expiry). Default seed: `Admin / 1234`.
- **Chat**: WebSocket `/api/ws/chat?token=<jwt>&store_id=<id>` — messages broadcast only to clients on the same store.
- **Theme**: Clean & modern, professional blue (#1E40AF)

## Per-store data
- Stores: `{id, name, created_at}` — auto-seeds **"Main Store"** + a **Cash credit head** on first startup
- Users: `{id, name, pin_hash, role, allowed_stores[]}` — admin's `allowed_stores=[]` means all
- Per-store collections: tasks, account_heads, accounting_entries, checklist_submissions, messages — all keyed by `store_id`

## Key API endpoints
- `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/register` (admin), `PUT /api/users/{id}/stores` (admin), `DELETE /api/users/{id}`
- `GET/POST/DELETE /api/stores` (admin)
- `GET/POST/DELETE /api/checklists/{opening|closing}/tasks?store_id=…`
- `GET /api/checklists/{type}/today?store_id=…&date=YYYY-MM-DD`
- `POST /api/checklists/{type}/toggle?store_id=…`, `…/submit?store_id=…`
- `GET/POST/DELETE /api/accounting/heads?store_id=…`
- `GET /api/accounting/today?store_id=…&date=YYYY-MM-DD`
- `POST /api/accounting/entry?store_id=…`, `…/submit?store_id=…`
- `GET /api/chat/messages?store_id=…`, `WS /api/ws/chat?token=…&store_id=…`
- 📘 Swagger UI: `/api/docs`

## Test credentials
See `/app/memory/test_credentials.md`.

## Test status
24/24 backend pytest passing. All frontend flows verified by testing agent (mobile viewport 390×844).

## Roadmap
- Phase 2: Inventory, pricing, purchasing, and order management
- Deployment: Railway (backend) + MongoDB Atlas free tier + sideloaded APK
