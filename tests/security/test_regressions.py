"""Desired security behavior: known defects deliberately fail, never xfail.

Run only this directory; root legacy integration scripts can delete database data.
"""
from datetime import datetime, timedelta, timezone
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import jwt

from support import SYNTHETIC_SECRET, complete, load_app


class IdentityBoundaryTests(unittest.TestCase):
    """F01: exercise the actual dependencies through an HTTP route."""

    def test_forged_admin_headers_are_rejected_by_each_service(self):
        for service in ("auth", "patient", "bed"):
            with self.subTest(service=service):
                module = load_app(service)
                guard = module._test_security.require_roles(module._test_security.UserRole.ADMIN)
                from fastapi import Depends
                probe = FastAPI()

                @probe.get("/protected")
                def protected(identity=Depends(guard)):
                    return {"accepted": True}

                client = TestClient(probe)
                try:
                    response = client.get("/protected", headers={"X-User-Id": "999999", "X-User-Role": "ADMIN"})
                    self.assertIn(response.status_code, (401, 403), "F01: forged headers must not establish an identity")
                finally:
                    client.close()

    def test_missing_identity_is_rejected(self):
        module = load_app("patient")
        guard = module._test_security.require_roles(module._test_security.UserRole.NURSE)
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as caught:
            guard(x_user_id=None, x_user_role=None)
        self.assertEqual(caught.exception.status_code, 401)


class WebSocketBoundaryTests(unittest.TestCase):
    """F03: real socket handler with an in-memory connection, no server/Redis."""

    def setUp(self):
        self.module = load_app("gateway")

    def connect(self, token=None):
        socket = SimpleNamespace(
            query_params={} if token is None else {"token": token},
            close=AsyncMock(), receive_text=AsyncMock(side_effect=WebSocketDisconnect()),
        )
        manager = SimpleNamespace(connect=AsyncMock(), disconnect=Mock())
        with patch.object(self.module, "manager", manager), patch.object(self.module, "validate_ws_token", AsyncMock(return_value={"sub": "10", "role": "RESTRICTED", "must_change_password": True})):
            complete(self.module.websocket_bed_updates(socket))
        return socket, manager

    def test_anonymous_socket_is_rejected(self):
        socket, manager = self.connect()
        manager.connect.assert_not_awaited()
        socket.close.assert_awaited_once()

    def test_first_login_restricted_socket_is_rejected(self):
        socket, manager = self.connect("synthetic-restricted-token")
        manager.connect.assert_not_awaited()
        socket.close.assert_awaited_once()

    def test_expired_jwt_is_rejected_before_redis(self):
        token = jwt.encode({"sub": "10", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}, SYNTHETIC_SECRET, algorithm="HS256")
        self.assertIsNone(complete(self.module.validate_ws_token(token)))


class ClinicalIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.module = load_app("bed")
        self.actor = {"user_id": 42, "role": "CLEANING_CREW"}

    def test_old_cleaning_completion_cannot_free_occupied_bed(self):
        """F16: historical task replay must not mutate a newer stay."""
        bed = SimpleNamespace(status="OCCUPIED", version=9, bed_code="TEST-1")
        task = SimpleNamespace(status="COMPLETED", personnel_id=42, bed=bed, bed_id=1, completed_datetime=None)
        result = Mock()
        result.scalars.return_value.first.return_value = task
        db = SimpleNamespace(execute=AsyncMock(return_value=result), commit=AsyncMock())
        with patch.object(self.module, "invalidate_grid_cache", AsyncMock()), patch.object(self.module, "publish_event", AsyncMock()), patch.object(self.module, "log_audit", AsyncMock()):
            from fastapi import HTTPException
            try:
                complete(self.module.complete_cleaning(7, self.actor, db, Mock()))
            except HTTPException as error:
                self.assertIn(error.status_code, (400, 403, 409))
        self.assertEqual(bed.status, "OCCUPIED", "F16: historical cleaning completion freed a current stay")
        self.assertEqual(bed.version, 9)

    def test_old_equipment_release_cannot_free_reallocated_device(self):
        """F16: replaying an already released allocation must be a no-op/rejection."""
        allocation = SimpleNamespace(status="RELEASED", equipment_id=1, end_datetime=None)
        device = SimpleNamespace(status="ALLOCATED", version=9)
        db = SimpleNamespace(get=AsyncMock(side_effect=[allocation, device]), commit=AsyncMock())
        with patch.object(self.module, "invalidate_grid_cache", AsyncMock()):
            from fastapi import HTTPException
            try:
                complete(self.module.release_equipment(7, self.actor, db, Mock()))
            except HTTPException as error:
                self.assertIn(error.status_code, (400, 403, 409))
        self.assertEqual(device.status, "ALLOCATED", "F16: stale release freed a reallocated device")
        self.assertEqual(device.version, 9)

    def test_housekeeping_grid_hides_patient_details_even_on_cache_hit(self):
        """F06: privileged cached payload must be projected before delivery."""
        sensitive = {"beds": [{"bed_code": "TEST-1", "status": "OCCUPIED", "patient_name": "Synthetic Person", "patient_id": 123, "primary_diagnosis": "synthetic diagnosis", "admission_id": 456, "acuity_level": "ESI_2"}]}
        redis = SimpleNamespace(get=AsyncMock(return_value=json.dumps(sensitive)))
        response = complete(self.module.get_bed_grid(self.actor, Mock(), redis))
        forbidden = {"patient_name", "patient_id", "primary_diagnosis", "admission_id", "encounter_id", "acuity_level"}
        for bed in response["beds"]:
            self.assertFalse(forbidden.intersection(k for k, v in bed.items() if v is not None), "F06: housekeeping received clinical identifiers/details")


