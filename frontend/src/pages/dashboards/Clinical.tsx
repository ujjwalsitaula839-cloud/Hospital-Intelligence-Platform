import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import type {
  AcuityLevel,
  Admission,
  Bed,
  BedEvent,
  BedStatus,
  EquipmentItem,
  Observation,
  ObservationInput,
  Patient,
  PatientCreateInput,
  PatientUpdateInput,
} from '../../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function getStatusBadge(status: BedStatus): { text: string; className: string } {
  switch (status) {
    case 'AVAILABLE':
      return { text: 'AVAILABLE', className: 'bg-green-950 text-green-300 border border-green-700' };
    case 'RESERVED':
      return { text: 'RESERVED', className: 'bg-yellow-950 text-yellow-300 border border-yellow-700' };
    case 'OCCUPIED':
      return { text: 'OCCUPIED', className: 'bg-red-950 text-red-300 border border-red-700' };
    case 'DIRTY':
      return { text: 'DIRTY', className: 'bg-orange-950 text-orange-300 border border-orange-700' };
    case 'CLEANING_IN_PROGRESS':
      return { text: 'CLEANING', className: 'bg-blue-950 text-blue-300 border border-blue-700' };
    case 'MAINTENANCE':
    default:
      return { text: status, className: 'bg-zinc-800 text-zinc-300 border border-zinc-700' };
  }
}

