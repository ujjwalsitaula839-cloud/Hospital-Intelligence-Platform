import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import ForgotPassword from '../pages/ForgotPassword';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    forgotPassword: vi.fn(),
  },
}));

describe('ForgotPassword Page (TDD Suite)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>
    );

  it('renders institutional forgot password recovery layout and elements', () => {
    renderComponent();

    expect(screen.getByText(/Self-Service Credential Recovery/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Forgot Password/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/dr_smith@hospital.org/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Reset Link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Sign In/i })).toBeInTheDocument();
  });

  it('rejects non-@hospital.org email domains client-side without calling API', async () => {
    renderComponent();

    const emailInput = screen.getByPlaceholderText(/dr_smith@hospital.org/i);
    const submitBtn = screen.getByRole('button', { name: /Send Reset Link/i });

    // Try a gmail address
    fireEvent.change(emailInput, { target: { value: 'doctor123@gmail.com' } });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText('Only @hospital.org institutional email addresses are permitted.')
    ).toBeInTheDocument();
    expect(api.forgotPassword).not.toHaveBeenCalled();

    // Try another domain
    fireEvent.change(emailInput, { target: { value: 'user@yahoo.com' } });
    fireEvent.click(submitBtn);

    expect(
      screen.getByText('Only @hospital.org institutional email addresses are permitted.')
    ).toBeInTheDocument();
    expect(api.forgotPassword).not.toHaveBeenCalled();
  });

  it('submits valid @hospital.org address and displays confirmation & Mailpit link', async () => {
    vi.mocked(api.forgotPassword).mockResolvedValueOnce({
      message: 'If an account with that email exists, a password reset link has been dispatched.',
      status: 'SUCCESS',
    });

    renderComponent();

    const emailInput = screen.getByPlaceholderText(/dr_smith@hospital.org/i);
    const submitBtn = screen.getByRole('button', { name: /Send Reset Link/i });

    fireEvent.change(emailInput, { target: { value: 'dr_smith@hospital.org' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.forgotPassword).toHaveBeenCalledWith('dr_smith@hospital.org');
    });

    expect(await screen.findByText(/Reset Link Dispatched/i)).toBeInTheDocument();
    expect(screen.getByText(/check your inbox within the next 15 minutes/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /http:\/\/localhost:8025/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to Sign In/i })).toBeInTheDocument();
  });

  it('displays error banner when the API request fails', async () => {
    vi.mocked(api.forgotPassword).mockRejectedValueOnce(
      new Error('Rate limit exceeded: too many reset attempts.')
    );

    renderComponent();

    const emailInput = screen.getByPlaceholderText(/dr_smith@hospital.org/i);
    const submitBtn = screen.getByRole('button', { name: /Send Reset Link/i });

    fireEvent.change(emailInput, { target: { value: 'nurse_jane@hospital.org' } });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText('Rate limit exceeded: too many reset attempts.')
    ).toBeInTheDocument();
  });
});
