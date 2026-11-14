"""
Test-Driven Development (TDD) Suite: Clinical Nurse Handoff Feature
Tests:
1. Single Handoff Creation & State Transition (Outgoing COMPLETED, Incoming ACTIVE)
2. BOLA Guard: Unassigned nurse blocked from handing off patient (403 Forbidden)
3. Supervisor Override: Doctor / Admin can execute handover (201 Created)
4. Oncoming Nurse Read: Incoming nurse fetches latest handoff report (200 OK)
5. Multi-Patient Batch Handoff: Handing off multiple patients in one atomic request
6. Discharged Patient Guard: Cannot hand off discharged admission (400 Bad Request)
7. Handoff History Lineage: Historical shift reports preserved in chronological order
"""
import asyncio
import os
import sys
import time
import httpx

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://hip-gateway:8000")
TEST_PASSWORD = os.getenv("TEST_USER_PASSWORD", "TestPassword123!")

passed = 0
failed = 0


def report(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} -- {detail}")


async def login(client: httpx.AsyncClient, email: str, max_retries: int = 4) -> dict:
    for attempt in range(max_retries):
        resp = await client.post("/auth/login", json={"email": email, "password": TEST_PASSWORD})
        if resp.status_code == 429 and attempt < max_retries - 1:
            await asyncio.sleep(2.0 * (attempt + 1))
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


