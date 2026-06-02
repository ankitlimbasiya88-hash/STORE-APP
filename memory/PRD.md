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

## Shopping List polish (iter 3.1.1)
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
