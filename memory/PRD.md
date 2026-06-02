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

## Reports screen (iter 2.2)
- Inline preview for any selected date — shows Opening, Closing, and Accounting summary cards before downloading.
- Admin sees per-head detail: notes inline, and multi-entry heads expand into a sub-panel listing each `{label, note, amount}` item.
- All header / section buttons carry text labels next to icons (Back, Download Opening/Closing/Accounting PDF) so the screen remains usable even if vector icons fail to load on Expo Go.
- Pull-to-refresh re-fetches data for the picked date.
- PDF report styling: multi-entry head shows banner row + indented bullet items + italicized notes + subtotal row; entry count shown beside head name.

## Font-free icons (iter 2.3)
- Added `/app/frontend/src/components/AppIcon.tsx` — a tiny icon library built from plain `<View>` borders (chevrons, plus, close, check, download, calendar, sun, moon, trash, cash). No font dependency = guaranteed to render on Expo Go even when `@expo/vector-icons` fails to load Ionicons.
- Replaced 35+ `<Ionicons />` usages across 10 screens with `<AppIcon />`, prioritizing navigation (back, forward), action buttons (add, close, trash, download, calendar), and indicators (check, sun, moon).
- Decorative-only Ionicons (storefront, business, cube, calculator etc.) kept as-is since they sit next to text labels.

## Phase 3 — Inventory module (iter 3.0)
Cash Accounting label finalised. New "Inventory & Orders" module with **4-tab structure**:
1. **Products** — admin can CRUD; employees read-only
2. **Inventory** — view stock per product (placeholder for next milestone)
3. **Shopping List** — admin manages, employees can check (next milestone)
4. **Shopping** — admin records purchases that auto-update stock + price history (admin-only, next milestone)

### Milestone A delivered
- Products list with search (name / company / keywords / size / pack size / price) + barcode-scan button using `expo-camera`. Scanner returns to Inventory; if barcode matches → opens product, else "Product not in system" with Add prompt.
- Suppliers admin screen (add/edit/delete + supplier removed from products on delete)
- Categories + Purchase Types admin screen (combined "Lists")
- Full Product create/edit form with: 2-3 pictures + barcode photo (base64 in Mongo), Name, Size, Company, Pack size, Category (single-select), Ideal margin %, Selling price, Tax %, multi-select preferred Suppliers, Purchase Price History (sorted low→high, with lowest/highest/latest stats, add/remove entries), Average Sales (qty + days → server-computed per-day), Expiry sensitivity days, Min/Max inventory days, multi-select Purchase Types, Keywords.
- Camera + photo permissions declared in `app.json` (iOS infoPlist + Android permissions).

### Backend
- 14 new endpoints under `/api/inventory/*` (suppliers, categories, purchase-types, products, products/{id}/purchase-price)
- Cascading delete: removing a supplier/category/purchase-type pulls/unsets the reference from products
- Products list endpoint strips base64 blobs (returns `thumbnail` + `images_count`) for fast lists; GET-by-id returns full payload
- Per-day sales computed server-side from `{quantity, period_days}`
- Barcode uniqueness enforced per-store (409 on conflict)

### Notes flagged by testing agent (deferred)
- `delete_store` doesn't cascade to inventory collections — orphans possible. Address in Phase 4 cleanup.
- `server.py` now 1268 lines — split into per-feature routers in Phase 4.

### Coming next (Milestone B+)
- Inventory stock tracking screen
- Shopping List screen UI (backend is now live ✅)
- Shopping screen (admin records actual purchases — auto-updates stock + adds to purchase_prices history)

## Shopping List / Shopping polish + CSV export (iter 3.3.1)
- **Search bar** added to both Shopping List and Shopping tabs (full-width input matching the Products tab pattern, with clear-X button).
- **Category sort dropdown** added next to the Supplier filter on both tabs (loads `/api/inventory/categories`; supports "All", "Uncategorized", and each category).
- **Shopping tab supplier dropdown fixed** — per-row supplier is now a tappable `SupplierPickerInline` (modal with same look/feel as Shopping List), no longer a passive label.
- **CSV export** added everywhere PDF lives:
  - Shopping List: header has PDF + CSV side by side
  - Shopped History: each batch card now exposes PDF + **CSV** + Delete (admin only)
  - Reports Dashboard: header has PDF + CSV side by side (multi-section CSV: period, accounting totals, by-head, by-day, shopping totals, by-supplier, by-month)
