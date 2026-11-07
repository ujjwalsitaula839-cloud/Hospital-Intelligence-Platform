"""
Hospital Intelligence Platform (HIP) - Relational Database Seeder
==================================================================
Architected for complete relational integrity, HIPAA/21 CFR Part 11 consistency,
and strict adherence to partial unique indexes, check constraints, and role schemas.

Seeded Matrix:
- Personnel: 19 accounts (Admin, Doctors, Nurses, Cleaners, Pharmacy, plus inactive staff)
- Beds: 120 physical beds across 5 clinical departments (ER, ICU, Step-Down, Ward, Surgery)
- Equipment: 6 types, 30 serialized assets
- Patients: 84 patients (69 active inpatients, 15 historical/discharged)
- Admissions: 84 admissions (69 open, 15 discharged with no partial index conflicts)
- Bed Allocations: 58 Occupied, 11 Reserved, strictly adhering to uq_single_active_bed_allocation
- Cleaning Tasks: 9 Dirty (Pending), 4 Cleaning-in-Progress (assigned to EVS staff), 10 Completed
- Equipment Allocations: 12 active equipment allocations for critical patients
- Nurse Assignments: 69 active shift assignments matching department nurses
- Clinical Vitals: 100+ append-only physiological observations complying with check constraints
- Redis Cache: Invalidation of beds:grid:all
"""

import asyncio
from datetime import datetime, date, timedelta, timezone
import json
import os
import random
import sys

try:
    import asyncpg
except ImportError:
    print("Error: asyncpg is required. Run via container or install asyncpg.")
    sys.exit(1)


# Initial staff password hash for seed environments (dynamically loaded from environment)
TEST_PASSWORD_HASH = os.getenv("SEED_PASSWORD_HASH") or os.getenv("TEST_PASSWORD_HASH")
if not TEST_PASSWORD_HASH:
    try:
        from passlib.context import CryptContext
        _pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
        TEST_PASSWORD_HASH = _pwd_ctx.hash(os.getenv("INITIAL_STAFF_PASSWORD", "TemporaryStaffPass123!"))
    except Exception:
        # Standard placeholder hash
        TEST_PASSWORD_HASH = "$2b$12$e8V9Yg2G7fWk4Xqj8t5Lbe6pQ3rA9sD1fG2hJ4kL6mN8oP0qR2sTu"

# Database connection URL (must be provided via environment: SEED_DB_DSN, TEST_PG_DSN, or DATABASE_URL)
DB_DSN = os.getenv("SEED_DB_DSN") or os.getenv("TEST_PG_DSN") or os.getenv("DATABASE_URL")
if not DB_DSN:
    print("Error: Database connection URL must be provided via SEED_DB_DSN, TEST_PG_DSN, or DATABASE_URL environment variables.")
    sys.exit(1)


FIRST_NAMES_MALE = [
    "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph",
    "Thomas", "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Donald",
    "Mark", "Paul", "Steven", "Andrew", "Kenneth", "George", "Joshua", "Kevin",
    "Brian", "Edward", "Ronald", "Timothy", "Jason", "Jeffrey", "Ryan", "Jacob",
    "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin", "Scott"
]

FIRST_NAMES_FEMALE = [
    "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica",
    "Sarah", "Karen", "Nancy", "Lisa", "Betty", "Margaret", "Sandra", "Ashley",
    "Kimberly", "Emily", "Donna", "Michelle", "Dorothy", "Carol", "Amanda", "Melissa",
    "Deborah", "Stephanie", "Rebecca", "Sharon", "Laura", "Cynthia", "Kathleen", "Amy",
    "Angela", "Shirley", "Anna", "Brenda", "Pamela", "Emma", "Nicole", "Helen"
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
    "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
    "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
    "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
    "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
    "Carter", "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker"
]

