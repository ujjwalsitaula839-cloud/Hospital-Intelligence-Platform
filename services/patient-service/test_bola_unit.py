"""
Hermetic Unit Tests for patient-service Object-Level Authorization (BOLA),
HIPAA READ audit logging, and bounded patient directory pagination.
"""
import asyncio
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://hip_admin:dummy@localhost:5432/hospital_intelligence",
)
os.environ.setdefault("INTERNAL_SERVICE_SECRET", "unit-test-secret")

from fastapi import HTTPException
from fastapi.testclient import TestClient

import authz
import main


def _scalar_result(value):
    result = MagicMock()
    scalars = MagicMock()
    scalars.first.return_value = value
    result.scalars.return_value = scalars
    return result


class TestPatientServiceBolaAuthz(unittest.TestCase):
    def test_complete_assignment_blocks_other_nurse_with_403(self):
        assignment = MagicMock(assignment_id=4, nurse_id=101, status="ACTIVE")
        db = AsyncMock()
        db.add = MagicMock()
        db.get = AsyncMock(return_value=assignment)

        other_nurse = {"user_id": 202, "role": "NURSE"}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(authz.authorize_nurse_assignment_completion(db, 4, other_nurse))

        self.assertEqual(ctx.exception.status_code, 403)
        db.commit.assert_awaited_once()

    def test_complete_assignment_allows_assigned_nurse_and_doctor(self):
        assignment = MagicMock(assignment_id=4, nurse_id=101, status="ACTIVE")

        for user in ({"user_id": 101, "role": "NURSE"}, {"user_id": 303, "role": "DOCTOR"}):
            db = AsyncMock()
            db.get = AsyncMock(return_value=assignment)
            db.execute = AsyncMock(return_value=MagicMock(rowcount=1))

            res = asyncio.run(authz.authorize_nurse_assignment_completion(db, 4, user))
            self.assertIs(res, assignment)
            db.refresh.assert_awaited_once_with(assignment)

    def test_complete_assignment_rejects_already_completed_with_409(self):
        assignment = MagicMock(assignment_id=4, nurse_id=101, status="COMPLETED")
        db = AsyncMock()
        db.get = AsyncMock(return_value=assignment)
        db.execute = AsyncMock(return_value=MagicMock(rowcount=0))

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                authz.authorize_nurse_assignment_completion(db, 4, {"user_id": 101, "role": "NURSE"})
            )

        self.assertEqual(ctx.exception.status_code, 409)

    def test_verify_admission_care_scope_modes(self):
        nurse = {"user_id": 202, "role": "NURSE"}

        with patch.dict(os.environ, {"BOLA_POLICY_MODE": "audit_only"}):
            db_audit = AsyncMock()
            db_audit.execute = AsyncMock(return_value=_scalar_result(None))
            # audit_only does not raise even without active assignment
            asyncio.run(authz.verify_admission_care_scope(db_audit, 15, nurse))

        with patch.dict(os.environ, {"BOLA_POLICY_MODE": "enforce"}):
            db_enforce = AsyncMock()
            db_enforce.add = MagicMock()
            db_enforce.execute = AsyncMock(return_value=_scalar_result(None))
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(authz.verify_admission_care_scope(db_enforce, 15, nurse))
            self.assertEqual(ctx.exception.status_code, 403)
            db_enforce.commit.assert_awaited_once()

    def test_records_endpoint_enforces_pagination_bounds(self):
        client = TestClient(main.app)
        resp = client.get(
            "/records?limit=5000",
            headers={
                "X-Gateway-Secret": os.environ["INTERNAL_SERVICE_SECRET"],
                "X-User-Id": "10",
                "X-User-Role": "NURSE",
                "X-User-Username": "nurse_carol",
            },
        )
        self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()

