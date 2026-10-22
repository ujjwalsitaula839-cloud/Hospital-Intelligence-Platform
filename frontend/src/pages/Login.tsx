import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';
import '../dashboard/exec.css';
import '../dashboard/showcase.css';

interface SavedShortcut {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  icon: string;
  isCustom?: boolean;
}

const DEFAULT_SHORTCUTS: SavedShortcut[] = [
  { id: 'admin', name: 'Administrator', email: 'admin@hospital.org', password: 'SecurePassword123!', role: 'ADMIN', icon: '🛡️' },
  { id: 'nurse', name: 'Clinical Nurse', email: 'nurse_jane@hospital.org', password: 'SecurePassword123!', role: 'NURSE', icon: '🩺' },
  { id: 'doctor', name: 'Attending Doctor', email: 'dr_smith@hospital.org', password: 'SecurePassword123!', role: 'DOCTOR', icon: '👨‍⚕️' },
  { id: 'cleaner', name: 'Housekeeping', email: 'cleaner_bob@hospital.org', password: 'SecurePassword123!', role: 'CLEANING_CREW', icon: '🧹' },
];

function getDashboardPath(role: Role): string {
  if (role === 'ADMIN') return '/dashboard/admin';
  if (role === 'CLEANING_CREW') return '/dashboard/housekeeping';
  return '/dashboard/clinical';
}

function getRoleBadge(role: Role) {
  switch (role) {
    case 'ADMIN':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'DOCTOR':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'NURSE':
      return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    case 'CLEANING_CREW':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    default:
      return 'bg-slate-100 text-slate-800 border-slate-200';
  }
}

