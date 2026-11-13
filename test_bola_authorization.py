"""
End-to-End Live BOLA (Broken Object Level Authorization) & State-Guard Verification Suite.
Tests same-role cross-user isolation, non-clinical equipment blocks, state-transition
guards (409), bounded pagination, and PostgreSQL HIPAA READ/DENIED audit trails
through the live Nginx -> FastAPI Gateway -> Microservices stack.
"""
import asyncio
import os
from pathlib import Path

import asyncpg
import httpx

try:
    from dotenv import load_dotenv
    root_dir = Path(__file__).resolve().parent
    load_dotenv(root_dir / ".env")
except ImportError:
    pass

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
pg_user = os.getenv("POSTGRES_USER", "hip_admin")
pg_pass = os.getenv("POSTGRES_PASSWORD", "")
pg_db = os.getenv("POSTGRES_DB", "hospital_intelligence")
pg_host = os.getenv("POSTGRES_HOST", "localhost")
pg_port = os.getenv("POSTGRES_PORT", "5431")
PG_DSN = os.getenv("TEST_PG_DSN", f"postgresql://{pg_user}:{pg_pass}@{pg_host}:{pg_port}/{pg_db}")
TEST_PASSWORD = os.getenv("TEST_USER_PASSWORD", "TestPassword123!")

passed = 0
failed = 0


def test_result(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} -- {detail}")


test_result.__test__ = False


async def login_user(client: httpx.AsyncClient, email: str, max_retries: int = 4) -> dict:
    for attempt in range(max_retries):
        resp = await client.post("/auth/login", json={"email": email, "password": TEST_PASSWORD})
        if resp.status_code == 429 and attempt < max_retries - 1:
            await asyncio.sleep(2.5 * (attempt + 1))
            continue
        assert resp.status_code == 200, f"Login failed for {email}: {resp.status_code} {resp.text}"
        data = resp.json()
        return {
            "token": data["access_token"],
            "headers": {"Authorization": f"Bearer {data['access_token']}"},
            "personnel_id": data["personnel_id"],
            "role": data["role"],
            "username": data["username"],
        }


async def complete_any_pending_cleaning(client: httpx.AsyncClient, admin_headers: dict, bed_code: str) -> None:
    tasks_res = await client.get("/beds/cleaning/tasks", headers=admin_headers)
    if tasks_res.status_code != 200:
        return
    for task in tasks_res.json().get("tasks", []):
        if task.get("bed_code") == bed_code and task.get("status") in ("PENDING", "IN_PROGRESS"):
            cid = task["cleaning_id"]
            if task["status"] == "PENDING":
                await client.put(f"/beds/cleaning/start/{cid}", headers=admin_headers)
            await client.put(f"/beds/cleaning/complete/{cid}", headers=admin_headers)


