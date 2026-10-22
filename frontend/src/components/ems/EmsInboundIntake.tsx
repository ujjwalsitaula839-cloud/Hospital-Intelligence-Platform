import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import type { Bed, AcuityLevel } from '../../types';

interface InboundAmbulance {
  id: string;
  unitCode: string;
  agency: string;
  patientName: string;
  age: number;
  gender: 'MALE' | 'FEMALE';
  esi: AcuityLevel;
  complaint: string;
  etaMinutes: number;
  vitals: {
    bp: string;
    hr: number;
    spo2: number;
  };
}

const INITIAL_RUNS: InboundAmbulance[] = [
  {
    id: 'run-101',
    unitCode: 'Medic 12',
    agency: 'Metro Region EMS',
    patientName: 'Arthur Morgan',
    age: 48,
    gender: 'MALE',
    esi: 'ESI_1',
    complaint: 'Acute Subclavian Trauma & Respiratory Distress',
    etaMinutes: 3,
    vitals: { bp: '85/55', hr: 132, spo2: 89 },
  },
  {
    id: 'run-102',
    unitCode: 'Rescue 04',
    agency: 'Metro Fire Rescue',
    patientName: 'Elena Rostova',
    age: 62,
    gender: 'FEMALE',
    esi: 'ESI_2',
    complaint: 'Anterior ST-Elevation Myocardial Infarction',
    etaMinutes: 7,
    vitals: { bp: '158/98', hr: 96, spo2: 94 },
  },
  {
    id: 'run-103',
    unitCode: 'Ambulance 09',
    agency: 'Riverside EMS',
    patientName: 'Marcus Bell',
    age: 34,
    gender: 'MALE',
    esi: 'ESI_3',
    complaint: 'Closed Left Tibia-Fibula Fracture',
    etaMinutes: 14,
    vitals: { bp: '124/82', hr: 84, spo2: 99 },
  },
];

interface EmsInboundIntakeProps {
  availableBeds: Bed[];
  onAdmissionComplete: (bedCode: string) => void;
}

