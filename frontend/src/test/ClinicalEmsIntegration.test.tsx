import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import Clinical from '../pages/dashboards/Clinical';
import { api } from '../lib/api';
import type { Bed, Patient } from '../types';

// Mock Auth Context
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    claims: {
      personnel_id: 10,
      username: 'nurse.sarah',
      full_name: 'Sarah Connor, RN',
      role: 'NURSE',
      department: 'EMERGENCY',
      must_change_password: false,
    },
    logout: vi.fn(),
  }),
}));

// Mock API
vi.mock('../lib/api', () => ({
  api: {
    getBeds: vi.fn(),
    getPatients: vi.fn(),
    getEquipmentList: vi.fn(),
    getObservations: vi.fn(),
    registerPatient: vi.fn(),
    createAdmission: vi.fn(),
    recordObservation: vi.fn(),
    updateBedStatus: vi.fn(),
    updatePatient: vi.fn(),
    deactivatePatient: vi.fn(),
    dischargeAdmission: vi.fn(),
  },
}));

const mockBeds: Bed[] = [
  {
    bed_id: 1,
    bed_code: 'ED-01',
    department: 'EMERGENCY',
    room_number: '101',
    bed_type: 'TRAUMA',
    status: 'AVAILABLE',
    version: 1,
  },
];

const mockPatients: Patient[] = [
  {
    patient_id: 1,
    first_name: 'John',
    last_name: 'Doe [EMS-1024]',
    date_of_birth: '1990-01-01',
    gender: 'MALE',
    is_active: true,
  },
];

describe('Clinical EMS Call Intake & Inbound Integration (TDD Suite)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getBeds).mockResolvedValue(mockBeds);
    vi.mocked(api.getPatients).mockResolvedValue(mockPatients);
    vi.mocked(api.getEquipmentList).mockResolvedValue([]);
    vi.mocked(api.getObservations).mockResolvedValue([]);
  });

  it('renders the header with quick EMS Call Intake button and EMS tab', async () => {
    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    // Verify Header quick intake button
    expect(screen.getByRole('button', { name: /ems call intake/i })).toBeInTheDocument();

    // Verify Tab navigation
    expect(screen.getByRole('button', { name: /ems inbound intake/i })).toBeInTheDocument();
  });

  it('opens the EMS Call Intake modal when header button is clicked', async () => {
    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    const headerEmsBtn = screen.getByRole('button', { name: /ems call intake/i });
    fireEvent.click(headerEmsBtn);

    // Modal should now be open
    await waitFor(() => {
      expect(screen.getByText(/EMS Radio Patch & Inbound Call Intake/i)).toBeInTheDocument();
    });

    // Close button should close modal
    const closeBtn = screen.getByLabelText(/close$/i);
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/EMS Radio Patch & Inbound Call Intake/i)).not.toBeInTheDocument();
    });
  });

  it('navigates to EMS Inbound Intake tab and shows worklist and form', async () => {
    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    const emsTabBtn = screen.getByRole('button', { name: /ems inbound intake/i });
    fireEvent.click(emsTabBtn);

    // Should display module title and worklist
    await waitFor(() => {
      expect(screen.getByText(/EMS Radio Call & Inbound Intake/i)).toBeInTheDocument();
      expect(screen.getByText(/Inbound & Recent EMS Patients Worklist/i)).toBeInTheDocument();
      // Should show detected mock EMS patient
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });
  });

  it('allows clicking "Update Identity" for an EMS patient to open the patient edit modal', async () => {
    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    // Go to EMS tab
    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Click "Update Identity"
    const updateIdBtn = screen.getByRole('button', { name: /update identity/i });
    fireEvent.click(updateIdBtn);

    // Patient Edit Modal should appear with Patient #1
    await waitFor(() => {
      expect(screen.getByText(/Patient #1/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue('John')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Doe [EMS-1024]')).toBeInTheDocument();
    });
  });

  it('allows clicking "Chart Vitals" for an EMS arrival to open the vitals charting drawer', async () => {
    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    // Go to EMS tab
    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Click "Chart Vitals"
    const chartVitalsBtn = screen.getByRole('button', { name: /chart vitals/i });
    fireEvent.click(chartVitalsBtn);

    // Chart Patient Vitals modal should open
    await waitFor(() => {
      expect(screen.getByText(/Chart Patient Vitals/i)).toBeInTheDocument();
    });
  });

  it('allows clicking "Cancel Hold" to deactivate patient and remove them from the worklist', async () => {
    vi.mocked(api.deactivatePatient).mockResolvedValueOnce({ status: 'SUCCESS', message: 'Deactivated' });

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    // Go to EMS tab
    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Click "Cancel Hold"
    const cancelHoldBtn = screen.getByRole('button', { name: /cancel hold/i });
    fireEvent.click(cancelHoldBtn);

    await waitFor(() => {
      expect(api.deactivatePatient).toHaveBeenCalledWith(1);
    });
  });
});
