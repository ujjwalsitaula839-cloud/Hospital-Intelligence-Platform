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

passed = 0
failed = 0


def test_result(name: str, condition: bool, detail: str = ""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} -- {detail}")


async def register_and_login(client: httpx.AsyncClient, username: str, email: str, full_name: str, role: str, department: str = "EMERGENCY") -> dict:
    """Register user (idempotent) and login, returning {token, headers, personnel_id}."""
    await client.post("/auth/register", json={
        "username": username, "email": email, "password": TEST_PASSWORD,
        "full_name": full_name, "role": role, "department": department
    })
    login_res = await client.post("/auth/login", json={"email": email, "password": TEST_PASSWORD})
    assert login_res.status_code == 200, f"Login failed for {email}: {login_res.text}"
    data = login_res.json()
    return {
        "token": data["access_token"],
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
        "personnel_id": data["personnel_id"],
        "role": data["role"],
        "username": data["username"],
    }


async def run_all_tests():
    global passed, failed
    print("=" * 70)
    print("   HIP RBAC, CONCURRENCY & SECURITY VERIFICATION TEST SUITE")
    print("=" * 70)

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

    async with httpx.AsyncClient(base_url=GATEWAY_URL, timeout=15.0) as client:

        # =========================================================
        # SETUP: Register 3 staff members with different roles
        # =========================================================
        print("\n--- SETUP: Registering staff members ---")
        nurse = await register_and_login(client, "nurse_carol", "carol@hospital.org", "Carol Danvers, RN", "NURSE")
        cleaner = await register_and_login(client, "cleaner_bob", "bob@hospital.org", "Bob Martinez, EVS", "CLEANING_CREW", "ENVIRONMENTAL_SERVICES")
        doctor = await register_and_login(client, "doctor_alice", "alice@hospital.org", "Dr. Alice Chen, MD", "DOCTOR")
        print(f"  Nurse Carol (ID: {nurse['personnel_id']}), Cleaner Bob (ID: {cleaner['personnel_id']}), Doctor Alice (ID: {doctor['personnel_id']})")

        # Initialize Bed Grid (triggers seed if empty)
        grid_res = await client.get("/beds/grid", headers=nurse["headers"])
        assert grid_res.status_code == 200, f"Failed grid fetch: {grid_res.text}"
        beds = grid_res.json()["beds"]
        print(f"  Grid initialized with {len(beds)} physical beds.\n")

        # Register test patients
        test_patients = []
        for i in range(1, 11):
            p = (await client.post("/patients/register", json={
                "first_name": f"Patient_{i}", "last_name": "Test", "date_of_birth": "1990-01-01", "gender": "OTHER"
            }, headers=nurse["headers"])).json()
            test_patients.append(p)
        print(f"  Registered {len(test_patients)} test patients.\n")

        target_bed = "ER-101"

        # =========================================================
        # TEST 1: RBAC — Cleaner BLOCKED from bed reservation
        # =========================================================
        print("--- TEST 1: RBAC — Cleaner Bob attempts bed reservation ---")
        res = await client.put(f"/beds/reserve/{target_bed}", json={
            "patient_id": test_patients[0]["patient_id"],
            "primary_diagnosis": "Test Diagnosis", "acuity_level": "ESI_3"
        }, headers=cleaner["headers"])
        test_result("Cleaner Bob -> PUT /beds/reserve -> HTTP 403", res.status_code == 403, f"Got {res.status_code}: {res.text}")

        # =========================================================
        # TEST 2: RBAC — Nurse Carol successfully reserves bed
        # =========================================================
        print("\n--- TEST 2: RBAC — Nurse Carol reserves bed ---")
        res = await client.put(f"/beds/reserve/{target_bed}", json={
            "patient_id": test_patients[0]["patient_id"],
            "primary_diagnosis": "Emergency Triage", "acuity_level": "ESI_2"
        }, headers=nurse["headers"])
        test_result("Nurse Carol -> PUT /beds/reserve -> HTTP 200", res.status_code == 200, f"Got {res.status_code}: {res.text}")

        # =========================================================
        # TEST 3: RBAC — Cleaner BLOCKED from admitting bed
        # =========================================================
        print("\n--- TEST 3: RBAC — Cleaner Bob attempts bed admission ---")
        res = await client.put(f"/beds/admit/{target_bed}", headers=cleaner["headers"])
        test_result("Cleaner Bob -> PUT /beds/admit -> HTTP 403", res.status_code == 403, f"Got {res.status_code}: {res.text}")

        # Nurse admits the bed
        admit_res = await client.put(f"/beds/admit/{target_bed}", headers=nurse["headers"])
        assert admit_res.status_code == 200, f"Admission failed: {admit_res.text}"

        # =========================================================
        # TEST 4: HIPAA — Cleaner BLOCKED from patient records
        # =========================================================
        print("\n--- TEST 4: HIPAA — Cleaner Bob attempts patient data access ---")

        res = await client.get("/patients/records", headers=cleaner["headers"])
        test_result("Cleaner Bob -> GET /patients/records -> HTTP 403", res.status_code == 403, f"Got {res.status_code}")

        res = await client.get(f"/patients/patient/{test_patients[0]['patient_id']}", headers=cleaner["headers"])
        test_result("Cleaner Bob -> GET /patients/patient/{id} -> HTTP 403", res.status_code == 403, f"Got {res.status_code}")

        res = await client.get("/patients/search?first_name=Patient_1", headers=cleaner["headers"])
        test_result("Cleaner Bob -> GET /patients/search -> HTTP 403", res.status_code == 403, f"Got {res.status_code}")

        # Nurse can access patient records
        res = await client.get("/patients/records", headers=nurse["headers"])
        test_result("Nurse Carol -> GET /patients/records -> HTTP 200", res.status_code == 200, f"Got {res.status_code}")

        # =========================================================
        # TEST 5: RBAC — Nurse BLOCKED from cleaning tasks
        # =========================================================
        print("\n--- TEST 5: RBAC — Nurse attempts cleaning workflow ---")
        # First discharge the bed (as nurse) to create a cleaning task
        disc_res = await client.put(f"/beds/discharge/{target_bed}", headers=nurse["headers"])
        assert disc_res.status_code == 200, f"Discharge failed: {disc_res.text}"

        # Get cleaning tasks
        clean_res = await client.get("/beds/cleaning/tasks?status_filter=PENDING", headers=nurse["headers"])
        assert clean_res.status_code == 200, f"Failed to fetch cleaning tasks: {clean_res.text}"
        tasks = clean_res.json()["tasks"]
        bed_task = next((t for t in tasks if t["bed_code"] == target_bed), None)
        assert bed_task, "No cleaning task found for discharged bed"
        cleaning_id = bed_task["cleaning_id"]

        # Nurse tries to start cleaning -> should be blocked
        res = await client.put(f"/beds/cleaning/start/{cleaning_id}", headers=nurse["headers"])
        test_result("Nurse Carol -> PUT /beds/cleaning/start -> HTTP 403", res.status_code == 403, f"Got {res.status_code}: {res.text}")

        # =========================================================
        # TEST 6: RBAC — Cleaner Bob completes cleaning workflow
        # =========================================================
        print("\n--- TEST 6: RBAC — Cleaner Bob performs cleaning ---")

        # Bob can view cleaning tasks (CLEANING_CREW is allowed)
        res = await client.get("/beds/cleaning/tasks?status_filter=PENDING", headers=cleaner["headers"])
        test_result("Cleaner Bob -> GET /beds/cleaning/tasks -> HTTP 200", res.status_code == 200, f"Got {res.status_code}")

        # Bob starts cleaning
        res = await client.put(f"/beds/cleaning/start/{cleaning_id}", headers=cleaner["headers"])
        test_result("Cleaner Bob -> PUT /beds/cleaning/start -> HTTP 200", res.status_code == 200, f"Got {res.status_code}: {res.text}")

        # Bob completes cleaning
        res = await client.put(f"/beds/cleaning/complete/{cleaning_id}", headers=cleaner["headers"])
        test_result("Cleaner Bob -> PUT /beds/cleaning/complete -> HTTP 200", res.status_code == 200, f"Got {res.status_code}: {res.text}")

        # =========================================================
        # TEST 7: Tamper-Proof Audit Trail — DB records Bob's ID
        # =========================================================
        print("\n--- TEST 7: Tamper-Proof Audit Trail ---")
        conn = await asyncpg.connect(PG_DSN)
        try:
            row = await conn.fetchrow(
                "SELECT personnel_id FROM cleaning_task WHERE cleaning_id = $1;", cleaning_id
            )
            actual_cleaner_id = row["personnel_id"]
            test_result(
                f"cleaning_task.personnel_id == Bob's ID ({cleaner['personnel_id']})",
                actual_cleaner_id == cleaner["personnel_id"],
                f"Expected {cleaner['personnel_id']}, got {actual_cleaner_id}"
            )

            # Also verify the bed allocation was assigned by Carol (nurse)
            alloc_row = await conn.fetchrow(
                "SELECT assigned_by_personnel_id FROM bed_allocation ORDER BY allocation_id ASC LIMIT 1;"
            )
            actual_assigner = alloc_row["assigned_by_personnel_id"]
            test_result(
                f"bed_allocation.assigned_by_personnel_id == Carol's ID ({nurse['personnel_id']})",
                actual_assigner == nurse["personnel_id"],
                f"Expected {nurse['personnel_id']}, got {actual_assigner}"
            )
        finally:
            await conn.close()

        # =========================================================
        # TEST 8: Header Spoofing — Forged X-User-Role stripped
        # =========================================================
        print("\n--- TEST 8: Header Spoofing Prevention ---")
        # Cleaner Bob sends request with forged X-User-Role: ADMIN header
        spoofed_headers = {
            **cleaner["headers"],
            "X-User-Role": "ADMIN",
            "X-User-Id": "99999",
        }
        res = await client.put(f"/beds/reserve/{target_bed}", json={
            "patient_id": test_patients[1]["patient_id"],
            "primary_diagnosis": "Spoofed Admin", "acuity_level": "ESI_1"
        }, headers=spoofed_headers)
        test_result(
            "Forged X-User-Role: ADMIN header -> still rejected as CLEANING_CREW (HTTP 403)",
            res.status_code == 403,
            f"Got {res.status_code} — gateway failed to strip forged headers!"
        )

        # Forged X-Internal-Token from external client
        spoofed_internal = {
            **cleaner["headers"],
            "X-Internal-Token": "some_guessed_secret",
        }
        res = await client.get(f"/patients/patient/{test_patients[0]['patient_id']}", headers=spoofed_internal)
        test_result(
            "Forged X-Internal-Token header -> still rejected (gateway strips x-internal-*)",
            res.status_code == 403,
            f"Got {res.status_code} — gateway failed to strip forged internal token!"
        )

        # =========================================================
        # TEST 9: Dynamic Optimistic Locking Concurrency
        # =========================================================
        print("\n--- TEST 9: Simultaneous Bed Reservation (Optimistic Locking) ---")
        # Bed is now AVAILABLE again after cleaning. Reserve for concurrency test.
        print(f"Firing 10 simultaneous workers attempting to reserve '{target_bed}'...")

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
                    headers=nurse["headers"]
                )

        race_tasks = [attempt_reservation(i) for i in range(10)]
        results = await asyncio.gather(*race_tasks, return_exceptions=True)

        success_count = sum(1 for r in results if not isinstance(r, Exception) and r.status_code == 200)
        conflict_count = sum(1 for r in results if not isinstance(r, Exception) and r.status_code == 409)
        other_errors = [r for r in results if isinstance(r, Exception) or (not isinstance(r, Exception) and r.status_code not in (200, 409))]

        print(f"  -> Successes (HTTP 200): {success_count}")
        print(f"  -> Conflicts (HTTP 409): {conflict_count}")
        if other_errors:
            for e in other_errors:
                if isinstance(e, Exception):
                    print(f"  -> Exception: {e}")
                else:
                    print(f"  -> HTTP {e.status_code}: {e.text[:200]}")

        test_result("Exactly 1 reservation succeeds", success_count == 1, f"Got {success_count}")
        test_result("Exactly 9 conflicts rejected", conflict_count == 9, f"Got {conflict_count}")

        # =========================================================
        # TEST 10: PostgreSQL Constraints Enforcement (NOT NULL & Partial Unique Index)
        # =========================================================
        print("\n--- TEST 10: Database-Engine Constraints Enforcement ---")
        conn = await asyncpg.connect(PG_DSN)
        try:
            bed_row = await conn.fetchrow("SELECT bed_id FROM bed WHERE bed_code = 'ER-101';")
            bed_id = bed_row["bed_id"]

            # 10A: Verify NOT NULL constraint on assigned_by_personnel_id
            null_blocked = False
            try:
                await conn.execute(
                    "INSERT INTO bed_allocation (bed_id, admission_id, status, start_datetime) VALUES ($1, 9999, 'RESERVED', NOW());",
                    bed_id
                )
            except asyncpg.exceptions.NotNullViolationError:
                null_blocked = True

            test_result("Database NOT NULL constraint blocks unassigned bed_allocation", null_blocked, "NULL assigned_by_personnel_id was allowed!")

            # 10B: Verify partial unique index blocks duplicate active allocation
            duplicate_caught = False
            try:
                await conn.execute(
                    "INSERT INTO bed_allocation (bed_id, admission_id, assigned_by_personnel_id, status, start_datetime) VALUES ($1, 9999, $2, 'RESERVED', NOW());",
                    bed_id, nurse["personnel_id"]
                )
            except asyncpg.exceptions.UniqueViolationError:
                duplicate_caught = True

            test_result("PostgreSQL partial unique index blocks duplicate active allocation", duplicate_caught, "Duplicate was not blocked!")
        finally:
            await conn.close()

        # =========================================================
        # TEST 11: Equipment Concurrency
        # =========================================================
        print("\n--- TEST 11: Simultaneous Equipment Allocation ---")
        eq_list_res = await client.get("/beds/equipment/list", headers=nurse["headers"])
        eq_items = eq_list_res.json()["equipment"]
        target_eq = next(e for e in eq_items if e["status"] == "AVAILABLE")
        print(f"Firing 5 simultaneous workers allocating equipment '{target_eq['equipment_name']}'...")

        async def attempt_eq_allocation(worker_id: int):
            async with httpx.AsyncClient(base_url=GATEWAY_URL, timeout=10.0) as w_client:
                return await w_client.post(
                    "/beds/equipment/allocate",
                    json={"equipment_id": target_eq["equipment_id"], "bed_code": target_bed},
                    headers=nurse["headers"]
                )

        eq_tasks = [attempt_eq_allocation(i) for i in range(1, 6)]
        eq_results = await asyncio.gather(*eq_tasks, return_exceptions=True)

        eq_success = sum(1 for r in eq_results if not isinstance(r, Exception) and r.status_code == 200)
        eq_conflict = sum(1 for r in eq_results if not isinstance(r, Exception) and r.status_code == 409)

        test_result("Exactly 1 equipment allocation succeeds", eq_success == 1, f"Got {eq_success}")
        test_result("Exactly 4 equipment conflicts rejected", eq_conflict == 4, f"Got {eq_conflict}")

        # =========================================================
        # TEST 12: Doctor Alice — Cross-Role Positive Tests
        # =========================================================
        print("\n--- TEST 12: Doctor Alice — Cross-Role Positive Access ---")
        res = await client.get("/patients/records", headers=doctor["headers"])
        test_result("Doctor Alice -> GET /patients/records -> HTTP 200", res.status_code == 200, f"Got {res.status_code}")

        res = await client.get("/beds/cleaning/tasks", headers=doctor["headers"])
        test_result("Doctor Alice -> GET /beds/cleaning/tasks -> HTTP 403 (DOCTOR not in CLEANING_CREW|NURSE|ADMIN)",
                     res.status_code == 403, f"Got {res.status_code}")

    # =========================================================
    # FINAL SUMMARY
    # =========================================================
    print("\n" + "=" * 70)
    print(f"   RESULTS: {passed} PASSED  |  {failed} FAILED")
    print("=" * 70)
    if failed > 0:
        print("   [WARNING]  SOME TESTS FAILED — Review output above.")
    else:
        print("   [SUCCESS] ALL TESTS PASSED — RBAC, HIPAA, Concurrency & Security Verified!")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(run_all_tests())
