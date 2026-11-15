"""HIPAA Security Rule technical-safeguard checks against the real service code.

Every test is tagged with the Security Rule section it exercises. Tests decorated with @known_gap
describe the desired behaviour for a gap that exists on main today; they are expected to fail until
the code is fixed, which keeps the suite green while the gaps stay visible in the report.
Passing these checks does not by itself establish HIPAA compliance.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import jwt
from starlette.websockets import WebSocketDisconnect

from support import (
    ROOT, SYNTHETIC_SECRET, FakeRedis, FakeResult, FakeSession, client_for, fake_redis_context, hipaa,
    identity, known_gap, load_service, make_database_stub, make_token,
)

PHI_FIELDS = {"patient_id", "patient_name", "primary_diagnosis", "acuity_level", "admission_id", "encounter_id"}


def synthetic_patient(patient_id: int = 123):
    return SimpleNamespace(
        patient_id=patient_id, first_name="Synthetic", middle_name=None, last_name="Person",
        date_of_birth=date(1980, 5, 1), gender="OTHER", phone=None, address=None, is_active=True,
        create_datetime=None, update_datetime=None,
    )


# ---------------------------------------------------------------------------
# §164.312(a)(1) Access control
# ---------------------------------------------------------------------------

class AccessControlTests(unittest.TestCase):
    @hipaa("§164.312(a)(1)", "Access control", "F01")
    def test_forged_identity_headers_are_rejected_by_every_service(self):
        """Services reject identity headers that did not come through the gateway."""
        forged = identity("ADMIN", 999999, with_gateway_secret=False)
        for service, path in (("auth", "/me"), ("patient", "/records"), ("bed", "/grid")):
            with self.subTest(service=service):
                client = client_for(load_service(service), session=FakeSession(), redis=FakeRedis())
                self.assertEqual(client.get(path, headers=forged).status_code, 401)

    @hipaa("§164.312(a)(1)", "Access control", "F01")
    def test_request_without_identity_is_rejected(self):
        """A request with the gateway secret but no user identity is refused."""
        client = client_for(load_service("patient"), session=FakeSession())
        headers = {"X-Gateway-Secret": os.environ["INTERNAL_SERVICE_SECRET"]}
        self.assertEqual(client.get("/records", headers=headers).status_code, 401)

    @hipaa("§164.312(a)(1)", "Access control")
    @known_gap("When INTERNAL_SERVICE_SECRET is empty, services trust X-User-* headers from any caller.")
    def test_services_fail_closed_without_internal_service_secret(self):
        """With no internal service secret configured, services refuse forged identities instead of trusting them."""
        client = client_for(load_service("patient"), session=FakeSession(results=[FakeResult([])]))
        with patch.dict(os.environ, {"INTERNAL_SERVICE_SECRET": ""}):
            response = client.get("/records", headers=identity("ADMIN", 999999, with_gateway_secret=False))
        self.assertEqual(response.status_code, 401)

    @hipaa("§164.312(a)(1)", "Access control", "F03")
    def test_restricted_token_is_blocked_from_clinical_api(self):
        """An account that must still change its first-login password cannot call clinical APIs."""
        gateway = load_service("gateway")
        token = make_token(sub="77", must_change_password=True)
        with patch.object(gateway, "_get_redis", fake_redis_context(FakeRedis())):
            response = client_for(gateway).get("/beds/grid", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 403)

    @hipaa("§164.312(a)(1)", "Access control", "F03")
    def test_live_updates_reject_anonymous_connections(self):
        """The live bed-update WebSocket refuses connections without a login token."""
        gateway = load_service("gateway")
        with self.assertRaises(WebSocketDisconnect) as caught:
            with client_for(gateway).websocket_connect("/ws/beds"):
                pass
        self.assertEqual(caught.exception.code, 4001)

    @hipaa("§164.312(a)(1)", "Access control", "F03")
    def test_live_updates_accept_a_valid_login(self):
        """A normal signed-in user can open the live bed-update WebSocket (control case)."""
        gateway = load_service("gateway")
        with patch.object(gateway, "_get_redis", fake_redis_context(FakeRedis())):
            with client_for(gateway).websocket_connect(f"/ws/beds?token={make_token(sub='6')}"):
                pass

    @hipaa("§164.312(a)(1)", "Access control", "F03")
    @known_gap("The WebSocket handshake does not check must_change_password, so restricted tokens receive live updates.")
    def test_live_updates_reject_restricted_tokens(self):
        """An account that must still change its first-login password cannot subscribe to live updates."""
        gateway = load_service("gateway")
        token = make_token(sub="77", must_change_password=True)
        with patch.object(gateway, "_get_redis", fake_redis_context(FakeRedis())):
            with self.assertRaises(WebSocketDisconnect):
                with client_for(gateway).websocket_connect(f"/ws/beds?token={token}"):
                    pass

    @hipaa("§164.312(a)(1)", "Access control", "F22")
    @known_gap("Anonymous requests share one idempotency cache key, so a login response could be replayed to another client.")
    def test_login_responses_are_never_idempotency_cached(self):
        """Anonymous sign-in responses (which contain tokens) are never stored in the shared retry cache."""
        gateway = load_service("gateway")
        request = SimpleNamespace(headers={"idempotency-key": "shared-key"}, method="POST",
                                  state=SimpleNamespace(user_id=None))
        self.assertIsNone(gateway._build_idempotency_key(request, True, "auth", "login"))


# ---------------------------------------------------------------------------
# Minimum necessary / PHI exposure
# ---------------------------------------------------------------------------

class MinimumNecessaryTests(unittest.TestCase):
    @hipaa("§164.312(a)(1) + §164.502(b)", "Access control / minimum necessary", "F06")
    @known_gap("/beds/grid returns patient names, diagnoses and acuity to housekeeping staff.")
    def test_housekeeping_bed_grid_contains_no_patient_details(self):
        """Housekeeping staff receive bed status only, never patient names or diagnoses."""
        bed = load_service("bed")
        cached = {"beds": [{"bed_code": "TEST-1", "status": "OCCUPIED", "patient_id": 1, "patient_name": "Synthetic Person",
                            "primary_diagnosis": "synthetic diagnosis", "acuity_level": "ESI_2", "admission_id": 9}]}
        redis = FakeRedis({bed.BEDS_GRID_CACHE_KEY: json.dumps(cached)})
        response = client_for(bed, session=FakeSession(), redis=redis).get("/grid", headers=identity("CLEANING_CREW", 14))
        self.assertEqual(response.status_code, 200)
        exposed = {key for row in response.json()["beds"] for key, value in row.items() if key in PHI_FIELDS and value is not None}
        self.assertEqual(exposed, set())

    @hipaa("§164.502(b)", "Minimum necessary (assistant guardrail)")
    def test_assistant_redacts_clinical_details_for_housekeeping(self):
        """The ELON assistant withholds diagnoses from housekeeping staff."""
        guardrails = load_service("bed").siblings["elon.guardrails"]
        reply = guardrails.screen_output_phi("Bed ICU-201: patient admitted with HIV complications.", "CLEANING_CREW")
        self.assertNotIn("HIV", reply)

    @hipaa("§164.308(b)(1) + §164.502(b)", "Business associate / minimum necessary")
    @known_gap("The bed recommender sends the patient's name to the external LLM provider.")
    def test_llm_prompt_contains_no_patient_identifiers(self):
        """Data sent to the external language-model provider for bed recommendations contains no patient name."""
        recommender = load_service("bed").siblings["recommender"]
        patient = recommender.PatientTriageInfo(full_name="Synthetic Person", age=44, gender="OTHER",
                                                acuity_level="ESI_2", chief_complaint="chest pain")
        prompt_values = " ".join(str(value) for value in recommender.format_patient_for_prompt(patient).values())
        self.assertNotIn("Synthetic Person", prompt_values)


# ---------------------------------------------------------------------------
# §164.312(b) Audit controls
# ---------------------------------------------------------------------------

class AuditControlTests(unittest.TestCase):
    def _get_chart(self, session, raise_errors=True):
        client = client_for(load_service("patient"), session=session, raise_server_exceptions=raise_errors)
        return client.get("/patient/123", headers=identity("NURSE", 42))

    @hipaa("§164.312(b)", "Audit controls", "F09")
    def test_patient_chart_read_is_audited(self):
        """Opening a patient chart saves an audit row naming the user and the patient."""
        session = FakeSession(results=[FakeResult([synthetic_patient()])])
        self.assertEqual(self._get_chart(session).status_code, 200)
        rows = session.committed_audit_rows("READ_PATIENT_CHART")
        self.assertEqual([(row.user_id, row.resource_id) for row in rows], [(42, 123)])

    @hipaa("§164.312(b)", "Audit controls", "F09")
    @known_gap("Patient updates add the audit row after the last commit, so it is rolled back when the request ends.")
    def test_patient_update_audit_row_is_persisted(self):
        """Editing a patient's demographics leaves a committed audit row."""
        session = FakeSession(objects={("Patient", 123): synthetic_patient()})
        client = client_for(load_service("patient"), session=session)
        response = client.put("/patient/123", json={"phone": "+1 555 0100"}, headers=identity("NURSE", 42))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(session.committed_audit_rows("UPDATE_PATIENT")), 1)

    @hipaa("§164.312(b)", "Audit controls", "F09")
    @known_gap("Audit write failures are logged and ignored, so PHI is returned without an audit trail.")
    def test_chart_read_fails_closed_when_audit_cannot_be_written(self):
        """If the audit row cannot be saved, the chart is not returned."""
        session = FakeSession(results=[FakeResult([synthetic_patient()])], flush_error=RuntimeError("synthetic storage failure"))
        self.assertEqual(self._get_chart(session, raise_errors=False).status_code, 500)

    @hipaa("§164.312(b)", "Audit controls")
    @known_gap("BOLA_POLICY_MODE=off also switches off audit logging of patient record reads.")
    def test_chart_reads_are_audited_even_when_policy_mode_is_off(self):
        """Turning the access-policy mode off does not turn off read auditing."""
        session = FakeSession(results=[FakeResult([synthetic_patient()])])
        with patch.dict(os.environ, {"BOLA_POLICY_MODE": "off"}):
            self.assertEqual(self._get_chart(session).status_code, 200)
        self.assertEqual(len(session.committed_audit_rows("READ_PATIENT_CHART")), 1)


