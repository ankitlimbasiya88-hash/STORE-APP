"""Backend API tests for Grocery Store Operations app — Iteration 2 (multi-store)."""
import os
import json
import uuid
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/chat"


# ---------- Shared fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "1234"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def main_store(admin_headers):
    """Return the default 'Main Store' that backend seeds on first startup."""
    r = requests.get(f"{API}/stores", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    stores = r.json()
    main = next((s for s in stores if s["name"] == "Main Store"), None)
    assert main, f"Default 'Main Store' should be auto-seeded. Got: {stores}"
    return main


@pytest.fixture(scope="session")
def second_store(admin_headers):
    """Admin-created store used for scoping/isolation tests."""
    name = f"TEST_Store_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/stores", json={"name": name}, headers=admin_headers, timeout=15)
    assert r.status_code == 201, r.text
    s = r.json()
    yield s
    requests.delete(f"{API}/stores/{s['id']}", headers=admin_headers, timeout=15)


@pytest.fixture(scope="session")
def employee_main(admin_headers, main_store):
    """Employee with access ONLY to main_store."""
    name = f"TEST_emp_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/auth/register",
                      json={"name": name, "pin": "5678", "role": "employee",
                            "allowed_stores": [main_store["id"]]},
                      headers=admin_headers, timeout=15)
    assert r.status_code == 201, r.text
    user = r.json()
    assert user["allowed_stores"] == [main_store["id"]]
    login = requests.post(f"{API}/auth/login", json={"name": name, "pin": "5678"}, timeout=15)
    token = login.json()["access_token"]
    yield {"id": user["id"], "name": name, "token": token,
           "headers": {"Authorization": f"Bearer {token}"}}
    requests.delete(f"{API}/users/{user['id']}", headers=admin_headers, timeout=15)


# ---------- Stores ----------
class TestStores:
    # GET /api/stores returns Main Store for admin
    def test_admin_sees_all_stores(self, admin_headers, main_store):
        r = requests.get(f"{API}/stores", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        names = [s["name"] for s in r.json()]
        assert "Main Store" in names

    # POST /api/stores creates store + auto-seeds Cash credit head
    def test_create_store_seeds_cash_head(self, admin_headers):
        name = f"TEST_CashSeed_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/stores", json={"name": name}, headers=admin_headers, timeout=15)
        assert r.status_code == 201
        sid = r.json()["id"]
        try:
            heads = requests.get(f"{API}/accounting/heads?store_id={sid}",
                                 headers=admin_headers, timeout=15).json()
            cash_heads = [h for h in heads if h.get("is_cash")]
            assert len(cash_heads) == 1, f"Expected 1 cash head, got {heads}"
            assert cash_heads[0]["name"] == "Cash"
            assert cash_heads[0]["type"] == "credit"
        finally:
            requests.delete(f"{API}/stores/{sid}", headers=admin_headers, timeout=15)

    # Employee cannot create stores
    def test_employee_cannot_create_store(self, employee_main):
        r = requests.post(f"{API}/stores", json={"name": "TEST_Nope"},
                          headers=employee_main["headers"], timeout=15)
        assert r.status_code == 403

    # Employee only sees stores in allowed_stores
    def test_employee_sees_only_allowed_stores(self, employee_main, main_store, second_store):
        r = requests.get(f"{API}/stores", headers=employee_main["headers"], timeout=15)
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert main_store["id"] in ids
        assert second_store["id"] not in ids

    # DELETE cascades + pulls from user.allowed_stores
    def test_delete_store_cascades(self, admin_headers):
        # Create disposable store
        name = f"TEST_Del_{uuid.uuid4().hex[:6]}"
        s = requests.post(f"{API}/stores", json={"name": name}, headers=admin_headers, timeout=15).json()
        sid = s["id"]
        # Create employee with this store
        ename = f"TEST_delemp_{uuid.uuid4().hex[:6]}"
        e = requests.post(f"{API}/auth/register",
                          json={"name": ename, "pin": "1111", "role": "employee",
                                "allowed_stores": [sid]},
                          headers=admin_headers, timeout=15).json()
        # Add a task in this store
        requests.post(f"{API}/checklists/opening/tasks?store_id={sid}",
                      json={"title": "TEST_cascade"}, headers=admin_headers, timeout=15)
        # Delete store
        r = requests.delete(f"{API}/stores/{sid}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # Tasks should be gone (require_store_access -> 404 because store missing)
        r2 = requests.get(f"{API}/checklists/opening/tasks?store_id={sid}",
                          headers=admin_headers, timeout=15)
        assert r2.status_code == 404
        # User's allowed_stores should have store pulled
        users = requests.get(f"{API}/users", headers=admin_headers, timeout=15).json()
        target = next(u for u in users if u["id"] == e["id"])
        assert sid not in target["allowed_stores"]
        # Cleanup
        requests.delete(f"{API}/users/{e['id']}", headers=admin_headers, timeout=15)


# ---------- Users / store assignment ----------
class TestUserStores:
    # PUT /api/users/{id}/stores updates allowed_stores
    def test_assign_stores(self, admin_headers, main_store, second_store):
        name = f"TEST_assn_{uuid.uuid4().hex[:6]}"
        u = requests.post(f"{API}/auth/register",
                         json={"name": name, "pin": "2222", "role": "employee", "allowed_stores": []},
                         headers=admin_headers, timeout=15).json()
        try:
            r = requests.put(f"{API}/users/{u['id']}/stores",
                             json={"allowed_stores": [main_store["id"], second_store["id"]]},
                             headers=admin_headers, timeout=15)
            assert r.status_code == 200
            assert set(r.json()["allowed_stores"]) == {main_store["id"], second_store["id"]}

            # Invalid store id rejected
            bad = requests.put(f"{API}/users/{u['id']}/stores",
                               json={"allowed_stores": [str(uuid.uuid4())]},
                               headers=admin_headers, timeout=15)
            assert bad.status_code == 400
        finally:
            requests.delete(f"{API}/users/{u['id']}", headers=admin_headers, timeout=15)


# ---------- Auth ----------
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "1234"}, timeout=15)
        assert r.status_code == 200 and r.json()["user"]["role"] == "admin"

    def test_login_wrong_pin(self):
        r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "0000"}, timeout=15)
        assert r.status_code == 401

    def test_employee_cannot_register(self, employee_main):
        r = requests.post(f"{API}/auth/register",
                          json={"name": f"TEST_x_{uuid.uuid4().hex[:5]}", "pin": "1111", "role": "employee"},
                          headers=employee_main["headers"], timeout=15)
        assert r.status_code == 403


