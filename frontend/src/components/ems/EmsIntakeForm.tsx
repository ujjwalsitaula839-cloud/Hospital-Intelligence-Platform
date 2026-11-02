import React, { useState } from 'react';
import { api } from '../../lib/api';
import {
  getEmptyEmsForm,
  getUnknownPatientDefaults,
  validateEmsIntakeForm,
  PHYSIOLOGICAL_CONSTRAINTS,
  type EmsIntakeFormData,
} from '../../lib/emsValidation';
import type { AcuityLevel, Admission, Patient } from '../../types';

interface EmsIntakeFormProps {
  onSuccess?: (result: {
    patient: Patient;
    admission: Admission;
  }) => void;
  onCancel?: () => void;
  isModal?: boolean;
}

export default function EmsIntakeForm({
  onSuccess,
  onCancel,
  isModal = false,
}: EmsIntakeFormProps): React.ReactElement {
  const [form, setForm] = useState<EmsIntakeFormData>(getEmptyEmsForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<{
    message: string;
    patientId: number;
    patientName: string;
    admissionId: number;
  } | null>(null);

  // Field change handler with live constraint validation and uppercase for EMS unit
  const handleChange = (
    field: keyof EmsIntakeFormData,
    value: string | number | null
  ) => {
    // Ensure ambulance / company name is always uppercase
    const processedValue =
      field === 'unit_code' && typeof value === 'string'
        ? value.toUpperCase()
        : value;

    const updatedForm = { ...form, [field]: processedValue };

    // Auto-compute approximate DOB if age is typed
    if (field === 'age' && value !== '' && value !== null) {
      const parsedAge = Number(value);
      if (Number.isFinite(parsedAge) && parsedAge >= 0 && parsedAge <= 125) {
        const computedYear = new Date().getFullYear() - parsedAge;
        updatedForm.date_of_birth = `${computedYear}-01-01`;
      }
    }

    setForm(updatedForm);

    // Clear field-level error on change if valid
    if (errors[field]) {
      const validation = validateEmsIntakeForm(updatedForm);
      setErrors((prev) => {
        const next = { ...prev };
        if (!validation.errors[field]) {
          delete next[field];
        } else {
          next[field] = validation.errors[field];
        }
        return next;
      });
    }
  };

  // Autopopulate handlers
  const handleAutopopulateUnknown = (gender: 'MALE' | 'FEMALE') => {
    const dummy = getUnknownPatientDefaults(gender);
    setForm((prev) => ({
      ...prev,
      ...dummy,
    }));
    setErrors({});
    setApiError(null);
  };

  const handleResetForm = () => {
    setForm(getEmptyEmsForm());
    setErrors({});
    setApiError(null);
  };

  // Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    // 1. Run Physiological & Demographic Constraints Validation (compulsory ETA enforced)
    const validation = validateEmsIntakeForm(form);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setIsSubmitting(true);

    try {
      // 2. Prepare Patient Demographics (optional fallbacks for unidentified calls)
      const firstName = form.first_name?.trim() || 'Patient';
      const lastName = form.last_name?.trim() || `Unknown [EMS-${Math.floor(1000 + Math.random() * 9000)}]`;
      const computedDob =
        form.date_of_birth ||
        (form.age ? `${new Date().getFullYear() - Number(form.age)}-01-01` : '1995-01-01');
      const gender = form.gender || 'OTHER';

      const createdPatient = await api.registerPatient({
        first_name: firstName,
        middle_name: form.middle_name?.trim() || undefined,
        last_name: lastName,
        date_of_birth: computedDob,
        gender,
        phone: form.phone?.trim() || undefined,
        address: form.address?.trim() || undefined,
      });

      // 3. Create Emergency Admission with unit code uppercase
      const unitCodeUpper = form.unit_code?.trim().toUpperCase();
      const primaryDiagnosis =
        form.primary_diagnosis?.trim() ||
        (unitCodeUpper ? `Inbound EMS (${unitCodeUpper})` : 'EMS Emergency Inbound');

      const fullNotes = [
        unitCodeUpper ? `Unit: ${unitCodeUpper}` : null,
        form.eta_minutes ? `ETA: ~${form.eta_minutes} min` : null,
        form.notes?.trim() ? `Field Report: ${form.notes.trim()}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const createdAdmission = await api.createAdmission({
        patient_id: createdPatient.patient_id,
        primary_diagnosis: primaryDiagnosis,
        acuity_level: form.acuity_level || 'ESI_3',
        notes: fullNotes || undefined,
      });

      // 4. Record Pre-Hospital Physiological Vitals if any were reported
      const hasVitals =
        (form.heart_rate_bpm !== '' && form.heart_rate_bpm !== null) ||
        (form.systolic_bp !== '' && form.systolic_bp !== null) ||
        (form.diastolic_bp !== '' && form.diastolic_bp !== null) ||
        (form.oxygen_saturation_pct !== '' && form.oxygen_saturation_pct !== null) ||
        (form.respiratory_rate !== '' && form.respiratory_rate !== null) ||
        (form.temperature_celsius !== '' && form.temperature_celsius !== null);

      if (hasVitals) {
        await api.recordObservation(createdAdmission.admission_id, {
          heart_rate_bpm: form.heart_rate_bpm ? Number(form.heart_rate_bpm) : null,
          systolic_bp: form.systolic_bp ? Number(form.systolic_bp) : null,
          diastolic_bp: form.diastolic_bp ? Number(form.diastolic_bp) : null,
          oxygen_saturation_pct: form.oxygen_saturation_pct ? Number(form.oxygen_saturation_pct) : null,
          respiratory_rate: form.respiratory_rate ? Number(form.respiratory_rate) : null,
          temperature_celsius: form.temperature_celsius ? Number(form.temperature_celsius) : null,
          notes: unitCodeUpper ? `Pre-hospital telemetry via EMS ${unitCodeUpper}` : 'Pre-hospital radio report',
        });
      }

      // 5. Set Success Banner with full details
      const patientDisplayName = `${createdPatient.first_name} ${createdPatient.last_name}`;
      setSuccessBanner({
        message: `Inbound EMS Call Logged: ${patientDisplayName} (ID: ${createdPatient.patient_id}) · Admission #${createdAdmission.admission_id} · ETA ~${form.eta_minutes} min.`,
        patientId: createdPatient.patient_id,
        patientName: patientDisplayName,
        admissionId: createdAdmission.admission_id,
      });

      // 6. Reset form immediately to default values for subsequent calls
      setForm(getEmptyEmsForm());
      setErrors({});

      // 7. Invoke parent callback
      if (onSuccess) {
        onSuccess({
          patient: createdPatient,
          admission: createdAdmission,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record inbound EMS intake.';
      setApiError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`space-y-6 ${isModal ? 'p-1' : 'p-6 bg-zinc-900/60 border border-zinc-800 rounded-xl'}`}>
      {/* Top Banner & Quick Autopopulate Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="text-xl">🚑</span>
            <h2 className="text-base font-semibold text-white tracking-normal">
              EMS Radio Call & Inbound Intake
            </h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Fill in arrival telemetry and radio report. Name and vitals are optional; arrival ETA is required.
          </p>
        </div>

        {/* Quick Autopopulate Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400 font-medium mr-1 hidden sm:inline">
            Unidentified Patient:
          </span>
          <button
            type="button"
            onClick={() => handleAutopopulateUnknown('MALE')}
            className="px-3 py-1.5 text-xs font-medium bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-200 border border-cyan-800/60 rounded-lg transition-all shadow-sm active:scale-95"
          >
            👤 Unknown Male
          </button>
          <button
            type="button"
            onClick={() => handleAutopopulateUnknown('FEMALE')}
            className="px-3 py-1.5 text-xs font-medium bg-purple-950/40 hover:bg-purple-900/50 text-purple-200 border border-purple-800/60 rounded-lg transition-all shadow-sm active:scale-95"
          >
            👤 Unknown Female
          </button>
          <button
            type="button"
            onClick={handleResetForm}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/60 rounded-lg transition-all active:scale-95"
          >
            ↺ Clear
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successBanner && (
        <div className="p-4 bg-emerald-950/70 border border-emerald-600/70 rounded-lg flex items-center justify-between text-xs text-emerald-200 animate-fadeIn shadow-sm">
          <div className="flex items-center space-x-3">
            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-emerald-900/80 text-emerald-300 font-bold text-sm">
              ✓
            </span>
            <div>
              <p className="font-semibold text-emerald-100 text-sm">
                Inbound EMS Call Logged Successfully!
              </p>
              <p className="text-xs text-emerald-300/90 mt-0.5">
                {successBanner.message} Form has been reset ready for the next incoming call.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-400 hover:text-emerald-200 text-xs px-2.5 py-1 rounded-md hover:bg-emerald-900/40 transition-colors"
          >
            Dismiss ✕
          </button>
        </div>
      )}

      {/* API Submission Error */}
      {apiError && (
        <div className="p-3.5 bg-red-950/70 border border-red-700/70 text-red-200 text-xs rounded-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-sm">⚠</span>
            <span>{apiError}</span>
          </div>
          <button
            type="button"
            onClick={() => setApiError(null)}
            className="text-red-400 hover:text-red-200 text-xs px-2 py-0.5 rounded-md hover:bg-red-900/40"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* SECTION 1: Patient Demographics (Optional) */}
        <div className="bg-zinc-950/50 p-4 sm:p-5 border border-zinc-800/80 rounded-xl space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-zinc-100">
                1. Patient Demographics
              </span>
              <span className="text-[11px] text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded-md">
                Optional
              </span>
            </div>
            <span className="text-xs text-zinc-400">
              Auto-assigns surrogate if unidentified
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5 text-xs">
            {/* First Name */}
            <div>
              <label htmlFor="first_name" className="block text-zinc-300 font-medium mb-1.5">
                First Name
              </label>
              <input
                id="first_name"
                type="text"
                value={form.first_name || ''}
                onChange={(e) => handleChange('first_name', e.target.value)}
                placeholder="e.g. John or Unknown"
                className="w-full bg-zinc-900 border border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 px-3 py-2 text-white rounded-lg outline-none transition-all placeholder-zinc-500"
              />
            </div>

            {/* Last Name */}
            <div>
              <label htmlFor="last_name" className="block text-zinc-300 font-medium mb-1.5">
                Last Name
              </label>
              <input
                id="last_name"
                type="text"
                value={form.last_name || ''}
                onChange={(e) => handleChange('last_name', e.target.value)}
                placeholder="e.g. Doe [EMS-xxxx]"
                className="w-full bg-zinc-900 border border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 px-3 py-2 text-white rounded-lg outline-none transition-all placeholder-zinc-500"
              />
            </div>

            {/* Age (0 - 125) */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="age" className="block text-zinc-300 font-medium mb-1.5">
                  Age (years)
                </label>
                <span className="text-[11px] text-zinc-400">0 - 125</span>
              </div>
              <input
                id="age"
                type="number"
                min="0"
                max="125"
                value={form.age !== undefined && form.age !== null ? form.age : ''}
                onChange={(e) => handleChange('age', e.target.value)}
                placeholder="e.g. 35"
                className={`w-full bg-zinc-900 border ${
                  errors.age ? 'border-red-500 bg-red-950/20 focus:ring-red-500/20' : 'border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                } px-3 py-2 text-white rounded-lg outline-none transition-all placeholder-zinc-500 font-mono`}
              />
              {errors.age && (
                <p className="text-[11px] text-red-400 mt-1 font-medium">{errors.age}</p>
              )}
            </div>

            {/* Gender */}
            <div>
              <label htmlFor="gender" className="block text-zinc-300 font-medium mb-1.5">
                Gender
              </label>
              <select
                id="gender"
                value={form.gender || 'OTHER'}
                onChange={(e) => handleChange('gender', e.target.value as 'MALE' | 'FEMALE' | 'OTHER')}
                className="w-full bg-zinc-900 border border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 px-3 py-2 text-white rounded-lg outline-none transition-all cursor-pointer"
              >
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Unknown / Other</option>
              </select>
            </div>
          </div>
        </div>

        {/* SECTION 2: Ambulance & Triage Dispatch (Compulsory ETA, Uppercase Ambulance Name) */}
        <div className="bg-zinc-950/50 p-4 sm:p-5 border border-zinc-800/80 rounded-xl space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-zinc-100">
                2. Ambulance & Triage Dispatch
              </span>
              <span className="text-[11px] text-red-300 bg-red-950/60 border border-red-800/60 px-2 py-0.5 rounded-md font-medium">
                ETA Required
              </span>
            </div>
            <span className="text-xs text-zinc-400">
              Bed assignment managed dynamically upon arrival
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 text-xs">
            {/* Unit / Ambulance Company (Always Uppercase) */}
            <div>
              <label htmlFor="unit_code" className="block text-zinc-300 font-medium mb-1.5">
                Ambulance / Company Name
              </label>
              <input
                id="unit_code"
                type="text"
                value={form.unit_code || ''}
                onChange={(e) => handleChange('unit_code', e.target.value)}
                placeholder="e.g. MEDIC 14, LIFEFLIGHT 2, AMR"
                className="w-full bg-zinc-900 border border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 px-3 py-2 text-white rounded-lg outline-none uppercase font-mono tracking-wider transition-all placeholder-zinc-500"
              />
            </div>

            {/* Ambulance ETA (Compulsory: 0 - 180 min) */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="eta_minutes" className="block text-zinc-300 font-medium mb-1.5">
                  Arrival ETA (minutes) <span className="text-red-400 font-bold">*</span>
                </label>
                <span className="text-[11px] text-zinc-400">0 - 180 min</span>
              </div>
              <input
                id="eta_minutes"
                type="number"
                min="0"
                max="180"
                value={form.eta_minutes !== undefined && form.eta_minutes !== null ? form.eta_minutes : ''}
                onChange={(e) => handleChange('eta_minutes', e.target.value)}
                placeholder="e.g. 10"
                className={`w-full bg-zinc-900 border ${
                  errors.eta_minutes
                    ? 'border-red-500 bg-red-950/20 focus:ring-red-500/20'
                    : 'border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                } px-3 py-2 text-white rounded-lg outline-none transition-all placeholder-zinc-500 font-mono`}
              />
              {errors.eta_minutes && (
                <p className="text-[11px] text-red-400 mt-1 font-medium">{errors.eta_minutes}</p>
              )}
            </div>

            {/* Acuity Level (ESI 1 to 5) */}
            <div>
              <label htmlFor="acuity_level" className="block text-zinc-300 font-medium mb-1.5">
                Triage Acuity
              </label>
              <select
                id="acuity_level"
                value={form.acuity_level || 'ESI_3'}
                onChange={(e) => handleChange('acuity_level', e.target.value as AcuityLevel)}
                className="w-full bg-zinc-900 border border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 px-3 py-2 text-white rounded-lg outline-none transition-all cursor-pointer"
              >
                <option value="ESI_1">ESI 1 - Resuscitation / Immediate</option>
                <option value="ESI_2">ESI 2 - Emergent / High Risk</option>
                <option value="ESI_3">ESI 3 - Urgent</option>
                <option value="ESI_4">ESI 4 - Less Urgent</option>
                <option value="ESI_5">ESI 5 - Non-Urgent</option>
              </select>
            </div>
          </div>
        </div>

        {/* SECTION 3: Pre-Hospital Telemetry / Vitals (Optional, Clean Header with No Badge/Logo) */}
        <div className="bg-zinc-950/50 p-4 sm:p-5 border border-zinc-800/80 rounded-xl space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-semibold text-zinc-100">
                  3. Pre-Hospital Telemetry & Vitals
                </span>
                <span className="text-[11px] text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded-md">
                  Optional
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Input vitals relayed by radio or leave empty to chart when the patient physically arrives.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3.5 text-xs">
            {/* Heart Rate */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="heart_rate_bpm" className="block text-zinc-300 font-medium mb-1.5">
                  Heart Rate
                </label>
                <span className="text-[10px] text-zinc-400">
                  {PHYSIOLOGICAL_CONSTRAINTS.heart_rate_bpm.min}-{PHYSIOLOGICAL_CONSTRAINTS.heart_rate_bpm.max}
                </span>
              </div>
              <div className="relative">
                <input
                  id="heart_rate_bpm"
                  type="number"
                  min={PHYSIOLOGICAL_CONSTRAINTS.heart_rate_bpm.min}
                  max={PHYSIOLOGICAL_CONSTRAINTS.heart_rate_bpm.max}
                  value={form.heart_rate_bpm !== undefined && form.heart_rate_bpm !== null ? form.heart_rate_bpm : ''}
                  onChange={(e) => handleChange('heart_rate_bpm', e.target.value)}
                  placeholder="e.g. 78"
                  className={`w-full bg-zinc-900 border ${
                    errors.heart_rate_bpm ? 'border-red-500 bg-red-950/20' : 'border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                  } px-3 py-2 pr-9 text-white rounded-lg outline-none font-mono transition-all`}
                />
                <span className="absolute right-2.5 top-2 text-[10px] text-zinc-400 font-mono pointer-events-none">
                  bpm
                </span>
              </div>
              {errors.heart_rate_bpm && (
                <p className="text-[10px] text-red-400 mt-1 font-medium leading-tight">{errors.heart_rate_bpm}</p>
              )}
            </div>

            {/* Systolic BP */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="systolic_bp" className="block text-zinc-300 font-medium mb-1.5">
                  Systolic BP
                </label>
                <span className="text-[10px] text-zinc-400">
                  {PHYSIOLOGICAL_CONSTRAINTS.systolic_bp.min}-{PHYSIOLOGICAL_CONSTRAINTS.systolic_bp.max}
                </span>
              </div>
              <div className="relative">
                <input
                  id="systolic_bp"
                  type="number"
                  min={PHYSIOLOGICAL_CONSTRAINTS.systolic_bp.min}
                  max={PHYSIOLOGICAL_CONSTRAINTS.systolic_bp.max}
                  value={form.systolic_bp !== undefined && form.systolic_bp !== null ? form.systolic_bp : ''}
                  onChange={(e) => handleChange('systolic_bp', e.target.value)}
                  placeholder="e.g. 120"
                  className={`w-full bg-zinc-900 border ${
                    errors.systolic_bp ? 'border-red-500 bg-red-950/20' : 'border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                  } px-3 py-2 pr-11 text-white rounded-lg outline-none font-mono transition-all`}
                />
                <span className="absolute right-2.5 top-2 text-[10px] text-zinc-400 font-mono pointer-events-none">
                  mmHg
                </span>
              </div>
              {errors.systolic_bp && (
                <p className="text-[10px] text-red-400 mt-1 font-medium leading-tight">{errors.systolic_bp}</p>
              )}
            </div>

            {/* Diastolic BP */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="diastolic_bp" className="block text-zinc-300 font-medium mb-1.5">
                  Diastolic BP
                </label>
                <span className="text-[10px] text-zinc-400">
                  {PHYSIOLOGICAL_CONSTRAINTS.diastolic_bp.min}-{PHYSIOLOGICAL_CONSTRAINTS.diastolic_bp.max}
                </span>
              </div>
              <div className="relative">
                <input
                  id="diastolic_bp"
                  type="number"
                  min={PHYSIOLOGICAL_CONSTRAINTS.diastolic_bp.min}
                  max={PHYSIOLOGICAL_CONSTRAINTS.diastolic_bp.max}
                  value={form.diastolic_bp !== undefined && form.diastolic_bp !== null ? form.diastolic_bp : ''}
                  onChange={(e) => handleChange('diastolic_bp', e.target.value)}
                  placeholder="e.g. 80"
                  className={`w-full bg-zinc-900 border ${
                    errors.diastolic_bp ? 'border-red-500 bg-red-950/20' : 'border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                  } px-3 py-2 pr-11 text-white rounded-lg outline-none font-mono transition-all`}
                />
                <span className="absolute right-2.5 top-2 text-[10px] text-zinc-400 font-mono pointer-events-none">
                  mmHg
                </span>
              </div>
              {errors.diastolic_bp && (
                <p className="text-[10px] text-red-400 mt-1 font-medium leading-tight">{errors.diastolic_bp}</p>
              )}
            </div>

            {/* Oxygen Saturation SpO2 */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="oxygen_saturation_pct" className="block text-zinc-300 font-medium mb-1.5">
                  SpO2 (%)
                </label>
                <span className="text-[10px] text-zinc-400">
                  {PHYSIOLOGICAL_CONSTRAINTS.oxygen_saturation_pct.min}-100%
                </span>
              </div>
              <div className="relative">
                <input
                  id="oxygen_saturation_pct"
                  type="number"
                  min={PHYSIOLOGICAL_CONSTRAINTS.oxygen_saturation_pct.min}
                  max={PHYSIOLOGICAL_CONSTRAINTS.oxygen_saturation_pct.max}
                  value={form.oxygen_saturation_pct !== undefined && form.oxygen_saturation_pct !== null ? form.oxygen_saturation_pct : ''}
                  onChange={(e) => handleChange('oxygen_saturation_pct', e.target.value)}
                  placeholder="e.g. 98"
                  className={`w-full bg-zinc-900 border ${
                    errors.oxygen_saturation_pct ? 'border-red-500 bg-red-950/20' : 'border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                  } px-3 py-2 pr-6 text-white rounded-lg outline-none font-mono transition-all`}
                />
                <span className="absolute right-2.5 top-2 text-[10px] text-zinc-400 font-mono pointer-events-none">
                  %
                </span>
              </div>
              {errors.oxygen_saturation_pct && (
                <p className="text-[10px] text-red-400 mt-1 font-medium leading-tight">{errors.oxygen_saturation_pct}</p>
              )}
            </div>

            {/* Respiratory Rate */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="respiratory_rate" className="block text-zinc-300 font-medium mb-1.5">
                  Resp Rate
                </label>
                <span className="text-[10px] text-zinc-400">
                  {PHYSIOLOGICAL_CONSTRAINTS.respiratory_rate.min}-{PHYSIOLOGICAL_CONSTRAINTS.respiratory_rate.max}
                </span>
              </div>
              <div className="relative">
                <input
                  id="respiratory_rate"
                  type="number"
                  min={PHYSIOLOGICAL_CONSTRAINTS.respiratory_rate.min}
                  max={PHYSIOLOGICAL_CONSTRAINTS.respiratory_rate.max}
                  value={form.respiratory_rate !== undefined && form.respiratory_rate !== null ? form.respiratory_rate : ''}
                  onChange={(e) => handleChange('respiratory_rate', e.target.value)}
                  placeholder="e.g. 16"
                  className={`w-full bg-zinc-900 border ${
                    errors.respiratory_rate ? 'border-red-500 bg-red-950/20' : 'border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                  } px-3 py-2 pr-8 text-white rounded-lg outline-none font-mono transition-all`}
                />
                <span className="absolute right-2.5 top-2 text-[10px] text-zinc-400 font-mono pointer-events-none">
                  /min
                </span>
              </div>
              {errors.respiratory_rate && (
                <p className="text-[10px] text-red-400 mt-1 font-medium leading-tight">{errors.respiratory_rate}</p>
              )}
            </div>

            {/* Temperature */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="temperature_celsius" className="block text-zinc-300 font-medium mb-1.5">
                  Temp (°C)
                </label>
                <span className="text-[10px] text-zinc-400">30.0-43.0</span>
              </div>
              <div className="relative">
                <input
                  id="temperature_celsius"
                  type="number"
                  step="0.1"
                  min={PHYSIOLOGICAL_CONSTRAINTS.temperature_celsius.min}
                  max={PHYSIOLOGICAL_CONSTRAINTS.temperature_celsius.max}
                  value={form.temperature_celsius !== undefined && form.temperature_celsius !== null ? form.temperature_celsius : ''}
                  onChange={(e) => handleChange('temperature_celsius', e.target.value)}
                  placeholder="e.g. 37.0"
                  className={`w-full bg-zinc-900 border ${
                    errors.temperature_celsius ? 'border-red-500 bg-red-950/20' : 'border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                  } px-3 py-2 pr-7 text-white rounded-lg outline-none font-mono transition-all`}
                />
                <span className="absolute right-2.5 top-2 text-[10px] text-zinc-400 font-mono pointer-events-none">
                  °C
                </span>
              </div>
              {errors.temperature_celsius && (
                <p className="text-[10px] text-red-400 mt-1 font-medium leading-tight">{errors.temperature_celsius}</p>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 4: Clinical Report & Field Notes (Optional) */}
        <div className="bg-zinc-950/50 p-4 sm:p-5 border border-zinc-800/80 rounded-xl space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-zinc-100">
                4. Clinical Report & Field Notes
              </span>
              <span className="text-[11px] text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded-md">
                Optional
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div>
              <label htmlFor="primary_diagnosis" className="block text-zinc-300 font-medium mb-1.5">
                Chief Complaint / Suspected Condition
              </label>
              <input
                id="primary_diagnosis"
                type="text"
                value={form.primary_diagnosis || ''}
                onChange={(e) => handleChange('primary_diagnosis', e.target.value)}
                placeholder="e.g. Chest pain, MVA Trauma, Stroke alert, Acute dyspnea"
                className="w-full bg-zinc-900 border border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 px-3 py-2 text-white rounded-lg outline-none transition-all placeholder-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="notes" className="block text-zinc-300 font-medium mb-1.5">
                Field Interventions & En Route Details
              </label>
              <input
                id="notes"
                type="text"
                value={form.notes || ''}
                onChange={(e) => handleChange('notes', e.target.value)}
                placeholder="e.g. GCS 14, 18G left AC, 1000mL Saline, 4L O2 via nasal cannula"
                className="w-full bg-zinc-900 border border-zinc-700/80 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 px-3 py-2 text-white rounded-lg outline-none transition-all placeholder-zinc-500"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
          <p className="text-xs text-zinc-400">
            Upon submission, the inbound patient is logged and the form automatically resets to default for the next call.
          </p>

          <div className="flex items-center space-x-3 w-full sm:w-auto">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 sm:flex-initial px-4 py-2.5 border border-zinc-700/80 hover:border-zinc-500 text-zinc-300 hover:text-white text-xs font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 sm:flex-initial px-6 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-semibold text-xs tracking-wide rounded-lg transition-all shadow-md shadow-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 active:scale-98"
            >
              <span>{isSubmitting ? 'Logging Inbound Intake...' : 'Submit EMS Inbound Intake'}</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
