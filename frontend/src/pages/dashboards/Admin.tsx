import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import type { Bed, BedStatus, Department, Role } from '../../types';
import Clinical from './Clinical';
import Housekeeping from './Housekeeping';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface StaffMember {
  personnel_id: number;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  department: Department;
  is_active: boolean;
  must_change_password: boolean;
}

interface ProvisionResponse {
  personnel_id: number;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  department: Department;
  must_change_password: boolean;
  temporary_password: string;
}

export default function Admin(): React.ReactElement {
  const { claims, logout } = useAuth();
  const navigate = useNavigate();

  const [activeSection, setActiveSection] = useState<'personnel' | 'beds' | 'clinical' | 'housekeeping'>('personnel');

  // Personnel state
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isProvisionOpen, setIsProvisionOpen] = useState(false);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionResult, setProvisionResult] = useState<ProvisionResponse | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Staff Active/Inactive & Search state
  const [togglingStaffId, setTogglingStaffId] = useState<number | null>(null);
  const [staffActionError, setStaffActionError] = useState<string | null>(null);
  const [staffActionSuccess, setStaffActionSuccess] = useState<string | null>(null);
  const [confirmDeactivateStaff, setConfirmDeactivateStaff] = useState<StaffMember | null>(null);
  const [staffSearchQuery, setStaffSearchQuery] = useState('');
  const [staffStatusFilter, setStaffStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [staffRoleFilter, setStaffRoleFilter] = useState<string>('ALL');

  const handleToggleStaffStatus = async (staff: StaffMember) => {
    if (!staff.is_active) {
      setTogglingStaffId(staff.personnel_id);
      setStaffActionError(null);
      setStaffActionSuccess(null);
      try {
        const res = await api.activateStaff(staff.personnel_id);
        setStaffActionSuccess(res.message || `Personnel ${staff.username} reactivated.`);
        await fetchStaff();
      } catch (err: unknown) {
        setStaffActionError(err instanceof Error ? err.message : 'Failed to reactivate personnel.');
      } finally {
        setTogglingStaffId(null);
      }
    } else {
      setStaffActionError(null);
      setStaffActionSuccess(null);
      setConfirmDeactivateStaff(staff);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!confirmDeactivateStaff) return;
    const staff = confirmDeactivateStaff;
    setTogglingStaffId(staff.personnel_id);
    setStaffActionError(null);
    setStaffActionSuccess(null);
    try {
      const res = await api.deactivateStaff(staff.personnel_id);
      setStaffActionSuccess(res.message || `Personnel ${staff.username} deactivated.`);
      setConfirmDeactivateStaff(null);
      await fetchStaff();
    } catch (err: unknown) {
      setStaffActionError(err instanceof Error ? err.message : 'Failed to deactivate personnel.');
    } finally {
      setTogglingStaffId(null);
    }
  };

  // Provision Form inputs
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('NURSE');
  const [department, setDepartment] = useState<Department>('EMERGENCY');

  // Bed Registry state
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedConflictError, setBedConflictError] = useState<string | null>(null);
  const [updatingBedId, setUpdatingBedId] = useState<number | null>(null);

  const fetchStaff = async () => {
    const token = sessionStorage.getItem('token');
    try {
      const res = await fetch(`${BASE_URL}/auth/personnel/staff`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        const data = (await res.json()) as StaffMember[];
        setStaffList(data);
      }
    } catch {
      // Non-blocking fetch
    }
  };

  const fetchBeds = async () => {
    try {
      const data = await api.getBeds();
      setBeds(data);
    } catch {
      // Non-blocking fetch
    }
  };

  useEffect(() => {
    if (activeSection === 'personnel') {
      fetchStaff();
    } else if (activeSection === 'beds') {
      fetchBeds();
    }
  }, [activeSection]);

  // Real-time Bed WebSocket sync for Admin Bed Registry
  useEffect(() => {
    if (activeSection !== 'beds') return;

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

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
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
                  admission_id: data.admission_id !== undefined ? data.admission_id : b.admission_id,
                };
              }
              return b;
            })
          );
        } catch {
          // Ignore parse errors
        }
        fetchBeds();
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        if (reconnectAttempts < 5) {
          reconnectAttempts++;
          timeoutId = window.setTimeout(connect, 3000);
        }
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
  }, [activeSection]);

  // Drawer & modal escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isProvisionOpen) {
          setIsProvisionOpen(false);
          setProvisionResult(null);
        }
        if (confirmDeactivateStaff) {
          setConfirmDeactivateStaff(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProvisionOpen, confirmDeactivateStaff]);

  const activeStaffCount = useMemo(() => staffList.filter((s) => s.is_active).length, [staffList]);
  const inactiveStaffCount = useMemo(() => staffList.filter((s) => !s.is_active).length, [staffList]);

  const displayedStaffList = useMemo(() => {
    return staffList.filter((s) => {
      if (staffStatusFilter === 'ACTIVE' && !s.is_active) return false;
      if (staffStatusFilter === 'INACTIVE' && s.is_active) return false;
      if (staffRoleFilter !== 'ALL' && s.role !== staffRoleFilter) return false;

      if (staffSearchQuery.trim()) {
        const q = staffSearchQuery.toLowerCase().trim();
        const matchesName = s.full_name.toLowerCase().includes(q);
        const matchesUser = s.username.toLowerCase().includes(q);
        const matchesEmail = s.email.toLowerCase().includes(q);
        const matchesDept = s.department.toLowerCase().includes(q);
        const matchesRole = s.role.toLowerCase().includes(q);
        return matchesName || matchesUser || matchesEmail || matchesDept || matchesRole;
      }
      return true;
    });
  }, [staffList, staffStatusFilter, staffRoleFilter, staffSearchQuery]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionLoading(true);
    setProvisionError(null);
    setCopyFeedback(false);

    const token = sessionStorage.getItem('token');

    try {
      const res = await fetch(`${BASE_URL}/auth/admin/provision-staff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          username: username.trim(),
          email: email.trim(),
          role,
          department,
        }),
      });

      if (!res.ok) {
        let errDetail = 'Failed to provision staff.';
        try {
          const json = (await res.json()) as { detail?: string };
          if (json?.detail) errDetail = json.detail;
        } catch {
          // ignore
        }
        throw new Error(errDetail);
      }

      const data = (await res.json()) as ProvisionResponse;
      setProvisionResult(data);
      await fetchStaff();

      // Reset form
      setFullName('');
      setUsername('');
      setEmail('');
      setRole('NURSE');
      setDepartment('EMERGENCY');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error provisioning staff member.';
      setProvisionError(msg);
    } finally {
      setProvisionLoading(false);
    }
  };

  const handleBedStatusChange = async (bed: Bed, newStatus: BedStatus) => {
    if (bed.status === newStatus) return;

    if (newStatus === 'OCCUPIED' || newStatus === 'RESERVED') {
      setBedConflictError(
        `Cannot set bed directly to ${newStatus} from Bed Registry. Please use Clinical Admissions to admit or assign a patient.`
      );
      return;
    }

    setBedConflictError(null);
    setUpdatingBedId(bed.bed_id);

    try {
      await api.adminUpdateBedStatus(bed.bed_code, newStatus, {
        expected_version: bed.version,
      });
      await fetchBeds();
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to update bed status.';
      const cleanMsg = rawMsg.replace(/^40\d\s*[^:]*:\s*/i, '');
      const isVersionConflict = cleanMsg.toLowerCase().includes('conflict') || cleanMsg.toLowerCase().includes('version');

      if (isVersionConflict) {
        setBedConflictError(cleanMsg || 'Bed was updated by someone else concurrently. Refreshing latest data...');
        await fetchBeds();
      } else {
        setBedConflictError(cleanMsg);
      }
    } finally {
      setUpdatingBedId(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Sections 3 & 4 render directly
  if (activeSection === 'clinical') {
    return (
      <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
        {/* Persistent Left Sidebar */}
        <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col justify-between p-4 shrink-0">
          <div>
            <div className="pb-6 border-b border-zinc-800">
              <span className="text-xs font-mono uppercase px-2 py-0.5 bg-red-950 border border-red-800 text-red-300 font-bold">
                Admin Control
              </span>
              <h1 className="text-lg font-bold font-display text-white mt-2">Hospital Platform</h1>
              <p className="text-xs font-mono text-zinc-400 mt-0.5">{claims?.full_name || 'Administrator'}</p>
            </div>

            <nav className="mt-6 space-y-1.5 font-mono text-xs uppercase tracking-wider">
              <button
                onClick={() => setActiveSection('personnel')}
                className="w-full text-left px-3 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                1. Personnel
              </button>
              <button
                onClick={() => setActiveSection('beds')}
                className="w-full text-left px-3 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                2. Bed Registry
              </button>
              <button
                onClick={() => setActiveSection('clinical')}
                className="w-full text-left px-3 py-2.5 bg-zinc-800 text-white font-bold border-l-2 border-white"
              >
                3. Clinical View
              </button>
              <button
                onClick={() => setActiveSection('housekeeping')}
                className="w-full text-left px-3 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                4. Housekeeping View
              </button>
            </nav>
          </div>

          <div className="pt-4 border-t border-zinc-800">
            <button
              onClick={handleLogout}
              className="w-full border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white py-2 text-xs font-mono tracking-wider transition-colors"
            >
              Log Out
            </button>
          </div>
        </aside>

        {/* Live Clinical Component */}
        <div className="flex-1 overflow-auto">
          <Clinical />
        </div>
      </div>
    );
  }

  if (activeSection === 'housekeeping') {
    return (
      <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
        {/* Persistent Left Sidebar */}
        <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col justify-between p-4 shrink-0">
          <div>
            <div className="pb-6 border-b border-zinc-800">
              <span className="text-xs font-mono uppercase px-2 py-0.5 bg-red-950 border border-red-800 text-red-300 font-bold">
                Admin Control
              </span>
              <h1 className="text-lg font-bold font-display text-white mt-2">Hospital Platform</h1>
              <p className="text-xs font-mono text-zinc-400 mt-0.5">{claims?.full_name || 'Administrator'}</p>
            </div>

            <nav className="mt-6 space-y-1.5 font-mono text-xs uppercase tracking-wider">
              <button
                onClick={() => setActiveSection('personnel')}
                className="w-full text-left px-3 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                1. Personnel
              </button>
              <button
                onClick={() => setActiveSection('beds')}
                className="w-full text-left px-3 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                2. Bed Registry
              </button>
              <button
                onClick={() => setActiveSection('clinical')}
                className="w-full text-left px-3 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                3. Clinical View
              </button>
              <button
                onClick={() => setActiveSection('housekeeping')}
                className="w-full text-left px-3 py-2.5 bg-zinc-800 text-white font-bold border-l-2 border-white"
              >
                4. Housekeeping View
              </button>
            </nav>
          </div>

          <div className="pt-4 border-t border-zinc-800">
            <button
              onClick={handleLogout}
              className="w-full border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white py-2 text-xs font-mono tracking-wider transition-colors"
            >
              Log Out
            </button>
          </div>
        </aside>

        {/* Live Housekeeping Component */}
        <div className="flex-1 overflow-auto">
          <Housekeeping />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Left Sidebar Nav (not tabs) */}
      <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col justify-between p-4 shrink-0">
        <div>
          <div className="pb-6 border-b border-zinc-800">
            <div className="flex items-center space-x-2.5 mb-3">
              <img
                src="/logo_icon.png"
                alt="HIP Logo"
                className="h-8 w-8 object-contain bg-zinc-950 p-1 border border-zinc-800 rounded-xs"
              />
              <span className="text-xs font-mono uppercase px-2 py-0.5 bg-red-950 border border-red-800 text-red-300 font-bold">
                Admin Control
              </span>
            </div>
            <h1 className="text-lg font-bold font-display text-white mt-1">Hospital Platform</h1>
            <p className="text-xs font-mono text-zinc-400 mt-0.5">{claims?.full_name || 'Administrator'}</p>
          </div>

          <nav className="mt-6 space-y-1.5 font-mono text-xs uppercase tracking-wider">
            <button
              onClick={() => setActiveSection('personnel')}
              className={`w-full text-left px-3 py-2.5 transition-colors ${
                activeSection === 'personnel'
                  ? 'bg-zinc-800 text-white font-bold border-l-2 border-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
              }`}
            >
              1. Personnel
            </button>
            <button
              onClick={() => setActiveSection('beds')}
              className={`w-full text-left px-3 py-2.5 transition-colors ${
                activeSection === 'beds'
                  ? 'bg-zinc-800 text-white font-bold border-l-2 border-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
              }`}
            >
              2. Bed Registry
            </button>
            <button
              onClick={() => setActiveSection('clinical')}
              className="w-full text-left px-3 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
            >
              3. Clinical View
            </button>
            <button
              onClick={() => setActiveSection('housekeeping')}
              className="w-full text-left px-3 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
            >
              4. Housekeeping View
            </button>
          </nav>
        </div>

        <div className="pt-4 border-t border-zinc-800">
          <button
            onClick={handleLogout}
            className="w-full border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white py-2 text-xs font-mono tracking-wider transition-colors"
          >
            Log Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-auto">
        {/* SECTION 1: PERSONNEL */}
        {activeSection === 'personnel' && (
          <div>
            <div className="flex items-center justify-between pb-6 border-b border-zinc-800 mb-6">
              <div>
                <h2 className="font-display text-3xl font-bold text-white tracking-tight">
                  Hospital Personnel
                </h2>
                <p className="text-xs font-mono text-zinc-400 mt-1 uppercase tracking-wider">
                  Staff credentials, departmental provisioning & account lifecycle
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={fetchStaff}
                  className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white px-3 py-2 text-xs font-mono tracking-wider transition-colors"
                >
                  Refresh Roster
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsProvisionOpen(true);
                    setProvisionResult(null);
                    setProvisionError(null);
                  }}
                  className="bg-white text-zinc-950 hover:bg-zinc-200 px-4 py-2 text-xs font-mono uppercase tracking-wider font-bold transition-colors"
                >
                  + Provision Staff
                </button>
              </div>
            </div>

            {/* KPI Metric Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 font-mono text-xs">
              <div
                onClick={() => setStaffStatusFilter('ALL')}
                className={`p-4 border cursor-pointer transition-colors ${
                  staffStatusFilter === 'ALL'
                    ? 'bg-zinc-800/80 border-white text-white'
                    : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                }`}
              >
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Total Staff Registered</div>
                <div className="text-2xl font-bold mt-1 text-white">{staffList.length}</div>
                <div className="text-[10px] text-zinc-500 mt-1">All hospital departments</div>
              </div>

              <div
                onClick={() => setStaffStatusFilter(staffStatusFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE')}
                className={`p-4 border cursor-pointer transition-colors ${
                  staffStatusFilter === 'ACTIVE'
                    ? 'bg-green-950/60 border-green-600 text-green-300'
                    : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                }`}
              >
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-500 inline-block" /> Active Personnel
                </div>
                <div className="text-2xl font-bold mt-1 text-green-400">{activeStaffCount}</div>
                <div className="text-[10px] text-zinc-500 mt-1">Authorized for clinical shifts & login</div>
              </div>

              <div
                onClick={() => setStaffStatusFilter(staffStatusFilter === 'INACTIVE' ? 'ALL' : 'INACTIVE')}
                className={`p-4 border cursor-pointer transition-colors ${
                  staffStatusFilter === 'INACTIVE'
                    ? 'bg-red-950/60 border-red-600 text-red-300'
                    : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                }`}
              >
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> Inactive / Resigned
                </div>
                <div className="text-2xl font-bold mt-1 text-red-400">{inactiveStaffCount}</div>
                <div className="text-[10px] text-zinc-500 mt-1">Sessions revoked • Historical records preserved</div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-zinc-900 border border-zinc-800 mb-6">
              <div className="flex-1 w-full sm:w-auto relative">
                <input
                  type="text"
                  value={staffSearchQuery}
                  onChange={(e) => setStaffSearchQuery(e.target.value)}
                  placeholder="Search staff by name, username, email, department..."
                  className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 pr-8"
                />
                {staffSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setStaffSearchQuery('')}
                    className="absolute right-2.5 top-2 text-xs font-mono text-zinc-400 hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                {/* Status Filter Buttons */}
                <div className="flex border border-zinc-800 bg-zinc-950 p-0.5 text-xs font-mono">
                  {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStaffStatusFilter(st)}
                      className={`px-2.5 py-1 text-[11px] transition-colors ${
                        staffStatusFilter === st
                          ? 'bg-zinc-800 text-white font-bold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                {/* Role Filter Dropdown */}
                <select
                  value={staffRoleFilter}
                  onChange={(e) => setStaffRoleFilter(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300 px-2.5 py-1.5 focus:outline-none focus:border-zinc-600"
                >
                  <option value="ALL">All Roles</option>
                  <option value="NURSE">Nurses</option>
                  <option value="DOCTOR">Doctors</option>
                  <option value="CLEANING_CREW">Cleaning Crew</option>
                  <option value="ADMIN">Administrators</option>
                  <option value="PHARMACY">Pharmacy</option>
                </select>
              </div>
            </div>

            {/* Action Feedback Messages */}
            {staffActionSuccess && (
              <div className="mb-4 p-3 bg-green-950/60 border border-green-700 text-green-300 font-mono text-xs flex justify-between items-center">
                <span>✓ {staffActionSuccess}</span>
                <button
                  type="button"
                  onClick={() => setStaffActionSuccess(null)}
                  className="text-green-400 hover:text-white text-xs ml-3"
                >
                  ✕
                </button>
              </div>
            )}

            {staffActionError && (
              <div className="mb-4 p-3 bg-red-950/60 border border-red-700 text-red-300 font-mono text-xs flex justify-between items-center">
                <span>⚠ {staffActionError}</span>
                <button
                  type="button"
                  onClick={() => setStaffActionError(null)}
                  className="text-red-400 hover:text-white text-xs ml-3"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Staff Table */}
            <div className="border border-zinc-800 bg-zinc-900 overflow-hidden">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 uppercase">
                  <tr>
                    <th className="p-3">Full Name</th>
                    <th className="p-3">Username</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Department</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Access Control / Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {displayedStaffList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-zinc-500">
                        {staffList.length === 0
                          ? 'Loading staff records...'
                          : 'No staff members match the selected filter criteria.'}
                      </td>
                    </tr>
                  ) : (
                    displayedStaffList.map((staff) => {
                      const isSelf = staff.personnel_id === claims?.personnel_id || staff.username === claims?.username;
                      const isUpdating = togglingStaffId === staff.personnel_id;

                      return (
                        <tr key={staff.personnel_id} className="hover:bg-zinc-800/40 transition-colors">
                          <td className="p-3 font-semibold text-white flex items-center gap-2">
                            {staff.full_name}
                            {isSelf && (
                              <span className="text-[10px] font-mono px-1 bg-zinc-800 text-zinc-400 border border-zinc-700">
                                You
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-zinc-400 font-mono">@{staff.username}</td>
                          <td className="p-3">
                            <span className="px-1.5 py-0.5 border border-zinc-700 bg-zinc-800 text-zinc-300">
                              {staff.role}
                            </span>
                          </td>
                          <td className="p-3 text-zinc-400">{staff.department}</td>
                          <td className="p-3">
                            {staff.is_active ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold border border-green-800 bg-green-950/60 text-green-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                                ACTIVE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold border border-red-800 bg-red-950/60 text-red-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                                INACTIVE
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {isSelf ? (
                              <span className="text-[10px] text-zinc-500 font-mono italic">
                                Active (Your Account)
                              </span>
                            ) : staff.is_active ? (
                              <button
                                type="button"
                                onClick={() => handleToggleStaffStatus(staff)}
                                disabled={isUpdating}
                                className="border border-red-900/80 bg-red-950/30 hover:bg-red-900/60 text-red-300 hover:text-white px-2.5 py-1 text-xs font-mono transition-colors disabled:opacity-50"
                                title="Deactivate staff account and immediately revoke active sessions"
                              >
                                {isUpdating ? 'Updating...' : 'Set Inactive ✕'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleToggleStaffStatus(staff)}
                                disabled={isUpdating}
                                className="border border-green-800/80 bg-green-950/30 hover:bg-green-900/60 text-green-300 hover:text-white px-2.5 py-1 text-xs font-mono transition-colors disabled:opacity-50"
                                title="Reactivate staff account to permit shift logins"
                              >
                                {isUpdating ? 'Updating...' : 'Reactivate ✓'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-[11px] font-mono text-zinc-600 flex justify-between items-center">
              <span>Note: Staff credential modifications and deactivations are authoritatively audited under HIPAA standards.</span>
              <span>Showing {displayedStaffList.length} of {staffList.length} staff records</span>
            </div>
          </div>
        )}

        {/* SECTION 2: BED REGISTRY */}
        {activeSection === 'beds' && (
          <div>
            <div className="flex items-center justify-between pb-6 border-b border-zinc-800 mb-8">
              <div>
                <h2 className="font-display text-3xl font-bold text-white tracking-tight">
                  Bed Registry
                </h2>
                <p className="text-xs font-mono text-zinc-400 mt-1 uppercase tracking-wider">
                  Physical bed allocation & state management
                </p>
              </div>

              <button
                onClick={fetchBeds}
                className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white px-3 py-1.5 text-xs font-mono tracking-wider transition-colors"
              >
                Refresh
              </button>
            </div>

            {/* Inline Conflict Error */}
            {bedConflictError && (
              <div className="mb-6 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                {bedConflictError}
              </div>
            )}

            {/* Beds Table with Inline Dropdown */}
            <div className="border border-zinc-800 bg-zinc-900 overflow-hidden">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 uppercase">
                  <tr>
                    <th className="p-3">Bed Code</th>
                    <th className="p-3">Room Number</th>
                    <th className="p-3">Department</th>
                    <th className="p-3">Version</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {beds.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-zinc-500">
                        Loading bed inventory...
                      </td>
                    </tr>
                  ) : (
                    beds.map((b) => (
                      <tr key={b.bed_id} className="hover:bg-zinc-800/40">
                        <td className="p-3 font-bold text-white">{b.bed_code}</td>
                        <td className="p-3 text-zinc-400">Room {b.room_number}</td>
                        <td className="p-3 text-zinc-400">{b.department}</td>
                        <td className="p-3 text-zinc-500">v{b.version}</td>
                        <td className="p-3">
                          {b.status === 'OCCUPIED' ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-mono font-bold bg-amber-950/60 border border-amber-800 text-amber-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                                OCCUPIED {b.patient_name ? `• ${b.patient_name}` : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => setActiveSection('clinical')}
                                className="text-[11px] text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600 px-2 py-1 transition-colors whitespace-nowrap"
                                title="Go to Clinical Board to manage patient or discharge"
                              >
                                Clinical Board →
                              </button>
                            </div>
                          ) : b.status === 'RESERVED' ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-mono font-bold bg-blue-950/60 border border-blue-800 text-blue-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                                RESERVED {b.patient_name ? `• ${b.patient_name}` : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => setActiveSection('clinical')}
                                className="text-[11px] text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600 px-2 py-1 transition-colors whitespace-nowrap"
                                title="Go to Clinical Board to confirm patient arrival"
                              >
                                Clinical Board →
                              </button>
                            </div>
                          ) : (
                            <select
                              disabled={updatingBedId === b.bed_id}
                              value={b.status}
                              onChange={(e) => handleBedStatusChange(b, e.target.value as BedStatus)}
                              className="bg-zinc-950 border border-zinc-700 text-white px-2 py-1 text-xs font-mono focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                            >
                              <option value="AVAILABLE">AVAILABLE</option>
                              <option value="DIRTY">DIRTY (Needs Cleaning)</option>
                              <option value="CLEANING_IN_PROGRESS">CLEANING IN PROGRESS</option>
                              <option value="MAINTENANCE">MAINTENANCE (Out of Order)</option>
                            </select>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* PROVISION STAFF RIGHT DRAWER */}
      {isProvisionOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={() => {
              setIsProvisionOpen(false);
              setProvisionResult(null);
            }}
          />

          {/* Right Panel */}
          <div className="relative z-10 w-full max-w-md bg-zinc-900 border-l border-zinc-800 h-full p-6 overflow-y-auto flex flex-col justify-between shadow-2xl">
            <div>
              <div className="flex items-start justify-between pb-4 border-b border-zinc-800 mb-6">
                <div>
                  <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                    Administrator Gate
                  </span>
                  <h3 className="text-xl font-bold font-mono text-white mt-1">Provision New Staff</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsProvisionOpen(false);
                    setProvisionResult(null);
                  }}
                  className="text-zinc-400 hover:text-white p-1 text-xs font-mono border border-zinc-800 hover:border-zinc-700"
                >
                  ESC ✕
                </button>
              </div>

              {provisionError && (
                <div className="mb-4 p-3 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                  {provisionError}
                </div>
              )}

              {/* SUCCESS STATE: Display Temporary Password */}
              {provisionResult ? (
                <div className="space-y-5">
                  <div className="p-4 border border-amber-800 bg-amber-950/40 text-amber-200 text-xs font-mono">
                    <p className="font-bold uppercase tracking-wider mb-2">⚠ Caution: Shown Once Only</p>
                    <p className="leading-relaxed">
                      Staff account provisioned successfully. This temporary password will{' '}
                      <span className="underline font-bold">never be displayed again</span>. Please copy and securely deliver it to the user now.
                    </p>
                  </div>

                  <div className="bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs space-y-2">
                    <div>
                      <span className="text-zinc-500 uppercase">Username:</span>{' '}
                      <span className="text-white font-bold">{provisionResult.username}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 uppercase">Role:</span>{' '}
                      <span className="text-zinc-300">{provisionResult.role}</span>
                    </div>
                    <div className="pt-2">
                      <span className="text-zinc-500 uppercase block mb-1">Temporary Password:</span>
                      <div className="flex items-center space-x-2">
                        <code className="bg-zinc-900 border border-zinc-700 text-green-400 font-bold px-3 py-2 text-sm flex-1 tracking-wider">
                          {provisionResult.temporary_password}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(provisionResult.temporary_password)}
                          className="bg-white text-zinc-950 px-3 py-2 text-xs font-bold hover:bg-zinc-200 transition-colors uppercase"
                        >
                          {copyFeedback ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsProvisionOpen(false);
                      setProvisionResult(null);
                    }}
                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-2.5 text-xs font-mono uppercase tracking-wider font-bold transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                /* FORM */
                <form onSubmit={handleProvisionSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Dr. Eleanor Vance"
                      className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. evance"
                      className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-1">
                      Hospital Email
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. evance@hospital.org"
                      className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-1">
                      Role
                    </label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as Role)}
                      className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-zinc-500"
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="DOCTOR">DOCTOR</option>
                      <option value="NURSE">NURSE</option>
                      <option value="CLEANING_CREW">CLEANING_CREW</option>
                      <option value="PHARMACY">PHARMACY</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 mb-1">
                      Department
                    </label>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value as Department)}
                      className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-zinc-500"
                    >
                      <option value="EMERGENCY">EMERGENCY</option>
                      <option value="ICU">ICU</option>
                      <option value="STEP_DOWN">STEP_DOWN</option>
                      <option value="GENERAL_WARD">GENERAL_WARD</option>
                      <option value="SURGERY">SURGERY</option>
                      <option value="PHARMACY">PHARMACY</option>
                      <option value="HOUSEKEEPING">HOUSEKEEPING</option>
                      <option value="ADMINISTRATION">ADMINISTRATION</option>
                    </select>
                  </div>

                  <div className="pt-4">
                    <button
                      type="submit"
                      disabled={provisionLoading}
                      className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 text-xs font-mono uppercase tracking-wider font-bold transition-colors"
                    >
                      {provisionLoading ? 'Generating Credentials...' : 'Generate Temporary Credentials'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="pt-6 border-t border-zinc-800 text-[11px] font-mono text-zinc-500">
              Press Escape or click outside to dismiss this panel.
            </div>
          </div>
        </div>
      )}

      {/* DEACTIVATE CONFIRMATION MODAL */}
      {confirmDeactivateStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setConfirmDeactivateStaff(null)}
          />

          <div className="relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-800 p-6 shadow-2xl font-mono">
            <div className="flex items-start justify-between pb-3 border-b border-zinc-800 mb-4">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-red-400 font-bold">
                  Administrative Action
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">Deactivate Staff Account</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeactivateStaff(null)}
                className="text-zinc-500 hover:text-white text-xs border border-zinc-800 p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300">
              <p>
                Are you sure you want to deactivate <strong className="text-white">{confirmDeactivateStaff.full_name}</strong> (Username: <span className="text-zinc-400">@{confirmDeactivateStaff.username}</span>, Role: <span className="text-zinc-400">{confirmDeactivateStaff.role}</span>)?
              </p>

              <div className="p-3 bg-red-950/40 border border-red-900/60 text-red-200 text-[11px] space-y-1">
                <p className="font-bold uppercase tracking-wider">Security Consequences:</p>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-300">
                  <li>Immediately revokes all active access & refresh tokens.</li>
                  <li>Blocks any new login attempts to the platform.</li>
                  <li>Historical charts, vitals, and audit logs are safely retained.</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setConfirmDeactivateStaff(null)}
                className="border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white px-4 py-2 text-xs uppercase tracking-wider transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={togglingStaffId === confirmDeactivateStaff.personnel_id}
                className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                {togglingStaffId === confirmDeactivateStaff.personnel_id
                  ? 'Deactivating...'
                  : 'Confirm Deactivation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