export default function EmsInboundIntake({ availableBeds, onAdmissionComplete }: EmsInboundIntakeProps): React.ReactElement {
  const [runs, setRuns] = useState<InboundAmbulance[]>(INITIAL_RUNS);
  const [selectedRun, setSelectedRun] = useState<InboundAmbulance | null>(runs[0] || null);
  const [targetBedCode, setTargetBedCode] = useState<string>('');
  const [processing, setProcessing] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-select first available bed if targetBedCode is empty
  useEffect(() => {
    if (availableBeds.length > 0 && !targetBedCode) {
      setTargetBedCode(availableBeds[0].bed_code);
    }
  }, [availableBeds, targetBedCode]);

  const handleIntakeToBed = async (run: InboundAmbulance) => {
    if (!targetBedCode) {
      setStatusMsg({ type: 'error', text: 'Please select an available target bed for admission.' });
      return;
    }

    setProcessing(true);
    setStatusMsg(null);

    try {
      // 1. Fetch patients or register patient encounter
      const allPatients = await api.getPatients();
      const matched = allPatients.find(
        (p) => `${p.first_name} ${p.last_name}`.toLowerCase() === run.patientName.toLowerCase()
      );
      let patientId: number;

      if (matched) {
        patientId = matched.patient_id;
      } else {
        // Register patient directly into patient-service
        const [firstName, ...lastNames] = run.patientName.split(' ');
        const created = await api.registerPatient({
          first_name: firstName || 'EMS',
          last_name: lastNames.join(' ') || 'Patient',
          date_of_birth: '1985-05-15',
          gender: run.gender,
        });
        patientId = created.patient_id;
      }

      // 2. Initialize Admission in patient-service
      let admissionId: number | undefined;
      try {
        const adm = await api.createAdmission({
          patient_id: patientId,
          acuity_level: run.esi,
          primary_diagnosis: run.complaint,
          notes: `EMS Inbound Intake via ${run.unitCode} (${run.agency}) - BP: ${run.vitals.bp}, HR: ${run.vitals.hr}, SpO2: ${run.vitals.spo2}%`,
        });
        admissionId = adm.admission_id || adm.encounter_id;
      } catch (admErr: unknown) {
        // If patient already has active admission, fetch it
        const activeList = await api.getAdmissions(patientId);
        if (activeList && activeList.length > 0) {
          admissionId = activeList[0].admission_id || activeList[0].encounter_id;
        } else {
          throw admErr;
        }
      }

      // 3. Admit patient directly into target bed (transitions status to OCCUPIED)
      await api.updateBedStatus(targetBedCode, 'OCCUPIED', {
        admission_id: admissionId,
        patient_id: patientId,
      });

      // 4. Remove intake from inbound feed
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
      setSelectedRun(null);

      setStatusMsg({
        type: 'success',
        text: `✓ Patient ${run.patientName} admitted to Bed ${targetBedCode} with status OCCUPIED!`,
      });

      onAdmissionComplete(targetBedCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to intake patient to bed.';
      setStatusMsg({ type: 'error', text: msg });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-sm overflow-hidden flex flex-col font-mono text-xs">
      {/* Header */}
      <div className="p-4 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Regional EMS Inbound Radar & Triage Intake
          </h2>
        </div>
        <div className="text-[11px] text-zinc-400 bg-zinc-950 px-2.5 py-1 border border-zinc-800 rounded-xs">
          Live Ambulances Inbound: <strong className="text-white">{runs.length}</strong>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`p-3 border-b text-xs flex items-center justify-between ${
            statusMsg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
              : 'bg-red-950/80 border-red-800 text-red-300'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-zinc-400 hover:text-white ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-zinc-800 min-h-[380px]">
        {/* Left Column: List of Inbound Units */}
        <div className="p-4 space-y-3 bg-zinc-950/60 lg:col-span-1">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-bold mb-2">
            Inbound Emergency Units
          </div>

          {runs.length === 0 ? (
            <div className="p-6 text-center text-zinc-500 border border-dashed border-zinc-800 rounded-xs">
              No inbound ambulances currently transmitting. All arrivals cleared.
            </div>
          ) : (
            runs.map((run) => {
              const isSelected = selectedRun?.id === run.id;
              const isEsi1 = run.esi === 'ESI_1';

              return (
                <div
                  key={run.id}
                  onClick={() => setSelectedRun(run)}
                  className={`p-3 rounded-xs border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-white bg-zinc-900 shadow-md ring-1 ring-white/40'
                      : 'border-zinc-800 bg-zinc-950/80 hover:bg-zinc-900/60 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white text-xs">
                      🚑 {run.unitCode}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded-xs border ${
                        isEsi1
                          ? 'border-red-700 bg-red-950 text-red-300 animate-pulse'
                          : 'border-yellow-700 bg-yellow-950 text-yellow-300'
                      }`}
                    >
                      {run.esi}
                    </span>
                  </div>

                  <div className="text-[11px] text-zinc-300 font-semibold truncate">
                    {run.patientName} ({run.age}y, {run.gender})
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {run.complaint}
                  </div>

                  <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-500">
                    <span>{run.agency}</span>
                    <span className="text-cyan-400 font-bold">ETA: ~{run.etaMinutes} min</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Intake to Bed Action Workspace */}
        <div className="p-5 lg:col-span-2 bg-zinc-900/40 flex flex-col justify-between">
          {selectedRun ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Emergency Admission Authorization · {selectedRun.unitCode}
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Inbound agency: {selectedRun.agency} · Telemetry Verified
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-red-400 border border-red-800 bg-red-950/60 px-2 py-0.5 rounded-xs">
                    Triage Level: {selectedRun.esi}
                  </span>
                </div>
              </div>

              {/* Patient Demographics & Pre-Hospital Vitals */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-zinc-950 p-3.5 border border-zinc-800 rounded-xs">
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase block">Patient</span>
                  <span className="text-xs font-bold text-white">{selectedRun.patientName}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase block">Age / Gender</span>
                  <span className="text-xs font-bold text-zinc-200">
                    {selectedRun.age} yrs · {selectedRun.gender}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase block">Blood Pressure</span>
                  <span className="text-xs font-bold text-cyan-300">{selectedRun.vitals.bp} mmHg</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase block">SpO2 / Heart Rate</span>
                  <span className="text-xs font-bold text-emerald-300">
                    {selectedRun.vitals.spo2}% · {selectedRun.vitals.hr} bpm
                  </span>
                </div>
              </div>

              {/* Chief Complaint */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 block mb-1">
                  Reported Chief Complaint & Assessment
                </label>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xs text-xs text-zinc-200">
                  {selectedRun.complaint}
                </div>
              </div>

              {/* Bed Assignment Selector */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 block mb-1">
                  Assign to Available PostgreSQL Bed
                </label>
                {availableBeds.length === 0 ? (
                  <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 text-xs">
                    ⚠ No beds are currently AVAILABLE for immediate intake. Please discharge or sanitize a bed first.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableBeds.map((bed) => (
                      <button
                        key={bed.bed_code}
                        type="button"
                        onClick={() => setTargetBedCode(bed.bed_code)}
                        className={`px-3 py-2 border rounded-xs text-xs font-mono transition-all ${
                          targetBedCode === bed.bed_code
                            ? 'border-emerald-400 bg-emerald-950 text-emerald-200 font-bold shadow-sm'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          <span>{bed.bed_code}</span>
                        </div>
                        <div className="text-[9px] text-zinc-500 mt-0.5">
                          Floor {bed.floor_number || 1} · {bed.department}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={processing || availableBeds.length === 0 || !targetBedCode}
                  onClick={() => handleIntakeToBed(selectedRun)}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-600 font-bold py-3 uppercase tracking-wider text-xs transition-colors rounded-xs shadow-md"
                >
                  {processing
                    ? 'Processing Admission & Setting Bed to OCCUPIED...'
                    : `Intake to Bed ${targetBedCode || '...'} (Set Status: OCCUPIED)`}
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-500 text-xs">
              Select an inbound ambulance unit from the list to author admission intake.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
