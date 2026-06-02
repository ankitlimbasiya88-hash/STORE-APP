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

# ====== Routes ======
class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact: str = ""
    notes: str = ""


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


class Supplier(BaseModel):
    id: str
    store_id: str
    name: str
    contact: str = ""
    notes: str = ""
    created_at: str


class TaxonomyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TaxonomyUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class Taxonomy(BaseModel):
    id: str
    store_id: str
    kind: Literal["category", "purchase_type"]
    name: str
    created_at: str


class PurchasePriceEntry(BaseModel):
    id: str
    date: str
    price: float
    supplier_id: Optional[str] = None
    source: str = "manual"   # manual | shopping | adjustment
    note: str = ""


class PurchasePriceCreate(BaseModel):
    price: float = Field(ge=0)
    date: Optional[str] = None      # ISO date; defaults to today
    supplier_id: Optional[str] = None
    source: str = "manual"
    note: str = ""


class AvgSales(BaseModel):
    quantity: float = 0
    period_days: int = 0
    per_day: float = 0


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    barcode: Optional[str] = None
    size: str = ""
    company: str = ""
    pack_size: str = ""
    category_id: Optional[str] = None
    ideal_profit_margin: float = 0       # %
    selling_price: float = 0
    tax_pct: float = 0
    preferred_supplier_ids: List[str] = []
    images: List[str] = []                # base64 strings
    barcode_image: Optional[str] = None   # base64
    avg_sales: AvgSales = Field(default_factory=AvgSales)
    expiry_sensitivity_days: int = 0
    min_inventory_days: int = 0
    max_inventory_days: int = 0
    purchase_type_ids: List[str] = []
    purchase_price_type: Literal["regular", "deal", "both"] = "regular"
    keywords: List[str] = []


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    barcode: Optional[str] = None
    size: Optional[str] = None
    company: Optional[str] = None
    pack_size: Optional[str] = None
    category_id: Optional[str] = None
    ideal_profit_margin: Optional[float] = None
    selling_price: Optional[float] = None
    tax_pct: Optional[float] = None
    preferred_supplier_ids: Optional[List[str]] = None
    images: Optional[List[str]] = None
    barcode_image: Optional[str] = None
    avg_sales: Optional[AvgSales] = None
    expiry_sensitivity_days: Optional[int] = None
    min_inventory_days: Optional[int] = None
    max_inventory_days: Optional[int] = None
    purchase_type_ids: Optional[List[str]] = None
    purchase_price_type: Optional[Literal["regular", "deal", "both"]] = None
    keywords: Optional[List[str]] = None


class Product(BaseModel):
    id: str
    store_id: str
    name: str
    barcode: Optional[str] = None
    size: str = ""
    company: str = ""
    pack_size: str = ""
    category_id: Optional[str] = None
    ideal_profit_margin: float = 0
    selling_price: float = 0
    tax_pct: float = 0
    preferred_supplier_ids: List[str] = []
    images: List[str] = []
    barcode_image: Optional[str] = None
    purchase_prices: List[PurchasePriceEntry] = []
    avg_sales: AvgSales = Field(default_factory=AvgSales)
    expiry_sensitivity_days: int = 0
    min_inventory_days: int = 0
    max_inventory_days: int = 0
    purchase_type_ids: List[str] = []
    purchase_price_type: str = "regular"
    keywords: List[str] = []
    created_at: str
    updated_at: str


# ---------- Suppliers ----------

