import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, decodeJwt } from '../lib/api';

describe('API Transparent Auth Token Refresh & 401 Recovery (TDS Suite)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('decodes JWT tokens correctly and extracts claims', () => {
    // Header: {"alg":"HS256","typ":"JWT"}, Payload: {"sub":"123","role":"DOCTOR","exp":1999999999}
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJyb2xlIjoiRE9DVE9SIiwiZXhwIjoxOTk5OTk5OTk5fQ.signature';
    const claims = decodeJwt(token);
    expect(claims.sub).toBe('123');
    expect(claims.role).toBe('DOCTOR');
    expect(claims.exp).toBe(1999999999);
  });

  it('automatically refreshes token on 401 and retries the original request', async () => {
    sessionStorage.setItem('token', 'expired-access-token');
    sessionStorage.setItem('refresh_token', 'valid-refresh-token');

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string, options: RequestInit) => {
      // 1. Initial call to /patients/records -> returns 401
      if (url.includes('/patients/records') && callCount === 0) {
        callCount++;
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ detail: 'Signature has expired' }),
        });
      }

      // 2. Call to /auth/refresh -> returns new access and refresh tokens
      if (url.includes('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              access_token: 'new-valid-access-token',
              refresh_token: 'new-valid-refresh-token',
              token_type: 'bearer',
              expires_in: 900,
            }),
        });
      }

      // 3. Retried call to /patients/records with new token
      if (url.includes('/patients/records') && callCount === 1) {
        expect((options.headers as Record<string, string>)['Authorization']).toBe(
          'Bearer new-valid-access-token'
        );
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ patient_id: 1, first_name: 'Test' }]),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    const result = await api.getPatients();
    expect(result).toEqual([{ patient_id: 1, first_name: 'Test' }]);
    expect(sessionStorage.getItem('token')).toBe('new-valid-access-token');
    expect(sessionStorage.getItem('refresh_token')).toBe('new-valid-refresh-token');
  });

  it('dispatches hip:auth_expired and clears tokens when refresh fails on 401', async () => {
    sessionStorage.setItem('token', 'expired-token');
    sessionStorage.setItem('refresh_token', 'expired-refresh');

    const authExpiredListener = vi.fn();
    window.addEventListener('hip:auth_expired', authExpiredListener);

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ detail: 'Refresh token expired' }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ detail: 'Unauthorized' }),
      });
    });

    await expect(api.getPatients()).rejects.toThrow(/401 Unauthorized/);
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('refresh_token')).toBeNull();
    expect(authExpiredListener).toHaveBeenCalled();

    window.removeEventListener('hip:auth_expired', authExpiredListener);
  });
});

