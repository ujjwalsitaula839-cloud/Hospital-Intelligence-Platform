import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../pages/Login';
import * as AuthContextModule from '../context/AuthContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const TEST_PASSWORD = 'Synthetic-Test-Pass-1!';

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

function storedValues(): string {
  return Object.keys(localStorage)
    .map((key) => localStorage.getItem(key) || '')
    .join('\n');
}

describe('Login Page', () => {
  const mockLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockLogin.mockResolvedValue({ sub: '6', role: 'NURSE', must_change_password: false });
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      claims: null,
      token: null,
      isAuthenticated: false,
      mustChangePassword: false,
      login: mockLogin,
      logout: vi.fn(),
      refreshAuth: vi.fn(),
    } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
  });

  it('links the email and password labels to their inputs with autocomplete hints', () => {
    renderLogin();

    const email = screen.getByLabelText(/Staff Institutional Email/i);
    const password = screen.getByLabelText(/^Password$/i);
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  it('shows a busy, disabled sign-in button while the login request is in flight', async () => {
    let resolveLogin: (value: unknown) => void = () => {};
    mockLogin.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
    renderLogin();

    fireEvent.change(screen.getByLabelText(/Staff Institutional Email/i), { target: { value: 'nurse_carol@hospital.org' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: TEST_PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In to Workstation/i }));

    const busyButton = await screen.findByRole('button', { name: /Authenticating Credentials/i });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-busy', 'true');

    resolveLogin({ sub: '6', role: 'NURSE', must_change_password: false });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard/clinical'));
  });

  it('"Remember me" stores only the email, never the password', async () => {
    renderLogin();

    fireEvent.change(screen.getByLabelText(/Staff Institutional Email/i), { target: { value: 'nurse_carol@hospital.org' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: TEST_PASSWORD } });
    fireEvent.click(screen.getByLabelText(/Remember me on this browser/i));
    fireEvent.click(screen.getByRole('button', { name: /Sign In to Workstation/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem('hip_remembered_login') || '{}')).toEqual({ email: 'nurse_carol@hospital.org' });
    expect(storedValues()).not.toContain(TEST_PASSWORD);
  });

  it('"Save to Shortcut" stores only the email, never the password', () => {
    renderLogin();

    fireEvent.change(screen.getByLabelText(/Staff Institutional Email/i), { target: { value: 'nurse_jane@hospital.org' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: TEST_PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: /Save to Shortcut/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Clinical Nurse.*Save/i })[0]);

    expect(localStorage.getItem('hip_saved_shortcuts')).toContain('nurse_jane@hospital.org');
    expect(storedValues()).not.toContain(TEST_PASSWORD);
  });

  it('removes passwords saved in browser storage by older versions on load', () => {
    localStorage.setItem('hip_remembered_login', JSON.stringify({ email: 'admin@hospital.org', password: TEST_PASSWORD }));
    localStorage.setItem(
      'hip_saved_shortcuts',
      JSON.stringify([{ id: 'admin', name: 'Administrator', email: 'admin@hospital.org', password: TEST_PASSWORD, role: 'ADMIN', icon: 'A', isCustom: true }])
    );

    renderLogin();

    expect(storedValues()).not.toContain(TEST_PASSWORD);
    expect(screen.getByLabelText(/Staff Institutional Email/i)).toHaveValue('admin@hospital.org');
    expect(screen.getByLabelText(/^Password$/i)).toHaveValue('');
  });

  it('keeps the demo quick-fill shortcuts and fills only the email', () => {
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: /Attending Doctor/i }));

    expect(screen.getByLabelText(/Staff Institutional Email/i)).toHaveValue('doctor_chen@hospital.org');
    expect(screen.getByLabelText(/^Password$/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /Administrator/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Housekeeping/i })).toBeInTheDocument();
  });
});
