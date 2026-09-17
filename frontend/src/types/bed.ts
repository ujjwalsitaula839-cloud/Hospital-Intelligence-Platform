export type BedStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'DIRTY' | 'CLEANING_IN_PROGRESS' | 'OUT_OF_SERVICE';

export type Department = 'EMERGENCY' | 'ICU' | 'STEP_DOWN' | 'GENERAL_WARD' | string;

export interface BedAsset {
    bed_id: number;
    allocation_id?: number | null;
    bed_code: string;
    department: Department;
    room_number: string;
    bed_type: string;
    status: BedStatus;
    version: number;
    admission_id?: number | null;
    encounter_id?: number | null;
    patient_id?: number | null;
    acuity_level?: string | null;
    primary_diagnosis?: string | null;
    diagnosis?: string | null;
    equipment?: string[];
    update_datetime?: string | null;
    create_datetime?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
}

export interface BedGridResponse {
    beds: BedAsset[];
}

export interface BedCreateRequest {
    bed_code: string;
    department: string;
    room_number?: string;
    bed_type?: string;
}

export interface BedReserveRequest {
    admission_id?: number;
    encounter_id?: number;
    patient_id?: number;
    acuity_level?: string;
    primary_diagnosis?: string;
    diagnosis?: string;
    notes?: string;
}

export interface BedTransferRequest {
    from_bed_code: string;
    to_bed_code: string;
}


export interface BedMetrics {
    total: number;
    available: number;
    reserved: number;
    occupied: number;
    dirty: number;
    cleaning: number;
    occupancy_rate: number;
}

export interface BedEventPayload {
    event_type: 'BED_CREATED' | 'BED_RESERVED' | 'BED_OCCUPIED' | 'BED_DIRTY' | 'CLEANING_STARTED' | 'BED_AVAILABLE' | 'EQUIPMENT_ALLOCATED';
    bed_code?: string;
    patient_id?: number;
    status?: BedStatus;
    actor?: string;
    timestamp: string;
    cleaning_id?: number;
    [key: string]: any;
}