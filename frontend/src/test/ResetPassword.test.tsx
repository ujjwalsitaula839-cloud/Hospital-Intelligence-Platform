import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResetPassword from '../pages/ResetPassword';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    resetPassword: vi.fn(),
  },
}));

describe('ResetPassword Page (TDD Suite)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = (initialEntry: string = '/reset-password?token=valid-test-token') =>
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>
    );

  it('renders invalid/missing token screen when no token parameter is in the URL', () => {
    renderComponent('/reset-password');

    expect(screen.getByText(/Invalid Request/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Missing Reset Token/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Request New Reset Link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to Sign In/i })).toBeInTheDocument();
  });

  it('renders credential renewal form and password complexity indicators when token is present', () => {
    renderComponent();

    expect(screen.getByText(/Credential Renewal Gate/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Set New Password/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Minimum 8 characters')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Re-enter password')).toBeInTheDocument();
    expect(screen.getByText(/Password Requirements:/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update Password/i })).toBeDisabled();
  });

  it('enables submit button only when password fulfills all security requirements and matches', () => {
    renderComponent();

    const newPassInput = screen.getByPlaceholderText('Minimum 8 characters');
    const confirmPassInput = screen.getByPlaceholderText('Re-enter password');
    const submitBtn = screen.getByRole('button', { name: /Update Password/i });

    // Initial state: disabled
    expect(submitBtn).toBeDisabled();

    // Partial: weak password
    fireEvent.change(newPassInput, { target: { value: 'password' } });
    fireEvent.change(confirmPassInput, { target: { value: 'password' } });
    expect(submitBtn).toBeDisabled();

    // Strong password, but mismatch
    fireEvent.change(newPassInput, { target: { value: 'SecurePass2026!' } });
    fireEvent.change(confirmPassInput, { target: { value: 'DifferentPass2026!' } });
    expect(submitBtn).toBeDisabled();

    // Valid and matching
    fireEvent.change(confirmPassInput, { target: { value: 'SecurePass2026!' } });
    expect(submitBtn).not.toBeDisabled();
  });

  it('submits valid password reset and displays success banner', async () => {
    vi.mocked(api.resetPassword).mockResolvedValueOnce({
      message: 'Password reset successful.',
      status: 'SUCCESS',
    });

    renderComponent();

    const newPassInput = screen.getByPlaceholderText('Minimum 8 characters');
    const confirmPassInput = screen.getByPlaceholderText('Re-enter password');
    const submitBtn = screen.getByRole('button', { name: /Update Password/i });

    fireEvent.change(newPassInput, { target: { value: 'HospitalPass2026!' } });
    fireEvent.change(confirmPassInput, { target: { value: 'HospitalPass2026!' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.resetPassword).toHaveBeenCalledWith({
        token: 'valid-test-token',
        new_password: 'HospitalPass2026!',
        confirm_password: 'HospitalPass2026!',
      });
    });

    expect(await screen.findByText(/Password Reset Successful/i)).toBeInTheDocument();
    expect(screen.getByText(/All previous active sessions have been revoked/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to Sign In Now/i })).toBeInTheDocument();
  });

  it('displays API error banner when token is expired or password was reused', async () => {
    vi.mocked(api.resetPassword).mockRejectedValueOnce(
      new Error('Cannot reuse any of your last 5 passwords.')
    );

    renderComponent();

    const newPassInput = screen.getByPlaceholderText('Minimum 8 characters');
    const confirmPassInput = screen.getByPlaceholderText('Re-enter password');
    const submitBtn = screen.getByRole('button', { name: /Update Password/i });

    fireEvent.change(newPassInput, { target: { value: 'HospitalPass2026!' } });
    fireEvent.change(confirmPassInput, { target: { value: 'HospitalPass2026!' } });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText('Cannot reuse any of your last 5 passwords.')
    ).toBeInTheDocument();
  });

  it('toggles password visibility between text and password types', () => {
    renderComponent();

    const newPassInput = screen.getByPlaceholderText('Minimum 8 characters');
    expect(newPassInput).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByRole('button', { name: /Show 👁/i });
    fireEvent.click(toggleBtn);
    expect(newPassInput).toHaveAttribute('type', 'text');

    const hideBtn = screen.getByRole('button', { name: /Hide ✕/i });
    fireEvent.click(hideBtn);
    expect(newPassInput).toHaveAttribute('type', 'password');
  });
});
