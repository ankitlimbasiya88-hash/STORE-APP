"""Tests for /api/reports/summary (Reports module — iter 11)."""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "1234"}, timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def main_store(admin_headers):
    r = requests.get(f"{API}/stores", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    main = next((s for s in r.json() if s["name"] == "Main Store"), None)
    assert main
    return main


@pytest.fixture(scope="module")
def disposable_store(admin_headers):
    name = f"TEST_RPT_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/stores", json={"name": name}, headers=admin_headers, timeout=15)
    assert r.status_code == 201
    s = r.json()
    yield s
    requests.delete(f"{API}/stores/{s['id']}", headers=admin_headers, timeout=15)


@pytest.fixture(scope="module")
def employee_main(admin_headers, main_store):
    name = f"TEST_rptemp_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/auth/register",
        json={"name": name, "pin": "5678", "role": "employee", "allowed_stores": [main_store["id"]]},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 201
    uid = r.json()["id"]
    login = requests.post(f"{API}/auth/login", json={"name": name, "pin": "5678"}, timeout=15)
    token = login.json()["access_token"]
    yield {"id": uid, "name": name, "headers": {"Authorization": f"Bearer {token}"}}
    requests.delete(f"{API}/users/{uid}", headers=admin_headers, timeout=15)


# ---------- Tests ----------
class TestReportsSummary:
    # 1. Default date range = first of current month .. today
    def test_default_date_range(self, admin_headers, main_store):
        r = requests.get(f"{API}/reports/summary", params={"store_id": main_store["id"]},
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        today_dt = datetime.now(timezone.utc)
        first_of_month = today_dt.replace(day=1).strftime("%Y-%m-%d")
        today_str = today_dt.strftime("%Y-%m-%d")
        assert body["period"]["from"] == first_of_month
        assert body["period"]["to"] == today_str
        assert body["store_id"] == main_store["id"]
        assert "accounting" in body and "shopping" in body

    # 2. Wide date range returns aggregated structure
    def test_wide_range_structure(self, admin_headers, main_store):
        r = requests.get(
            f"{API}/reports/summary",
            params={"store_id": main_store["id"], "date_from": "2025-01-01", "date_to": "2026-12-31"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        acc = body["accounting"]
        for key in ("credit_total", "debit_total", "net", "by_head", "by_day", "days_with_entries"):
            assert key in acc, f"missing accounting.{key}"
        assert isinstance(acc["by_head"], list)
        assert isinstance(acc["by_day"], list)
        shop = body["shopping"]
        for key in ("total_spent", "total_tax", "batches", "items", "by_supplier", "by_month"):
            assert key in shop, f"missing shopping.{key}"

    # 3. Employee with allowed store -> accounting hidden, shopping visible
    def test_employee_accounting_hidden(self, employee_main, main_store):
        r = requests.get(f"{API}/reports/summary", params={"store_id": main_store["id"]},
                         headers=employee_main["headers"], timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accounting"] == {"hidden": True}, body["accounting"]
        # shopping fully visible
        assert "total_spent" in body["shopping"]
        assert "by_supplier" in body["shopping"]

    # 4. Employee NOT allowed to store -> 403
    def test_employee_blocked_other_store(self, employee_main, disposable_store):
        r = requests.get(f"{API}/reports/summary", params={"store_id": disposable_store["id"]},
                         headers=employee_main["headers"], timeout=15)
        assert r.status_code == 403

    # 5. Invalid store_id -> 404
    def test_invalid_store_404(self, admin_headers):
        r = requests.get(f"{API}/reports/summary", params={"store_id": str(uuid.uuid4())},
                         headers=admin_headers, timeout=15)
        assert r.status_code == 404

    # 6. date_from > date_to -> swapped gracefully (still 200)
    def test_swapped_dates(self, admin_headers, main_store):
        r = requests.get(
            f"{API}/reports/summary",
            params={"store_id": main_store["id"], "date_from": "2026-12-31", "date_to": "2025-01-01"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["period"]["from"] == "2025-01-01"
        assert body["period"]["to"] == "2026-12-31"

    # 7. End-to-end shopping path: product->list item->execute -> reports.shopping aggregates correctly
    def test_shopping_aggregates_end_to_end(self, admin_headers, disposable_store):
        sid = disposable_store["id"]
        # create supplier
        sup = requests.post(f"{API}/inventory/suppliers", params={"store_id": sid},
                            json={"name": f"TEST_SUP_{uuid.uuid4().hex[:5]}", "contact": "", "notes": ""},
                            headers=admin_headers, timeout=15)
        assert sup.status_code == 201, sup.text
        sup_id = sup.json()["id"]

        # create product with tax_pct=10
        prod = requests.post(f"{API}/inventory/products", params={"store_id": sid},
                             json={"name": f"TEST_PROD_{uuid.uuid4().hex[:5]}", "tax_pct": 10,
                                   "selling_price": 7},
                             headers=admin_headers, timeout=15)
        assert prod.status_code == 201, prod.text
        pid = prod.json()["id"]

        # create shopping-list item for product
        item = requests.post(f"{API}/inventory/shopping-list", params={"store_id": sid},
                             json={"product_id": pid, "quantity": 2, "supplier_id": sup_id},
                             headers=admin_headers, timeout=15)
        assert item.status_code == 201, item.text
        item_id = item.json()["id"]

        # execute shopping with qty=2 price=$5
        exe = requests.post(
            f"{API}/inventory/shopping/execute", params={"store_id": sid},
            json={"items": [{"item_id": item_id, "quantity": 2, "purchase_price": 5.0,
                             "purchase_price_type": "regular", "supplier_id": sup_id}]},
            headers=admin_headers, timeout=15,
        )
        assert exe.status_code == 200, exe.text
        assert exe.json()["count"] == 1

        # query reports spanning today
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.get(
            f"{API}/reports/summary",
            params={"store_id": sid, "date_from": today_str, "date_to": today_str},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        shop = r.json()["shopping"]
        assert shop["total_spent"] == 11.0, shop
        assert shop["total_tax"] == 1.0, shop
        assert shop["items"] == 1, shop
        assert shop["batches"] == 1, shop
        assert len(shop["by_supplier"]) == 1, shop["by_supplier"]
        assert shop["by_supplier"][0]["spent"] == 11.0
        assert shop["by_supplier"][0]["tax"] == 1.0
        assert len(shop["by_month"]) == 1, shop["by_month"]
        assert shop["by_month"][0]["spent"] == 11.0

    # 8. accounting.by_head totals reconcile with accounting_entries for that period
    def test_by_head_matches_entries(self, admin_headers, disposable_store):
        sid = disposable_store["id"]
        # Create an accounting head (debit)
        head = requests.post(
            f"{API}/accounting/heads", params={"store_id": sid},
            json={"name": f"TEST_HEAD_{uuid.uuid4().hex[:5]}", "type": "debit"},
            headers=admin_headers, timeout=15,
        )
        assert head.status_code == 201, head.text
        head_id = head.json()["id"]
        head_name = head.json()["name"]

        # Pick today's accounting page (auto-creates), then PUT an entry value of 25.00
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        get_today = requests.get(f"{API}/accounting/today", params={"store_id": sid},
                                 headers=admin_headers, timeout=15)
        assert get_today.status_code == 200, get_today.text

        # Use the proper endpoint POST /api/accounting/entry
        patch = requests.post(
            f"{API}/accounting/entry", params={"store_id": sid},
            json={"head_id": head_id, "amount": 25.00},
            headers=admin_headers, timeout=15,
        )
        assert patch.status_code == 200, patch.text

        # Now fetch reports.summary for today only
        r = requests.get(
            f"{API}/reports/summary",
            params={"store_id": sid, "date_from": today_str, "date_to": today_str},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        acc = body["accounting"]
        # by_head should include our head with total=25.00
        match = next((h for h in acc["by_head"] if h["head_id"] == head_id), None)
        assert match is not None, f"head not in by_head: {acc['by_head']}"
        assert match["total"] == 25.00, match
        assert match["head_name"] == head_name
        assert match["type"] == "debit"
        # debit_total should be at least 25.00
        assert acc["debit_total"] >= 25.00
        # by_day should have one entry for today with debit >= 25.00
        today_row = next((d for d in acc["by_day"] if d["date"] == today_str), None)
        assert today_row is not None
        assert today_row["debit"] >= 25.00