- New shared utility `/app/frontend/src/utils/csv.ts` with `buildCsv()`, `buildMultiCsv()`, and `shareCsv()` (Web → Blob download with UTF-8 BOM; native → cache file + share sheet via `expo-sharing`).
### Refactor — `server.py` split into modules
- `server.py` shrunk **1825 → 93 lines** (slim entrypoint: app, CORS, router registration, startup seed).
- New layout:
  ```
  /app/backend/
    core/
      db.py        Mongo client + db handle
      deps.py      JWT, bcrypt, get_current_user, require_admin, require_store_access
      helpers.py   money_round, today_str, now_utc, entry_total
    routes/
      auth.py        /auth/* + /users/*
      stores.py      /stores/*
      checklists.py  /checklists/*
      accounting.py  /accounting/*
      inventory.py   /inventory/*  (1000 lines — biggest single domain)
      chat.py        /chat/messages + WS /ws/chat
      reports.py     /reports/*    (NEW)
  ```
- Legacy monolith preserved at `/app/backend/server_legacy.py.bak`.
- Endpoint paths, payloads, and responses are byte-for-byte identical to before.

### New — Reports dashboard
Backend `GET /api/reports/summary?store_id=&date_from=&date_to=`:
- Defaults to current month → today
- Aggregates **Cash Accounting** (credit_total / debit_total / net + by_head + by_day + days_with_entries)
- Aggregates **Shopping spend** from `shopped_records` (total_spent + total_tax + batches + items + by_supplier + by_month)
- Employees see `accounting: {hidden: true}` — cash totals never leak to non-admins
- Tolerant: swaps reversed date ranges, validates store access

Frontend `/operations/summary` screen:
- 5 quick presets: This month · Last month · Last 30 · Last 90 · YTD
- Custom from/to date pickers (iOS modal spinner / Android native)
- **Cash Accounting** card: Credit / Debit / Net KPI tiles + green/red bars per head
- **Shopping Spend** card: Total / Tax / Items+Batches KPIs + orange bars per supplier + sky-blue bars per month
- Header **PDF** button → calls new `buildReportsSummaryHtml()` for a clean print-friendly export

### Tests
**144/144 PASS** (8 new Reports tests + 136 regression).
### Backend (`server.py`)
- New collection: **`shopped_records`** (permanent history of executed shopping batches).
- New endpoints:
  - `POST /api/inventory/shopping/execute` — atomically moves selected `shopping_list` items into `shopped_records` with snapshotted product `tax_pct`, computed line_total / tax_amount / total_with_tax. Source items are deleted (move semantics). Inventory counts are **NOT** modified (per user spec).
  - `GET /api/inventory/shopped?days=&supplier_id=` — list, newest first.
  - `GET /api/inventory/shopped/batch/{batch_id}` — single batch.
  - `DELETE /api/inventory/shopped/{record_id}` (admin) — undo one row.
  - `DELETE /api/inventory/shopped/batch/{batch_id}` (admin) — undo full batch.
