import type {
  AcuityLevel,
  Admission,
  ApiError,
  AuthTokens,
  Bed,
  BedStatus,
  BedTransferInput,
  CleaningTask,
  CleaningTaskStatus,
  EquipmentItem,
  Observation,
  ObservationInput,
  Patient,
  PatientCreateInput,
  PatientUpdateInput,
  StaffMember,
  TokenClaims,
} from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export function decodeJwt(token: string): TokenClaims {
  const base64Url = token.split('.')[1];
  if (!base64Url) {
    throw new Error('Invalid JWT format');
  }
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(jsonPayload) as TokenClaims;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = response.statusText;
    try {
      const errorJson = (await response.json()) as ApiError;
      if (errorJson && typeof errorJson.detail === 'string') {
        errorDetail = errorJson.detail;
      } else if (errorJson && errorJson.detail) {
        errorDetail = JSON.stringify(errorJson.detail);
      }
    } catch {
      // Non-JSON response fallback
    }

    if (response.status === 401) {
      sessionStorage.removeItem('token');
      throw new Error(`401 Unauthorized: ${errorDetail}`);
    }
    if (response.status === 403) {
      throw new Error(`403 Forbidden: ${errorDetail}`);
    }
    if (response.status === 409) {
      const err = new Error(`409 Conflict: ${errorDetail}`);
      (err as unknown as { status: number }).status = 409;
      throw err;
    }

    throw new Error(errorDetail || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  login: (credentials: { email: string; password: string }): Promise<AuthTokens> =>
    request<AuthTokens>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),

  forceResetPassword: (payload: { new_password: string; confirm_password: string }): Promise<AuthTokens> =>
    request<AuthTokens>('/auth/force-reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: async (): Promise<void> => {
    try {
      await request<void>('/auth/logout', { method: 'POST' });
    } finally {
      sessionStorage.removeItem('token');
    }
  },

  getBeds: async (): Promise<Bed[]> => {
    const res = await request<{ beds: Bed[] }>('/beds/grid');
    return res.beds;
  },

  updateBedStatus: (
    bedCode: string,
    status: BedStatus,
    payload?: { admission_id?: number; patient_id?: number; expected_version?: number; reason?: string }
  ): Promise<unknown> => {
    if (status === 'OCCUPIED') {
      return request(`/beds/admit/${bedCode}`, { method: 'PUT', body: JSON.stringify(payload || {}) });
    }
    if (status === 'DIRTY') {
      return request(`/beds/discharge/${bedCode}`, { method: 'PUT', body: JSON.stringify(payload || {}) });
    }
    if (status === 'RESERVED') {
      return request(`/beds/reserve/${bedCode}`, {
        method: 'PUT',
        body: JSON.stringify(payload || {}),
      });
    }
    // Physical state override for AVAILABLE, MAINTENANCE, CLEANING_IN_PROGRESS
    return request(`/beds/admin/status/${bedCode}`, {
      method: 'PUT',
      body: JSON.stringify({ status, ...payload }),
    });
  },

  adminUpdateBedStatus: (
    bedCode: string,
    status: BedStatus,
    payload?: { expected_version?: number; reason?: string }
  ): Promise<{ status: string; message: string; version?: number }> =>
    request<{ status: string; message: string; version?: number }>(`/beds/admin/status/${bedCode}`, {
      method: 'PUT',
      body: JSON.stringify({ status, ...payload }),
    }),

  getAdmissions: (patientId?: number): Promise<Admission[]> =>
    patientId
      ? request<Admission[]>(`/patients/admissions/patient/${patientId}`)
      : request<Admission[]>('/patients/admissions'),

  createAdmission: (data: {
    patient_id: number;
    primary_diagnosis?: string;
    acuity_level?: AcuityLevel;
    notes?: string;
  }): Promise<Admission> =>
    request<Admission>('/patients/admissions/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  dischargeAdmission: (admissionId: number): Promise<{ status: string; message: string }> =>
    request<{ status: string; message: string }>(`/patients/admissions/discharge/${admissionId}`, {
      method: 'PUT',
    }),

  getCleaningTasks: async (status?: CleaningTaskStatus): Promise<CleaningTask[]> => {
    const query = status ? `?status_filter=${status}` : '';
    const res = await request<{ tasks: CleaningTask[] }>(`/beds/cleaning/tasks${query}`);
    return res.tasks;
  },

  updateCleaningTask: (
    cleaningId: number,
    payload:
      | CleaningTaskStatus
      | 'start'
      | 'complete'
      | { status: CleaningTaskStatus | 'start' | 'complete'; notes?: string }
  ): Promise<{ status: string; message: string }> => {
    const statusVal = typeof payload === 'string' ? payload : payload.status;
    const action = statusVal === 'IN_PROGRESS' || statusVal === 'start' ? 'start' : 'complete';
    const body = typeof payload === 'object' && payload.notes ? JSON.stringify({ notes: payload.notes }) : undefined;
    return request<{ status: string; message: string }>(`/beds/cleaning/${action}/${cleaningId}`, {
      method: 'PUT',
      body,
    });
  },

  getPatients: (): Promise<Patient[]> => request<Patient[]>('/patients/records'),

  registerPatient: (data: PatientCreateInput): Promise<Patient> =>
    request<Patient>('/patients/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updatePatient: (patientId: number, data: PatientUpdateInput): Promise<Patient> =>
    request<Patient>(`/patients/patient/${patientId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  activatePatient: (patientId: number): Promise<{ status: string; message: string }> =>
    request<{ status: string; message: string }>(`/patients/patient/${patientId}/activate`, {
      method: 'PUT',
    }),

  deactivatePatient: (patientId: number): Promise<{ status: string; message: string }> =>
    request<{ status: string; message: string }>(`/patients/patient/${patientId}/deactivate`, {
      method: 'PUT',
    }),

  getObservations: (admissionId: number): Promise<Observation[]> =>
    request<Observation[]>(`/patients/admissions/${admissionId}/observations`),

  recordObservation: (admissionId: number, data: ObservationInput): Promise<Observation> =>
    request<Observation>(`/patients/admissions/${admissionId}/observations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getEquipmentList: async (): Promise<EquipmentItem[]> => {
    const res = await request<{ equipment: EquipmentItem[] }>('/beds/equipment/list');
    return res.equipment;
  },

  allocateEquipment: (data: {
    equipment_id: number;
    admission_id?: number;
    bed_code?: string;
    expected_version?: number;
  }): Promise<{ status: string; message: string; equipment_allocation_id: number }> =>
    request('/beds/equipment/allocate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  releaseEquipment: (allocationId: number): Promise<{ status: string; message: string }> =>
    request(`/beds/equipment/release/${allocationId}`, {
      method: 'PUT',
    }),

  transferBed: (data: BedTransferInput): Promise<{ status: string; message: string }> =>
    request('/beds/transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getStaff: (): Promise<StaffMember[]> => request<StaffMember[]>('/auth/personnel/staff'),

  activateStaff: (personnelId: number): Promise<{ status: string; message: string }> =>
    request<{ status: string; message: string }>(`/auth/personnel/${personnelId}/activate`, {
      method: 'PUT',
    }),

  deactivateStaff: (personnelId: number): Promise<{ status: string; message: string }> =>
    request<{ status: string; message: string }>(`/auth/personnel/${personnelId}/deactivate`, {
      method: 'PUT',
    }),
};
