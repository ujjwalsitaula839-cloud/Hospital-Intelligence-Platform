export interface PatientRecord {
    patient_id: number;
    first_name: string;
    middle_name?: string | null;
    last_name: string;
    name: string;
    date_of_birth: string;
    age: number;
    gender: 'MALE' | 'FEMALE' | 'OTHER';
    phone?: string | null;
    address?: string | null;
    create_datetime?: string;
    update_datetime?: string;
    created_at?: string;
    updated_at?: string;
}

export interface PatientRegisterRequest {
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    date_of_birth?: string;
    gender: string;
    phone?: string;
    address?: string;
    // Legacy support
    name?: string;
    age?: number;
}

export interface PatientSearchParams {
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
    phone?: string;
}

export interface Admission {
    admission_id: number;
    patient_id: number;
    arrival_datetime: string;
    discharge_datetime?: string | null;
    primary_diagnosis?: string | null;
    acuity_level: string;
    notes?: string | null;
    create_datetime?: string;
    update_datetime?: string;

    // Backwards compatibility aliases
    arrival_time?: string;
    discharge?: string | null;
    encounter_id?: number;
    discharge_time?: string | null;
    diagnosis?: string | null;
    created_at?: string;
    updated_at?: string;
    status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

export type Encounter = Admission;

export interface AdmissionCreateRequest {
    patient_id: number;
    primary_diagnosis?: string;
    diagnosis?: string;
    acuity_level?: string;
    notes?: string;
}

export type EncounterCreateRequest = AdmissionCreateRequest;

export interface PatientNurseAssignment {
    assignment_id: number;
    admission_id: number;
    encounter_id?: number;
    nurse_id: number;
    start_datetime: string;
    end_datetime?: string | null;
    start_time?: string;
    end_time?: string | null;
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}
