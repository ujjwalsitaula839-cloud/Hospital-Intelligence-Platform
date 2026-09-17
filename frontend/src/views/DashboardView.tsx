import React, { useState, useEffect, useCallback } from 'react';
import type { BedAsset, BedStatus, BedMetrics } from '../types/bed';
import type { InboundEMSUnit, AcuityLevel } from '../types/ems';
import type { CleaningTask } from '../types/cleaning';
import type { EquipmentItem } from '../types/equipment';
import type { PatientRecord } from '../types/patient';
import { bedService, cleaningService, equipmentService, patientService } from '../services/hipServices';
import { useBedWebSocket } from '../hooks/useBedWebSocket';
import {
    Activity,
    Radio,
    PlusCircle,
    RefreshCw,
    Sparkles,
    Check,
    Users,
    BedDouble,
    Wrench
} from 'lucide-react';

export const DashboardView: React.FC = () => {
    // Active View Tab
    const [activeTab, setActiveTab] = useState<'matrix' | 'ems' | 'cleaning' | 'equipment' | 'patients'>('matrix');

    // Data States
    const [beds, setBeds] = useState<BedAsset[]>([]);
    const [cleaningTasks, setCleaningTasks] = useState<CleaningTask[]>([]);
    const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
    const [patients, setPatients] = useState<PatientRecord[]>([]);

    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Inbound Ambulances State
    const [emsUnits, setEmsUnits] = useState<InboundEMSUnit[]>([
        {
            id: 'ems-1',
            unit_code: 'MEDIC-14',
            eta_minutes: 4,
            arrival_timestamp: Date.now() + 4 * 60 * 1000,
            acuity: 'ESI_1',
            chief_complaint: 'Cardiac Arrest - CPR In Progress',
            vitals: { hr: 0, spo2: 78, bp: 'Palp 60' },
            equipment_needed: ['Ventilator', 'Crash Cart'],
            status: 'INBOUND',
            recommended_bed_code: 'ICU-201'
        },
        {
            id: 'ems-2',
            unit_code: 'AMB-08',
            eta_minutes: 11,
            arrival_timestamp: Date.now() + 11 * 60 * 1000,
            acuity: 'ESI_3',
            chief_complaint: 'Blunt Abdominal Trauma / Hemodynamically Stable',
            vitals: { hr: 88, spo2: 98, bp: '128/82' },
            equipment_needed: ['Cardiac Monitor'],
            status: 'INBOUND',
            recommended_bed_code: 'ER-101'
        }
    ]);

    // Modals
    const [showReserveModal, setShowReserveModal] = useState<string | null>(null);
    const [reservePatientId, setReservePatientId] = useState<number>(1);
    const [reserveAcuity, setReserveAcuity] = useState<string>('ESI_2');
    const [reserveDiagnosis, setReserveDiagnosis] = useState<string>('Acute Chest Pain');

    const [showPatientModal, setShowPatientModal] = useState(false);
    const [newPatientName, setNewPatientName] = useState('');
    const [newPatientAge, setNewPatientAge] = useState(45);
    const [newPatientGender, setNewPatientGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');

    const [showEMSForm, setShowEMSForm] = useState(false);
    const [newUnitCode, setNewUnitCode] = useState('');
    const [newComplaint, setNewComplaint] = useState('');
    const [newAcuity, setNewAcuity] = useState<AcuityLevel>('ESI_2');
    const [newEta, setNewEta] = useState(8);

    // Fetch All Telemetry Data
    const fetchAllData = useCallback(async () => {
        try {
            setLoading(true);
            const [bedsData, cleaningData, eqData, patientData] = await Promise.allSettled([
                bedService.getGrid(),
                cleaningService.getTasks(),
                equipmentService.getList(),
                patientService.getRecords()
            ]);

            if (bedsData.status === 'fulfilled') setBeds(bedsData.value);
            if (cleaningData.status === 'fulfilled') setCleaningTasks(cleaningData.value);
            if (eqData.status === 'fulfilled') setEquipmentList(eqData.value);
            if (patientData.status === 'fulfilled') {
                setPatients(patientData.value);
                if (patientData.value.length > 0 && !reservePatientId) {
                    setReservePatientId(patientData.value[0].patient_id);
                }
            }
        } catch (err) {
            console.error('Failed to retrieve telemetry matrix:', err);
        } finally {
            setLoading(false);
        }
    }, [reservePatientId]);

    useEffect(() => {
        fetchAllData();
    }, [fetchAllData]);

    // Listen to real-time WebSocket events
    useBedWebSocket((eventData: any) => {
        console.log('[REAL-TIME WS EVENT RECEIVED]', eventData);
        fetchAllData();
    });

    // Compute Metrics
    const metrics: BedMetrics = {
        total: beds.length,
        available: beds.filter((b) => b.status === 'AVAILABLE').length,
        reserved: beds.filter((b) => b.status === 'RESERVED').length,
        occupied: beds.filter((b) => b.status === 'OCCUPIED').length,
        dirty: beds.filter((b) => b.status === 'DIRTY').length,
        cleaning: beds.filter((b) => b.status === 'CLEANING_IN_PROGRESS').length,
        occupancy_rate: beds.length > 0
            ? Math.round(((beds.filter((b) => b.status === 'OCCUPIED' || b.status === 'RESERVED').length) / beds.length) * 100)
            : 0
    };

    // --- ACTIONS ---

    const handleReserveSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showReserveModal) return;
        setActionLoading(showReserveModal);
        try {
            await bedService.reserveBed(showReserveModal, {
                patient_id: Number(reservePatientId),
                acuity_level: reserveAcuity,
                primary_diagnosis: reserveDiagnosis,
                diagnosis: reserveDiagnosis
            });
            setShowReserveModal(null);
            await fetchAllData();
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Bed reservation collision or failure.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleConfirmArrival = async (bedCode: string) => {
        setActionLoading(bedCode);
        try {
            await bedService.confirmAdmission(bedCode);
            await fetchAllData();
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Confirmation failed.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleDischarge = async (bedCode: string) => {
        setActionLoading(bedCode);
        try {
            await bedService.dischargeBed(bedCode);
            await fetchAllData();
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Discharge failed.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleStartCleaning = async (cleaningId: number) => {
        setActionLoading(`clean-${cleaningId}`);
        try {
            await cleaningService.startCleaning(cleaningId);
            await fetchAllData();
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Failed to start cleaning.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCompleteCleaning = async (cleaningId: number) => {
        setActionLoading(`clean-${cleaningId}`);
        try {
            await cleaningService.completeCleaning(cleaningId);
            await fetchAllData();
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Failed to complete cleaning.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCreatePatient = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const created = await patientService.registerPatient({
                name: newPatientName,
                age: Number(newPatientAge),
                gender: newPatientGender
            });
            setShowPatientModal(false);
            setNewPatientName('');
            setReservePatientId(created.patient_id);
            await fetchAllData();
        } catch (err: any) {
            alert(err.response?.data?.detail || 'Failed to register patient.');
        }
    };

    const handleAddEMS = (e: React.FormEvent) => {
        e.preventDefault();
        const newUnit: InboundEMSUnit = {
            id: `ems-${Date.now()}`,
            unit_code: newUnitCode.toUpperCase(),
            eta_minutes: Number(newEta),
            arrival_timestamp: Date.now() + Number(newEta) * 60 * 1000,
            acuity: newAcuity,
            chief_complaint: newComplaint,
            vitals: { hr: 90, spo2: 96, bp: '120/80' },
            equipment_needed: ['Cardiac Monitor'],
            status: 'INBOUND',
            recommended_bed_code: beds.find(b => b.status === 'AVAILABLE')?.bed_code || 'ER-101'
        };
        setEmsUnits([newUnit, ...emsUnits]);
        setShowEMSForm(false);
        setNewUnitCode('');
        setNewComplaint('');
    };

    const getStatusBadge = (status: BedStatus) => {
        switch (status) {
            case 'AVAILABLE':
                return <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold rounded-md">AVAILABLE</span>;
            case 'RESERVED':
                return <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold rounded-md">RESERVED</span>;
            case 'OCCUPIED':
                return <span className="px-2.5 py-1 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold rounded-md">OCCUPIED</span>;
            case 'DIRTY':
                return <span className="px-2.5 py-1 bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-bold rounded-md">DIRTY (EVS QUEUE)</span>;
            case 'CLEANING_IN_PROGRESS':
                return <span className="px-2.5 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-bold rounded-md animate-pulse">SANITIZING</span>;
            default:
                return <span className="px-2.5 py-1 bg-slate-800 text-slate-400 text-xs font-bold rounded-md">{status}</span>;
        }
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
            {/* 1. TOP METRICS & COMMAND BAR */}
            <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400">
                                <Activity className="w-6 h-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white tracking-tight">Hospital Intelligence Telemetry Matrix</h1>
                                <p className="text-xs text-slate-400">Real-time room availability, rapid EMS intake, and automated sanitization lifecycle</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowPatientModal(true)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition shadow-md shadow-emerald-950 cursor-pointer"
                        >
                            <PlusCircle className="w-4 h-4" />
                            Register Patient
                        </button>
                        <button
                            onClick={fetchAllData}
                            disabled={loading}
                            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 pt-6">
                    <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80">
                        <span className="text-xs text-slate-400 font-medium">Total Beds</span>
                        <p className="text-2xl font-bold text-white mt-1">{metrics.total}</p>
                    </div>
                    <div className="bg-slate-950/70 p-4 rounded-xl border border-emerald-900/40">
                        <span className="text-xs text-emerald-400 font-medium">Available</span>
                        <p className="text-2xl font-bold text-emerald-400 mt-1">{metrics.available}</p>
                    </div>
                    <div className="bg-slate-950/70 p-4 rounded-xl border border-amber-900/40">
                        <span className="text-xs text-amber-400 font-medium">Reserved</span>
                        <p className="text-2xl font-bold text-amber-400 mt-1">{metrics.reserved}</p>
                    </div>
                    <div className="bg-slate-950/70 p-4 rounded-xl border border-rose-900/40">
                        <span className="text-xs text-rose-400 font-medium">Occupied</span>
                        <p className="text-2xl font-bold text-rose-400 mt-1">{metrics.occupied}</p>
                    </div>
                    <div className="bg-slate-950/70 p-4 rounded-xl border border-purple-900/40">
                        <span className="text-xs text-purple-400 font-medium">Dirty (EVS Queue)</span>
                        <p className="text-2xl font-bold text-purple-400 mt-1">{metrics.dirty}</p>
                    </div>
                    <div className="bg-slate-950/70 p-4 rounded-xl border border-sky-900/40">
                        <span className="text-xs text-sky-400 font-medium">Occupancy Rate</span>
                        <p className="text-2xl font-bold text-sky-400 mt-1">{metrics.occupancy_rate}%</p>
                    </div>
                </div>
            </section>

            {/* 2. NAVIGATION TABS */}
            <div className="flex border-b border-slate-800 gap-2 pb-1 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('matrix')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeTab === 'matrix' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                >
                    <BedDouble className="w-4 h-4" />
                    Bed Matrix Grid ({beds.length})
                </button>
                <button
                    onClick={() => setActiveTab('ems')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeTab === 'ems' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                >
                    <Radio className="w-4 h-4 text-amber-400" />
                    EMS Inbound Queue ({emsUnits.length})
                </button>
                <button
                    onClick={() => setActiveTab('cleaning')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeTab === 'cleaning' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                >
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    Cleaning (EVS) Terminal ({cleaningTasks.filter(t => t.status !== 'COMPLETED').length})
                </button>
                <button
                    onClick={() => setActiveTab('equipment')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeTab === 'equipment' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                >
                    <Wrench className="w-4 h-4 text-cyan-400" />
                    Equipment Assets ({equipmentList.length})
                </button>
                <button
                    onClick={() => setActiveTab('patients')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeTab === 'patients' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                >
                    <Users className="w-4 h-4 text-emerald-400" />
                    Demographic Records ({patients.length})
                </button>
            </div>

            {/* TAB 1: BED MATRIX GRID */}
            {activeTab === 'matrix' && (
                <section className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {beds.map((bed) => (
                            <div
                                key={bed.bed_code}
                                className={`rounded-xl border p-5 transition flex flex-col justify-between shadow-lg ${
                                    bed.status === 'AVAILABLE'
                                        ? 'bg-slate-900/60 border-slate-800 hover:border-emerald-500/50'
                                        : bed.status === 'RESERVED'
                                        ? 'bg-amber-950/20 border-amber-800/50'
                                        : bed.status === 'OCCUPIED'
                                        ? 'bg-rose-950/20 border-rose-800/50'
                                        : bed.status === 'DIRTY'
                                        ? 'bg-purple-950/20 border-purple-800/50'
                                        : 'bg-cyan-950/20 border-cyan-800/50'
                                }`}
                            >
                                <div>
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <span className="text-2xs font-bold uppercase tracking-wider text-slate-400">
                                                {bed.department} • Room {bed.room_number}
                                            </span>
                                            <h3 className="text-lg font-bold text-white tracking-tight">{bed.bed_code}</h3>
                                            <span className="text-2xs text-slate-500">{bed.bed_type} Bed</span>
                                        </div>
                                        <div>{getStatusBadge(bed.status)}</div>
                                    </div>

                                    {/* Patient Allocation Info */}
                                    {bed.patient_id && (
                                        <div className="mt-4 p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-slate-400">Assigned Patient:</span>
                                                <span className="font-bold text-white">ID #{bed.patient_id}</span>
                                            </div>
                                            {bed.acuity_level && (
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400">Acuity:</span>
                                                    <span className="px-1.5 py-0.2 bg-red-500/20 text-red-300 font-mono text-2xs rounded">
                                                        {bed.acuity_level}
                                                    </span>
                                                </div>
                                            )}
                                            {(bed.primary_diagnosis || bed.diagnosis) && (
                                                <p className="text-2xs text-slate-300 truncate">
                                                    <strong className="text-slate-400">Dx:</strong> {bed.primary_diagnosis || bed.diagnosis}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {/* Equipment Attached */}
                                    {bed.equipment && bed.equipment.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {bed.equipment.map((eq, i) => (
                                                <span key={i} className="px-2 py-0.5 bg-sky-950/60 border border-sky-800/60 text-sky-300 text-2xs rounded-full">
                                                    ⚡ {eq}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="mt-5 pt-3 border-t border-slate-800/80">
                                    {bed.status === 'AVAILABLE' && (
                                        <button
                                            onClick={() => setShowReserveModal(bed.bed_code)}
                                            disabled={actionLoading === bed.bed_code}
                                            className="w-full py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition shadow"
                                        >
                                            Reserve Bed
                                        </button>
                                    )}

                                    {bed.status === 'RESERVED' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => handleConfirmArrival(bed.bed_code)}
                                                disabled={actionLoading === bed.bed_code}
                                                className="py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition"
                                            >
                                                Confirm Arrival
                                            </button>
                                            <button
                                                onClick={() => handleDischarge(bed.bed_code)}
                                                disabled={actionLoading === bed.bed_code}
                                                className="py-2 bg-rose-600/80 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition"
                                            >
                                                Release
                                            </button>
                                        </div>
                                    )}

                                    {bed.status === 'OCCUPIED' && (
                                        <button
                                            onClick={() => handleDischarge(bed.bed_code)}
                                            disabled={actionLoading === bed.bed_code}
                                            className="w-full py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition shadow"
                                        >
                                            Discharge Patient $\rightarrow$ EVS
                                        </button>
                                    )}

                                    {bed.status === 'DIRTY' && (
                                        <div className="text-center py-2 text-xs text-purple-400 font-mono bg-purple-950/40 rounded-lg border border-purple-900/40">
                                            AWAITING EVS SANITIZATION
                                        </div>
                                    )}

                                    {bed.status === 'CLEANING_IN_PROGRESS' && (
                                        <div className="text-center py-2 text-xs text-cyan-400 font-mono bg-cyan-950/40 rounded-lg border border-cyan-900/40 animate-pulse">
                                            EVS SANITIZATION IN PROGRESS
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* TAB 2: EMS INBOUND QUEUE */}
            {activeTab === 'ems' && (
                <section className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Radio className="w-5 h-5 text-amber-400" />
                            Inbound Ambulance Triage
                        </h2>
                        <button
                            onClick={() => setShowEMSForm(true)}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition"
                        >
                            + Log Incoming EMS Unit (~15s)
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {emsUnits.map((unit) => (
                            <div key={unit.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 font-mono text-2xs rounded">
                                            {unit.acuity}
                                        </span>
                                        <h3 className="text-xl font-bold text-white mt-1">{unit.unit_code}</h3>
                                        <p className="text-xs text-slate-300 font-medium">{unit.chief_complaint}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs text-slate-400 font-mono">ETA</span>
                                        <p className="text-xl font-bold text-amber-400">{unit.eta_minutes} min</p>
                                    </div>
                                </div>

                                {unit.recommended_bed_code && (
                                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between">
                                        <div>
                                            <span className="text-2xs text-sky-400 font-semibold uppercase">AI Recommended Bed</span>
                                            <p className="text-sm font-bold text-white">{unit.recommended_bed_code}</p>
                                        </div>
                                        <button
                                            onClick={() => setShowReserveModal(unit.recommended_bed_code!)}
                                            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-semibold cursor-pointer transition"
                                        >
                                            Reserve Recommended Bed
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* TAB 3: CLEANING CREW TERMINAL */}
            {activeTab === 'cleaning' && (
                <section className="space-y-4">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-purple-400" />
                                Environmental Services (EVS) Cleaning Queue
                            </h2>
                            <p className="text-xs text-slate-400">Sanitization lifecycle triggered automatically upon patient discharge</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {cleaningTasks.length === 0 ? (
                            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl text-slate-400 text-sm">
                                No active cleaning tasks. All beds are sanitized and operational!
                            </div>
                        ) : (
                            cleaningTasks.map((task) => (
                                <div
                                    key={task.cleaning_id}
                                    className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow"
                                >
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-base font-bold text-white">Bed {task.bed_code}</h4>
                                            <span className="text-xs text-slate-400">({task.department} • Room {task.room_number})</span>
                                            <span className={`px-2 py-0.5 rounded text-2xs font-bold ${
                                                task.status === 'PENDING' ? 'bg-purple-500/20 text-purple-300' :
                                                task.status === 'IN_PROGRESS' ? 'bg-cyan-500/20 text-cyan-300' :
                                                'bg-emerald-500/20 text-emerald-300'
                                            }`}>
                                                {task.status}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-400">
                                            Requested: {task.requested_at ? new Date(task.requested_at).toLocaleTimeString() : 'N/A'} • {task.disinfection_notes || 'Standard protocol'}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {task.status === 'PENDING' && (
                                            <button
                                                onClick={() => handleStartCleaning(task.cleaning_id)}
                                                disabled={actionLoading === `clean-${task.cleaning_id}`}
                                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition shadow"
                                            >
                                                Start Sanitization
                                            </button>
                                        )}
                                        {task.status === 'IN_PROGRESS' && (
                                            <button
                                                onClick={() => handleCompleteCleaning(task.cleaning_id)}
                                                disabled={actionLoading === `clean-${task.cleaning_id}`}
                                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition shadow"
                                            >
                                                Mark Cleaned $\rightarrow$ AVAILABLE
                                            </button>
                                        )}
                                        {task.status === 'COMPLETED' && (
                                            <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                                                <Check className="w-4 h-4" /> Ready for Patients
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            )}

            {/* TAB 4: EQUIPMENT ASSETS */}
            {activeTab === 'equipment' && (
                <section className="space-y-4">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Wrench className="w-5 h-5 text-cyan-400" />
                        Medical Device & Equipment Inventory
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {equipmentList.map((eq) => (
                            <div key={eq.equipment_id} className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <span className="text-2xs font-mono text-slate-400">{eq.serial_number}</span>
                                        <h4 className="text-sm font-bold text-white">{eq.equipment_name}</h4>
                                        <p className="text-2xs text-slate-400">{eq.equipment_type} • {eq.department}</p>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded text-2xs font-bold ${
                                        eq.status === 'AVAILABLE' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                                    }`}>
                                        {eq.status}
                                    </span>
                                </div>
                                {eq.allocated_bed_code && (
                                    <div className="text-2xs text-sky-300 bg-sky-950/60 p-1.5 rounded">
                                        ⚡ Attached to: <strong>{eq.allocated_bed_code}</strong>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* TAB 5: PATIENTS DEMOGRAPHIC REGISTRY */}
            {activeTab === 'patients' && (
                <section className="space-y-4">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <Users className="w-5 h-5 text-emerald-400" />
                                Patient Demographic Master Registry
                            </h2>
                            <p className="text-xs text-slate-400">Pure demographic records decoupled from clinical allocations</p>
                        </div>
                        <button
                            onClick={() => setShowPatientModal(true)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition"
                        >
                            + Register Patient
                        </button>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                                <tr>
                                    <th className="p-3 font-semibold">Patient ID</th>
                                    <th className="p-3 font-semibold">Full Name</th>
                                    <th className="p-3 font-semibold">Age</th>
                                    <th className="p-3 font-semibold">Gender</th>
                                    <th className="p-3 font-semibold">Registered</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 text-slate-200">
                                {patients.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="p-4 text-center text-slate-500">No registered patients.</td>
                                    </tr>
                                ) : (
                                    patients.map((p) => (
                                        <tr key={p.patient_id} className="hover:bg-slate-800/40">
                                            <td className="p-3 font-mono font-bold text-sky-400">#{p.patient_id}</td>
                                            <td className="p-3 font-semibold text-white">{p.name}</td>
                                            <td className="p-3">{p.age} yrs</td>
                                            <td className="p-3">{p.gender}</td>
                                            <td className="p-3 text-slate-400">{p.created_at ? new Date(p.created_at).toLocaleDateString() : 'Today'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* --- MODAL: RESERVE BED --- */}
            {showReserveModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
                        <h3 className="text-lg font-bold text-white">Reserve Bed {showReserveModal}</h3>
                        <form onSubmit={handleReserveSubmit} className="space-y-3">
                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Select Registered Patient</label>
                                <select
                                    value={reservePatientId}
                                    onChange={(e) => setReservePatientId(Number(e.target.value))}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                >
                                    {patients.map((p) => (
                                        <option key={p.patient_id} value={p.patient_id}>
                                            #{p.patient_id} - {p.name} ({p.age}y, {p.gender})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Acuity Level (ESI)</label>
                                <select
                                    value={reserveAcuity}
                                    onChange={(e) => setReserveAcuity(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                >
                                    <option value="ESI_1">ESI 1 - Resuscitation (Immediate Life Threat)</option>
                                    <option value="ESI_2">ESI 2 - Emergent (High Risk)</option>
                                    <option value="ESI_3">ESI 3 - Urgent (Multiple Resources)</option>
                                    <option value="ESI_4">ESI 4 - Less Urgent</option>
                                    <option value="ESI_5">ESI 5 - Non-Urgent</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Primary Diagnosis / Chief Complaint</label>
                                <input
                                    type="text"
                                    value={reserveDiagnosis}
                                    onChange={(e) => setReserveDiagnosis(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                    required
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowReserveModal(null)}
                                    className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={actionLoading === showReserveModal}
                                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold"
                                >
                                    Confirm Reservation
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* --- MODAL: REGISTER PATIENT --- */}
            {showPatientModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
                        <h3 className="text-lg font-bold text-white">Register Patient Demographic</h3>
                        <form onSubmit={handleCreatePatient} className="space-y-3">
                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Full Name</label>
                                <input
                                    type="text"
                                    value={newPatientName}
                                    onChange={(e) => setNewPatientName(e.target.value)}
                                    placeholder="e.g. John Doe"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-400 block mb-1">Age</label>
                                    <input
                                        type="number"
                                        value={newPatientAge}
                                        onChange={(e) => setNewPatientAge(Number(e.target.value))}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                        min={0}
                                        max={130}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 block mb-1">Gender</label>
                                    <select
                                        value={newPatientGender}
                                        onChange={(e) => setNewPatientGender(e.target.value as any)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                    >
                                        <option value="MALE">Male</option>
                                        <option value="FEMALE">Female</option>
                                        <option value="OTHER">Other</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowPatientModal(false)}
                                    className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
                                >
                                    Register Patient
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* --- MODAL: EMS RAPID INTAKE --- */}
            {showEMSForm && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
                        <h3 className="text-lg font-bold text-white">Log Inbound EMS Unit (~15s)</h3>
                        <form onSubmit={handleAddEMS} className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-400 block mb-1">Unit Code</label>
                                    <input
                                        type="text"
                                        value={newUnitCode}
                                        onChange={(e) => setNewUnitCode(e.target.value)}
                                        placeholder="e.g. MEDIC-42"
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 block mb-1">ETA (Minutes)</label>
                                    <input
                                        type="number"
                                        value={newEta}
                                        onChange={(e) => setNewEta(Number(e.target.value))}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                        min={1}
                                        max={60}
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Acuity Level</label>
                                <select
                                    value={newAcuity}
                                    onChange={(e) => setNewAcuity(e.target.value as AcuityLevel)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                >
                                    <option value="ESI_1">ESI 1 - Resuscitation (Severe STEMI / Arrest)</option>
                                    <option value="ESI_2">ESI 2 - Emergent (Stroke / Respiratory Distress)</option>
                                    <option value="ESI_3">ESI 3 - Urgent (Fracture / Abdominal Pain)</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Chief Complaint</label>
                                <input
                                    type="text"
                                    value={newComplaint}
                                    onChange={(e) => setNewComplaint(e.target.value)}
                                    placeholder="e.g. Acute STEMI, O2 Sat 82%"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                                    required
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowEMSForm(false)}
                                    className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold"
                                >
                                    Broadcast EMS Alert
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};