export type Role = 'ADMIN' | 'DOCTOR' | 'NURSE' | 'CLEANING_CREW' | 'PHARMACY';

export type Department =
  | 'EMERGENCY'
  | 'ICU'
  | 'STEP_DOWN'
  | 'GENERAL_WARD'
  | 'SURGERY'
  | 'PHARMACY'
  | 'HOUSEKEEPING'
  | 'ADMINISTRATION';

export type BedStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'OCCUPIED'
  | 'DIRTY'
  | 'CLEANING_IN_PROGRESS'
  | 'MAINTENANCE';

export type AcuityLevel = 'ESI_1' | 'ESI_2' | 'ESI_3' | 'ESI_4' | 'ESI_5';

export type CleaningTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface TokenClaims {
  personnel_id: number;
  username: string;
  full_name: string;
  role: Role;
  department: Department;
  must_change_password: boolean;
  exp: number;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  expires_in: number;
  personnel_id: number;
  username: string;
  full_name: string;
  role: Role;
  department: Department;
  must_change_password: boolean;
}

export interface Bed {
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
  patient_name?: string | null;
  acuity_level?: AcuityLevel | null;
  primary_diagnosis?: string | null;
  equipment?: string[];
  update_datetime?: string | null;
  updated_at?: string | null;
}

export interface Patient {
  patient_id: number;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  name?: string;
  date_of_birth: string;
  age?: number;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  phone?: string | null;
  address?: string | null;
  is_active: boolean;
  create_datetime?: string | null;
  update_datetime?: string | null;
}

export interface Admission {
  admission_id: number;
  encounter_id?: number;
  patient_id: number;
  arrival_datetime: string;
  discharge_datetime?: string | null;
  primary_diagnosis?: string | null;
  diagnosis?: string | null;
  acuity_level: AcuityLevel;
  notes?: string | null;
  create_datetime?: string | null;
  update_datetime?: string | null;
}

export interface CleaningTask {
  cleaning_id: number;
  bed_id: number;
  allocation_id?: number | null;
  bed_code: string;
  department: Department;
  room_number: string;
  status: CleaningTaskStatus;
  personnel_id?: number | null;
  requested_datetime?: string | null;
  started_datetime?: string | null;
  completed_datetime?: string | null;
  disinfection_notes?: string | null;
}

export interface BedEvent {
  event_type: string;
  actor: string;
  actor_role?: string;
  timestamp: string;
  bed_id?: number;
  bed_code?: string;
  from_bed?: string;
  to_bed?: string;
  department?: Department;
  status?: BedStatus;
  version?: number;
  admission_id?: number;
  cleaning_id?: number;
  message?: string;
}

export interface ApiError {
  detail: string;
}

export interface Observation {
  observation_id: number;
  admission_id: number;
  recorded_by_user_id: number;
  observation_datetime: string;
  heart_rate_bpm?: number | null;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  oxygen_saturation_pct?: number | null;
  temperature_celsius?: number | null;
  respiratory_rate?: number | null;
  notes?: string | null;
  is_correction?: boolean;
  corrects_observation_id?: number | null;
  correction_reason?: string | null;
}

export interface ObservationInput {
  heart_rate_bpm?: number | null;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  oxygen_saturation_pct?: number | null;
  temperature_celsius?: number | null;
  respiratory_rate?: number | null;
  notes?: string | null;
}

export interface EquipmentAllocationItem {
  equipment_allocation_id: number;
  equipment_id: number;
  admission_id: number;
  allocated_by_personnel_id: number;
  start_datetime: string;
  end_datetime?: string | null;
  status: string;
}

export interface EquipmentItem {
  equipment_id: number;
  serial_number: string;
  equipment_name: string;
  equipment_type: string;
  department: Department;
  status: 'AVAILABLE' | 'ALLOCATED' | 'MAINTENANCE' | 'DECOMMISSIONED';
  version: number;
  last_inspected_datetime?: string | null;
  allocations?: EquipmentAllocationItem[];
}

export interface PatientCreateInput {
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  date_of_birth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  phone?: string | null;
  address?: string | null;
}

export interface PatientUpdateInput {
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  date_of_birth?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  phone?: string | null;
  address?: string | null;
  is_active?: boolean;
}

export interface BedTransferInput {
  from_bed_code: string;
  to_bed_code: string;
}

export interface StaffMember {
  personnel_id: number;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  department: Department;
  is_active: boolean;
  must_change_password: boolean;
}