CLINICAL_CONDITIONS = [
    ("Acute ST-Elevation Myocardial Infarction", "ESI_1"),
    ("Septic Shock secondary to Urosepsis", "ESI_1"),
    ("Acute Respiratory Distress Syndrome (ARDS)", "ESI_1"),
    ("Severe Traumatic Brain Injury (GCS 7)", "ESI_1"),
    ("Status Epilepticus", "ESI_1"),
    ("Acute Ischemic Stroke - Post-tPA Monitoring", "ESI_2"),
    ("Diabetic Ketoacidosis (DKA) with Severe Acidosis", "ESI_2"),
    ("Acute Pulmonary Embolism", "ESI_2"),
    ("Acute Congestive Heart Failure Exacerbation", "ESI_2"),
    ("Upper Gastrointestinal Bleeding with Hemodynamic Instability", "ESI_2"),
    ("Status Asthmaticus refractory to nebulizers", "ESI_2"),
    ("Severe Hypertensive Crisis with End-Organ Damage", "ESI_2"),
    ("Unstable Angina Pectoris", "ESI_2"),
    ("Acute Pancreatitis with Systemic Inflammatory Response", "ESI_2"),
    ("Severe Community-Acquired Pneumonia (CURB-65 = 3)", "ESI_3"),
    ("Acute Appendicitis with Localized Peritonitis", "ESI_3"),
    ("Deep Vein Thrombosis with High Clot Burden", "ESI_3"),
    ("Acute Pyelonephritis with High Fevers", "ESI_3"),
    ("Cellulitis with Ascending Lymphangitis", "ESI_3"),
    ("Exacerbation of Chronic Obstructive Pulmonary Disease", "ESI_3"),
    ("Atrial Fibrillation with Rapid Ventricular Response", "ESI_3"),
    ("Bowel Obstruction secondary to Adhesions", "ESI_3"),
    ("Post-Op Day 1 Open Cholecystectomy", "ESI_3"),
    ("Post-Op Day 2 Total Knee Arthroplasty", "ESI_4"),
    ("Closed Right Femoral Fracture awaiting ORIF", "ESI_3"),
    ("Moderate Dehydration secondary to Gastroenteritis", "ESI_4"),
    ("Transient Ischemic Attack (TIA) - Workup", "ESI_3"),
    ("Cholelithiasis with Biliary Colic", "ESI_4"),
    ("Soft Tissue Abscess requiring I&D", "ESI_4"),
    ("Renal Colic secondary to Nephrolithiasis", "ESI_3"),
]


