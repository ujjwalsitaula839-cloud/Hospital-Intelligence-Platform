/**
 * HIPAA browser-side safeguards. Each describe block names the Security Rule section it checks.
 * Tests titled "[known gap]" use it.fails: they describe the desired behaviour for a gap that exists
 * on main and are expected to fail until it is fixed (the unified report shows them as known gaps).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../context/AuthContext';
import Clinical from '../pages/dashboards/Clinical';
import { api } from '../lib/api';

const SYNTHETIC_NAME = 'Synthetic-PHI-Marker';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      login: vi.fn(),
      logout: vi.fn(),
      getBeds: vi.fn().mockResolvedValue([]),
      getPatients: vi.fn().mockResolvedValue([]),
      getEquipmentList: vi.fn().mockResolvedValue([]),
      getObservations: vi.fn().mockResolvedValue([]),
      getNurses: vi.fn().mockResolvedValue([]),
      getNurseAssignments: vi.fn().mockResolvedValue([]),
      getLatestHandoff: vi.fn().mockResolvedValue(null),
    },
  };
});

// The real intake form talks to the API; this stand-in reports one synthetic EMS arrival to the dashboard.
vi.mock('../components/ems/EmsIntakeForm', () => ({
  default: ({ onSuccess }: { onSuccess: (result: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSuccess({
          patient: { patient_id: 501, first_name: SYNTHETIC_NAME, last_name: 'Person', date_of_birth: '1980-05-01', gender: 'OTHER', is_active: true },
          admission: { admission_id: 901, patient_id: 501, primary_diagnosis: 'synthetic chest pain', acuity_level: 'ESI_2', arrival_datetime: new Date().toISOString() },
          etaMinutes: 5,
        })
      }
    >
      Log synthetic EMS arrival
    </button>
  ),
}));

function allBrowserStorage(): string {
  const dump = (store: Storage) => Object.keys(store).map((key) => `${key}=${store.getItem(key)}`).join('\n');
  return `${dump(localStorage)}\n${dump(sessionStorage)}`;
}

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('HIPAA §164.312(a)(2)(iii) Automatic logoff: session tokens', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(api.login).mockResolvedValue({
      access_token: fakeJwt({ sub: '6', role: 'NURSE', exp: Math.floor(Date.now() / 1000) + 900 }),
      refresh_token: 'synthetic-refresh-token',
      token_type: 'bearer',
    } as never);
    vi.mocked(api.logout).mockResolvedValue(undefined as never);
  });

  function SessionProbe() {
    const { login, logout } = useAuth();
    return (
      <>
        <button type="button" onClick={() => login({ email: 'nurse_carol@hospital.org', password: 'x' })}>login</button>
        <button type="button" onClick={() => logout()}>logout</button>
      </>
    );
  }

  it('keeps login tokens in tab-scoped sessionStorage, never in persistent localStorage', async () => {
    render(<AuthProvider><SessionProbe /></AuthProvider>);
    await act(async () => fireEvent.click(screen.getByText('login')));

    expect(sessionStorage.getItem('token')).toBeTruthy();
    expect(Object.keys(localStorage).join(',')).not.toMatch(/token/i);
  });

  it('removes both tokens from the browser on logout', async () => {
    render(<AuthProvider><SessionProbe /></AuthProvider>);
    await act(async () => fireEvent.click(screen.getByText('login')));
    await act(async () => fireEvent.click(screen.getByText('logout')));

    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('refresh_token')).toBeNull();
  });
});

describe('HIPAA §164.312(a)(1) + §164.310(d)(1) Access control / device controls: patient data in browser storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  async function logSyntheticEmsArrival(): Promise<string> {
    render(
      <MemoryRouter>
        <Clinical />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Log synthetic EMS arrival/i }));
    await waitFor(() => expect(localStorage.getItem('hip_recent_ems_runs')).toBeTruthy());
    return Object.keys(localStorage).map((key) => localStorage.getItem(key)).join('\n');
  }

  it('records the EMS arrival in the worklist store (precondition for the check below)', async () => {
    const persisted = await logSyntheticEmsArrival();
    expect(persisted).toContain('"patient_id":501');
  });

  it.fails('[known gap] EMS intake does not leave patient identity or diagnosis in persistent browser storage', async () => {
    const persisted = await logSyntheticEmsArrival();
    expect(persisted).not.toContain(SYNTHETIC_NAME);
    expect(persisted).not.toContain('synthetic chest pain');
  });
});

describe('HIPAA §164.312(d) Person or entity authentication: credentials in the browser', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('never writes a typed password to browser storage, even with "Remember me" ticked', async () => {
    const { default: Login } = await import('../pages/Login');
    vi.mocked(api.login).mockResolvedValue({
      access_token: fakeJwt({ sub: '6', role: 'NURSE', exp: Math.floor(Date.now() / 1000) + 900, must_change_password: false }),
      token_type: 'bearer',
    } as never);
    render(
      <AuthProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.change(screen.getByLabelText(/Staff Institutional Email/i), { target: { value: 'nurse_carol@hospital.org' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Synthetic-Password-123!' } });
    fireEvent.click(screen.getByLabelText(/Remember me on this browser/i));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Sign In to Workstation/i })));

    await waitFor(() => expect(localStorage.getItem('hip_remembered_login')).toBeTruthy());
    expect(allBrowserStorage()).not.toContain('Synthetic-Password-123!');
  });
});
