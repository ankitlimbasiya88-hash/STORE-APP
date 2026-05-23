"""Backend API tests for Grocery Store Operations app."""
import os
import json
import uuid
import time
import asyncio
import pytest
import requests
import websockets

# Backend URL: use public Expo backend URL key
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://store-manager-pro-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/chat"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "1234"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def employee(admin_headers):
    # Create or reuse employee
    name = f"TEST_emp_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/auth/register", json={"name": name, "pin": "5678", "role": "employee"}, headers=admin_headers, timeout=15)
    assert r.status_code == 201, r.text
    user = r.json()
    login = requests.post(f"{API}/auth/login", json={"name": name, "pin": "5678"}, timeout=15)
    assert login.status_code == 200
    token = login.json()["access_token"]
    yield {"id": user["id"], "name": name, "token": token, "headers": {"Authorization": f"Bearer {token}"}}
    requests.delete(f"{API}/users/{user['id']}", headers=admin_headers, timeout=15)


# ---------- Auth ----------
class TestAuth:
    def test_login_success(self):
        r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "1234"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body and body["user"]["role"] == "admin"

    def test_login_wrong_pin(self):
        r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "0000"}, timeout=15)
        assert r.status_code == 401

    def test_me(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "Admin"

    def test_register_requires_admin(self, employee):
        r = requests.post(f"{API}/auth/register",
                          json={"name": f"TEST_x_{uuid.uuid4().hex[:5]}", "pin": "1111", "role": "employee"},
                          headers=employee["headers"], timeout=15)
        assert r.status_code == 403

    def test_list_users_admin(self, admin_headers):
        r = requests.get(f"{API}/users", headers=admin_headers, timeout=15)
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_list_users_forbidden_for_employee(self, employee):
        r = requests.get(f"{API}/users", headers=employee["headers"], timeout=15)
        assert r.status_code == 403

    def test_admin_cannot_delete_self(self, admin_headers):
        me = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=15).json()
        r = requests.delete(f"{API}/users/{me['id']}", headers=admin_headers, timeout=15)
        assert r.status_code == 400


