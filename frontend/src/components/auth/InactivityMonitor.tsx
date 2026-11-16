import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../hooks/useDialog';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (HIPAA Security Rule §164.312(a)(2)(iii))
const DEFAULT_WARNING_MS = 60 * 1000; // 60 seconds warning before auto-lock

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

export interface InactivityMonitorProps {
  isAuthenticated?: boolean;
  logout?: () => Promise<void>;
  timeoutMs?: number;
  warningMs?: number;
}

export function InactivityMonitor({
  isAuthenticated: propIsAuthenticated,
  logout: propLogout,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  warningMs = DEFAULT_WARNING_MS,
}: InactivityMonitorProps) {
  const auth = useAuth();
  const isAuthenticated = propIsAuthenticated ?? auth.isAuthenticated;
  const logout = propLogout ?? auth.logout;

  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(Math.round(warningMs / 1000));

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(0);

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    warningTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownIntervalRef.current = null;
  }, []);

  const handlePerformLogout = useCallback(async () => {
    clearAllTimers();
    setIsWarningOpen(false);
    try {
      sessionStorage.setItem(
        'hip_inactivity_notice',
        'Your workstation session ended due to 15 minutes of inactivity for patient privacy and HIPAA compliance.'
      );
      await logout();
    } catch {
      // Logout failure safe fallback
    }
  }, [clearAllTimers, logout]);

  const startTimers = useCallback(() => {
    clearAllTimers();
    if (!isAuthenticated) return;

    lastActivityRef.current = Date.now();
    const timeUntilWarning = Math.max(0, timeoutMs - warningMs);

    warningTimerRef.current = setTimeout(() => {
      setIsWarningOpen(true);
      const initialSeconds = Math.round(warningMs / 1000);
      setSecondsRemaining(initialSeconds);

      countdownIntervalRef.current = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, timeUntilWarning);

    logoutTimerRef.current = setTimeout(() => {
      handlePerformLogout();
    }, timeoutMs);
  }, [clearAllTimers, isAuthenticated, timeoutMs, warningMs, handlePerformLogout]);

  const handleStaySignedIn = useCallback(() => {
    setIsWarningOpen(false);
    startTimers();
  }, [startTimers]);

  // Reset timers on user interaction (throttled to at most once every 1000ms)
  useEffect(() => {
    if (!isAuthenticated) {
      clearAllTimers();
      setIsWarningOpen(false);
      return;
    }

    startTimers();

    const handleUserActivity = () => {
      // If warning modal is already open, do not auto-dismiss on subtle mouse wiggle
      // to ensure explicit clinician confirmation
      if (isWarningOpen) return;

      const now = Date.now();
      if (now - lastActivityRef.current > 1000) {
        lastActivityRef.current = now;
        startTimers();
      }
    };

    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, handleUserActivity, { passive: true });
    });

    return () => {
      clearAllTimers();
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, handleUserActivity);
      });
    };
  }, [isAuthenticated, isWarningOpen, startTimers, clearAllTimers]);

  const dialogRef = useDialog<HTMLDivElement>(isWarningOpen, handleStaySignedIn);

  if (!isWarningOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inactivity-warning-title"
        tabIndex={-1}
        className="w-full max-w-md bg-zinc-950 border-2 border-yellow-500/80 p-6 shadow-2xl rounded-xs space-y-4 text-zinc-100 font-sans"
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">
            ⏱️
          </span>
          <div>
            <h2 id="inactivity-warning-title" className="text-base font-bold text-white tracking-wide">
              Session Inactivity Warning
            </h2>
            <p className="text-xs text-yellow-400 font-mono font-semibold">
              HIPAA Workstation Safeguard (§164.312(a)(2)(iii))
            </p>
          </div>
        </div>

        <p className="text-xs text-zinc-300 leading-relaxed">
          For patient privacy and HIPAA compliance, your session will automatically lock in{' '}
          <span className="text-yellow-400 font-bold font-mono text-sm px-1 py-0.5 bg-yellow-950/60 border border-yellow-700/50 rounded-xs">
            {secondsRemaining}s
          </span>{' '}
          due to inactivity.
        </p>

        <p className="text-[11px] text-zinc-400">
          Unsaved chart entries may be lost if this workstation locks. Click below to continue your clinical session.
        </p>

        <div className="pt-2 flex flex-col sm:flex-row gap-2 border-t border-zinc-800">
          <button
            type="button"
            data-autofocus
            onClick={handleStaySignedIn}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 text-xs tracking-wider uppercase transition-colors rounded-xs shadow-md"
          >
            Stay Signed In
          </button>
          <button
            type="button"
            onClick={handlePerformLogout}
            className="px-4 py-2.5 border border-zinc-700 hover:border-red-600 hover:text-red-400 text-zinc-400 text-xs transition-colors rounded-xs"
          >
            Sign Out Now
          </button>
        </div>
      </div>
    </div>
  );
}

export default InactivityMonitor;
