"""Backend API tests for Phase 3 polish iteration (iter 5).

Covers:
- POST /api/inventory/products: server auto-derives `keywords` from
  name + company + selling_price + category name (when category_id provided).
  Client-supplied keywords MUST be discarded.
- PATCH /api/inventory/products/{id}: keywords recomputed when
  name/company/selling_price/category_id changes. Untouched when only
  unrelated fields (size, pack_size) change.
- GET /api/inventory/products?q=<token> still matches via auto-derived keywords.
- POST /api/inventory/shopping-list (all roles): 400 if neither text nor
  product_id; 404 if product_id unknown; product_name populated; added_by
  populated; status defaults pending.
- GET /api/inventory/shopping-list (all roles), supports ?status filter,
  sorted by created_at desc.
- PATCH /api/inventory/shopping-list/{id}: any role, 404 on unknown.
- DELETE /api/inventory/shopping-list/{id}: admin deletes any item;
  employee can only delete items they themselves added (403 otherwise);
  idempotent 204 when id doesn't exist.
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
    name = f"TEST_KwStore_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/stores", json={"name": name}, headers=admin_headers, timeout=15)
    assert r.status_code == 201, r.text
    s = r.json()
    yield s
    requests.delete(f"{API}/stores/{s['id']}", headers=admin_headers, timeout=15)


@pytest.fixture(scope="module")
def employee(admin_headers, store):
    name = f"TEST_kemp_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/auth/register",
        json={"name": name, "pin": "5678", "role": "employee", "allowed_stores": [store["id"]]},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    login = requests.post(f"{API}/auth/login", json={"name": name, "pin": "5678"}, timeout=15)
    tok = login.json()["access_token"]
    yield {"id": user["id"], "name": name,
           "headers": {"Authorization": f"Bearer {tok}"}}
    requests.delete(f"{API}/users/{user['id']}", headers=admin_headers, timeout=15)


@pytest.fixture(scope="module")
def employee_b(admin_headers, store):
    """A second employee to verify cross-user delete is forbidden."""
    name = f"TEST_kempB_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/auth/register",
        json={"name": name, "pin": "5678", "role": "employee", "allowed_stores": [store["id"]]},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    login = requests.post(f"{API}/auth/login", json={"name": name, "pin": "5678"}, timeout=15)
    tok = login.json()["access_token"]
    yield {"id": user["id"], "name": name,
           "headers": {"Authorization": f"Bearer {tok}"}}
    requests.delete(f"{API}/users/{user['id']}", headers=admin_headers, timeout=15)


def _qs(sid: str) -> str:
    return f"?store_id={sid}"


# ============ Keywords auto-derivation on CREATE ============

class TestAutoKeywordsCreate:
    def test_basic_tokens_from_name_company_and_price(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "Whole Milk", "company": "Dairy Co", "selling_price": 2.99},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        kws = r.json()["keywords"]
        # lowercased tokens
        for t in ("whole", "milk", "dairy", "co"):
            assert t in kws, f"expected token '{t}' in {kws}"
        # numeric price tokens (rounded both ways)
        assert "2.99" in kws
        assert "3" in kws

    def test_client_keywords_are_discarded(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "Apple Pie", "company": "BakeCo", "selling_price": 5.0,
                  "keywords": ["spam_input_keyword", "another_one"]},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        kws = r.json()["keywords"]
        assert "spam_input_keyword" not in kws
        assert "another_one" not in kws
        # auto-derived tokens present instead
        assert "apple" in kws and "pie" in kws and "bakeco" in kws

    def test_keywords_lowercased_min_length_and_dedup(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "AAA BBB AAA", "company": "AAA", "selling_price": 1.0},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        kws = r.json()["keywords"]
        # all lowercased
        assert all(k == k.lower() for k in kws)
        # AAA repeated only once (lowercased dedup)
        assert kws.count("aaa") == 1
        assert "bbb" in kws

    def test_keywords_include_category_name(self, admin_headers, store):
        cat = requests.post(
            f"{API}/inventory/categories{_qs(store['id'])}",
            json={"name": "Beverages"}, headers=admin_headers, timeout=15,
        ).json()
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "Cola", "company": "FizzCo",
                  "selling_price": 1.5, "category_id": cat["id"]},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        kws = r.json()["keywords"]
        assert "beverages" in kws
        assert "cola" in kws and "fizzco" in kws

    def test_zero_price_no_numeric_tokens(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "FreeSample Item", "company": "PromoCo", "selling_price": 0},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201
        kws = r.json()["keywords"]
        assert "0" not in kws and "0.0" not in kws
        assert "freesample" in kws and "item" in kws


# ============ Keywords recomputation on PATCH ============

class TestAutoKeywordsPatch:
    def test_recomputed_on_name_change(self, admin_headers, store):
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "OldName Thing", "company": "OldCo", "selling_price": 1.0},
            headers=admin_headers, timeout=15,
        ).json()
        assert "oldname" in p["keywords"]
        r = requests.patch(
            f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
            json={"name": "NewName Thing"}, headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        kws = r.json()["keywords"]
        assert "newname" in kws
        assert "oldname" not in kws
        # company preserved (unchanged)
        assert "oldco" in kws

    def test_recomputed_on_company_change(self, admin_headers, store):
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "Bread", "company": "OldBakery", "selling_price": 2.0},
            headers=admin_headers, timeout=15,
        ).json()
        r = requests.patch(
            f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
            json={"company": "NewBakery"}, headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        kws = r.json()["keywords"]
        assert "newbakery" in kws
        assert "oldbakery" not in kws

    def test_recomputed_on_selling_price_change(self, admin_headers, store):
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "PriceItem", "company": "Co", "selling_price": 2.99},
            headers=admin_headers, timeout=15,
        ).json()
        assert "2.99" in p["keywords"]
        r = requests.patch(
            f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
            json={"selling_price": 9.49}, headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        kws = r.json()["keywords"]
        assert "9.49" in kws
        assert "9" in kws
        assert "2.99" not in kws

    def test_recomputed_on_category_change(self, admin_headers, store):
        cat1 = requests.post(
            f"{API}/inventory/categories{_qs(store['id'])}",
            json={"name": "FirstCat"}, headers=admin_headers, timeout=15,
        ).json()
        cat2 = requests.post(
            f"{API}/inventory/categories{_qs(store['id'])}",
            json={"name": "SecondCat"}, headers=admin_headers, timeout=15,
        ).json()
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "X Y", "company": "Co", "selling_price": 1.0,
                  "category_id": cat1["id"]},
            headers=admin_headers, timeout=15,
        ).json()
        assert "firstcat" in p["keywords"]
        r = requests.patch(
            f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
            json={"category_id": cat2["id"]}, headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        kws = r.json()["keywords"]
        assert "secondcat" in kws
        assert "firstcat" not in kws

    def test_not_recomputed_on_unrelated_change(self, admin_headers, store):
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "SameName", "company": "SameCo",
                  "selling_price": 4.0, "size": "100g", "pack_size": "1"},
            headers=admin_headers, timeout=15,
        ).json()
        kws_before = list(p["keywords"])
        r = requests.patch(
            f"{API}/inventory/products/{p['id']}{_qs(store['id'])}",
            json={"size": "200g", "pack_size": "2"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        kws_after = r.json()["keywords"]
        assert kws_after == kws_before, f"keywords changed: before={kws_before}, after={kws_after}"


# ============ Search via auto-derived keywords ============

class TestSearchViaAutoKeywords:
    @pytest.fixture(scope="class")
    def search_store(self, admin_headers):
        name = f"TEST_KwSearch_{uuid.uuid4().hex[:6]}"
        s = requests.post(f"{API}/stores", json={"name": name},
                          headers=admin_headers, timeout=15).json()
        # Whole Milk by Dairy Co at $2.99
        requests.post(f"{API}/inventory/products?store_id={s['id']}",
                      json={"name": "Whole Milk", "company": "Dairy Co",
                            "selling_price": 2.99},
                      headers=admin_headers, timeout=15)
        # Decoy product so we can verify filter precision
        requests.post(f"{API}/inventory/products?store_id={s['id']}",
                      json={"name": "Sugar", "company": "Sweets Co",
                            "selling_price": 1.0},
                      headers=admin_headers, timeout=15)
        yield s
        requests.delete(f"{API}/stores/{s['id']}", headers=admin_headers, timeout=15)

    def _names(self, lst):
        return sorted([p["name"] for p in lst])

    def test_q_milk_matches(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=milk",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert "Whole Milk" in self._names(r.json())

    def test_q_dairy_matches(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=dairy",
                         headers=admin_headers, timeout=15)
        assert "Whole Milk" in self._names(r.json())

    def test_q_decimal_price_matches(self, admin_headers, search_store):
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=2.99",
                         headers=admin_headers, timeout=15)
        names = self._names(r.json())
        # matches Whole Milk via keywords field (also via selling_price numeric)
        assert "Whole Milk" in names

    def test_q_int_price_matches(self, admin_headers, search_store):
        # rounded int "3" of 2.99 lives in keywords array
        r = requests.get(f"{API}/inventory/products?store_id={search_store['id']}&q=3",
                         headers=admin_headers, timeout=15)
        names = self._names(r.json())
        assert "Whole Milk" in names


# ============ Shopping List ============

class TestShoppingListCreate:
    def test_admin_can_create_text_item(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_milk and eggs", "quantity": 2},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["text"] == "TEST_milk and eggs"
        assert d["status"] == "pending"
        assert d["added_by"] == "Admin"
        assert d["product_id"] is None
        assert d["quantity"] == 2.0

    def test_employee_can_create_text_item(self, employee, store):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_apples"}, headers=employee["headers"], timeout=15,
        )
        assert r.status_code == 201, r.text
        assert r.json()["added_by"] == employee["name"]

    def test_create_with_product_id_populates_name(self, admin_headers, store):
        p = requests.post(
            f"{API}/inventory/products{_qs(store['id'])}",
            json={"name": "TEST_ShoppingProd", "company": "Co", "selling_price": 1.0},
            headers=admin_headers, timeout=15,
        ).json()
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"product_id": p["id"], "quantity": 3},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["product_id"] == p["id"]
        assert d["product_name"] == "TEST_ShoppingProd"
        assert d["quantity"] == 3.0

    def test_create_without_text_or_product_returns_400(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={}, headers=admin_headers, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_create_with_unknown_product_returns_404(self, admin_headers, store):
        r = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"product_id": str(uuid.uuid4())},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 404, r.text


class TestShoppingListListAndPatch:
    def test_list_all_roles_and_sorted_desc(self, admin_headers, employee, store):
        # Two fresh items so we can verify order
        a = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_orderA"}, headers=admin_headers, timeout=15,
        ).json()
        b = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": "TEST_orderB"}, headers=admin_headers, timeout=15,
        ).json()
        # Admin list
        ra = requests.get(f"{API}/inventory/shopping-list{_qs(store['id'])}",
                          headers=admin_headers, timeout=15)
        assert ra.status_code == 200
        items = ra.json()
        # Find positions
        ids = [it["id"] for it in items]
        # 'b' was created after 'a' -> should appear first
        assert ids.index(b["id"]) < ids.index(a["id"])
        # Employee can list too
        re_ = requests.get(f"{API}/inventory/shopping-list{_qs(store['id'])}",
                           headers=employee["headers"], timeout=15)
        assert re_.status_code == 200

    def test_list_status_filter(self, admin_headers, store):
        # Create an item and mark it done
        it = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": f"TEST_done_{uuid.uuid4().hex[:4]}"},
            headers=admin_headers, timeout=15,
        ).json()
        requests.patch(
            f"{API}/inventory/shopping-list/{it['id']}{_qs(store['id'])}",
            json={"status": "done"}, headers=admin_headers, timeout=15,
        )
        done = requests.get(
            f"{API}/inventory/shopping-list{_qs(store['id'])}&status=done",
            headers=admin_headers, timeout=15,
        ).json()
        assert any(x["id"] == it["id"] for x in done)
        assert all(x["status"] == "done" for x in done)
        pending = requests.get(
            f"{API}/inventory/shopping-list{_qs(store['id'])}&status=pending",
            headers=admin_headers, timeout=15,
        ).json()
        assert all(x["status"] == "pending" for x in pending)
        assert not any(x["id"] == it["id"] for x in pending)

    def test_patch_by_employee(self, admin_headers, employee, store):
        it = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": f"TEST_patch_{uuid.uuid4().hex[:4]}"},
            headers=admin_headers, timeout=15,
        ).json()
        r = requests.patch(
            f"{API}/inventory/shopping-list/{it['id']}{_qs(store['id'])}",
            json={"note": "from employee", "quantity": 5},
            headers=employee["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["note"] == "from employee"
        assert d["quantity"] == 5.0

    def test_patch_unknown_returns_404(self, admin_headers, store):
        r = requests.patch(
            f"{API}/inventory/shopping-list/{uuid.uuid4()}{_qs(store['id'])}",
            json={"text": "x"}, headers=admin_headers, timeout=15,
        )
        assert r.status_code == 404


class TestShoppingListDelete:
    def test_admin_can_delete_any_item(self, admin_headers, employee, store):
        # Employee creates
        it = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": f"TEST_adel_{uuid.uuid4().hex[:4]}"},
            headers=employee["headers"], timeout=15,
        ).json()
        # Admin deletes
        r = requests.delete(
            f"{API}/inventory/shopping-list/{it['id']}{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 204

    def test_employee_can_delete_own_item(self, employee, store):
        it = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": f"TEST_own_{uuid.uuid4().hex[:4]}"},
            headers=employee["headers"], timeout=15,
        ).json()
        r = requests.delete(
            f"{API}/inventory/shopping-list/{it['id']}{_qs(store['id'])}",
            headers=employee["headers"], timeout=15,
        )
        assert r.status_code == 204

    def test_employee_cannot_delete_others_item(self, admin_headers, employee, employee_b, store):
        # employee_b creates
        it = requests.post(
            f"{API}/inventory/shopping-list{_qs(store['id'])}",
            json={"text": f"TEST_other_{uuid.uuid4().hex[:4]}"},
            headers=employee_b["headers"], timeout=15,
        ).json()
        # employee (different user) tries to delete -> 403
        r = requests.delete(
            f"{API}/inventory/shopping-list/{it['id']}{_qs(store['id'])}",
            headers=employee["headers"], timeout=15,
        )
        assert r.status_code == 403, r.text
        # Cleanup via admin
        requests.delete(f"{API}/inventory/shopping-list/{it['id']}{_qs(store['id'])}",
                        headers=admin_headers, timeout=15)

    def test_delete_unknown_is_idempotent_204(self, admin_headers, store):
        r = requests.delete(
            f"{API}/inventory/shopping-list/{uuid.uuid4()}{_qs(store['id'])}",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 204, r.text