# ---------------------------------------------------------------------------
# §164.312(a)(2)(iii) Automatic logoff and session revocation
# ---------------------------------------------------------------------------

class SessionLifetimeTests(unittest.TestCase):
    @hipaa("§164.312(a)(2)(iii)", "Automatic logoff")
    def test_access_tokens_expire_after_15_minutes(self):
        """Access tokens stop working 15 minutes after they are issued."""
        auth = load_service("auth")
        claims = jwt.decode(auth.create_access_token({"sub": "5"}), SYNTHETIC_SECRET, algorithms=["HS256"])
        self.assertAlmostEqual(claims["exp"] - claims["iat"], 15 * 60, delta=2)

    @hipaa("§164.312(a)(2)(iii)", "Automatic logoff")
    def test_token_issued_before_logout_is_rejected(self):
        """After logout, an access token issued earlier is refused by the gateway."""
        gateway = load_service("gateway")
        issued = datetime.now(timezone.utc) - timedelta(minutes=2)
        redis = FakeRedis({"last_logout:5": str(datetime.now(timezone.utc).timestamp())})
        token = make_token(sub="5", issued_at=issued)
        with patch.object(gateway, "_get_redis", fake_redis_context(redis)):
            response = client_for(gateway).get("/beds/grid", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 401)

    @hipaa("§164.312(a)(2)(iii)", "Automatic logoff")
    def test_logout_marker_outlives_every_issued_access_token(self):
        """The logout marker is kept at least as long as an access token can live."""
        auth = load_service("auth")
        redis = FakeRedis()
        with patch.object(auth, "get_redis_client", AsyncMock(return_value=redis)):
            asyncio.run(auth.revoke_all_user_tokens(FakeSession(), 42))
        (key, _value, ttl), = redis.set_calls
        self.assertEqual(key, "last_logout:42")
        self.assertGreaterEqual(ttl, auth.ACCESS_TOKEN_EXPIRE_MINUTES * 60)

    @hipaa("§164.312(a)(2)(iii)", "Automatic logoff", "F10")
    @known_gap("If Redis is down, logout/revocation silently succeeds and old access tokens keep working.")
    def test_revocation_failure_is_reported(self):
        """If session revocation cannot be recorded, the logout is reported as failed."""
        auth = load_service("auth")
        with patch.object(auth, "get_redis_client", AsyncMock(return_value=FakeRedis(fail=True))):
            with self.assertRaises(Exception):
                asyncio.run(auth.revoke_all_user_tokens(FakeSession(), 42))


