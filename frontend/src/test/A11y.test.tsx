/**
 * Accessibility checks: jest-axe scans of the sign-in pages and the main dialogs, plus keyboard and
 * screen-reader behaviour that axe cannot see (dialog focus handling, live-region announcements).
 * Colour contrast is checked in the browser scan, because jsdom has no layout or computed colours.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import React, { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { configureAxe, toHaveNoViolations } from 'jest-axe';
import * as AuthContextModule from '../context/AuthContext';
import Login from '../pages/Login';
import ForgotPassword from '../pages/ForgotPassword';
import ResetPassword from '../pages/ResetPassword';
import ForceReset from '../pages/ForceReset';
import ShiftHandoffModal from '../components/clinical/ShiftHandoffModal';
import EmsCallIntakeModal from '../components/ems/EmsCallIntakeModal';
import NotificationBell, { type AppNotification } from '../components/navigation/NotificationBell';
import ElonChatWidget from '../components/elon/ElonChatWidget';
import { AnnouncerProvider, useAnnounce } from '../components/a11y/Announcer';
import type { Bed, StaffMember } from '../types';

expect.extend(toHaveNoViolations);

// Whole pages are scanned from <html> so page-level rules (one main landmark, all content in landmarks) apply.
// Colour contrast needs a real browser and is covered by the browser scan.
const axePage = configureAxe({ rules: { 'color-contrast': { enabled: false } } });
// Dialogs and widgets rendered on their own: landmark rules only make sense for whole pages.
const axeComponent = configureAxe({
  rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
});

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getObservations: vi.fn().mockResolvedValue([]),
      getLatestHandoff: vi.fn().mockResolvedValue(null),
      getNurseAssignments: vi.fn().mockResolvedValue([]),
      registerPatient: vi.fn(),
      createAdmission: vi.fn(),
      elonChat: vi.fn(),
    },
  };
});

const nurses: StaffMember[] = [
  { personnel_id: 10, username: 'nurse.a', full_name: 'Nurse A, RN', role: 'NURSE', department: 'EMERGENCY', is_active: true, must_change_password: false },
  { personnel_id: 20, username: 'nurse.b', full_name: 'Nurse B, RN', role: 'NURSE', department: 'EMERGENCY', is_active: true, must_change_password: false },
];

const occupiedBed: Bed = {
  bed_id: 1, bed_code: 'ED-01', room_number: '101', department: 'EMERGENCY', bed_type: 'STANDARD', status: 'OCCUPIED',
  version: 1, admission_id: 501, patient_id: 1001, patient_name: 'Synthetic Person', assigned_nurse_id: 10,
  assigned_nurse_name: 'Nurse A, RN', acuity_level: 'ESI_2', equipment: [],
};

function renderPage(element: React.ReactElement, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
}

beforeEach(() => {
  // Page-level scans read the whole document, so nothing from a previous test may remain mounted.
  cleanup();
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  // jsdom has no layout engine; the chat widget scrolls to its newest message.
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    claims: { sub: '77', role: 'NURSE', must_change_password: true },
    isAuthenticated: true,
    mustChangePassword: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshAuth: vi.fn(),
  } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
});

describe('Accessibility: sign-in and password pages have no axe violations', () => {
  it('Login page', async () => {
    renderPage(<Login />);
    expect(await axePage(document.documentElement)).toHaveNoViolations();
  });

  it('Forgot Password page', async () => {
    renderPage(<ForgotPassword />);
    expect(await axePage(document.documentElement)).toHaveNoViolations();
  });

  it('Reset Password page (with a reset link token)', async () => {
    renderPage(<ResetPassword />, '/reset-password?token=synthetic-token');
    expect(await axePage(document.documentElement)).toHaveNoViolations();
  });

  it('Mandatory first-login password change page', async () => {
    renderPage(<ForceReset />);
    expect(await axePage(document.documentElement)).toHaveNoViolations();
  });
});

describe('Accessibility: main dialogs', () => {
  it('Shift handoff dialog has no axe violations and is announced as a labelled modal dialog', async () => {
    const { container } = render(
      <ShiftHandoffModal isOpen initialBed={occupiedBed} allBeds={[occupiedBed]} nursesList={nurses}
        currentUserId={10} onClose={vi.fn()} onSuccess={vi.fn().mockResolvedValue(undefined)} />
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/Bed ED-01/);
    expect(await axeComponent(container)).toHaveNoViolations();
  });

  it('Shift handoff dialog moves focus inside on open and closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <ShiftHandoffModal isOpen initialBed={occupiedBed} allBeds={[occupiedBed]} nursesList={nurses}
        currentUserId={10} onClose={onClose} onSuccess={vi.fn().mockResolvedValue(undefined)} />
    );
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('EMS call intake dialog has no axe violations', async () => {
    const { container } = render(<EmsCallIntakeModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/EMS/i);
    expect(await axeComponent(container)).toHaveNoViolations();
  });

  it('EMS call intake dialog keeps Tab focus inside and returns focus to the opener on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open EMS call intake</button>
          <EmsCallIntakeModal isOpen={open} onClose={() => setOpen(false)} onSuccess={vi.fn()} />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open EMS call intake' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea');
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });
});

describe('Accessibility: notifications, assistant and live announcements', () => {
  const notification: AppNotification = {
    id: 'n1', eventType: 'BED_AVAILABLE', title: 'Bed Available', message: 'ER-124 is ready', time: '10:00', read: false,
  };

  it('Notification panel has no axe violations when open', async () => {
    const { container } = render(
      <NotificationBell notifications={[notification]} onMarkAllAsRead={vi.fn()} onClearAll={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(await axeComponent(container)).toHaveNoViolations();
  });

  it('New notifications are announced to screen readers through the shared live region', async () => {
    const { rerender } = render(
      <AnnouncerProvider>
        <NotificationBell notifications={[]} onMarkAllAsRead={vi.fn()} onClearAll={vi.fn()} />
      </AnnouncerProvider>
    );
    rerender(
      <AnnouncerProvider>
        <NotificationBell notifications={[notification]} onMarkAllAsRead={vi.fn()} onClearAll={vi.fn()} />
      </AnnouncerProvider>
    );
    await waitFor(() => expect(screen.getByTestId('announcer-polite')).toHaveTextContent('New notification: Bed Available'));
  });

  it('Error messages use the assertive live region', async () => {
    function Probe() {
      const announce = useAnnounce();
      return <button type="button" onClick={() => announce('Save failed', 'assertive')}>fail</button>;
    }
    render(<AnnouncerProvider><Probe /></AnnouncerProvider>);
    await act(async () => fireEvent.click(screen.getByText('fail')));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Save failed'));
  });

  it('ELON chat has no axe violations and exposes its conversation as a live log', async () => {
    const { container } = render(<ElonChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: /Chat with ELON/i }));
    expect(await screen.findByRole('log', { name: /Conversation with ELON/i })).toBeInTheDocument();
    expect(await axeComponent(container)).toHaveNoViolations();
  });
});
