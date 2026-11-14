import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ShiftHandoffModal from '../components/clinical/ShiftHandoffModal';
import { api } from '../lib/api';
import type { Bed, StaffMember, Observation, NurseHandoff } from '../types';

vi.mock('../lib/api', () => ({
  api: {
    getObservations: vi.fn(),
    getLatestHandoff: vi.fn(),
    createHandoff: vi.fn(),
    createBatchHandoff: vi.fn(),
    getNurseAssignments: vi.fn(),
    completeNurseAssignment: vi.fn(),
  },
}));

describe('ShiftHandoffModal Component (I-PASS Framework)', () => {
  const mockNurses: StaffMember[] = [
    {
      personnel_id: 10,
      username: 'nurse.sarah',
      full_name: 'Sarah Connor, RN',
      role: 'NURSE',
      department: 'EMERGENCY',
      is_active: true,
      must_change_password: false,
    },
    {
      personnel_id: 20,
      username: 'nurse.john',
      full_name: 'John Miller, RN',
      role: 'NURSE',
      department: 'EMERGENCY',
      is_active: true,
      must_change_password: false,
    },
  ];

  const mockBeds: Bed[] = [
    {
      bed_id: 101,
      bed_code: 'ED-01',
      room_number: '101',
      department: 'EMERGENCY',
      bed_type: 'STANDARD',
      status: 'OCCUPIED',
      version: 1,
      admission_id: 501,
      patient_id: 1001,
      patient_name: 'Jane Doe',
      assigned_nurse_id: 10,
      assigned_nurse_name: 'Sarah Connor, RN',
      acuity_level: 'ESI_2',
      equipment: ['Ventilator', 'IV Pump'],
    },
    {
      bed_id: 102,
      bed_code: 'ED-02',
      room_number: '102',
      department: 'EMERGENCY',
      bed_type: 'STANDARD',
      status: 'OCCUPIED',
      version: 1,
      admission_id: 502,
      patient_id: 1002,
      patient_name: 'Bob Smith',
      assigned_nurse_id: 10,
      assigned_nurse_name: 'Sarah Connor, RN',
      acuity_level: 'ESI_3',
      equipment: ['Cardiac Monitor'],
    },
  ];

  const mockObservation: Observation = {
    observation_id: 99,
    admission_id: 501,
    observation_datetime: '2026-11-14T14:00:00Z',
    heart_rate_bpm: 88,
    systolic_bp: 130,
    diastolic_bp: 82,
    oxygen_saturation_pct: 97,
    temperature_celsius: 37.2,
    respiratory_rate: 18,
  };

  const mockPriorHandoff: NurseHandoff = {
    handoff_id: 888,
    admission_id: 501,
    from_nurse_id: 20,
    to_nurse_id: 10,
    illness_severity: 'WATCHER',
    patient_summary: 'Transferred from triage with chest pain, troponin pending.',
    action_items: 'Repeat troponin at 16:00, monitor telemetry.',
    contingency_plan: 'If chest pain recurs, obtain 12-lead ECG and notify Dr. Smith.',
    create_datetime: '2026-11-14T07:00:00Z',
  };

  const defaultProps = {
    isOpen: true,
    initialBed: mockBeds[0],
    allBeds: mockBeds,
    nursesList: mockNurses,
    currentUserId: 10,
    onClose: vi.fn(),
    onSuccess: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getObservations).mockResolvedValue([mockObservation]);
    vi.mocked(api.getLatestHandoff).mockResolvedValue(mockPriorHandoff);
    vi.mocked(api.createHandoff).mockResolvedValue({
      handoff_id: 900,
      admission_id: 501,
      from_nurse_id: 10,
      to_nurse_id: 20,
      illness_severity: 'STABLE',
      create_datetime: new Date().toISOString(),
    });
    vi.mocked(api.createBatchHandoff).mockResolvedValue([]);
    vi.mocked(api.getNurseAssignments).mockResolvedValue([
      {
        assignment_id: 77,
        admission_id: 501,
        nurse_id: 10,
        start_datetime: '2026-11-14T07:00:00Z',
        end_datetime: null,
        status: 'ACTIVE',
      },
    ]);
    vi.mocked(api.completeNurseAssignment).mockResolvedValue(undefined as any);
  });

  it('renders modal header, demographic details, and auto-populated vitals', async () => {
    render(<ShiftHandoffModal {...defaultProps} />);

    expect(screen.getByText(/I-PASS Clinical Shift Handoff/i)).toBeInTheDocument();
    expect(screen.getByText(/Bed ED-01 • Rm 101/i)).toBeInTheDocument();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText('88 bpm')).toBeInTheDocument();
      expect(screen.getByText('130/82')).toBeInTheDocument();
      expect(screen.getByText('97%')).toBeInTheDocument();
      expect(screen.getByText('37.2 °C')).toBeInTheDocument();
      expect(screen.getByText('18/m')).toBeInTheDocument();
    });
  });

  it('displays incoming shift handoff notes from the previous nurse', async () => {
    render(<ShiftHandoffModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Incoming Shift Handoff/i)).toBeInTheDocument();
      expect(screen.getByText('Transferred from triage with chest pain, troponin pending.')).toBeInTheDocument();
      expect(screen.getByText('Repeat troponin at 16:00, monitor telemetry.')).toBeInTheDocument();
      expect(screen.getByText('If chest pain recurs, obtain 12-lead ECG and notify Dr. Smith.')).toBeInTheDocument();
    });
  });

  it('allows selecting illness severity with hardware LED indicator', async () => {
    render(<ShiftHandoffModal {...defaultProps} />);

    const watcherBtn = screen.getByRole('button', { name: /WATCHER/i });
    fireEvent.click(watcherBtn);

    // Button should be active
    expect(watcherBtn.className).toContain('border-yellow-500');

    const unstableBtn = screen.getByRole('button', { name: /UNSTABLE/i });
    fireEvent.click(unstableBtn);
    expect(unstableBtn.className).toContain('border-red-500');
  });

  it('handles multi-patient tabs and applying oncoming nurse across all beds', async () => {
    render(<ShiftHandoffModal {...defaultProps} />);

    // Because user is assigned to both ED-01 and ED-02, both tabs appear
    expect(screen.getByRole('button', { name: /Bed ED-01/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bed ED-02/i })).toBeInTheDocument();

    // Select oncoming nurse John Miller
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '20' } });

    // Switch to tab ED-02
    const tab2 = screen.getByRole('button', { name: /Bed ED-02/i });
    fireEvent.click(tab2);

    expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
    // Oncoming nurse should also be 20 because applyToAll was checked
    const selectTab2 = screen.getByRole('combobox') as HTMLSelectElement;
    expect(selectTab2.value).toBe('20');
  });

  it('submits batch handoff when multiple assigned beds exist', async () => {
    render(<ShiftHandoffModal {...defaultProps} />);

    // Select oncoming nurse
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '20' } });

    // Type patient summary
    const summaryInput = screen.getByPlaceholderText(/Key events of shift/i);
    fireEvent.change(summaryInput, { target: { value: 'Patient stable, IV fluids running at 75 mL/hr.' } });

    // Submit batch
    const submitBtn = screen.getByRole('button', { name: /Confirm & Hand Over All/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.createBatchHandoff).toHaveBeenCalledTimes(1);
      expect(defaultProps.onSuccess).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('allows ending current shift assignment without submitting handoff notes', async () => {
    render(<ShiftHandoffModal {...defaultProps} />);

    const endBtn = screen.getByRole('button', { name: /End Current Shift Assignment Only/i });
    fireEvent.click(endBtn);

    await waitFor(() => {
      expect(api.completeNurseAssignment).toHaveBeenCalledWith(77);
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });
  });
});
