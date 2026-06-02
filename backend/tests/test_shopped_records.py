"""Backend API tests for Milestone D - Shopped Records (executed shopping batches).

Validates POST /api/inventory/shopping/execute, GET /api/inventory/shopped,
GET /api/inventory/shopped/batch/{batch_id}, DELETE single record & DELETE batch
endpoints introduced at server.py:1494-1672.

Test groups:
A) Happy path single-item w/ tax (10 x 2.50, 8.5% tax = 27.13)
B) Multi-item batch (shared batch_id, total_amount sums)
C) Non-product (text-only) item -> tax_pct=0
D) Permissions: admin can DELETE batch, non-admin gets 403
E) Validation: empty items list, invalid PPT
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 20


# ============ helpers ============

def _qs(sid: str, **extra) -> str:
    parts = [f"store_id={sid}"] + [f"{k}={v}" for k, v in extra.items()]
    return "?" + "&".join(parts)


# ============ Shared fixtures ============

@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"name": "Admin", "pin": "1234"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def store(admin_headers):
    name = f"TEST_Shopped_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/stores", json={"name": name},
                      headers=admin_headers, timeout=TIMEOUT)
    assert r.status_code == 201, r.text
    s = r.json()
    yield s
    requests.delete(f"{API}/stores/{s['id']}",
                    headers=admin_headers, timeout=TIMEOUT)


@pytest.fixture(scope="module")
def employee(admin_headers, store):
    """Create a fresh employee user scoped to the test store for permission tests."""
    name = f"TEST_Emp_{uuid.uuid4().hex[:6]}"
    pin = "9911"
    r = requests.post(
        f"{API}/auth/register",
        json={
            "name": name, "pin": pin, "role": "employee",
            "allowed_stores": [store["id"]],
        },
        headers=admin_headers, timeout=TIMEOUT,
    )
    assert r.status_code == 201, r.text
    # login as employee to obtain bearer token
    lr = requests.post(f"{API}/auth/login",
                       json={"name": name, "pin": pin}, timeout=TIMEOUT)
    assert lr.status_code == 200, lr.text
    uid = r.json()["id"]
    headers = {"Authorization": f"Bearer {lr.json()['access_token']}"}
    yield {"id": uid, "name": name, "headers": headers}
    requests.delete(f"{API}/users/{uid}", headers=admin_headers, timeout=TIMEOUT)


def _create_product(headers, store_id, *, tax_pct=0.0, ppt="regular", name=None):
    payload = {
        "name": name or f"TEST_Prod_{uuid.uuid4().hex[:6]}",
        "company": "ShoppedCo",
        "selling_price": 5.0,
        "purchase_price_type": ppt,
        "tax_pct": tax_pct,
    }
    r = requests.post(
        f"{API}/inventory/products{_qs(store_id)}",
        json=payload, headers=headers, timeout=TIMEOUT,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _create_sl_item(headers, store_id, *, product_id=None, text="", quantity=1,
                    purchase_price=0.0, purchase_price_type="regular"):
    body = {
        "quantity": quantity,
        "purchase_price": purchase_price,
        "purchase_price_type": purchase_price_type,
    }
    if product_id:
        body["product_id"] = product_id
    if text:
        body["text"] = text
    r = requests.post(
        f"{API}/inventory/shopping-list{_qs(store_id)}",
        json=body, headers=headers, timeout=TIMEOUT,
    )
    assert r.status_code == 201, r.text
    return r.json()


# ============ A) Happy path ============

class TestHappyPath:
    def test_execute_single_item_with_tax(self, admin_headers, store):
        sid = store["id"]
        # 1) product w/ tax_pct=8.5 PPT="both"
        prod = _create_product(admin_headers, sid, tax_pct=8.5, ppt="both")
        assert prod["tax_pct"] == 8.5
        # 2) shopping-list item: qty 10, purchase_price 2.50
        item = _create_sl_item(
            admin_headers, sid, product_id=prod["id"],
            quantity=10, purchase_price=2.50, purchase_price_type="both",
        )
        item_id = item["id"]
        # 3) execute
        payload = {
            "list_id": None,
            "items": [{
                "item_id": item_id, "quantity": 10, "purchase_price": 2.50,
                "purchase_price_type": "both", "supplier_id": None, "note": "",
            }],
        }
        r = requests.post(
            f"{API}/inventory/shopping/execute{_qs(sid)}",
            json=payload, headers=admin_headers, timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # 4) verify count & total
        assert body["count"] == 1
        assert body["batch_id"] is not None
        # 10 * 2.50 = 25.00; tax = 25.00 * 0.085 = 2.125; total = 27.125 -> 27.13
        assert body["total_amount"] == 27.13, f"got {body['total_amount']}"
        batch_id = body["batch_id"]

        # 5) source item DELETED
        r2 = requests.get(
            f"{API}/inventory/shopping-list{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert r2.status_code == 200
        ids_remaining = {it["id"] for it in r2.json()}
        assert item_id not in ids_remaining, "source SL item should have been deleted"

        # 6) GET /inventory/shopped contains record with expected values
        r3 = requests.get(
            f"{API}/inventory/shopped{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert r3.status_code == 200, r3.text
        recs = r3.json()
        matched = [x for x in recs if x["batch_id"] == batch_id]
        assert len(matched) == 1
        rec = matched[0]
        assert rec["quantity"] == 10
        assert rec["purchase_price"] == 2.50
        assert rec["tax_pct"] == 8.5
        assert rec["line_total"] == 25.00
        assert rec["tax_amount"] == 2.13
        assert rec["total_with_tax"] == 27.13
        assert rec["product_id"] == prod["id"]
        assert rec["purchase_price_type"] == "both"
        assert rec["source_item_id"] == item_id
        assert rec["shopped_by"] == "Admin"

        # 7) GET batch endpoint
        r4 = requests.get(
            f"{API}/inventory/shopped/batch/{batch_id}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert r4.status_code == 200, r4.text
        batch_recs = r4.json()
        assert len(batch_recs) == 1
        assert batch_recs[0]["id"] == rec["id"]


# ============ B) Multi-item batch ============

class TestMultiItemBatch:
    def test_multi_items_share_batch_and_total(self, admin_headers, store):
        sid = store["id"]
        # 3 products, varying tax
        p1 = _create_product(admin_headers, sid, tax_pct=10.0, ppt="regular")
        p2 = _create_product(admin_headers, sid, tax_pct=0.0, ppt="regular")
        p3 = _create_product(admin_headers, sid, tax_pct=5.0, ppt="regular")

        # 3 SL items
        items = [
            _create_sl_item(admin_headers, sid, product_id=p1["id"], quantity=2, purchase_price=10.0),
            _create_sl_item(admin_headers, sid, product_id=p2["id"], quantity=5, purchase_price=3.0),
            _create_sl_item(admin_headers, sid, product_id=p3["id"], quantity=4, purchase_price=2.5),
        ]
        payload = {
            "list_id": None,
            "items": [
                {"item_id": items[0]["id"], "quantity": 2, "purchase_price": 10.0,
                 "purchase_price_type": "regular", "supplier_id": None, "note": ""},
                {"item_id": items[1]["id"], "quantity": 5, "purchase_price": 3.0,
                 "purchase_price_type": "regular", "supplier_id": None, "note": ""},
                {"item_id": items[2]["id"], "quantity": 4, "purchase_price": 2.5,
                 "purchase_price_type": "regular", "supplier_id": None, "note": ""},
            ],
        }
        r = requests.post(
            f"{API}/inventory/shopping/execute{_qs(sid)}",
            json=payload, headers=admin_headers, timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 3
        batch_id = body["batch_id"]
        # Expected totals:
        #  20.00 + 2.00 tax = 22.00
        #  15.00 + 0    tax = 15.00
        #  10.00 + 0.50 tax = 10.50
        # sum = 47.50
        assert body["total_amount"] == 47.50, body["total_amount"]

        # All 3 sharing batch
        r2 = requests.get(
            f"{API}/inventory/shopped/batch/{batch_id}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert r2.status_code == 200
        recs = r2.json()
        assert len(recs) == 3
        assert {rec["batch_id"] for rec in recs} == {batch_id}
        # sum of total_with_tax == 47.50
        assert round(sum(r["total_with_tax"] for r in recs), 2) == 47.50


# ============ C) Text-only (no product) item ============

class TestTextOnly:
    def test_execute_text_item_no_tax(self, admin_headers, store):
        sid = store["id"]
        # SL text item, no product_id
        item = _create_sl_item(
            admin_headers, sid, text="Brown bags",
            quantity=12, purchase_price=1.25,
        )
        payload = {
            "list_id": None,
            "items": [{
                "item_id": item["id"], "quantity": 12, "purchase_price": 1.25,
                "purchase_price_type": "regular", "supplier_id": None, "note": "bulk",
            }],
        }
        r = requests.post(
            f"{API}/inventory/shopping/execute{_qs(sid)}",
            json=payload, headers=admin_headers, timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        # 12 * 1.25 = 15.00, tax 0 -> total 15.00
        assert body["total_amount"] == 15.00

        r2 = requests.get(
            f"{API}/inventory/shopped/batch/{body['batch_id']}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert r2.status_code == 200
        recs = r2.json()
        assert len(recs) == 1
        rec = recs[0]
        assert rec["tax_pct"] == 0
        assert rec["tax_amount"] == 0
        assert rec["line_total"] == 15.00
        assert rec["total_with_tax"] == 15.00
        assert rec["product_id"] is None
        assert rec["text"] == "Brown bags"


# ============ D) Permissions / delete ============

class TestPermissionsAndDelete:
    def test_non_admin_delete_batch_403(self, admin_headers, employee, store):
        sid = store["id"]
        # Seed a batch as admin
        prod = _create_product(admin_headers, sid, tax_pct=0)
        item = _create_sl_item(admin_headers, sid, product_id=prod["id"],
                               quantity=1, purchase_price=1.0)
        ex = requests.post(
            f"{API}/inventory/shopping/execute{_qs(sid)}",
            json={"list_id": None, "items": [{
                "item_id": item["id"], "quantity": 1, "purchase_price": 1.0,
                "purchase_price_type": "regular", "supplier_id": None, "note": "",
            }]},
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert ex.status_code == 200
        batch_id = ex.json()["batch_id"]

        # Employee attempts delete batch -> 403
        rd = requests.delete(
            f"{API}/inventory/shopped/batch/{batch_id}{_qs(sid)}",
            headers=employee["headers"], timeout=TIMEOUT,
        )
        assert rd.status_code == 403, rd.text

        # Employee attempts delete single record -> 403
        # Find the record id
        rlist = requests.get(
            f"{API}/inventory/shopped/batch/{batch_id}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert rlist.status_code == 200
        rec_id = rlist.json()[0]["id"]
        rdr = requests.delete(
            f"{API}/inventory/shopped/{rec_id}{_qs(sid)}",
            headers=employee["headers"], timeout=TIMEOUT,
        )
        assert rdr.status_code == 403, rdr.text

        # Admin delete batch -> 204, records removed
        ra = requests.delete(
            f"{API}/inventory/shopped/batch/{batch_id}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert ra.status_code == 204, ra.text

        rfinal = requests.get(
            f"{API}/inventory/shopped/batch/{batch_id}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert rfinal.status_code == 200
        assert rfinal.json() == []

    def test_admin_delete_single_record(self, admin_headers, store):
        sid = store["id"]
        prod = _create_product(admin_headers, sid, tax_pct=0)
        item = _create_sl_item(admin_headers, sid, product_id=prod["id"],
                               quantity=2, purchase_price=2.0)
        ex = requests.post(
            f"{API}/inventory/shopping/execute{_qs(sid)}",
            json={"list_id": None, "items": [{
                "item_id": item["id"], "quantity": 2, "purchase_price": 2.0,
                "purchase_price_type": "regular", "supplier_id": None, "note": "",
            }]},
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert ex.status_code == 200
        batch_id = ex.json()["batch_id"]
        rlist = requests.get(
            f"{API}/inventory/shopped/batch/{batch_id}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        rec_id = rlist.json()[0]["id"]
        rd = requests.delete(
            f"{API}/inventory/shopped/{rec_id}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert rd.status_code == 204
        # Confirm gone
        rfinal = requests.get(
            f"{API}/inventory/shopped/batch/{batch_id}{_qs(sid)}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert rfinal.json() == []


# ============ E) Validation ============

class TestValidation:
    def test_empty_items_returns_count_zero(self, admin_headers, store):
        sid = store["id"]
        r = requests.post(
            f"{API}/inventory/shopping/execute{_qs(sid)}",
            json={"list_id": None, "items": []},
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 0
        assert body["batch_id"] is None

    def test_invalid_ppt_returns_422(self, admin_headers, store):
        sid = store["id"]
        r = requests.post(
            f"{API}/inventory/shopping/execute{_qs(sid)}",
            json={"list_id": None, "items": [{
                "item_id": "deadbeef-nonexistent", "quantity": 1, "purchase_price": 1.0,
                "purchase_price_type": "ultra", "supplier_id": None, "note": "",
            }]},
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert r.status_code == 422, r.text
