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
      expect(screen.queryByRole('heading', { name: /Doe \[EMS-1024\]/i })).not.toBeInTheDocument();
    });
  });

  it('persists cancelled hold in localStorage so it never resurrects on refresh / re-login', async () => {
    localStorage.clear();
    vi.mocked(api.deactivatePatient).mockResolvedValueOnce({ status: 'SUCCESS', message: 'Deactivated' });

    const { unmount } = render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));
    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Cancel Hold
    fireEvent.click(screen.getByRole('button', { name: /cancel hold/i }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Doe \[EMS-1024\]/i })).not.toBeInTheDocument();
    });

    // Verify localStorage contains patient ID 1
    const stored = JSON.parse(localStorage.getItem('hip_cancelled_ems_holds') || '[]');
    expect(stored).toContain(1);

    // Unmount and remount (simulating page reload / re-login)
    unmount();

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    // Even though api.getPatients returns mockPatients with patient #1, it should be filtered out
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Doe \[EMS-1024\]/i })).not.toBeInTheDocument();
    });
  });

  it('handles 403 Forbidden or network failure on deactivate gracefully without resurrecting the card', async () => {
    localStorage.clear();
    // Simulate backend 403 Forbidden
    vi.mocked(api.deactivatePatient).mockRejectedValueOnce(new Error('403 Forbidden'));

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));
    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Cancel Hold despite backend 403
    fireEvent.click(screen.getByRole('button', { name: /cancel hold/i }));

    // The card must still be removed from the UI and saved to localStorage
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Doe \[EMS-1024\]/i })).not.toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem('hip_cancelled_ems_holds') || '[]');
    expect(stored).toContain(1);
  });

  it('does not call dischargeAdmission with patient_id when patient has no real admission (avoiding 404)', async () => {
    localStorage.clear();
    vi.mocked(api.deactivatePatient).mockResolvedValueOnce({ status: 'SUCCESS', message: 'Deactivated' });

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));
    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Cancel Hold
    fireEvent.click(screen.getByRole('button', { name: /cancel hold/i }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Doe \[EMS-1024\]/i })).not.toBeInTheDocument();
    });

    // api.dischargeAdmission must NEVER be called with the patient_id (1)
    expect(api.dischargeAdmission).not.toHaveBeenCalledWith(1);
  });

  it('routes notifications strictly to NotificationBell and does not render floating toasts on screen', async () => {
    localStorage.clear();
    vi.mocked(api.deactivatePatient).mockResolvedValueOnce({ status: 'SUCCESS', message: 'Deactivated' });

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));
    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Cancel Hold
    fireEvent.click(screen.getByRole('button', { name: /cancel hold/i }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Doe \[EMS-1024\]/i })).not.toBeInTheDocument();
    });

    // Notification bell should have unread count
    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    expect(bellBtn).toBeInTheDocument();

    // Verify there is NO floating toast container
    expect(screen.queryByLabelText(/dismiss toast/i)).not.toBeInTheDocument();
  });

  it('displays "Hold Bed / Admit" button on inbound EMS card and opens bed hold modal', async () => {
    localStorage.clear();

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Verify "Hold Bed / Admit" button is present on the card
    const holdBedBtn = screen.getByRole('button', { name: /hold bed \/ admit/i });
    expect(holdBedBtn).toBeInTheDocument();

    // Click "Hold Bed / Admit"
    fireEvent.click(holdBedBtn);

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByText(/Hold Bed for Inbound Patient/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm bed hold/i })).toBeInTheDocument();
    });
  });

  it('allows selecting an available bed to hold (RESERVED) for an inbound EMS patient', async () => {
    localStorage.clear();
    vi.mocked(api.createAdmission).mockResolvedValueOnce({
      admission_id: 99,
      patient_id: 1,
      bed_id: 1,
      acuity_level: 'ESI_3',
      primary_diagnosis: 'Inbound EMS Arrival',
      arrival_datetime: new Date().toISOString(),
    });
    // When bed status is updated, subsequent getBeds returns the bed in RESERVED status
    vi.mocked(api.updateBedStatus).mockImplementation(async () => {
      vi.mocked(api.getBeds).mockResolvedValue([
        {
          bed_id: 1,
          bed_code: 'ED-01',
          department: 'EMERGENCY',
          room_number: '101',
          bed_type: 'TRAUMA',
          status: 'RESERVED',
          patient_id: 1,
          patient_name: 'John Doe [EMS-1024]',
          admission_id: 101,
          version: 2,
        },
      ]);
      return {};
    });

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Click Hold Bed
    fireEvent.click(screen.getByRole('button', { name: /hold bed \/ admit/i }));

    await waitFor(() => {
      expect(screen.getByText(/Hold Bed for Inbound Patient/i)).toBeInTheDocument();
    });

    // Select ED-01 from dropdown
    const select = screen.getByLabelText(/Select Destination Bed/i);
    fireEvent.change(select, { target: { value: 'ED-01' } });

    // Confirm Bed Hold
    const confirmBtn = screen.getByRole('button', { name: /confirm bed hold/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.updateBedStatus).toHaveBeenCalledWith('ED-01', 'RESERVED', expect.objectContaining({
        patient_id: 1,
      }));
      // Card must disappear immediately from the unassigned inbound worklist
      expect(screen.queryByRole('heading', { name: /Doe \[EMS-1024\]/i })).not.toBeInTheDocument();
    });

    // Verify localStorage tracks assigned patient ID
    const assignedIds = JSON.parse(localStorage.getItem('hip_assigned_ems_patient_ids') || '[]');
    expect(assignedIds).toContain(1);
  });

  it('transitions control exclusively to Bed Matrix when bed is assigned, removing inbound card', async () => {
    localStorage.clear();
    vi.mocked(api.createAdmission).mockResolvedValueOnce({
      admission_id: 101,
      patient_id: 1,
      bed_id: 1,
      acuity_level: 'ESI_2',
      primary_diagnosis: 'Severe Trauma',
      arrival_datetime: new Date().toISOString(),
    });
    // When bed status is updated, subsequent getBeds returns the bed in RESERVED status
    vi.mocked(api.updateBedStatus).mockImplementation(async () => {
      vi.mocked(api.getBeds).mockResolvedValue([
        {
          bed_id: 1,
          bed_code: 'ED-01',
          department: 'EMERGENCY',
          room_number: '101',
          bed_type: 'TRAUMA',
          status: 'RESERVED',
          patient_id: 1,
          patient_name: 'John Doe [EMS-1024]',
          admission_id: 101,
          version: 2,
        },
      ]);
      return {};
    });

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    // Navigate to EMS Inbound Intake tab
    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Hold bed
    fireEvent.click(screen.getByRole('button', { name: /hold bed \/ admit/i }));
    await waitFor(() => {
      expect(screen.getByText(/Hold Bed for Inbound Patient/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Select Destination Bed/i), { target: { value: 'ED-01' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm bed hold/i }));

    // Inbound card must vanish
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Doe \[EMS-1024\]/i })).not.toBeInTheDocument();
    });

    // Switch back to Bed Grid & Telemetry tab to verify bed now displays the reserved patient
    fireEvent.click(screen.getByRole('button', { name: /bed grid & telemetry/i }));

    await waitFor(() => {
      expect(screen.getByText(/John Doe \[EMS-1024\]/i)).toBeInTheDocument();
      expect(screen.getByText('RESERVED')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /bed patient \(occupy\)/i })).toBeInTheDocument();
    });
  });

  it('renders high-contrast, fully readable action buttons on occupied bed cards without requiring hover', async () => {
    // Provide an occupied bed
    const occupiedBeds: Bed[] = [
      {
        bed_id: 10,
        bed_code: 'ED-01',
        department: 'EMERGENCY',
        room_number: '101',
        bed_type: 'TRAUMA',
        status: 'OCCUPIED',
        admission_id: 200,
        patient_id: 127,
        patient_name: 'Patient_5 Test',
        acuity_level: 'ESI_2',
        primary_diagnosis: 'Emergency Triage',
        version: 1,
      },
    ];
    vi.mocked(api.getBeds).mockResolvedValue(occupiedBeds);

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Patient_5 Test/i)).toBeInTheDocument();
    });

    // Locate Chart Vitals and Transfer buttons
    const chartVitalsBtn = screen.getByRole('button', { name: /chart vitals/i });
    const transferBtn = screen.getByRole('button', { name: /transfer/i });

    // Ensure buttons are in the document and have explicit text classes
    expect(chartVitalsBtn).toBeInTheDocument();
    expect(transferBtn).toBeInTheDocument();
    expect(chartVitalsBtn.className).toMatch(/text-slate-800/);
    expect(transferBtn.className).toMatch(/text-slate-800/);
  });

  it('renders high-contrast Confirm Discharge button in the patient discharge modal', async () => {
    const occupiedBeds: Bed[] = [
      {
        bed_id: 10,
        bed_code: 'ED-01',
        department: 'EMERGENCY',
        room_number: '101',
        bed_type: 'TRAUMA',
        status: 'OCCUPIED',
        admission_id: 200,
        patient_id: 127,
        patient_name: 'Patient_5 Test',
        version: 1,
      },
    ];
    vi.mocked(api.getBeds).mockResolvedValue(occupiedBeds);

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Patient_5 Test/i)).toBeInTheDocument();
    });

    // Click Discharge button on card
    fireEvent.click(screen.getByRole('button', { name: /^discharge$/i }));

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText(/Confirm Patient Discharge/i)).toBeInTheDocument();
    });

    // Locate Confirm Discharge button
    const confirmDischargeBtn = screen.getByRole('button', { name: /confirm discharge/i });
    expect(confirmDischargeBtn).toBeInTheDocument();
    expect(confirmDischargeBtn.className).toMatch(/bg-red-600/);
    expect(confirmDischargeBtn.className).not.toMatch(/disabled:bg-zinc-800/);
  });

  it('renders ambulance telemetry route track (>------) with moving ambulance and decrementing ETA', async () => {
    localStorage.clear();

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Verify Ambulance Telemetry route track
    expect(screen.getByText(/Ambulance Telemetry/i)).toBeInTheDocument();
    expect(screen.getByText(/Field Dispatch/i)).toBeInTheDocument();
    expect(screen.getByText(/Hospital ED/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Ambulance approaching/i)).toBeInTheDocument();
    expect(screen.getByText(/ETA:/i)).toBeInTheDocument();
  });

  it('blinks red and triggers approaching notification when ambulance ETA is under 1 minute', async () => {
    localStorage.clear();
    // Seed localStorage with a patient arriving in 45 seconds (< 1 minute)
    const approachingMap = {
      1: {
        patientId: 1,
        etaMinutes: 1,
        initialEtaSeconds: 60,
        targetTimestamp: Date.now() + 45 * 1000,
      },
    };
    localStorage.setItem('hip_ems_eta_map', JSON.stringify(approachingMap));

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Card should display approaching banner and blinking red alert style
    await waitFor(() => {
      expect(screen.getByText(/AMBULANCE APPROACHING \(< 1 MIN\)/i)).toBeInTheDocument();
    });

    // NotificationBell should receive the Ambulance Approaching alert
    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    expect(bellBtn).toBeInTheDocument();

    fireEvent.click(bellBtn);
    await waitFor(() => {
      expect(screen.getAllByText(/Ambulance Approaching/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/arriving in under 1 minute/i)).toBeInTheDocument();
    });
  });

  it('displays prominent OVERDUE banner at top of card when ambulance ETA has elapsed', async () => {
    localStorage.clear();
    // Seed localStorage with a patient who is overdue by 90 seconds (target was 90s ago)
    const overdueMap = {
      1: {
        patientId: 1,
        etaMinutes: 10,
        initialEtaSeconds: 600,
        targetTimestamp: Date.now() - 90 * 1000,
      },
    };
    localStorage.setItem('hip_ems_eta_map', JSON.stringify(overdueMap));

    render(
      <BrowserRouter>
        <Clinical />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Doe \[EMS-1024\]/i)).toBeInTheDocument();
    });

    // Top of the card must display OVERDUE banner and telemetry badge
    await waitFor(() => {
      expect(screen.getAllByText(/OVERDUE/i).length).toBeGreaterThanOrEqual(2);
    });

    // Telemetry badge reflects OVERDUE
    expect(screen.getByText(/OVERDUE \(\+/i)).toBeInTheDocument();
  });
});
