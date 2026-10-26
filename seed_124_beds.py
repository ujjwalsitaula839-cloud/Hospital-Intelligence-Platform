import asyncio
import asyncpg
import redis.asyncio as aioredis

import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://hip_admin:password@localhost:5431/hospital_intelligence")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# 124 beds definition matching floors.js exactly
BED_SPECS = []

# Floor 1 (32)
BED_SPECS.append({"bed_code": "ED-T1", "room_number": "ED-T1", "floor_number": 1, "department": "EMERGENCY", "bed_type": "TRAUMA"})
BED_SPECS.append({"bed_code": "ED-T2", "room_number": "ED-T2", "floor_number": 1, "department": "EMERGENCY", "bed_type": "TRAUMA"})
for i in range(1, 13):
    code = f"ED-{str(i).zfill(2)}"
    BED_SPECS.append({"bed_code": code, "room_number": code, "floor_number": 1, "department": "EMERGENCY", "bed_type": "STANDARD"})
for i in range(1, 11):
    code = f"FAST-{i}"
    BED_SPECS.append({"bed_code": code, "room_number": code, "floor_number": 1, "department": "EMERGENCY", "bed_type": "STANDARD"})
for i in range(1, 9):
    code = f"OBS-{i}"
    BED_SPECS.append({"bed_code": code, "room_number": code, "floor_number": 1, "department": "EMERGENCY", "bed_type": "STANDARD"})

# Floor 2 (24)
for i in range(201, 225):
    code = f"MED-{i}"
    BED_SPECS.append({"bed_code": code, "room_number": code, "floor_number": 2, "department": "MEDICINE", "bed_type": "STANDARD"})

# Floor 3 (44)
for i in range(301, 313):
    code = f"ICU-{i}"
    BED_SPECS.append({"bed_code": code, "room_number": code, "floor_number": 3, "department": "ICU", "bed_type": "ICU"})
BED_SPECS.append({"bed_code": "OR-1", "room_number": "OR-1", "floor_number": 3, "department": "SURGERY", "bed_type": "OR"})
BED_SPECS.append({"bed_code": "OR-2", "room_number": "OR-2", "floor_number": 3, "department": "SURGERY", "bed_type": "OR"})
BED_SPECS.append({"bed_code": "ER-T1", "room_number": "ER-T1", "floor_number": 3, "department": "EMERGENCY", "bed_type": "TRAUMA"})
BED_SPECS.append({"bed_code": "ER-T2", "room_number": "ER-T2", "floor_number": 3, "department": "EMERGENCY", "bed_type": "TRAUMA"})
for i in range(1, 13):
    code = f"ER-{str(i).zfill(2)}"
    BED_SPECS.append({"bed_code": code, "room_number": code, "floor_number": 3, "department": "EMERGENCY", "bed_type": "STANDARD"})
for i in range(301, 317):
    code = f"MS-{i}"
    BED_SPECS.append({"bed_code": code, "room_number": code, "floor_number": 3, "department": "GENERAL_WARD", "bed_type": "STANDARD"})

# Floor 4 (24)
for i in range(401, 425):
    code = f"SUR-{i}"
    BED_SPECS.append({"bed_code": code, "room_number": code, "floor_number": 4, "department": "SURGERY", "bed_type": "STANDARD"})

# Mapping existing active beds to new blueprint codes:
# Bed 2 (ER-102, occupied by Trauma Doe-864) -> ER-02 (Floor 3)
# Bed 3 (ICU-201, occupied by Trauma Doe-300) -> ICU-301 (Floor 3)
# Bed 6 (GW-401, occupied by Trauma Doe-415) -> MS-301 (Floor 3)
# Bed 10 (ED-104, occupied by Trauma Doe-862) -> ED-04 (Floor 1)
# Bed 25 (GEN-305, cleaning in progress) -> MS-305 (Floor 3)
ACTIVE_MAPPING = {
    "ER-102": {"bed_code": "ER-02", "room_number": "ER-02", "floor_number": 3, "department": "EMERGENCY"},
    "ICU-201": {"bed_code": "ICU-301", "room_number": "ICU-301", "floor_number": 3, "department": "ICU"},
    "GW-401": {"bed_code": "MS-301", "room_number": "MS-301", "floor_number": 3, "department": "GENERAL_WARD"},
    "ED-104": {"bed_code": "ED-04", "room_number": "ED-04", "floor_number": 1, "department": "EMERGENCY"},
    "GEN-305": {"bed_code": "MS-305", "room_number": "MS-305", "floor_number": 3, "department": "GENERAL_WARD"},
}

