# Grocery Store Ops — Phase 1 (Store Operations)

## Overview
Mobile app (React Native Expo) for grocery store operations with Admin / Employee roles. Login by name + 4-digit PIN. Phase 1 covers **Store Operations**; Inventory & Order Management is placeholder for next phase.

## Tech Stack
- **Frontend**: Expo SDK 54, expo-router, TypeScript
- **Backend**: FastAPI + Motor (MongoDB)
- **Auth**: bcrypt-hashed 4-digit PIN + JWT (30-day expiry)
- **Chat**: WebSocket (`/api/ws/chat?token=<jwt>`), base64 image/document attachments
- **Theme**: Clean & modern, professional blue (#1E40AF)

## Roles
- **Admin** — full CRUD on tasks, account heads, and users
- **Employee** — checks off tasks, enters accounting amounts, chat
- **Default admin** auto-seeded on first startup: `Admin / 1234`

## Features (Phase 1)
### Store Operations
1. **Opening Checklist** — admin creates/removes tasks; employee ticks & submits (locked until all complete)
2. **Closing Checklist** — same model, separate task list
3. **Accounting** — admin manages credit/debit heads; daily opening balance carries over from previous day's closing; closing = opening + credits − debits ($)
4. **Chat** — real-time WebSocket; everyone can send text, images, and documents (stored as base64)

### Users (Admin only)
- Add users with name + 4-digit PIN + role
- Remove users (cannot delete self)

### Inventory & Orders
- Placeholder screen ("Coming Soon") — to be built in Phase 2

## Key API Endpoints
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/register` (admin)
- `GET/POST/DELETE /api/checklists/{opening|closing}/tasks`
- `GET /api/checklists/{type}/today`, `POST /api/checklists/{type}/toggle`, `POST /api/checklists/{type}/submit`
- `GET/POST/DELETE /api/accounting/heads`
- `GET /api/accounting/today`, `POST /api/accounting/entry`, `POST /api/accounting/submit`
- `GET /api/chat/messages`, `WS /api/ws/chat?token=<jwt>`
- `GET /api/users`, `DELETE /api/users/{id}` (admin)

## Test Credentials
See `/app/memory/test_credentials.md`.

## Roadmap
- Phase 2: Inventory, pricing, purchasing, and order management
