import urllib.request
import json
import sys

BASE_URL = "http://localhost:8080"

nurses = [
    {"email": "nurse_jane@hospital.org", "bed": "ED-02", "floor": 1, "patient": "Arthur Dent"},
    {"email": "tapu@hospital.org", "bed": "MED-202", "floor": 2, "patient": "Ford Prefect"},
    {"email": "nurse_pat@hospital.org", "bed": "ICU-302", "floor": 3, "patient": "Tricia McMillan"},
    {"email": "carol@hospital.org", "bed": "SUR-402", "floor": 4, "patient": "Zaphod Beeblebrox"}
]

def make_req(path, method="GET", data=None, token=None):
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            res_body = res.read().decode()
            return res.status, json.loads(res_body) if res_body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        try:
            return e.code, json.loads(err_body)
        except:
            return e.code, {"detail": err_body}
    except Exception as e:
        return 500, {"detail": str(e)}

print("=== STARTING FULL LIFECYCLE TEST FOR ALL 4 NURSES ===")

for n in nurses:
    email = n["email"]
    bed_code = n["bed"]
    patient_name = n["patient"]
    floor = n["floor"]
    print(f"\n--- Testing Nurse: {email} on Floor {floor} (Bed {bed_code}) ---")
    
    # 1. Login
    code, res = make_req("/auth/login", method="POST", data={"email": email, "password": "SecurePassword123!"})
    if code != 200 or "access_token" not in res:
        print(f"FAILED LOGIN for {email}: {res}")
        sys.exit(1)
    token = res["access_token"]
    print(f"[OK] 1. Logged in successfully as {email}")

    # Ensure bed is AVAILABLE first
    make_req(f"/beds/admin/status/{bed_code}", method="PUT", data={"status": "AVAILABLE"}, token=token)

    # 2. Register Patient
    code, patient = make_req("/patients/register", method="POST", data={"name": patient_name, "gender": "OTHER"}, token=token)
    if code not in (200, 201) or "patient_id" not in patient:
        print(f"FAILED to register patient: {patient}")
        sys.exit(1)
    patient_id = patient["patient_id"]
    print(f"[OK] 2. Registered Patient: {patient_name} (ID: {patient_id})")

    # 3. Admit Patient to Bed (Sets OCCUPIED)
    code, admit_res = make_req(
        f"/beds/admit/{bed_code}",
        method="PUT",
        data={
            "patient_id": patient_id,
            "notes": f"Admitted by {email}",
            "acuity_level": "ESI_3",
            "diagnosis": "Cardiopulmonary Observation"
        },
        token=token
    )
    if code != 200:
        print(f"FAILED to admit to {bed_code}: {admit_res}")
        sys.exit(1)
    print(f"[OK] 3. Admitted to {bed_code} successfully! Result: {admit_res.get('message')}")

    # Verify Bed is OCCUPIED in Grid
    code, grid = make_req("/beds/grid", token=token)
    bed_in_grid = next((b for b in grid.get("beds", []) if b["bed_code"] == bed_code), None)
    if not bed_in_grid or bed_in_grid["status"] != "OCCUPIED":
        print(f"FAILED verification in grid for {bed_code}: {bed_in_grid}")
        sys.exit(1)
    print(f"[OK] 4. Verified in Bed Grid: {bed_code} is OCCUPIED with patient '{bed_in_grid.get('patient_name')}'")

    # 4. Discharge Patient from Bed (Sets DIRTY)
    code, dc_res = make_req(f"/beds/discharge/{bed_code}", method="PUT", token=token)
    if code != 200:
        print(f"FAILED to discharge {bed_code}: {dc_res}")
        sys.exit(1)
    print(f"[OK] 5. Discharged from {bed_code}! Result: {dc_res.get('message')}")

    # Verify Bed is DIRTY in Grid
    code, grid = make_req("/beds/grid", token=token)
    bed_in_grid = next((b for b in grid.get("beds", []) if b["bed_code"] == bed_code), None)
    if not bed_in_grid or bed_in_grid["status"] != "DIRTY":
        print(f"FAILED verification in grid for {bed_code}: {bed_in_grid}")
        sys.exit(1)
    print(f"[OK] 6. Verified in Bed Grid: {bed_code} is now DIRTY (Queued for Housekeeping)")

    # 5. Clean bed back to AVAILABLE
    code, clean_res = make_req(f"/beds/admin/status/{bed_code}", method="PUT", data={"status": "AVAILABLE"}, token=token)
    if code != 200:
        print(f"FAILED to mark bed AVAILABLE: {clean_res}")
        sys.exit(1)
    print(f"[OK] 7. Cleaned bed {bed_code} back to AVAILABLE")

    # Verify Bed is AVAILABLE in Grid
    code, grid = make_req("/beds/grid", token=token)
    bed_in_grid = next((b for b in grid.get("beds", []) if b["bed_code"] == bed_code), None)
    if not bed_in_grid or bed_in_grid["status"] != "AVAILABLE":
        print(f"FAILED verification in grid for {bed_code}: {bed_in_grid}")
        sys.exit(1)
    print(f"[OK] 8. Verified in Bed Grid: {bed_code} is AVAILABLE (Ready for next admission)")

print("\n=== ALL 4 NURSES PASSED 100% OF ADMIT, DISCHARGE, AND CLEANING WORKFLOWS! ===")
