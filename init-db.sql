-- =================================================================
-- HIP Database Schema Isolation
-- Creates separate schemas and restricted users per microservice
-- This script runs once when the PostgreSQL container is first created
-- =================================================================

-- Create schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS patient;
CREATE SCHEMA IF NOT EXISTS bed;

-- Note: The application currently uses a shared database user (hip_admin)
-- and default 'public' schema. Full isolation requires:
-- 1. Creating separate users per service
-- 2. Granting each user access only to their schema
-- 3. Updating DATABASE_URL per service to set search_path
--
-- Uncomment the following when ready to enforce full isolation:

-- CREATE USER hip_auth_user WITH PASSWORD 'CHANGE_ME_AUTH_PASSWORD';
-- CREATE USER hip_patient_user WITH PASSWORD 'CHANGE_ME_PATIENT_PASSWORD';
-- CREATE USER hip_bed_user WITH PASSWORD 'CHANGE_ME_BED_PASSWORD';

-- GRANT USAGE ON SCHEMA auth TO hip_auth_user;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO hip_auth_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO hip_auth_user;

-- GRANT USAGE ON SCHEMA patient TO hip_patient_user;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA patient TO hip_patient_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA patient GRANT ALL ON TABLES TO hip_patient_user;

-- GRANT USAGE ON SCHEMA bed TO hip_bed_user;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA bed TO hip_bed_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA bed GRANT ALL ON TABLES TO hip_bed_user;

-- After enabling, update docker-compose.yml DATABASE_URL per service:
-- auth-service:  DATABASE_URL=postgresql+asyncpg://hip_auth_user:password@hip-postgres:5432/hospital_intelligence?options=-csearch_path=auth
-- patient-service: DATABASE_URL=postgresql+asyncpg://hip_patient_user:password@hip-postgres:5432/hospital_intelligence?options=-csearch_path=patient
-- bed-service:   DATABASE_URL=postgresql+asyncpg://hip_bed_user:password@hip-postgres:5432/hospital_intelligence?options=-csearch_path=bed
