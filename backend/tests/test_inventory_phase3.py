"""Backend API tests for Grocery Store Inventory — Phase 3.

Covers:
- Suppliers CRUD (+ delete pulls supplier id from products' preferred_supplier_ids)
- Categories CRUD (+ delete unsets category_id on related products)
- Purchase Types CRUD (+ delete pulls id from products' purchase_type_ids)
- Products CRUD (list strips base64 images, GET by id returns full product)
- Barcode uniqueness per store on create AND update (409 conflict)
- Avg sales per_day computation on create/update
- Purchase price history (POST appends entry, DELETE removes; full product returned)
- Search by q (case-insens across name/company/keywords/size/pack_size; numeric matches selling_price)
- Permission: employee (non-admin) gets 403 on POST/PATCH/DELETE for all inventory endpoints
- Validation: 400 on PATCH with empty body, 404 on missing ids
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ============ Shared fixtures ============

@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "1234"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def store(admin_headers):
    """Isolated store for inventory tests (cascades delete to all per-store data)."""
    name = f"TEST_InvStore_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/stores", json={"name": name}, headers=admin_headers, timeout=15)
    assert r.status_code == 201, r.text
    s = r.json()
    yield s
    requests.delete(f"{API}/stores/{s['id']}", headers=admin_headers, timeout=15)


@pytest.fixture(scope="module")
def employee(admin_headers, store):
    """Employee with access to test store."""
    name = f"TEST_emp_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/auth/register",
        json={"name": name, "pin": "5678", "role": "employee", "allowed_stores": [store["id"]]},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    login = requests.post(f"{API}/auth/login", json={"name": name, "pin": "5678"}, timeout=15)
    tok = login.json()["access_token"]
    yield {"id": user["id"], "headers": {"Authorization": f"Bearer {tok}"}}
    requests.delete(f"{API}/users/{user['id']}", headers=admin_headers, timeout=15)


def _qs(store_id: str) -> str:
    return f"?store_id={store_id}"


# ============ Suppliers ============

class TestSuppliers:
    def test_create_supplier_admin(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/suppliers{_qs(store['id'])}",
            json={"name": "TEST_Acme", "contact": "555-1", "notes": "n"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["name"] == "TEST_Acme"
        assert d["store_id"] == store["id"]
        assert "id" in d and "created_at" in d

    def test_list_suppliers_includes_created(self, admin_headers, store):
        r = requests.get(f"{API}/inventory/suppliers{_qs(store['id'])}",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        names = [s["name"] for s in r.json()]
        assert "TEST_Acme" in names

    def test_employee_can_list_suppliers(self, employee, store):
        r = requests.get(f"{API}/inventory/suppliers{_qs(store['id'])}",
                         headers=employee["headers"], timeout=15)
        assert r.status_code == 200

    def test_employee_cannot_create_supplier(self, employee, store):
        r = requests.post(f"{API}/inventory/suppliers{_qs(store['id'])}",
                          json={"name": "TEST_Nope"}, headers=employee["headers"], timeout=15)
        assert r.status_code == 403

    def test_patch_supplier(self, admin_headers, store):
        # Create one fresh
        c = requests.post(f"{API}/inventory/suppliers{_qs(store['id'])}",
                          json={"name": "TEST_Patch"}, headers=admin_headers, timeout=15).json()
        r = requests.patch(f"{API}/inventory/suppliers/{c['id']}{_qs(store['id'])}",
                           json={"contact": "newcontact"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["contact"] == "newcontact"

    def test_patch_supplier_empty_body_returns_400(self, admin_headers, store):
        c = requests.post(f"{API}/inventory/suppliers{_qs(store['id'])}",
                          json={"name": f"TEST_Empty_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.patch(f"{API}/inventory/suppliers/{c['id']}{_qs(store['id'])}",
                           json={}, headers=admin_headers, timeout=15)
        assert r.status_code == 400, r.text

    def test_patch_supplier_404(self, admin_headers, store):
        r = requests.patch(f"{API}/inventory/suppliers/nonexistent{_qs(store['id'])}",
                           json={"contact": "x"}, headers=admin_headers, timeout=15)
        assert r.status_code == 404

    def test_employee_cannot_patch_supplier(self, admin_headers, employee, store):
        c = requests.post(f"{API}/inventory/suppliers{_qs(store['id'])}",
                          json={"name": f"TEST_EmpPatch_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.patch(f"{API}/inventory/suppliers/{c['id']}{_qs(store['id'])}",
                           json={"contact": "x"}, headers=employee["headers"], timeout=15)
        assert r.status_code == 403

    def test_delete_supplier_removes_from_product_preferred(self, admin_headers, store):
        # Create supplier
        sup = requests.post(f"{API}/inventory/suppliers{_qs(store['id'])}",
                            json={"name": f"TEST_DelSup_{uuid.uuid4().hex[:4]}"},
                            headers=admin_headers, timeout=15).json()
        # Create product with that supplier in preferred list
        prod = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_P_{uuid.uuid4().hex[:4]}",
                  "preferred_supplier_ids": [sup["id"]]},
            headers=admin_headers, timeout=15,
        ).json()
        # Verify present
        before = requests.get(f"{API}/inventory/products/{prod['id']}{_qs(store['id'])}",
                              headers=admin_headers, timeout=15).json()
        assert sup["id"] in before["preferred_supplier_ids"]
        # Delete supplier
        r = requests.delete(f"{API}/inventory/suppliers/{sup['id']}{_qs(store['id'])}",
                            headers=admin_headers, timeout=15)
        assert r.status_code == 204, r.text
        # Verify removed from product
        after = requests.get(f"{API}/inventory/products/{prod['id']}{_qs(store['id'])}",
                             headers=admin_headers, timeout=15).json()
        assert sup["id"] not in after["preferred_supplier_ids"]

    def test_employee_cannot_delete_supplier(self, admin_headers, employee, store):
        sup = requests.post(f"{API}/inventory/suppliers{_qs(store['id'])}",
                            json={"name": f"TEST_EmpDel_{uuid.uuid4().hex[:4]}"},
                            headers=admin_headers, timeout=15).json()
        r = requests.delete(f"{API}/inventory/suppliers/{sup['id']}{_qs(store['id'])}",
                            headers=employee["headers"], timeout=15)
        assert r.status_code == 403


# ============ Categories ============

class TestCategories:
    def test_create_and_list_category(self, admin_headers, store):
        r = requests.post(f"{API}/inventory/categories{_qs(store['id'])}",
                          json={"name": "TEST_Snacks"}, headers=admin_headers, timeout=15)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        assert r.json()["kind"] == "category"
        lst = requests.get(f"{API}/inventory/categories{_qs(store['id'])}",
                           headers=admin_headers, timeout=15).json()
        assert any(c["id"] == cid and c["name"] == "TEST_Snacks" for c in lst)

    def test_employee_cannot_create_category(self, employee, store):
        r = requests.post(f"{API}/inventory/categories{_qs(store['id'])}",
                          json={"name": "TEST_Nope"}, headers=employee["headers"], timeout=15)
        assert r.status_code == 403

    def test_patch_category(self, admin_headers, store):
        c = requests.post(f"{API}/inventory/categories{_qs(store['id'])}",
                          json={"name": f"TEST_CatP_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.patch(f"{API}/inventory/categories/{c['id']}{_qs(store['id'])}",
                           json={"name": "TEST_CatRenamed"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_CatRenamed"

    def test_patch_category_404(self, admin_headers, store):
        r = requests.patch(f"{API}/inventory/categories/nope{_qs(store['id'])}",
                           json={"name": "x"}, headers=admin_headers, timeout=15)
        assert r.status_code == 404

    def test_delete_category_unsets_category_id_on_products(self, admin_headers, store):
        cat = requests.post(f"{API}/inventory/categories{_qs(store['id'])}",
                            json={"name": f"TEST_DelCat_{uuid.uuid4().hex[:4]}"},
                            headers=admin_headers, timeout=15).json()
        prod = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_PC_{uuid.uuid4().hex[:4]}", "category_id": cat["id"]},
            headers=admin_headers, timeout=15,
        ).json()
        # Verify set
        before = requests.get(f"{API}/inventory/products/{prod['id']}{_qs(store['id'])}",
                              headers=admin_headers, timeout=15).json()
        assert before["category_id"] == cat["id"]
        # Delete category
        r = requests.delete(f"{API}/inventory/categories/{cat['id']}{_qs(store['id'])}",
                            headers=admin_headers, timeout=15)
        assert r.status_code == 204
        # Verify product.category_id is now None
        after = requests.get(f"{API}/inventory/products/{prod['id']}{_qs(store['id'])}",
                             headers=admin_headers, timeout=15).json()
        assert after["category_id"] is None

    def test_employee_cannot_delete_category(self, admin_headers, employee, store):
        c = requests.post(f"{API}/inventory/categories{_qs(store['id'])}",
                          json={"name": f"TEST_EmpDelC_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.delete(f"{API}/inventory/categories/{c['id']}{_qs(store['id'])}",
                            headers=employee["headers"], timeout=15)
        assert r.status_code == 403


# ============ Purchase Types ============

class TestPurchaseTypes:
    def test_create_and_list_purchase_type(self, admin_headers, store):
        r = requests.post(f"{API}/inventory/purchase-types{_qs(store['id'])}",
                          json={"name": "TEST_Wholesale"}, headers=admin_headers, timeout=15)
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        assert r.json()["kind"] == "purchase_type"
        lst = requests.get(f"{API}/inventory/purchase-types{_qs(store['id'])}",
                           headers=admin_headers, timeout=15).json()
        assert any(t["id"] == pid for t in lst)

    def test_employee_cannot_create_purchase_type(self, employee, store):
        r = requests.post(f"{API}/inventory/purchase-types{_qs(store['id'])}",
                          json={"name": "TEST_Nope"}, headers=employee["headers"], timeout=15)
        assert r.status_code == 403

    def test_patch_purchase_type(self, admin_headers, store):
        c = requests.post(f"{API}/inventory/purchase-types{_qs(store['id'])}",
                          json={"name": f"TEST_PTP_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.patch(f"{API}/inventory/purchase-types/{c['id']}{_qs(store['id'])}",
                           json={"name": "TEST_PTRenamed"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_PTRenamed"

    def test_delete_purchase_type_pulls_from_products(self, admin_headers, store):
        pt = requests.post(f"{API}/inventory/purchase-types{_qs(store['id'])}",
                           json={"name": f"TEST_DelPT_{uuid.uuid4().hex[:4]}"},
                           headers=admin_headers, timeout=15).json()
        prod = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_PT_{uuid.uuid4().hex[:4]}",
                  "purchase_type_ids": [pt["id"]]},
            headers=admin_headers, timeout=15,
        ).json()
        before = requests.get(f"{API}/inventory/products/{prod['id']}{_qs(store['id'])}",
                              headers=admin_headers, timeout=15).json()
        assert pt["id"] in before["purchase_type_ids"]
        r = requests.delete(f"{API}/inventory/purchase-types/{pt['id']}{_qs(store['id'])}",
                            headers=admin_headers, timeout=15)
        assert r.status_code == 204
        after = requests.get(f"{API}/inventory/products/{prod['id']}{_qs(store['id'])}",
                             headers=admin_headers, timeout=15).json()
        assert pt["id"] not in after["purchase_type_ids"]


# ============ Products: CRUD, list-strip, validation ============

class TestProductsCRUD:
    def test_create_product_minimal(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_MinProd_{uuid.uuid4().hex[:4]}"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["store_id"] == store["id"]
        assert d["purchase_prices"] == []
        # avg_sales defaults
        assert d["avg_sales"]["per_day"] == 0

    def test_create_product_with_barcode_and_full_fields(self, admin_headers, store):
        bc = f"BC_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={
                "name": "TEST_FullProd", "barcode": bc, "size": "500g",
                "company": "TestCo", "pack_size": "12",
                "selling_price": 9.99, "tax_pct": 5,
                "keywords": ["foo", "bar"],
            },
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        assert r.json()["barcode"] == bc

    def test_employee_cannot_create_product(self, employee, store):
        r = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": "TEST_EmpProd"}, headers=employee["headers"], timeout=15)
        assert r.status_code == 403

    def test_employee_can_list_products(self, employee, store):
        r = requests.get(f"{API}/inventory/products{_qs(store['id'])}",
                         headers=employee["headers"], timeout=15)
        assert r.status_code == 200

    def test_list_strips_base64_images(self, admin_headers, store):
        # Create product with two base64 image strings
        b64_a = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
        b64_b = b64_a
        prod = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_Imgs_{uuid.uuid4().hex[:4]}",
                  "images": [b64_a, b64_b], "barcode_image": b64_a},
            headers=admin_headers, timeout=15,
        ).json()
        # List view: images stripped, thumbnail + images_count present
        lst = requests.get(f"{API}/inventory/products{_qs(store['id'])}",
                           headers=admin_headers, timeout=15).json()
        item = next(p for p in lst if p["id"] == prod["id"])
        assert item["images"] == []
        assert item["images_count"] == 2
        assert item["thumbnail"] == b64_a
        assert item["barcode_image"] is None
        # GET by id: full images returned
        full = requests.get(f"{API}/inventory/products/{prod['id']}{_qs(store['id'])}",
                            headers=admin_headers, timeout=15).json()
        assert full["images"] == [b64_a, b64_b]
        assert full.get("barcode_image") == b64_a
        assert "purchase_prices" in full

    def test_get_product_404(self, admin_headers, store):
        r = requests.get(f"{API}/inventory/products/nonexistent{_qs(store['id'])}",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 404

    def test_patch_product(self, admin_headers, store):
        p = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": f"TEST_Patch_{uuid.uuid4().hex[:4]}",
                                "selling_price": 1.0},
                          headers=admin_headers, timeout=15).json()
        r = requests.patch(f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
                           json={"selling_price": 7.5}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["selling_price"] == 7.5

    def test_patch_product_empty_body_400(self, admin_headers, store):
        p = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": f"TEST_Empty_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.patch(f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
                           json={}, headers=admin_headers, timeout=15)
        assert r.status_code == 400

    def test_employee_cannot_patch_product(self, admin_headers, employee, store):
        p = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": f"TEST_EP_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.patch(f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
                           json={"selling_price": 2.0}, headers=employee["headers"], timeout=15)
        assert r.status_code == 403

    def test_delete_product(self, admin_headers, store):
        p = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": f"TEST_Del_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.delete(f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
                            headers=admin_headers, timeout=15)
        assert r.status_code == 204
        g = requests.get(f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
                         headers=admin_headers, timeout=15)
        assert g.status_code == 404

    def test_employee_cannot_delete_product(self, admin_headers, employee, store):
        p = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": f"TEST_EmpDelP_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.delete(f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
                            headers=employee["headers"], timeout=15)
        assert r.status_code == 403


# ============ Barcode uniqueness ============

class TestBarcodeUniqueness:
    def test_duplicate_barcode_on_create_returns_409(self, admin_headers, store):
        bc = f"DUP_{uuid.uuid4().hex[:8]}"
        r1 = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                           json={"name": "TEST_BC1", "barcode": bc},
                           headers=admin_headers, timeout=15)
        assert r1.status_code == 201
        r2 = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                           json={"name": "TEST_BC2", "barcode": bc},
                           headers=admin_headers, timeout=15)
        assert r2.status_code == 409, r2.text

    def test_duplicate_barcode_on_update_returns_409(self, admin_headers, store):
        bc1 = f"U1_{uuid.uuid4().hex[:8]}"
        bc2 = f"U2_{uuid.uuid4().hex[:8]}"
        p1 = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                           json={"name": "TEST_U1", "barcode": bc1},
                           headers=admin_headers, timeout=15).json()
        p2 = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                           json={"name": "TEST_U2", "barcode": bc2},
                           headers=admin_headers, timeout=15).json()
        # Try to PATCH p2 to use p1's barcode
        r = requests.patch(f"{API}/inventory/products/{p2['id']}{_qs(store['id'])}",
                           json={"barcode": bc1}, headers=admin_headers, timeout=15)
        assert r.status_code == 409, r.text
        # PATCH same barcode on same product should be fine (no-op uniqueness)
        r2 = requests.patch(f"{API}/inventory/products/{p1['id']}{_qs(store['id'])}",
                            json={"barcode": bc1}, headers=admin_headers, timeout=15)
        assert r2.status_code == 200


# ============ Avg sales ============

class TestAvgSales:
    def test_avg_sales_computed_on_create(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_AS_{uuid.uuid4().hex[:4]}",
                  "avg_sales": {"quantity": 30, "period_days": 10}},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        avg = r.json()["avg_sales"]
        assert avg["quantity"] == 30
        assert avg["period_days"] == 10
        assert avg["per_day"] == 3.0

    def test_avg_sales_zero_days_yields_zero_per_day(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_AS0_{uuid.uuid4().hex[:4]}",
                  "avg_sales": {"quantity": 99, "period_days": 0}},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        assert r.json()["avg_sales"]["per_day"] == 0

    def test_avg_sales_recomputed_on_update(self, admin_headers, store):
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_ASU_{uuid.uuid4().hex[:4]}",
                  "avg_sales": {"quantity": 10, "period_days": 5}},
            headers=admin_headers, timeout=15,
        ).json()
        assert p["avg_sales"]["per_day"] == 2.0
        r = requests.patch(
            f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
            json={"avg_sales": {"quantity": 100, "period_days": 4}},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["avg_sales"]["per_day"] == 25.0


# ============ Purchase price history ============

class TestPurchasePriceHistory:
    def test_add_purchase_price_entry(self, admin_headers, store):
        p = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": f"TEST_PP_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.post(
            f"{API}/inventory/products/{p['id']}/purchase-price{_qs(store['id'])}",
            json={"price": 12.5, "source": "manual", "note": "first"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        prod = r.json()
        assert len(prod["purchase_prices"]) == 1
        entry = prod["purchase_prices"][0]
        assert entry["price"] == 12.5
        assert entry["id"]                       # auto-generated id
        assert entry["date"]                     # auto-generated date
        assert entry["source"] == "manual"

    def test_delete_purchase_price_entry(self, admin_headers, store):
        p = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": f"TEST_PPD_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        # Add 2 entries
        a = requests.post(
            f"{API}/inventory/products/{p['id']}/purchase-price{_qs(store['id'])}",
            json={"price": 5.0}, headers=admin_headers, timeout=15,
        ).json()
        b = requests.post(
            f"{API}/inventory/products/{p['id']}/purchase-price{_qs(store['id'])}",
            json={"price": 7.0}, headers=admin_headers, timeout=15,
        ).json()
        assert len(b["purchase_prices"]) == 2
        target_id = b["purchase_prices"][0]["id"]
        # Delete first one
        r = requests.delete(
            f"{API}/inventory/products/{p['id']}/purchase-price/{target_id}{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        prod = r.json()
        assert len(prod["purchase_prices"]) == 1
        assert all(e["id"] != target_id for e in prod["purchase_prices"])

    def test_employee_cannot_add_purchase_price(self, admin_headers, employee, store):
        p = requests.post(f"{API}/inventory/products{_qs(store['id'])}",
                          json={"name": f"TEST_PPE_{uuid.uuid4().hex[:4]}"},
                          headers=admin_headers, timeout=15).json()
        r = requests.post(
            f"{API}/inventory/products/{p['id']}/purchase-price{_qs(store['id'])}",
            json={"price": 1.0}, headers=employee["headers"], timeout=15,
        )
        assert r.status_code == 403


# ============ Search behaviour ============

class TestProductSearch:
    @pytest.fixture(scope="class")
    def search_store(self, admin_headers):
        name = f"TEST_SearchStore_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/stores", json={"name": name},
                          headers=admin_headers, timeout=15)
        s = r.json()
        # Seed deterministic products
        items = [
            {"name": "Apple Juice", "company": "FreshCo", "size": "1L", "pack_size": "6",
             "keywords": ["beverage"], "selling_price": 3.5, "barcode": "AJ-100"},
            {"name": "Banana Bread", "company": "BakeHouse", "size": "500g", "pack_size": "1",
             "keywords": ["snack"], "selling_price": 4.99, "barcode": "BB-200"},
            {"name": "Carrot Cake", "company": "BakeHouse", "size": "1kg", "pack_size": "1",
             "keywords": ["dessert"], "selling_price": 12.0, "barcode": "CC-300"},
        ]
        for it in items:
            requests.post(f"{API}/inventory/products?store_id={s['id']}",
                          json=it, headers=admin_headers, timeout=15)
        yield s
        requests.delete(f"{API}/stores/{s['id']}", headers=admin_headers, timeout=15)

    def _names(self, lst):
        return sorted([p["name"] for p in lst])

    def test_search_by_name_case_insensitive(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=apple",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        names = self._names(r.json())
        assert names == ["Apple Juice"]

    def test_search_by_company(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=bakehouse",
                         headers=admin_headers, timeout=15)
        names = self._names(r.json())
        assert names == ["Banana Bread", "Carrot Cake"]

    def test_search_by_keyword(self, admin_headers, search_store):
        # User-supplied keywords are discarded (auto-derived). Auto-keywords for
        # Banana Bread (price 4.99) include rounded price "5" — search via that.
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=5",
                         headers=admin_headers, timeout=15)
        names = self._names(r.json())
        assert "Banana Bread" in names

    def test_search_by_size(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=500g",
                         headers=admin_headers, timeout=15)
        names = self._names(r.json())
        assert names == ["Banana Bread"]

    def test_search_by_pack_size(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=6",
                         headers=admin_headers, timeout=15)
        names = self._names(r.json())
        # pack_size matches "6" → Apple Juice. Numeric also matches selling_price=6
        # No product priced at 6.0 exactly, so only Apple Juice expected.
        assert "Apple Juice" in names

    def test_search_numeric_matches_selling_price(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=12",
                         headers=admin_headers, timeout=15)
        names = self._names(r.json())
        # selling_price 12.0 → Carrot Cake
        assert "Carrot Cake" in names

    def test_search_by_barcode(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&barcode=BB-200",
                         headers=admin_headers, timeout=15)
        names = self._names(r.json())
        assert names == ["Banana Bread"]