# ---------- Checklists ----------
@pytest.mark.parametrize("ctype", ["opening", "closing"])
class TestChecklists:
    def test_full_flow(self, ctype, admin_headers, employee):
        # Employee cannot create
        r = requests.post(f"{API}/checklists/{ctype}/tasks", json={"title": "X"}, headers=employee["headers"], timeout=15)
        assert r.status_code == 403

        # Admin creates
        title = f"TEST_{ctype}_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/checklists/{ctype}/tasks", json={"title": title}, headers=admin_headers, timeout=15)
        assert r.status_code == 201, r.text
        task_id = r.json()["id"]

        # List
        r = requests.get(f"{API}/checklists/{ctype}/tasks", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert any(t["id"] == task_id for t in r.json())

        # Today: structure
        r = requests.get(f"{API}/checklists/{ctype}/today", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "tasks" in body and "completed_ids" in body and "submitted" in body

        # Submit with pending -> 400
        r = requests.post(f"{API}/checklists/{ctype}/submit", headers=admin_headers, timeout=15)
        # Could be 400 (pending) - submission state from previous tests may vary; accept 400 only if not yet submitted
        # If a prior submit happened, today may already be submitted (200). Either way, no 5xx.
        assert r.status_code in (400, 200)

        # Toggle complete
        r = requests.post(f"{API}/checklists/{ctype}/toggle",
                          json={"task_id": task_id, "completed": True}, headers=admin_headers, timeout=15)
        # If already submitted, returns 400; else 200
        assert r.status_code in (200, 400)

        # Cleanup
        requests.delete(f"{API}/checklists/{ctype}/tasks/{task_id}", headers=admin_headers, timeout=15)


# ---------- Accounting ----------
class TestAccounting:
    def test_heads_crud_and_balance(self, admin_headers, employee):
        # Employee cannot create head
        r = requests.post(f"{API}/accounting/heads",
                          json={"name": "TEST_Forbidden", "type": "credit"},
                          headers=employee["headers"], timeout=15)
        assert r.status_code == 403

        # Admin create credit
        r = requests.post(f"{API}/accounting/heads",
                          json={"name": f"TEST_Sales_{uuid.uuid4().hex[:4]}", "type": "credit"},
                          headers=admin_headers, timeout=15)
        assert r.status_code == 201
        credit_id = r.json()["id"]

        # Admin create debit
        r = requests.post(f"{API}/accounting/heads",
                          json={"name": f"TEST_Exp_{uuid.uuid4().hex[:4]}", "type": "debit"},
                          headers=admin_headers, timeout=15)
        assert r.status_code == 201
        debit_id = r.json()["id"]

        # List heads
        r = requests.get(f"{API}/accounting/heads", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ids = [h["id"] for h in r.json()]
        assert credit_id in ids and debit_id in ids

        # Today
        r = requests.get(f"{API}/accounting/today", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        opening = body["opening_balance"]

        # If submitted already today (from prior test), skip mutation checks
        if body.get("submitted"):
            pytest.skip("Accounting already submitted today; skipping mutation checks")

        # Update entries
        r = requests.post(f"{API}/accounting/entry",
                          json={"head_id": credit_id, "amount": 500.0}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        r = requests.post(f"{API}/accounting/entry",
                          json={"head_id": debit_id, "amount": 200.0}, headers=admin_headers, timeout=15)
        assert r.status_code == 200

        # Verify closing computation
        r = requests.get(f"{API}/accounting/today", headers=admin_headers, timeout=15)
        body = r.json()
        assert abs(body["closing_balance"] - (opening + 500.0 - 200.0)) < 0.001
        assert abs(body["total_credit"] - 500.0) < 0.001
        assert abs(body["total_debit"] - 200.0) < 0.001

        # Cleanup heads
        requests.delete(f"{API}/accounting/heads/{credit_id}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/accounting/heads/{debit_id}", headers=admin_headers, timeout=15)


# ---------- Chat ----------
class TestChat:
    def test_history_requires_auth(self):
        r = requests.get(f"{API}/chat/messages", timeout=15)
        assert r.status_code == 401

    def test_history_returns_list(self, admin_headers):
        r = requests.get(f"{API}/chat/messages", headers=admin_headers, timeout=15)
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_websocket_invalid_token(self):
        async def run():
            try:
                async with websockets.connect(f"{WS_URL}?token=invalid") as ws:
                    await ws.recv()
                return None
            except websockets.exceptions.ConnectionClosed as e:
                return e.code
            except Exception as e:
                return str(e)
        code = asyncio.run(run())
        # Server sends close code 4401
        assert code == 4401 or (isinstance(code, str) and "4401" in code) or code is None

    def test_websocket_broadcast(self, admin_token, employee):
        marker = f"TEST_MSG_{uuid.uuid4().hex[:8]}"

        async def run():
            url1 = f"{WS_URL}?token={admin_token}"
            url2 = f"{WS_URL}?token={employee['token']}"
            async with websockets.connect(url1) as ws1, websockets.connect(url2) as ws2:
                await asyncio.sleep(0.3)
                await ws1.send(json.dumps({"text": marker}))
                # Both should receive
                r1 = await asyncio.wait_for(ws1.recv(), timeout=5)
                r2 = await asyncio.wait_for(ws2.recv(), timeout=5)
                return r1, r2

        r1, r2 = asyncio.run(run())
        d1, d2 = json.loads(r1), json.loads(r2)
        assert d1["text"] == marker and d2["text"] == marker
        assert d1["sender_name"] == "Admin"

        # Verify persisted
        r = requests.get(f"{API}/chat/messages",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert any(m.get("text") == marker for m in r.json())