export default function Clinical(): React.ReactElement {
  const { claims, logout } = useAuth();
  const navigate = useNavigate();

  // Active module navigation
  const [activeTab, setActiveTab] = useState<'beds' | 'patients' | 'vitals' | 'equipment'>('beds');

  // Beds state
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [bedDeptFilter, setBedDeptFilter] = useState<string>('ALL');
  const [bedStatusFilter, setBedStatusFilter] = useState<string>('ALL');

  // Patients state
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [patientSearchFilter, setPatientSearchFilter] = useState('');

  // Equipment state
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [eqTypeFilter, setEqTypeFilter] = useState('ALL');
  const [eqStatusFilter, setEqStatusFilter] = useState('ALL');

  // Vitals state
  const [activeAdmissions, setActiveAdmissions] = useState<{ admission_id: number; bed_code: string; patient_id?: number | null }[]>([]);
  const [selectedVitalsAdmId, setSelectedVitalsAdmId] = useState<number | null>(null);
  const [vitalsHistory, setVitalsHistory] = useState<Observation[]>([]);
  const [vitalsLoading, setVitalsLoading] = useState(false);

  // Modals & Drawers
  const [admitBed, setAdmitBed] = useState<Bed | null>(null);
  const [transferFromBed, setTransferFromBed] = useState<Bed | null>(null);
  const [transferToBedCode, setTransferToBedCode] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  const [dischargeBed, setDischargeBed] = useState<Bed | null>(null);
  const [isDischarging, setIsDischarging] = useState(false);
  const [dischargeError, setDischargeError] = useState<string | null>(null);

  // Admission Drawer Form State
  const [admitSearchQuery, setAdmitSearchQuery] = useState('');
  const [admitSearchResults, setAdmitSearchResults] = useState<Patient[]>([]);
  const [selectedAdmitPatient, setSelectedAdmitPatient] = useState<Patient | null>(null);
  const [admitAcuity, setAdmitAcuity] = useState<AcuityLevel>('ESI_3');
  const [admitDiagnosis, setAdmitDiagnosis] = useState('');
  const [admitDirectlyToOccupied, setAdmitDirectlyToOccupied] = useState(true);
  const [isAdmitting, setIsAdmitting] = useState(false);
  const [admitError, setAdmitError] = useState<string | null>(null);

  // Patient Registration Modal State
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [newPatient, setNewPatient] = useState<PatientCreateInput>({
    first_name: '',
    last_name: '',
    middle_name: '',
    date_of_birth: '',
    gender: 'MALE',
    phone: '',
    address: '',
  });
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Patient Edit Modal State (Allowed for Nurse, Doctor, Admin; Forbidden for Cleaning Crew)
  const canEditPatient = claims?.role === 'ADMIN' || claims?.role === 'DOCTOR' || claims?.role === 'NURSE';
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [editPatientForm, setEditPatientForm] = useState<PatientUpdateInput>({});
  const [editPatientError, setEditPatientError] = useState<string | null>(null);
  const [isUpdatingPatient, setIsUpdatingPatient] = useState(false);

  // Patient Chart Drawer State
  const [chartPatient, setChartPatient] = useState<Patient | null>(null);
  const [patientAdmissions, setPatientAdmissions] = useState<Admission[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  // Vitals Charting Modal / Input Form State
  const [chartingAdmissionId, setChartingAdmissionId] = useState<number | null>(null);
  const [chartingBedCode, setChartingBedCode] = useState<string | null>(null);
  const [vitalsForm, setVitalsForm] = useState<ObservationInput>({
    heart_rate_bpm: null,
    systolic_bp: null,
    diastolic_bp: null,
    oxygen_saturation_pct: null,
    temperature_celsius: null,
    respiratory_rate: null,
    notes: '',
  });
  const [vitalsSubmitError, setVitalsSubmitError] = useState<string | null>(null);
  const [isSubmittingVitals, setIsSubmittingVitals] = useState(false);

  // Allocate Equipment Modal State
  const [allocatingEquipment, setAllocatingEquipment] = useState<EquipmentItem | null>(null);
  const [targetBedForEquip, setTargetBedForEquip] = useState<string>('');
  const [allocateError, setAllocateError] = useState<string | null>(null);
  const [isAllocating, setIsAllocating] = useState(false);

  // Fetch Beds
  const fetchBeds = async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setBedsLoading(true);
    try {
      const data = await api.getBeds();
      setBeds(data);
      const active = data
        .filter((b) => (b.status === 'OCCUPIED' || b.status === 'RESERVED') && b.admission_id)
        .map((b) => ({
          admission_id: b.admission_id as number,
          bed_code: b.bed_code,
          patient_id: b.patient_id,
        }));
      setActiveAdmissions(active);
    } catch {
      // Non-blocking fetch error
    } finally {
      if (!silent) setBedsLoading(false);
    }
  };

  // Fetch Patients
  const fetchPatients = async () => {
    setPatientsLoading(true);
    try {
      const data = await api.getPatients();
      setPatients(data);
    } catch {
      // Non-blocking fetch error
    } finally {
      setPatientsLoading(false);
    }
  };

  // Fetch Equipment
  const fetchEquipment = async () => {
    setEquipmentLoading(true);
    try {
      const data = await api.getEquipmentList();
      setEquipmentList(data);
    } catch {
      // Non-blocking fetch error
    } finally {
      setEquipmentLoading(false);
    }
  };

  // Fetch Vitals History for a selected admission
  const fetchObservations = async (admissionId: number) => {
    setVitalsLoading(true);
    try {
      const data = await api.getObservations(admissionId);
      setVitalsHistory(data);
    } catch {
      setVitalsHistory([]);
    } finally {
      setVitalsLoading(false);
    }
  };

  useEffect(() => {
    fetchBeds();
    fetchPatients();
  }, []);

  useEffect(() => {
    if (activeTab === 'patients') {
      fetchPatients();
    } else if (activeTab === 'equipment') {
      fetchEquipment();
    } else if (activeTab === 'vitals') {
      fetchBeds();
    }
  }, [activeTab]);

  useEffect(() => {
    if (selectedVitalsAdmId) {
      fetchObservations(selectedVitalsAdmId);
    }
  }, [selectedVitalsAdmId]);

interface LiveEventNotification {
  id: string;
  eventType: string;
  title: string;
  message: string;
  actor: string;
  bedCode?: string;
  status?: string;
  time: string;
}

  const [notifications, setNotifications] = useState<LiveEventNotification[]>([]);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  // Inline WebSocket connection for real-time bed mutations
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let timeoutId: number | null = null;
    let isUnmounted = false;

    const connect = () => {
      const token = sessionStorage.getItem('token');
      if (!token || isUnmounted) return;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = BASE_URL ? BASE_URL.replace(/^https?:\/\//, '') : (window.location.port === '5173' || window.location.port === '3000' ? 'localhost:8080' : window.location.host);
      ws = new WebSocket(`${wsProtocol}//${wsHost}/ws/beds?token=${encodeURIComponent(token)}`);

      ws.onopen = () => {
        setWsConnected(true);
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as BedEvent;

          // 1. Immediately patch local bed state
          setBeds((prev) =>
            prev.map((b) => {
              const matchesId = data.bed_id !== undefined && b.bed_id === data.bed_id;
              const matchesCode =
                data.bed_code !== undefined &&
                b.bed_code.toUpperCase() === data.bed_code.toUpperCase();
              if (matchesId || matchesCode) {
                return {
                  ...b,
                  status: (data.status as BedStatus) || b.status,
                  version: data.version !== undefined ? data.version : b.version + 1,
                  admission_id:
                    data.admission_id !== undefined ? data.admission_id : b.admission_id,
                };
              }
              return b;
            })
          );

          // 2. Spawn live pop-up toast notification
          const eventTitles: Record<string, string> = {
            BED_RESERVED: 'Bed Reserved',
            BED_OCCUPIED: 'Patient Admitted',
            BED_TRANSFER: 'Bed Transfer Completed',
            BED_DIRTY: 'Bed Discharged',
            BED_AVAILABLE: 'Bed Sanitized & Ready',
            BED_STATUS_CHANGED: 'Bed Status Override',
            EQUIPMENT_ALLOCATED: 'Equipment Allocated',
          };

          const title = eventTitles[data.event_type] || `Bed ${data.bed_code || ''} Updated`;
          const message = data.message || `Status updated to ${data.status || 'NEW'}`;
          const toastId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

          const newNotification: LiveEventNotification = {
            id: toastId,
            eventType: data.event_type,
            title,
            message,
            actor: data.actor || 'Clinical Staff',
            bedCode: data.bed_code || data.to_bed,
            status: data.status,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          };

          setNotifications((prev) => [newNotification, ...prev.slice(0, 4)]);

          // Auto-dismiss after 6 seconds
          setTimeout(() => {
            setNotifications((prev) => prev.filter((n) => n.id !== toastId));
          }, 6000);
        } catch {
          // Ignore parse errors
        }
        // Background-refresh full bed and admission details across all open dashboards
        fetchBeds({ silent: true });
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (isUnmounted) return;
        if (reconnectAttempts < 10) {
          reconnectAttempts++;
          timeoutId = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
        ws?.close();
      };
    };

    connect();

    return () => {
      isUnmounted = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Unmounted');
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => {
            ws?.close(1000, 'Unmounted');
          };
        }
      }
    };
  }, []);

  // Global Escape key listener to close drawers and modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAdmitBed(null);
        setTransferFromBed(null);
        setDischargeBed(null);
        setIsRegisterOpen(false);
        setEditingPatient(null);
        setChartPatient(null);
        setChartingAdmissionId(null);
        setAllocatingEquipment(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Debounced Patient Search inside Admission Drawer
  useEffect(() => {
    if (!admitBed || admitBed.status !== 'AVAILABLE') return;

    let isSubscribed = true;
    const searchPatients = async () => {
      const token = sessionStorage.getItem('token');
      const q = admitSearchQuery.trim();
      let url = `${BASE_URL}/patients/search?q=${encodeURIComponent(q)}`;
      if (q) {
        const parts = q.split(' ');
        if (parts.length > 1) {
          url += `&first_name=${encodeURIComponent(parts[0])}&last_name=${encodeURIComponent(parts[1])}`;
        } else {
          url += `&first_name=${encodeURIComponent(q)}&last_name=${encodeURIComponent(q)}`;
        }
      }

      try {
        const res = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (res.ok && isSubscribed) {
          const data = (await res.json()) as Patient[];
          setAdmitSearchResults(data);
        }
      } catch {
        // Ignore search fetch errors
      }
    };

    const timer = setTimeout(searchPatients, 250);
    return () => {
      isSubscribed = false;
      clearTimeout(timer);
    };
  }, [admitSearchQuery, admitBed]);

  // Unified patient roster for admission drawer (supports both dropdown browsing and instantaneous search/filter)
  const displayedAdmitRoster = useMemo(() => {
    if (!admitSearchQuery.trim()) {
      return patients;
    }
    const q = admitSearchQuery.toLowerCase().trim();
    const localMatches = patients.filter((p) => {
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      const mrn = String(p.patient_id);
      const phone = p.phone ? p.phone.toLowerCase() : '';
      return fullName.includes(q) || mrn.includes(q) || phone.includes(q);
    });
    const merged = [...localMatches];
    const seenIds = new Set(localMatches.map((p) => p.patient_id));
    for (const p of admitSearchResults) {
      if (!seenIds.has(p.patient_id)) {
        merged.push(p);
        seenIds.add(p.patient_id);
      }
    }
    return merged;
  }, [patients, admitSearchQuery, admitSearchResults]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Confirm Admission
  const handleAdmissionConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admitBed || !selectedAdmitPatient) {
      setAdmitError('Please select a patient to admit.');
      return;
    }

    setIsAdmitting(true);
    setAdmitError(null);

    try {
      const admission = await api.createAdmission({
        patient_id: selectedAdmitPatient.patient_id,
        acuity_level: admitAcuity,
        primary_diagnosis: admitDiagnosis.trim() || 'Clinical Observation',
      });

      await api.updateBedStatus(admitBed.bed_code, 'RESERVED', {
        admission_id: admission.admission_id,
        patient_id: selectedAdmitPatient.patient_id,
      });

      if (admitDirectlyToOccupied) {
        await api.updateBedStatus(admitBed.bed_code, 'OCCUPIED');
      }

      setAdmitBed(null);
      await fetchBeds();
      await fetchEquipment();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to admit patient.';
      setAdmitError(msg);
    } finally {
      setIsAdmitting(false);
    }
  };

  // Confirm Patient Arrival for RESERVED bed
  const handleConfirmArrival = async (bedCode: string) => {
    try {
      await api.updateBedStatus(bedCode, 'OCCUPIED');
      await fetchBeds();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to confirm arrival.';
      alert(msg);
    }
  };

  // Cancel Hold / Reservation for RESERVED bed
  const handleCancelReservation = async (bed: Bed) => {
    try {
      if (bed.admission_id) {
        await api.dischargeAdmission(bed.admission_id);
      } else {
        await api.updateBedStatus(bed.bed_code, 'DIRTY');
      }
      await fetchBeds();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel hold.';
      alert(msg);
    }
  };

  // Confirm Discharge
  const handleDischargeConfirm = async () => {
    if (!dischargeBed) return;

    setIsDischarging(true);
    setDischargeError(null);

    try {
      if (dischargeBed.admission_id) {
        await api.dischargeAdmission(dischargeBed.admission_id);
      } else {
        await api.updateBedStatus(dischargeBed.bed_code, 'DIRTY');
      }

      setDischargeBed(null);
      await fetchBeds();
      await fetchEquipment();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to discharge patient.';
      setDischargeError(msg);
    } finally {
      setIsDischarging(false);
    }
  };

  // Confirm Bed Transfer
  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferFromBed || !transferToBedCode) {
      setTransferError('Please select a destination bed.');
      return;
    }

    setIsTransferring(true);
    setTransferError(null);

    try {
      await api.transferBed({
        from_bed_code: transferFromBed.bed_code,
        to_bed_code: transferToBedCode,
      });
      setTransferFromBed(null);
      setTransferToBedCode('');
      await fetchBeds();
      await fetchEquipment();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bed transfer failed.';
      setTransferError(msg);
    } finally {
      setIsTransferring(false);
    }
  };

  // Register New Patient
  const handleRegisterPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatient.first_name || !newPatient.last_name || !newPatient.date_of_birth) {
      setRegisterError('First name, last name, and date of birth are required.');
      return;
    }

    setIsRegistering(true);
    setRegisterError(null);

    try {
      await api.registerPatient(newPatient);
      setIsRegisterOpen(false);
      setNewPatient({
        first_name: '',
        last_name: '',
        middle_name: '',
        date_of_birth: '',
        gender: 'MALE',
        phone: '',
        address: '',
      });
      await fetchPatients();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to register patient.';
      setRegisterError(msg);
    } finally {
      setIsRegistering(false);
    }
  };

  // Open Edit Patient Modal
  const handleOpenEditPatient = (p: Patient) => {
    setEditingPatient(p);
    setEditPatientForm({
      first_name: p.first_name,
      middle_name: p.middle_name || '',
      last_name: p.last_name,
      date_of_birth: p.date_of_birth,
      gender: p.gender,
      phone: p.phone || '',
      address: p.address || '',
      is_active: p.is_active,
    });
    setEditPatientError(null);
  };

  // Save Patient Profile Edits
  const handleSavePatientEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPatient) return;

    setIsUpdatingPatient(true);
    setEditPatientError(null);

    try {
      const updated = await api.updatePatient(editingPatient.patient_id, {
        first_name: editPatientForm.first_name?.trim() || undefined,
        middle_name: editPatientForm.middle_name?.trim() || null,
        last_name: editPatientForm.last_name?.trim() || undefined,
        date_of_birth: editPatientForm.date_of_birth || undefined,
        gender: editPatientForm.gender,
        phone: editPatientForm.phone?.trim() || null,
        address: editPatientForm.address?.trim() || null,
        is_active: editPatientForm.is_active,
      });

      setPatients((prev) => prev.map((p) => (p.patient_id === updated.patient_id ? updated : p)));
      if (chartPatient?.patient_id === updated.patient_id) {
        setChartPatient(updated);
      }
      setEditingPatient(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update patient details.';
      setEditPatientError(msg);
    } finally {
      setIsUpdatingPatient(false);
    }
  };

  // Open Patient Chart
  const handleOpenPatientChart = async (patient: Patient) => {
    setChartPatient(patient);
    setChartLoading(true);
    try {
      const data = await api.getAdmissions(patient.patient_id);
      setPatientAdmissions(data);
    } catch {
      setPatientAdmissions([]);
    } finally {
      setChartLoading(false);
    }
  };

  // Submit Vitals Observation
  const handleSubmitVitals = async (e: React.FormEvent) => {
    e.preventDefault();
    const admId = chartingAdmissionId || selectedVitalsAdmId;
    if (!admId) {
      setVitalsSubmitError('No active admission selected.');
      return;
    }

    setIsSubmittingVitals(true);
    setVitalsSubmitError(null);

    try {
      await api.recordObservation(admId, {
        heart_rate_bpm: vitalsForm.heart_rate_bpm ? Number(vitalsForm.heart_rate_bpm) : null,
        systolic_bp: vitalsForm.systolic_bp ? Number(vitalsForm.systolic_bp) : null,
        diastolic_bp: vitalsForm.diastolic_bp ? Number(vitalsForm.diastolic_bp) : null,
        oxygen_saturation_pct: vitalsForm.oxygen_saturation_pct ? Number(vitalsForm.oxygen_saturation_pct) : null,
        temperature_celsius: vitalsForm.temperature_celsius ? Number(vitalsForm.temperature_celsius) : null,
        respiratory_rate: vitalsForm.respiratory_rate ? Number(vitalsForm.respiratory_rate) : null,
        notes: vitalsForm.notes?.trim() || null,
      });

      setVitalsForm({
        heart_rate_bpm: null,
        systolic_bp: null,
        diastolic_bp: null,
        oxygen_saturation_pct: null,
        temperature_celsius: null,
        respiratory_rate: null,
        notes: '',
      });

      if (chartingAdmissionId) {
        setChartingAdmissionId(null);
      }
      if (selectedVitalsAdmId) {
        await fetchObservations(selectedVitalsAdmId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record vitals.';
      setVitalsSubmitError(msg);
    } finally {
      setIsSubmittingVitals(false);
    }
  };

  // Allocate Equipment to Selected Bed
  const handleAllocateEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocatingEquipment || !targetBedForEquip) {
      setAllocateError('Please select a target bed.');
      return;
    }

    setIsAllocating(true);
    setAllocateError(null);

    try {
      const selectedBedObj = beds.find((b) => b.bed_code === targetBedForEquip);
      if (selectedBedObj && (selectedBedObj.status === 'DIRTY' || selectedBedObj.status === 'CLEANING_IN_PROGRESS' || selectedBedObj.status === 'MAINTENANCE')) {
        setAllocateError(`Cannot allocate equipment to bed ${selectedBedObj.bed_code}: bed is currently ${selectedBedObj.status} and must be cleaned and sanitized first.`);
        return;
      }
      await api.allocateEquipment({
        equipment_id: allocatingEquipment.equipment_id,
        admission_id: selectedBedObj?.admission_id || undefined,
        bed_code: targetBedForEquip,
      });
      setAllocatingEquipment(null);
      setTargetBedForEquip('');
      await fetchEquipment();
      await fetchBeds();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to allocate equipment.';
      setAllocateError(msg);
    } finally {
      setIsAllocating(false);
    }
  };

  // Release Equipment
  const handleReleaseEquipment = async (allocationId: number) => {
    try {
      await api.releaseEquipment(allocationId);
      await fetchEquipment();
      await fetchBeds();
    } catch {
      // release error handling
    }
  };

  // Filtered patients
  const filteredPatients = patients.filter((p) => {
    if (!patientSearchFilter.trim()) return true;
    const term = patientSearchFilter.toLowerCase();
    const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
    const phone = p.phone ? p.phone.toLowerCase() : '';
    const idStr = String(p.patient_id);
    return fullName.includes(term) || phone.includes(term) || idStr.includes(term);
  });

  // Filtered equipment
  const filteredEquipment = equipmentList.filter((eq) => {
    const matchesType = eqTypeFilter === 'ALL' || eq.equipment_type.toLowerCase() === eqTypeFilter.toLowerCase();
    const matchesStatus = eqStatusFilter === 'ALL' || eq.status === eqStatusFilter;
    return matchesType && matchesStatus;
  });

  const availableBedsForTransfer = beds.filter(
    (b) => b.status === 'AVAILABLE' && b.bed_code !== transferFromBed?.bed_code
  );

  const displayedBeds = beds.filter((b) => {
    const matchesDept = bedDeptFilter === 'ALL' || b.department.toUpperCase() === bedDeptFilter.toUpperCase();
    const matchesStatus =
      bedStatusFilter === 'ALL' ||
      (bedStatusFilter === 'DIRTY'
        ? b.status === 'DIRTY' || b.status === 'CLEANING_IN_PROGRESS'
        : b.status === bedStatusFilter);
    return matchesDept && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Real-time WebSocket Live Telemetry Notifications */}
      <div className="fixed top-16 right-5 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none">
        {notifications.map((n) => {
          const badgeColor =
            n.status === 'AVAILABLE'
              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-700/80'
              : n.status === 'RESERVED'
              ? 'bg-amber-950/90 text-amber-300 border-amber-700/80'
              : n.status === 'OCCUPIED'
              ? 'bg-sky-950/90 text-sky-300 border-sky-700/80'
              : n.status === 'DIRTY'
              ? 'bg-red-950/90 text-red-300 border-red-700/80'
              : 'bg-zinc-800 text-zinc-300 border-zinc-700';

          return (
            <div
              key={n.id}
              className="pointer-events-auto bg-zinc-900/95 border border-zinc-700/90 shadow-2xl rounded-xs p-3.5 backdrop-blur-md transition-all animate-in slide-in-from-top-3 duration-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center space-x-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className={`text-[10px] font-mono uppercase font-bold tracking-wider px-2 py-0.5 border ${badgeColor}`}>
                    {n.status || n.eventType}
                  </span>
                  {n.bedCode && (
                    <span className="font-mono text-xs font-bold text-white bg-zinc-950 px-1.5 py-0.5 border border-zinc-800">
                      {n.bedCode}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setNotifications((prev) => prev.filter((item) => item.id !== n.id))}
                  className="text-zinc-500 hover:text-zinc-300 text-xs font-mono leading-none"
                  aria-label="Dismiss notification"
                >
                  ✕
                </button>
              </div>

              <div className="mt-2">
                <p className="text-xs font-bold text-white">{n.title}</p>
                <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{n.message}</p>
              </div>

              <div className="mt-2.5 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] font-mono text-zinc-400">
                <span>By: <span className="text-zinc-200 font-semibold">{n.actor}</span></span>
                <span>{n.time}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2.5 pr-3.5 border-r border-zinc-800">
              <img src="/logo_icon.png" alt="HIP Logo" className="h-7 w-7 object-contain bg-zinc-950 p-0.5 border border-zinc-800 rounded-xs" />
              <span className="font-display font-bold text-white text-sm tracking-tight hidden sm:inline">
                HIP
              </span>
            </div>
            <span className="font-mono text-xs uppercase px-2.5 py-1 bg-red-950 border border-red-800 text-red-300 font-bold tracking-wider">
              {claims?.role || 'CLINICAL'}
            </span>
            <span className="text-sm text-zinc-200">
              Staff: <span className="font-semibold text-white">{claims?.full_name || claims?.username || 'Staff'}</span>
            </span>
            <span className="text-xs font-mono text-zinc-500">• {claims?.department || 'EMERGENCY'}</span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Live Telemetry status */}
            <div className="flex items-center space-x-2 px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-xs">
              <span className={`inline-block h-2 w-2 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[10px] font-mono tracking-wider text-zinc-300">
                {wsConnected ? 'LIVE SYNC' : 'RECONNECTING'}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white px-3 py-1.5 text-xs font-mono tracking-wider transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </header>

      {/* Clinical Sub-Navigation Bar */}
      <div className="border-b border-zinc-800 bg-zinc-900/30 px-6">
        <div className="max-w-7xl mx-auto flex space-x-8">
          <button
            onClick={() => setActiveTab('beds')}
            className={`py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'beds'
                ? 'border-white text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>🛏 Bed Grid & Telemetry</span>
            <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded-xs text-zinc-400">
              {beds.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('patients')}
            className={`py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'patients'
                ? 'border-white text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>👥 Patient Directory</span>
            <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded-xs text-zinc-400">
              {patients.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('vitals')}
            className={`py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'vitals'
                ? 'border-white text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>🩺 Vitals & Observations</span>
            <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded-xs text-zinc-400">
              {activeAdmissions.length} active
            </span>
          </button>

          <button
            onClick={() => setActiveTab('equipment')}
            className={`py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'equipment'
                ? 'border-white text-white font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>⚡ Equipment Hub</span>
            <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded-xs text-zinc-400">
              {equipmentList.length}
            </span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto p-6 flex-1 w-full">
        {/* ================================================================= */}
        {/* MODULE 1: BED GRID & TELEMETRY */}
        {/* ================================================================= */}
        {activeTab === 'beds' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h1 className="font-display text-3xl font-bold text-white tracking-tight">
                  Hospital Bed Matrix
                </h1>
                <p className="text-xs font-mono text-zinc-400 mt-1 uppercase tracking-wider">
                  Live Telemetry • Click Available to Admit • Transfers, Vitals & Equipment Allocated
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => fetchBeds()}
                  className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white px-3 py-1.5 text-xs font-mono tracking-wider transition-colors"
                >
                  {bedsLoading ? 'Syncing...' : 'Refresh Grid'}
                </button>
              </div>
            </div>

            {/* KPI Census Summary Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5 font-mono text-xs">
              <div className="bg-zinc-900/80 border border-zinc-800 p-3 flex flex-col justify-between">
                <span className="text-zinc-500 uppercase text-[10px] tracking-wider">Total Beds</span>
                <span className="text-xl font-bold text-white mt-1">{beds.length}</span>
              </div>
              <div
                onClick={() => setBedStatusFilter(bedStatusFilter === 'AVAILABLE' ? 'ALL' : 'AVAILABLE')}
                className={`border p-3 flex flex-col justify-between cursor-pointer transition-colors ${
                  bedStatusFilter === 'AVAILABLE'
                    ? 'bg-green-950/60 border-green-700'
                    : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-green-400 uppercase text-[10px] tracking-wider font-semibold">Available</span>
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                </div>
                <span className="text-xl font-bold text-green-300 mt-1">
                  {beds.filter((b) => b.status === 'AVAILABLE').length}
                </span>
              </div>
              <div
                onClick={() => setBedStatusFilter(bedStatusFilter === 'OCCUPIED' ? 'ALL' : 'OCCUPIED')}
                className={`border p-3 flex flex-col justify-between cursor-pointer transition-colors ${
                  bedStatusFilter === 'OCCUPIED'
                    ? 'bg-red-950/60 border-red-700'
                    : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-red-400 uppercase text-[10px] tracking-wider font-semibold">Occupied</span>
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                </div>
                <span className="text-xl font-bold text-red-300 mt-1">
                  {beds.filter((b) => b.status === 'OCCUPIED').length}
                </span>
              </div>
              <div
                onClick={() => setBedStatusFilter(bedStatusFilter === 'RESERVED' ? 'ALL' : 'RESERVED')}
                className={`border p-3 flex flex-col justify-between cursor-pointer transition-colors ${
                  bedStatusFilter === 'RESERVED'
                    ? 'bg-yellow-950/60 border-yellow-700'
                    : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-yellow-400 uppercase text-[10px] tracking-wider font-semibold">Reserved (Hold)</span>
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                </div>
                <span className="text-xl font-bold text-yellow-300 mt-1">
                  {beds.filter((b) => b.status === 'RESERVED').length}
                </span>
              </div>
              <div
                onClick={() => setBedStatusFilter(bedStatusFilter === 'DIRTY' ? 'ALL' : 'DIRTY')}
                className={`border p-3 flex flex-col justify-between cursor-pointer transition-colors ${
                  bedStatusFilter === 'DIRTY'
                    ? 'bg-orange-950/60 border-orange-700'
                    : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-orange-400 uppercase text-[10px] tracking-wider font-semibold">Dirty / EVS</span>
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                </div>
                <span className="text-xl font-bold text-orange-300 mt-1">
                  {beds.filter((b) => b.status === 'DIRTY' || b.status === 'CLEANING_IN_PROGRESS').length}
                </span>
              </div>
            </div>

            {/* Quick Filters Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-zinc-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-mono uppercase text-zinc-500 mr-1">Unit:</span>
                {(['ALL', 'EMERGENCY', 'ICU', 'GENERAL_WARD', 'STEP_DOWN'] as const).map((dept) => (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => setBedDeptFilter(dept)}
                    className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border transition-colors ${
                      bedDeptFilter === dept
                        ? 'bg-white text-zinc-950 font-bold border-white'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {dept.replace('_', ' ')}
                  </button>
                ))}
              </div>

              {bedStatusFilter !== 'ALL' && (
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-zinc-400">Filtering: <strong className="text-white">{bedStatusFilter}</strong></span>
                  <button
                    type="button"
                    onClick={() => setBedStatusFilter('ALL')}
                    className="text-zinc-400 hover:text-white underline text-[10px]"
                  >
                    Clear Filter
                  </button>
                </div>
              )}
            </div>

            {/* Grid Container */}
            {bedsLoading ? (
              <div className="p-12 text-center border border-zinc-800 bg-zinc-900/40 text-zinc-400 font-mono text-xs">
                Synchronizing live bed matrix telemetry...
              </div>
            ) : displayedBeds.length === 0 ? (
              <div className="p-12 text-center border border-zinc-800 bg-zinc-900/40 text-zinc-400 font-mono text-xs">
                No hospital beds match the current filter selection.
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    onClick={() => {
                      setBedDeptFilter('ALL');
                      setBedStatusFilter('ALL');
                    }}
                    className="border border-zinc-700 hover:border-zinc-500 text-white px-3 py-1 text-xs"
                  >
                    Reset Filters
                  </button>
                  <button
                    onClick={() => fetchBeds()}
                    className="border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white px-3 py-1 text-xs"
                  >
                    Sync Grid
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
              >
                {displayedBeds.map((bed) => {
                  const badge = getStatusBadge(bed.status);
                  const isOccupied = bed.status === 'OCCUPIED';
                  const isAvailable = bed.status === 'AVAILABLE';

                  return (
                    <div
                      key={bed.bed_id}
                      className="bg-zinc-900 border border-zinc-800 p-4 text-left flex flex-col justify-between transition-colors hover:border-zinc-700"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider">
                            Rm {bed.room_number}
                          </span>
                          <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 ${badge.className}`}>
                            {badge.text}
                          </span>
                        </div>
                        <h2 className="text-xl font-bold font-mono text-white">{bed.bed_code}</h2>
                        <div className="text-[11px] font-mono text-zinc-400 mt-1">{bed.department}</div>

                        {/* Equipment Badges */}
                        {bed.equipment && bed.equipment.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {bed.equipment.map((eqName, eqIdx) => (
                              <span
                                key={eqIdx}
                                className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-950/70 border border-blue-800 text-blue-300"
                              >
                                ⚡ {eqName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-zinc-800">
                        {isAvailable && (
                          <button
                            type="button"
                            onClick={() => {
                              setAdmitBed(bed);
                              setSelectedAdmitPatient(null);
                              setAdmitSearchQuery('');
                              setAdmitSearchResults([]);
                              setAdmitDiagnosis('');
                              setAdmitAcuity('ESI_3');
                              setAdmitError(null);
                              if (patients.length === 0) {
                                fetchPatients();
                              }
                            }}
                            className="w-full bg-white text-zinc-950 hover:bg-zinc-200 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors"
                          >
                            + Admit Patient
                          </button>
                        )}

                        {isOccupied && (
                          <div className="space-y-2">
                            {/* Patient ID & Demographic Badge */}
                            <div className="p-2 bg-red-950/40 border border-red-900/60 font-mono text-[11px]">
                              <div className="flex items-center justify-between gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (bed.patient_id) {
                                      const found = patients.find((p) => p.patient_id === bed.patient_id);
                                      if (found) {
                                        handleOpenPatientChart(found);
                                      } else {
                                        handleOpenPatientChart({
                                          patient_id: bed.patient_id,
                                          first_name: bed.patient_name?.split(' ')[0] || 'Patient',
                                          last_name: bed.patient_name?.split(' ').slice(1).join(' ') || `#${bed.patient_id}`,
                                          date_of_birth: '',
                                          gender: 'OTHER',
                                          is_active: true,
                                        });
                                      }
                                    }
                                  }}
                                  className="font-bold text-white hover:underline text-left truncate flex-1"
                                  title="Click to view complete patient chart"
                                >
                                  👤 {bed.patient_name || `Patient #${bed.patient_id || 'Unknown'}`}
                                </button>
                                {bed.acuity_level && (
                                  <span
                                    className={`text-[9px] px-1 py-0.2 border shrink-0 ${
                                      bed.acuity_level === 'ESI_1' || bed.acuity_level === 'ESI_2'
                                        ? 'bg-red-900 text-white border-red-700 font-bold'
                                        : 'bg-yellow-950 text-yellow-300 border-yellow-800'
                                    }`}
                                  >
                                    {bed.acuity_level.replace('ESI_', 'ESI-')}
                                  </span>
                                )}
                              </div>
                              {bed.primary_diagnosis && (
                                <div className="text-zinc-400 text-[10px] truncate mt-0.5" title={bed.primary_diagnosis}>
                                  Dx: {bed.primary_diagnosis}
                                </div>
                              )}
                              <div className="text-zinc-500 text-[10px] mt-0.5">
                                Stay #{bed.admission_id} • MRN #{bed.patient_id || 'N/A'}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-1.5 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setChartingAdmissionId(bed.admission_id || null);
                                  setChartingBedCode(bed.bed_code);
                                  setVitalsSubmitError(null);
                                }}
                                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-1 px-2 text-[11px] font-mono tracking-wider text-center"
                              >
                                Chart Vitals
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setTransferFromBed(bed);
                                  setTransferToBedCode('');
                                  setTransferError(null);
                                }}
                                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-1 px-2 text-[11px] font-mono tracking-wider text-center"
                              >
                                Transfer
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setDischargeBed(bed);
                                setDischargeError(null);
                              }}
                              className="w-full border border-red-900 bg-red-950/40 hover:bg-red-900/60 text-red-300 py-1 text-[11px] font-mono tracking-wider transition-colors"
                            >
                              Discharge
                            </button>
                          </div>
                        )}

                        {bed.status === 'RESERVED' && (
                          <div className="space-y-2 pt-1">
                            {/* Reserved Patient Badge */}
                            <div className="p-2 bg-yellow-950/40 border border-yellow-900/60 font-mono text-[11px]">
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-bold text-yellow-200 truncate flex-1">
                                  ⏳ {bed.patient_name || `Patient #${bed.patient_id || 'Pending'}`}
                                </span>
                                {bed.acuity_level && (
                                  <span className="text-[9px] px-1 py-0.2 border bg-yellow-900/80 text-yellow-200 border-yellow-700 shrink-0">
                                    {bed.acuity_level.replace('ESI_', 'ESI-')}
                                  </span>
                                )}
                              </div>
                              {bed.primary_diagnosis && (
                                <div className="text-zinc-400 text-[10px] truncate mt-0.5" title={bed.primary_diagnosis}>
                                  Dx: {bed.primary_diagnosis}
                                </div>
                              )}
                              <div className="text-yellow-500/80 text-[10px] mt-0.5">
                                Hold: Stay #{bed.admission_id || 'Active'} • MRN #{bed.patient_id || 'N/A'}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleConfirmArrival(bed.bed_code)}
                              className="w-full bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold py-1.5 text-xs font-mono uppercase tracking-wider transition-colors shadow-sm"
                            >
                              ✓ Bed Patient (Occupy)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelReservation(bed)}
                              className="w-full border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white py-1 text-[11px] font-mono uppercase tracking-wider transition-colors"
                            >
                              Cancel Hold
                            </button>
                          </div>
                        )}

                        {!isAvailable && !isOccupied && bed.status !== 'RESERVED' && (
                          <div className="text-[11px] font-mono text-zinc-500 py-1">
                            {bed.status === 'DIRTY' && 'Awaiting housekeeping'}
                            {bed.status === 'CLEANING_IN_PROGRESS' && 'Sanitization in progress'}
                            {bed.status === 'MAINTENANCE' && 'Device maintenance'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* MODULE 2: PATIENT DIRECTORY & ROSTER */}
        {/* ================================================================= */}
        {activeTab === 'patients' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800 mb-6">
              <div>
                <h1 className="font-display text-3xl font-bold text-white tracking-tight">
                  Master Patient Registry
                </h1>
                <p className="text-xs font-mono text-zinc-400 mt-1 uppercase tracking-wider">
                  HIPAA Master Index • Complete Encounters, Demographic Editing & Profiles
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    setIsRegisterOpen(true);
                    setRegisterError(null);
                  }}
                  className="bg-white text-zinc-950 hover:bg-zinc-200 px-4 py-2 text-xs font-mono uppercase tracking-wider font-bold transition-colors"
                >
                  + Register New Patient
                </button>
              </div>
            </div>

            {/* Search filter bar */}
            <div className="mb-6 max-w-md">
              <input
                type="text"
                value={patientSearchFilter}
                onChange={(e) => setPatientSearchFilter(e.target.value)}
                placeholder="Filter by name, phone, or MRN ID..."
                className="w-full bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* Patients Table */}
            <div className="border border-zinc-800 bg-zinc-900 overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 uppercase">
                  <tr>
                    <th className="p-3">MRN / ID</th>
                    <th className="p-3">Legal Name</th>
                    <th className="p-3">DOB</th>
                    <th className="p-3">Gender</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {patientsLoading ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-zinc-500 font-mono">
                        Loading patient records...
                      </td>
                    </tr>
                  ) : filteredPatients.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-zinc-500 font-mono">
                        No patients found matching query.
                      </td>
                    </tr>
                  ) : (
                    filteredPatients.map((p) => (
                      <tr key={p.patient_id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="p-3 font-bold text-white">#{p.patient_id}</td>
                        <td className="p-3 font-semibold text-zinc-200">
                          {p.first_name} {p.middle_name ? `${p.middle_name} ` : ''}{p.last_name}
                        </td>
                        <td className="p-3 text-zinc-400">{p.date_of_birth}</td>
                        <td className="p-3 text-zinc-400">{p.gender}</td>
                        <td className="p-3 text-zinc-300">
                          {p.phone ? (
                            <span>{p.phone}</span>
                          ) : (
                            <span className="text-zinc-600 italic">None recorded</span>
                          )}
                        </td>
                        <td className="p-3">
                          {p.is_active ? (
                            <span className="text-green-400 bg-green-950/40 border border-green-800 px-1.5 py-0.5 text-[10px]">
                              ACTIVE
                            </span>
                          ) : (
                            <span className="text-red-400 bg-red-950/40 border border-red-800 px-1.5 py-0.5 text-[10px]">
                              DEACTIVATED
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            {canEditPatient && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditPatient(p)}
                                className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white px-2 py-1 text-xs font-mono tracking-wider transition-colors"
                              >
                                Edit
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenPatientChart(p)}
                              className="bg-zinc-800 hover:bg-zinc-700 text-white px-2.5 py-1 text-xs font-mono tracking-wider transition-colors"
                            >
                              View Chart
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODULE 3: VITALS & OBSERVATION STATION */}
        {/* ================================================================= */}
        {activeTab === 'vitals' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800 mb-6">
              <div>
                <h1 className="font-display text-3xl font-bold text-white tracking-tight">
                  Clinical Observation & Vitals Ledger
                </h1>
                <p className="text-xs font-mono text-zinc-400 mt-1 uppercase tracking-wider">
                  21 CFR Part 11 Medico-Legal Append-Only Vitals Registry
                </p>
              </div>
            </div>

            {/* Active Admission Selector */}
            <div className="bg-zinc-900 border border-zinc-800 p-5 mb-8">
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-2">
                Select Active Inpatient Stay:
              </label>
              {activeAdmissions.length === 0 ? (
                <p className="text-xs font-mono text-zinc-500">
                  No active inpatient stays currently assigned to beds. Admit a patient from the Bed Grid to record vitals.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeAdmissions.map((adm) => {
                    const isSelected = selectedVitalsAdmId === adm.admission_id;
                    return (
                      <button
                        key={adm.admission_id}
                        type="button"
                        onClick={() => setSelectedVitalsAdmId(adm.admission_id)}
                        className={`px-4 py-2 border text-xs font-mono uppercase tracking-wider transition-colors ${
                          isSelected
                            ? 'bg-white text-zinc-950 font-bold border-white'
                            : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        Bed {adm.bed_code} (Stay #{adm.admission_id})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedVitalsAdmId && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Vitals Form Column */}
                <div className="bg-zinc-900 border border-zinc-800 p-6">
                  <h2 className="text-lg font-bold font-mono text-white mb-1">
                    Chart New Observation
                  </h2>
                  <p className="text-xs font-mono text-zinc-400 mb-6">
                    Admission Stay #{selectedVitalsAdmId}
                  </p>

                  {vitalsSubmitError && (
                    <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                      {vitalsSubmitError}
                    </div>
                  )}

                  <form onSubmit={handleSubmitVitals} className="space-y-4 font-mono text-xs">
                    <div>
                      <label className="block uppercase text-zinc-400 mb-1">Heart Rate (bpm)</label>
                      <input
                        type="number"
                        min={1}
                        max={299}
                        value={vitalsForm.heart_rate_bpm ?? ''}
                        onChange={(e) =>
                          setVitalsForm((p) => ({
                            ...p,
                            heart_rate_bpm: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        placeholder="e.g. 72"
                        className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-white focus:outline-none focus:border-zinc-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block uppercase text-zinc-400 mb-1">Systolic BP</label>
                        <input
                          type="number"
                          min={1}
                          max={349}
                          value={vitalsForm.systolic_bp ?? ''}
                          onChange={(e) =>
                            setVitalsForm((p) => ({
                              ...p,
                              systolic_bp: e.target.value ? Number(e.target.value) : null,
                            }))
                          }
                          placeholder="120"
                          className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-white focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                      <div>
                        <label className="block uppercase text-zinc-400 mb-1">Diastolic BP</label>
                        <input
                          type="number"
                          min={1}
                          max={249}
                          value={vitalsForm.diastolic_bp ?? ''}
                          onChange={(e) =>
                            setVitalsForm((p) => ({
                              ...p,
                              diastolic_bp: e.target.value ? Number(e.target.value) : null,
                            }))
                          }
                          placeholder="80"
                          className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-white focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block uppercase text-zinc-400 mb-1">Oxygen Saturation (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        max={100}
                        value={vitalsForm.oxygen_saturation_pct ?? ''}
                        onChange={(e) =>
                          setVitalsForm((p) => ({
                            ...p,
                            oxygen_saturation_pct: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        placeholder="e.g. 98.5"
                        className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-white focus:outline-none focus:border-zinc-500"
                      />
                    </div>

                    <div>
                      <label className="block uppercase text-zinc-400 mb-1">Temperature (°C)</label>
                      <input
                        type="number"
                        step="0.1"
                        min={25}
                        max={45}
                        value={vitalsForm.temperature_celsius ?? ''}
                        onChange={(e) =>
                          setVitalsForm((p) => ({
                            ...p,
                            temperature_celsius: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        placeholder="e.g. 37.0"
                        className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-white focus:outline-none focus:border-zinc-500"
                      />
                    </div>

                    <div>
                      <label className="block uppercase text-zinc-400 mb-1">Respiratory Rate (/min)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={vitalsForm.respiratory_rate ?? ''}
                        onChange={(e) =>
                          setVitalsForm((p) => ({
                            ...p,
                            respiratory_rate: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        placeholder="e.g. 16"
                        className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-white focus:outline-none focus:border-zinc-500"
                      />
                    </div>

                    <div>
                      <label className="block uppercase text-zinc-400 mb-1">Clinical Commentary / Notes</label>
                      <textarea
                        rows={2}
                        value={vitalsForm.notes ?? ''}
                        onChange={(e) => setVitalsForm((p) => ({ ...p, notes: e.target.value }))}
                        placeholder="Patient alert, resting comfortably..."
                        className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingVitals}
                      className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 font-bold uppercase tracking-wider transition-colors mt-2"
                    >
                      {isSubmittingVitals ? 'Writing to Ledger...' : 'Commit Observation'}
                    </button>
                  </form>
                </div>

                {/* Vitals History Ledger Column */}
                <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold font-mono text-white">
                      Observation Ledger History
                    </h2>
                    <span className="text-xs font-mono text-zinc-500">
                      {vitalsHistory.length} total entries
                    </span>
                  </div>

                  {vitalsLoading ? (
                    <div className="p-8 text-center text-zinc-500 font-mono text-xs">
                      Loading observations...
                    </div>
                  ) : vitalsHistory.length === 0 ? (
                    <div className="border border-dashed border-zinc-800 p-12 text-center text-zinc-500 font-mono text-xs">
                      No vitals recorded yet for Admission #{selectedVitalsAdmId}.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {vitalsHistory.map((obs) => {
                        const isHighHR = (obs.heart_rate_bpm ?? 0) > 100;
                        const isLowSpo2 = (obs.oxygen_saturation_pct ?? 100) < 92;
                        const isFever = (obs.temperature_celsius ?? 0) >= 38.0;

                        return (
                          <div
                            key={obs.observation_id}
                            className="bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs"
                          >
                            <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-3 text-zinc-500">
                              <span>Entry #{obs.observation_id}</span>
                              <span>{new Date(obs.observation_datetime).toLocaleString()}</span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
                              <div>
                                <span className="text-zinc-500 block">HR:</span>
                                <span className={`font-bold ${isHighHR ? 'text-red-400' : 'text-white'}`}>
                                  {obs.heart_rate_bpm ? `${obs.heart_rate_bpm} bpm` : '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-zinc-500 block">BP:</span>
                                <span className="font-bold text-white">
                                  {obs.systolic_bp && obs.diastolic_bp
                                    ? `${obs.systolic_bp}/${obs.diastolic_bp}`
                                    : '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-zinc-500 block">SpO2:</span>
                                <span className={`font-bold ${isLowSpo2 ? 'text-red-400' : 'text-white'}`}>
                                  {obs.oxygen_saturation_pct ? `${obs.oxygen_saturation_pct}%` : '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-zinc-500 block">Temp:</span>
                                <span className={`font-bold ${isFever ? 'text-amber-400' : 'text-white'}`}>
                                  {obs.temperature_celsius ? `${obs.temperature_celsius} °C` : '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-zinc-500 block">RR:</span>
                                <span className="font-bold text-white">
                                  {obs.respiratory_rate ? `${obs.respiratory_rate} /min` : '—'}
                                </span>
                              </div>
                            </div>

                            {obs.notes && (
                              <p className="text-zinc-400 bg-zinc-900 p-2 border border-zinc-800/80 text-[11px]">
                                {obs.notes}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* MODULE 4: MEDICAL EQUIPMENT HUB */}
        {/* ================================================================= */}
        {activeTab === 'equipment' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800 mb-6">
              <div>
                <h1 className="font-display text-3xl font-bold text-white tracking-tight">
                  Medical Equipment Hub
                </h1>
                <p className="text-xs font-mono text-zinc-400 mt-1 uppercase tracking-wider">
                  Live Device Telemetry • Ventilators, Monitors, Pumps & Bed Allocation
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={fetchEquipment}
                  className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white px-3 py-1.5 text-xs font-mono tracking-wider transition-colors"
                >
                  {equipmentLoading ? 'Syncing...' : 'Refresh Inventory'}
                </button>
              </div>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap gap-4 mb-6 font-mono text-xs">
              <div className="flex items-center space-x-2">
                <span className="text-zinc-400 uppercase">Device Type:</span>
                <select
                  value={eqTypeFilter}
                  onChange={(e) => setEqTypeFilter(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 text-white px-3 py-1.5 focus:outline-none focus:border-zinc-500"
                >
                  <option value="ALL">All Categories</option>
                  <option value="Ventilator">Ventilator</option>
                  <option value="Cardiac Monitor">Cardiac Monitor</option>
                  <option value="Infusion Pump">Infusion Pump</option>
                  <option value="Crash Cart">Crash Cart</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-zinc-400 uppercase">Status:</span>
                <select
                  value={eqStatusFilter}
                  onChange={(e) => setEqStatusFilter(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 text-white px-3 py-1.5 focus:outline-none focus:border-zinc-500"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="AVAILABLE">AVAILABLE</option>
                  <option value="ALLOCATED">ALLOCATED</option>
                  <option value="MAINTENANCE">MAINTENANCE</option>
                </select>
              </div>
            </div>

            {/* Equipment Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {equipmentLoading ? (
                <div className="col-span-full p-12 text-center text-zinc-500 font-mono text-xs">
                  Loading medical equipment inventory...
                </div>
              ) : filteredEquipment.length === 0 ? (
                <div className="col-span-full border border-dashed border-zinc-800 p-12 text-center text-zinc-500 font-mono text-xs">
                  No equipment found matching criteria.
                </div>
              ) : (
                filteredEquipment.map((eq) => {
                  const isAvailable = eq.status === 'AVAILABLE';
                  const isAllocated = eq.status === 'ALLOCATED';
                  const activeAlloc = eq.allocations?.find((a) => a.status === 'ACTIVE');

                  return (
                    <div
                      key={eq.equipment_id}
                      className="bg-zinc-900 border border-zinc-800 p-5 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 bg-zinc-800 text-zinc-300">
                            {eq.equipment_type || 'DEVICE'}
                          </span>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 border ${
                              isAvailable
                                ? 'bg-green-950 text-green-300 border-green-700'
                                : isAllocated
                                ? 'bg-red-950 text-red-300 border-red-700'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            }`}
                          >
                            {eq.status}
                          </span>
                        </div>

                        <h2 className="text-lg font-bold font-mono text-white mt-1">
                          {eq.equipment_name}
                        </h2>
                        <div className="text-xs font-mono text-zinc-400 mt-1">
                          Serial: <span className="text-zinc-200">{eq.serial_number}</span>
                        </div>
                        <div className="text-xs font-mono text-zinc-500 mt-0.5">
                          Department: {eq.department}
                        </div>

                        {activeAlloc && (
                          <div className="mt-3 p-2.5 bg-zinc-950 border border-zinc-800 text-xs font-mono">
                            <span className="text-zinc-500 block uppercase text-[10px]">Current Deployment:</span>
                            <span className="text-red-300 font-bold">
                              {activeAlloc.admission_id > 0
                                ? `Admission #${activeAlloc.admission_id}`
                                : 'Assigned to Bed Station'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="mt-5 pt-3 border-t border-zinc-800">
                        {isAvailable ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAllocatingEquipment(eq);
                              setTargetBedForEquip('');
                              setAllocateError(null);
                            }}
                            className="w-full bg-white text-zinc-950 hover:bg-zinc-200 py-2 text-xs font-mono uppercase tracking-wider font-bold transition-colors"
                          >
                            Allocate to Bed
                          </button>
                        ) : activeAlloc ? (
                          <button
                            type="button"
                            onClick={() => handleReleaseEquipment(activeAlloc.equipment_allocation_id)}
                            className="w-full border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white py-2 text-xs font-mono uppercase tracking-wider transition-colors"
                          >
                            Release Machine
                          </button>
                        ) : (
                          <div className="text-xs font-mono text-zinc-600 py-1.5 text-center">
                            Unavailable
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>

      {/* ================================================================= */}
      {/* DRAWER: ADMISSION INTAKE */}
      {/* ================================================================= */}
      {admitBed && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-xs" onClick={() => setAdmitBed(null)} />
          <div className="relative z-10 w-full max-w-md bg-zinc-900 border-l border-zinc-800 h-full p-6 overflow-y-auto flex flex-col justify-between shadow-2xl">
            <div>
              <div className="flex items-start justify-between pb-4 border-b border-zinc-800 mb-6">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                    Intake Bed • Room {admitBed.room_number}
                  </div>
                  <h2 className="text-2xl font-bold font-mono text-white mt-1">
                    {admitBed.bed_code}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setAdmitBed(null)}
                  className="text-zinc-400 hover:text-white p-1 text-sm font-mono border border-zinc-800 hover:border-zinc-700"
                >
                  ESC ✕
                </button>
              </div>

              {admitBed.department === 'ICU' && (
                <div className="mb-4 p-3 bg-blue-950/40 border border-blue-800 text-blue-200 text-xs font-mono">
                  ⚡ <strong>ICU High-Acuity Unit</strong>: Available cardiac monitoring and life support telemetry are automatically provisioned upon reservation.
                </div>
              )}

              {admitError && (
                <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                  {admitError}
                </div>
              )}

              <form onSubmit={handleAdmissionConfirm} className="space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold">
                      1. Select Patient Roster
                    </label>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {patients.length} Registered
                    </span>
                  </div>

                  {/* Dropdown Menu for Quick & Easy Selection */}
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
                      Patient Dropdown Menu
                    </label>
                    <select
                      value={selectedAdmitPatient?.patient_id ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) {
                          setSelectedAdmitPatient(null);
                          return;
                        }
                        const pid = Number(val);
                        const found =
                          displayedAdmitRoster.find((p) => p.patient_id === pid) ||
                          patients.find((p) => p.patient_id === pid) ||
                          null;
                        if (found) {
                          setSelectedAdmitPatient(found);
                          setAdmitError(null);
                        }
                      }}
                      className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-zinc-500"
                    >
                      <option value="">
                        {patientsLoading
                          ? 'Loading patient roster...'
                          : `-- Select patient from dropdown (${displayedAdmitRoster.length} available) --`}
                      </option>
                      {displayedAdmitRoster.map((p) => (
                        <option key={p.patient_id} value={p.patient_id} disabled={!p.is_active}>
                          {p.first_name} {p.last_name} — MRN #{p.patient_id} ({p.gender}, DOB: {p.date_of_birth}){p.is_active ? '' : ' [DEACTIVATED]'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Search / Filter Input */}
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
                      Quick Search / Filter (Name or MRN)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={admitSearchQuery}
                        onChange={(e) => setAdmitSearchQuery(e.target.value)}
                        placeholder="Type to filter dropdown or search roster..."
                        className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 pr-8"
                      />
                      {admitSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setAdmitSearchQuery('')}
                          className="absolute right-2.5 top-2 text-xs font-mono text-zinc-400 hover:text-white"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Confirmed Patient Card */}
                  {selectedAdmitPatient ? (
                    <div className="p-3 bg-zinc-900 border border-green-800/80 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                          <span className="text-green-400">✓</span> {selectedAdmitPatient.first_name} {selectedAdmitPatient.last_name}
                          <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 border border-zinc-700">
                            MRN #{selectedAdmitPatient.patient_id}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                          DOB: {selectedAdmitPatient.date_of_birth} • Gender: {selectedAdmitPatient.gender} • Phone: {selectedAdmitPatient.phone || 'None on file'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedAdmitPatient(null)}
                        className="text-[10px] font-mono text-zinc-400 hover:text-red-400 border border-zinc-800 px-2 py-1 hover:border-red-800 transition-colors"
                      >
                        Change ✕
                      </button>
                    </div>
                  ) : admitSearchQuery ? (
                    /* Search results quick pick if filtering and not yet chosen */
                    <div className="max-h-36 overflow-y-auto border border-zinc-800 bg-zinc-950 divide-y divide-zinc-800">
                      {displayedAdmitRoster.length === 0 ? (
                        <div className="p-2.5 text-xs text-zinc-500 font-mono">
                          No matching patients found. Try clearing the filter.
                        </div>
                      ) : (
                        displayedAdmitRoster.map((p) => (
                          <button
                            key={p.patient_id}
                            type="button"
                            onClick={() => {
                              setSelectedAdmitPatient(p);
                              setAdmitError(null);
                            }}
                            className="w-full text-left p-2 text-xs font-mono transition-colors text-zinc-300 hover:bg-zinc-900 flex justify-between items-center"
                          >
                            <div>
                              <div className="font-bold text-white">{p.first_name} {p.last_name}</div>
                              <div className="text-[10px] text-zinc-500">
                                DOB: {p.date_of_birth} • Gender: {p.gender}
                              </div>
                            </div>
                            <span className="text-[10px] text-zinc-400 bg-zinc-800 px-1.5 py-0.5 border border-zinc-700">
                              MRN #{p.patient_id}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-2">
                    2. Emergency Severity Index (ESI Acuity)
                  </label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(['ESI_1', 'ESI_2', 'ESI_3', 'ESI_4', 'ESI_5'] as AcuityLevel[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setAdmitAcuity(lvl)}
                        className={`py-2 text-xs font-mono text-center border transition-colors ${
                          admitAcuity === lvl
                            ? 'border-white bg-white text-zinc-950 font-bold'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        {lvl.replace('ESI_', 'ESI-')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-2">
                    3. Primary Clinical Diagnosis
                  </label>
                  <input
                    type="text"
                    value={admitDiagnosis}
                    onChange={(e) => setAdmitDiagnosis(e.target.value)}
                    placeholder="e.g. Acute coronary syndrome / Observation"
                    className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                <div className="p-3 bg-zinc-950 border border-zinc-800 space-y-1.5">
                  <label className="flex items-start space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={admitDirectlyToOccupied}
                      onChange={(e) => setAdmitDirectlyToOccupied(e.target.checked)}
                      className="accent-white h-4 w-4 mt-0.5"
                    />
                    <div>
                      <span className="text-xs font-mono text-white font-bold block">
                        Admit & Occupy Bed Immediately
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400 block mt-0.5">
                        {admitDirectlyToOccupied
                          ? 'Patient is present. Bed transitions directly to OCCUPIED status.'
                          : 'Patient is en route/triage. Bed will be held in RESERVED status until arrival.'}
                      </span>
                    </div>
                  </label>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isAdmitting || !selectedAdmitPatient}
                    className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 text-xs font-mono uppercase tracking-wider font-bold transition-colors"
                  >
                    {isAdmitting
                      ? 'Processing Admission...'
                      : admitDirectlyToOccupied
                      ? 'Confirm & Occupy Bed Now'
                      : 'Reserve Bed (Triage Hold)'}
                  </button>
                </div>
              </form>
            </div>

            <div className="pt-6 border-t border-zinc-800 text-[11px] font-mono text-zinc-500">
              Press Escape or click outside to dismiss this panel.
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: BED TRANSFER */}
      {/* ================================================================= */}
      {transferFromBed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs" onClick={() => setTransferFromBed(null)} />
          <div className="relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Intra-Hospital Transfer</span>
                <h3 className="text-xl font-bold font-mono text-white">Transfer Patient Bed</h3>
              </div>
              <button
                type="button"
                onClick={() => setTransferFromBed(null)}
                className="text-zinc-400 hover:text-white text-sm font-mono"
              >
                ✕
              </button>
            </div>

            {transferError && (
              <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                {transferError}
              </div>
            )}

            <form onSubmit={handleTransferSubmit} className="space-y-4 font-mono text-xs">
              <div className="p-3 bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-500 block uppercase text-[10px]">Source Bed:</span>
                <span className="text-white font-bold text-sm">{transferFromBed.bed_code}</span>
                <span className="text-zinc-400 ml-2">(Stay #{transferFromBed.admission_id})</span>
              </div>

              <div>
                <label className="block uppercase text-zinc-300 mb-2">Target Bed (Must be AVAILABLE):</label>
                {availableBedsForTransfer.length === 0 ? (
                  <p className="text-zinc-500 p-3 bg-zinc-950 border border-zinc-800">
                    No available hospital beds currently in inventory.
                  </p>
                ) : (
                  <select
                    value={transferToBedCode}
                    onChange={(e) => setTransferToBedCode(e.target.value)}
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 p-2.5 text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="">Select available destination bed...</option>
                    {availableBedsForTransfer.map((b) => (
                      <option key={b.bed_id} value={b.bed_code}>
                        {b.bed_code} — Room {b.room_number} ({b.department})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <p className="text-[11px] text-zinc-500">
                Transferring will move the inpatient stay to the target bed, mark the source bed as DIRTY, and dispatch a sanitization task to housekeeping.
              </p>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isTransferring || !transferToBedCode}
                  className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 font-bold uppercase tracking-wider transition-colors"
                >
                  {isTransferring ? 'Processing Transfer...' : 'Execute Bed Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: DISCHARGE CONFIRMATION */}
      {/* ================================================================= */}
      {dischargeBed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs" onClick={() => setDischargeBed(null)} />
          <div className="relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-red-400">Discharge Verification</span>
                <h3 className="text-xl font-bold font-mono text-white">Confirm Patient Discharge</h3>
              </div>
              <button
                type="button"
                onClick={() => setDischargeBed(null)}
                className="text-zinc-400 hover:text-white text-sm font-mono"
              >
                ✕
              </button>
            </div>

            {dischargeError && (
              <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                {dischargeError}
              </div>
            )}

            <div className="space-y-4 font-mono text-xs">
              <div className="p-3 bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-500 block uppercase text-[10px]">Discharging from Bed:</span>
                <span className="text-white font-bold text-sm">{dischargeBed.bed_code}</span>
                <span className="text-zinc-400 ml-2">(Encounter #{dischargeBed.admission_id || 'Active'})</span>
              </div>

              <p className="text-zinc-400 leading-relaxed">
                Discharging this patient will stamp their departure timestamp, release all allocated medical devices, set the bed state to <strong className="text-orange-400">DIRTY</strong>, and generate a sanitization work order for environmental housekeeping.
              </p>

              <div className="flex space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setDischargeBed(null)}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-2.5 font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDischarging}
                  onClick={handleDischargeConfirm}
                  className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 text-white py-2.5 font-bold uppercase tracking-wider transition-colors"
                >
                  {isDischarging ? 'Discharging...' : 'Confirm Discharge'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: REGISTER PATIENT */}
      {/* ================================================================= */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs" onClick={() => setIsRegisterOpen(false)} />
          <div className="relative z-10 w-full max-w-lg bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Master Patient Index</span>
                <h3 className="text-xl font-bold font-mono text-white">Register Walk-In Patient</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRegisterOpen(false)}
                className="text-zinc-400 hover:text-white text-sm font-mono"
              >
                ✕
              </button>
            </div>

            {registerError && (
              <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                {registerError}
              </div>
            )}

            <form onSubmit={handleRegisterPatient} className="space-y-4 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    value={newPatient.first_name}
                    onChange={(e) => setNewPatient((p) => ({ ...p, first_name: e.target.value }))}
                    placeholder="e.g. John"
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={newPatient.last_name}
                    onChange={(e) => setNewPatient((p) => ({ ...p, last_name: e.target.value }))}
                    placeholder="e.g. Doe"
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Date of Birth *</label>
                  <input
                    type="date"
                    required
                    value={newPatient.date_of_birth}
                    onChange={(e) => setNewPatient((p) => ({ ...p, date_of_birth: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Gender *</label>
                  <select
                    value={newPatient.gender}
                    onChange={(e) =>
                      setNewPatient((p) => ({ ...p, gender: e.target.value as 'MALE' | 'FEMALE' | 'OTHER' }))
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="MALE">MALE</option>
                    <option value="FEMALE">FEMALE</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block uppercase text-zinc-400 mb-1">Contact Phone</label>
                <input
                  type="text"
                  value={newPatient.phone ?? ''}
                  onChange={(e) => setNewPatient((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="e.g. +1 555-0199"
                  className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="block uppercase text-zinc-400 mb-1">Mailing Address</label>
                <input
                  type="text"
                  value={newPatient.address ?? ''}
                  onChange={(e) => setNewPatient((p) => ({ ...p, address: e.target.value }))}
                  placeholder="e.g. 104 Central Parkway, Apt 3"
                  className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  disabled={isRegistering}
                  className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 font-bold uppercase tracking-wider transition-colors"
                >
                  {isRegistering ? 'Registering...' : 'Register Patient in MPI'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: EDIT PATIENT DETAILS */}
      {/* ================================================================= */}
      {editingPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs" onClick={() => setEditingPatient(null)} />
          <div className="relative z-10 w-full max-w-lg bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Master Patient Index • Edit Record</span>
                <h3 className="text-xl font-bold font-mono text-white">Patient #{editingPatient.patient_id}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingPatient(null)}
                className="text-zinc-400 hover:text-white text-sm font-mono"
              >
                ✕
              </button>
            </div>

            {editPatientError && (
              <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                {editPatientError}
              </div>
            )}

            <form onSubmit={handleSavePatientEdit} className="space-y-4 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    value={editPatientForm.first_name ?? ''}
                    onChange={(e) => setEditPatientForm((p) => ({ ...p, first_name: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={editPatientForm.last_name ?? ''}
                    onChange={(e) => setEditPatientForm((p) => ({ ...p, last_name: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Date of Birth *</label>
                  <input
                    type="date"
                    required
                    value={editPatientForm.date_of_birth ?? ''}
                    onChange={(e) => setEditPatientForm((p) => ({ ...p, date_of_birth: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Gender *</label>
                  <select
                    value={editPatientForm.gender ?? 'MALE'}
                    onChange={(e) =>
                      setEditPatientForm((p) => ({ ...p, gender: e.target.value as 'MALE' | 'FEMALE' | 'OTHER' }))
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="MALE">MALE</option>
                    <option value="FEMALE">FEMALE</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block uppercase text-zinc-400 mb-1">Contact Phone Number</label>
                <input
                  type="text"
                  value={editPatientForm.phone ?? ''}
                  onChange={(e) => setEditPatientForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="e.g. +1 555-0199"
                  className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="block uppercase text-zinc-400 mb-1">Residential Address</label>
                <input
                  type="text"
                  value={editPatientForm.address ?? ''}
                  onChange={(e) => setEditPatientForm((p) => ({ ...p, address: e.target.value }))}
                  placeholder="e.g. 104 Central Parkway, Apt 3"
                  className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="p-3 bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <div>
                  <span className="block text-xs uppercase text-zinc-300 font-bold">Record Status</span>
                  <span className="text-[10px] text-zinc-500">
                    {editPatientForm.is_active ? 'Active for new clinical admissions' : 'Deactivated record (cannot be admitted)'}
                  </span>
                </div>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editPatientForm.is_active ?? true}
                    onChange={(e) => setEditPatientForm((p) => ({ ...p, is_active: e.target.checked }))}
                    className="accent-green-500 h-4 w-4"
                  />
                  <span className={`text-xs font-bold ${editPatientForm.is_active ? 'text-green-400' : 'text-red-400'}`}>
                    {editPatientForm.is_active ? 'ACTIVE' : 'DEACTIVATED'}
                  </span>
                </label>
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  disabled={isUpdatingPatient}
                  className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 font-bold uppercase tracking-wider transition-colors"
                >
                  {isUpdatingPatient ? 'Saving Changes...' : 'Save Patient Details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* DRAWER: PATIENT MEDICAL CHART & ADMISSIONS */}
      {/* ================================================================= */}
      {chartPatient && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-xs" onClick={() => setChartPatient(null)} />
          <div className="relative z-10 w-full max-w-lg bg-zinc-900 border-l border-zinc-800 h-full p-6 overflow-y-auto flex flex-col justify-between shadow-2xl">
            <div>
              <div className="flex items-start justify-between pb-4 border-b border-zinc-800 mb-6">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                    Patient Medical Chart • MRN #{chartPatient.patient_id}
                  </div>
                  <h2 className="text-2xl font-bold font-mono text-white mt-1">
                    {chartPatient.first_name} {chartPatient.last_name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setChartPatient(null)}
                  className="text-zinc-400 hover:text-white p-1 text-sm font-mono border border-zinc-800 hover:border-zinc-700"
                >
                  ESC ✕
                </button>
              </div>

              {/* Patient Profile Card */}
              <div className="bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs space-y-2 mb-6">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-zinc-500 block">Date of Birth:</span>
                    <span className="text-white font-bold">{chartPatient.date_of_birth}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Gender:</span>
                    <span className="text-white font-bold">{chartPatient.gender}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Phone:</span>
                    <span className="text-white">{chartPatient.phone || 'None recorded'}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Registered:</span>
                    <span className="text-zinc-400">
                      {chartPatient.create_datetime ? new Date(chartPatient.create_datetime).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                </div>
                {chartPatient.address && (
                  <div className="pt-2 border-t border-zinc-800 text-zinc-400">
                    <span className="text-zinc-500 block">Address:</span> {chartPatient.address}
                  </div>
                )}

                {canEditPatient && (
                  <div className="pt-3 border-t border-zinc-800">
                    <button
                      type="button"
                      onClick={() => handleOpenEditPatient(chartPatient)}
                      className="w-full border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white py-1.5 text-xs font-mono uppercase tracking-wider transition-colors text-center"
                    >
                      ✎ Edit Demographic Information
                    </button>
                  </div>
                )}
              </div>

              {/* Admissions Encounter History */}
              <div>
                <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-white mb-3">
                  Admissions & Hospital Stays
                </h3>

                {chartLoading ? (
                  <div className="p-6 text-center text-zinc-500 font-mono text-xs">
                    Loading clinical encounter history...
                  </div>
                ) : patientAdmissions.length === 0 ? (
                  <div className="border border-dashed border-zinc-800 p-8 text-center text-zinc-500 font-mono text-xs">
                    No hospital admissions found for this patient.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {patientAdmissions.map((adm) => {
                      const isActive = !adm.discharge_datetime;
                      return (
                        <div
                          key={adm.admission_id}
                          className="bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-white">Encounter #{adm.admission_id}</span>
                            <span
                              className={`text-[10px] px-2 py-0.5 border ${
                                isActive
                                  ? 'bg-red-950 text-red-300 border-red-800'
                                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                              }`}
                            >
                              {isActive ? 'ACTIVE INPATIENT' : 'DISCHARGED'}
                            </span>
                          </div>

                          <div className="text-zinc-300 mb-2">
                            <span className="text-zinc-500">Diagnosis:</span> {adm.primary_diagnosis || 'Observation'}
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800 pt-2">
                            <span>Acuity: {adm.acuity_level}</span>
                            <span>Admitted: {new Date(adm.arrival_datetime).toLocaleDateString()}</span>
                          </div>

                          {isActive && (
                            <div className="mt-3 pt-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedVitalsAdmId(adm.admission_id);
                                  setActiveTab('vitals');
                                  setChartPatient(null);
                                }}
                                className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 text-xs font-mono uppercase tracking-wider text-center"
                              >
                                Open in Vitals Station →
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-zinc-800 text-[11px] font-mono text-zinc-500">
              HIPAA Master Record • Authorized Clinical Use Only
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: DIRECT QUICK VITALS CHARTING */}
      {/* ================================================================= */}
      {chartingAdmissionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setChartingAdmissionId(null)}
          />
          <div className="relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Bed {chartingBedCode}</span>
                <h3 className="text-xl font-bold font-mono text-white">Chart Patient Vitals</h3>
              </div>
              <button
                type="button"
                onClick={() => setChartingAdmissionId(null)}
                className="text-zinc-400 hover:text-white text-sm font-mono"
              >
                ✕
              </button>
            </div>

            {vitalsSubmitError && (
              <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                {vitalsSubmitError}
              </div>
            )}

            <form onSubmit={handleSubmitVitals} className="space-y-4 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Heart Rate (bpm)</label>
                  <input
                    type="number"
                    min={1}
                    max={299}
                    value={vitalsForm.heart_rate_bpm ?? ''}
                    onChange={(e) =>
                      setVitalsForm((p) => ({
                        ...p,
                        heart_rate_bpm: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="72"
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">SpO2 (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={vitalsForm.oxygen_saturation_pct ?? ''}
                    onChange={(e) =>
                      setVitalsForm((p) => ({
                        ...p,
                        oxygen_saturation_pct: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="98.0"
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Systolic BP</label>
                  <input
                    type="number"
                    min={1}
                    max={349}
                    value={vitalsForm.systolic_bp ?? ''}
                    onChange={(e) =>
                      setVitalsForm((p) => ({
                        ...p,
                        systolic_bp: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="120"
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Diastolic BP</label>
                  <input
                    type="number"
                    min={1}
                    max={249}
                    value={vitalsForm.diastolic_bp ?? ''}
                    onChange={(e) =>
                      setVitalsForm((p) => ({
                        ...p,
                        diastolic_bp: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="80"
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">Temp (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={25}
                    max={45}
                    value={vitalsForm.temperature_celsius ?? ''}
                    onChange={(e) =>
                      setVitalsForm((p) => ({
                        ...p,
                        temperature_celsius: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="37.0"
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block uppercase text-zinc-400 mb-1">RR (/min)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={vitalsForm.respiratory_rate ?? ''}
                    onChange={(e) =>
                      setVitalsForm((p) => ({
                        ...p,
                        respiratory_rate: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="16"
                    className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div>
                <label className="block uppercase text-zinc-400 mb-1">Clinical Notes</label>
                <textarea
                  rows={2}
                  value={vitalsForm.notes ?? ''}
                  onChange={(e) => setVitalsForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Enter observation notes..."
                  className="w-full bg-zinc-950 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmittingVitals}
                  className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 font-bold uppercase tracking-wider transition-colors"
                >
                  {isSubmittingVitals ? 'Writing to Ledger...' : 'Commit Observation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: ALLOCATE EQUIPMENT TO ANY BED */}
      {/* ================================================================= */}
      {allocatingEquipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setAllocatingEquipment(null)}
          />
          <div className="relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Device Checkout</span>
                <h3 className="text-xl font-bold font-mono text-white">Allocate Medical Equipment</h3>
              </div>
              <button
                type="button"
                onClick={() => setAllocatingEquipment(null)}
                className="text-zinc-400 hover:text-white text-sm font-mono"
              >
                ✕
              </button>
            </div>

            {allocateError && (
              <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                {allocateError}
              </div>
            )}

            <form onSubmit={handleAllocateEquipment} className="space-y-4 font-mono text-xs">
              <div className="p-3 bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-500 block uppercase text-[10px]">Machine:</span>
                <span className="text-white font-bold text-sm">{allocatingEquipment.equipment_name}</span>
                <span className="text-zinc-400 ml-2">({allocatingEquipment.serial_number})</span>
              </div>

              <div>
                <label className="block uppercase text-zinc-300 mb-2">Select Destination Bed:</label>
                {beds.length === 0 ? (
                  <p className="text-zinc-500 p-3 bg-zinc-950 border border-zinc-800">
                    Loading hospital bed inventory...
                  </p>
                ) : (
                  <select
                    value={targetBedForEquip}
                    onChange={(e) => {
                      setTargetBedForEquip(e.target.value);
                      setAllocateError(null);
                    }}
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 p-2.5 text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="">Select clean hospital bed...</option>
                    {beds.map((b) => {
                      const isUnclean = b.status === 'DIRTY' || b.status === 'CLEANING_IN_PROGRESS' || b.status === 'MAINTENANCE';
                      return (
                        <option key={b.bed_id} value={b.bed_code} disabled={isUnclean}>
                          {b.bed_code} — Room {b.room_number} ({b.department}) • [{b.status}]{isUnclean ? ' ⚠️ [UNCLEAN - CANNOT ALLOCATE]' : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {(() => {
                const selectedBed = beds.find((b) => b.bed_code === targetBedForEquip);
                if (!selectedBed) return null;
                const isUnclean = selectedBed.status === 'DIRTY' || selectedBed.status === 'CLEANING_IN_PROGRESS' || selectedBed.status === 'MAINTENANCE';
                return isUnclean ? (
                  <div className="p-2.5 bg-red-950/60 border border-red-800 text-red-300 text-[11px] font-mono">
                    ⚠️ Bed {selectedBed.bed_code} is currently {selectedBed.status}. Medical equipment cannot be assigned until housekeeping cleans and sanitizes the bed.
                  </div>
                ) : (
                  <div className="p-2.5 bg-green-950/40 border border-green-800/60 text-green-300 text-[11px] font-mono">
                    ✓ Bed {selectedBed.bed_code} is clean ({selectedBed.status}) and ready for device allocation.
                  </div>
                );
              })()}

              <p className="text-[11px] text-zinc-500">
                Equipment can be allocated to active patient encounters or pre-deployed directly to clean emergency/ICU beds.
              </p>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={
                    isAllocating ||
                    !targetBedForEquip ||
                    (() => {
                      const sel = beds.find((b) => b.bed_code === targetBedForEquip);
                      return !sel || sel.status === 'DIRTY' || sel.status === 'CLEANING_IN_PROGRESS' || sel.status === 'MAINTENANCE';
                    })()
                  }
                  className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 font-bold uppercase tracking-wider transition-colors"
                >
                  {isAllocating ? 'Allocating...' : 'Confirm Allocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