@api_router.get("/inventory/suppliers", response_model=List[Supplier])
async def list_suppliers(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    out = []
    async for s in db.suppliers.find({"store_id": store_id}, {"_id": 0}).sort("name", 1):
        out.append(s)
    return out


@api_router.post("/inventory/suppliers", response_model=Supplier, status_code=201)
async def create_supplier(payload: SupplierCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    doc = {
        "id": str(uuid.uuid4()), "store_id": store_id,
        "name": payload.name.strip(), "contact": payload.contact, "notes": payload.notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.suppliers.insert_one(dict(doc))
    return Supplier(**doc)


@api_router.patch("/inventory/suppliers/{sid}", response_model=Supplier)
async def update_supplier(sid: str, payload: SupplierUpdate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.suppliers.update_one({"id": sid, "store_id": store_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    doc = await db.suppliers.find_one({"id": sid}, {"_id": 0})
    return Supplier(**doc)


@api_router.delete("/inventory/suppliers/{sid}", status_code=204)
async def delete_supplier(sid: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.suppliers.delete_one({"id": sid, "store_id": store_id})
    # Remove the supplier id from products' preferred lists
    await db.products.update_many(
        {"store_id": store_id, "preferred_supplier_ids": sid},
        {"$pull": {"preferred_supplier_ids": sid}},
    )
    return Response(status_code=204)


# ---------- Taxonomies (category + purchase-type) ----------

async def _list_taxonomy(store_id: str, kind: str) -> List[dict]:
    out: List[dict] = []
    async for t in db.taxonomies.find({"store_id": store_id, "kind": kind}, {"_id": 0}).sort("name", 1):
        out.append(t)
    return out


@api_router.get("/inventory/categories", response_model=List[Taxonomy])
async def list_categories(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    return await _list_taxonomy(store_id, "category")


@api_router.get("/inventory/purchase-types", response_model=List[Taxonomy])
async def list_purchase_types(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    return await _list_taxonomy(store_id, "purchase_type")


async def _create_taxonomy(store_id: str, kind: str, name: str) -> dict:
    doc = {
        "id": str(uuid.uuid4()), "store_id": store_id, "kind": kind,
        "name": name.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.taxonomies.insert_one(dict(doc))
    return doc


@api_router.post("/inventory/categories", response_model=Taxonomy, status_code=201)
async def create_category(payload: TaxonomyCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    return await _create_taxonomy(store_id, "category", payload.name)


@api_router.post("/inventory/purchase-types", response_model=Taxonomy, status_code=201)
async def create_purchase_type(payload: TaxonomyCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    return await _create_taxonomy(store_id, "purchase_type", payload.name)


@api_router.patch("/inventory/categories/{tid}", response_model=Taxonomy)
async def update_category(tid: str, payload: TaxonomyUpdate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    res = await db.taxonomies.update_one(
        {"id": tid, "store_id": store_id, "kind": "category"},
        {"$set": {"name": payload.name.strip()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    doc = await db.taxonomies.find_one({"id": tid}, {"_id": 0})
    return Taxonomy(**doc)


@api_router.patch("/inventory/purchase-types/{tid}", response_model=Taxonomy)
async def update_purchase_type(tid: str, payload: TaxonomyUpdate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    res = await db.taxonomies.update_one(
        {"id": tid, "store_id": store_id, "kind": "purchase_type"},
        {"$set": {"name": payload.name.strip()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Purchase type not found")
    doc = await db.taxonomies.find_one({"id": tid}, {"_id": 0})
    return Taxonomy(**doc)


@api_router.delete("/inventory/categories/{tid}", status_code=204)
async def delete_category(tid: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.taxonomies.delete_one({"id": tid, "store_id": store_id, "kind": "category"})
    await db.products.update_many({"store_id": store_id, "category_id": tid}, {"$set": {"category_id": None}})
    return Response(status_code=204)


@api_router.delete("/inventory/purchase-types/{tid}", status_code=204)
async def delete_purchase_type(tid: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.taxonomies.delete_one({"id": tid, "store_id": store_id, "kind": "purchase_type"})
    await db.products.update_many({"store_id": store_id, "purchase_type_ids": tid}, {"$pull": {"purchase_type_ids": tid}})
    return Response(status_code=204)


# ---------- Products ----------

def _product_search_filter(store_id: str, q: Optional[str], barcode: Optional[str]) -> dict:
    f: dict = {"store_id": store_id}
    if barcode:
        f["barcode"] = barcode.strip()
        return f
    if q:
        s = q.strip()
        if not s:
            return f
        regex = {"$regex": re.escape(s), "$options": "i"}
        # numeric (selling price) matching
        try:
            num = float(s)
            f["$or"] = [
                {"name": regex}, {"company": regex},
                {"keywords": regex}, {"size": regex}, {"pack_size": regex},
                {"selling_price": num},
            ]
        except Exception:
            f["$or"] = [
                {"name": regex}, {"company": regex},
                {"keywords": regex}, {"size": regex}, {"pack_size": regex},
            ]
    return f


def _strip_images_for_list(p: dict) -> dict:
    """Return product without large image blobs (for list views)."""
    out = dict(p)
    imgs = out.get("images") or []
    out["images_count"] = len(imgs)
    out["thumbnail"] = imgs[0] if imgs else None
    out["images"] = []
    out["barcode_image"] = None
    return out


@api_router.get("/inventory/products")
async def list_products(
    store_id: str = Query(...),
    q: Optional[str] = None,
    barcode: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user),
):
    await require_store_access(user, store_id)
    flt = _product_search_filter(store_id, q, barcode)
    out: List[dict] = []
    async for p in db.products.find(flt, {"_id": 0}).sort("name", 1).limit(limit):
        out.append(_strip_images_for_list(p))
    return out


@api_router.get("/inventory/products/{pid}", response_model=Product)
async def get_product(pid: str, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    p = await db.products.find_one({"id": pid, "store_id": store_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    # Ensure all required default fields
    p.setdefault("purchase_prices", [])
    p.setdefault("avg_sales", {"quantity": 0, "period_days": 0, "per_day": 0})
    return Product(**p)


def _compute_avg_sales(avg: dict | AvgSales | None) -> dict:
    if not avg:
        return {"quantity": 0, "period_days": 0, "per_day": 0}
    if isinstance(avg, AvgSales):
        avg = avg.model_dump()
    qty = float(avg.get("quantity") or 0)
    days = int(avg.get("period_days") or 0)
    per_day = qty / days if days > 0 else 0.0
    return {"quantity": qty, "period_days": days, "per_day": round(per_day, 4)}


def _auto_keywords(name: str, company: str, selling_price: float, category_name: Optional[str] = None) -> List[str]:
    """Build search keywords automatically from product attributes."""
    parts: List[str] = []
    for src in (name or "", company or "", category_name or ""):
        for tok in re.split(r"[^A-Za-z0-9]+", src.lower()):
            if tok and len(tok) >= 2 and tok not in parts:
                parts.append(tok)
    if selling_price:
        parts.append(str(round(float(selling_price), 2)))
        parts.append(str(int(round(float(selling_price)))))
    # dedupe preserving order
    seen = set()
    out: List[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


async def _category_name(store_id: str, category_id: Optional[str]) -> Optional[str]:
    if not category_id:
        return None
    t = await db.taxonomies.find_one({"id": category_id, "store_id": store_id}, {"_id": 0, "name": 1})
    return t["name"] if t else None


@api_router.post("/inventory/products", response_model=Product, status_code=201)
async def create_product(payload: ProductCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    if payload.barcode:
        dup = await db.products.find_one({"store_id": store_id, "barcode": payload.barcode.strip()})
        if dup:
            raise HTTPException(status_code=409, detail="A product with this barcode already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["store_id"] = store_id
    doc["barcode"] = (payload.barcode or "").strip() or None
    doc["purchase_prices"] = []
    doc["avg_sales"] = _compute_avg_sales(payload.avg_sales)
    cat = await _category_name(store_id, payload.category_id)
    doc["keywords"] = _auto_keywords(payload.name, payload.company, payload.selling_price, cat)
    doc["created_at"] = now
    doc["updated_at"] = now
    await db.products.insert_one(dict(doc))
    return Product(**doc)


@api_router.patch("/inventory/products/{pid}", response_model=Product)
async def update_product(pid: str, payload: ProductUpdate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "barcode" in upd and upd["barcode"]:
        upd["barcode"] = upd["barcode"].strip()
        dup = await db.products.find_one({
            "store_id": store_id, "barcode": upd["barcode"], "id": {"$ne": pid},
        })
        if dup:
            raise HTTPException(status_code=409, detail="A product with this barcode already exists")
    if "avg_sales" in upd:
        upd["avg_sales"] = _compute_avg_sales(upd["avg_sales"])
    # Always recompute keywords when name/company/selling_price/category changes
    if any(k in upd for k in ("name", "company", "selling_price", "category_id")):
        existing = await db.products.find_one({"id": pid, "store_id": store_id}, {"_id": 0})
        if existing:
            merged = {**existing, **upd}
            cat = await _category_name(store_id, merged.get("category_id"))
            upd["keywords"] = _auto_keywords(merged.get("name", ""), merged.get("company", ""), merged.get("selling_price", 0), cat)
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.products.update_one({"id": pid, "store_id": store_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    return Product(**p)


@api_router.delete("/inventory/products/{pid}", status_code=204)
async def delete_product(pid: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.products.delete_one({"id": pid, "store_id": store_id})
    return Response(status_code=204)


@api_router.post("/inventory/products/{pid}/purchase-price", response_model=Product)
async def add_purchase_price(pid: str, payload: PurchasePriceCreate, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    p = await db.products.find_one({"id": pid, "store_id": store_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    entry = {
        "id": str(uuid.uuid4()),
        "date": (payload.date or today_str()),
        "price": float(payload.price),
        "supplier_id": payload.supplier_id,
        "source": payload.source or "manual",
        "note": payload.note or "",
    }
    await db.products.update_one(
        {"id": pid, "store_id": store_id},
        {
            "$push": {"purchase_prices": entry},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    return Product(**p)


@api_router.delete("/inventory/products/{pid}/purchase-price/{entry_id}", response_model=Product)
async def delete_purchase_price(pid: str, entry_id: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    res = await db.products.update_one(
        {"id": pid, "store_id": store_id},
        {
            "$pull": {"purchase_prices": {"id": entry_id}},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    return Product(**p)


# ---------- Shopping List ----------

class ShoppingListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ShoppingListRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ShoppingList(BaseModel):
    id: str
    store_id: str
    kind: Literal["continuous", "custom"]
    name: str
    created_at: str
    created_by: str


async def _get_or_create_continuous(store_id: str, user_name: str) -> dict:
    doc = await db.shopping_lists.find_one({"store_id": store_id, "kind": "continuous"}, {"_id": 0})
    if doc:
        return doc
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "store_id": store_id, "kind": "continuous",
        "name": "Continuous List", "created_at": now, "created_by": user_name,
    }
    await db.shopping_lists.insert_one(dict(doc))
    return doc


@api_router.get("/inventory/shopping-lists", response_model=List[ShoppingList])
async def list_shopping_lists(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    await _get_or_create_continuous(store_id, user["name"])  # ensure continuous exists
    out: List[dict] = []
    async for l in db.shopping_lists.find({"store_id": store_id}, {"_id": 0}).sort([("kind", 1), ("created_at", 1)]):
        out.append(l)
    return out


@api_router.post("/inventory/shopping-lists", response_model=ShoppingList, status_code=201)
async def create_custom_shopping_list(payload: ShoppingListCreate, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "store_id": store_id, "kind": "custom",
        "name": payload.name.strip(), "created_at": now, "created_by": user["name"],
    }
    await db.shopping_lists.insert_one(dict(doc))
    return ShoppingList(**doc)


@api_router.patch("/inventory/shopping-lists/{lid}", response_model=ShoppingList)
async def rename_shopping_list(lid: str, payload: ShoppingListRename, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    res = await db.shopping_lists.update_one(
        {"id": lid, "store_id": store_id, "kind": "custom"},
        {"$set": {"name": payload.name.strip()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Custom list not found (continuous list cannot be renamed)")
    doc = await db.shopping_lists.find_one({"id": lid}, {"_id": 0})
    return ShoppingList(**doc)


@api_router.delete("/inventory/shopping-lists/{lid}", status_code=204)
async def delete_custom_shopping_list(lid: str, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    target = await db.shopping_lists.find_one({"id": lid, "store_id": store_id})
    if not target:
        return Response(status_code=204)
    if target.get("kind") == "continuous":
        raise HTTPException(status_code=400, detail="Continuous list cannot be deleted")
    await db.shopping_lists.delete_one({"id": lid, "store_id": store_id})
    await db.shopping_list.delete_many({"list_id": lid, "store_id": store_id})
    return Response(status_code=204)


class ShoppingListItemCreate(BaseModel):
    list_id: Optional[str] = None  # defaults to continuous list
    product_id: Optional[str] = None
    text: str = ""
    quantity: float = 1
    note: str = ""
    supplier_id: Optional[str] = None
    purchase_price_type: Optional[Literal["regular", "deal", "both"]] = None
    purchase_price: Optional[float] = None


class ShoppingListItemUpdate(BaseModel):
    text: Optional[str] = None
    quantity: Optional[float] = None
    note: Optional[str] = None
    status: Optional[Literal["pending", "done"]] = None
    supplier_id: Optional[str] = None
    purchase_price_type: Optional[Literal["regular", "deal", "both"]] = None
    purchase_price: Optional[float] = None


class ShoppingListItem(BaseModel):
    id: str
    store_id: str
    list_id: str
    product_id: Optional[str] = None
    product_name: Optional[str] = None
    text: str = ""
    quantity: float = 1
    note: str = ""
    status: str = "pending"
    supplier_id: Optional[str] = None
    purchase_price_type: Optional[str] = None  # "regular" | "deal" | "both" | None
    purchase_price: Optional[float] = None
    source: str = "manual"                      # manual | inventory
    added_by: str
    created_at: str
    updated_at: str


@api_router.get("/inventory/shopping-list", response_model=List[ShoppingListItem])
async def list_shopping_items(
    store_id: str = Query(...),
    list_id: Optional[str] = None,
    status: Optional[str] = None,
    user=Depends(get_current_user),
):
    await require_store_access(user, store_id)
    cont = await _get_or_create_continuous(store_id, user["name"])
    flt: dict = {"store_id": store_id, "list_id": list_id or cont["id"]}
    if status:
        flt["status"] = status
    out: List[dict] = []
    async for it in db.shopping_list.find(flt, {"_id": 0}).sort("created_at", -1):
        out.append(it)
    return out


@api_router.post("/inventory/shopping-list", response_model=ShoppingListItem, status_code=201)
async def create_shopping_item(payload: ShoppingListItemCreate, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    if not payload.product_id and not (payload.text or "").strip():
        raise HTTPException(status_code=400, detail="Provide a product_id or text")
    cont = await _get_or_create_continuous(store_id, user["name"])
    list_id = payload.list_id or cont["id"]
    # validate list belongs to this store
    lst = await db.shopping_lists.find_one({"id": list_id, "store_id": store_id})
    if not lst:
        raise HTTPException(status_code=404, detail="Shopping list not found")
    product_name: Optional[str] = None
    purchase_price_type = payload.purchase_price_type
    if payload.product_id:
        p = await db.products.find_one({"id": payload.product_id, "store_id": store_id}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Product not found")
        product_name = p["name"]
        if purchase_price_type is None:
            purchase_price_type = p.get("purchase_price_type", "regular")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "store_id": store_id, "list_id": list_id,
        "product_id": payload.product_id, "product_name": product_name,
        "text": (payload.text or "").strip(), "quantity": float(payload.quantity or 1),
        "note": payload.note or "", "status": "pending",
        "supplier_id": payload.supplier_id,
        "purchase_price_type": purchase_price_type,
        "purchase_price": payload.purchase_price,
        "source": "manual",
        "added_by": user["name"],
        "created_at": now, "updated_at": now,
    }
    await db.shopping_list.insert_one(dict(doc))
    return ShoppingListItem(**doc)


@api_router.patch("/inventory/shopping-list/{iid}", response_model=ShoppingListItem)
async def update_shopping_item(iid: str, payload: ShoppingListItemUpdate, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    upd = payload.model_dump(exclude_unset=True)  # keep None values too (for clearing)
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.shopping_list.update_one({"id": iid, "store_id": store_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await db.shopping_list.find_one({"id": iid}, {"_id": 0})
    return ShoppingListItem(**doc)


@api_router.delete("/inventory/shopping-list/{iid}", status_code=204)
async def delete_shopping_item(iid: str, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    item = await db.shopping_list.find_one({"id": iid, "store_id": store_id})
    if not item:
        return Response(status_code=204)
    if user["role"] != "admin" and item.get("added_by") != user["name"]:
        raise HTTPException(status_code=403, detail="Only the admin or the original adder can delete this item")
    await db.shopping_list.delete_one({"id": iid, "store_id": store_id})
    return Response(status_code=204)


# ---------- Inventory Counts (Milestone B) ----------

class InventoryCount(BaseModel):
    id: str
    store_id: str
    product_id: str
    quantity: float = 0
    updated_at: str
    updated_by: str


class InventoryIncrement(BaseModel):
    product_id: str
    delta: float = 1


class InventorySet(BaseModel):
    product_id: str
    quantity: float = 0


@api_router.get("/inventory/stock")
async def list_stock(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    rows: List[dict] = []
    async for r in db.inventory_counts.find({"store_id": store_id}, {"_id": 0}):
        rows.append(r)
    # join with product names for display
    pids = [r["product_id"] for r in rows]
    products = {}
    if pids:
        async for p in db.products.find({"store_id": store_id, "id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1, "company": 1, "size": 1, "barcode": 1, "selling_price": 1}):
            products[p["id"]] = p
    return [{**r, "product": products.get(r["product_id"])} for r in rows]


async def _upsert_count(store_id: str, product_id: str, value: float, mode: Literal["inc", "set"], user_name: str) -> dict:
    # ensure product exists
    p = await db.products.find_one({"id": product_id, "store_id": store_id}, {"_id": 0, "id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    now = datetime.now(timezone.utc).isoformat()
    if mode == "set":
        await db.inventory_counts.update_one(
            {"store_id": store_id, "product_id": product_id},
            {"$set": {"quantity": float(value), "updated_at": now, "updated_by": user_name},
             "$setOnInsert": {"id": str(uuid.uuid4()), "store_id": store_id, "product_id": product_id}},
            upsert=True,
        )
    else:  # inc
        await db.inventory_counts.update_one(
            {"store_id": store_id, "product_id": product_id},
            {"$inc": {"quantity": float(value)},
             "$set": {"updated_at": now, "updated_by": user_name},
             "$setOnInsert": {"id": str(uuid.uuid4()), "store_id": store_id, "product_id": product_id}},
            upsert=True,
        )
    doc = await db.inventory_counts.find_one({"store_id": store_id, "product_id": product_id}, {"_id": 0})
    return doc


@api_router.post("/inventory/stock/increment")
async def increment_stock(payload: InventoryIncrement, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    return await _upsert_count(store_id, payload.product_id, payload.delta, "inc", user["name"])


@api_router.post("/inventory/stock/set")
async def set_stock(payload: InventorySet, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    return await _upsert_count(store_id, payload.product_id, payload.quantity, "set", user["name"])


@api_router.post("/inventory/stock/reset")
async def reset_stock(store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    res = await db.inventory_counts.delete_many({"store_id": store_id})
    return {"reset_count": res.deleted_count}


@api_router.post("/inventory/stock/submit")
async def submit_stock(store_id: str = Query(...), user=Depends(get_current_user)):
    """Compute required order quantity for each product where on-hand qty is
    below the configured max_inventory_days × per-day sales. Top-up replaces
    any existing continuous-list entry for that product (per user choice 1.a)."""
    await require_store_access(user, store_id)
    cont = await _get_or_create_continuous(store_id, user["name"])
    counts = {r["product_id"]: float(r.get("quantity", 0))
              async for r in db.inventory_counts.find({"store_id": store_id}, {"_id": 0, "product_id": 1, "quantity": 1})}
    suggestions: List[dict] = []
    async for p in db.products.find({"store_id": store_id}, {"_id": 0}):
        per_day = float(((p.get("avg_sales") or {}).get("per_day")) or 0)
        max_days = int(p.get("max_inventory_days") or 0)
        target = per_day * max_days
        on_hand = counts.get(p["id"], 0.0)
        if target <= 0:
            continue
        deficit = target - on_hand
        if deficit <= 0.0001:
            continue
        order_qty = max(1, int(math.ceil(deficit)))
        suggestions.append({"product_id": p["id"], "name": p["name"], "quantity": order_qty, "purchase_price_type": p.get("purchase_price_type", "regular")})
    # Apply "top up to max" — replace existing continuous-list entry for same product
    now = datetime.now(timezone.utc).isoformat()
    written = 0
    for s in suggestions:
        existing = await db.shopping_list.find_one({
            "store_id": store_id, "list_id": cont["id"], "product_id": s["product_id"], "status": "pending",
        })
        ppt = s["purchase_price_type"] if s["purchase_price_type"] in ("regular", "deal", "both") else "regular"
        if existing:
            await db.shopping_list.update_one(
                {"id": existing["id"]},
                {"$set": {"quantity": s["quantity"], "source": "inventory", "updated_at": now,
                          "purchase_price_type": existing.get("purchase_price_type") or ppt}},
            )
        else:
            await db.shopping_list.insert_one({
                "id": str(uuid.uuid4()), "store_id": store_id, "list_id": cont["id"],
                "product_id": s["product_id"], "product_name": s["name"],
                "text": "", "quantity": s["quantity"], "note": "",
                "status": "pending", "supplier_id": None,
                "purchase_price_type": ppt, "purchase_price": None,
                "source": "inventory", "added_by": user["name"],
                "created_at": now, "updated_at": now,
            })
        written += 1
    return {"orders_added": written, "list_id": cont["id"]}


# ============ Shopped Records (executed shopping batches) ============
class ShoppedRecord(BaseModel):
    id: str
    store_id: str
    batch_id: str
    list_id: Optional[str] = None
    list_name: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    product_id: Optional[str] = None
    product_name: Optional[str] = None
    text: str = ""
    quantity: int
    purchase_price_type: Literal["regular", "deal", "both"] = "regular"
    purchase_price: float = 0
    tax_pct: float = 0
    line_total: float = 0
    tax_amount: float = 0
    total_with_tax: float = 0
    note: str = ""
    shopped_at: datetime
    shopped_by: str
    source_item_id: Optional[str] = None


class ExecuteShoppedItem(BaseModel):
    item_id: str                       # source shopping_list item id
    quantity: int
    purchase_price: float = 0
    purchase_price_type: Literal["regular", "deal", "both"] = "regular"
    supplier_id: Optional[str] = None
    note: str = ""


class ExecuteShoppingPayload(BaseModel):
    list_id: Optional[str] = None
    items: List[ExecuteShoppedItem]


@api_router.post("/inventory/shopping/execute")
async def execute_shopping(
    payload: ExecuteShoppingPayload,
    store_id: str = Query(...),
    user=Depends(get_current_user),
):
    """Move selected shopping-list items to permanent shopped_records collection.
    Source items are deleted from shopping_list (moved semantics)."""
    await require_store_access(user, store_id)
    if not payload.items:
        return {"batch_id": None, "count": 0, "total": 0}

    batch_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # cache lookups
    sup_cache: Dict[str, str] = {}
    list_name_cache: Dict[str, str] = {}

    async def supplier_name(sid: Optional[str]) -> Optional[str]:
        if not sid:
            return None
        if sid in sup_cache:
            return sup_cache[sid]
        s = await db.suppliers.find_one({"id": sid, "store_id": store_id}, {"_id": 0, "name": 1})
        n = s["name"] if s else None
        sup_cache[sid] = n
        return n

    async def list_name(lid: Optional[str]) -> Optional[str]:
        if not lid:
            return None
        if lid in list_name_cache:
            return list_name_cache[lid]
        l = await db.shopping_lists.find_one({"id": lid, "store_id": store_id}, {"_id": 0, "name": 1})
        n = l["name"] if l else None
        list_name_cache[lid] = n
        return n

    records = []
    total_amount = 0.0
    item_ids_to_remove: List[str] = []

    for ip in payload.items:
        item = await db.shopping_list.find_one({"id": ip.item_id, "store_id": store_id}, {"_id": 0})
        if not item:
            continue

        product_name = item.get("product_name") or item.get("text") or ""
        tax_pct = 0.0
        product_id = item.get("product_id")
        if product_id:
            p = await db.products.find_one({"id": product_id, "store_id": store_id}, {"_id": 0, "name": 1, "tax_pct": 1})
            if p:
                tax_pct = float(p.get("tax_pct") or 0)
                product_name = p["name"]

        qty = max(0, int(round(ip.quantity)))
        price = float(ip.purchase_price or 0)
        line_total = qty * price
        tax_amount = line_total * tax_pct / 100.0
        total_with_tax = line_total + tax_amount

        sup_id = ip.supplier_id if ip.supplier_id is not None else item.get("supplier_id")
        rec = {
            "id": str(uuid.uuid4()),
            "store_id": store_id,
            "batch_id": batch_id,
            "list_id": item.get("list_id"),
            "list_name": await list_name(item.get("list_id")),
            "supplier_id": sup_id,
            "supplier_name": await supplier_name(sup_id),
            "product_id": product_id,
            "product_name": product_name,
            "text": item.get("text", ""),
            "quantity": qty,
            "purchase_price_type": ip.purchase_price_type,
            "purchase_price": money_round(price),
            "tax_pct": tax_pct,
            "line_total": money_round(line_total),
            "tax_amount": money_round(tax_amount),
            "total_with_tax": money_round(total_with_tax),
            "note": ip.note or item.get("note", ""),
            "shopped_at": now,
            "shopped_by": user["name"],
            "source_item_id": item["id"],
        }
        records.append(rec)
        total_amount += total_with_tax
        item_ids_to_remove.append(item["id"])

    if records:
        await db.shopped_records.insert_many([dict(r) for r in records])
        await db.shopping_list.delete_many({"id": {"$in": item_ids_to_remove}, "store_id": store_id})

    return {
        "batch_id": batch_id,
        "count": len(records),
        "total_amount": money_round(total_amount),
    }


@api_router.get("/inventory/shopped", response_model=List[ShoppedRecord])
async def list_shopped_records(
    store_id: str = Query(...),
    supplier_id: Optional[str] = None,
    days: int = 90,
    limit: int = 1000,
    user=Depends(get_current_user),
):
    """List shopped records sorted newest-first."""
    await require_store_access(user, store_id)
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    q: Dict[str, Any] = {"store_id": store_id, "shopped_at": {"$gte": cutoff}}
    if supplier_id:
        q["supplier_id"] = supplier_id
    cursor = db.shopped_records.find(q, {"_id": 0}).sort("shopped_at", -1).limit(limit)
    return [ShoppedRecord(**doc) async for doc in cursor]


@api_router.get("/inventory/shopped/batch/{batch_id}", response_model=List[ShoppedRecord])
async def get_shopped_batch(batch_id: str, store_id: str = Query(...), user=Depends(get_current_user)):
    await require_store_access(user, store_id)
    cursor = db.shopped_records.find({"batch_id": batch_id, "store_id": store_id}, {"_id": 0}).sort("shopped_at", 1)
    return [ShoppedRecord(**doc) async for doc in cursor]


@api_router.delete("/inventory/shopped/{record_id}", status_code=204)
async def delete_shopped_record(record_id: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.shopped_records.delete_one({"id": record_id, "store_id": store_id})
    return Response(status_code=204)


@api_router.delete("/inventory/shopped/batch/{batch_id}", status_code=204)
async def delete_shopped_batch(batch_id: str, store_id: str = Query(...), user=Depends(require_admin)):
    await require_store_access(user, store_id)
    await db.shopped_records.delete_many({"batch_id": batch_id, "store_id": store_id})
    return Response(status_code=204)



