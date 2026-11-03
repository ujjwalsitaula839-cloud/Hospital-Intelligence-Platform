import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import NotificationBell, { type AppNotification } from '../components/navigation/NotificationBell';

const mockNotifications: AppNotification[] = [
  {
    id: 'notif-1',
    eventType: 'HOLD_CANCELLED',
    title: 'EMS Inbound Hold Cancelled',
    message: 'Inbound hold for John Doe [Ems-4725] was cancelled and record removed.',
    actor: 'Staff',
    time: '10:08 AM',
    read: false,
  },
  {
    id: 'notif-2',
    eventType: 'BED_RESERVED',
    title: 'Bed Reserved',
    message: 'Status updated to RESERVED',
    actor: 'Dr. Smith',
    bedCode: 'ED-01',
    time: '10:05 AM',
    read: false,
  },
  {
    id: 'notif-3',
    eventType: 'BED_OCCUPIED',
    title: 'Patient Admitted',
    message: 'Patient John Doe admitted into ED-02',
    actor: 'Nurse Carol',
    bedCode: 'ED-02',
    time: '09:50 AM',
    read: true,
  },
];

describe('NotificationBell Component (TDS Suite)', () => {
  it('renders the bell icon button with accessible aria attributes', () => {
    render(<NotificationBell notifications={mockNotifications} />);
    const bellBtn = screen.getByRole('button', { name: /notifications \(2 unread\)/i });
    expect(bellBtn).toBeInTheDocument();
    expect(bellBtn).toHaveAttribute('aria-haspopup', 'true');
    expect(bellBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('displays the unread badge with exact count of unread items', () => {
    render(<NotificationBell notifications={mockNotifications} />);
    const badge = screen.getByText('2');
    expect(badge).toBeInTheDocument();
  });

  it('displays 9+ when unread count exceeds 9', () => {
    const manyUnread: AppNotification[] = Array.from({ length: 12 }, (_, i) => ({
      id: `n-${i}`,
      eventType: 'BED_STATUS_CHANGED',
      title: `Event ${i}`,
      message: `Message ${i}`,
      time: '10:00 AM',
      read: false,
    }));

    render(<NotificationBell notifications={manyUnread} />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('hides badge when all notifications are read or list is empty', () => {
    const allRead: AppNotification[] = mockNotifications.map((n) => ({ ...n, read: true }));
    render(<NotificationBell notifications={allRead} />);
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^notifications$/i })).toBeInTheDocument();
  });

  it('opens popup menu when bell button is clicked and displays notifications', () => {
    render(<NotificationBell notifications={mockNotifications} />);
    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    expect(bellBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('EMS Inbound Hold Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/Inbound hold for John Doe \[Ems-4725\]/i)).toBeInTheDocument();
    expect(screen.getByText('Bed Reserved')).toBeInTheDocument();
    expect(screen.getByText('Patient Admitted')).toBeInTheDocument();
  });

  it('allows clicking "Mark all as read"', () => {
    const onMarkAll = vi.fn();
    render(
      <NotificationBell
        notifications={mockNotifications}
        onMarkAllAsRead={onMarkAll}
      />
    );

    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const markAllBtn = screen.getByRole('button', { name: /mark all as read/i });
    fireEvent.click(markAllBtn);

    expect(onMarkAll).toHaveBeenCalledTimes(1);
  });

  it('allows clicking "Clear all" to remove all notifications', () => {
    const onClearAll = vi.fn();
    render(
      <NotificationBell
        notifications={mockNotifications}
        onClearAll={onClearAll}
      />
    );

    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const clearBtn = screen.getByRole('button', { name: /clear all/i });
    fireEvent.click(clearBtn);

    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('allows dismissing an individual notification', () => {
    const onDismiss = vi.fn();
    render(
      <NotificationBell
        notifications={mockNotifications}
        onDismissNotification={onDismiss}
      />
    );

    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const dismissBtns = screen.getAllByRole('button', { name: /dismiss notification/i });
    fireEvent.click(dismissBtns[0]);

    expect(onDismiss).toHaveBeenCalledWith('notif-1');
  });

  it('renders friendly empty state when there are no notifications', () => {
    render(<NotificationBell notifications={[]} />);
    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByText(/no notifications/i)).toBeInTheDocument();
  });

  it('closes popup menu when Escape key is pressed', () => {
    render(<NotificationBell notifications={mockNotifications} />);
    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    expect(screen.getByText('EMS Inbound Hold Cancelled')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('EMS Inbound Hold Cancelled')).not.toBeInTheDocument();
  });
});

