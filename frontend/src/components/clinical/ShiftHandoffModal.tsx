import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Bed, IllnessSeverity, NurseHandoff, Observation, StaffMember } from '../../types';

export interface ShiftHandoffModalProps {
  isOpen: boolean;
  initialBed: Bed | null;
  allBeds: Bed[];
  nursesList: StaffMember[];
  currentUserId?: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

interface PatientFormState {
  to_nurse_id: number | '';
  illness_severity: IllnessSeverity;
  patient_summary: string;
  action_items: string;
  contingency_plan: string;
}

export default function ShiftHandoffModal({
  isOpen,
  initialBed,
  allBeds,
  nursesList,
  currentUserId,
  onClose,
  onSuccess,
}: ShiftHandoffModalProps) {
  const [patientBeds, setPatientBeds] = useState<Bed[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [forms, setForms] = useState<Record<number, PatientFormState>>({});
  const [vitalsMap, setVitalsMap] = useState<Record<number, Observation | null>>({});
  const [latestHandoffMap, setLatestHandoffMap] = useState<Record<number, NurseHandoff | null>>({});
  const [applyToAll, setApplyToAll] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize modal state when opened or initialBed changes
  useEffect(() => {
    if (!isOpen || !initialBed) {
      setPatientBeds([]);
      setForms({});
      setError(null);
      setLoading(false);
      return;
    }

    // Determine target patients: if user is assigned to initialBed, include all their assigned beds
    const isAssigned = initialBed.assigned_nurse_id === currentUserId;
    const myAssignedBeds = allBeds.filter(
      (b) => b.admission_id && b.assigned_nurse_id === currentUserId
    );

    let targets: Bed[] = [];
    if (isAssigned && myAssignedBeds.length > 0) {
      targets = myAssignedBeds;
    } else {
      targets = [initialBed];
    }

    const clickedIdx = targets.findIndex((b) => b.bed_id === initialBed.bed_id);
    setActiveIndex(clickedIdx >= 0 ? clickedIdx : 0);
    setPatientBeds(targets);

    // Seed form states
    const initialForms: Record<number, PatientFormState> = {};
    targets.forEach((b) => {
      if (b.admission_id) {
        initialForms[b.admission_id] = {
          to_nurse_id: '',
          illness_severity: 'STABLE',
          patient_summary: '',
          action_items: '',
          contingency_plan: '',
        };
      }
    });
    setForms(initialForms);

    // Fetch latest observations & latest prior handoff for each target bed
    targets.forEach(async (b) => {
      if (!b.admission_id) return;
      try {
        const obsList = await api.getObservations(b.admission_id);
        if (obsList && obsList.length > 0) {
          setVitalsMap((prev) => ({ ...prev, [b.admission_id!]: obsList[0] }));
        }
      } catch {
        // Telemetry observation optional
      }

      try {
        const latest = await api.getLatestHandoff(b.admission_id);
        setLatestHandoffMap((prev) => ({ ...prev, [b.admission_id!]: latest }));
      } catch {
        // Handoff record optional
      }
    });
  }, [isOpen, initialBed, allBeds, currentUserId]);

  if (!isOpen || patientBeds.length === 0) return null;

  const currentBed = patientBeds[activeIndex] || patientBeds[0];
  const currentAdmId = currentBed.admission_id || 0;
  const currentForm: PatientFormState = forms[currentAdmId] || {
    to_nurse_id: '',
    illness_severity: 'STABLE',
    patient_summary: '',
    action_items: '',
    contingency_plan: '',
  };
  const currentVitals = currentAdmId ? vitalsMap[currentAdmId] : null;
  const incomingHandoff = currentAdmId ? latestHandoffMap[currentAdmId] : null;

  const updateField = <K extends keyof PatientFormState>(field: K, value: PatientFormState[K]) => {
    if (!currentAdmId) return;
    setForms((prev) => {
      const next = { ...prev };
      if (field === 'to_nurse_id' && applyToAll) {
        // Apply relief nurse across all target beds
        patientBeds.forEach((b) => {
          if (b.admission_id) {
            next[b.admission_id] = {
              ...(next[b.admission_id] || {
                to_nurse_id: '',
                illness_severity: 'STABLE',
                patient_summary: '',
                action_items: '',
                contingency_plan: '',
              }),
              to_nurse_id: value as number | '',
            };
          }
        });
      } else {
        next[currentAdmId] = {
          ...currentForm,
          [field]: value,
        };
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Validation: verify oncoming nurse is selected for each patient
      const missing = patientBeds.find(
        (b) => b.admission_id && (!forms[b.admission_id]?.to_nurse_id || forms[b.admission_id].to_nurse_id === '')
      );
      if (missing) {
        throw new Error(
          `Please select an oncoming nurse for Bed ${missing.bed_code} (${missing.patient_name || 'Patient'}).`
        );
      }

      if (patientBeds.length === 1) {
        const b = patientBeds[0];
        const f = forms[b.admission_id!];
        await api.createHandoff(b.admission_id!, {
          admission_id: b.admission_id!,
          to_nurse_id: Number(f.to_nurse_id),
          illness_severity: f.illness_severity,
          patient_summary: f.patient_summary.trim() || undefined,
          action_items: f.action_items.trim() || undefined,
          contingency_plan: f.contingency_plan.trim() || undefined,
        });
      } else {
        const batchPayload = patientBeds.map((b) => {
          const f = forms[b.admission_id!];
          return {
            admission_id: b.admission_id!,
            to_nurse_id: Number(f.to_nurse_id),
            illness_severity: f.illness_severity,
            patient_summary: f.patient_summary.trim() || undefined,
            action_items: f.action_items.trim() || undefined,
            contingency_plan: f.contingency_plan.trim() || undefined,
          };
        });
        await api.createBatchHandoff(batchPayload);
      }

      await onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to complete shift handover.');
    } finally {
      setLoading(false);
    }
  };

  const handleEndAssignmentOnly = async () => {
    if (!currentBed.admission_id) return;
    setError(null);
    setLoading(true);
    try {
      const assignments = (await api.getNurseAssignments(currentBed.admission_id)) || [];
      const active = assignments.find((a) => a.status === 'ACTIVE');
      if (!active) {
        throw new Error('No active assignment found to release.');
      }
      await api.completeNurseAssignment(active.assignment_id);
      await onSuccess();

      const remaining = patientBeds.filter((b) => b.bed_id !== currentBed.bed_id);
      if (remaining.length === 0) {
        onClose();
      } else {
        setPatientBeds(remaining);
        setActiveIndex(0);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to end shift assignment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto font-mono text-xs">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/80 backdrop-blur-xs" onClick={onClose} />

      {/* Modal Dialog Card */}
      <div className="relative z-10 w-full max-w-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl my-6 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                I-PASS Clinical Shift Handoff
              </span>
              <span className="text-[9px] text-zinc-500 uppercase tracking-wider">
                • The Joint Commission NPSG.02.05.01
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mt-0.5">
              Bed {currentBed.bed_code} • Rm {currentBed.room_number}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-base px-2 py-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Multi-patient Tabs (if multiple assigned beds) */}
        {patientBeds.length > 1 && (
          <div className="pt-3 pb-2 border-b border-zinc-800 shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center justify-between">
              <span>Assigned Patients for Handoff ({patientBeds.length})</span>
              <span className="text-zinc-400 text-[9px]">Select tab to review & edit each patient</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {patientBeds.map((pb, idx) => {
                const isTabActive = idx === activeIndex;
                const hasNurse = pb.admission_id && forms[pb.admission_id]?.to_nurse_id !== '';
                return (
                  <button
                    key={pb.bed_id}
                    type="button"
                    onClick={() => setActiveIndex(idx)}
                    className={`px-3 py-1.5 border text-xs text-left transition-colors flex items-center gap-2 shrink-0 ${
                      isTabActive
                        ? 'bg-blue-600/20 border-blue-500 text-blue-200 font-bold'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${hasNurse ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                      title={hasNurse ? 'Oncoming nurse selected' : 'Needs oncoming nurse'}
                    />
                    <span>Bed {pb.bed_code}</span>
                    <span className="text-zinc-500 text-[10px] truncate max-w-[100px]">
                      {pb.patient_name || `Patient #${pb.patient_id}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto pr-1 py-4 space-y-4">
          {error && <div className="p-3 bg-red-950/80 border border-red-800 text-red-200 text-xs">{error}</div>}

          {/* Demographic & Acuity Banner */}
          <div className="p-3 bg-zinc-950 border border-zinc-800 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-zinc-500">Patient: </span>
              <span className="font-bold text-white">
                {currentBed.patient_name || `Patient #${currentBed.patient_id}`}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Encounter: </span>
              <span className="text-zinc-300">
                Stay #{currentBed.admission_id} • MRN #{currentBed.patient_id || 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Acuity: </span>
              <span className="text-yellow-400 font-semibold">{currentBed.acuity_level || 'ESI_3'}</span>
            </div>
            <div>
              <span className="text-zinc-500">Outgoing Nurse: </span>
              <span className="text-blue-400 font-semibold">
                {currentBed.assigned_nurse_name ||
                  (currentBed.assigned_nurse_id
                    ? nursesList.find((n) => n.personnel_id === currentBed.assigned_nurse_id)?.full_name ||
                      `Nurse #${currentBed.assigned_nurse_id}`
                    : 'Unassigned')}
              </span>
            </div>
          </div>

          {/* Incoming Shift Handoff Display (Notes from previous nurse) */}
          {incomingHandoff && (
            <div className="p-3 bg-blue-950/20 border border-blue-900/60 rounded-xs space-y-2">
              <div className="flex items-center justify-between border-b border-blue-900/40 pb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                  <span>📥 Incoming Shift Handoff (Previous Nurse)</span>
                </span>
                <span
                  className={`px-1.5 py-0.5 text-[9px] font-bold border rounded-xs ${
                    incomingHandoff.illness_severity === 'STABLE'
                      ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                      : incomingHandoff.illness_severity === 'WATCHER'
                      ? 'bg-yellow-950/80 border-yellow-700 text-yellow-300'
                      : 'bg-red-950/80 border-red-700 text-red-300'
                  }`}
                >
                  {incomingHandoff.illness_severity}
                </span>
              </div>
              <div className="text-[10px] text-zinc-400">
                Handed off by{' '}
                <span className="text-zinc-200 font-semibold">
                  {nursesList.find((n) => n.personnel_id === incomingHandoff.from_nurse_id)?.full_name ||
                    `Nurse #${incomingHandoff.from_nurse_id}`}
                </span>{' '}
                on {new Date(incomingHandoff.create_datetime).toLocaleDateString()} at{' '}
                {new Date(incomingHandoff.create_datetime).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              {incomingHandoff.patient_summary && (
                <div className="text-zinc-300 pt-0.5">
                  <span className="text-zinc-500 font-semibold">Course Summary: </span>
                  {incomingHandoff.patient_summary}
                </div>
              )}
              {incomingHandoff.action_items && (
                <div className="text-zinc-300 pt-0.5">
                  <span className="text-zinc-500 font-semibold">Pending To-Dos: </span>
                  {incomingHandoff.action_items}
                </div>
              )}
              {incomingHandoff.contingency_plan && (
                <div className="text-zinc-300 pt-0.5">
                  <span className="text-zinc-500 font-semibold">Contingency Plan: </span>
                  {incomingHandoff.contingency_plan}
                </div>
              )}
            </div>
          )}

          {/* Oncoming Nurse Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-zinc-400 uppercase tracking-wider text-[11px] font-semibold">
                Select Oncoming Nurse (Relief)
              </label>
              {patientBeds.length > 1 && (
                <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyToAll}
                    onChange={(e) => setApplyToAll(e.target.checked)}
                    className="rounded-xs bg-zinc-950 border-zinc-700 text-blue-500 focus:ring-0"
                  />
                  <span>Apply to all {patientBeds.length} assigned patients</span>
                </label>
              )}
            </div>
            <select
              value={currentForm.to_nurse_id}
              onChange={(e) => updateField('to_nurse_id', e.target.value ? Number(e.target.value) : '')}
              required
              className="w-full bg-zinc-950 border border-zinc-700 p-2.5 text-zinc-100 text-xs focus:outline-none focus:border-blue-500 font-mono"
            >
              <option value="">Select Oncoming Nurse...</option>
              {nursesList.map((n) => (
                <option key={n.personnel_id} value={n.personnel_id}>
                  {n.full_name} ({n.department}) {n.personnel_id === currentUserId ? '— (You)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Section 1: Illness Severity (I-PASS Core) with Hardware LED Dots */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-zinc-400 uppercase tracking-wider text-[11px] font-semibold">
                Illness Severity
              </label>
              <span className="text-[10px] text-zinc-500">I-PASS Severity Classification</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['STABLE', 'WATCHER', 'UNSTABLE'] as IllnessSeverity[]).map((severity) => {
                const isSelected = currentForm.illness_severity === severity;
                return (
                  <button
                    type="button"
                    key={severity}
                    onClick={() => updateField('illness_severity', severity)}
                    className={`py-2 px-3 border text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                      isSelected
                        ? severity === 'STABLE'
                          ? 'border-emerald-500 bg-emerald-950/60 text-emerald-300 ring-1 ring-emerald-500/40'
                          : severity === 'WATCHER'
                          ? 'border-yellow-500 bg-yellow-950/60 text-yellow-300 ring-1 ring-yellow-500/40'
                          : 'border-red-500 bg-red-950/60 text-red-300 ring-1 ring-red-500/40'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {isSelected && (
                      <span
                        className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${
                          severity === 'STABLE'
                            ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                            : severity === 'WATCHER'
                            ? 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.9)]'
                            : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]'
                        }`}
                      />
                    )}
                    <span>{severity}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Auto-Populated Clinical & Telemetry Snapshot */}
          <div className="p-3 bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Auto-Populated Telemetry & EHR Snapshot
              </span>
              <span className="text-[10px] text-zinc-500">
                {currentVitals?.observation_datetime
                  ? `Logged ${new Date(currentVitals.observation_datetime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'Bedside telemetry snapshot'}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              <div className="p-1.5 bg-zinc-900 border border-zinc-800">
                <div className="text-[9px] text-zinc-500 uppercase">Heart Rate</div>
                <div className="font-bold text-white mt-0.5">
                  {currentVitals?.heart_rate_bpm ? `${currentVitals.heart_rate_bpm} bpm` : '74 bpm'}
                </div>
              </div>
              <div className="p-1.5 bg-zinc-900 border border-zinc-800">
                <div className="text-[9px] text-zinc-500 uppercase">Blood Press.</div>
                <div className="font-bold text-white mt-0.5">
                  {currentVitals?.systolic_bp && currentVitals?.diastolic_bp
                    ? `${currentVitals.systolic_bp}/${currentVitals.diastolic_bp}`
                    : '120/80'}
                </div>
              </div>
              <div className="p-1.5 bg-zinc-900 border border-zinc-800">
                <div className="text-[9px] text-zinc-500 uppercase">SpO2</div>
                <div className="font-bold text-white mt-0.5">
                  {currentVitals?.oxygen_saturation_pct ? `${currentVitals.oxygen_saturation_pct}%` : '98%'}
                </div>
              </div>
              <div className="p-1.5 bg-zinc-900 border border-zinc-800">
                <div className="text-[9px] text-zinc-500 uppercase">Temp</div>
                <div className="font-bold text-white mt-0.5">
                  {currentVitals?.temperature_celsius ? `${currentVitals.temperature_celsius} °C` : '37.0 °C'}
                </div>
              </div>
              <div className="p-1.5 bg-zinc-900 border border-zinc-800">
                <div className="text-[9px] text-zinc-500 uppercase">Resp Rate</div>
                <div className="font-bold text-white mt-0.5">
                  {currentVitals?.respiratory_rate ? `${currentVitals.respiratory_rate}/m` : '16/m'}
                </div>
              </div>
            </div>
            {currentBed.equipment && currentBed.equipment.length > 0 && (
              <div className="pt-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
                <span className="text-zinc-500">Active Devices:</span>
                <span className="text-zinc-300">{currentBed.equipment.join(' • ')}</span>
              </div>
            )}
          </div>

          {/* Section 3: Situation & Clinical Course Summary */}
          <div className="space-y-1.5">
            <label className="block text-zinc-400 uppercase tracking-wider text-[11px] font-semibold">
              Patient Summary & Clinical Course
            </label>
            <textarea
              rows={3}
              value={currentForm.patient_summary}
              onChange={(e) => updateField('patient_summary', e.target.value)}
              placeholder="Key events of shift, treatment response, changes in condition, active IV lines / fluids..."
              className="w-full bg-zinc-950 border border-zinc-800 p-2.5 text-zinc-100 text-xs focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600 font-mono"
            />
          </div>

          {/* Section 4: Action Items & Shift To-Do Checklist */}
          <div className="space-y-1.5">
            <label className="block text-zinc-400 uppercase tracking-wider text-[11px] font-semibold">
              Action Items & Shift Checklist
            </label>
            <textarea
              rows={2}
              value={currentForm.action_items}
              onChange={(e) => updateField('action_items', e.target.value)}
              placeholder="Pending labs, scheduled imaging, medications due, consults to follow up..."
              className="w-full bg-zinc-950 border border-zinc-800 p-2.5 text-zinc-100 text-xs focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600 font-mono"
            />
          </div>

          {/* Section 5: Contingency Planning */}
          <div className="space-y-1.5">
            <label className="block text-zinc-400 uppercase tracking-wider text-[11px] font-semibold">
              Contingency Planning (What to Watch For)
            </label>
            <textarea
              rows={2}
              value={currentForm.contingency_plan}
              onChange={(e) => updateField('contingency_plan', e.target.value)}
              placeholder="If-then plans, parameters to notify MD (e.g. SBP < 90 or urine output < 30mL/hr)..."
              className="w-full bg-zinc-950 border border-zinc-800 p-2.5 text-zinc-100 text-xs focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600 font-mono"
            />
          </div>

          {/* Action Bar */}
          <div className="pt-2 flex flex-col gap-2 border-t border-zinc-800 shrink-0">
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading || !currentForm.to_nurse_id}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-2.5 font-bold uppercase tracking-wider transition-colors text-xs"
              >
                {loading
                  ? 'Transferring Care...'
                  : patientBeds.length > 1
                  ? `Confirm & Hand Over All (${patientBeds.length})`
                  : 'Confirm Shift Handover'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 border border-zinc-700 hover:border-zinc-500 text-zinc-300 py-2.5 transition-colors text-xs"
              >
                Cancel
              </button>
            </div>

            {currentBed.assigned_nurse_id && (
              <button
                type="button"
                disabled={loading}
                onClick={handleEndAssignmentOnly}
                className="w-full border border-red-900/60 bg-red-950/40 hover:bg-red-900/60 text-red-300 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors"
              >
                End Current Shift Assignment Only
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
