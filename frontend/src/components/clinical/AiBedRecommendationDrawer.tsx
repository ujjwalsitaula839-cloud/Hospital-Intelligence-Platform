import React, { useState } from 'react';
import { api } from '../../lib/api';
import type {
  AcuityLevel,
  BedRecommendationResult,
  Department,
  Patient,
} from '../../types';

interface AiBedRecommendationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  onReservationComplete?: (bedCode: string) => void;
}

export default function AiBedRecommendationDrawer({
  isOpen,
  onClose,
  patients,
  onReservationComplete,
}: AiBedRecommendationDrawerProps): React.ReactElement | null {
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState<number | ''>(58);
  const [patientGender, setPatientGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');
  const [acuity, setAcuity] = useState<AcuityLevel>('ESI_1');
  const [chiefComplaint, setChiefComplaint] = useState('Severe shortness of breath and acute chest tightness');
  const [diagnosis, setDiagnosis] = useState('Acute Respiratory Distress Syndrome (ARDS)');
  const [systolicBp, setSystolicBp] = useState<number | ''>(88);
  const [diastolicBp, setDiastolicBp] = useState<number | ''>(56);
  const [heartRate, setHeartRate] = useState<number | ''>(124);
  const [respiratoryRate, setRespiratoryRate] = useState<number | ''>(32);
  const [spo2, setSpo2] = useState<number | ''>(86);
  const [tempCelsius, setTempCelsius] = useState<number | ''>(38.9);
  const [requiresIsolation, setRequiresIsolation] = useState(true);
  const [requiresBariatric, setRequiresBariatric] = useState(false);
  const [infectionType, setInfectionType] = useState('Airborne / Droplet Precautions');
  const [preferredDept, setPreferredDept] = useState<Department | ''>('');

  // Execution states
  const [isLoading, setIsLoading] = useState(false);
  const [isReserving, setIsReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [result, setResult] = useState<BedRecommendationResult | null>(null);
  const [selectedBedCode, setSelectedBedCode] = useState<string>('');
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<number[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  if (!isOpen) return null;

  // Handle preset application
  const applyPreset = (preset: 'stemi' | 'tb' | 'bariatric' | 'ward') => {
    setError(null);
    setResult(null);
    if (preset === 'stemi') {
      setAcuity('ESI_1');
      setChiefComplaint('Crushing retrosternal chest pain radiating to left arm');
      setDiagnosis('Acute ST-Elevation Myocardial Infarction (STEMI)');
      setSystolicBp(84);
      setDiastolicBp(52);
      setHeartRate(132);
      setRespiratoryRate(26);
      setSpo2(89);
      setTempCelsius(37.0);
      setRequiresIsolation(false);
      setRequiresBariatric(false);
      setPreferredDept('ICU');
    } else if (preset === 'tb') {
      setAcuity('ESI_2');
      setChiefComplaint('Productive cough with hemoptysis and night sweats');
      setDiagnosis('Suspected Active Pulmonary Tuberculosis');
      setSystolicBp(116);
      setDiastolicBp(74);
      setHeartRate(96);
      setRespiratoryRate(22);
      setSpo2(93);
      setTempCelsius(38.6);
      setRequiresIsolation(true);
      setInfectionType('Airborne (Mycobacterium tuberculosis)');
      setRequiresBariatric(false);
      setPreferredDept('EMERGENCY');
    } else if (preset === 'bariatric') {
      setAcuity('ESI_3');
      setChiefComplaint('Post-operative bariatric wound evaluation');
      setDiagnosis('Morbid obesity post roux-en-y requiring heavy-duty frame');
      setSystolicBp(138);
      setDiastolicBp(88);
      setHeartRate(82);
      setRespiratoryRate(18);
      setSpo2(96);
      setTempCelsius(36.8);
      setRequiresIsolation(false);
      setRequiresBariatric(true);
      setPreferredDept('STEP_DOWN');
    } else {
      setAcuity('ESI_4');
      setChiefComplaint('Mild abdominal discomfort and dehydration');
      setDiagnosis('Acute non-infectious gastroenteritis');
      setSystolicBp(120);
      setDiastolicBp(80);
      setHeartRate(76);
      setRespiratoryRate(16);
      setSpo2(99);
      setTempCelsius(37.2);
      setRequiresIsolation(false);
      setRequiresBariatric(false);
      setPreferredDept('GENERAL_WARD');
    }
  };

  const handlePatientSelect = (pId: string) => {
    if (!pId) {
      setSelectedPatientId(null);
      return;
    }
    const id = parseInt(pId, 10);
    setSelectedPatientId(id);
    const p = patients.find((item) => item.patient_id === id);
    if (p) {
      setPatientName(`${p.first_name} ${p.last_name}`.trim());
      setPatientGender(p.gender || 'OTHER');
      if (p.age) setPatientAge(p.age);
    }
  };

  const handleGetRecommendation = async () => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    setResult(null);
    const startTime = performance.now();

    try {
      const res = await api.recommendBed({
        patient: {
          patient_id: selectedPatientId,
          full_name: patientName || undefined,
          age: typeof patientAge === 'number' ? patientAge : undefined,
          gender: patientGender,
          acuity_level: acuity,
          chief_complaint: chiefComplaint,
          primary_diagnosis: diagnosis,
          systolic_bp: typeof systolicBp === 'number' ? systolicBp : undefined,
          diastolic_bp: typeof diastolicBp === 'number' ? diastolicBp : undefined,
          heart_rate: typeof heartRate === 'number' ? heartRate : undefined,
          respiratory_rate: typeof respiratoryRate === 'number' ? respiratoryRate : undefined,
          oxygen_saturation: typeof spo2 === 'number' ? spo2 : undefined,
          temperature_celsius: typeof tempCelsius === 'number' ? tempCelsius : undefined,
          requires_isolation: requiresIsolation,
          requires_bariatric: requiresBariatric,
          infection_type: requiresIsolation ? infectionType : undefined,
        },
        preferred_department: preferredDept || undefined,
        max_candidate_beds: 10,
      });

      const elapsed = Math.round(performance.now() - startTime);
      setLatencyMs(elapsed);
      setResult(res);
      setSelectedBedCode(res.recommendation.recommended_bed_code);

      // Auto-select available equipment that matches recommendations
      const availableIds = res.available_equipment.map((e) => e.equipment_id);
      setSelectedEquipmentIds(availableIds.slice(0, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate bed recommendation.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReserve = async () => {
    if (!result || !selectedBedCode) return;
    setIsReserving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const candidate = result.candidates_pool.find((b) => b.bed_code === selectedBedCode);
      const expectedVersion = candidate ? candidate.version : 1;

      const res = await api.reserveRecommendedBed({
        bed_code: selectedBedCode,
        expected_version: expectedVersion,
        patient_id: selectedPatientId || 75,
        acuity_level: acuity,
        primary_diagnosis: diagnosis,
        prestage_equipment_ids: selectedEquipmentIds,
      });

      setSuccessMessage(
        `Bed ${selectedBedCode} successfully reserved! ${res.staged_equipment.length} equipment item(s) pre-staged.`
      );
      if (onReservationComplete) {
        onReservationComplete(selectedBedCode);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to complete bed reservation.';
      setError(msg);
    } finally {
      setIsReserving(false);
    }
  };

  const toggleEquipmentSelection = (eqId: number) => {
    setSelectedEquipmentIds((prev) =>
      prev.includes(eqId) ? prev.filter((id) => id !== eqId) : [...prev, eqId]
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/75 backdrop-blur-sm flex justify-end animate-fadeIn">
      <div className="w-full max-w-2xl bg-zinc-950 border-l border-zinc-800 h-full flex flex-col shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 bg-zinc-900/60 sticky top-0 z-10 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="p-2 bg-indigo-950/80 border border-indigo-700/60 rounded-xl text-xl">
              ⚡
            </span>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  LangChain AI Bed Recommender
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-full font-semibold">
                  v2.0 LCEL
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Deterministic SQL candidate slicing + single-shot clinical reasoning pipe
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-2 hover:bg-zinc-800 rounded-lg transition"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 flex-1">
          {/* Quick Presets */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Quick Clinical Triage Presets
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => applyPreset('stemi')}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-red-950/50 text-red-300 border border-red-800/60 hover:bg-red-900/50 transition text-left"
              >
                🔴 STEMI (ESI-1)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('tb')}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-amber-950/50 text-amber-300 border border-amber-800/60 hover:bg-amber-900/50 transition text-left"
              >
                🟡 TB Isolation (ESI-2)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('bariatric')}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-950/50 text-blue-300 border border-blue-800/60 hover:bg-blue-900/50 transition text-left"
              >
                🔵 Bariatric (ESI-3)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('ward')}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-emerald-950/50 text-emerald-300 border border-emerald-800/60 hover:bg-emerald-900/50 transition text-left"
              >
                🟢 Ward Care (ESI-4)
              </button>
            </div>
          </div>

          {/* Patient Details & Vitals Form */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <span>🩺</span>
              <span>Patient Triage & Physiological Vitals</span>
            </h3>

            {/* Patient Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Select Existing Inpatient (Optional)</label>
                <select
                  value={selectedPatientId || ''}
                  onChange={(e) => handlePatientSelect(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">-- Manual / Incoming EMS Intake --</option>
                  {patients.slice(0, 30).map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      #{p.patient_id} - {p.first_name} {p.last_name} ({p.gender}, Age {p.age || 'N/A'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Patient Name</label>
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="e.g. John Doe / EMS Trauma 104"
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Acuity & Preferred Dept */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Acuity Level (ESI)</label>
                <select
                  value={acuity}
                  onChange={(e) => setAcuity(e.target.value as AcuityLevel)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none font-mono"
                >
                  <option value="ESI_1">ESI_1 - Resuscitation (Immediate)</option>
                  <option value="ESI_2">ESI_2 - Emergent (&lt;10 min)</option>
                  <option value="ESI_3">ESI_3 - Urgent (&lt;30 min)</option>
                  <option value="ESI_4">ESI_4 - Less Urgent (&lt;60 min)</option>
                  <option value="ESI_5">ESI_5 - Non-Urgent (&lt;120 min)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Age / Gender</label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    value={patientAge}
                    onChange={(e) => setPatientAge(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Age"
                    className="w-1/2 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2.5 py-2 focus:border-indigo-500 focus:outline-none"
                  />
                  <select
                    value={patientGender}
                    onChange={(e) => setPatientGender(e.target.value as 'MALE' | 'FEMALE' | 'OTHER')}
                    className="w-1/2 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2 py-2 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Preferred Unit (Optional)</label>
                <select
                  value={preferredDept}
                  onChange={(e) => setPreferredDept((e.target.value || '') as Department | '')}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">Auto-Detect via Acuity</option>
                  <option value="EMERGENCY">Emergency Dept (ED)</option>
                  <option value="ICU">Intensive Care Unit (ICU)</option>
                  <option value="STEP_DOWN">Step-Down Unit</option>
                  <option value="GENERAL_WARD">General Medical Ward</option>
                  <option value="SURGERY">Surgical Suite</option>
                </select>
              </div>
            </div>

            {/* Vitals Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              <div>
                <label className="text-[11px] text-zinc-400 block mb-0.5">BP Sys</label>
                <input
                  type="number"
                  value={systolicBp}
                  onChange={(e) => setSystolicBp(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400 block mb-0.5">BP Dia</label>
                <input
                  type="number"
                  value={diastolicBp}
                  onChange={(e) => setDiastolicBp(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400 block mb-0.5">Heart Rate</label>
                <input
                  type="number"
                  value={heartRate}
                  onChange={(e) => setHeartRate(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400 block mb-0.5">Resp Rate</label>
                <input
                  type="number"
                  value={respiratoryRate}
                  onChange={(e) => setRespiratoryRate(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400 block mb-0.5">SpO2 %</label>
                <input
                  type="number"
                  value={spo2}
                  onChange={(e) => setSpo2(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400 block mb-0.5">Temp (°C)</label>
                <input
                  type="number"
                  step="0.1"
                  value={tempCelsius}
                  onChange={(e) => setTempCelsius(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>
            </div>

            {/* Special Precautions: Isolation & Bariatric */}
            <div className="pt-2 border-t border-zinc-800/60 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-start space-x-3 bg-zinc-950/60 p-3 rounded-lg border border-zinc-800">
                <input
                  type="checkbox"
                  id="drawer_isolation"
                  checked={requiresIsolation}
                  onChange={(e) => setRequiresIsolation(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <label htmlFor="drawer_isolation" className="text-xs font-semibold text-white block cursor-pointer">
                    Requires Airborne/Contact Isolation
                  </label>
                  {requiresIsolation && (
                    <input
                      type="text"
                      value={infectionType}
                      onChange={(e) => setInfectionType(e.target.value)}
                      placeholder="e.g. COVID-19, TB, C. Diff"
                      className="mt-2 w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1 focus:border-indigo-500 focus:outline-none"
                    />
                  )}
                </div>
              </div>

              <div className="flex items-start space-x-3 bg-zinc-950/60 p-3 rounded-lg border border-zinc-800">
                <input
                  type="checkbox"
                  id="drawer_bariatric"
                  checked={requiresBariatric}
                  onChange={(e) => setRequiresBariatric(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <label htmlFor="drawer_bariatric" className="text-xs font-semibold text-white block cursor-pointer">
                    Bariatric Equipment Required (&gt;160 kg)
                  </label>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Filters candidate pool for reinforced frames and width accommodations
                  </p>
                </div>
              </div>
            </div>

            {/* Chief Complaint & Diagnosis */}
            <div className="space-y-2">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Chief Complaint</label>
                <input
                  type="text"
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Working Primary Diagnosis</label>
                <input
                  type="text"
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              onClick={handleGetRecommendation}
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white font-semibold text-xs rounded-xl shadow-lg shadow-indigo-950/50 flex items-center justify-center space-x-2 transition"
            >
              {isLoading ? (
                <>
                  <span className="animate-spin text-base">⏳</span>
                  <span>Executing Single-Pass LCEL Chain...</span>
                </>
              ) : (
                <>
                  <span>✨</span>
                  <span>Evaluate Candidates & Generate AI Recommendation</span>
                </>
              )}
            </button>
          </div>

          {/* Feedback Banners */}
          {error && (
            <div className="p-4 bg-red-950/60 border border-red-800 text-red-200 rounded-xl text-xs space-y-1">
              <div className="font-bold flex items-center space-x-1.5">
                <span>⚠️</span>
                <span>Recommendation Error</span>
              </div>
              <p>{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="p-4 bg-emerald-950/60 border border-emerald-800 text-emerald-200 rounded-xl text-xs space-y-1">
              <div className="font-bold flex items-center space-x-1.5">
                <span>✅</span>
                <span>Reservation Completed</span>
              </div>
              <p>{successMessage}</p>
            </div>
          )}

          {/* AI Recommendation Output Card */}
          {result && (
            <div className="bg-zinc-900 border border-indigo-900/60 rounded-xl p-5 space-y-5 shadow-2xl animate-fadeIn">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center space-x-2">
                  <span className="text-base">🎯</span>
                  <h3 className="text-sm font-bold text-white tracking-wide">
                    Top Recommended Placement
                  </h3>
                </div>
                <div className="flex items-center space-x-2">
                  <span
                    className={`px-2 py-0.5 text-[10px] font-mono rounded font-semibold ${
                      result.recommendation.mode === 'AI_RECOMMENDATION'
                        ? 'bg-indigo-950 text-indigo-300 border border-indigo-700'
                        : 'bg-amber-950 text-amber-300 border border-amber-700'
                    }`}
                  >
                    {result.recommendation.mode}
                  </span>
                  {latencyMs !== null && (
                    <span className="px-2 py-0.5 text-[10px] font-mono bg-zinc-800 text-zinc-300 rounded">
                      {latencyMs}ms
                    </span>
                  )}
                </div>
              </div>

              {/* Primary Bed Hero */}
              <div className="bg-zinc-950/80 border border-zinc-800 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-2xl font-black font-mono text-white">
                      {result.recommendation.recommended_bed_code}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-semibold bg-zinc-800 text-zinc-300 rounded">
                      {result.recommendation.department}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-semibold bg-zinc-800 text-zinc-300 rounded font-mono">
                      {result.recommendation.bed_type}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 text-xs text-zinc-400">
                    <span>
                      Confidence: <strong className="text-emerald-400 font-mono">{(result.recommendation.confidence_score * 100).toFixed(0)}%</strong>
                    </span>
                    <span>•</span>
                    <span>
                      Status:{' '}
                      <strong className={result.recommendation.is_immediate_ready ? 'text-emerald-400' : 'text-amber-400'}>
                        {result.recommendation.is_immediate_ready ? 'AVAILABLE (Ready Now)' : 'DIRTY (EVS Clean Needed)'}
                      </strong>
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleReserve}
                  disabled={isReserving}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-950/50 flex items-center justify-center space-x-2 transition"
                >
                  {isReserving ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      <span>Reserving...</span>
                    </>
                  ) : (
                    <>
                      <span>🔒</span>
                      <span>1-Click Accept &amp; Stage ({selectedEquipmentIds.length} items)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Clinical Rationale */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Clinical Placement Rationale
                </h4>
                <p className="text-xs text-zinc-300 bg-zinc-950 p-3 rounded-lg border border-zinc-800 leading-relaxed font-sans">
                  {result.recommendation.clinical_rationale}
                </p>
              </div>

              {/* Contingency Warnings (if any) */}
              {result.recommendation.warning_advisories && result.recommendation.warning_advisories.length > 0 && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-lg space-y-1">
                  <div className="text-xs font-bold text-amber-300 flex items-center space-x-1.5">
                    <span>⚠️</span>
                    <span>Hospital Capacity &amp; Contingency Advisory</span>
                  </div>
                  <ul className="text-xs text-amber-200/90 list-disc list-inside space-y-0.5">
                    {result.recommendation.warning_advisories.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Infection Control Precautions */}
              {result.recommendation.infection_control_precautions.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Mandatory Infection Control Precautions
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {result.recommendation.infection_control_precautions.map((p, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 text-xs bg-purple-950/60 border border-purple-800 text-purple-200 rounded-md"
                      >
                        🛡️ {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Pre-Staged Equipment Checklist */}
              {result.recommendation.equipment_to_prestage.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Recommended Pre-Staged Equipment ({result.recommendation.equipment_to_prestage.length})
                    </h4>
                    <span className="text-[11px] text-zinc-500">
                      Toggle to include in atomic reservation
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(result.recommendation?.equipment_to_prestage || []).map((item, idx) => {
                      // Match against actual hospital inventory with null-safety
                      const targetType = (item?.equipment_type || '').toLowerCase();
                      const matchedItem = (result.available_equipment || []).find((e) => {
                        if (!e) return false;
                        const eqName = (e.equipment_name || '').toLowerCase();
                        const eqType = (e.equipment_type || '').toLowerCase();
                        return Boolean(targetType && (eqName.includes(targetType) || eqType.includes(targetType)));
                      });
                      const eqId = matchedItem ? matchedItem.equipment_id : 9000 + idx;
                      const isSelected = selectedEquipmentIds.includes(eqId);

                      return (
                        <div
                          key={idx}
                          onClick={() => toggleEquipmentSelection(eqId)}
                          className={`p-3 rounded-lg border cursor-pointer transition flex items-start space-x-2.5 ${
                            isSelected
                              ? 'bg-indigo-950/40 border-indigo-700/80'
                              : 'bg-zinc-950/60 border-zinc-800 opacity-60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="mt-0.5 rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white truncate">
                                {item.equipment_type}
                              </span>
                              <span
                                className={`text-[9px] font-mono uppercase px-1.5 py-0.2 rounded font-semibold ${
                                  item.priority === 'MANDATORY'
                                    ? 'bg-red-950 text-red-300 border border-red-800'
                                    : 'bg-zinc-800 text-zinc-300'
                                }`}
                              >
                                {item.priority}
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">
                              {item.reason}
                            </p>
                            {matchedItem && (
                              <div className="text-[10px] text-emerald-400 font-mono mt-1">
                                Stock: {matchedItem.equipment_name} ({matchedItem.serial_number})
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Alternative Bed Options */}
              {result.recommendation.alternative_beds.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-zinc-800">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Alternative Bed Options
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {result.recommendation.alternative_beds.map((alt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedBedCode(alt.bed_code)}
                        className={`p-2.5 rounded-lg border text-left transition ${
                          selectedBedCode === alt.bed_code
                            ? 'bg-indigo-950 border-indigo-600'
                            : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold font-mono text-white">
                            {alt.bed_code}
                          </span>
                          <span className="text-[10px] text-zinc-400">{alt.department}</span>
                        </div>
                        <p className="text-[10px] text-zinc-500 mt-0.5 truncate">{alt.rationale}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
