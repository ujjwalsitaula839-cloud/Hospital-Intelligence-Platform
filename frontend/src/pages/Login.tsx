import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';

interface SavedShortcut {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  icon: string;
  isCustom?: boolean;
}

const DEFAULT_SHORTCUTS: SavedShortcut[] = [
  { id: 'admin', name: 'Administrator', email: 'admin@hospital.org', password: '[PASSWORD]', role: 'ADMIN', icon: '🛡️' },
  { id: 'nurse', name: 'Clinical Nurse', email: 'nurse_jane@hospital.org', password: '[PASSWORD]', role: 'NURSE', icon: '🩺' },
  { id: 'doctor', name: 'Attending Doctor', email: 'dr_smith@hospital.org', password: '[PASSWORD]', role: 'DOCTOR', icon: '👨‍⚕️' },
  { id: 'cleaner', name: 'Housekeeping', email: 'cleaner_bob@hospital.org', password: '[PASSWORD]', role: 'CLEANING_CREW', icon: '🧹' },
];

function getDashboardPath(role: Role): string {
  if (role === 'ADMIN') return '/dashboard/admin';
  if (role === 'CLEANING_CREW') return '/dashboard/housekeeping';
  return '/dashboard/clinical';
}

export default function Login(): React.ReactElement {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shortcuts, setShortcuts] = useState<SavedShortcut[]>(DEFAULT_SHORTCUTS);
  const [isAssigningToSlot, setIsAssigningToSlot] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

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

      // Handle remember me
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

  // Save current username & password into a chosen shortcut slot
  const saveCurrentToSlot = (slotId: string) => {
    if (!username.trim() || !password) {
      setError('Please enter both an Email/Username and Password above before saving to a shortcut.');
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
      // Ignore storage errors
    }

    const targetName = shortcuts.find((s) => s.id === slotId)?.name || slotId;
    setSaveSuccessMsg(`✓ Saved your credentials to the "${targetName}" shortcut!`);
    setIsAssigningToSlot(false);
    setError(null);
  };

  // Reset shortcuts back to original defaults
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

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 text-zinc-100 relative bg-zinc-950"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(9, 9, 11, 0.78), rgba(9, 9, 11, 0.90)), url('/hospital_login_bg.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Subtle glowing ambient pulse in backdrop */}
      <div className="absolute inset-0 bg-radial from-cyan-950/20 via-transparent to-black/60 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md bg-zinc-900/90 backdrop-blur-md border border-zinc-700/60 p-7 sm:p-8 shadow-2xl rounded-xs">
        {/* Hospital Logo & Title */}
        <div className="mb-6 text-center">
          <div className="flex justify-center mb-3">
            <div className="p-2 bg-zinc-950/80 border border-zinc-700/80 rounded-xs shadow-inner inline-flex items-center justify-center">
              <img
                src="/logo_tight.png"
                alt="Hospital Intelligence Platform Logo"
                className="h-20 sm:h-22 w-auto object-contain rounded-xs"
              />
            </div>
          </div>
          <div className="inline-block border border-red-800/80 bg-red-950/60 px-2.5 py-0.5 text-[10px] font-mono tracking-widest uppercase text-red-300 font-bold mb-1.5">
            Emergency Medical System
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Hospital Intelligence Platform
          </h1>
          <p className="text-[11px] font-mono text-zinc-400 mt-1 uppercase tracking-wider">
            Clinical Authentication & Operations Gateway
          </p>
        </div>

        {/* Feedback Messages */}
        {saveSuccessMsg && (
          <div className="mb-4 p-3 border border-green-700 bg-green-950/80 text-green-300 text-xs font-mono flex items-center justify-between">
            <span>{saveSuccessMsg}</span>
            <button
              type="button"
              onClick={() => setSaveSuccessMsg(null)}
              className="text-green-400 hover:text-white ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 border border-red-700 bg-red-950/80 text-red-200 text-xs font-mono">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-1.5">
              Staff Username / Email
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. admin@hospital.org"
              className="w-full bg-zinc-950/90 border border-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300">
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-[10px] font-mono text-zinc-400 hover:text-zinc-200 uppercase tracking-wider"
              >
                {showPassword ? 'Hide ✕' : 'Show 👁'}
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-zinc-950/90 border border-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 font-mono text-xs text-zinc-400">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="accent-white h-3.5 w-3.5"
              />
              <span>Remember me on this browser</span>
            </label>

            {/* Trigger to save current credentials into a shortcut */}
            <button
              type="button"
              onClick={() => setIsAssigningToSlot(!isAssigningToSlot)}
              className="text-[11px] text-zinc-300 hover:text-white underline decoration-zinc-600 hover:decoration-white transition-colors"
            >
              {isAssigningToSlot ? 'Cancel Save' : ' Save to Shortcut'}
            </button>
          </div>

          {/* Slot Picker Dialog if user clicked 'Save to Shortcut' */}
          {isAssigningToSlot && (
            <div className="p-3 bg-zinc-950 border border-zinc-700 text-xs font-mono space-y-2">
              <div className="text-[11px] text-zinc-300 font-bold uppercase">
                Save current input into which shortcut button?
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {shortcuts.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => saveCurrentToSlot(s.id)}
                    className="p-1.5 text-left border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white transition-colors text-[11px] flex items-center justify-between"
                  >
                    <span>{s.icon} {s.name}</span>
                    <span className="text-[9px] text-green-400">Save</span>
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-zinc-500">
                Credentials will be stored securely in your browser's private local storage.
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-400 py-3 text-xs font-mono uppercase tracking-wider font-bold transition-colors shadow-sm mt-1"
          >
            {loading ? 'Authenticating Credentials...' : 'Sign In to Workstation'}
          </button>
        </form>

        {/* Customizable 1-Click Role Quick Fill Shortcuts */}
        <div className="mt-6 pt-4 border-t border-zinc-800/80">
          {shortcuts.some((s) => s.isCustom) && (
            <div className="flex justify-end mb-2 font-mono text-[10px]">
              <button
                type="button"
                onClick={resetShortcuts}
                className="text-zinc-500 hover:text-zinc-300 underline"
              >
                Reset Defaults
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5 font-mono text-xs">
            {shortcuts.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectPersona(s.email, s.password)}
                className={`p-2 border text-left transition-colors relative group ${username === s.email
                  ? 'border-white bg-zinc-800'
                  : 'border-zinc-800 bg-zinc-950/70 hover:bg-zinc-800 hover:border-zinc-600'
                  }`}
              >
                <div className="font-bold text-white flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span>{s.icon}</span> {s.name}
                  </span>
                  {s.isCustom && (
                    <span className="text-[9px] text-green-400 border border-green-900 bg-green-950/60 px-1 py-0.2 rounded-xs">
                      Saved
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                  {s.email}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800/80 text-center space-y-1">
          <p className="text-[11px] text-zinc-400 font-mono">
            Authorized Personnel Only • HIPAA & 21 CFR Part 11 Active
          </p>
          <div className="text-[10px] text-zinc-500 font-mono flex items-center justify-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
            <span>Gateway Node: Online</span>
          </div>
        </div>
      </div>
    </div>
  );
}
