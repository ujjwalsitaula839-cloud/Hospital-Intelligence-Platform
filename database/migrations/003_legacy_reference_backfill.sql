-- No encounters are invented: the old schema has no arrival/journey timestamps.
-- Normalize only facts already represented in existing rows.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM users WHERE role IS NULL OR upper(replace(trim(role),' ','_'))
        NOT IN ('EMS','NURSE','CHARGE_NURSE','DOCTOR')) THEN
        RAISE EXCEPTION 'Unrecognized legacy roles require explicit mapping';
    END IF;
    IF EXISTS(SELECT 1 FROM bed_registry WHERE department IS NULL OR btrim(department)='') THEN
        RAISE EXCEPTION 'Beds require department names';
    END IF;
    IF EXISTS(SELECT 1 FROM bed_registry b WHERE nullif(b.assigned_patient_id,'') IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM patient_records p WHERE p.patient_id=b.assigned_patient_id)) THEN
        RAISE EXCEPTION 'Legacy beds reference missing patients';
    END IF;
    IF EXISTS(SELECT assigned_patient_id FROM bed_registry WHERE nullif(assigned_patient_id,'') IS NOT NULL
        GROUP BY assigned_patient_id HAVING count(*)>1) THEN
        RAISE EXCEPTION 'A legacy patient has multiple assigned beds';
    END IF;
    IF EXISTS(SELECT 1 FROM bed_registry WHERE
        (status IN ('RESERVED','OCCUPIED')) <> (nullif(assigned_patient_id,'') IS NOT NULL)) THEN
        RAISE EXCEPTION 'Legacy bed status and assignment disagree';
    END IF;
    IF EXISTS(SELECT 1 FROM bed_registry b JOIN patient_records p ON p.patient_id=b.assigned_patient_id
        WHERE nullif(btrim(p.room),'') IS NOT NULL AND p.room<>b.bed_code) THEN
        RAISE EXCEPTION 'Legacy patient room and reserved bed disagree';
    END IF;
END $$;

INSERT INTO user_roles(user_id,role_id)
SELECT u.id,r.id FROM users u JOIN roles r ON r.code=upper(replace(trim(u.role),' ','_'));

INSERT INTO departments(code,name)
SELECT 'LEGACY_'||md5(department),department FROM (SELECT DISTINCT department FROM bed_registry) b
WHERE upper(btrim(department)) NOT IN ('ER','EMERGENCY DEPARTMENT');
UPDATE bed_registry b SET department_id=d.id FROM departments d
WHERE (upper(btrim(b.department)) IN ('ER','EMERGENCY DEPARTMENT') AND d.code='ER')
   OR d.code='LEGACY_'||md5(b.department);
-- department_id stays nullable during expansion: old /beds/create writes only department.
-- Enforce NOT NULL in the later API-cutover migration, after all writers use IDs.

COMMENT ON COLUMN patient_records.room IS 'Legacy only. New APIs must use bed_assignments; retained until reviewed encounter import.';
COMMENT ON COLUMN patient_records.assigned_user_id IS 'Legacy creator ID string, not a confirmed nursing assignment.';
COMMENT ON COLUMN bed_registry.assigned_patient_id IS 'Legacy linkage. Not synchronized with bed_assignments until API cutover.';
COMMENT ON COLUMN users.role IS 'Legacy role field. New API authorization must use user_roles.';
COMMENT ON TABLE encounters IS 'No automatic legacy encounter import: journey state and timestamps require review.';