async def run_seed():
    conn = await asyncpg.connect(DATABASE_URL)
    print("Connected to PostgreSQL database hospital_intelligence.")

    # 1. Update the active beds first
    for old_code, target in ACTIVE_MAPPING.items():
        res = await conn.execute(
            """
            UPDATE bed 
            SET bed_code = $1, room_number = $2, floor_number = $3, department = $4
            WHERE bed_code = $5;
            """,
            target["bed_code"], target["room_number"], target["floor_number"], target["department"], old_code
        )
        print(f"Updated active bed {old_code} -> {target['bed_code']}: {res}")

    # 2. Delete old placeholder beds that are NOT in active mapping and NOT in BED_SPECS
    mapped_codes = {t["bed_code"] for t in ACTIVE_MAPPING.values()}
    all_target_codes = {b["bed_code"] for b in BED_SPECS}
    
    # Check remaining old beds without allocations
    old_beds = await conn.fetch("SELECT bed_id, bed_code FROM bed;")
    for row in old_beds:
        bcode = row["bed_code"]
        bid = row["bed_id"]
        if bcode not in all_target_codes:
            # Check if there are allocations
            allocs = await conn.fetchval("SELECT count(*) FROM bed_allocation WHERE bed_id = $1;", bid)
            tasks = await conn.fetchval("SELECT count(*) FROM cleaning_task WHERE bed_id = $1;", bid)
            if allocs == 0 and tasks == 0:
                await conn.execute("DELETE FROM bed WHERE bed_id = $1;", bid)
                print(f"Deleted old unused placeholder bed {bcode} (id {bid})")
            else:
                print(f"Warning: Old bed {bcode} has records (allocs={allocs}, tasks={tasks})")

    # 3. Insert or update all 124 beds
    for b in BED_SPECS:
        existing = await conn.fetchrow("SELECT bed_id, status FROM bed WHERE bed_code = $1;", b["bed_code"])
        if existing:
            # Update department, floor_number, room_number
            await conn.execute(
                """
                UPDATE bed 
                SET department = $1, floor_number = $2, room_number = $3, bed_type = $4
                WHERE bed_code = $5;
                """,
                b["department"], b["floor_number"], b["room_number"], b["bed_type"], b["bed_code"]
            )
        else:
            # Insert as AVAILABLE
            await conn.execute(
                """
                INSERT INTO bed (bed_code, room_number, floor_number, department, bed_type, status, version)
                VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', 1);
                """,
                b["bed_code"], b["room_number"], b["floor_number"], b["department"], b["bed_type"]
            )

    # 4. Verify total beds in DB
    total = await conn.fetchval("SELECT count(*) FROM bed;")
    available = await conn.fetchval("SELECT count(*) FROM bed WHERE status = 'AVAILABLE';")
    occupied = await conn.fetchval("SELECT count(*) FROM bed WHERE status = 'OCCUPIED';")
    cleaning = await conn.fetchval("SELECT count(*) FROM bed WHERE status = 'CLEANING_IN_PROGRESS';")
    by_floor = await conn.fetch("SELECT floor_number, count(*) FROM bed GROUP BY floor_number ORDER BY floor_number;")

    print(f"\nFinal DB State:")
    print(f"Total Beds: {total}")
    print(f"Available: {available}, Occupied: {occupied}, Cleaning: {cleaning}")
    for r in by_floor:
        print(f"  Floor {r['floor_number']}: {r['count']} beds")

    await conn.close()

    # Invalidate Redis cache
    try:
        r = aioredis.from_url(REDIS_URL)
        await r.delete("beds:grid:all")
        await r.publish("bed:events", json.dumps({"event": "BED_BATCH_SEEDED", "total_beds": total}))
        await r.publish("bed_events", json.dumps({"event": "BED_BATCH_SEEDED", "total_beds": total}))
        await r.aclose()
        print("Redis cache invalidated and event published.")
    except Exception as e:
        print(f"Redis invalidation note: {e}")

if __name__ == "__main__":
    asyncio.run(run_seed())