class RecoveryAndCacheTests(unittest.TestCase):
    def test_auth_requests_are_not_idempotency_cached(self):
        """F22: anonymous keys must never replay login/refresh token responses."""
        module = load_app("gateway")
        for path in ("login", "refresh", "reset-password", "forgot-password"):
            with self.subTest(path=path):
                request = SimpleNamespace(headers={"idempotency-key": "shared-synthetic-key"}, method="POST", state=SimpleNamespace(user_id=None))
                self.assertIsNone(module._build_idempotency_key(request, True, "auth", path), "F22: recovery/auth response is eligible for anonymous caching")

    def test_revocation_failure_is_not_reported_as_success(self):
        """F10: fail safely or persist a durable alternative on Redis outage."""
        module = load_app("auth")
        db = SimpleNamespace(execute=AsyncMock())
        with patch.object(module, "get_redis_client", AsyncMock(side_effect=ConnectionError("synthetic outage"))):
            with self.assertRaises((ConnectionError, HTTPException), msg="F10: revocation failure was swallowed"):
                complete(module.revoke_all_user_tokens(db, 42))

    def test_audit_storage_failure_is_not_silent(self):
        """F09: no durable fallback currently exists; failure must be observable."""
        module = load_app("patient")
        db = SimpleNamespace(add=Mock(), commit=AsyncMock(side_effect=RuntimeError("synthetic storage failure")))
        with self.assertRaises((RuntimeError, HTTPException), msg="F09: audit failure was swallowed"):
            complete(module.log_audit(db, "READ_PATIENT", user_id=42, resource_id=123))

    def test_existing_patient_read_produces_audit_event(self):
        """F09: a successful read must leave an access event."""
        module = load_app("patient")
        record = SimpleNamespace(patient_id=123)
        result = Mock()
        result.scalars.return_value.first.return_value = record
        db = SimpleNamespace(execute=AsyncMock(return_value=result))
        audit = AsyncMock()
        with patch.object(module, "log_audit", audit):
            complete(module.get_patient_by_id(123, {"user_id": 42, "role": "NURSE"}, db))
        audit.assert_awaited()


class ProductionBootstrapTests(unittest.TestCase):
    def test_production_startup_does_not_create_demo_staff(self):
        """F02: production restarts cannot recreate known demo identities."""
        module = load_app("auth")
        admin_result = Mock()
        admin_result.scalars.return_value.first.return_value = SimpleNamespace(role="ADMIN")
        absent_result = Mock()
        absent_result.scalars.return_value.first.return_value = None
        db = SimpleNamespace(execute=AsyncMock(side_effect=[admin_result, absent_result, absent_result, absent_result]), add=Mock(), commit=AsyncMock())
        # Special methods are resolved on the type, not the instance.
        class Session:
            async def __aenter__(self):
                return db

            async def __aexit__(self, *args):
                return False

        import sys
        import types
        database = types.ModuleType("database")
        database.AsyncSessionLocal = Session
        lifecycle = module.lifespan(module.app)
        with patch.dict(sys.modules, {"database": database}), patch.dict(os.environ, {"ENV": "production"}), patch.object(module, "init_db", AsyncMock()), patch.object(module.security, "hashed_password", return_value="synthetic-hash"):
            complete(lifecycle.__aenter__())
            complete(lifecycle.__aexit__(None, None, None))
        self.assertEqual(db.add.call_count, 0, "F02: production startup provisioned demo staff")


class PatientIdentityTests(unittest.TestCase):
    def test_unknown_birth_date_is_not_fabricated(self):
        """F18: accepting unknown identity must not manufacture an exact DOB."""
        module = load_app("patient")
        payload = module.PatientCreate(first_name="Synthetic", last_name="Person", gender="OTHER")
        try:
            identity = module._parse_patient_identity(payload)
        except (ValueError, HTTPException):
            return  # Explicit rejection is also a valid policy.
        self.assertIsNone(identity[3], "F18: unknown DOB was silently replaced with an invented date")


if __name__ == "__main__":
    unittest.main()
