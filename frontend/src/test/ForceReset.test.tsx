import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import ForceReset from '../pages/ForceReset';
import { api } from '../lib/api';
import * as AuthContextModule from '../context/AuthContext';

vi.mock('../lib/api', () => ({
  api: {
    forceResetPassword: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ForceReset Page (TDD Suite)', () => {
  const mockRefreshAuth = vi.fn();
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      claims: { sub: 'nurse_jane@hospital.org', role: 'NURSE' },
      token: 'temp-token',
      isAuthenticated: true,
      requiresPasswordReset: true,
      login: vi.fn(),
      logout: mockLogout,
      refreshAuth: mockRefreshAuth,
    });
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <ForceReset />
      </MemoryRouter>
    );

  it('renders executive command center security gate layout and fields', () => {
    renderComponent();

    expect(screen.getByText(/Mandatory Password Reset/i)).toBeInTheDocument();
    expect(screen.getByText(/Security Gate Active/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Minimum 8 characters')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Re-enter new password')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Set New Password & Continue/i })
    ).toBeInTheDocument();
  });

  it('validates minimum password length (>= 8 characters)', async () => {
    renderComponent();

    const newPassInput = screen.getByPlaceholderText('Minimum 8 characters');
    const confirmPassInput = screen.getByPlaceholderText('Re-enter new password');
    const submitBtn = screen.getByRole('button', { name: /Set New Password & Continue/i });

    fireEvent.change(newPassInput, { target: { value: 'short' } });
    fireEvent.change(confirmPassInput, { target: { value: 'short' } });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText('Password must be at least 8 characters in length.')
    ).toBeInTheDocument();
    expect(api.forceResetPassword).not.toHaveBeenCalled();
  });

  it('validates password mismatch before making network request', async () => {
    renderComponent();

    const newPassInput = screen.getByPlaceholderText('Minimum 8 characters');
    const confirmPassInput = screen.getByPlaceholderText('Re-enter new password');
    const submitBtn = screen.getByRole('button', { name: /Set New Password & Continue/i });

    fireEvent.change(newPassInput, { target: { value: 'NewSecurePass123!' } });
    fireEvent.change(confirmPassInput, { target: { value: 'DifferentPass123!' } });
    fireEvent.click(submitBtn);

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(api.forceResetPassword).not.toHaveBeenCalled();
  });

  it('submits valid passwords and navigates to clinical dashboard for NURSE role', async () => {
    vi.mocked(api.forceResetPassword).mockResolvedValueOnce({
      access_token: 'new-valid-jwt',
      refresh_token: 'new-refresh-jwt',
      token_type: 'bearer',
      role: 'NURSE',
      requires_password_change: false,
    });
    mockRefreshAuth.mockReturnValueOnce({ sub: 'nurse_jane@hospital.org', role: 'NURSE' });

    renderComponent();

    const newPassInput = screen.getByPlaceholderText('Minimum 8 characters');
    const confirmPassInput = screen.getByPlaceholderText('Re-enter new password');
    const submitBtn = screen.getByRole('button', { name: /Set New Password & Continue/i });

    fireEvent.change(newPassInput, { target: { value: 'ValidHospitalPass2026!' } });
    fireEvent.change(confirmPassInput, { target: { value: 'ValidHospitalPass2026!' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.forceResetPassword).toHaveBeenCalledWith({
        new_password: 'ValidHospitalPass2026!',
        confirm_password: 'ValidHospitalPass2026!',
      });
      expect(sessionStorage.getItem('token')).toBe('new-valid-jwt');
      expect(sessionStorage.getItem('refresh_token')).toBe('new-refresh-jwt');
      expect(mockRefreshAuth).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard/clinical');
    });
  });

  it('navigates to admin dashboard for ADMIN role', async () => {
    vi.mocked(api.forceResetPassword).mockResolvedValueOnce({
      access_token: 'admin-jwt',
      token_type: 'bearer',
      role: 'ADMIN',
      requires_password_change: false,
    });
    mockRefreshAuth.mockReturnValueOnce({ sub: 'admin@hospital.org', role: 'ADMIN' });

    renderComponent();

    fireEvent.change(screen.getByPlaceholderText('Minimum 8 characters'), {
      target: { value: 'AdminSecurePass2026!' },
    });
    fireEvent.change(screen.getByPlaceholderText('Re-enter new password'), {
      target: { value: 'AdminSecurePass2026!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Set New Password & Continue/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard/admin');
    });
  });

  it('displays API error banner when password reset request fails', async () => {
    vi.mocked(api.forceResetPassword).mockRejectedValueOnce(
      new Error('Password history violation: cannot reuse last 5 passwords.')
    );

    renderComponent();

    fireEvent.change(screen.getByPlaceholderText('Minimum 8 characters'), {
      target: { value: 'ReusedPassword123!' },
    });
    fireEvent.change(screen.getByPlaceholderText('Re-enter new password'), {
      target: { value: 'ReusedPassword123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Set New Password & Continue/i }));

    expect(
      await screen.findByText('Password history violation: cannot reuse last 5 passwords.')
    ).toBeInTheDocument();
  });

  it('supports password visibility toggling', () => {
    renderComponent();

    const newPassInput = screen.getByPlaceholderText('Minimum 8 characters');
    expect(newPassInput).toHaveAttribute('type', 'password');

    const toggleButtons = screen.getAllByRole('button', { name: /toggle.*visibility/i });
    expect(toggleButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(toggleButtons[0]);
    expect(newPassInput).toHaveAttribute('type', 'text');

    fireEvent.click(toggleButtons[0]);
    expect(newPassInput).toHaveAttribute('type', 'password');
  });

  it('provides accessible sign out option to abort and return to login', async () => {
    renderComponent();

    const signOutBtn = screen.getByRole('button', { name: /^sign out$/i });
    fireEvent.click(signOutBtn);

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });
});
