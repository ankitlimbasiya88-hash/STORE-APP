"""Backend API tests for Phase 3 polish iter 6.

Validates the Shopping List + Stock Submit "both" purchase_price_type path
after extending Literal["regular","deal"] -> Literal["regular","deal","both"]:

1) POST /api/inventory/shopping-list with purchase_price_type="both" (text item)
   -> 201, response.purchase_price_type == "both".
2) POST /api/inventory/shopping-list with product_id where product.PPT="both"
   and NO purchase_price_type in payload -> inherits "both" verbatim
   (no longer coerced to "regular"/"deal").
3) PATCH /api/inventory/shopping-list/{id} purchase_price_type="both"
   -> 200, returned PPT == "both".
4) POST /api/inventory/stock/submit creates new continuous-list entry with
   PPT == "both" for a product whose PPT == "both".
5) Regression smoke for existing shopping-list endpoints.
6) Invalid PPT value (super-deal) returns 422.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _qs(sid: str) -> str:
    return f"?store_id={sid}"


# ============ Shared fixtures ============

@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"name": "Admin", "pin": "1234"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def store(admin_headers):
    name = f"TEST_BothPPT_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/stores", json={"name": name},
                      headers=admin_headers, timeout=15)
    assert r.status_code == 201, r.text
    s = r.json()
    yield s
    requests.delete(f"{API}/stores/{s['id']}",
                    headers=admin_headers, timeout=15)


@pytest.fixture
def both_product(admin_headers, store):
    """Create a product with purchase_price_type='both'."""
    r = requests.post(
        f"{API}/inventory/products{_qs(store['id'])}",
        json={
            "name": f"TEST_BothProd_{uuid.uuid4().hex[:4]}",
            "company": "BothCo",
            "selling_price": 5.0,
            "purchase_price_type": "both",
        },
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["purchase_price_type"] == "both"
    return p


# ============ 1) Create text-only with PPT=both ============

class TestCreateBothPPT:
    def test_create_text_item_with_ppt_both(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_x_both", "quantity": 1,
                  "purchase_price_type": "both",
                  "purchase_price": 4.5},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["purchase_price_type"] == "both"
        assert d["purchase_price"] == 4.5
        assert d["text"] == "TEST_x_both"
        assert d["status"] == "pending"

    def test_create_text_item_with_ppt_regular_still_works(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_x_reg", "purchase_price_type": "regular"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        assert r.json()["purchase_price_type"] == "regular"

    def test_create_text_item_with_ppt_deal_still_works(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_x_deal", "purchase_price_type": "deal"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        assert r.json()["purchase_price_type"] == "deal"


# ============ 2) Inherits "both" from product when PPT omitted ============

class TestInheritBothFromProduct:
    def test_inherits_both_when_not_provided(self, admin_headers, store, both_product):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"product_id": both_product["id"], "quantity": 2},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["product_id"] == both_product["id"]
        # Now should inherit "both" verbatim (no coercion)
        assert d["purchase_price_type"] == "both", (
            f"expected inherited 'both' from product, got "
            f"{d['purchase_price_type']!r}"
        )

    def test_explicit_payload_ppt_wins_over_product(self, admin_headers, store, both_product):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"product_id": both_product["id"],
                  "purchase_price_type": "deal"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        assert r.json()["purchase_price_type"] == "deal"

    def test_regular_product_inherits_regular(self, admin_headers, store):
        # Sanity: a non-"both" product still inherits its own PPT.
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": f"TEST_RegProd_{uuid.uuid4().hex[:4]}",
                  "company": "Co",
                  "selling_price": 1.0,
                  "purchase_price_type": "regular"},
            headers=admin_headers, timeout=15,
        ).json()
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"product_id": p["id"]},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        assert r.json()["purchase_price_type"] == "regular"


# ============ 3) PATCH PPT to "both" ============

class TestPatchBothPPT:
    def test_patch_ppt_to_both(self, admin_headers, store):
        # Create with regular
        it = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_patch_to_both",
                  "purchase_price_type": "regular"},
            headers=admin_headers, timeout=15,
        ).json()
        assert it["purchase_price_type"] == "regular"
        r = requests.patch(
            f"{API}/inventory/shopping-list/{it['id']}{_qs(store['id'])}",
            json={"purchase_price_type": "both"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["purchase_price_type"] == "both"


# ============ 4) Stock submit preserves "both" ============

class TestStockSubmitBothPPT:
    def test_submit_creates_continuous_entry_with_both(self, admin_headers, store):
        # Create a product with PPT=both AND avg_sales >0 AND max_days >=1
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={
                "name": f"TEST_SubmitBoth_{uuid.uuid4().hex[:4]}",
                "company": "Co",
                "selling_price": 3.0,
                "purchase_price_type": "both",
                "avg_sales": {"quantity": 10, "period_days": 5},
                "max_inventory_days": 7,
            },
            headers=admin_headers, timeout=15,
        )
        assert p.status_code == 201, p.text
        prod = p.json()
        # per_day should be 10/5 == 2
        assert (prod.get("avg_sales") or {}).get("per_day") == 2 or \
               (prod.get("avg_sales") or {}).get("per_day") == 2.0
        # Set on-hand to 0 so submit will create a top-up
        r = requests.post(
            f"{API}/inventory/stock/set{_qs(store['id'])}",
            json={"product_id": prod["id"], "quantity": 0},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        # Submit
        sub = requests.post(
            f"{API}/inventory/stock/submit{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert sub.status_code == 200, sub.text
        assert sub.json()["orders_added"] >= 1
        # Fetch the continuous-list entry for this product
        lst = requests.get(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert lst.status_code == 200
        items = [it for it in lst.json() if it.get("product_id") == prod["id"]]
        assert items, "expected continuous-list entry for the submitted product"
        # Find the inventory-sourced one
        inv_items = [it for it in items if it.get("source") == "inventory"]
        assert inv_items, f"expected inventory-source entry, got: {items}"
        # Verify it preserves "both" PPT verbatim
        assert inv_items[0]["purchase_price_type"] == "both", (
            f"expected 'both' preserved by submit_stock, got "
            f"{inv_items[0]['purchase_price_type']!r}"
        )
        assert inv_items[0]["quantity"] == 14.0  # 2/day * 7 days


# ============ 5) Regression smoke ============

class TestShoppingListsRegression:
    def test_create_and_list_shopping_lists(self, admin_headers, store):
        # POST /api/inventory/shopping-lists (create named list)
        r = requests.post(
            f"{API}/inventory/shopping-lists{_qs(store['id'])}",
            json={"name": f"TEST_list_{uuid.uuid4().hex[:4]}"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        new_list = r.json()
        # GET shopping-lists
        lr = requests.get(
            f"{API}/inventory/shopping-lists{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert lr.status_code == 200
        ids = [l["id"] for l in lr.json()]
        assert new_list["id"] in ids
        # DELETE
        d = requests.delete(
            f"{API}/inventory/shopping-lists/{new_list['id']}{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert d.status_code in (200, 204), d.text

    def test_get_shopping_list_continuous(self, admin_headers, store):
        r = requests.get(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_suppliers_categories_products_smoke(self, admin_headers, store):
        # suppliers
        s = requests.get(
            f"{API}/inventory/suppliers{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert s.status_code == 200
        # categories
        c = requests.get(
            f"{API}/inventory/categories{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert c.status_code == 200
        # products
        p = requests.get(
            f"{API}/inventory/products{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert p.status_code == 200


# ============ 6) Invalid PPT value ============

class TestInvalidPPT:
    def test_create_with_invalid_ppt_returns_422(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_invalid_ppt",
                  "purchase_price_type": "super-deal"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_patch_with_invalid_ppt_returns_422(self, admin_headers, store):
        it = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_for_invalid_patch"},
            headers=admin_headers, timeout=15,
        ).json()
        r = requests.patch(
            f"{API}/inventory/shopping-list/{it['id']}{_qs(store['id'])}",
            json={"purchase_price_type": "super-deal"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 422, r.text