# ---------------------------------------------------------------------------
# §164.312(d) Person or entity authentication
# ---------------------------------------------------------------------------

class AuthenticationTests(unittest.TestCase):
    @hipaa("§164.312(d)", "Person or entity authentication", "F03")
    def test_expired_token_cannot_open_live_updates(self):
        """An expired login token cannot open the live bed-update WebSocket."""
        gateway = load_service("gateway")
        expired = make_token(sub="6", issued_at=datetime.now(timezone.utc) - timedelta(hours=1), minutes=15)
        with self.assertRaises(WebSocketDisconnect) as caught:
            with client_for(gateway).websocket_connect(f"/ws/beds?token={expired}"):
                pass
        self.assertEqual(caught.exception.code, 4001)

    @hipaa("§164.312(d)", "Person or entity authentication")
    def test_refresh_tokens_are_stored_only_as_hashes(self):
        """Refresh tokens are stored as SHA-256 hashes, never in plain text."""
        auth = load_service("auth")
        raw = auth.create_refresh_token()
        stored = auth.hash_token(raw)
        self.assertNotEqual(stored, raw)
        self.assertRegex(stored, r"^[0-9a-f]{64}$")

    @hipaa("§164.312(d)", "Person or entity authentication", "F02")
    @known_gap("Production startup creates an admin account with a hard-coded fallback password when none is configured.")
    def test_production_startup_never_creates_an_account_with_a_default_password(self):
        """A production start with no configured admin password does not create a default admin account."""
        auth = load_service("auth")
        session = FakeSession(results=[FakeResult([])])
        stub = make_database_stub(session_factory=lambda: session)

        async def start_and_stop():
            async with auth.lifespan(auth.app):
                pass

        with patch.dict("sys.modules", {"database": stub}), patch.object(auth, "init_db", AsyncMock()):
            asyncio.run(start_and_stop())
        created = [row for row in session.committed if type(row).__name__ == "Personnel"]
        self.assertEqual(created, [])


