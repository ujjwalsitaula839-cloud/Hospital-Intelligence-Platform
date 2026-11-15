/**
 * Feedback after clinical actions: every save shows an inline confirmation (no floating toast) and is
 * announced through the shared live region; failures are shown instead of being swallowed; vitals
 * placeholders never look like measured values and an empty observation cannot be saved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import Clinical from '../pages/dashboards/Clinical';
import { AnnouncerProvider } from '../components/a11y/Announcer';
import { api } from '../lib/api';
import type { Bed, EquipmentItem } from '../types';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    claims: { personnel_id: 10, username: 'nurse.a', full_name: 'Nurse A, RN', role: 'NURSE', department: 'EMERGENCY', must_change_password: false },
    logout: vi.fn(),
  }),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getBeds: vi.fn(),
      getPatients: vi.fn().mockResolvedValue([]),
      getEquipmentList: vi.fn(),
      getObservations: vi.fn().mockResolvedValue([]),
      getNurses: vi.fn().mockResolvedValue([]),
      getNurseAssignments: vi.fn().mockResolvedValue([]),
      getLatestHandoff: vi.fn().mockResolvedValue(null),
      recordObservation: vi.fn(),
      releaseEquipment: vi.fn(),
      createBatchHandoff: vi.fn(),
      createHandoff: vi.fn(),
      completeNurseAssignment: vi.fn(),
    },
  };
});

const occupiedBed: Bed = {
  bed_id: 1, bed_code: 'ED-01', room_number: '101', department: 'EMERGENCY', bed_type: 'STANDARD', status: 'OCCUPIED',
  version: 1, admission_id: 501, patient_id: 1001, patient_name: 'Synthetic Person', assigned_nurse_id: 10,
  assigned_nurse_name: 'Nurse A, RN', acuity_level: 'ESI_2', equipment: [],
};

const allocatedMonitor: EquipmentItem = {
  equipment_id: 7, serial_number: 'MON-7', equipment_name: 'Synthetic Monitor', equipment_type: 'Cardiac Monitor',
  department: 'EMERGENCY', status: 'ALLOCATED', version: 1,
  allocations: [{ equipment_allocation_id: 70, equipment_id: 7, admission_id: 501, allocated_by_personnel_id: 10, start_datetime: new Date().toISOString(), status: 'ACTIVE' }],
};

function renderClinical() {
  return render(
    <AnnouncerProvider>
      <MemoryRouter>
        <Clinical />
      </MemoryRouter>
    </AnnouncerProvider>
  );
}

async function openVitalsDialog() {
  renderClinical();
  fireEvent.click(await screen.findByRole('button', { name: /^Chart Vitals$/ }));
  return screen.findByRole('dialog', { name: /Chart Patient Vitals/i });
}

describe('Clinical action feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.getBeds).mockResolvedValue([occupiedBed]);
    vi.mocked(api.getEquipmentList).mockResolvedValue([allocatedMonitor]);
    vi.mocked(api.recordObservation).mockResolvedValue({} as never);
  });

  it('vitals inputs say "Not measured" instead of showing plausible example values', async () => {
    const dialog = await openVitalsDialog();
    const numberInputs = within(dialog).getAllByRole('spinbutton');
    expect(numberInputs.length).toBe(6);
    numberInputs.forEach((input) => expect(input).toHaveAttribute('placeholder', 'Not measured'));
  });

  it('refuses to save an observation with no measured values', async () => {
    const dialog = await openVitalsDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /Commit Observation/i }));

    expect(await within(dialog).findByText(/Enter at least one measured vital sign/i)).toBeInTheDocument();
    expect(api.recordObservation).not.toHaveBeenCalled();
  });

  it('confirms saved vitals inline and announces it to screen readers', async () => {
    const dialog = await openVitalsDialog();
    fireEvent.change(within(dialog).getByLabelText(/Heart Rate/i), { target: { value: '88' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Commit Observation/i }));

    await waitFor(() => expect(screen.getByTestId('clinical-action-status')).toHaveTextContent('Vitals saved for bed ED-01.'));
    await waitFor(() => expect(screen.getByTestId('announcer-polite')).toHaveTextContent('Vitals saved for bed ED-01.'));
    expect(api.recordObservation).toHaveBeenCalledWith(501, expect.objectContaining({ heart_rate_bpm: 88 }));
    expect(screen.queryByLabelText(/dismiss toast/i)).not.toBeInTheDocument();
  });

  it('confirms an equipment release', async () => {
    vi.mocked(api.releaseEquipment).mockResolvedValue({} as never);
    renderClinical();
    fireEvent.click(screen.getByRole('button', { name: /Equipment Hub/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Release Machine/i }));

    await waitFor(() => expect(screen.getByTestId('clinical-action-status')).toHaveTextContent('Equipment released and marked available.'));
    expect(api.releaseEquipment).toHaveBeenCalledWith(70);
  });

  it('shows a failed equipment release instead of silently ignoring it', async () => {
    vi.mocked(api.releaseEquipment).mockRejectedValue(new Error('403 Forbidden: clinical role required'));
    renderClinical();
    fireEvent.click(screen.getByRole('button', { name: /Equipment Hub/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Release Machine/i }));

    await waitFor(() => expect(screen.getByTestId('clinical-action-status')).toHaveTextContent(/Could not release equipment: 403 Forbidden/));
    await waitFor(() => expect(screen.getByTestId('announcer-assertive')).toHaveTextContent(/Could not release equipment/));
  });

  it('confirms shift handoff and patient reassignment after recording handoff', async () => {
    vi.mocked(api.getNurses).mockResolvedValue([
      { personnel_id: 10, username: 'nurse.a', full_name: 'Nurse A, RN', role: 'NURSE', department: 'EMERGENCY', is_active: true, must_change_password: false },
      { personnel_id: 20, username: 'nurse.b', full_name: 'Nurse B, RN', role: 'NURSE', department: 'EMERGENCY', is_active: true, must_change_password: false },
    ]);
    vi.mocked(api.createHandoff).mockResolvedValue({} as never);
    vi.mocked(api.createBatchHandoff).mockResolvedValue([]);

    renderClinical();
    fireEvent.click(await screen.findByRole('button', { name: /^Handover$/ }));

    const dialog = await screen.findByRole('dialog', { name: /Bed ED-01/i });
    const select = within(dialog).getByRole('combobox');
    fireEvent.change(select, { target: { value: '20' } });

    const submitBtn = within(dialog).getByRole('button', { name: /Confirm Shift Handover/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('clinical-action-status')).toHaveTextContent(
        'Shift handoff recorded and patients reassigned to the oncoming nurse.'
      );
    });
  });

  it('shows distinct assignment-ended confirmation when ending assignment only, without claiming handoff or reassignment', async () => {
    vi.mocked(api.getNurseAssignments).mockResolvedValue([
      { assignment_id: 701, admission_id: 501, nurse_id: 10, start_datetime: new Date().toISOString(), end_datetime: null, status: 'ACTIVE' },
    ]);
    vi.mocked(api.completeNurseAssignment).mockResolvedValue({ status: 'SUCCESS', message: 'Assignment ended' });

    renderClinical();
    fireEvent.click(await screen.findByRole('button', { name: /^Handover$/ }));

    const dialog = await screen.findByRole('dialog', { name: /Bed ED-01/i });
    const endBtn = within(dialog).getByRole('button', { name: /End Current Shift Assignment Only/i });
    fireEvent.click(endBtn);

    await waitFor(() => {
      const status = screen.getByTestId('clinical-action-status');
      expect(status).toHaveTextContent('Shift assignment ended.');
      expect(status.textContent).not.toContain('handoff');
      expect(status.textContent).not.toContain('reassigned');
    });
  });
});
