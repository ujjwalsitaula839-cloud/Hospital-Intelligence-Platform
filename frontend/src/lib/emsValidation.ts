import type { AcuityLevel } from '../types';

export interface EmsIntakeFormData {
  // Identity & Demographics (Optional)
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  age?: number | string;
  date_of_birth?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  phone?: string;
  address?: string;

  // EMS Telemetry & Call Run (Optional)
  unit_code?: string;
  eta_minutes?: number | string;
  acuity_level?: AcuityLevel;
  primary_diagnosis?: string;
  notes?: string;
  target_bed_code?: string;

  // Vitals & Physiological Telemetry (Optional)
  heart_rate_bpm?: number | string | null;
  systolic_bp?: number | string | null;
  diastolic_bp?: number | string | null;
  oxygen_saturation_pct?: number | string | null;
  respiratory_rate?: number | string | null;
  temperature_celsius?: number | string | null;
}

export interface EmsValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export const PHYSIOLOGICAL_CONSTRAINTS = {
  age: { min: 0, max: 125, unit: 'years', label: 'Age' },
  heart_rate_bpm: { min: 20, max: 280, unit: 'bpm', label: 'Heart Rate' },
  systolic_bp: { min: 40, max: 260, unit: 'mmHg', label: 'Systolic Blood Pressure' },
  diastolic_bp: { min: 20, max: 160, unit: 'mmHg', label: 'Diastolic Blood Pressure' },
  oxygen_saturation_pct: { min: 50, max: 100, unit: '%', label: 'Oxygen Saturation (SpO2)' },
  respiratory_rate: { min: 4, max: 60, unit: 'breaths/min', label: 'Respiratory Rate' },
  temperature_celsius: { min: 30.0, max: 43.0, unit: '°C', label: 'Temperature' },
  eta_minutes: { min: 0, max: 180, unit: 'minutes', label: 'Ambulance ETA' },
} as const;

/**
 * Returns blank initial state for the EMS Call Intake form.
 */
export function getEmptyEmsForm(): EmsIntakeFormData {
  return {
    first_name: '',
    middle_name: '',
    last_name: '',
    age: '',
    date_of_birth: '',
    gender: 'OTHER',
    phone: '',
    address: '',
    unit_code: '',
    eta_minutes: '',
    acuity_level: 'ESI_3',
    primary_diagnosis: '',
    notes: '',
    target_bed_code: '',
    heart_rate_bpm: '',
    systolic_bp: '',
    diastolic_bp: '',
    oxygen_saturation_pct: '',
    respiratory_rate: '',
    temperature_celsius: '',
  };
}

/**
 * Generates emergency surrogate / placeholder data for unknown or trauma patients.
 * Produces unique call suffixes e.g. "Doe [EMS-4821]".
 */
