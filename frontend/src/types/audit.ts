export type AuditEventType =
    | 'AUTH_LOGIN'
    | 'AUTH_LOGOUT'
    | 'EMS_INBOUND_LOGGED'
    | 'BED_CREATED'
    | 'BED_RESERVED'
    | 'BED_RELEASED'
    | 'PATIENT_ARRIVED'
    | 'PATIENT_DISCHARGED'
    | 'CLEANING_STARTED'
    | 'CLEANING_COMPLETED'
    | 'ADMIN_OVERRIDE';

export interface AuditLogEntry {
    id: string;
    timestamp: string;
    event_type: AuditEventType;
    actor_username: string;
    actor_role: string;
    resource_id: string;         // e.g., "BED-ICU-02" or "PATIENT-1042"
    details: string;
}