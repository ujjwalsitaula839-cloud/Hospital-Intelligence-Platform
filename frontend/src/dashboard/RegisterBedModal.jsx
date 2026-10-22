import React, { useState } from 'react';

const DEPARTMENTS = [
  { id: 'EMERGENCY', label: 'Emergency & Trauma (Ground Floor)' },
  { id: 'ICU', label: 'Intensive Care Unit (Level 2)' },
  { id: 'GENERAL_WARD', label: 'General Medicine / Inpatient (Level 3)' },
  { id: 'SURGICAL_WARD', label: 'Surgical Ward / Post-Op (Level 2)' },
  { id: 'STEP_DOWN', label: 'Step-Down Telemetry (Level 2)' },
];

const BED_TYPES = [
  { id: 'STANDARD', label: 'Standard Hospital Bed' },
  { id: 'ICU', label: 'ICU Critical Care Bed (Ventilator & Telemetry ready)' },
  { id: 'ISOLATION', label: 'Negative Pressure Airborne Isolation' },
  { id: 'BARIATRIC', label: 'Bariatric High-Capacity Bed' },
  { id: 'STEP_DOWN', label: 'Step-Down Telemetry Bed' },
];

export default function RegisterBedModal({ isOpen, onClose, onBedCreated }) {
  const [bedCode, setBedCode] = useState('');
  const [department, setDepartment] = useState('EMERGENCY');
  const [roomNumber, setRoomNumber] = useState('');
  const [bedType, setBedType] = useState('STANDARD');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!bedCode.trim()) {
      setError('Please provide a unique bed code (e.g. ED-09, ICU-12).');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onBedCreated({
        bed_code: bedCode.trim().toUpperCase(),
        department,
        room_number: roomNumber.trim() || undefined,
        bed_type: bedType,
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to register bed. Bed code may already exist.');
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
      }}
    >
      <div
        className="palette"
        style={{
          width: '100%',
          maxWidth: '520px',
          background: '#090f1d',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: '16px',
          color: '#f8fafc',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(96, 165, 250, 0.15)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Register Hospital Bed Modal"
      >
        <header
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.35)',
                display: 'grid',
                placeItems: 'center',
                color: '#4ade80',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" />
              </svg>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 650, color: '#fff' }}>
                Register Hospital Bed
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#94a3b8' }}>
                Add a physical bed location to hospital inventory
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
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '5px' }}>
              Bed Code (Unique Identifier)
            </label>
            <input
              type="text"
              required
              placeholder="e.g. ED-09, ICU-12, W-304"
              value={bedCode}
              onChange={(e) => setBedCode(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#fff',
                fontSize: '13px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '5px' }}>
              Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#fff',
                fontSize: '13px',
              }}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '5px' }}>
              Room Number / Bay Label (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Bay 4, Room 204, Resus-1"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#fff',
                fontSize: '13px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '5px' }}>
              Bed Type & Equipment Capabilities
            </label>
            <select
              value={bedType}
              onChange={(e) => setBedType(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#fff',
                fontSize: '13px',
              }}
            >
              {BED_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <footer
            style={{
              marginTop: '10px',
              paddingTop: '16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#cbd5e1',
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !bedCode.trim()}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                background: bedCode.trim() ? 'linear-gradient(135deg, #16a34a, #15803d)' : '#334155',
                border: 'none',
                color: '#fff',
                fontSize: '12.5px',
                fontWeight: 650,
                cursor: bedCode.trim() && !submitting ? 'pointer' : 'not-allowed',
                boxShadow: bedCode.trim() ? '0 4px 14px rgba(22, 163, 74, 0.4)' : 'none',
              }}
            >
              {submitting ? 'Registering…' : 'Register Bed into Inventory'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
