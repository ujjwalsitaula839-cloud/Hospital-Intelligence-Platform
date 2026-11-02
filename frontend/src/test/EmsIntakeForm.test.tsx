import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import EmsIntakeForm from '../components/ems/EmsIntakeForm';
import { api } from '../lib/api';
import type { Patient, Admission, Observation } from '../types';

// Mock the API module
vi.mock('../lib/api', () => ({
  api: {
    registerPatient: vi.fn(),
    createAdmission: vi.fn(),
    recordObservation: vi.fn(),
  },
}));

describe('EmsIntakeForm Component (TDD Suite)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all sections with natural labels, compulsory ETA, and no bed selection dropdown', () => {
    render(<EmsIntakeForm onSuccess={vi.fn()} />);

    // Header / Quick Autopopulate Buttons
    expect(screen.getByRole('button', { name: /unknown male/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unknown female/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();

    // Demographics Inputs (all optional)
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^age/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/gender/i)).toBeInTheDocument();

    // Ambulance & ETA
    expect(screen.getByLabelText(/ambulance \/ company name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/arrival eta/i)).toBeInTheDocument();

    // Confirm BED SELECTION is REMOVED (will be handled by Langchain)
    expect(screen.queryByLabelText(/reserve target bed/i)).not.toBeInTheDocument();

    // Vitals Inputs
    expect(screen.getByLabelText(/heart rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/systolic bp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/diastolic bp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/spo2/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/resp rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/temp/i)).toBeInTheDocument();

    // Submit button
    expect(screen.getByRole('button', { name: /submit ems inbound intake/i })).toBeInTheDocument();
  });

  it('autopopulates John Doe surrogate data and default ETA when "Unknown Male" is clicked', () => {
    render(<EmsIntakeForm onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /unknown male/i }));

    const firstNameInput = screen.getByLabelText(/first name/i) as HTMLInputElement;
    const lastNameInput = screen.getByLabelText(/last name/i) as HTMLInputElement;
    const ageInput = screen.getByLabelText(/^age/i) as HTMLInputElement;
    const genderSelect = screen.getByLabelText(/gender/i) as HTMLSelectElement;
    const etaInput = screen.getByLabelText(/arrival eta/i) as HTMLInputElement;

    expect(firstNameInput.value).toBe('John');
    expect(lastNameInput.value).toMatch(/^Doe \[EMS-\d{4}\]$/);
    expect(ageInput.value).toBe('35');
    expect(genderSelect.value).toBe('MALE');
    expect(etaInput.value).toBe('10');
  });

  it('autopopulates Jane Doe surrogate data and default ETA when "Unknown Female" is clicked', () => {
    render(<EmsIntakeForm onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /unknown female/i }));

    const firstNameInput = screen.getByLabelText(/first name/i) as HTMLInputElement;
    const lastNameInput = screen.getByLabelText(/last name/i) as HTMLInputElement;
    const ageInput = screen.getByLabelText(/^age/i) as HTMLInputElement;
    const genderSelect = screen.getByLabelText(/gender/i) as HTMLSelectElement;
    const etaInput = screen.getByLabelText(/arrival eta/i) as HTMLInputElement;

    expect(firstNameInput.value).toBe('Jane');
    expect(lastNameInput.value).toMatch(/^Doe \[EMS-\d{4}\]$/);
    expect(ageInput.value).toBe('35');
    expect(genderSelect.value).toBe('FEMALE');
    expect(etaInput.value).toBe('10');
  });

  it('forces EMS arrival time (ETA) as compulsory and validates constraints on vitals/age', async () => {
    render(<EmsIntakeForm onSuccess={vi.fn()} />);

    // Try submitting without ETA
    fireEvent.click(screen.getByRole('button', { name: /submit ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/EMS arrival time \(ETA\) is compulsory/i)).toBeInTheDocument();
    });

    // Enter out of range values
    fireEvent.change(screen.getByLabelText(/arrival eta/i), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/^age/i), { target: { value: '140' } });
    fireEvent.change(screen.getByLabelText(/heart rate/i), { target: { value: '350' } });
    fireEvent.change(screen.getByLabelText(/spo2/i), { target: { value: '110' } });

    // Submit again
    fireEvent.click(screen.getByRole('button', { name: /submit ems inbound intake/i }));

    await waitFor(() => {
      expect(screen.getByText(/Age must be between 0 and 125/i)).toBeInTheDocument();
      expect(screen.getByText(/Heart rate must be between 20 and 280/i)).toBeInTheDocument();
      expect(screen.getByText(/SpO2 must be between 50% and 100%/i)).toBeInTheDocument();
    });

    expect(api.registerPatient).not.toHaveBeenCalled();
  });

  it('converts ambulance/company name automatically to UPPERCASE', () => {
    render(<EmsIntakeForm onSuccess={vi.fn()} />);

    const unitInput = screen.getByLabelText(/ambulance \/ company name/i) as HTMLInputElement;
    fireEvent.change(unitInput, { target: { value: 'medic 14 rescue' } });

    expect(unitInput.value).toBe('MEDIC 14 RESCUE');
  });

  it('successfully submits intake with compulsory ETA, registers fallback identity, and RESETS form', async () => {
    const mockCreatedPatient: Patient = {
      patient_id: 101,
      first_name: 'Patient',
      last_name: 'Unknown',
      date_of_birth: '1995-01-01',
      gender: 'OTHER',
      is_active: true,
    };
    const mockCreatedAdmission: Admission = {
      admission_id: 501,
      patient_id: 101,
      arrival_datetime: new Date().toISOString(),
      acuity_level: 'ESI_3',
    };

    vi.mocked(api.registerPatient).mockResolvedValueOnce(mockCreatedPatient);
    vi.mocked(api.createAdmission).mockResolvedValueOnce(mockCreatedAdmission);

    const onSuccess = vi.fn();
    render(<EmsIntakeForm onSuccess={onSuccess} />);

    // Provide compulsory ETA
    fireEvent.change(screen.getByLabelText(/arrival eta/i), { target: { value: '8' } });

    // Click submit
    fireEvent.click(screen.getByRole('button', { name: /submit ems inbound intake/i }));

    await waitFor(() => {
      expect(api.registerPatient).toHaveBeenCalledTimes(1);
      expect(api.createAdmission).toHaveBeenCalledTimes(1);
    });

    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: mockCreatedPatient,
        admission: mockCreatedAdmission,
      })
    );

    // Check that success banner appears and form inputs are reset to blank
    await waitFor(() => {
      expect(screen.getByText(/Inbound EMS Call Logged Successfully!/i)).toBeInTheDocument();
    });
    const etaInput = screen.getByLabelText(/arrival eta/i) as HTMLInputElement;
    expect(etaInput.value).toBe('');
  });

  it('submits vitals when provided and resets form to default', async () => {
    const mockCreatedPatient: Patient = {
      patient_id: 202,
      first_name: 'John',
      last_name: 'Doe [EMS-5521]',
      date_of_birth: '1991-01-01',
      gender: 'MALE',
      is_active: true,
    };
    const mockCreatedAdmission: Admission = {
      admission_id: 602,
      patient_id: 202,
      arrival_datetime: new Date().toISOString(),
      acuity_level: 'ESI_2',
    };
    const mockCreatedObs: Observation = {
      observation_id: 901,
      admission_id: 602,
      recorded_by_user_id: 1,
      observation_datetime: new Date().toISOString(),
      heart_rate_bpm: 110,
    };

    vi.mocked(api.registerPatient).mockResolvedValueOnce(mockCreatedPatient);
    vi.mocked(api.createAdmission).mockResolvedValueOnce(mockCreatedAdmission);
    vi.mocked(api.recordObservation).mockResolvedValueOnce(mockCreatedObs);

    render(<EmsIntakeForm onSuccess={vi.fn()} />);

    // Click Unknown Male (fills ETA: 10)
    fireEvent.click(screen.getByRole('button', { name: /unknown male/i }));

    // Fill in telemetry
    fireEvent.change(screen.getByLabelText(/heart rate/i), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText(/systolic bp/i), { target: { value: '140' } });
    fireEvent.change(screen.getByLabelText(/diastolic bp/i), { target: { value: '88' } });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: /submit ems inbound intake/i }));

    await waitFor(() => {
      expect(api.registerPatient).toHaveBeenCalled();
      expect(api.createAdmission).toHaveBeenCalled();
      expect(api.recordObservation).toHaveBeenCalledWith(602, expect.objectContaining({
        heart_rate_bpm: 110,
        systolic_bp: 140,
        diastolic_bp: 88,
      }));
    });

    // Check that form was reset to default
    await waitFor(() => {
      const hrInput = screen.getByLabelText(/heart rate/i) as HTMLInputElement;
      expect(hrInput.value).toBe('');
      const etaInput = screen.getByLabelText(/arrival eta/i) as HTMLInputElement;
      expect(etaInput.value).toBe('');
    });
  });
});
