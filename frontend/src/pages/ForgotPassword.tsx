import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function ForgotPassword(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await api.forgotPassword(email.trim());
      setIsSubmitted(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to process password reset request. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 shadow-2xl">
        {/* Header Badge & Title */}
        <div className="mb-6">
          <div className="inline-block border border-sky-800 bg-sky-950/60 text-sky-400 px-2 py-0.5 text-xs font-mono tracking-widest uppercase mb-3">
            Self-Service Credential Recovery
          </div>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight">
            Forgot Password
          </h1>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter your institutional email address to receive a secure, single-use password reset link.
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-6 p-3 border border-red-700 bg-red-950/80 text-red-200 text-xs font-mono">
            {error}
          </div>
        )}

        {/* Success Confirmation Banner (Anti-User Enumeration) */}
        {isSubmitted ? (
          <div className="space-y-6">
            <div className="p-4 border border-emerald-700 bg-emerald-950/60 text-emerald-200 text-xs font-mono space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-emerald-300">
                <span>✓</span> Reset Link Dispatched
              </div>
              <p className="leading-relaxed text-zinc-300">
                If an account exists, instructions have been sent to your email.
              </p>
              <div className="pt-2 text-[11px] text-zinc-400 border-t border-emerald-900/60">
                Please check your inbox within the next 15 minutes. The link will expire automatically thereafter.
              </div>
            </div>

            {/* Dev Inbox Helper Callout */}
            <div className="p-3 bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-400 space-y-1">
              <span className="text-amber-400 font-bold uppercase text-[10px]">Development Environment</span>
              <p>
                In dev mode, open the Mailpit test inbox at{' '}
                <a
                  href="http://localhost:8025"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 underline hover:text-sky-300"
                >
                  http://localhost:8025
                </a>{' '}
                to inspect and click the reset link.
              </p>
            </div>

            <div className="pt-2">
              <Link
                to="/login"
                className="block text-center w-full bg-white text-zinc-950 hover:bg-zinc-200 py-3 text-xs font-mono uppercase tracking-wider font-bold transition-colors shadow-sm"
              >
                Return to Sign In
              </Link>
            </div>
          </div>
        ) : (
          /* Reset Request Form */
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-2">
                Staff Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. dr_smith@hospital.org"
                className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-400 py-3 text-xs font-mono uppercase tracking-wider font-bold transition-colors shadow-sm"
            >
              {loading ? 'Dispatching Reset Link...' : 'Send Reset Link'}
            </button>

            <div className="text-center pt-2">
              <Link
                to="/login"
                className="text-xs font-mono text-zinc-400 hover:text-white underline transition-colors"
              >
                ← Back to Sign In
              </Link>
            </div>
          </form>
        )}

        {/* Security Footer Note */}
        <div className="mt-8 pt-5 border-t border-zinc-800/80 text-center">
          <p className="text-[11px] text-zinc-500 font-mono">
            HIPAA &amp; 21 CFR Part 11 Compliant Access Control
          </p>
        </div>
      </div>
    </div>
  );
}
