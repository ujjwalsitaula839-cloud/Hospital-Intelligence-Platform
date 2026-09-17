export type EquipmentType = 
    | 'VENTILATOR'
    | 'CARDIAC_MONITOR'
    | 'INFUSION_PUMP'
    | 'CRASH_CART'
    | 'NEGATIVE_PRESSURE'
    | 'DEFIBRILLATOR'
    | string;

export interface EquipmentTypeInfo {
    equipment_type_id: number;
    name: string;
    description?: string | null;
}

export interface EquipmentItem {
    equipment_id: number;
    serial_number: string;
    equipment_name: string;
    equipment_type_id?: number;
    equipment_type: EquipmentType;
    department: string;
    status: 'AVAILABLE' | 'ALLOCATED' | 'MAINTENANCE' | 'DECOMMISSIONED';
    version?: number;
    allocation_id?: number | null;
    admission_id?: number | null;
    last_inspected_datetime?: string | null;
    last_inspected_at?: string | null;
    active_admission_id?: number | null;
    active_encounter_id?: number | null;
    allocated_bed_code?: string | null;
}

export interface EquipmentListResponse {
    equipment: EquipmentItem[];
}

export interface EquipmentAllocateRequest {
    equipment_id: number;
    admission_id?: number;
    encounter_id?: number;
    bed_code?: string;
}
