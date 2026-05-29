"""Iteration 3 — new feature tests for AccountHead flags + structured entry values.

Covers:
  - POST /api/accounting/heads accepts and persists allow_notes/multiple_entries
  - GET  /api/accounting/heads returns those flags (and backward-compat defaults)
  - POST /api/accounting/entry/set with number, dict({amount, note}), list of items
  - POST /api/accounting/entry/set rejected after submit
  - GET  /api/accounting/today computes totals across mixed value shapes
  - Backward compat: POST /api/accounting/entry (legacy amount-only) still works
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"name": "Admin", "pin": "1234"}, timeout=15)
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def isolated_store(admin_headers):
    """Fresh store so we own the day's accounting record entirely."""
    name = f"TEST_AcctV3_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/stores", json={"name": name}, headers=admin_headers, timeout=15)
    assert r.status_code == 201, r.text
    s = r.json()
    yield s
    requests.delete(f"{API}/stores/{s['id']}", headers=admin_headers, timeout=15)


def _create_head(admin_headers, store_id, name, htype, allow_notes=False, multiple_entries=False):
    r = requests.post(
        f"{API}/accounting/heads?store_id={store_id}",
        json={
            "name": name,
            "type": htype,
            "allow_notes": allow_notes,
            "multiple_entries": multiple_entries,
        },
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------- Tests: head flags persistence ----------
class TestHeadFlags:
    def test_create_head_with_allow_notes(self, admin_headers, isolated_store):
        sid = isolated_store["id"]
        head = _create_head(admin_headers, sid, "TEST_Notes", "debit", allow_notes=True)
        assert head["allow_notes"] is True
        assert head["multiple_entries"] is False
        # Verify via GET list
        heads = requests.get(f"{API}/accounting/heads?store_id={sid}",
                             headers=admin_headers, timeout=15).json()
        match = next(h for h in heads if h["id"] == head["id"])
        assert match["allow_notes"] is True and match["multiple_entries"] is False

    def test_create_head_with_multiple_entries(self, admin_headers, isolated_store):
        sid = isolated_store["id"]
        head = _create_head(admin_headers, sid, "TEST_Multi", "credit", multiple_entries=True)
        assert head["multiple_entries"] is True
        assert head["allow_notes"] is False
        heads = requests.get(f"{API}/accounting/heads?store_id={sid}",
                             headers=admin_headers, timeout=15).json()
        match = next(h for h in heads if h["id"] == head["id"])
        assert match["multiple_entries"] is True and match["allow_notes"] is False

    def test_create_head_default_flags_false(self, admin_headers, isolated_store):
        """Backward-compat: not passing flags should default both to False."""
        sid = isolated_store["id"]
        r = requests.post(
            f"{API}/accounting/heads?store_id={sid}",
            json={"name": "TEST_DefaultFlags", "type": "credit"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 201, r.text
        h = r.json()
        assert h["allow_notes"] is False
        assert h["multiple_entries"] is False

    def test_existing_cash_head_has_flag_defaults(self, admin_headers, isolated_store):
        """Cash head was seeded BEFORE the new flag fields. GET must still return
        the flags (defaulting to False) without raising a 500 from Pydantic."""
        sid = isolated_store["id"]
        heads = requests.get(f"{API}/accounting/heads?store_id={sid}",
                             headers=admin_headers, timeout=15).json()
        cash = next(h for h in heads if h.get("is_cash"))
        assert cash["allow_notes"] is False
        assert cash["multiple_entries"] is False


# ---------- Tests: /accounting/entry/set value shapes ----------
class TestEntrySetValueShapes:
    def test_set_number_value(self, admin_headers, isolated_store):
        sid = isolated_store["id"]
        head = _create_head(admin_headers, sid, "TEST_SetNumber", "credit")
        r = requests.post(
            f"{API}/accounting/entry/set?store_id={sid}",
            json={"head_id": head["id"], "value": 150.5},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["value"] == 150.5
        # Verify persistence + total computation
        today = requests.get(f"{API}/accounting/today?store_id={sid}",
                             headers=admin_headers, timeout=15).json()
        assert today["entries"][head["id"]] == 150.5

    def test_set_dict_with_note(self, admin_headers, isolated_store):
        sid = isolated_store["id"]
        head = _create_head(admin_headers, sid, "TEST_SetDict", "debit", allow_notes=True)
        r = requests.post(
            f"{API}/accounting/entry/set?store_id={sid}",
            json={"head_id": head["id"], "value": {"amount": 42.25, "note": "Bought supplies"}},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        stored = r.json()["value"]
        assert stored["amount"] == 42.25
        assert stored["note"] == "Bought supplies"
        today = requests.get(f"{API}/accounting/today?store_id={sid}",
                             headers=admin_headers, timeout=15).json()
        assert today["entries"][head["id"]]["amount"] == 42.25
        assert today["entries"][head["id"]]["note"] == "Bought supplies"

    def test_set_list_of_items(self, admin_headers, isolated_store):
        sid = isolated_store["id"]
        head = _create_head(admin_headers, sid, "TEST_SetList", "credit", multiple_entries=True)
        items = [
            {"id": "i1", "label": "Milk", "note": "2 crates", "amount": 100},
            {"id": "i2", "label": "Bread", "note": "", "amount": 50.5},
            {"label": "Eggs", "amount": 25},  # no id -> server should generate
        ]
        r = requests.post(
            f"{API}/accounting/entry/set?store_id={sid}",
            json={"head_id": head["id"], "value": items},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        stored = r.json()["value"]
        assert isinstance(stored, list) and len(stored) == 3
        # Server should fill id when missing
        assert all("id" in it and it["id"] for it in stored)
        # Amounts preserved
        amounts = sorted(it["amount"] for it in stored)
        assert amounts == [25.0, 50.5, 100.0]
        # Labels preserved
        labels = sorted(it.get("label", "") for it in stored)
        assert labels == ["Bread", "Eggs", "Milk"]

    def test_set_empty_list(self, admin_headers, isolated_store):
        """Empty list must persist and contribute 0 to totals."""
        sid = isolated_store["id"]
        head = _create_head(admin_headers, sid, "TEST_EmptyList", "credit", multiple_entries=True)
        r = requests.post(
            f"{API}/accounting/entry/set?store_id={sid}",
            json={"head_id": head["id"], "value": []},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["value"] == []
        today = requests.get(f"{API}/accounting/today?store_id={sid}",
                             headers=admin_headers, timeout=15).json()
        # head appears in entries as []
        assert today["entries"][head["id"]] == []

    def test_set_zero_amount(self, admin_headers, isolated_store):
        sid = isolated_store["id"]
        head = _create_head(admin_headers, sid, "TEST_Zero", "debit")
        r = requests.post(
            f"{API}/accounting/entry/set?store_id={sid}",
            json={"head_id": head["id"], "value": 0},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["value"] == 0.0


# ---------- Tests: today totals correctness across shapes ----------
class TestTodayTotalsMixed:
    def test_mixed_shapes_compute_totals_correctly(self, admin_headers):
        """Build a fresh store, populate credits/debits via all 3 value shapes,
        verify total_credit / total_debit / net / closing_balance."""
        # Use an isolated store so we control opening = 0.0
        name = f"TEST_Totals_{uuid.uuid4().hex[:6]}"
        s = requests.post(f"{API}/stores", json={"name": name},
                          headers=admin_headers, timeout=15).json()
        sid = s["id"]
        try:
            # Credit heads
            h_num = _create_head(admin_headers, sid, "C_Num", "credit")
            h_obj = _create_head(admin_headers, sid, "C_Obj", "credit", allow_notes=True)
            h_lst = _create_head(admin_headers, sid, "C_Lst", "credit", multiple_entries=True)
            # Debit heads
            d_num = _create_head(admin_headers, sid, "D_Num", "debit")
            d_obj = _create_head(admin_headers, sid, "D_Obj", "debit", allow_notes=True)
            d_lst = _create_head(admin_headers, sid, "D_Lst", "debit", multiple_entries=True)

            def setv(hid, value):
                r = requests.post(f"{API}/accounting/entry/set?store_id={sid}",
                                  json={"head_id": hid, "value": value},
                                  headers=admin_headers, timeout=15)
                assert r.status_code == 200, r.text

            setv(h_num["id"], 100)
            setv(h_obj["id"], {"amount": 50, "note": "x"})
            setv(h_lst["id"], [{"amount": 10}, {"amount": 20}, {"amount": 30}])  # 60
            setv(d_num["id"], 25)
            setv(d_obj["id"], {"amount": 15, "note": "y"})
            setv(d_lst["id"], [{"amount": 5}, {"amount": 5}])  # 10

            today = requests.get(f"{API}/accounting/today?store_id={sid}",
                                 headers=admin_headers, timeout=15).json()
            assert today["opening_balance"] == 0.0
            assert today["total_credit"] == pytest.approx(210.0)  # 100 + 50 + 60 (Cash=0)
            assert today["total_debit"] == pytest.approx(50.0)    # 25 + 15 + 10
            assert today["net"] == pytest.approx(160.0)
            assert today["closing_balance"] == pytest.approx(160.0)
        finally:
            requests.delete(f"{API}/stores/{sid}", headers=admin_headers, timeout=15)


# ---------- Backward compatibility: legacy /accounting/entry ----------
class TestLegacyEntryEndpoint:
    def test_legacy_entry_still_works(self, admin_headers):
        name = f"TEST_Legacy_{uuid.uuid4().hex[:6]}"
        s = requests.post(f"{API}/stores", json={"name": name},
                          headers=admin_headers, timeout=15).json()
        sid = s["id"]
        try:
            head = _create_head(admin_headers, sid, "LegacyHead", "credit")
            r = requests.post(f"{API}/accounting/entry?store_id={sid}",
                              json={"head_id": head["id"], "amount": 77.5},
                              headers=admin_headers, timeout=15)
            assert r.status_code == 200, r.text
            today = requests.get(f"{API}/accounting/today?store_id={sid}",
                                 headers=admin_headers, timeout=15).json()
            assert today["entries"][head["id"]] == 77.5
            assert today["total_credit"] == pytest.approx(77.5)
        finally:
            requests.delete(f"{API}/stores/{sid}", headers=admin_headers, timeout=15)


# ---------- Rejection: after submit, entry/set must 400 ----------
class TestEntrySetAfterSubmit:
    def test_entry_set_rejected_after_submit(self, admin_headers):
        name = f"TEST_Submit_{uuid.uuid4().hex[:6]}"
        s = requests.post(f"{API}/stores", json={"name": name},
                          headers=admin_headers, timeout=15).json()
        sid = s["id"]
        try:
            head = _create_head(admin_headers, sid, "PreSubmitHead", "credit")
            # Seed an entry to allow submit
            requests.post(f"{API}/accounting/entry/set?store_id={sid}",
                          json={"head_id": head["id"], "value": 10},
                          headers=admin_headers, timeout=15)
            sub = requests.post(f"{API}/accounting/submit?store_id={sid}",
                                headers=admin_headers, timeout=15)
            assert sub.status_code == 200, sub.text
            # Now try to set again -> 400
            r = requests.post(f"{API}/accounting/entry/set?store_id={sid}",
                              json={"head_id": head["id"], "value": 20},
                              headers=admin_headers, timeout=15)
            assert r.status_code == 400, r.text
            # Legacy entry endpoint should also be rejected
            r2 = requests.post(f"{API}/accounting/entry?store_id={sid}",
                               json={"head_id": head["id"], "amount": 30},
                               headers=admin_headers, timeout=15)
            assert r2.status_code == 400
        finally:
            requests.delete(f"{API}/stores/{sid}", headers=admin_headers, timeout=15)


# ---------- Edge cases / robustness ----------
class TestEntrySetRobustness:
    def test_invalid_value_coerced_safely(self, admin_headers, isolated_store):
        """Junk strings should coerce to 0.0 (no 500)."""
        sid = isolated_store["id"]
        head = _create_head(admin_headers, sid, "TEST_Junk", "credit")
        r = requests.post(f"{API}/accounting/entry/set?store_id={sid}",
                          json={"head_id": head["id"], "value": "not-a-number"},
                          headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["value"] == 0.0

    def test_employee_requires_store_access(self, admin_headers, isolated_store):
        """Employee without access to store can't write entry/set."""
        # Create employee with NO stores
        ename = f"TEST_noacc_{uuid.uuid4().hex[:6]}"
        e = requests.post(f"{API}/auth/register",
                          json={"name": ename, "pin": "9999", "role": "employee",
                                "allowed_stores": []},
                          headers=admin_headers, timeout=15).json()
        try:
            login = requests.post(f"{API}/auth/login",
                                  json={"name": ename, "pin": "9999"}, timeout=15).json()
            eh = {"Authorization": f"Bearer {login['access_token']}"}
            sid = isolated_store["id"]
            # Need a head id; admin lookup
            heads = requests.get(f"{API}/accounting/heads?store_id={sid}",
                                 headers=admin_headers, timeout=15).json()
            hid = heads[0]["id"]
            r = requests.post(f"{API}/accounting/entry/set?store_id={sid}",
                              json={"head_id": hid, "value": 10},
                              headers=eh, timeout=15)
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/users/{e['id']}", headers=admin_headers, timeout=15)
