import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { Role } from '../types';

function getDashboardPath(role: Role): string {
  if (role === 'ADMIN') return '/dashboard/admin';
  if (role === 'CLEANING_CREW') return '/dashboard/housekeeping';
  return '/dashboard/clinical';
}

export default function ForceReset(): React.ReactElement {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { refreshAuth } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters in length.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const data = await api.forceResetPassword({
        new_password: newPassword,
        confirm_password: confirmPassword,
      });

      sessionStorage.setItem('token', data.access_token);
      const updatedClaims = refreshAuth();

      const targetRole = updatedClaims?.role || data.role;
      navigate(getDashboardPath(targetRole));
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to reset password. Please check requirements and retry.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8">
        {/* Security Gate Header */}
        <div className="mb-6">
          <div className="inline-block border border-red-700 bg-red-950/50 text-red-400 px-2 py-0.5 text-xs font-mono tracking-widest uppercase mb-3">
            Security Gate Active
          </div>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight">
            Mandatory Password Reset
          </h1>
          <p className="text-sm text-zinc-300 mt-2 leading-relaxed">
            Your account requires a password change before continuing.
          </p>
        </div>

        {/* Inline Error Message */}
        {error && (
          <div className="mb-6 p-3 border border-red-700 bg-red-950 text-red-200 text-xs font-mono">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-2">
              New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-2">
              Confirm New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-400 py-3 text-sm font-semibold tracking-wide transition-colors"
          >
            {loading ? 'Updating Password...' : 'Set New Password & Continue'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 font-mono">
            Navigation is locked until mandatory credential renewal is completed.
          </p>
        </div>
      </div>
    </div>
  );
}