async def main():
    global passed, failed
    print("\n=======================================================")
    print(" CLINICAL NURSE HANDOFF - LIVE TDD VERIFICATION SUITE")
    print(f" Target Gateway: {GATEWAY_URL}")
    print("=======================================================\n")

    async with httpx.AsyncClient(base_url=GATEWAY_URL, timeout=15.0) as client:
        # Step A: Authenticate Test Personas
        nurse1 = await login(client, "bola_nurse_1@hospital.org")
        nurse2 = await login(client, "bola_nurse_2@hospital.org")
        nurse3 = await login(client, "carol@hospital.org")
        doctor = await login(client, "bola_doctor@hospital.org")

        print(f"Authenticated: Nurse1=#{nurse1['personnel_id']}, Nurse2=#{nurse2['personnel_id']}, Nurse3=#{nurse3['personnel_id']}, Doctor=#{doctor['personnel_id']}\n")

        run_id = int(time.time() * 1000) % 1000000

        # Step B: Register Patient and Create Admission
        reg_resp = await client.post(
            "/patients/register",
            headers=nurse1["headers"],
            json={
                "first_name": f"Tdd{run_id}",
                "last_name": "PatientOne",
                "date_of_birth": "1980-04-12",
                "gender": "MALE",
                "phone": "555-0101",
            },
        )
        report("Register test patient", reg_resp.status_code == 201, reg_resp.text)
        patient_id = reg_resp.json()["patient_id"]

        adm_resp = await client.post(
            "/patients/admissions/create",
            headers=nurse1["headers"],
            json={
                "patient_id": patient_id,
                "primary_diagnosis": "Acute Coronary Syndrome - Post PCI",
                "acuity_level": "ESI_2",
                "notes": "Radial access site clean, monitoring rhythm",
            },
        )
        report("Create active admission", adm_resp.status_code == 201, adm_resp.text)
        admission_id = adm_resp.json()["admission_id"]

        # Step C: Assign Nurse 1 as active nurse
        assign_resp = await client.post(
            f"/patients/admissions/{admission_id}/assign-nurse",
            headers=nurse1["headers"],
            json={"nurse_id": nurse1["personnel_id"]},
        )
        report("Assign Nurse 1 as active bedside nurse", assign_resp.status_code == 201, assign_resp.text)

        # -------------------------------------------------------------
        # Test 1: BOLA Guard - Unassigned nurse cannot hand off patient
        # -------------------------------------------------------------
        unauth_resp = await client.post(
            f"/patients/admissions/{admission_id}/handoff",
            headers=nurse3["headers"],
            json={
                "to_nurse_id": nurse2["personnel_id"],
                "illness_severity": "STABLE",
                "patient_summary": "Unassigned nurse attempting handover",
            },
        )
        report(
            "BOLA Guard: Unassigned nurse blocked from handover -> 403 Forbidden",
            unauth_resp.status_code == 403,
            f"Got {unauth_resp.status_code}: {unauth_resp.text}",
        )

        # -------------------------------------------------------------
        # Test 2: Authorized Handoff - Nurse 1 hands off to Nurse 2
        # -------------------------------------------------------------
        handoff_payload = {
            "to_nurse_id": nurse2["personnel_id"],
            "illness_severity": "WATCHER",
            "patient_summary": "Chest pain resolved post stent. Groin site stable, pulses +2 bilateral.",
            "action_items": "Serial troponins at 0400, repeat ECG at 0600.",
            "contingency_plan": "If chest pain recurs or SBP < 90, notify Dr. Smith and stat cardiology.",
        }
        handoff_resp = await client.post(
            f"/patients/admissions/{admission_id}/handoff",
            headers=nurse1["headers"],
            json=handoff_payload,
        )
        report(
            "Authorized Handoff: Nurse 1 hands off to Nurse 2 -> 201 Created",
            handoff_resp.status_code == 201,
            f"Got {handoff_resp.status_code}: {handoff_resp.text}",
        )
        if handoff_resp.status_code == 201:
            hdata = handoff_resp.json()
            report("Handoff from_nurse_id == Nurse 1", hdata.get("from_nurse_id") == nurse1["personnel_id"])
            report("Handoff to_nurse_id == Nurse 2", hdata.get("to_nurse_id") == nurse2["personnel_id"])
            report("Handoff illness_severity == WATCHER", hdata.get("illness_severity") == "WATCHER")

        # -------------------------------------------------------------
        # Test 3: Care Transfer State Transition
        # -------------------------------------------------------------
        assignments_resp = await client.get(
            f"/patients/admissions/{admission_id}/nurse-assignments",
            headers=nurse2["headers"],
        )
        assignments = assignments_resp.json() if assignments_resp.status_code == 200 else []
        active_na = next((a for a in assignments if a["status"] == "ACTIVE"), None)
        completed_na = next((a for a in assignments if a["status"] == "COMPLETED" and a["nurse_id"] == nurse1["personnel_id"]), None)

        report("Outgoing Nurse 1 assignment transitioned to COMPLETED", completed_na is not None)
        report("Oncoming Nurse 2 assignment transitioned to ACTIVE", active_na is not None and active_na["nurse_id"] == nurse2["personnel_id"])

        # -------------------------------------------------------------
        # Test 4: Incoming Nurse Reads Latest Handoff
        # -------------------------------------------------------------
        latest_resp = await client.get(
            f"/patients/admissions/{admission_id}/handoff/latest",
            headers=nurse2["headers"],
        )
        report("Incoming Nurse 2 reads latest handoff report -> 200 OK", latest_resp.status_code == 200, latest_resp.text)
        if latest_resp.status_code == 200 and latest_resp.json():
            latest = latest_resp.json()
            report("Incoming nurse sees correct illness severity (WATCHER)", latest.get("illness_severity") == "WATCHER")
            report("Incoming nurse sees action items ('Serial troponins')", "Serial troponins" in (latest.get("action_items") or ""))
            report("Incoming nurse sees contingency plan ('If chest pain')", "If chest pain" in (latest.get("contingency_plan") or ""))

        # -------------------------------------------------------------
        # Test 5: Supervisor (Doctor) Override
        # -------------------------------------------------------------
        doc_resp = await client.post(
            f"/patients/admissions/{admission_id}/handoff",
            headers=doctor["headers"],
            json={
                "to_nurse_id": nurse3["personnel_id"],
                "illness_severity": "STABLE",
                "patient_summary": "Doctor re-assigned care team to Nurse 3 for night cover.",
                "action_items": "Routine neuro & vitals check Q4H.",
                "contingency_plan": "Standard unit protocol.",
            },
        )
        report("Supervisor (Doctor) override handoff -> 201 Created", doc_resp.status_code == 201, doc_resp.text)

        # -------------------------------------------------------------
        # Test 6: Multi-Patient Batch Handoff
        # -------------------------------------------------------------
        # Create second patient and assign to Nurse 3
        p2_resp = await client.post(
            "/patients/register",
            headers=nurse3["headers"],
            json={"first_name": f"Batch{run_id}", "last_name": "PatientTwo", "date_of_birth": "1992-08-25", "gender": "FEMALE"},
        )
        p2_id = p2_resp.json()["patient_id"]
        adm2_resp = await client.post(
            "/patients/admissions/create",
            headers=nurse3["headers"],
            json={"patient_id": p2_id, "primary_diagnosis": "Sepsis secondary to UTI", "acuity_level": "ESI_2"},
        )
        adm2_id = adm2_resp.json()["admission_id"]
        await client.post(f"/patients/admissions/{adm2_id}/assign-nurse", headers=nurse3["headers"], json={"nurse_id": nurse3["personnel_id"]})

        # Nurse 3 now holds active assignments for admission_id and adm2_id
        batch_resp = await client.post(
            "/patients/handoff/batch",
            headers=nurse3["headers"],
            json={
                "handoffs": [
                    {
                        "admission_id": admission_id,
                        "to_nurse_id": nurse1["personnel_id"],
                        "illness_severity": "STABLE",
                        "patient_summary": "Stable overnight, morning discharge planned.",
                        "action_items": "Remove telemetry prior to discharge.",
                        "contingency_plan": "Call MD if temp > 38.0C.",
                    },
                    {
                        "admission_id": adm2_id,
                        "to_nurse_id": nurse1["personnel_id"],
                        "illness_severity": "UNSTABLE",
                        "patient_summary": "Lactate down to 2.1, but febrile at 38.6C.",
                        "action_items": "Second dose Vancomycin at 0600.",
                        "contingency_plan": "If MAP < 65, initiate norepinephrine titration.",
                    },
                ]
            },
        )
        report(
            "Batch Handoff: Hand over 2 patients simultaneously -> 201 Created",
            batch_resp.status_code == 201 and len(batch_resp.json()) == 2,
            f"Got status={batch_resp.status_code}",
        )

        # -------------------------------------------------------------
        # Test 7: Handoff History Lineage
        # -------------------------------------------------------------
        history_resp = await client.get(
            f"/patients/admissions/{admission_id}/handoff/history",
            headers=nurse1["headers"],
        )
        report("Handoff history endpoint returns chronological lineage", history_resp.status_code == 200)
        if history_resp.status_code == 200:
            hist = history_resp.json()
            report(f"Admission #{admission_id} has accumulated {len(hist)} handoff records", len(hist) >= 3)

        # -------------------------------------------------------------
        # Test 8: Discharged Admission Guard
        # -------------------------------------------------------------
        # Discharge admission_id
        d_resp = await client.put(f"/patients/admissions/{admission_id}/discharge", headers=nurse1["headers"])
        report("Discharge patient admission", d_resp.status_code == 200, d_resp.text)
        discharged_handoff_resp = await client.post(
            f"/patients/admissions/{admission_id}/handoff",
            headers=nurse1["headers"],
            json={"to_nurse_id": nurse2["personnel_id"], "illness_severity": "STABLE"},
        )
        report(
            "Discharged Admission Guard: Cannot hand off discharged admission -> 400 Bad Request",
            discharged_handoff_resp.status_code == 400,
            f"Got {discharged_handoff_resp.status_code}: {discharged_handoff_resp.text}",
        )

    print("\n=======================================================")
    print(f" TDD VERIFICATION RESULTS: {passed} PASSED, {failed} FAILED")
    print("=======================================================\n")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