# ---------------------------------------------------------------------------
# §164.312(c)(1) Integrity
# ---------------------------------------------------------------------------

class IntegrityTests(unittest.TestCase):
    @hipaa("§164.312(c)(1)", "Integrity", "F16")
    def test_replayed_cleaning_completion_cannot_free_an_occupied_bed(self):
        """Re-sending an old "cleaning complete" request does not free a bed that is occupied again."""
        bed_row = SimpleNamespace(status="OCCUPIED", version=9, bed_code="TEST-1")
        task = SimpleNamespace(status="COMPLETED", personnel_id=42, bed=bed_row, bed_id=1, completed_datetime=None)
        client = client_for(load_service("bed"), session=FakeSession(results=[FakeResult([task])]))
        response = client.put("/cleaning/complete/7", headers=identity("CLEANING_CREW", 42))
        self.assertEqual(response.status_code, 409)
        self.assertEqual((bed_row.status, bed_row.version), ("OCCUPIED", 9))

    @hipaa("§164.312(c)(1)", "Integrity", "F16")
    def test_replayed_equipment_release_cannot_free_a_reassigned_device(self):
        """Re-sending an old equipment release does not free a device that is assigned again."""
        allocation = SimpleNamespace(status="RELEASED", equipment_id=1, equipment_allocation_id=7)
        device = SimpleNamespace(status="ALLOCATED", version=9)
        session = FakeSession(objects={("EquipmentAllocation", 7): allocation, ("Equipment", 1): device},
                              results=[FakeResult(rowcount=0)])
        response = client_for(load_service("bed"), session=session).put("/equipment/release/7", headers=identity("NURSE", 42))
        self.assertEqual(response.status_code, 409)
        self.assertEqual((device.status, device.version), ("ALLOCATED", 9))

    @hipaa("§164.312(c)(1)", "Integrity", "F18")
    @known_gap("A missing date of birth is replaced with an invented one (Jan 1, age 30).")
    def test_unknown_birth_date_is_not_invented(self):
        """Registering a patient without a date of birth is rejected instead of inventing one."""
        session = FakeSession(results=[FakeResult([])])
        client = client_for(load_service("patient"), session=session)
        response = client.post("/register", json={"first_name": "Synthetic", "last_name": "Person", "gender": "OTHER"},
                               headers=identity("NURSE", 42))
        self.assertEqual(response.status_code, 422)


# ---------------------------------------------------------------------------
# §164.312(e)(1) Transmission security
# ---------------------------------------------------------------------------

class TransmissionSecurityTests(unittest.TestCase):
    @hipaa("§164.312(e)(1)", "Transmission security")
    def test_https_mode_allows_only_tls_1_2_and_1_3_with_hsts(self):
        """When certificates are mounted, the edge proxy allows only TLS 1.2/1.3 and sends HSTS."""
        config = (ROOT / "nginx" / "templates" / "https.conf").read_text(encoding="utf-8")
        protocols = re.search(r"ssl_protocols\s+([^;]+);", config).group(1).split()
        self.assertEqual(sorted(protocols), ["TLSv1.2", "TLSv1.3"])
        self.assertIn("Strict-Transport-Security", config)


if __name__ == "__main__":
    unittest.main()