- Helper `money_round()` uses `Decimal` + `ROUND_HALF_UP` for accurate currency math (replaces banker's-rounding `round(x, 2)`).

### Frontend
- **`Shopping` tab** (4th tab in `/inventory`):
  - List switcher + supplier filter + Select-all/Clear.
  - Per-row: checkbox · thumbnail · name · tax label · Qty · Price (cents-style PriceInput) · supplier · live **line total incl tax**.
  - Sticky bottom bar shows total count + subtotal + tax + grand total, with **Submit** button → confirmation alert → POST `/shopping/execute`.
- **`/inventory/shopped` screen** (linked via the History button in Shopping tab):
  - Batches grouped by `batch_id × supplier_id`, sorted newest-first.
  - Tap a batch → expand to see each item with qty × price · tax · line total.
  - Per-batch actions: **PDF** (Share/Print via new `buildShoppedHtml`) and **Delete batch** (admin only).
  - Supplier filter modal.

### Tests
- `/app/backend/tests/test_shopped_records.py` — **7/7 PASS** (happy path with 8.5% tax, multi-item batch, text-only items, admin-only delete, validation, batch sort).
- 59/59 prior tests still passing (ceiling + both-PPT + Phase 5 + accounting v3).

### Icons
- `AppIcon` gained `clock`, `filter`, `cart` glyphs (drawn from primitive Views, no font dependency).
- New shared `<PriceInput>` component (`/app/frontend/src/components/PriceInput.tsx`) with **cents-style entry**:
  - Each digit typed counts as 1 cent — type `299` → displays `$2.99`; `12345` → `$123.45`; `1` → `$0.01`.
  - Backspace removes one digit at a time. `keyboardType="number-pad"` (no decimal key needed).
- Adopted in:
  - Shopping List row → price column (auto-decimal).
  - Product form → Selling Price, and the Purchase Price entry modal.
  - Cash Accounting → single-amount input on every head + multi-entry amount input.
- **Quantities are now integer-only** in the Shopping List & Inventory tabs:
  - Both inputs use `keyboardType="number-pad"` and strip everything but digits.
  - Display rounds existing decimal qtys (`Math.round`) so leftover `55.53` values render as `56`.
  - Backend `submit_stock` now writes `max(1, ceil(deficit))` instead of `round(deficit, 4)` so newly generated continuous-list rows are always whole units (e.g. per_day=1.43, max_days=4 → qty=6).

Backend tests: **59/59 passing** (5 new submit-stock-ceiling + 13 both-PPT + 27 phase 5 regression + 14 accounting v3).
- Shopping List row redesigned for clarity & one-handed use:
  - 44×44 product thumbnail (base64 from `/api/inventory/products?...` thumbnail) on the left, falls back to first letter
  - Labeled fields: **QTY · SUPPLIER · PURCHASE PRICE TYPE · PRICE · NOTES**
  - Inline **Notes** textarea on every row (no more shrunken extra row)
  - Purchase Price Type dropdown now has **3 options**: Regular / Deal / **Both (regular + deal)**
  - Highlighted background per type — Regular = neutral, Deal = amber, Both = light blue
- Dropdown modals fixed: inner box wrapped in a tap-swallowing TouchableOpacity so taps inside the modal no longer close it accidentally.
- Backend `ShoppingListItemCreate.purchase_price_type` and `ShoppingListItemUpdate.purchase_price_type` now accept `Literal["regular","deal","both"]`. `submit_stock` and `create_shopping_item` preserve the product's PPT verbatim (no longer coerced down to regular/deal).
- PDF report (`buildShoppingHtml`) now prints "Both" label when applicable.

Backend test status: **40/40 passing** (13 new + 27 phase 5 regression).

1. **Auto-generated barcode image** — admin no longer needs to capture a camera photo of the barcode. Once a barcode value is entered/scanned, a scannable Code128 barcode is rendered (via `react-native-svg` and a small JS Code128 encoder) and shown alongside product photos in the gallery.
2. **Read-only product detail page (`product/[id]/index.tsx`)** — opens by default on tap/scan with a "Modify" button (admin only) leading to the editable form at `product/[id]/edit.tsx`.
3. **Keywords auto-derived on backend** — manual keywords field removed from UI. Server computes keywords from name + company + selling_price (numeric and float forms) + category name on every create/update.
4. **AppIcon chevron rotations fixed** — `down` and `up` were swapped; dropdowns now correctly show ▾.
5. **Suppliers button** moved inline next to Categories (no longer in the header).
6. **Shopping List backend live** — `GET/POST/PATCH/DELETE /api/inventory/shopping-list`. Employees can add/check own items; admin can manage all. Product detail screen has an "Add to Shopping List" button that adds the current product as a pending item.

New dependencies: `react-native-svg` (Expo-compat) for SVG barcode rendering. Pure-JS Code128 encoder at `/app/frontend/src/utils/code128.ts` (no external lib).

Backend test count: 111/111 passing (84 regression + 27 new).

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
