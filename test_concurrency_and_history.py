import asyncio
import os
from pathlib import Path
import httpx
import asyncpg
import json
from dotenv import load_dotenv

# Load local environment variables from .env
root_dir = Path(__file__).resolve().parent
load_dotenv(root_dir / ".env")

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")

# Dynamically construct database DSN from environment configuration
pg_user = os.getenv("POSTGRES_USER", "hip_admin")
pg_pass = os.getenv("POSTGRES_PASSWORD", "")
pg_db = os.getenv("POSTGRES_DB", "hospital_intelligence")
pg_host = os.getenv("POSTGRES_HOST", "localhost")
pg_port = os.getenv("POSTGRES_PORT", "5433")

default_pg_dsn = f"postgresql://{pg_user}:{pg_pass}@{pg_host}:{pg_port}/{pg_db}"
PG_DSN = os.getenv("TEST_PG_DSN", default_pg_dsn)
TEST_PASSWORD = os.getenv("TEST_USER_PASSWORD", "SecurePassword123!")


async def run_all_tests():
    print("=================================================================")
    print("   HIP CONCURRENCY & BED HISTORY VERIFICATION TEST SUITE        ")
    print("=================================================================")

    # Reset test state in Postgres
    conn = await asyncpg.connect(PG_DSN)
    try:
        await conn.execute("DELETE FROM cleaning_task;")
        await conn.execute("DELETE FROM equipment_allocation;")
        await conn.execute("DELETE FROM bed_allocation;")
        await conn.execute("UPDATE bed SET status = 'AVAILABLE', version = 1;")
        await conn.execute("UPDATE equipment SET status = 'AVAILABLE', version = 1;")
    finally:
        await conn.close()

    # 0. Check Gateway Health & Bed Grid
    async with httpx.AsyncClient(base_url=GATEWAY_URL, timeout=10.0) as client:
        # Register/Login staff to get token
        await client.post("/auth/register", json={
            "username": "nurse_carol",
            "email": "carol@hospital.org",
            "password": TEST_PASSWORD,
            "full_name": "Carol Danvers, RN",
            "role": "NURSE",
            "department": "EMERGENCY"
        })
        login_res = await client.post("/auth/login", json={
            "email": "carol@hospital.org",
            "password": TEST_PASSWORD
        })
        assert login_res.status_code == 200, f"Login failed: {login_res.text}"
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Initialize Bed Grid (triggers seed if empty)
        grid_res = await client.get("/beds/grid", headers=headers)
        assert grid_res.status_code == 200, f"Failed grid fetch: {grid_res.text}"
        beds = grid_res.json()["beds"]
        print(f" Grid initialized with {len(beds)} physical beds.")
        
        # Register 10 Test Patients for concurrent testing
        test_patients = []
        for i in range(1, 11):
            p = (await client.post("/patients/register", json={
                "first_name": f"Patient_{i}", "last_name": "Test", "date_of_birth": "1990-01-01", "gender": "OTHER"
            }, headers=headers)).json()
            test_patients.append(p)
        print(f" Registered {len(test_patients)} test patients.")

        # -------------------------------------------------------------
        # TEST 1: Dynamic Optimistic Locking Concurrency Test
        # -------------------------------------------------------------
        print("\n--- TEST 1: Simultaneous Bed Reservation (Optimistic Locking) ---")
        target_bed = "ER-101"
        print(f"Firing 10 simultaneous workers attempting to reserve '{target_bed}' for 10 different patients at the same instant...")

        async def attempt_reservation(worker_idx: int):
            pat = test_patients[worker_idx]
            async with httpx.AsyncClient(base_url=GATEWAY_URL, timeout=10.0) as w_client:
                return await w_client.put(
                    f"/beds/reserve/{target_bed}",
                    json={
                        "patient_id": pat["patient_id"],
                        "primary_diagnosis": f"Emergency Triage Worker {worker_idx+1}",
                        "acuity_level": "ESI_2"
                    },
                    headers=headers
                )

        tasks = [attempt_reservation(i) for i in range(10)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        success_count = sum(1 for r in results if not isinstance(r, Exception) and r.status_code == 200)
        conflict_count = sum(1 for r in results if not isinstance(r, Exception) and r.status_code == 409)
        other_errors = [r for r in results if isinstance(r, Exception) or (not isinstance(r, Exception) and r.status_code not in (200, 409))]

        print(f"  -> Successes (HTTP 200): {success_count}")
        print(f"  -> Conflicts (HTTP 409): {conflict_count}")
        if other_errors:
            print(f"  -> Other responses: {other_errors}")

        assert success_count == 1, f"Expected exactly 1 success, got {success_count}"
        assert conflict_count == 9, f"Expected exactly 9 conflicts (409), got {conflict_count}"
        print(" PASS: Optimistic locking correctly permitted exactly 1 reservation and rejected 9 concurrent race attempts!")

        # -------------------------------------------------------------
        # TEST 2: PostgreSQL Partial Unique Index Database Enforcement
        # -------------------------------------------------------------
        print("\n--- TEST 2: Database-Engine Partial Unique Index Enforcement ---")
        conn = await asyncpg.connect(PG_DSN)
        try:
            # Bed ER-101 is already RESERVED. Let's attempt a direct SQL INSERT into bed_allocation
            bed_row = await conn.fetchrow("SELECT bed_id FROM bed WHERE bed_code = 'ER-101';")
            bed_id = bed_row["bed_id"]

            print(f"Attempting illegal raw SQL INSERT for active stay on bed_id={bed_id}...")
            duplicate_caught = False
            try:
                await conn.execute(
                    "INSERT INTO bed_allocation (bed_id, admission_id, status, start_datetime) VALUES ($1, 9999, 'RESERVED', NOW());",
                    bed_id
                )
            except asyncpg.exceptions.UniqueViolationError as e:
                duplicate_caught = True
                print(f"  -> PostgreSQL Engine threw UniqueViolation: {e}")

            assert duplicate_caught, "PostgreSQL partial unique index failed to block duplicate active bed allocation!"
            print(" PASS: PostgreSQL partial unique index 'uq_single_active_bed_allocation' strictly guarantees single active stay!")
        finally:
            await conn.close()

        # -------------------------------------------------------------
        # TEST 3: Equipment Dynamic Optimistic Locking & Partial Index
        # -------------------------------------------------------------
        print("\n--- TEST 3: Simultaneous Equipment Allocation ---")
        eq_list_res = await client.get("/beds/equipment/list", headers=headers)
        eq_items = eq_list_res.json()["equipment"]
        target_eq = next(e for e in eq_items if e["status"] == "AVAILABLE")
        print(f"Firing 5 simultaneous workers allocating equipment '{target_eq['equipment_name']}' (ID: {target_eq['equipment_id']})...")

        async def attempt_eq_allocation(worker_id: int):
            async with httpx.AsyncClient(base_url=GATEWAY_URL, timeout=10.0) as w_client:
                return await w_client.post(
                    "/beds/equipment/allocate",
                    json={
                        "equipment_id": target_eq["equipment_id"],
                        "bed_code": target_bed
                    },
                    headers=headers
                )

        eq_tasks = [attempt_eq_allocation(i) for i in range(1, 6)]
        eq_results = await asyncio.gather(*eq_tasks, return_exceptions=True)

        eq_success = sum(1 for r in eq_results if not isinstance(r, Exception) and r.status_code == 200)
        eq_conflict = sum(1 for r in eq_results if not isinstance(r, Exception) and r.status_code == 409)

        print(f"  -> Equipment Allocation Successes (HTTP 200): {eq_success}")
        print(f"  -> Equipment Allocation Conflicts (HTTP 409): {eq_conflict}")

        assert eq_success == 1, f"Expected 1 equipment allocation success, got {eq_success}"
        assert eq_conflict == 4, f"Expected 4 equipment allocation conflicts, got {eq_conflict}"
        print(" PASS: Equipment concurrency protection verified!")

        # -------------------------------------------------------------
        # TEST 4: Full Lifecycle & Complete Historical Audit Retention
        # -------------------------------------------------------------
        print("\n--- TEST 4: Full Patient Lifecycle & History Preservation ---")
        # 1. Confirm Arrival: RESERVED -> OCCUPIED
        admit_res = await client.put(f"/beds/admit/{target_bed}", headers=headers)
        assert admit_res.status_code == 200
        print(f" Patient arrived: {target_bed} is now OCCUPIED.")

        # 2. Discharge Bed: OCCUPIED -> DIRTY
        disc_res = await client.put(f"/beds/discharge/{target_bed}", headers=headers)
        assert disc_res.status_code == 200
        print(f" Patient discharged: {target_bed} transitioned to DIRTY. Cleaning task created.")

        # 3. EVS Cleaning Cycle: DIRTY -> CLEANING_IN_PROGRESS -> AVAILABLE
        clean_res = await client.get("/beds/cleaning/tasks?status_filter=PENDING", headers=headers)
        tasks = clean_res.json()["tasks"]
        bed_task = next(t for t in tasks if t["bed_code"] == target_bed)
        cleaning_id = bed_task["cleaning_id"]
        print(f" EVS starting cleaning task #{cleaning_id}...")

        await client.put(f"/beds/cleaning/start/{cleaning_id}", headers=headers)
        await client.put(f"/beds/cleaning/complete/{cleaning_id}", headers=headers)
        print(f" EVS completed cleaning. Bed {target_bed} is now AVAILABLE again.")

        # 4. Check that Bed ER-101 can be reserved AGAIN by a second patient!
        re_pat = test_patients[1]
        print(f"Attempting new reservation on '{target_bed}' for Patient #{re_pat['patient_id']} ({re_pat['first_name']})...")
        res2 = await client.put(
            f"/beds/reserve/{target_bed}",
            json={
                "patient_id": re_pat["patient_id"],
                "primary_diagnosis": "Post-Op Recovery",
                "acuity_level": "ESI_3"
            },
            headers=headers
        )
        assert res2.status_code == 200, f"Re-reservation failed: {res2.text}"
        print(f" Bed '{target_bed}' successfully reserved for Patient #{re_pat['patient_id']}!")

        # 5. Verify Database Ledger: Both stays are in bed_allocation!
        conn = await asyncpg.connect(PG_DSN)
        try:
            stays = await conn.fetch(
                "SELECT allocation_id, bed_id, admission_id, status, start_datetime, end_datetime FROM bed_allocation WHERE bed_id = $1 ORDER BY allocation_id ASC;",
                bed_id
            )
            print(f"\n--- Stays Ledger for Bed {target_bed} in PostgreSQL ---")
            for s in stays:
                print(f"  Stay #{s['allocation_id']}: Admission #{s['admission_id']} | Status: {s['status']} | Start: {s['start_datetime']} | End: {s['end_datetime']}")

            assert len(stays) == 2, f"Expected 2 historical stay records, found {len(stays)}"
            assert stays[0]["status"] == "COMPLETED" and stays[0]["end_datetime"] is not None, "First stay was not marked COMPLETED with end_datetime"
            assert stays[1]["status"] == "RESERVED" and stays[1]["end_datetime"] is None, "Second stay is not active RESERVED"
            print(" PASS: 100% of historical bed stays are preserved! Zero history loss!")
        finally:
            await conn.close()

    print("\n=================================================================")
    print("  ALL CONCURRENCY, OPTIMISTIC LOCKING, AND HISTORY TESTS PASSED! ")
    print("=================================================================")

if __name__ == "__main__":
    asyncio.run(run_all_tests())
