import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { InactivityMonitor } from '../components/auth/InactivityMonitor';

describe('Inactivity Auto-Logoff (HIPAA §164.312(a)(2)(iii))', () => {
  const mockLogout = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start inactivity timers when user is not authenticated', () => {
    render(
      <InactivityMonitor
        isAuthenticated={false}
        logout={mockLogout}
        timeoutMs={5000}
        warningMs={2000}
      />
    );

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.queryByRole('dialog', { name: /Session Inactivity Warning/i })).not.toBeInTheDocument();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('shows warning modal when inactivity reaches warning threshold', () => {
    render(
      <InactivityMonitor
        isAuthenticated={true}
        logout={mockLogout}
        timeoutMs={5000}
        warningMs={2000}
      />
    );

    // Advance 3000ms (timeoutMs - warningMs)
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const dialog = screen.getByRole('dialog', { name: /Session Inactivity Warning/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/For patient privacy and HIPAA compliance/i)).toBeInTheDocument();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('resets timer when user performs activity before warning threshold', () => {
    render(
      <div>
        <InactivityMonitor
          isAuthenticated={true}
          logout={mockLogout}
          timeoutMs={5000}
          warningMs={2000}
        />
        <button type="button">Active Patient Action</button>
      </div>
    );

    // Advance 2000ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // User moves mouse / types
    act(() => {
      fireEvent.mouseMove(window);
    });

    // Advance another 2000ms (total 4000ms, but reset occurred at 2000ms)
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Warning should NOT be shown yet because timer was reset
    expect(screen.queryByRole('dialog', { name: /Session Inactivity Warning/i })).not.toBeInTheDocument();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('clicking "Stay Signed In" dismisses warning and resets the timer', () => {
    render(
      <InactivityMonitor
        isAuthenticated={true}
        logout={mockLogout}
        timeoutMs={5000}
        warningMs={2000}
      />
    );

    // Trigger warning
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByRole('dialog', { name: /Session Inactivity Warning/i })).toBeInTheDocument();

    // Click "Stay Signed In"
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Stay Signed In/i }));
    });

    // Modal should close
    expect(screen.queryByRole('dialog', { name: /Session Inactivity Warning/i })).not.toBeInTheDocument();
    expect(mockLogout).not.toHaveBeenCalled();

    // Advance 2000ms -> still open and no warning
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('dialog', { name: /Session Inactivity Warning/i })).not.toBeInTheDocument();
  });

  it('automatically logs out user and sets inactivity notice when full timeout elapses', () => {
    render(
      <InactivityMonitor
        isAuthenticated={true}
        logout={mockLogout}
        timeoutMs={5000}
        warningMs={2000}
      />
    );

    // Advance past full timeout
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('hip_inactivity_notice')).toContain('inactivity');
    expect(screen.queryByRole('dialog', { name: /Session Inactivity Warning/i })).not.toBeInTheDocument();
  });

  it('clicking "Sign Out Now" in warning modal logs out immediately', () => {
    render(
      <InactivityMonitor
        isAuthenticated={true}
        logout={mockLogout}
        timeoutMs={5000}
        warningMs={2000}
      />
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Sign Out Now/i }));
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
