import React, { useState, useMemo } from 'react';
import { ESI } from './network/ems';

const AGENCIES = [
  { id: 'tre', name: 'Metro Region EMS', color: '#60a5fa' },
  { id: 'riv', name: 'Riverside Ambulance', color: '#34d399' },
  { id: 'mfr', name: 'Metro Fire Rescue', color: '#fbbf24' },
  { id: 'air', name: 'Air Care / Medevac', color: '#f43f5e' },
  { id: 'cnt', name: 'County EMS', color: '#a78bfa' },
];

const COMPLAINT_PRESETS = [
  'Chest pain (STEMI alert)',
  'Trauma / MVA (Full alert)',
  'Stroke symptoms (FAST+)',
  'Severe dyspnea / Respiratory distress',
  'Sepsis alert / High fever',
  'Altered mental status / Overdose',
  'Abdominal pain / GI bleed',
  'Cardiac arrest (ROSC)',
];

export default function EmsCallIntakeModal({ isOpen, onClose, availableBeds = [], onHoldBed }) {
  const [agency, setAgency] = useState('Metro Region EMS');
  const [unit, setUnit] = useState('Medic 12');
  const [etaMinutes, setEtaMinutes] = useState(8);
  const [zone, setZone] = useState('Metro Highway / Zone 4');

  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('MALE');

  const [complaint, setComplaint] = useState(COMPLAINT_PRESETS[0]);
  const [customComplaint, setCustomComplaint] = useState('');
  const [esi, setEsi] = useState(2);

  // Vitals
  const [hr, setHr] = useState(104);
  const [bpSys, setBpSys] = useState(138);
  const [bpDia, setBpDia] = useState(86);
  const [spo2, setSpo2] = useState(94);
  const [rr, setRr] = useState(20);
  const [gcs, setGcs] = useState(15);

  // Special needs
  const [needs, setNeeds] = useState(['Cardiac monitor', 'Oxygen delivery']);

  // Selected bed
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [selectedBedCode, setSelectedBedCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const resetForm = React.useCallback(() => {
    setAgency('Metro Region EMS');
    setUnit('Medic 12');
    setEtaMinutes(8);
    setZone('Metro Highway / Zone 4');
    setPatientName('');
    setAge('');
    setGender('MALE');
    setComplaint(COMPLAINT_PRESETS[0]);
    setCustomComplaint('');
    setEsi(2);
    setHr(104);
    setBpSys(138);
    setBpDia(86);
    setSpo2(94);
    setRr(20);
    setGcs(15);
    setNeeds(['Cardiac monitor', 'Oxygen delivery']);
    setSelectedBedCode('');
    setError(null);
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  const activeComplaint = customComplaint.trim() || complaint;

  // Filter available beds
  const filteredBeds = useMemo(() => {
    if (!availableBeds || availableBeds.length === 0) return [];
    return availableBeds.filter((b) => {
      const isClean = (b.status || '').toUpperCase() === 'AVAILABLE';
      if (!isClean) return false;
      if (deptFilter === 'ALL') return true;
      const dept = (b.department || '').toUpperCase();
      if (deptFilter === 'ED') return dept === 'EMERGENCY' || dept.includes('EMERG');
      if (deptFilter === 'ICU') return dept === 'ICU';
      if (deptFilter === 'WARD') return dept.includes('WARD') || dept.includes('MED');
      return true;
    });
  }, [availableBeds, deptFilter]);

  // Clinical bed scoring / smart recommendation
  const recommendedBed = useMemo(() => {
    if (!filteredBeds.length) return null;
    // High acuity ESI 1 or 2 -> prioritize ICU or Resus/ED
    if (esi === 1 || activeComplaint.toLowerCase().includes('arrest') || activeComplaint.toLowerCase().includes('stemi')) {
      const icuBed = filteredBeds.find((b) => (b.department || '').toUpperCase() === 'ICU');
      if (icuBed) return icuBed;
      const edBed = filteredBeds.find((b) => (b.department || '').toUpperCase() === 'EMERGENCY');
      if (edBed) return edBed;
    }
    if (esi <= 2 || activeComplaint.toLowerCase().includes('trauma') || activeComplaint.toLowerCase().includes('stroke')) {
      const edBed = filteredBeds.find((b) => (b.department || '').toUpperCase() === 'EMERGENCY');
      if (edBed) return edBed;
    }
    return filteredBeds[0];
  }, [filteredBeds, esi, activeComplaint]);

  // Auto-select recommended bed if none chosen
  React.useEffect(() => {
    if (recommendedBed && !selectedBedCode) {
      setSelectedBedCode(recommendedBed.bed_code);
    }
  }, [recommendedBed, selectedBedCode]);

  // Clinical reference range validation based on emergency department standards
  const validation = useMemo(() => {
    const errors = [];
    const warnings = [];

    // Age: Non-negative and less than 150
    if (age !== '' && age !== null && age !== undefined) {
      const numAge = Number(age);
      if (isNaN(numAge) || numAge < 0 || numAge >= 150) {
        errors.push({ field: 'age', message: 'Age must be non-negative and less than 150 (0–149)' });
      }
    }

    // HR (Heart Rate): Extreme 20–260 bpm; Warning <50 or >120; Normal 60–100
    const numHr = Number(hr);
    if (isNaN(numHr) || numHr < 20 || numHr > 260) {
      errors.push({ field: 'hr', message: 'Heart rate must be within 20 – 260 bpm' });
    } else if (numHr < 50 || numHr > 120) {
      warnings.push({ field: 'hr', message: numHr < 50 ? 'Clinical Warning: Bradycardia (< 50 bpm)' : 'Clinical Warning: Tachycardia (> 120 bpm)' });
    }

    // Systolic BP: Extreme 40–300 mmHg; Warning <90 or >180; Normal 90–120
    const numSys = Number(bpSys);
    if (isNaN(numSys) || numSys < 40 || numSys > 300) {
      errors.push({ field: 'bpSys', message: 'Systolic BP must be within 40 – 300 mmHg' });
    } else if (numSys < 90 || numSys > 180) {
      warnings.push({ field: 'bpSys', message: numSys < 90 ? 'Clinical Warning: Hypotension (< 90 mmHg)' : 'Clinical Warning: Hypertensive Crisis (> 180 mmHg)' });
    }

    // Diastolic BP: Extreme 20–180 mmHg; Warning <50 or >120; Normal 60–80
    const numDia = Number(bpDia);
    if (isNaN(numDia) || numDia < 20 || numDia > 180) {
      errors.push({ field: 'bpDia', message: 'Diastolic BP must be within 20 – 180 mmHg' });
    } else if (!isNaN(numSys) && numDia > numSys) {
      errors.push({ field: 'bpDia', message: 'Diastolic BP cannot exceed Systolic BP' });
    } else if (numDia < 50 || numDia > 120) {
      warnings.push({ field: 'bpDia', message: numDia < 50 ? 'Clinical Warning: Low Diastolic (< 50 mmHg)' : 'Clinical Warning: High Diastolic (> 120 mmHg)' });
    }

    // SpO2: Extreme 0–100 %; Warning <90% (hypoxia); Normal 95–100
    const numSpo2 = Number(spo2);
    if (isNaN(numSpo2) || numSpo2 < 0 || numSpo2 > 100) {
      errors.push({ field: 'spo2', message: 'SpO2 must be between 0% and 100% (physical ceiling is 100%)' });
    } else if (numSpo2 < 90) {
      warnings.push({ field: 'spo2', message: 'Clinical Warning: Severe Hypoxia (< 90%)' });
    }

    // RR (Respiratory Rate): Extreme 0–60 breaths/min; Warning <8 or >28; Normal 12–20
    const numRr = Number(rr);
    if (isNaN(numRr) || numRr < 0 || numRr > 60) {
      errors.push({ field: 'rr', message: 'Respiratory rate must be within 0 – 60 breaths/min' });
    } else if (numRr < 8 || numRr > 28) {
      warnings.push({ field: 'rr', message: numRr < 8 ? 'Clinical Warning: Bradypnea (< 8/min)' : 'Clinical Warning: Tachypnea (> 28/min)' });
    }

    // GCS: 3–15
    const numGcs = Number(gcs);
    if (isNaN(numGcs) || numGcs < 3 || numGcs > 15) {
      errors.push({ field: 'gcs', message: 'GCS must be between 3 and 15' });
    }

    // ETA: 0–180
    const numEta = Number(etaMinutes);
    if (isNaN(numEta) || numEta < 0 || numEta > 180) {
      errors.push({ field: 'etaMinutes', message: 'ETA must be between 0 and 180 minutes' });
    }

    return {
      errors,
      warnings,
      isValid: errors.length === 0,
      fieldErrors: Object.fromEntries(errors.map((e) => [e.field, e.message])),
      fieldWarnings: Object.fromEntries(warnings.map((w) => [w.field, w.message])),
    };
  }, [age, hr, bpSys, bpDia, spo2, rr, gcs, etaMinutes]);

  const toggleNeed = (need) => {
    setNeeds((prev) => (prev.includes(need) ? prev.filter((n) => n !== need) : [...prev, need]));
  };

  const handleQuickName = (name, quickGender) => {
    setPatientName(name);
    if (quickGender) {
      setGender(quickGender);
    } else if (name.toLowerCase().includes('female')) {
      setGender('FEMALE');
    } else if (name.toLowerCase().includes('male')) {
      setGender('MALE');
    }
  };

  const handleSubmit = async (e, forcePending = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!patientName.trim()) {
      setError('Please provide a patient name or identifier (e.g. Unknown Male).');
      return;
    }
    if (!validation.isValid) {
      setError(`Cannot submit: please correct out-of-range clinical values:\n• ${validation.errors.map((err) => err.message).join('\n• ')}`);
      return;
    }

    const bedToHold = forcePending ? null : (selectedBedCode || null);

    setSubmitting(true);
    setError(null);

    const payload = {
      agency,
      unit,
      etaMinutes: Number(etaMinutes) || 8,
      zone,
      patientName: patientName.trim(),
      age: age !== '' ? Number(age) : null,
      gender,
      complaint: activeComplaint,
      esi: Number(esi),
      vitals: {
        heart_rate: Number(hr),
        systolic: Number(bpSys),
        diastolic: Number(bpDia),
        spo2: Number(spo2),
        respiratory_rate: Number(rr),
        gcs: Number(gcs),
      },
      needs,
      bedCode: bedToHold,
    };

    try {
      const res = await onHoldBed(payload);
      if (res === false) {
        throw new Error('Failed to process EMS request. Please verify connection.');
      }
      resetForm();
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to process EMS request. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="palette-veil"
      onClick={onClose}
      style={{
        zIndex: 1400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(2, 6, 23, 0.75)',
        backdropFilter: 'blur(6px)',
        position: 'fixed',
        inset: 0,
        padding: '16px',
        overflowY: 'auto',
      }}
    >
      <div
        className="palette"
        style={{
          width: '100%',
          maxWidth: '960px',
          maxHeight: '92vh',
          background: '#090f1d',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: '16px',
          color: '#f8fafc',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(96, 165, 250, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="EMS Call Intake and Bed Assignment Modal"
      >
        {/* Modal Header */}
        <header
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                display: 'grid',
                placeItems: 'center',
                color: '#60a5fa',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 650, letterSpacing: '-0.02em', color: '#fff' }}>
                  EMS Call Intake & Bed Hold
                </h2>
                <span
                  style={{
                    padding: '3px 9px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    background: 'rgba(239, 68, 68, 0.16)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                  }}
                >
                  Radio Inbound
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                Charge Nurse station phone intake · hold a clean bed on the live map before crew arrival
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '24px',
              lineHeight: 1,
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            ×
          </button>
        </header>

        {error && (
          <div
            style={{
              padding: '10px 20px',
              background: 'rgba(239, 68, 68, 0.15)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              fontSize: '12.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.1fr 1fr',
              gap: '20px',
              padding: '20px 24px',
              overflowY: 'auto',
              maxHeight: 'calc(92vh - 150px)',
            }}
          >
            {/* LEFT COLUMN: EMS Fleet & Clinical Telemetry */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Transit & Fleet */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                  1. Ambulance & Transit
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>EMS Agency</label>
                    <select
                      value={agency}
                      onChange={(e) => setAgency(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        background: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: '12.5px',
                      }}
                    >
                      {AGENCIES.map((a) => (
                        <option key={a.id} value={a.name}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Unit / Call Sign</label>
                    <input
                      type="text"
                      required
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="e.g. Medic 12"
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        background: 'rgba(15,23,42,0.8)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: '12.5px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>ETA (Minutes)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        min="1"
                        max="120"
                        required
                        value={etaMinutes}
                        onChange={(e) => setEtaMinutes(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: '6px',
                          background: 'rgba(15,23,42,0.8)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#fff',
                          fontSize: '12.5px',
                          fontWeight: 700,
                        }}
                      />
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>min</span>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '8px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Origin Dispatch Zone</label>
                  <input
                    type="text"
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    placeholder="e.g. Metro Highway Mile 14"
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      background: 'rgba(15,23,42,0.8)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                      fontSize: '12.5px',
                    }}
                  />
                </div>
              </div>

              {/* Patient Info */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    2. Patient Demographics
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      id="btn-quick-unknown-male"
                      onClick={() => handleQuickName('Unknown Male', 'MALE')}
                      style={{
                        padding: '3px 9px',
                        fontSize: '11px',
                        fontWeight: 600,
                        borderRadius: '5px',
                        background: gender === 'MALE' && patientName.includes('Unknown Male') ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.06)',
                        border: gender === 'MALE' && patientName.includes('Unknown Male') ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.12)',
                        color: gender === 'MALE' && patientName.includes('Unknown Male') ? '#93c5fd' : '#cbd5e1',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Set name to Unknown Male and select Male in dropdown"
                    >
                      <span>♂</span> Unknown Male
                    </button>
                    <button
                      type="button"
                      id="btn-quick-unknown-female"
                      onClick={() => handleQuickName('Unknown Female', 'FEMALE')}
                      style={{
                        padding: '3px 9px',
                        fontSize: '11px',
                        fontWeight: 600,
                        borderRadius: '5px',
                        background: gender === 'FEMALE' && patientName.includes('Unknown Female') ? 'rgba(236, 72, 153, 0.3)' : 'rgba(255,255,255,0.06)',
                        border: gender === 'FEMALE' && patientName.includes('Unknown Female') ? '1px solid #ec4899' : '1px solid rgba(255,255,255,0.12)',
                        color: gender === 'FEMALE' && patientName.includes('Unknown Female') ? '#f472b6' : '#cbd5e1',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Set name to Unknown Female and select Female in dropdown"
                    >
                      <span>♀</span> Unknown Female
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Patient Full Name / Tag</label>
                    <input
                      type="text"
                      id="input-patient-name"
                      required
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="e.g. John Doe, Sarah Connor"
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        background: 'rgba(15,23,42,0.8)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: '12.5px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: validation.fieldErrors.age ? '#ef4444' : '#94a3b8', marginBottom: '4px' }}>
                      <span>Age (Est.)</span>
                      {validation.fieldErrors.age && <span style={{ fontSize: '10px', fontWeight: 600 }}>0–149 only</span>}
                    </label>
                    <input
                      type="number"
                      id="input-patient-age"
                      min="0"
                      max="149"
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      placeholder="e.g. 58"
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        background: validation.fieldErrors.age ? 'rgba(239, 68, 68, 0.15)' : 'rgba(15,23,42,0.8)',
                        border: validation.fieldErrors.age ? '1.5px solid #ef4444' : '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: '12.5px',
                      }}
                    />
                    {validation.fieldErrors.age && (
                      <span style={{ display: 'block', fontSize: '10px', color: '#f87171', marginTop: '3px' }}>
                        Must be ≥ 0 and &lt; 150
                      </span>
                    )}
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Gender</label>
                    <select
                      id="select-patient-gender"
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        background: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: '12.5px',
                      }}
                    >
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                      <option value="UNKNOWN">Unknown</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Triage Acuity (ESI) & Chief Complaint */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                  3. Clinical Triage & Acuity
                </div>

                <div style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                    Emergency Severity Index (ESI Acuity)
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                    {[1, 2, 3, 4, 5].map((level) => {
                      const isSelected = esi === level;
                      const color = ESI[level]?.color || '#94a3b8';
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setEsi(level)}
                          style={{
                            padding: '8px 4px',
                            borderRadius: '6px',
                            border: `1.5px solid ${isSelected ? color : 'rgba(255,255,255,0.1)'}`,
                            background: isSelected ? `${color}25` : 'rgba(15,23,42,0.6)',
                            color: isSelected ? '#fff' : '#94a3b8',
                            fontSize: '12px',
                            fontWeight: isSelected ? 700 : 500,
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '2px',
                          }}
                        >
                          <span style={{ color }}>ESI {level}</span>
                          <span style={{ fontSize: '9px', opacity: 0.8 }}>
                            {level === 1 ? 'Resus' : level === 2 ? 'Emergent' : level === 3 ? 'Urgent' : level === 4 ? 'Less' : 'Non-urg'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Chief Complaint Preset</label>
                  <select
                    value={complaint}
                    onChange={(e) => {
                      setComplaint(e.target.value);
                      setCustomComplaint('');
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      background: '#0f172a',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                      fontSize: '12.5px',
                      marginBottom: '6px',
                    }}
                  >
                    {COMPLAINT_PRESETS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={customComplaint}
                    onChange={(e) => setCustomComplaint(e.target.value)}
                    placeholder="Or type custom complaint / clinical presentation…"
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      background: 'rgba(15,23,42,0.8)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                  />
                </div>

                {/* Vitals with Clinical Reference Constraints */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 650, color: '#e2e8f0' }}>
                      Vitals from Paramedic (Adult Clinical Ranges)
                    </label>
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                      Limits enforced · Red = blocked, Amber = warning
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    {/* HR */}
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: validation.fieldErrors.hr ? 'rgba(239, 68, 68, 0.12)' : validation.fieldWarnings.hr ? 'rgba(245, 158, 11, 0.1)' : 'rgba(15,23,42,0.6)',
                        border: `1px solid ${validation.fieldErrors.hr ? '#ef4444' : validation.fieldWarnings.hr ? '#f59e0b' : 'rgba(255,255,255,0.12)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 600, color: validation.fieldErrors.hr ? '#f87171' : validation.fieldWarnings.hr ? '#fbbf24' : '#cbd5e1' }}>
                          HR (bpm)
                        </span>
                        <span style={{ fontSize: '9.5px', color: '#64748b' }}>20–260</span>
                      </div>
                      <input
                        type="number"
                        id="input-vital-hr"
                        value={hr}
                        onChange={(e) => setHr(e.target.value)}
                        placeholder="60-100"
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '5px',
                          background: '#090f1d',
                          border: `1px solid ${validation.fieldErrors.hr ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                          color: '#fff',
                          fontSize: '13px',
                          fontWeight: 600,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      />
                      {validation.fieldErrors.hr ? (
                        <div style={{ fontSize: '9.5px', color: '#ef4444', marginTop: '3px', fontWeight: 600 }}>
                          ⚠️ Outside 20–260 limit
                        </div>
                      ) : validation.fieldWarnings.hr ? (
                        <div style={{ fontSize: '9.5px', color: '#fbbf24', marginTop: '3px' }}>
                          {validation.fieldWarnings.hr.replace('Clinical Warning: ', '')}
                        </div>
                      ) : (
                        <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: '3px' }}>Normal: 60–100</div>
                      )}
                    </div>

                    {/* RR (Respiratory Rate) */}
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: validation.fieldErrors.rr ? 'rgba(239, 68, 68, 0.12)' : validation.fieldWarnings.rr ? 'rgba(245, 158, 11, 0.1)' : 'rgba(15,23,42,0.6)',
                        border: `1px solid ${validation.fieldErrors.rr ? '#ef4444' : validation.fieldWarnings.rr ? '#f59e0b' : 'rgba(255,255,255,0.12)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 600, color: validation.fieldErrors.rr ? '#f87171' : validation.fieldWarnings.rr ? '#fbbf24' : '#cbd5e1' }}>
                          RR (breaths/min)
                        </span>
                        <span style={{ fontSize: '9.5px', color: '#64748b' }}>0–60</span>
                      </div>
                      <input
                        type="number"
                        id="input-vital-rr"
                        value={rr}
                        onChange={(e) => setRr(e.target.value)}
                        placeholder="12-20"
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '5px',
                          background: '#090f1d',
                          border: `1px solid ${validation.fieldErrors.rr ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                          color: '#fff',
                          fontSize: '13px',
                          fontWeight: 600,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      />
                      {validation.fieldErrors.rr ? (
                        <div style={{ fontSize: '9.5px', color: '#ef4444', marginTop: '3px', fontWeight: 600 }}>
                          ⚠️ Outside 0–60 limit
                        </div>
                      ) : validation.fieldWarnings.rr ? (
                        <div style={{ fontSize: '9.5px', color: '#fbbf24', marginTop: '3px' }}>
                          {validation.fieldWarnings.rr.replace('Clinical Warning: ', '')}
                        </div>
                      ) : (
                        <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: '3px' }}>Normal: 12–20</div>
                      )}
                    </div>

                    {/* SpO2 */}
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: validation.fieldErrors.spo2 ? 'rgba(239, 68, 68, 0.12)' : validation.fieldWarnings.spo2 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(15,23,42,0.6)',
                        border: `1px solid ${validation.fieldErrors.spo2 ? '#ef4444' : validation.fieldWarnings.spo2 ? '#f59e0b' : 'rgba(255,255,255,0.12)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 600, color: validation.fieldErrors.spo2 ? '#f87171' : validation.fieldWarnings.spo2 ? '#fbbf24' : '#cbd5e1' }}>
                          SpO₂ (%)
                        </span>
                        <span style={{ fontSize: '9.5px', color: '#64748b' }}>0–100%</span>
                      </div>
                      <input
                        type="number"
                        id="input-vital-spo2"
                        value={spo2}
                        onChange={(e) => setSpo2(e.target.value)}
                        placeholder="95-100"
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '5px',
                          background: '#090f1d',
                          border: `1px solid ${validation.fieldErrors.spo2 ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                          color: '#fff',
                          fontSize: '13px',
                          fontWeight: 600,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      />
                      {validation.fieldErrors.spo2 ? (
                        <div style={{ fontSize: '9.5px', color: '#ef4444', marginTop: '3px', fontWeight: 600 }}>
                          ⚠️ Max 100% (physical limit)
                        </div>
                      ) : validation.fieldWarnings.spo2 ? (
                        <div style={{ fontSize: '9.5px', color: '#fbbf24', marginTop: '3px' }}>
                          {validation.fieldWarnings.spo2.replace('Clinical Warning: ', '')}
                        </div>
                      ) : (
                        <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: '3px' }}>Normal: 95–100%</div>
                      )}
                    </div>

                    {/* Blood Pressure (Sys / Dia) */}
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        gridColumn: 'span 2',
                        background: validation.fieldErrors.bpSys || validation.fieldErrors.bpDia ? 'rgba(239, 68, 68, 0.12)' : (validation.fieldWarnings.bpSys || validation.fieldWarnings.bpDia) ? 'rgba(245, 158, 11, 0.1)' : 'rgba(15,23,42,0.6)',
                        border: `1px solid ${validation.fieldErrors.bpSys || validation.fieldErrors.bpDia ? '#ef4444' : (validation.fieldWarnings.bpSys || validation.fieldWarnings.bpDia) ? '#f59e0b' : 'rgba(255,255,255,0.12)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 600, color: validation.fieldErrors.bpSys || validation.fieldErrors.bpDia ? '#f87171' : '#cbd5e1' }}>
                          Blood Pressure (Sys / Dia mmHg)
                        </span>
                        <span style={{ fontSize: '9.5px', color: '#64748b' }}>Sys: 40–300 · Dia: 20–180</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <input
                            type="number"
                            id="input-vital-sys"
                            value={bpSys}
                            onChange={(e) => setBpSys(e.target.value)}
                            placeholder="Sys (90-120)"
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              borderRadius: '5px',
                              background: '#090f1d',
                              border: `1px solid ${validation.fieldErrors.bpSys ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                              color: '#fff',
                              fontSize: '13px',
                              fontWeight: 600,
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          />
                        </div>
                        <span style={{ color: '#94a3b8', fontSize: '16px', fontWeight: 700 }}>/</span>
                        <div style={{ flex: 1 }}>
                          <input
                            type="number"
                            id="input-vital-dia"
                            value={bpDia}
                            onChange={(e) => setBpDia(e.target.value)}
                            placeholder="Dia (60-80)"
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              borderRadius: '5px',
                              background: '#090f1d',
                              border: `1px solid ${validation.fieldErrors.bpDia ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                              color: '#fff',
                              fontSize: '13px',
                              fontWeight: 600,
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', marginTop: '3px' }}>
                        <div>
                          {validation.fieldErrors.bpSys ? (
                            <span style={{ color: '#ef4444', fontWeight: 600 }}>⚠️ Sys: 40–300</span>
                          ) : validation.fieldWarnings.bpSys ? (
                            <span style={{ color: '#fbbf24' }}>{validation.fieldWarnings.bpSys.replace('Clinical Warning: ', '')}</span>
                          ) : (
                            <span style={{ color: '#64748b' }}>Sys Normal: 90–120</span>
                          )}
                        </div>
                        <div>
                          {validation.fieldErrors.bpDia ? (
                            <span style={{ color: '#ef4444', fontWeight: 600 }}>⚠️ Dia: 20–180 &amp; &lt; Sys</span>
                          ) : validation.fieldWarnings.bpDia ? (
                            <span style={{ color: '#fbbf24' }}>{validation.fieldWarnings.bpDia.replace('Clinical Warning: ', '')}</span>
                          ) : (
                            <span style={{ color: '#64748b' }}>Dia Normal: 60–80</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* GCS */}
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: validation.fieldErrors.gcs ? 'rgba(239, 68, 68, 0.12)' : 'rgba(15,23,42,0.6)',
                        border: `1px solid ${validation.fieldErrors.gcs ? '#ef4444' : 'rgba(255,255,255,0.12)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 600, color: validation.fieldErrors.gcs ? '#f87171' : '#cbd5e1' }}>
                          GCS Score
                        </span>
                        <span style={{ fontSize: '9.5px', color: '#64748b' }}>3–15</span>
                      </div>
                      <input
                        type="number"
                        id="input-vital-gcs"
                        min="3"
                        max="15"
                        value={gcs}
                        onChange={(e) => setGcs(e.target.value)}
                        placeholder="15"
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '5px',
                          background: '#090f1d',
                          border: `1px solid ${validation.fieldErrors.gcs ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                          color: '#fff',
                          fontSize: '13px',
                          fontWeight: 600,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      />
                      <div style={{ fontSize: '9.5px', color: validation.fieldErrors.gcs ? '#ef4444' : '#64748b', marginTop: '3px' }}>
                        {validation.fieldErrors.gcs ? '⚠️ Range: 3 to 15' : 'Normal: 15'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Needs checkboxes */}
                <div style={{ marginTop: '12px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Needs on Arrival</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {['Cardiac monitor', 'Oxygen delivery', 'Ventilator ready', 'Trauma bay', 'Negative pressure isolation', 'Bariatric equipment', 'Cath lab alert', 'Stroke CT staged'].map((need) => {
                      const active = needs.includes(need);
                      return (
                        <button
                          key={need}
                          type="button"
                          onClick={() => toggleNeed(need)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: `1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,0.1)'}`,
                            background: active ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.02)',
                            color: active ? '#93c5fd' : '#94a3b8',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          {active ? '✓ ' : '+ '}
                          {need}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Available Bed Selection & Hold Assignment */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    4. Bed Assignment & Hold
                  </div>
                  <span style={{ fontSize: '11px', color: '#86efac', fontWeight: 600 }}>
                    {filteredBeds.length} clean beds ready
                  </span>
                </div>

                {/* Department filter pills */}
                <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
                  {[
                    { id: 'ALL', label: 'All Beds' },
                    { id: 'ED', label: 'Emergency' },
                    { id: 'ICU', label: 'ICU' },
                    { id: 'WARD', label: 'Inpatient Ward' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDeptFilter(tab.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '999px',
                        border: 'none',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: deptFilter === tab.id ? '#2563eb' : 'rgba(255,255,255,0.06)',
                        color: deptFilter === tab.id ? '#fff' : '#94a3b8',
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* AI / Clinical Recommendation Banner */}
                {recommendedBed && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                    }}
                  >
                    <span style={{ fontSize: '16px' }}>⚡</span>
                    <div style={{ fontSize: '11.5px', color: '#cbd5e1' }}>
                      <strong style={{ color: '#93c5fd', display: 'block' }}>
                        Clinical Match Recommendation: {recommendedBed.bed_code}
                      </strong>
                      Matching ESI {esi} ({activeComplaint}) against {recommendedBed.department} department capabilities.
                    </div>
                  </div>
                )}

                {/* Bed list scroll area */}
                <div style={{ flex: 1, overflowY: 'auto', maxHeight: '340px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {/* Option: Pre-Alert Only (No bed held yet) */}
                  <div
                    id="bed-option-pending"
                    onClick={() => setSelectedBedCode('')}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: `1.5px solid ${!selectedBedCode ? '#f59e0b' : 'rgba(255,255,255,0.08)'}`,
                      background: !selectedBedCode ? 'rgba(245, 158, 11, 0.15)' : 'rgba(15, 23, 42, 0.5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ fontSize: '13px', color: '#fef08a' }}>
                          ⚡ Pre-Alert Only · No Bed Held
                        </strong>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(245, 158, 11, 0.2)',
                            color: '#fbbf24',
                            fontWeight: 700,
                          }}
                        >
                          PENDING ASSIGNMENT
                        </span>
                      </div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                        Alert clinical team now; assign bed upon bay arrival or after triage
                      </span>
                    </div>
                    <div
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        border: `2px solid ${!selectedBedCode ? '#f59e0b' : 'rgba(255,255,255,0.3)'}`,
                        display: 'grid',
                        placeItems: 'center',
                        background: !selectedBedCode ? '#f59e0b' : 'transparent',
                      }}
                    >
                      {!selectedBedCode && <span style={{ color: '#000', fontSize: '10px', fontWeight: 800 }}>✓</span>}
                    </div>
                  </div>

                  {filteredBeds.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
                      No clean available beds found in this department. Select 'Pre-Alert Only' or change department filter.
                    </div>
                  ) : (
                    filteredBeds.map((bed) => {
                      const isSelected = selectedBedCode === bed.bed_code;
                      const isRecommended = recommendedBed?.bed_code === bed.bed_code;
                      return (
                        <div
                          key={bed.bed_code}
                          id={`bed-option-${bed.bed_code}`}
                          onClick={() => setSelectedBedCode(bed.bed_code)}
                          style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: `1.5px solid ${isSelected ? '#3b82f6' : isRecommended ? 'rgba(59, 130, 246, 0.4)' : 'rgba(255,255,255,0.08)'}`,
                            background: isSelected ? 'rgba(59, 130, 246, 0.22)' : 'rgba(15, 23, 42, 0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <strong style={{ fontSize: '13px', color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>
                                {bed.bed_code}
                              </strong>
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  background: 'rgba(255,255,255,0.08)',
                                  color: '#cbd5e1',
                                }}
                              >
                                {bed.department}
                              </span>
                              {bed.room_number && (
                                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Room {bed.room_number}</span>
                              )}
                              {isRecommended && (
                                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: '#1d4ed8', color: '#bfdbfe', fontWeight: 700 }}>
                                  BEST FIT
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                              Type: {bed.bed_type || 'STANDARD'} · Ready for admission
                            </span>
                          </div>

                          <div
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              border: `2px solid ${isSelected ? '#3b82f6' : 'rgba(255,255,255,0.3)'}`,
                              display: 'grid',
                              placeItems: 'center',
                              background: isSelected ? '#3b82f6' : 'transparent',
                            }}
                          >
                            {isSelected && <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Validation Warning Alert Banner if form has errors */}
          {!validation.isValid && (
            <div
              style={{
                margin: '0 24px 12px 24px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#fca5a5',
                fontSize: '11.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '16px' }}>🚫</span>
              <div>
                <strong style={{ color: '#ef4444', display: 'block' }}>
                  Cannot Submit: Clinical constraints violation ({validation.errors.length} issue{validation.errors.length > 1 ? 's' : ''})
                </strong>
                <span>{validation.errors.map((e) => e.message).join(' · ')}</span>
              </div>
            </div>
          )}

          {/* Modal Footer Actions */}
          <footer
            style={{
              padding: '16px 24px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              background: '#070b14',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              {selectedBedCode ? (
                <>Holding <strong style={{ color: '#fff' }}>{selectedBedCode}</strong> for{' '}</>
              ) : (
                <><span style={{ color: '#fbbf24', fontWeight: 650 }}>Pre-Alert (Pending Bed)</span> for{' '}</>
              )}
              <strong style={{ color: '#fff' }}>{unit}</strong> ({agency}) · ETA ~{etaMinutes} min
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                id="btn-modal-cancel"
                onClick={onClose}
                disabled={submitting}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#cbd5e1',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                id="btn-modal-submit"
                disabled={submitting || !validation.isValid || !patientName.trim()}
                title={!validation.isValid ? 'Correct out-of-range clinical values before submitting' : !patientName.trim() ? 'Enter patient name' : 'Submit ambulance pre-alert'}
                style={{
                  padding: '9px 22px',
                  borderRadius: '8px',
                  background: !validation.isValid || !patientName.trim()
                    ? '#334155'
                    : selectedBedCode
                    ? 'linear-gradient(135deg, #2563eb, #1d4ed8)'
                    : 'linear-gradient(135deg, #d97706, #b45309)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 650,
                  cursor: !validation.isValid || !patientName.trim() || submitting ? 'not-allowed' : 'pointer',
                  opacity: !validation.isValid || !patientName.trim() ? 0.6 : 1,
                  boxShadow: validation.isValid && patientName.trim()
                    ? selectedBedCode
                      ? '0 4px 14px rgba(37, 99, 235, 0.4)'
                      : '0 4px 14px rgba(217, 119, 6, 0.4)'
                    : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {submitting
                  ? 'Processing…'
                  : selectedBedCode
                  ? `Hold Bed ${selectedBedCode} for EMS`
                  : 'Log Pre-Alert (Pending Bed)'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
