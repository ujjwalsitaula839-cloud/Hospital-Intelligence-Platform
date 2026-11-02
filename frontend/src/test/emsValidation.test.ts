import { describe, it, expect } from 'vitest';
import {
  validateEmsIntakeForm,
  getUnknownPatientDefaults,
  getEmptyEmsForm,
} from '../lib/emsValidation';

describe('EMS Intake Validation & Defaults (TDD Suite)', () => {
  it('requires EMS arrival time (ETA is compulsory)', () => {
    const emptyForm = getEmptyEmsForm();
    const result = validateEmsIntakeForm(emptyForm);
    expect(result.isValid).toBe(false);
    expect(result.errors.eta_minutes).toContain('compulsory');
  });

  it('passes when compulsory ETA is provided and other fields are left empty', () => {
    const formWithEta = { ...getEmptyEmsForm(), eta_minutes: 15 };
    const result = validateEmsIntakeForm(formWithEta);
    expect(result.isValid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  describe('Unknown Patient Autopopulate Defaults', () => {
    it('autopopulates realistic surrogate demographics and default ETA for Unknown Male (John Doe)', () => {
      const maleDefaults = getUnknownPatientDefaults('MALE');
      expect(maleDefaults.first_name).toBe('John');
      expect(maleDefaults.last_name).toMatch(/^Doe \[EMS-\d{4}\]$/);
      expect(maleDefaults.gender).toBe('MALE');
      expect(maleDefaults.age).toBe(35);
      expect(maleDefaults.date_of_birth).toBe(`${new Date().getFullYear() - 35}-01-01`);
      expect(maleDefaults.acuity_level).toBe('ESI_2');
      expect(maleDefaults.eta_minutes).toBe(10);
    });

    it('autopopulates realistic surrogate demographics and default ETA for Unknown Female (Jane Doe)', () => {
      const femaleDefaults = getUnknownPatientDefaults('FEMALE');
      expect(femaleDefaults.first_name).toBe('Jane');
      expect(femaleDefaults.last_name).toMatch(/^Doe \[EMS-\d{4}\]$/);
      expect(femaleDefaults.gender).toBe('FEMALE');
      expect(femaleDefaults.age).toBe(35);
      expect(femaleDefaults.date_of_birth).toBe(`${new Date().getFullYear() - 35}-01-01`);
      expect(femaleDefaults.acuity_level).toBe('ESI_2');
      expect(femaleDefaults.eta_minutes).toBe(10);
    });
  });

  describe('Age Constraints (0 - 125 years)', () => {
    it('accepts valid ages within 0 to 125', () => {
      expect(validateEmsIntakeForm({ age: 0, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ age: '45', eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ age: 125, eta_minutes: 10 }).isValid).toBe(true);
    });

    it('rejects negative age or excessively large age', () => {
      const lowResult = validateEmsIntakeForm({ age: -1, eta_minutes: 10 });
      expect(lowResult.isValid).toBe(false);
      expect(lowResult.errors.age).toContain('Age must be between 0 and 125');

      const highResult = validateEmsIntakeForm({ age: 130, eta_minutes: 10 });
      expect(highResult.isValid).toBe(false);
      expect(highResult.errors.age).toContain('Age must be between 0 and 125');
    });
  });

  describe('Heart Rate Constraints (20 - 280 bpm)', () => {
    it('accepts physiological heart rates', () => {
      expect(validateEmsIntakeForm({ heart_rate_bpm: 72, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ heart_rate_bpm: '140', eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ heart_rate_bpm: 20, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ heart_rate_bpm: 280, eta_minutes: 10 }).isValid).toBe(true);
    });

    it('rejects heart rates outside safe boundaries', () => {
      const low = validateEmsIntakeForm({ heart_rate_bpm: 18, eta_minutes: 10 });
      expect(low.isValid).toBe(false);
      expect(low.errors.heart_rate_bpm).toContain('Heart rate must be between 20 and 280');

      const high = validateEmsIntakeForm({ heart_rate_bpm: 350, eta_minutes: 10 });
      expect(high.isValid).toBe(false);
      expect(high.errors.heart_rate_bpm).toContain('Heart rate must be between 20 and 280');
    });
  });

  describe('Blood Pressure Constraints', () => {
    it('accepts normal and emergency blood pressures', () => {
      expect(validateEmsIntakeForm({ systolic_bp: 120, diastolic_bp: 80, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ systolic_bp: 220, diastolic_bp: 130, eta_minutes: 10 }).isValid).toBe(true);
    });

    it('allows systolic only or diastolic only', () => {
      expect(validateEmsIntakeForm({ systolic_bp: 110, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ diastolic_bp: 70, eta_minutes: 10 }).isValid).toBe(true);
    });

    it('rejects systolic out of bounds (40 - 260 mmHg)', () => {
      expect(validateEmsIntakeForm({ systolic_bp: 30, eta_minutes: 10 }).errors.systolic_bp).toContain('40 and 260');
      expect(validateEmsIntakeForm({ systolic_bp: 290, eta_minutes: 10 }).errors.systolic_bp).toContain('40 and 260');
    });

    it('rejects diastolic out of bounds (20 - 160 mmHg)', () => {
      expect(validateEmsIntakeForm({ diastolic_bp: 15, eta_minutes: 10 }).errors.diastolic_bp).toContain('20 and 160');
      expect(validateEmsIntakeForm({ diastolic_bp: 180, eta_minutes: 10 }).errors.diastolic_bp).toContain('20 and 160');
    });

    it('enforces diastolic strictly lower than systolic when both are provided', () => {
      const inverted = validateEmsIntakeForm({ systolic_bp: 110, diastolic_bp: 120, eta_minutes: 10 });
      expect(inverted.isValid).toBe(false);
      expect(inverted.errors.diastolic_bp).toContain('strictly less than Systolic');

      const equal = validateEmsIntakeForm({ systolic_bp: 100, diastolic_bp: 100, eta_minutes: 10 });
      expect(equal.isValid).toBe(false);
      expect(equal.errors.diastolic_bp).toContain('strictly less than Systolic');
    });
  });

  describe('SpO2 Constraints (50% - 100%)', () => {
    it('accepts SpO2 between 50 and 100%', () => {
      expect(validateEmsIntakeForm({ oxygen_saturation_pct: 98, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ oxygen_saturation_pct: '85', eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ oxygen_saturation_pct: 100, eta_minutes: 10 }).isValid).toBe(true);
    });

    it('rejects impossible SpO2 percentages', () => {
      expect(validateEmsIntakeForm({ oxygen_saturation_pct: 42, eta_minutes: 10 }).errors.oxygen_saturation_pct).toContain('50% and 100%');
      expect(validateEmsIntakeForm({ oxygen_saturation_pct: 105, eta_minutes: 10 }).errors.oxygen_saturation_pct).toContain('50% and 100%');
    });
  });

  describe('Respiratory Rate Constraints (4 - 60 breaths/min)', () => {
    it('accepts respiratory rates in physiological range', () => {
      expect(validateEmsIntakeForm({ respiratory_rate: 16, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ respiratory_rate: 4, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ respiratory_rate: 60, eta_minutes: 10 }).isValid).toBe(true);
    });

    it('rejects respiratory rates outside 4 to 60', () => {
      expect(validateEmsIntakeForm({ respiratory_rate: 2, eta_minutes: 10 }).errors.respiratory_rate).toContain('4 and 60');
      expect(validateEmsIntakeForm({ respiratory_rate: 75, eta_minutes: 10 }).errors.respiratory_rate).toContain('4 and 60');
    });
  });

  describe('Temperature Constraints (30.0 - 43.0 °C)', () => {
    it('accepts temperatures in clinical range', () => {
      expect(validateEmsIntakeForm({ temperature_celsius: 37.0, eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ temperature_celsius: 38.5, eta_minutes: 10 }).isValid).toBe(true);
    });

    it('rejects extreme hypothermia (<30.0) or hyperpyrexia (>43.0)', () => {
      expect(validateEmsIntakeForm({ temperature_celsius: 28.5 }).errors.temperature_celsius).toContain('30.0°C and 43.0°C');
      expect(validateEmsIntakeForm({ temperature_celsius: 44.5 }).errors.temperature_celsius).toContain('30.0°C and 43.0°C');
    });
  });

  describe('ETA Constraints (0 - 180 min)', () => {
    it('accepts reasonable ambulance travel ETA in minutes', () => {
      expect(validateEmsIntakeForm({ eta_minutes: 10 }).isValid).toBe(true);
      expect(validateEmsIntakeForm({ eta_minutes: 0 }).isValid).toBe(true);
    });

    it('rejects negative ETA or excessively large ETA', () => {
      expect(validateEmsIntakeForm({ eta_minutes: -5 }).errors.eta_minutes).toContain('0 and 180');
      expect(validateEmsIntakeForm({ eta_minutes: 240 }).errors.eta_minutes).toContain('0 and 180');
    });
  });
});
