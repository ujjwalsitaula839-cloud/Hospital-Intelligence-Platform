"""
Hermetic Unit Tests for bed-service Object-Level Authorization (BOLA) & State Guards.
"""
import asyncio
import os
import unittest
from unittest.mock import AsyncMock, MagicMock

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


class TestBedServiceBolaAuthz(unittest.TestCase):
    def test_claim_cleaning_task_success(self):
        bed = MagicMock(bed_code="ER-101", status="NEEDS_CLEANING", version=1)
        task = MagicMock(cleaning_id=5, bed_id=1, status="IN_PROGRESS", personnel_id=11, bed=bed)
        update_res = MagicMock(rowcount=1)

        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[update_res, _scalar_result(task)])

        user = {"user_id": 11, "role": "CLEANING_CREW"}
        claimed = asyncio.run(authz.claim_cleaning_task(db, 5, user))
        self.assertEqual(claimed.cleaning_id, 5)
        self.assertEqual(claimed.personnel_id, 11)

    def test_claim_cleaning_task_conflict_when_already_in_progress(self):
        existing = MagicMock(cleaning_id=5, bed_id=1, status="IN_PROGRESS", personnel_id=10, bed=None)
        update_res = MagicMock(rowcount=0)

        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(side_effect=[update_res, _scalar_result(existing)])

        attacker = {"user_id": 22, "role": "CLEANING_CREW"}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(authz.claim_cleaning_task(db, 5, attacker))

        self.assertEqual(ctx.exception.status_code, 409)
        db.commit.assert_awaited_once()

    def test_claim_cleaning_task_not_found(self):
        update_res = MagicMock(rowcount=0)
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[update_res, _scalar_result(None)])

        user = {"user_id": 22, "role": "CLEANING_CREW"}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(authz.claim_cleaning_task(db, 999, user))

        self.assertEqual(ctx.exception.status_code, 404)

    def test_complete_cleaning_blocks_other_cleaner_with_403(self):
        task = MagicMock(cleaning_id=7, status="IN_PROGRESS", personnel_id=10, bed=None)
        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(return_value=_scalar_result(task))

        other_cleaner = {"user_id": 99, "role": "CLEANING_CREW"}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(authz.authorize_cleaning_completion(db, 7, other_cleaner))

        self.assertEqual(ctx.exception.status_code, 403)
        db.commit.assert_awaited_once()

    def test_complete_cleaning_allows_owner_and_admin(self):
        task = MagicMock(cleaning_id=7, status="IN_PROGRESS", personnel_id=10, bed=None)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_scalar_result(task))

        res_owner = asyncio.run(
            authz.authorize_cleaning_completion(db, 7, {"user_id": 10, "role": "CLEANING_CREW"})
        )
        self.assertIs(res_owner, task)

        res_admin = asyncio.run(
            authz.authorize_cleaning_completion(db, 7, {"user_id": 1, "role": "ADMIN"})
        )
        self.assertIs(res_admin, task)

    def test_complete_cleaning_blocks_pending_task_with_409(self):
        task = MagicMock(cleaning_id=7, status="PENDING", personnel_id=None, bed=None)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_scalar_result(task))

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                authz.authorize_cleaning_completion(db, 7, {"user_id": 10, "role": "CLEANING_CREW"})
            )

        self.assertEqual(ctx.exception.status_code, 409)

    def test_release_equipment_rejects_double_release_with_409(self):
        alloc = MagicMock(equipment_allocation_id=12, equipment_id=3, status="RELEASED")
        db = AsyncMock()
        db.get = AsyncMock(return_value=alloc)
        db.execute = AsyncMock(return_value=MagicMock(rowcount=0))

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                authz.authorize_and_release_equipment(db, 12, {"user_id": 5, "role": "NURSE"})
            )

        self.assertEqual(ctx.exception.status_code, 409)

    def test_release_equipment_route_blocks_cleaning_crew_with_403(self):
        client = TestClient(main.app)
        resp = client.put(
            "/equipment/release/12",
            headers={
                "X-Gateway-Secret": os.environ["INTERNAL_SERVICE_SECRET"],
                "X-User-Id": "22",
                "X-User-Role": "CLEANING_CREW",
                "X-User-Username": "cleaner_bob",
            },
        )
        self.assertEqual(resp.status_code, 403)

    def test_release_cleaning_task_owner_and_admin(self):
        bed = MagicMock(bed_code="ER-102", status="CLEANING_IN_PROGRESS", version=1)
        task = MagicMock(cleaning_id=8, status="IN_PROGRESS", personnel_id=10, bed=bed)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_scalar_result(task))

        res_owner = asyncio.run(
            authz.authorize_cleaning_release(db, 8, {"user_id": 10, "role": "CLEANING_CREW"}, "shift ending")
        )
        self.assertEqual(res_owner.status, "PENDING")
        self.assertIsNone(res_owner.personnel_id)
        self.assertEqual(bed.status, "NEEDS_CLEANING")

    def test_release_cleaning_task_blocks_other_cleaner(self):
        task = MagicMock(cleaning_id=8, status="IN_PROGRESS", personnel_id=10, bed=None)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_scalar_result(task))

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                authz.authorize_cleaning_release(db, 8, {"user_id": 99, "role": "CLEANING_CREW"})
            )
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()