export function getUnknownPatientDefaults(gender: 'MALE' | 'FEMALE'): Partial<EmsIntakeFormData> {
  const currentYear = new Date().getFullYear();
  const estimatedAge = 35;
  const randomCallSuffix = Math.floor(1000 + Math.random() * 9000);

  return {
    first_name: gender === 'MALE' ? 'John' : 'Jane',
    last_name: `Doe [EMS-${randomCallSuffix}]`,
    gender,
    age: estimatedAge,
    date_of_birth: `${currentYear - estimatedAge}-01-01`,
    acuity_level: 'ESI_2',
    eta_minutes: 10,
    primary_diagnosis: 'Emergency Inbound Radio Report · Unidentified Patient',
    notes: `Pre-hospital radio patch received for unidentified adult ${gender.toLowerCase()}. Identity surrogate issued.`,
  };
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validates EMS form inputs against clinical physiological bounds.
 * All fields are optional. If empty, no error is triggered.
 */
export function validateEmsIntakeForm(data: Partial<EmsIntakeFormData>): EmsValidationResult {
  const errors: Record<string, string> = {};

  // Age: 0 - 125
  const age = parseNumber(data.age);
  if (age !== null) {
    if (age < PHYSIOLOGICAL_CONSTRAINTS.age.min || age > PHYSIOLOGICAL_CONSTRAINTS.age.max) {
      errors.age = `Age must be between ${PHYSIOLOGICAL_CONSTRAINTS.age.min} and ${PHYSIOLOGICAL_CONSTRAINTS.age.max} years.`;
    }
  }

  // Heart Rate: 20 - 280 bpm
  const hr = parseNumber(data.heart_rate_bpm);
  if (hr !== null) {
    if (hr < PHYSIOLOGICAL_CONSTRAINTS.heart_rate_bpm.min || hr > PHYSIOLOGICAL_CONSTRAINTS.heart_rate_bpm.max) {
      errors.heart_rate_bpm = `Heart rate must be between ${PHYSIOLOGICAL_CONSTRAINTS.heart_rate_bpm.min} and ${PHYSIOLOGICAL_CONSTRAINTS.heart_rate_bpm.max} bpm.`;
    }
  }

  // Systolic BP: 40 - 260 mmHg
  const sys = parseNumber(data.systolic_bp);
  if (sys !== null) {
    if (sys < PHYSIOLOGICAL_CONSTRAINTS.systolic_bp.min || sys > PHYSIOLOGICAL_CONSTRAINTS.systolic_bp.max) {
      errors.systolic_bp = `Systolic BP must be between ${PHYSIOLOGICAL_CONSTRAINTS.systolic_bp.min} and ${PHYSIOLOGICAL_CONSTRAINTS.systolic_bp.max} mmHg.`;
    }
  }

  // Diastolic BP: 20 - 160 mmHg
  const dia = parseNumber(data.diastolic_bp);
  if (dia !== null) {
    if (dia < PHYSIOLOGICAL_CONSTRAINTS.diastolic_bp.min || dia > PHYSIOLOGICAL_CONSTRAINTS.diastolic_bp.max) {
      errors.diastolic_bp = `Diastolic BP must be between ${PHYSIOLOGICAL_CONSTRAINTS.diastolic_bp.min} and ${PHYSIOLOGICAL_CONSTRAINTS.diastolic_bp.max} mmHg.`;
    }
  }

  // Cross check: Diastolic must be strictly less than Systolic
  if (sys !== null && dia !== null && !errors.systolic_bp && !errors.diastolic_bp) {
    if (dia >= sys) {
      errors.diastolic_bp = 'Diastolic BP must be strictly less than Systolic BP.';
    }
  }

  // SpO2: 50% - 100%
  const spo2 = parseNumber(data.oxygen_saturation_pct);
  if (spo2 !== null) {
    if (spo2 < PHYSIOLOGICAL_CONSTRAINTS.oxygen_saturation_pct.min || spo2 > PHYSIOLOGICAL_CONSTRAINTS.oxygen_saturation_pct.max) {
      errors.oxygen_saturation_pct = `SpO2 must be between ${PHYSIOLOGICAL_CONSTRAINTS.oxygen_saturation_pct.min}% and ${PHYSIOLOGICAL_CONSTRAINTS.oxygen_saturation_pct.max}%.`;
    }
  }

  // Respiratory Rate: 4 - 60 breaths/min
  const rr = parseNumber(data.respiratory_rate);
  if (rr !== null) {
    if (rr < PHYSIOLOGICAL_CONSTRAINTS.respiratory_rate.min || rr > PHYSIOLOGICAL_CONSTRAINTS.respiratory_rate.max) {
      errors.respiratory_rate = `Respiratory rate must be between ${PHYSIOLOGICAL_CONSTRAINTS.respiratory_rate.min} and ${PHYSIOLOGICAL_CONSTRAINTS.respiratory_rate.max} breaths/min.`;
    }
  }

  // Temperature: 30.0 - 43.0 °C
  const temp = parseNumber(data.temperature_celsius);
  if (temp !== null) {
    if (temp < PHYSIOLOGICAL_CONSTRAINTS.temperature_celsius.min || temp > PHYSIOLOGICAL_CONSTRAINTS.temperature_celsius.max) {
      errors.temperature_celsius = `Temperature must be between ${PHYSIOLOGICAL_CONSTRAINTS.temperature_celsius.min.toFixed(1)}°C and ${PHYSIOLOGICAL_CONSTRAINTS.temperature_celsius.max.toFixed(1)}°C.`;
    }
  }

  // ETA: Compulsory, 0 - 180 min
  const eta = parseNumber(data.eta_minutes);
  if (eta === null) {
    errors.eta_minutes = 'EMS arrival time (ETA) is compulsory.';
  } else if (eta < PHYSIOLOGICAL_CONSTRAINTS.eta_minutes.min || eta > PHYSIOLOGICAL_CONSTRAINTS.eta_minutes.max) {
    errors.eta_minutes = `ETA must be between ${PHYSIOLOGICAL_CONSTRAINTS.eta_minutes.min} and ${PHYSIOLOGICAL_CONSTRAINTS.eta_minutes.max} minutes.`;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
