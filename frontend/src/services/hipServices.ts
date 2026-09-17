import axios from 'axios';
import type {
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    PersonnelProfile,
    BedAsset,
    BedCreateRequest,
    BedReserveRequest,
    BedTransferRequest,
    PatientRecord,
    PatientRegisterRequest,
    PatientSearchParams,
    Admission,
    Encounter,
    AdmissionCreateRequest,
    EncounterCreateRequest,
    PatientNurseAssignment,
    CleaningTask,
    EquipmentItem,
    EquipmentTypeInfo,
    EquipmentAllocateRequest
} from '../types';

const api = axios.create({
    baseURL: '',
    headers: {
        'Content-Type': 'application/json',
    },
});

// Attach Authorization Token interceptor
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('hip_access_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// --- AUTHENTICATION SERVICES ---
export const authService = {
    async login(data: LoginRequest): Promise<AuthResponse> {
        const res = await api.post<AuthResponse>('/auth/login', data);
        if (res.data.access_token) {
            localStorage.setItem('hip_access_token', res.data.access_token);
            localStorage.setItem('hip_user', JSON.stringify({
                personnel_id: res.data.personnel_id,
                username: res.data.username,
                full_name: res.data.full_name,
                role: res.data.role,
                department: res.data.department
            }));
        }
        return res.data;
    },

    async register(data: RegisterRequest): Promise<PersonnelProfile> {
        const res = await api.post<PersonnelProfile>('/auth/register', data);
        return res.data;
    },

    async getMe(): Promise<PersonnelProfile> {
        const res = await api.get<PersonnelProfile>('/auth/me');
        return res.data;
    },

    async getNurses(): Promise<PersonnelProfile[]> {
        const res = await api.get<PersonnelProfile[]>('/auth/personnel/nurses');
        return res.data;
    },

    logout() {
        localStorage.removeItem('hip_access_token');
        localStorage.removeItem('hip_user');
    },

    getCurrentUser(): Partial<PersonnelProfile> | null {
        const raw = localStorage.getItem('hip_user');
        return raw ? JSON.parse(raw) : null;
    }
};

// --- BED MANAGEMENT SERVICES ---
export const bedService = {
    async getGrid(): Promise<BedAsset[]> {
        const res = await api.get<{ beds: BedAsset[] }>('/beds/grid');
        return res.data.beds;
    },

    async createBed(data: BedCreateRequest): Promise<{ status: string; message: string }> {
        const res = await api.post<{ status: string; message: string }>('/beds/create', data);
        return res.data;
    },

    async reserveBed(bedCode: string, payload: BedReserveRequest): Promise<{ status: string; message: string }> {
        const res = await api.put<{ status: string; message: string }>(`/beds/reserve/${bedCode}`, payload);
        return res.data;
    },

    async confirmAdmission(bedCode: string): Promise<{ status: string; message: string }> {
        const res = await api.put<{ status: string; message: string }>(`/beds/admit/${bedCode}`);
        return res.data;
    },

    async transferBed(data: BedTransferRequest): Promise<{ status: string; message: string }> {
        const res = await api.post<{ status: string; message: string }>('/beds/transfer', data);
        return res.data;
    },

    async dischargeBed(bedCode: string): Promise<{ status: string; message: string }> {
        const res = await api.put<{ status: string; message: string }>(`/beds/discharge/${bedCode}`);
        return res.data;
    }
};

// --- PATIENT & ADMISSION SERVICES ---
export const patientService = {
    async registerPatient(data: PatientRegisterRequest): Promise<PatientRecord> {
        const res = await api.post<PatientRecord>('/patients/register', data);
        return res.data;
    },

    async getRecords(): Promise<PatientRecord[]> {
        const res = await api.get<PatientRecord[]>('/patients/records');
        return res.data;
    },

    async searchPatients(params: PatientSearchParams): Promise<PatientRecord[]> {
        const res = await api.get<PatientRecord[]>('/patients/search', { params });
        return res.data;
    },

    async verifyPatient(patientId: number): Promise<any> {
        const res = await api.get(`/patients/verify/${patientId}`);
        return res.data;
    },

    // Admission & Encounter Methods
    async createAdmission(data: AdmissionCreateRequest): Promise<Admission> {
        const res = await api.post<Admission>('/patients/admissions/create', data);
        return res.data;
    },

    async createEncounter(data: EncounterCreateRequest): Promise<Encounter> {
        return this.createAdmission(data);
    },

    async getActiveAdmission(patientId: number): Promise<Admission | null> {
        const res = await api.get<Admission | null>(`/patients/admissions/active/${patientId}`);
        return res.data;
    },

    async getActiveEncounter(patientId: number): Promise<Encounter | null> {
        return this.getActiveAdmission(patientId);
    },

    async getPatientAdmissions(patientId: number): Promise<Admission[]> {
        const res = await api.get<Admission[]>(`/patients/admissions/patient/${patientId}`);
        return res.data;
    },

    async getPatientEncounters(patientId: number): Promise<Encounter[]> {
        return this.getPatientAdmissions(patientId);
    },

    // Nurse Assignment Methods
    async assignNurse(admissionId: number, nurseId: number): Promise<PatientNurseAssignment> {
        const res = await api.post<PatientNurseAssignment>(`/patients/admissions/${admissionId}/assign-nurse`, { nurse_id: nurseId });
        return res.data;
    },

    async getNurseAssignments(admissionId: number): Promise<PatientNurseAssignment[]> {
        const res = await api.get<PatientNurseAssignment[]>(`/patients/admissions/${admissionId}/nurse-assignments`);
        return res.data;
    }
};

// --- CLEANING CREW (EVS) SERVICES ---
export const cleaningService = {
    async getTasks(status?: string): Promise<CleaningTask[]> {
        const params = status ? { status_filter: status } : {};
        const res = await api.get<{ tasks: CleaningTask[] }>('/beds/cleaning/tasks', { params });
        return res.data.tasks;
    },

    async startCleaning(cleaningId: number): Promise<{ status: string; message: string }> {
        const res = await api.put<{ status: string; message: string }>(`/beds/cleaning/start/${cleaningId}`);
        return res.data;
    },

    async completeCleaning(cleaningId: number): Promise<{ status: string; message: string }> {
        const res = await api.put<{ status: string; message: string }>(`/beds/cleaning/complete/${cleaningId}`);
        return res.data;
    }
};

// --- EQUIPMENT SERVICES ---
export const equipmentService = {
    async getTypes(): Promise<EquipmentTypeInfo[]> {
        const res = await api.get<{ types: EquipmentTypeInfo[] }>('/beds/equipment/types');
        return res.data.types;
    },

    async getList(): Promise<EquipmentItem[]> {
        const res = await api.get<{ equipment: EquipmentItem[] }>('/beds/equipment/list');
        return res.data.equipment;
    },

    async allocate(data: EquipmentAllocateRequest): Promise<{ status: string; message: string }> {
        const res = await api.post<{ status: string; message: string }>('/beds/equipment/allocate', data);
        return res.data;
    },

    async release(allocationId: number): Promise<{ status: string; message: string }> {
        const res = await api.put<{ status: string; message: string }>(`/beds/equipment/release/${allocationId}`);
        return res.data;
    }
};