# ---------- Store-scoping enforcement ----------
class TestStoreScoping:
    # Missing store_id query param -> 422
    def test_missing_store_id_query(self, admin_headers):
        r = requests.get(f"{API}/accounting/heads", headers=admin_headers, timeout=15)
        assert r.status_code == 422
        r = requests.get(f"{API}/checklists/opening/tasks", headers=admin_headers, timeout=15)
        assert r.status_code == 422

    # Employee can access allowed store
    def test_employee_can_access_allowed_store(self, employee_main, main_store):
        r = requests.get(f"{API}/accounting/heads?store_id={main_store['id']}",
                         headers=employee_main["headers"], timeout=15)
        assert r.status_code == 200

    # Employee blocked from non-allowed store -> 403
    def test_employee_blocked_from_other_store(self, employee_main, second_store):
        r = requests.get(f"{API}/accounting/heads?store_id={second_store['id']}",
                         headers=employee_main["headers"], timeout=15)
        assert r.status_code == 403
        r = requests.get(f"{API}/checklists/opening/today?store_id={second_store['id']}",
                         headers=employee_main["headers"], timeout=15)
        assert r.status_code == 403
        r = requests.get(f"{API}/accounting/today?store_id={second_store['id']}",
                         headers=employee_main["headers"], timeout=15)
        assert r.status_code == 403

    # Unknown store id -> 404
    def test_unknown_store_id(self, admin_headers):
        r = requests.get(f"{API}/accounting/heads?store_id={uuid.uuid4()}",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 404


# ---------- Accounting + Cash head ----------
class TestAccounting:
    # Default Main Store has Cash head
    def test_main_store_has_cash_head(self, admin_headers, main_store):
        heads = requests.get(f"{API}/accounting/heads?store_id={main_store['id']}",
                             headers=admin_headers, timeout=15).json()
        cash = [h for h in heads if h.get("is_cash")]
        assert len(cash) >= 1
        assert cash[0]["name"] == "Cash" and cash[0]["type"] == "credit"

    # Cash head cannot be deleted
    def test_cannot_delete_cash_head(self, admin_headers, main_store):
        heads = requests.get(f"{API}/accounting/heads?store_id={main_store['id']}",
                             headers=admin_headers, timeout=15).json()
        cash_id = next(h["id"] for h in heads if h.get("is_cash"))
        r = requests.delete(f"{API}/accounting/heads/{cash_id}",
                            headers=admin_headers, timeout=15)
        assert r.status_code == 400

    # Admin sees opening_balance/closing_balance/entries; employee sees only totals
    def test_employee_view_hides_balances_and_entries(self, admin_headers, employee_main, main_store):
        sid = main_store["id"]
        # Admin view
        a = requests.get(f"{API}/accounting/today?store_id={sid}",
                         headers=admin_headers, timeout=15).json()
        assert a["opening_balance"] is not None
        assert a["closing_balance"] is not None
        assert isinstance(a["entries"], dict)
        assert "total_credit" in a and "total_debit" in a and "net" in a

        # Employee view
        e = requests.get(f"{API}/accounting/today?store_id={sid}",
                         headers=employee_main["headers"], timeout=15).json()
        assert e["opening_balance"] is None
        assert e["closing_balance"] is None
        assert e["entries"] == {}
        assert "total_credit" in e and "total_debit" in e and "net" in e

    # Historical date returns without auto-creating
    def test_historical_accounting_no_auto_create(self, admin_headers, second_store):
        sid = second_store["id"]
        past = "2020-01-01"
        r = requests.get(f"{API}/accounting/today?store_id={sid}&date={past}",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["date"] == past
        assert body["historical"] is True
        assert body["opening_balance"] == 0.0
        assert body["entries"] == {}

    # Historical checklist returns without auto-creating
    def test_historical_checklist_no_submission(self, admin_headers, second_store):
        sid = second_store["id"]
        past = "2020-01-01"
        r = requests.get(f"{API}/checklists/opening/today?store_id={sid}&date={past}",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["date"] == past
        assert body["historical"] is True
        assert body["submitted"] is False


# ---------- WebSocket store scoping ----------
class TestWebSocket:
    def test_ws_requires_store_id(self, admin_token):
        async def run():
            try:
                async with websockets.connect(f"{WS_URL}?token={admin_token}") as ws:
                    await ws.recv()
                return None
            except websockets.exceptions.InvalidStatus as e:
                return ("http", e.response.status_code)
            except websockets.exceptions.ConnectionClosed as e:
                return ("close", e.code)
            except Exception as e:
                return ("err", str(e))
        result = asyncio.run(run())
        # Should fail (missing required query param -> handshake fails)
        assert result is not None and result[0] in ("http", "close", "err")

    def test_ws_employee_blocked_from_other_store(self, employee_main, second_store):
        async def run():
            url = f"{WS_URL}?token={employee_main['token']}&store_id={second_store['id']}"
            try:
                async with websockets.connect(url) as ws:
                    await ws.recv()
                return None
            except websockets.exceptions.InvalidStatus as e:
                return ("http", e.response.status_code)
            except websockets.exceptions.ConnectionClosed as e:
                return ("close", e.code)
            except Exception as e:
                return ("err", str(e))
        result = asyncio.run(run())
        # Either close code 4403 or HTTP 403 from ingress is acceptable
        assert result is not None
        if result[0] == "close":
            assert result[1] == 4403
        elif result[0] == "http":
            assert result[1] in (401, 403)

    def test_ws_broadcast_scoped_to_store(self, admin_token, employee_main, main_store, second_store):
        marker_a = f"TEST_MAIN_{uuid.uuid4().hex[:6]}"
        marker_b = f"TEST_SEC_{uuid.uuid4().hex[:6]}"

        async def run():
            url_main_admin = f"{WS_URL}?token={admin_token}&store_id={main_store['id']}"
            url_main_emp = f"{WS_URL}?token={employee_main['token']}&store_id={main_store['id']}"
            url_sec_admin = f"{WS_URL}?token={admin_token}&store_id={second_store['id']}"
            results = {}
            async with websockets.connect(url_main_admin) as ws_main_a, \
                       websockets.connect(url_main_emp) as ws_main_e, \
                       websockets.connect(url_sec_admin) as ws_sec_a:
                await asyncio.sleep(0.3)
                await ws_main_a.send(json.dumps({"text": marker_a}))
                r1 = await asyncio.wait_for(ws_main_a.recv(), timeout=5)
                r2 = await asyncio.wait_for(ws_main_e.recv(), timeout=5)
                results["main_admin"] = json.loads(r1)
                results["main_emp"] = json.loads(r2)
                # second store should NOT receive marker_a
                try:
                    other = await asyncio.wait_for(ws_sec_a.recv(), timeout=1.5)
                    results["sec_received"] = json.loads(other)
                except asyncio.TimeoutError:
                    results["sec_received"] = None
                # Send in second store
                await ws_sec_a.send(json.dumps({"text": marker_b}))
                r3 = await asyncio.wait_for(ws_sec_a.recv(), timeout=5)
                results["sec_admin"] = json.loads(r3)
            return results

        res = asyncio.run(run())
        assert res["main_admin"]["text"] == marker_a
        assert res["main_emp"]["text"] == marker_a
        assert res["main_admin"]["store_id"] == res["main_emp"]["store_id"]
        # Critical: scoping prevents cross-store delivery
        assert res["sec_received"] is None, "Second store should not receive main-store messages"
        assert res["sec_admin"]["text"] == marker_b


# ---------- Chat history scoping ----------
class TestChatHistory:
    def test_history_requires_auth(self, main_store):
        r = requests.get(f"{API}/chat/messages?store_id={main_store['id']}", timeout=15)
        assert r.status_code == 401

    def test_history_returns_list(self, admin_headers, main_store):
        r = requests.get(f"{API}/chat/messages?store_id={main_store['id']}",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_history_employee_blocked_from_other_store(self, employee_main, second_store):
        r = requests.get(f"{API}/chat/messages?store_id={second_store['id']}",
                         headers=employee_main["headers"], timeout=15)
        assert r.status_code == 403
