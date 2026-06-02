"""Backend tests for iter 7 — submit_stock now returns integer ceiling quantity.

Change under test (server.py:1465):
    order_qty = max(1, int(math.ceil(deficit)))

Covers:
  1) Fractional deficit (per_day=10/7, max_days=4) -> deficit≈5.714 -> qty=6 (int).
  2) Zero per_day -> NO continuous-list entry created.
  3) Tiny deficit (per_day=0.1, max_days=1) -> deficit=0.1 -> qty=1.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _qs(sid: str) -> str:
    return f"?store_id={sid}"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"name": "Admin", "pin": "1234"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def store(admin_headers):
    name = f"TEST_SubmitCeil_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/stores", json={"name": name},
                      headers=admin_headers, timeout=15)
    assert r.status_code == 201, r.text
    s = r.json()
    yield s
    requests.delete(f"{API}/stores/{s['id']}",
                    headers=admin_headers, timeout=15)


def _create_product(headers, store_id, *, qty, period_days, max_days, ppt="regular"):
    body = {
        "name": f"TEST_Prod_{uuid.uuid4().hex[:4]}",
        "company": "Co",
        "selling_price": 1.0,
        "purchase_price_type": ppt,
        "max_inventory_days": max_days,
    }
    if qty is not None:
        body["avg_sales"] = {"quantity": qty, "period_days": period_days}
    r = requests.post(f"{API}/inventory/products{_qs(store_id)}",
                      json=body, headers=headers, timeout=15)
    assert r.status_code == 201, r.text
    return r.json()


def _set_stock(headers, store_id, product_id, quantity):
    r = requests.post(f"{API}/inventory/stock/set{_qs(store_id)}",
                      json={"product_id": product_id, "quantity": quantity},
                      headers=headers, timeout=15)
    assert r.status_code == 200, r.text


def _submit(headers, store_id):
    r = requests.post(f"{API}/inventory/stock/submit{_qs(store_id)}",
                      headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _get_continuous(headers, store_id):
    r = requests.get(f"{API}/inventory/shopping-list{_qs(store_id)}",
                     headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ============ 1) Fractional deficit -> integer ceiling ============

class TestFractionalDeficitCeiling:
    def test_qty_is_integer_ceiling(self, admin_headers, store):
        # per_day = 10/7 ≈ 1.4286; max_days = 4; target ≈ 5.7143; on_hand = 0
        # deficit ≈ 5.7143 -> ceil = 6 -> order_qty = 6 (int)
        prod = _create_product(admin_headers, store["id"],
                               qty=10, period_days=7, max_days=4)
        _set_stock(admin_headers, store["id"], prod["id"], 0)
        res = _submit(admin_headers, store["id"])
        assert res["orders_added"] >= 1

        items = _get_continuous(admin_headers, store["id"])
        mine = [it for it in items if it.get("product_id") == prod["id"]
                and it.get("source") == "inventory"]
        assert mine, f"expected continuous-list entry for product, got: {items}"
        q = mine[0]["quantity"]
        # Must be integer 6 (not 5.7143, not 5)
        assert q == 6, f"expected qty=6 (ceil of 5.7143), got {q!r}"
        # Type must be integer-valued (allow int OR float 6.0 since JSON)
        assert isinstance(q, int) or (isinstance(q, float) and q.is_integer()), \
            f"expected integer-valued quantity, got {type(q).__name__}={q!r}"
        # Should NOT be the old behavior (5.7143)
        assert q != 5.7143
        assert q != round(10 / 7 * 4, 4)


# ============ 2) Zero deficit -> no entry ============

class TestZeroDeficitNoEntry:
    def test_no_entry_when_per_day_zero(self, admin_headers, store):
        # No avg_sales -> per_day = 0 -> target = 0 -> skipped (continue)
        prod = _create_product(admin_headers, store["id"],
                               qty=None, period_days=None, max_days=5)
        _set_stock(admin_headers, store["id"], prod["id"], 0)
        before = _get_continuous(admin_headers, store["id"])
        before_ids = {it["id"] for it in before if it.get("product_id") == prod["id"]}
        _submit(admin_headers, store["id"])
        after = _get_continuous(admin_headers, store["id"])
        mine = [it for it in after if it.get("product_id") == prod["id"]
                and it.get("source") == "inventory"]
        # No new inventory-sourced entry for this product
        new_ids = {it["id"] for it in mine} - before_ids
        assert not new_ids, \
            f"expected NO continuous-list entry for zero-per_day product, got: {mine}"

    def test_no_entry_when_max_days_zero(self, admin_headers, store):
        # per_day > 0 but max_days = 0 -> target = 0 -> skipped
        prod = _create_product(admin_headers, store["id"],
                               qty=5, period_days=1, max_days=0)
        _set_stock(admin_headers, store["id"], prod["id"], 0)
        before = _get_continuous(admin_headers, store["id"])
        before_ids = {it["id"] for it in before if it.get("product_id") == prod["id"]}
        _submit(admin_headers, store["id"])
        after = _get_continuous(admin_headers, store["id"])
        mine = [it for it in after if it.get("product_id") == prod["id"]
                and it.get("source") == "inventory"]
        new_ids = {it["id"] for it in mine} - before_ids
        assert not new_ids, \
            f"expected NO continuous-list entry for max_days=0 product, got: {mine}"


# ============ 3) Tiny deficit -> qty floors to 1 ============

class TestTinyDeficitFloorsToOne:
    def test_tiny_deficit_yields_qty_1(self, admin_headers, store):
        # per_day = 1/10 = 0.1, max_days = 1 -> target = 0.1 -> deficit = 0.1
        # math.ceil(0.1) = 1 -> max(1, 1) = 1
        prod = _create_product(admin_headers, store["id"],
                               qty=1, period_days=10, max_days=1)
        _set_stock(admin_headers, store["id"], prod["id"], 0)
        _submit(admin_headers, store["id"])
        items = _get_continuous(admin_headers, store["id"])
        mine = [it for it in items if it.get("product_id") == prod["id"]
                and it.get("source") == "inventory"]
        assert mine, f"expected continuous-list entry for tiny-deficit product, got: {items}"
        q = mine[0]["quantity"]
        assert q == 1, f"expected qty=1 (ceil of 0.1), got {q!r}"


# ============ 4) Integer-valued sanity: exact target ============

class TestExactTargetStillInteger:
    def test_per_day_2_max_7_target_14(self, admin_headers, store):
        # per_day = 10/5 = 2, max_days = 7 -> target = 14 -> deficit = 14 -> ceil = 14
        prod = _create_product(admin_headers, store["id"],
                               qty=10, period_days=5, max_days=7)
        _set_stock(admin_headers, store["id"], prod["id"], 0)
        _submit(admin_headers, store["id"])
        items = _get_continuous(admin_headers, store["id"])
        mine = [it for it in items if it.get("product_id") == prod["id"]
                and it.get("source") == "inventory"]
        assert mine
        q = mine[0]["quantity"]
        assert q == 14, f"expected qty=14, got {q!r}"