async def seed_database():
    print(f"Connecting to database: {DB_DSN}")
    conn = await asyncpg.connect(DB_DSN)
    print("Connected successfully.")

    try:
        async with conn.transaction():
            print("\n1. Truncating existing tables and resetting sequences...")
            await conn.execute("""
                TRUNCATE TABLE 
                    patient_observation,
                    patient_nurse_assignment,
                    equipment_allocation,
                    cleaning_task,
                    bed_allocation,
                    admission,
                    patient,
                    equipment,
                    equipment_type,
                    bed,
                    refresh_token,
                    password_history,
                    personnel
                RESTART IDENTITY CASCADE;
            """)
            print("   Tables truncated cleanly.")

            # -------------------------------------------------------------
            # 2. SEED PERSONNEL (STAFF)
            # -------------------------------------------------------------
            print("\n2. Seeding Personnel across all hospital roles...")
            personnel_records = [
                # Admin
                (1, "admin", "admin@hospital.org", TEST_PASSWORD_HASH, "Hospital Administrator", "ADMIN", "ADMINISTRATION", True, False),
                # Doctors
                (2, "doctor_chen", "doctor_chen@hospital.org", TEST_PASSWORD_HASH, "Dr. Alice Chen, MD", "DOCTOR", "EMERGENCY", True, False),
                (3, "doctor_adams", "doctor_adams@hospital.org", TEST_PASSWORD_HASH, "Dr. Marcus Adams, MD", "DOCTOR", "ICU", True, False),
                (4, "doctor_ross", "doctor_ross@hospital.org", TEST_PASSWORD_HASH, "Dr. Eleanor Ross, MD", "DOCTOR", "GENERAL_WARD", True, False),
                (5, "doctor_patel", "doctor_patel@hospital.org", TEST_PASSWORD_HASH, "Dr. Sanjay Patel, MD", "DOCTOR", "SURGERY", True, False),
                # Nurses
                (6, "nurse_carol", "nurse_carol@hospital.org", TEST_PASSWORD_HASH, "Carol Danvers, RN", "NURSE", "EMERGENCY", True, False),
                (7, "nurse_dave", "nurse_dave@hospital.org", TEST_PASSWORD_HASH, "Dave Miller, RN", "NURSE", "EMERGENCY", True, False),
                (8, "nurse_emily", "nurse_emily@hospital.org", TEST_PASSWORD_HASH, "Emily Watson, BSN", "NURSE", "ICU", True, False),
                (9, "nurse_frank", "nurse_frank@hospital.org", TEST_PASSWORD_HASH, "Frank Castle, RN", "NURSE", "ICU", True, False),
                (10, "nurse_grace", "nurse_grace@hospital.org", TEST_PASSWORD_HASH, "Grace Hopper, RN", "NURSE", "STEP_DOWN", True, False),
                (11, "nurse_helen", "nurse_helen@hospital.org", TEST_PASSWORD_HASH, "Helen Keller, RN", "NURSE", "GENERAL_WARD", True, False),
                (12, "nurse_ian", "nurse_ian@hospital.org", TEST_PASSWORD_HASH, "Ian Malcolm, RN", "NURSE", "GENERAL_WARD", True, False),
                (13, "nurse_jack", "nurse_jack@hospital.org", TEST_PASSWORD_HASH, "Jack Shephard, RN", "NURSE", "SURGERY", True, False),
                # Cleaning Crew
                (14, "cleaner_bob", "cleaner_bob@hospital.org", TEST_PASSWORD_HASH, "Bob Martinez, EVS", "CLEANING_CREW", "HOUSEKEEPING", True, False),
                (15, "cleaner_sara", "cleaner_sara@hospital.org", TEST_PASSWORD_HASH, "Sara Connor, EVS", "CLEANING_CREW", "HOUSEKEEPING", True, False),
                (16, "cleaner_mike", "cleaner_mike@hospital.org", TEST_PASSWORD_HASH, "Mike Wheeler, EVS", "CLEANING_CREW", "HOUSEKEEPING", True, False),
                # Pharmacy
                (17, "pharmacist_john", "pharmacist_john@hospital.org", TEST_PASSWORD_HASH, "John Locke, PharmD", "PHARMACY", "PHARMACY", True, False),
                # Inactive Personnel for testing deactivation filters
                (18, "inactive_doctor", "inactive_doctor@hospital.org", TEST_PASSWORD_HASH, "Dr. Gregory House, MD", "DOCTOR", "EMERGENCY", False, False),
                (19, "inactive_nurse", "inactive_nurse@hospital.org", TEST_PASSWORD_HASH, "Mildred Ratched, RN", "NURSE", "ICU", False, False),
                # Additional Quick-Fill Workstation Personas
                (20, "dr_smith", "dr_smith@hospital.org", TEST_PASSWORD_HASH, "Dr. John Smith, MD", "DOCTOR", "EMERGENCY", True, False),
                (21, "nurse_jane", "nurse_jane@hospital.org", TEST_PASSWORD_HASH, "Jane Foster, RN", "NURSE", "EMERGENCY", True, False),
            ]

            await conn.executemany("""
                INSERT INTO personnel (personnel_id, username, email, hashed_password, full_name, role, department, is_active, must_change_password)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
            """, personnel_records)
            await conn.execute("SELECT setval('personnel_personnel_id_seq', (SELECT max(personnel_id) FROM personnel));")
            print(f"   Seeded {len(personnel_records)} personnel accounts (including 2 inactive test accounts).")

            # -------------------------------------------------------------
            # 3. SEED EQUIPMENT TYPES AND EQUIPMENT
            # -------------------------------------------------------------
            print("\n3. Seeding Equipment Types and 30 Serialized Equipment Assets...")
            eq_types = [
                (1, "Ventilator", "Mechanical ventilation device for respiratory failure"),
                (2, "Cardiac Monitor", "Multiparameter telemetry monitor for continuous ECG/hemodynamics"),
                (3, "Infusion Pump", "Precision intravenous medication and fluid delivery pump"),
                (4, "Crash Cart", "Emergency code resuscitation cart with defibrillator and airway kit"),
                (5, "Defibrillator", "Biphasic automated external defibrillator"),
                (6, "Negative Pressure Unit", "HEPA air filtration unit for negative-pressure isolation"),
            ]
            await conn.executemany("""
                INSERT INTO equipment_type (equipment_type_id, name, description)
                VALUES ($1, $2, $3);
            """, eq_types)
            await conn.execute("SELECT setval('equipment_type_equipment_type_id_seq', (SELECT max(equipment_type_id) FROM equipment_type));")

            # 30 serialized assets
            equipment_items = []
            eq_id = 1
            # Ventilators (8)
            for i in range(1, 9):
                dept = "ICU" if i <= 6 else "EMERGENCY"
                equipment_items.append((eq_id, 1, f"VENT-{i:02d}", f"Hamilton C6 Ventilator #{i:02d}", dept, "AVAILABLE", 1))
                eq_id += 1
            # Cardiac Monitors (10)
            for i in range(1, 11):
                dept = "EMERGENCY" if i <= 5 else "ICU" if i <= 8 else "STEP_DOWN"
                equipment_items.append((eq_id, 2, f"CARD-{i:02d}", f"Philips IntelliVue Monitor #{i:02d}", dept, "AVAILABLE", 1))
                eq_id += 1
            # Infusion Pumps (8)
            for i in range(1, 9):
                dept = "EMERGENCY" if i <= 3 else "ICU" if i <= 6 else "GENERAL_WARD"
                equipment_items.append((eq_id, 3, f"PUMP-{i:02d}", f"Alaris MedSystem III #{i:02d}", dept, "AVAILABLE", 1))
                eq_id += 1
            # Crash Carts (4)
            for i in range(1, 5):
                depts = ["EMERGENCY", "ICU", "STEP_DOWN", "SURGERY"]
                equipment_items.append((eq_id, 4, f"CART-{i:02d}", f"Zoll R Series Crash Cart #{i:02d}", depts[i-1], "AVAILABLE", 1))
                eq_id += 1

            await conn.executemany("""
                INSERT INTO equipment (equipment_id, equipment_type_id, serial_number, equipment_name, department, status, version)
                VALUES ($1, $2, $3, $4, $5, $6, $7);
            """, equipment_items)
            await conn.execute("SELECT setval('equipment_equipment_id_seq', (SELECT max(equipment_id) FROM equipment));")
            print(f"   Seeded {len(equipment_items)} equipment assets.")

            # -------------------------------------------------------------
            # 4. SEED 120 BEDS ACROSS 5 DEPARTMENTS
            # -------------------------------------------------------------
            print("\n4. Seeding 120 Physical Beds across 5 clinical departments...")
            # We want:
            # - EMERGENCY: 30 beds (ER-101 to ER-130)
            # - ICU: 25 beds (ICU-201 to ICU-225)
            # - STEP_DOWN: 25 beds (SD-301 to SD-325)
            # - GENERAL_WARD: 30 beds (GW-401 to GW-430)
            # - SURGERY: 10 beds (SURG-501 to SURG-510)
            #
            # Target Statuses:
            # - OCCUPIED: 58 beds
            # - RESERVED: 11 beds
            # - DIRTY: 9 beds
            # - CLEANING_IN_PROGRESS: 4 beds
            # - MAINTENANCE: 1 bed
            # - AVAILABLE: 37 beds
            # Total = 120 beds

            beds_data = []
            bed_id = 1

            def make_bed_status_list(n_occ, n_res, n_dirty, n_clean, n_maint, n_avail):
                statuses = (
                    ["OCCUPIED"] * n_occ +
                    ["RESERVED"] * n_res +
                    ["DIRTY"] * n_dirty +
                    ["CLEANING_IN_PROGRESS"] * n_clean +
                    ["MAINTENANCE"] * n_maint +
                    ["AVAILABLE"] * n_avail
                )
                return statuses

            # EMERGENCY (30 beds: 14 Occ, 4 Res, 3 Dirty, 1 Clean, 0 Maint, 8 Avail)
            er_statuses = make_bed_status_list(14, 4, 3, 1, 0, 8)
            for i, st in enumerate(er_statuses, 1):
                bed_code = f"ER-{100 + i}"
                room = f"ER-Bay-{i:02d}"
                bed_type = "ISOLATION" if i in (1, 2) else "ICU" if i in (3, 4, 5) else "STANDARD"
                beds_data.append((bed_id, bed_code, "EMERGENCY", room, bed_type, st, 1))
                bed_id += 1

            # ICU (25 beds: 12 Occ, 2 Res, 2 Dirty, 1 Clean, 0 Maint, 8 Avail)
            icu_statuses = make_bed_status_list(12, 2, 2, 1, 0, 8)
            for i, st in enumerate(icu_statuses, 1):
                bed_code = f"ICU-{200 + i}"
                room = f"ICU-Room-{i:02d}"
                bed_type = "ISOLATION" if i in (1, 2, 3) else "BARIATRIC" if i in (4, 5) else "ICU"
                beds_data.append((bed_id, bed_code, "ICU", room, bed_type, st, 1))
                bed_id += 1

            # STEP_DOWN (25 beds: 12 Occ, 2 Res, 2 Dirty, 1 Clean, 0 Maint, 8 Avail)
            sd_statuses = make_bed_status_list(12, 2, 2, 1, 0, 8)
            for i, st in enumerate(sd_statuses, 1):
                bed_code = f"SD-{300 + i}"
                room = f"SD-Room-{i:02d}"
                bed_type = "BARIATRIC" if i in (1, 2) else "ISOLATION" if i == 3 else "STANDARD"
                beds_data.append((bed_id, bed_code, "STEP_DOWN", room, bed_type, st, 1))
                bed_id += 1

            # GENERAL_WARD (30 beds: 15 Occ, 2 Res, 1 Dirty, 1 Clean, 1 Maint, 10 Avail)
            gw_statuses = make_bed_status_list(15, 2, 1, 1, 1, 10)
            for i, st in enumerate(gw_statuses, 1):
                bed_code = f"GW-{400 + i}"
                room = f"Ward-{i:02d}"
                bed_type = "BARIATRIC" if i in (1, 2, 3) else "STANDARD"
                beds_data.append((bed_id, bed_code, "GENERAL_WARD", room, bed_type, st, 1))
                bed_id += 1

            # SURGERY (10 beds: 5 Occ, 1 Res, 1 Dirty, 0 Clean, 0 Maint, 3 Avail)
            surg_statuses = make_bed_status_list(5, 1, 1, 0, 0, 3)
            for i, st in enumerate(surg_statuses, 1):
                bed_code = f"SURG-{500 + i}"
                room = f"PACU-{i:02d}"
                bed_type = "ICU" if i in (1, 2) else "STANDARD"
                beds_data.append((bed_id, bed_code, "SURGERY", room, bed_type, st, 1))
                bed_id += 1

            await conn.executemany("""
                INSERT INTO bed (bed_id, bed_code, department, room_number, bed_type, status, version)
                VALUES ($1, $2, $3, $4, $5, $6, $7);
            """, beds_data)
            await conn.execute("SELECT setval('bed_bed_id_seq', (SELECT max(bed_id) FROM bed));")
            print(f"   Seeded exactly {len(beds_data)} beds across all departments.")

            # Map beds by status for relational linking
            occupied_beds = [b for b in beds_data if b[5] == "OCCUPIED"]
            reserved_beds = [b for b in beds_data if b[5] == "RESERVED"]
            dirty_beds = [b for b in beds_data if b[5] == "DIRTY"]
            cleaning_beds = [b for b in beds_data if b[5] == "CLEANING_IN_PROGRESS"]

            total_active_inpatients = len(occupied_beds) + len(reserved_beds)
            total_discharged_patients = 15
            total_patients = total_active_inpatients + total_discharged_patients

            print(f"\n   Breakdown of Bed States:")
            print(f"   - OCCUPIED: {len(occupied_beds)} (Requires active patient + admission + bed_allocation)")
            print(f"   - RESERVED: {len(reserved_beds)} (Requires active patient + incoming admission + bed_allocation)")
            print(f"   - DIRTY: {len(dirty_beds)} (Requires pending cleaning_task)")
            print(f"   - CLEANING_IN_PROGRESS: {len(cleaning_beds)} (Requires in-progress cleaning_task with assigned cleaner)")
            print(f"   - AVAILABLE: {len([b for b in beds_data if b[5] == 'AVAILABLE'])}")
            print(f"   - MAINTENANCE: {len([b for b in beds_data if b[5] == 'MAINTENANCE'])}")

            # -------------------------------------------------------------
            # 5. SEED PATIENTS AND ADMISSIONS
            # -------------------------------------------------------------
            print(f"\n5. Seeding {total_patients} Patients ({total_active_inpatients} active inpatients + {total_discharged_patients} discharged)...")
            random.seed(42)  # Deterministic seed for reproducible testing

            patients_data = []
            admissions_data = []
            now = datetime.now(timezone.utc)

            for p_id in range(1, total_patients + 1):
                is_male = (p_id % 2 == 1)
                first_name = FIRST_NAMES_MALE[(p_id // 2) % len(FIRST_NAMES_MALE)] if is_male else FIRST_NAMES_FEMALE[(p_id // 2) % len(FIRST_NAMES_FEMALE)]
                last_name = LAST_NAMES[p_id % len(LAST_NAMES)]
                gender = "MALE" if is_male else "FEMALE"
                dob_year = 1945 + (p_id * 7) % 55
                dob_month = 1 + (p_id * 3) % 12
                dob_day = 1 + (p_id * 5) % 28
                dob = date(dob_year, dob_month, dob_day)
                phone = f"+1 (555) {100 + (p_id * 3) % 899:03d}-{1000 + p_id * 17 % 8999:04d}"
                address = f"{100 + p_id * 12} Healthcare Blvd, Suite {p_id}, Metro City"

                patients_data.append((p_id, first_name, None, last_name, dob, gender, phone, address, True))

                # Admissions
                diag_info = CLINICAL_CONDITIONS[(p_id - 1) % len(CLINICAL_CONDITIONS)]
                primary_diag = diag_info[0]
                acuity = diag_info[1]

                if p_id <= total_active_inpatients:
                    # Active inpatient stay: discharge_datetime IS NULL
                    # Arrival time between 2 hours ago and 4 days ago
                    arrival_hours_ago = 2 + (p_id * 3) % 90
                    arrival_time = now - timedelta(hours=arrival_hours_ago)
                    admissions_data.append((
                        p_id, p_id, arrival_time, None, primary_diag, acuity,
                        f"Inpatient admission for {primary_diag}. Monitored on clinical pathway."
                    ))
                else:
                    # Discharged patient: discharge_datetime IS populated
                    arrival_days_ago = 5 + (p_id - total_active_inpatients) * 2
                    arrival_time = now - timedelta(days=arrival_days_ago)
                    discharge_time = arrival_time + timedelta(days=2, hours=4)
                    admissions_data.append((
                        p_id, p_id, arrival_time, discharge_time, primary_diag, acuity,
                        f"Discharged home in stable condition following treatment for {primary_diag}."
                    ))

            await conn.executemany("""
                INSERT INTO patient (patient_id, first_name, middle_name, last_name, date_of_birth, gender, phone, address, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
            """, patients_data)
            await conn.execute("SELECT setval('patient_patient_id_seq', (SELECT max(patient_id) FROM patient));")

            await conn.executemany("""
                INSERT INTO admission (admission_id, patient_id, arrival_datetime, discharge_datetime, primary_diagnosis, acuity_level, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7);
            """, admissions_data)
            await conn.execute("SELECT setval('admission_admission_id_seq', (SELECT max(admission_id) FROM admission));")
            print(f"   Seeded {len(patients_data)} patients and {len(admissions_data)} corresponding admissions.")

            # -------------------------------------------------------------
            # 6. SEED BED ALLOCATIONS (1:1 Active Relationships)
            # -------------------------------------------------------------
            print("\n6. Seeding Bed Allocations strictly respecting single-active-allocation unique index...")
            allocations_data = []
            alloc_id = 1

            # 6a. Occupied Beds (Active Inpatients 1 .. 58)
            for idx, bed in enumerate(occupied_beds):
                b_id = bed[0]
                adm_id = idx + 1
                assigned_by = 2 if bed[2] == "EMERGENCY" else 3 if bed[2] == "ICU" else 4
                arrival_time = admissions_data[adm_id - 1][2]
                allocations_data.append((
                    alloc_id, b_id, adm_id, assigned_by, "OCCUPIED", arrival_time, None
                ))
                alloc_id += 1

            # 6b. Reserved Beds (Active Inpatients 59 .. 69)
            res_offset = len(occupied_beds)
            for idx, bed in enumerate(reserved_beds):
                b_id = bed[0]
                adm_id = res_offset + idx + 1
                assigned_by = 2 if bed[2] == "EMERGENCY" else 3
                arrival_time = admissions_data[adm_id - 1][2]
                allocations_data.append((
                    alloc_id, b_id, adm_id, assigned_by, "RESERVED", arrival_time, None
                ))
                alloc_id += 1

            # 6c. Historical allocations for Dirty and Cleaning-in-Progress beds (COMPLETED, end_datetime is set)
            # This reflects that the bed was previously occupied, the patient was discharged, and bed needs cleaning
            for bed in dirty_beds:
                b_id = bed[0]
                # Pick a discharged admission
                discharged_adm_id = total_active_inpatients + (b_id % total_discharged_patients) + 1
                allocations_data.append((
                    alloc_id, b_id, discharged_adm_id, 2, "COMPLETED",
                    now - timedelta(days=2), now - timedelta(hours=1)
                ))
                alloc_id += 1

            for bed in cleaning_beds:
                b_id = bed[0]
                discharged_adm_id = total_active_inpatients + (b_id % total_discharged_patients) + 1
                allocations_data.append((
                    alloc_id, b_id, discharged_adm_id, 3, "COMPLETED",
                    now - timedelta(days=3), now - timedelta(hours=2)
                ))
                alloc_id += 1

            await conn.executemany("""
                INSERT INTO bed_allocation (allocation_id, bed_id, admission_id, assigned_by_personnel_id, status, start_datetime, end_datetime)
                VALUES ($1, $2, $3, $4, $5, $6, $7);
            """, allocations_data)
            await conn.execute("SELECT setval('bed_allocation_allocation_id_seq', (SELECT max(allocation_id) FROM bed_allocation));")
            print(f"   Seeded {len(allocations_data)} bed allocations (58 OCCUPIED, 11 RESERVED, 13 historical COMPLETED).")

            # -------------------------------------------------------------
            # 7. SEED CLEANING TASKS (HOUSEKEEPING WORKFLOW)
            # -------------------------------------------------------------
            print("\n7. Seeding Housekeeping Tasks strictly respecting single-active-cleaning-task unique index...")
            cleaning_tasks = []
            c_id = 1

            # 9 Dirty Beds -> PENDING tasks, personnel_id = NULL
            for b in dirty_beds:
                cleaning_tasks.append((
                    c_id, b[0], None, None, "PENDING",
                    now - timedelta(minutes=45), None, None,
                    "Terminal discharge cleaning requested. High-touch surfaces and linen change."
                ))
                c_id += 1

            # 4 Cleaning-in-Progress Beds -> IN_PROGRESS tasks, assigned to EVS staff (Bob or Sara)
            for idx, b in enumerate(cleaning_beds):
                cleaner_id = 14 if idx % 2 == 0 else 15
                cleaning_tasks.append((
                    c_id, b[0], None, cleaner_id, "IN_PROGRESS",
                    now - timedelta(hours=1, minutes=30), now - timedelta(minutes=25), None,
                    "In-progress deep sterilization & UV-C pathogen cycle."
                ))
                c_id += 1

            # 10 Available Beds with historical COMPLETED tasks
            avail_beds = [b for b in beds_data if b[5] == "AVAILABLE"][:10]
            for b in avail_beds:
                cleaning_tasks.append((
                    c_id, b[0], None, 16, "COMPLETED",
                    now - timedelta(hours=4), now - timedelta(hours=3, minutes=30), now - timedelta(hours=3),
                    "Full terminal disinfection verified and approved."
                ))
                c_id += 1

            await conn.executemany("""
                INSERT INTO cleaning_task (cleaning_id, bed_id, allocation_id, personnel_id, status, requested_datetime, started_datetime, completed_datetime, disinfection_notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
            """, cleaning_tasks)
            await conn.execute("SELECT setval('cleaning_task_cleaning_id_seq', (SELECT max(cleaning_id) FROM cleaning_task));")
            print(f"   Seeded {len(cleaning_tasks)} cleaning tasks (9 PENDING, 4 IN_PROGRESS, 10 COMPLETED).")

            # -------------------------------------------------------------
            # 8. SEED EQUIPMENT ALLOCATIONS (Critical Patient Devices)
            # -------------------------------------------------------------
            print("\n8. Seeding Equipment Allocations for Intensive Care & Emergency patients...")
            # Assign first 6 Ventilators to ICU patients 1..6
            # Assign first 6 Cardiac Monitors to Emergency patients 1..6
            eq_allocations = []
            eq_alloc_id = 1

            # Ventilators
            for i in range(1, 7):
                eq_allocations.append((
                    eq_alloc_id, i, i, 3, now - timedelta(hours=12), None, "ACTIVE"
                ))
                eq_alloc_id += 1

            # Cardiac Monitors
            for i in range(1, 7):
                eq_allocations.append((
                    eq_alloc_id, 8 + i, i, 2, now - timedelta(hours=6), None, "ACTIVE"
                ))
                eq_alloc_id += 1

            await conn.executemany("""
                INSERT INTO equipment_allocation (equipment_allocation_id, equipment_id, admission_id, allocated_by_personnel_id, start_datetime, end_datetime, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7);
            """, eq_allocations)
            await conn.execute("SELECT setval('equipment_allocation_equipment_allocation_id_seq', (SELECT max(equipment_allocation_id) FROM equipment_allocation));")

            # Update equipment status to ALLOCATED for active allocations
            allocated_eq_ids = [a[1] for a in eq_allocations]
            await conn.execute("""
                UPDATE equipment SET status = 'ALLOCATED', version = version + 1
                WHERE equipment_id = ANY($1::int[]);
            """, allocated_eq_ids)
            print(f"   Seeded {len(eq_allocations)} active equipment allocations.")

            # -------------------------------------------------------------
            # 9. SEED NURSE SHIFT ASSIGNMENTS
            # -------------------------------------------------------------
            print("\n9. Seeding Nurse Shift Assignments across all clinical units...")
            nurse_dept_map = {
                "EMERGENCY": [6, 7],      # Carol, Dave
                "ICU": [8, 9],            # Emily, Frank
                "STEP_DOWN": [10],        # Grace
                "GENERAL_WARD": [11, 12], # Helen, Ian
                "SURGERY": [13],          # Jack
            }

            nurse_assignments = []
            n_assign_id = 1

            # Active Inpatients
            for idx, bed in enumerate(occupied_beds + reserved_beds):
                adm_id = idx + 1
                dept = bed[2]
                nurses = nurse_dept_map.get(dept, [6])
                assigned_nurse = nurses[idx % len(nurses)]
                arrival_time = admissions_data[adm_id - 1][2]
                nurse_assignments.append((
                    n_assign_id, adm_id, assigned_nurse, arrival_time, None, "ACTIVE"
                ))
                n_assign_id += 1

            # Discharged Patients
            for idx in range(total_discharged_patients):
                adm_id = total_active_inpatients + idx + 1
                assigned_nurse = 11 if idx % 2 == 0 else 12
                arrival_time = admissions_data[adm_id - 1][2]
                disch_time = admissions_data[adm_id - 1][3]
                nurse_assignments.append((
                    n_assign_id, adm_id, assigned_nurse, arrival_time, disch_time, "COMPLETED"
                ))
                n_assign_id += 1

            await conn.executemany("""
                INSERT INTO patient_nurse_assignment (assignment_id, admission_id, nurse_id, start_datetime, end_datetime, status)
                VALUES ($1, $2, $3, $4, $5, $6);
            """, nurse_assignments)
            await conn.execute("SELECT setval('patient_nurse_assignment_assignment_id_seq', (SELECT max(assignment_id) FROM patient_nurse_assignment));")
            print(f"   Seeded {len(nurse_assignments)} nurse shift assignments.")

            # -------------------------------------------------------------
            # 10. SEED CLINICAL OBSERVATIONS & VITALS (CheckConstraint Compliant)
            # -------------------------------------------------------------
            print("\n10. Seeding Clinical Observations strictly adhering to 21 CFR Part 11 physiological check constraints...")
            # Check constraints:
            # - heart_rate_bpm: > 0 AND < 300
            # - systolic_bp: > 0 AND < 350
            # - diastolic_bp: > 0 AND < 250
            # - oxygen_saturation_pct: >= 0.0 AND <= 100.0
            # - temperature_celsius: >= 25.0 AND <= 45.0
            # - respiratory_rate: >= 0 AND <= 100
            observations = []
            obs_id = 1

            for adm_idx in range(total_active_inpatients):
                adm_id = adm_idx + 1
                arrival_time = admissions_data[adm_idx][2]
                acuity = admissions_data[adm_idx][5]
                nurse_id = nurse_assignments[adm_idx][2]

                # Base vitals modified by acuity
                if acuity == "ESI_1":
                    hr = random.randint(110, 145)
                    sbp = random.randint(85, 110)
                    dbp = random.randint(50, 70)
                    spo2 = round(random.uniform(89.0, 94.0), 1)
                    temp = round(random.uniform(37.8, 39.2), 1)
                    rr = random.randint(24, 32)
                elif acuity == "ESI_2":
                    hr = random.randint(90, 115)
                    sbp = random.randint(130, 165)
                    dbp = random.randint(80, 100)
                    spo2 = round(random.uniform(92.0, 96.0), 1)
                    temp = round(random.uniform(37.0, 38.5), 1)
                    rr = random.randint(18, 24)
                else:
                    hr = random.randint(68, 88)
                    sbp = random.randint(115, 135)
                    dbp = random.randint(70, 85)
                    spo2 = round(random.uniform(96.0, 99.5), 1)
                    temp = round(random.uniform(36.6, 37.4), 1)
                    rr = random.randint(14, 18)

                # Baseline reading at arrival
                observations.append((
                    obs_id, adm_id, nurse_id, arrival_time + timedelta(minutes=10),
                    hr, sbp, dbp, spo2, temp, rr,
                    "Baseline triage vitals charted upon inpatient bed arrival.",
                    False, None, None
                ))
                obs_id += 1

                # Progress reading 1 hour ago
                if arrival_time < now - timedelta(hours=2):
                    progress_hr = max(55, min(160, hr + random.randint(-8, 5)))
                    progress_sbp = max(90, min(170, sbp + random.randint(-10, 8)))
                    progress_spo2 = min(100.0, max(90.0, spo2 + round(random.uniform(0.5, 2.0), 1)))
                    observations.append((
                        obs_id, adm_id, nurse_id, now - timedelta(minutes=45),
                        progress_hr, progress_sbp, dbp, progress_spo2, temp, rr,
                        "Routine unit vital signs reassessment. Patient responding appropriately.",
                        False, None, None
                    ))
                    obs_id += 1

            await conn.executemany("""
                INSERT INTO patient_observation (
                    observation_id, admission_id, recorded_by_user_id, observation_datetime,
                    heart_rate_bpm, systolic_bp, diastolic_bp, oxygen_saturation_pct,
                    temperature_celsius, respiratory_rate, notes, is_correction,
                    corrects_observation_id, correction_reason
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
            """, observations)
            await conn.execute("SELECT setval('patient_observation_observation_id_seq', (SELECT max(observation_id) FROM patient_observation));")
            print(f"   Seeded {len(observations)} clinical observations & vitals readings.")

        print("\nAll relational tables committed successfully in a single ACID transaction!")

    finally:
        await conn.close()


async def invalidate_redis_cache():
    print("\n11. Invalidating Redis bed grid cache...")
    try:
        import redis.asyncio as aioredis
        redis_url = os.getenv("REDIS_URL", "redis://hip-redis:6379")
        r = aioredis.from_url(redis_url, decode_responses=True)
        await r.delete("beds:grid:all")
        print("   Cleared Redis key 'beds:grid:all'. Next API call will load fresh relational data.")
        await r.aclose()
    except Exception as e:
        print(f"   Note: Redis cache invalidation bypassed: {e}")


if __name__ == "__main__":
    asyncio.run(seed_database())
    asyncio.run(invalidate_redis_cache())
    print("\nDatabase seeding completed with 100% relational integrity.")

