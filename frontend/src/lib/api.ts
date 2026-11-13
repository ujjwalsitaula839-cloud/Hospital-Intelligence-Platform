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
  NurseAssignment,
  Observation,
  ObservationInput,
  Patient,
  PatientCreateInput,
  PatientUpdateInput,
  StaffMember,
  TokenClaims,
  BedRecommendationRequest,
  BedRecommendationResult,
  ReserveRecommendedBedInput,
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

let refreshPromise: Promise<string | null> | null = null;

async function tryRefreshToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = sessionStorage.getItem('refresh_token');
  if (!refreshToken) {
    return null;
  }

  refreshPromise = (async () => {
    try {
      const resp = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!resp.ok) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('refresh_token');
        window.dispatchEvent(new CustomEvent('hip:auth_expired'));
        return null;
      }
      const data = (await resp.json()) as AuthTokens;
      if (data.access_token) {
        sessionStorage.setItem('token', data.access_token);
        if (data.refresh_token) {
          sessionStorage.setItem('refresh_token', data.refresh_token);
        }
        return data.access_token;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let token = sessionStorage.getItem('token');

  // Proactive silent refresh if token is within 30s of expiring
  if (token && path !== '/auth/refresh' && path !== '/auth/login') {
    try {
      const decoded = decodeJwt(token);
      if (decoded.exp && decoded.exp * 1000 - Date.now() < 30000) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          token = refreshed;
        }
      }
    } catch {
      // Non-blocking decode error
    }
  }

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
      // Attempt reactive token refresh and retry once if refresh_token exists
      if (path !== '/auth/refresh' && path !== '/auth/login') {
        const refreshedToken = await tryRefreshToken();
        if (refreshedToken) {
          const retryHeaders = {
            ...headers,
            Authorization: `Bearer ${refreshedToken}`,
          };
          const retryResp = await fetch(`${BASE_URL}${path}`, {
            ...options,
            headers: retryHeaders,
          });
          if (retryResp.ok) {
            if (retryResp.status === 204) {
              return {} as T;
            }
            return retryResp.json() as Promise<T>;
          }
        }
      }
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('refresh_token');
      window.dispatchEvent(new CustomEvent('hip:auth_expired'));
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

  refreshToken: (refreshToken: string): Promise<AuthTokens> =>
    request<AuthTokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }),

  forceResetPassword: (payload: { new_password: string; confirm_password: string }): Promise<AuthTokens> =>
    request<AuthTokens>('/auth/force-reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  forgotPassword: (email: string): Promise<{ message: string; status?: string }> =>
    request<{ message: string; status?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (payload: { token: string; new_password: string; confirm_password?: string }): Promise<{ message: string; status?: string }> =>
    request<{ message: string; status?: string }>('/auth/reset-password', {
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
      | 'release'
      | { status: CleaningTaskStatus | 'start' | 'complete' | 'release'; notes?: string }
  ): Promise<{ status: string; message: string }> => {
    const statusVal = typeof payload === 'string' ? payload : payload.status;
    const action =
      statusVal === 'IN_PROGRESS' || statusVal === 'start'
        ? 'start'
        : statusVal === 'PENDING' || statusVal === 'release'
          ? 'release'
          : 'complete';
    const body = typeof payload === 'object' && payload.notes ? JSON.stringify({ notes: payload.notes }) : undefined;
    return request<{ status: string; message: string }>(`/beds/cleaning/${action}/${cleaningId}`, {
      method: 'PUT',
      body,
    });
  },

  getNurses: (): Promise<StaffMember[]> => request<StaffMember[]>('/auth/personnel/nurses'),

  getNurseAssignments: (admissionId: number): Promise<NurseAssignment[]> =>
    request<NurseAssignment[]>(`/patients/admissions/${admissionId}/nurse-assignments`),

  assignNurse: (admissionId: number, nurseId: number): Promise<NurseAssignment> =>
    request<NurseAssignment>(`/patients/admissions/${admissionId}/assign-nurse`, {
      method: 'POST',
      body: JSON.stringify({ nurse_id: nurseId }),
    }),

  completeNurseAssignment: (assignmentId: number): Promise<{ status: string; message: string }> =>
    request<{ status: string; message: string }>(`/patients/admissions/nurse-assignments/${assignmentId}/complete`, {
      method: 'PUT',
    }),

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

  recommendBed: (data: BedRecommendationRequest): Promise<BedRecommendationResult> =>
    request<BedRecommendationResult>('/beds/recommend', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  reserveRecommendedBed: (
    data: ReserveRecommendedBedInput
  ): Promise<{
    status: string;
    message: string;
    bed_code: string;
    bed_id: number;
    allocation_id: number;
    staged_equipment: Array<{ equipment_id: number; equipment_name: string; status: string }>;
  }> =>
    request('/beds/recommend/reserve', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  chatWithElon: (
    data: { message: string; session_id?: string }
  ): Promise<{ response: string; session_id: string; timestamp: string }> =>
    request<{ response: string; session_id: string; timestamp: string }>('/beds/elon/chat', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
