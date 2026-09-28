-- Read-only counts. Do not print patient records or credentials during deployment.
SELECT 'unknown_roles' AS issue,count(*) FROM users WHERE role IS NULL OR
 upper(replace(trim(role),' ','_')) NOT IN ('EMS','NURSE','CHARGE_NURSE','DOCTOR')
UNION ALL SELECT 'case_insensitive_email_duplicates',count(*) FROM
 (SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*)>1) d
UNION ALL SELECT 'missing_bed_departments',count(*) FROM bed_registry WHERE department IS NULL OR btrim(department)=''
UNION ALL SELECT 'orphan_bed_patients',count(*) FROM bed_registry b WHERE nullif(b.assigned_patient_id,'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM patient_records p WHERE p.patient_id=b.assigned_patient_id)
UNION ALL SELECT 'duplicate_active_beds_for_patient',count(*) FROM
 (SELECT assigned_patient_id FROM bed_registry WHERE nullif(assigned_patient_id,'') IS NOT NULL
 GROUP BY assigned_patient_id HAVING count(*)>1) d
UNION ALL SELECT 'bed_status_assignment_mismatch',count(*) FROM bed_registry
 WHERE (status IN ('RESERVED','OCCUPIED')) <> (nullif(assigned_patient_id,'') IS NOT NULL)
UNION ALL SELECT 'patient_room_bed_mismatch',count(*) FROM bed_registry b
 JOIN patient_records p ON p.patient_id=b.assigned_patient_id
 WHERE nullif(btrim(p.room),'') IS NOT NULL AND p.room<>b.bed_code;
