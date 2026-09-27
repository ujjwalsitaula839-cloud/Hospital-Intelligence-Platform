import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function ResetPassword(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(3);

  const navigate = useNavigate();

  // Automatic redirect countdown upon successful reset
  useEffect(() => {
    if (!success) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/login');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [success, navigate]);

  // Client-side password rules
  const hasMinLength = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const isFormValid = hasMinLength && hasUpper && hasLower && hasNumber && hasSpecial && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Missing or invalid password reset token.');
      return;
    }

    if (!hasMinLength) {
      setError('Password must be at least 8 characters in length.');
      return;
    }

    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      await api.resetPassword({
        token,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setSuccess(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to reset password. The link may have expired or been used already.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Missing token view
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-950 text-zinc-100">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 shadow-2xl space-y-6">
          <div className="inline-block border border-red-800 bg-red-950/60 text-red-400 px-2 py-0.5 text-xs font-mono tracking-widest uppercase">
            Invalid Request
          </div>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight">
            Missing Reset Token
          </h1>
          <p className="text-sm text-zinc-300 leading-relaxed">
            No password reset token was provided in the URL. Please verify you clicked the complete link in your reset email or request a new one.
          </p>
          <div className="pt-2 space-y-3">
            <Link
              to="/forgot-password"
              className="block text-center w-full bg-white text-zinc-950 hover:bg-zinc-200 py-3 text-xs font-mono uppercase tracking-wider font-bold transition-colors shadow-sm"
            >
              Request New Reset Link
            </Link>
            <Link
              to="/login"
              className="block text-center text-xs font-mono text-zinc-400 hover:text-white underline transition-colors"
            >
              Return to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 shadow-2xl">
        {/* Header Badge & Title */}
        <div className="mb-6">
          <div className="inline-block border border-sky-800 bg-sky-950/60 text-sky-400 px-2 py-0.5 text-xs font-mono tracking-widest uppercase mb-3">
            Credential Renewal Gate
          </div>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight">
            Set New Password
          </h1>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Please create a new password meeting the institutional complexity policy.
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-6 p-3 border border-red-700 bg-red-950/80 text-red-200 text-xs font-mono leading-relaxed">
            {error}
          </div>
        )}

        {/* Success Banner & Redirect */}
        {success ? (
          <div className="space-y-6">
            <div className="p-4 border border-emerald-700 bg-emerald-950/60 text-emerald-200 text-xs font-mono space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-emerald-300">
                <span>✓</span> Password Reset Successful
              </div>
              <p className="text-zinc-300">
                Your credentials have been updated. All previous active sessions have been revoked.
              </p>
              <p className="text-emerald-400 font-bold">
                Redirecting to login in {countdown} second{countdown !== 1 ? 's' : ''}...
              </p>
            </div>
            <Link
              to="/login"
              className="block text-center w-full bg-white text-zinc-950 hover:bg-zinc-200 py-3 text-xs font-mono uppercase tracking-wider font-bold transition-colors shadow-sm"
            >
              Go to Sign In Now
            </Link>
          </div>
        ) : (
          /* Password Update Form */
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300">
                  New Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[10px] font-mono text-zinc-400 hover:text-zinc-200 uppercase tracking-wider"
                >
                  {showPassword ? 'Hide ✕' : 'Show 👁'}
                </button>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-1.5">
                Confirm New Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
              />
            </div>

            {/* Real-time Complexity Checklist */}
            <div className="p-3 bg-zinc-950 border border-zinc-800 text-[11px] font-mono space-y-1">
              <div className="text-zinc-400 font-bold uppercase text-[10px] mb-1">
                Password Requirements:
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <span className={hasMinLength ? 'text-emerald-400' : 'text-zinc-500'}>
                  {hasMinLength ? '✓' : '○'} 8+ characters
                </span>
                <span className={hasUpper ? 'text-emerald-400' : 'text-zinc-500'}>
                  {hasUpper ? '✓' : '○'} Uppercase letter
                </span>
                <span className={hasLower ? 'text-emerald-400' : 'text-zinc-500'}>
                  {hasLower ? '✓' : '○'} Lowercase letter
                </span>
                <span className={hasNumber ? 'text-emerald-400' : 'text-zinc-500'}>
                  {hasNumber ? '✓' : '○'} Number (0-9)
                </span>
                <span className={hasSpecial ? 'text-emerald-400' : 'text-zinc-500'}>
                  {hasSpecial ? '✓' : '○'} Symbol (!@#$)
                </span>
                <span className={passwordsMatch ? 'text-emerald-400' : 'text-zinc-500'}>
                  {passwordsMatch ? '✓' : '○'} Passwords match
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !isFormValid}
              className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-400 py-3 text-xs font-mono uppercase tracking-wider font-bold transition-colors shadow-sm"
            >
              {loading ? 'Updating Password...' : 'Update Password'}
            </button>

            <div className="text-center pt-2">
              <Link
                to="/login"
                className="text-xs font-mono text-zinc-400 hover:text-white underline transition-colors"
              >
                ← Cancel and Return to Sign In
              </Link>
            </div>
          </form>
        )}

        {/* Security Footer */}
        <div className="mt-8 pt-5 border-t border-zinc-800/80 text-center">
          <p className="text-[11px] text-zinc-500 font-mono">
            5-Password History Enforced • Inactive Tokens Pruned
          </p>
        </div>
      </div>
    </div>
  );
}