async def run_bola_suite() -> None:
    print("=" * 72)
    print("HOSPITAL INTELLIGENCE PLATFORM - BOLA AUTHORIZATION E2E TEST SUITE")
    print(f"Target Gateway: {GATEWAY_URL}")
    print("=" * 72)

    try:
        from passlib.context import CryptContext
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        hashed_pw = pwd_context.hash(TEST_PASSWORD)
    except ImportError:
        hashed_pw = "$2b$12$/8LclTB2Z1MZvRY/c.npF.xEY99BYJI4GhV2kfyXRWdNJokzvprEa"

    conn = await asyncpg.connect(PG_DSN)
    try:
        await conn.execute(
            """
            DELETE FROM personnel
            WHERE username IN (
                'bola_cleaner_1', 'bola_cleaner_2',
                'bola_nurse_1', 'bola_nurse_2',
                'bola_doctor', 'bola_admin'
            );
            """
        )
        await conn.execute(
            """
            INSERT INTO personnel (username, email, hashed_password, full_name, role, department, is_active, must_change_password)
            VALUES
                ('bola_cleaner_1', 'bola_cleaner_1@hospital.org', $1, 'BOLA Cleaner One', 'CLEANING_CREW', 'ENVIRONMENTAL_SERVICES', true, false),
                ('bola_cleaner_2', 'bola_cleaner_2@hospital.org', $1, 'BOLA Cleaner Two', 'CLEANING_CREW', 'ENVIRONMENTAL_SERVICES', true, false),
                ('bola_nurse_1',   'bola_nurse_1@hospital.org',   $1, 'BOLA Nurse One',   'NURSE',         'EMERGENCY', true, false),
                ('bola_nurse_2',   'bola_nurse_2@hospital.org',   $1, 'BOLA Nurse Two',   'NURSE',         'EMERGENCY', true, false),
                ('bola_doctor',    'bola_doctor@hospital.org',    $1, 'BOLA Doctor',      'DOCTOR',        'EMERGENCY', true, false),
                ('bola_admin',     'bola_admin@hospital.org',     $1, 'BOLA Admin',       'ADMIN',         'ADMINISTRATION', true, false);
            """,
            hashed_pw,
        )
    finally:
        await conn.close()

    async with httpx.AsyncClient(base_url=GATEWAY_URL, timeout=30.0) as client:
        cleaner1 = await login_user(client, "bola_cleaner_1@hospital.org")
        cleaner2 = await login_user(client, "bola_cleaner_2@hospital.org")
        nurse1 = await login_user(client, "bola_nurse_1@hospital.org")
        nurse2 = await login_user(client, "bola_nurse_2@hospital.org")
        doctor = await login_user(client, "bola_doctor@hospital.org")
        admin = await login_user(client, "bola_admin@hospital.org")

        # Register dedicated patient for BOLA tests
        p_res = await client.post(
            "/patients/register",
            json={
                "first_name": "Bola",
                "last_name": "Verification",
                "date_of_birth": "1988-05-12",
                "gender": "OTHER",
            },
            headers=nurse1["headers"],
        )
        assert p_res.status_code in (200, 201), f"Patient creation failed: {p_res.status_code} {p_res.text}"
        patient_id = p_res.json()["patient_id"]

        # Pick an AVAILABLE bed dynamically
        grid_res = await client.get("/beds/grid", headers=nurse1["headers"])
        assert grid_res.status_code == 200, f"Grid fetch failed: {grid_res.text}"
        avail_beds = [b["bed_code"] for b in grid_res.json()["beds"] if b["status"] == "AVAILABLE"]
        assert avail_beds, "No AVAILABLE beds found for BOLA verification"
        target_bed = avail_beds[0]
        print(f"\nUsing bed {target_bed} and patient #{patient_id} for BOLA checks.\n")

        # -----------------------------------------------------------------
        # 1. SAME-ROLE CROSS-USER BOLA IN HOUSEKEEPING (bed-service)
        # -----------------------------------------------------------------
        print("--- 1. Cleaning Task Ownership & Atomic Claim ---")
        res = await client.put(
            f"/beds/reserve/{target_bed}",
            json={"patient_id": patient_id, "primary_diagnosis": "BOLA Check", "acuity_level": "ESI_3"},
            headers=nurse1["headers"],
        )
        assert res.status_code == 200, f"Reserve failed: {res.text}"
        assert (await client.put(f"/beds/admit/{target_bed}", headers=nurse1["headers"])).status_code == 200
        assert (await client.put(f"/beds/discharge/{target_bed}", headers=nurse1["headers"])).status_code == 200

        tasks = (await client.get("/beds/cleaning/tasks?status_filter=PENDING", headers=cleaner1["headers"])).json()["tasks"]
        matching = [t for t in tasks if t["bed_code"] == target_bed]
        assert matching, f"No PENDING cleaning task found for {target_bed}"
        cleaning_id = matching[0]["cleaning_id"]

        # Cannot complete before starting (PENDING -> COMPLETED blocked with 409)
        r_early = await client.put(f"/beds/cleaning/complete/{cleaning_id}", headers=cleaner1["headers"])
        test_result(
            "Complete PENDING cleaning task before start -> HTTP 409",
            r_early.status_code == 409,
            f"Got {r_early.status_code}: {r_early.text}",
        )

        # Cleaner 1 claims task
        r_start1 = await client.put(f"/beds/cleaning/start/{cleaning_id}", headers=cleaner1["headers"])
        test_result("Cleaner 1 starts PENDING task -> HTTP 200", r_start1.status_code == 200, r_start1.text)

        # Cleaner 2 tries to hijack claim -> 409
        r_steal_start = await client.put(f"/beds/cleaning/start/{cleaning_id}", headers=cleaner2["headers"])
        test_result(
            "Cleaner 2 tries to hijack already IN_PROGRESS task -> HTTP 409",
            r_steal_start.status_code == 409,
            f"Got {r_steal_start.status_code}: {r_steal_start.text}",
        )

        # Cleaner 2 tries to complete Cleaner 1's task -> 403
        r_steal_done = await client.put(f"/beds/cleaning/complete/{cleaning_id}", headers=cleaner2["headers"])
        test_result(
            "Cleaner 2 tries to complete Cleaner 1's cleaning task -> HTTP 403",
            r_steal_done.status_code == 403,
            f"Got {r_steal_done.status_code}: {r_steal_done.text}",
        )

        # Cleaner 1 completes own task -> 200
        r_done1 = await client.put(f"/beds/cleaning/complete/{cleaning_id}", headers=cleaner1["headers"])
        test_result("Cleaner 1 completes own IN_PROGRESS task -> HTTP 200", r_done1.status_code == 200, r_done1.text)

        # Concurrent claim race + Admin override test
        assert (
            await client.put(
                f"/beds/reserve/{target_bed}",
                json={"patient_id": patient_id, "primary_diagnosis": "BOLA Race Check", "acuity_level": "ESI_3"},
                headers=nurse1["headers"],
            )
        ).status_code == 200
        assert (await client.put(f"/beds/admit/{target_bed}", headers=nurse1["headers"])).status_code == 200
        assert (await client.put(f"/beds/discharge/{target_bed}", headers=nurse1["headers"])).status_code == 200

        tasks2 = (await client.get("/beds/cleaning/tasks?status_filter=PENDING", headers=cleaner1["headers"])).json()["tasks"]
        cleaning_id2 = [t["cleaning_id"] for t in tasks2 if t["bed_code"] == target_bed][0]
        race_res = await asyncio.gather(
            client.put(f"/beds/cleaning/start/{cleaning_id2}", headers=cleaner1["headers"]),
            client.put(f"/beds/cleaning/start/{cleaning_id2}", headers=cleaner2["headers"]),
        )
        race_codes = sorted(r.status_code for r in race_res)
        test_result(
            "Concurrent cleaning claim race resolves cleanly -> [200, 409]",
            race_codes == [200, 409],
            f"Got codes {race_codes}",
        )
        r_admin_complete = await client.put(f"/beds/cleaning/complete/{cleaning_id2}", headers=admin["headers"])
        test_result(
            "ADMIN supervisor override completes IN_PROGRESS cleaning task -> HTTP 200",
            r_admin_complete.status_code == 200,
            r_admin_complete.text,
        )

        # -----------------------------------------------------------------
        # 2. EQUIPMENT RELEASE RBAC + STATE GUARD (bed-service)
        # -----------------------------------------------------------------
        print("\n--- 2. Equipment Release RBAC & Double-Release Guard ---")
        assert (
            await client.put(
                f"/beds/reserve/{target_bed}",
                json={"patient_id": patient_id, "primary_diagnosis": "Equip Check", "acuity_level": "ESI_2"},
                headers=nurse1["headers"],
            )
        ).status_code == 200
        assert (await client.put(f"/beds/admit/{target_bed}", headers=nurse1["headers"])).status_code == 200

        eq_res = await client.get("/beds/equipment/list", headers=nurse1["headers"])
        assert eq_res.status_code == 200, f"Equipment fetch failed: {eq_res.text}"
        avail_eq = [e for e in eq_res.json().get("equipment", []) if e.get("status") == "AVAILABLE"]
        if avail_eq:
            eq_id = avail_eq[0]["equipment_id"]
            alloc_res = await client.post(
                "/beds/equipment/allocate",
                json={"equipment_id": eq_id, "bed_code": target_bed},
                headers=nurse1["headers"],
            )
            assert alloc_res.status_code == 200, f"Equipment allocate failed: {alloc_res.text}"
            alloc_id = alloc_res.json()["equipment_allocation_id"]

            r_cleaner_eq = await client.put(f"/beds/equipment/release/{alloc_id}", headers=cleaner1["headers"])
            test_result(
                "CLEANING_CREW blocked from releasing clinical equipment -> HTTP 403",
                r_cleaner_eq.status_code == 403,
                f"Got {r_cleaner_eq.status_code}: {r_cleaner_eq.text}",
            )

            r_nurse_rel = await client.put(f"/beds/equipment/release/{alloc_id}", headers=nurse1["headers"])
            test_result("NURSE releases ACTIVE equipment -> HTTP 200", r_nurse_rel.status_code == 200, r_nurse_rel.text)

            r_double_rel = await client.put(f"/beds/equipment/release/{alloc_id}", headers=nurse2["headers"])
            test_result(
                "Double equipment release blocked -> HTTP 409",
                r_double_rel.status_code == 409,
                f"Got {r_double_rel.status_code}: {r_double_rel.text}",
            )
        else:
            test_result("Equipment seed available for BOLA test", False, "No AVAILABLE equipment found")

        await client.put(f"/beds/discharge/{target_bed}", headers=nurse1["headers"])
        await complete_any_pending_cleaning(client, admin["headers"], target_bed)

        # -----------------------------------------------------------------
        # 3. SAME-ROLE NURSE ASSIGNMENT BOLA & BOUNDED PAGINATION (patient-service)
        # -----------------------------------------------------------------
        print("\n--- 3. Nurse Assignment Ownership, Pagination & HIPAA Audit ---")
        adm_res = await client.post(
            "/patients/admissions/create",
            json={"patient_id": patient_id, "primary_diagnosis": "Nurse Assignment Check", "acuity_level": "ESI_3"},
            headers=nurse1["headers"],
        )
        assert adm_res.status_code in (200, 201), f"Admission create failed: {adm_res.text}"
        admission_id = adm_res.json()["admission_id"]

        assign_res = await client.post(
            f"/patients/admissions/{admission_id}/assign-nurse",
            json={"nurse_id": nurse1["personnel_id"]},
            headers=doctor["headers"],
        )
        assert assign_res.status_code in (200, 201), f"Assign nurse failed: {assign_res.text}"
        assignment_id = assign_res.json()["assignment_id"]

        r_nurse2_hijack = await client.put(
            f"/patients/admissions/nurse-assignments/{assignment_id}/complete",
            headers=nurse2["headers"],
        )
        test_result(
            "Nurse 2 cannot complete Nurse 1's active assignment -> HTTP 403",
            r_nurse2_hijack.status_code == 403,
            f"Got {r_nurse2_hijack.status_code}: {r_nurse2_hijack.text}",
        )

        r_nurse1_complete = await client.put(
            f"/patients/admissions/nurse-assignments/{assignment_id}/complete",
            headers=nurse1["headers"],
        )
        test_result(
            "Nurse 1 completes own active assignment -> HTTP 200",
            r_nurse1_complete.status_code == 200,
            r_nurse1_complete.text,
        )

        r_recomplete = await client.put(
            f"/patients/admissions/nurse-assignments/{assignment_id}/complete",
            headers=nurse1["headers"],
        )
        test_result(
            "Re-completing COMPLETED nurse assignment -> HTTP 409",
            r_recomplete.status_code == 409,
            f"Got {r_recomplete.status_code}: {r_recomplete.text}",
        )

        # Doctor override check
        assign_res2 = await client.post(
            f"/patients/admissions/{admission_id}/assign-nurse",
            json={"nurse_id": nurse1["personnel_id"]},
            headers=doctor["headers"],
        )
        assert assign_res2.status_code in (200, 201)
        assignment_id2 = assign_res2.json()["assignment_id"]
        r_doc_complete = await client.put(
            f"/patients/admissions/nurse-assignments/{assignment_id2}/complete",
            headers=doctor["headers"],
        )
        test_result(
            "DOCTOR override completes Nurse 1 assignment -> HTTP 200",
            r_doc_complete.status_code == 200,
            r_doc_complete.text,
        )

        # HIPAA READ audit triggers + pagination bounds
        r_chart = await client.get(f"/patients/patient/{patient_id}", headers=nurse1["headers"])
        test_result("Nurse 1 GET /patients/patient/{id} -> HTTP 200", r_chart.status_code == 200, r_chart.text)

        r_obs = await client.get(f"/patients/admissions/{admission_id}/observations", headers=nurse1["headers"])
        test_result(
            "Nurse 1 GET /patients/admissions/{id}/observations -> HTTP 200",
            r_obs.status_code == 200,
            r_obs.text,
        )

        r_page = await client.get("/patients/records?limit=5&offset=0", headers=nurse1["headers"])
        test_result(
            "Bounded GET /patients/records?limit=5 -> HTTP 200 & <=5 rows",
            r_page.status_code == 200 and isinstance(r_page.json(), list) and len(r_page.json()) <= 5,
            f"Got status={r_page.status_code}",
        )

        r_unbounded = await client.get("/patients/records?limit=1000", headers=nurse1["headers"])
        test_result(
            "Excessive limit=1000 rejected -> HTTP 422",
            r_unbounded.status_code == 422,
            f"Got {r_unbounded.status_code}: {r_unbounded.text}",
        )

        await client.post(f"/patients/admissions/{admission_id}/discharge", headers=doctor["headers"])

    # Verify audit entries in Postgres
    conn = await asyncpg.connect(PG_DSN)
    try:
        bed_bola_rows = await conn.fetchval(
            "SELECT COUNT(*) FROM bed_audit_log WHERE user_id = $1 AND action = 'BOLA_DENIED';",
            cleaner2["personnel_id"],
        )
        patient_bola_rows = await conn.fetchval(
            "SELECT COUNT(*) FROM patient_audit_log WHERE user_id = $1 AND action = 'BOLA_DENIED';",
            nurse2["personnel_id"],
        )
        read_chart_rows = await conn.fetchval(
            "SELECT COUNT(*) FROM patient_audit_log WHERE user_id = $1 AND action = 'READ_PATIENT_CHART';",
            nurse1["personnel_id"],
        )
        read_obs_rows = await conn.fetchval(
            "SELECT COUNT(*) FROM patient_audit_log WHERE user_id = $1 AND action = 'READ_OBSERVATIONS';",
            nurse1["personnel_id"],
        )
        test_result("PostgreSQL bed_audit_log recorded Cleaner 2 BOLA_DENIED", (bed_bola_rows or 0) >= 1, f"count={bed_bola_rows}")
        test_result("PostgreSQL patient_audit_log recorded Nurse 2 BOLA_DENIED", (patient_bola_rows or 0) >= 1, f"count={patient_bola_rows}")
        test_result("PostgreSQL patient_audit_log recorded READ_PATIENT_CHART", (read_chart_rows or 0) >= 1, f"count={read_chart_rows}")
        test_result("PostgreSQL patient_audit_log recorded READ_OBSERVATIONS", (read_obs_rows or 0) >= 1, f"count={read_obs_rows}")
    finally:
        await conn.close()

    print("\n" + "=" * 72)
    print(f"BOLA E2E RESULTS: {passed} passed, {failed} failed")
    print("=" * 72)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(run_bola_suite())

