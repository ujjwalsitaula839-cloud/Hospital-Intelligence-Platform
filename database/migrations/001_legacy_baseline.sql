-- Preserve the original three tables and identifiers. Existing incompatible
-- installations fail during the following migration, rolling back this batch.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, username VARCHAR NOT NULL UNIQUE,
    email VARCHAR NOT NULL UNIQUE, hashed_password VARCHAR NOT NULL,
    role VARCHAR DEFAULT 'doctor', is_active BOOLEAN DEFAULT true
);
CREATE TABLE IF NOT EXISTS patient_records (
    id SERIAL PRIMARY KEY, patient_id VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL, diagnosis VARCHAR NOT NULL,
    room VARCHAR NOT NULL, assigned_user_id VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS bed_registry (
    id SERIAL PRIMARY KEY, bed_code VARCHAR NOT NULL UNIQUE,
    department VARCHAR NOT NULL, status VARCHAR DEFAULT 'AVAILABLE',
    assigned_patient_id VARCHAR, version INTEGER DEFAULT 1,
    reserved_by VARCHAR, reserved_at TIMESTAMP,
    released_by VARCHAR, released_at TIMESTAMP
);