export default function Login(): React.ReactElement {
  const [username, setUsername] = useState('nurse_jane@hospital.org');
  const [password, setPassword] = useState('SecurePassword123!');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shortcuts, setShortcuts] = useState<SavedShortcut[]>(DEFAULT_SHORTCUTS);
  const [isAssigningToSlot, setIsAssigningToSlot] = useState(false);
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );

  const { login } = useAuth();
  const navigate = useNavigate();

  // Clock ticker for executive appbar
  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load saved shortcuts and remember-me on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('hip_saved_shortcuts');
      if (stored) {
        const parsed = JSON.parse(stored) as SavedShortcut[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setShortcuts(parsed);
        }
      }

      const remembered = localStorage.getItem('hip_remembered_login');
      if (remembered) {
        const creds = JSON.parse(remembered) as { email: string; password?: string };
        if (creds.email) {
          setUsername(creds.email);
          if (creds.password) setPassword(creds.password);
          setRememberMe(true);
        }
      }
    } catch {
      // Ignore localStorage read errors
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSaveSuccessMsg(null);
    setLoading(true);

    try {
      const claims = await login({ email: username.trim(), password });

      if (rememberMe) {
        localStorage.setItem('hip_remembered_login', JSON.stringify({ email: username.trim(), password }));
      } else {
        localStorage.removeItem('hip_remembered_login');
      }

      if (claims.must_change_password) {
        navigate('/force-reset');
      } else {
        navigate(getDashboardPath(claims.role));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred during login.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const selectPersona = (userEmail: string, userPass: string) => {
    setUsername(userEmail);
    setPassword(userPass);
    setError(null);
    setSaveSuccessMsg(null);
  };

  const saveCurrentToSlot = (slotId: string) => {
    if (!username.trim() || !password) {
      setError('Please enter both an Email/Username and Password before saving to a shortcut.');
      return;
    }

    const updated = shortcuts.map((s) => {
      if (s.id === slotId) {
        return {
          ...s,
          email: username.trim(),
          password: password,
          isCustom: true,
        };
      }
      return s;
    });

    setShortcuts(updated);
    try {
      localStorage.setItem('hip_saved_shortcuts', JSON.stringify(updated));
    } catch {
      // Ignore
    }

    const targetName = shortcuts.find((s) => s.id === slotId)?.name || slotId;
    setSaveSuccessMsg(`Saved credentials to "${targetName}" shortcut!`);
    setIsAssigningToSlot(false);
    setError(null);
  };

  const resetShortcuts = () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    try {
      localStorage.removeItem('hip_saved_shortcuts');
    } catch {
      // Ignore
    }
    setSaveSuccessMsg('Shortcuts reset to system defaults.');
    setIsAssigningToSlot(false);
  };

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-[#eef3f9] text-[#0b1526] font-sans antialiased overflow-x-hidden">
      {/* 1. Executive Appbar matching the second screenshot */}
      <header className="appbar shrink-0">
        <div className="ab-glow" aria-hidden="true" />

        {/* Brand */}
        <Link to="/" className="ab-brand text-white no-underline">
          <div className="ab-mark">
            <img src="/logo_tight.png" alt="HIP Logo" />
          </div>
          <div>
            <strong>HIP</strong>
            <small>Hospital Intelligence Platform</small>
          </div>
        </Link>

        {/* Center Navigation Capsule */}
        <nav className="ab-nav" aria-label="Portal Navigation">
          <div className="ab-list">
            <Link to="/" className="ab-item">
              <svg className="ab-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="m3 9 7-6 7 6v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z" />
              </svg>
              <span>Landing Page</span>
            </Link>
            <Link to="/command-center" className="ab-item">
              <svg className="ab-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M2.5 5.2 7 3.2l6 2.3 4.5-2v11.3l-4.5 2-6-2.3-4.5 2V5.2Z" />
                <path d="M7 3.2v11.3M13 5.5v11.3" />
              </svg>
              <span>Command Center</span>
            </Link>
            <div className="ab-item is-on">
              <span className="ab-live" />
              <span>Staff Login</span>
            </div>
          </div>
        </nav>

        {/* Appbar Right Actions */}
        <div className="flex items-center justify-end gap-3.5 text-xs font-mono">
          <span className="text-slate-300 font-bold">{clock}</span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Mesh Live
          </span>
          <Link
            to="/"
            className="px-3.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white font-sans text-xs transition-colors no-underline font-medium"
          >
            ← Public View
          </Link>
        </div>
      </header>

      {/* 2. Full-bleed Hospital PageHero Banner matching the second screenshot */}
      <section className="hero">
        <div className="hero-media" aria-hidden="true" style={{ '--hero-pos': 'center 38%' } as React.CSSProperties}>
          <img src="/main-hospital.jpg" alt="Hospital Intelligence Platform" />
        </div>
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="page-kicker">{dateLabel} · CLINICAL WORKSTATION GATEWAY</p>
            <h1>Staff Authentication &amp; Operations Portal</h1>
            <p className="page-sub">
              HIPAA-compliant personnel provisioning, active bed registry synchronization, and acute emergency dispatch.
            </p>
          </div>

          {/* Frosted Glass Stat Cards */}
          <div className="hero-side">
            <div className="hero-stats">
              <div className="hero-stat">
                <b>124</b>
                <span>Bed Capacity</span>
              </div>
              <div className="hero-stat">
                <b>4</b>
                <span>Care Floors</span>
              </div>
              <div className="hero-stat">
                <b>&lt; 5ms</b>
                <span>Redis Sync</span>
              </div>
              <div className="hero-stat is-text">
                <b className="text-emerald-300 text-lg">Compliant</b>
                <span>HIPAA § 164.312(b)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Main Login Card Container overlapping smoothly onto the hero */}
      <main className="page has-hero w-full max-w-4xl mx-auto px-4 pb-16 relative z-10 -mt-24 sm:-mt-28">
        <div className="card shadow-2xl border border-slate-200/90 bg-white/95 backdrop-blur-xl p-7 sm:p-10 rounded-[28px]">
          {/* Card Head */}
          <div className="mb-7 pb-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200/70 text-blue-700 text-xs font-semibold uppercase tracking-wider mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
                Hospital Intelligence Platform
              </div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                Clinical Workstation
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Enter your staff credentials or click any demo role below for 1-click station entry.
              </p>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block animate-ping" />
              <span className="text-xs font-mono font-semibold text-slate-600">
                Gateway Node: Online
              </span>
            </div>
          </div>

          {/* Feedback Messages */}
          {saveSuccessMsg && (
            <div className="mb-5 p-3.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-medium flex items-center justify-between">
              <span>{saveSuccessMsg}</span>
              <button
                type="button"
                onClick={() => setSaveSuccessMsg(null)}
                className="text-emerald-700 hover:text-emerald-900 ml-2 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {error && (
            <div className="mb-5 p-3.5 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs font-medium">
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Staff Username / Email
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. admin@hospital.org"
                className="w-full bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 rounded-xl transition-all outline-none font-medium"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Password
                </label>
                <div className="flex items-center gap-3">
                  <Link
                    to="/forgot-password"
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Forgot Password?
                  </Link>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    {showPassword ? 'Hide ✕' : 'Show 👁'}
                  </button>
                </div>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 rounded-xl transition-all outline-none font-medium"
              />
            </div>

            <div className="flex items-center justify-between pt-1 text-xs text-slate-600">
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="accent-blue-600 h-4 w-4 rounded"
                />
                <span className="font-medium text-slate-700">Remember credentials on this workstation</span>
              </label>

              <button
                type="button"
                onClick={() => setIsAssigningToSlot(!isAssigningToSlot)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline transition-colors cursor-pointer"
              >
                {isAssigningToSlot ? 'Cancel Save' : 'Save to Shortcut'}
              </button>
            </div>

            {/* Custom Slot Picker Dialog */}
            {isAssigningToSlot && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2 mt-2">
                <div className="font-bold text-slate-800 uppercase tracking-wide">
                  Save current credentials into which quick role slot?
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {shortcuts.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => saveCurrentToSlot(s.id)}
                      className="p-2.5 text-left border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 text-slate-900 rounded-lg transition-colors flex items-center justify-between cursor-pointer"
                    >
                      <span className="font-semibold truncate">{s.icon} {s.name}</span>
                      <span className="text-[11px] text-blue-600 font-bold ml-1">Save</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#0f1b31] hover:bg-[#1b2c49] text-white font-bold py-3.5 px-6 rounded-xl shadow-lg shadow-slate-900/10 uppercase tracking-wider text-xs transition-all disabled:opacity-50 mt-3 cursor-pointer flex items-center justify-center gap-2"
            >
              <span>{loading ? 'Authenticating Credentials...' : 'Sign In to Station'}</span>
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </form>

          {/* 1-Click Role Quick Fill Shortcuts matching the second screenshot */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Demo Quick Roles (Instant Populate)
              </span>
              {shortcuts.some((s) => s.isCustom) && (
                <button
                  type="button"
                  onClick={resetShortcuts}
                  className="text-slate-500 hover:text-slate-900 text-xs font-semibold underline cursor-pointer"
                >
                  Reset Defaults
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {shortcuts.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectPersona(s.email, s.password)}
                  className={`p-3 rounded-xl border text-left transition-all relative group cursor-pointer ${username === s.email
                      ? 'border-blue-500 bg-blue-50/60 shadow-sm ring-1 ring-blue-500/30'
                      : 'border-slate-200 bg-slate-50/70 hover:bg-white hover:border-slate-300'
                    }`}
                >
                  <div className="font-semibold text-slate-900 flex items-center justify-between">
                    <span className="flex items-center gap-2 truncate">
                      <span className="text-base">{s.icon}</span>
                      <span className="truncate text-sm">{s.name}</span>
                    </span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${getRoleBadge(s.role)}`}>
                      {s.role === 'CLEANING_CREW' ? 'EVS' : s.role}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-1 font-mono">
                    {s.email}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Security Compliance Footer */}
          <div className="mt-7 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>Authorized Personnel Only • HIPAA § 164.312 Security Protocol</span>
            <span className="font-mono text-emerald-700 font-semibold flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
              124 Bed Mesh Synchronized
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
