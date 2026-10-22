import React, { useEffect, useState } from 'react';
import AppLayout from '../../components/layout/AppLayout';
// @ts-ignore
import { HeroStat, PageHero } from '../../dashboard/ui';
import { api } from '../../lib/api';
import type { CleaningTask } from '../../types';

function formatTimeSince(dateStr?: string | null): string {
  if (!dateStr) return 'Just now';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (diffMs <= 0) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Housekeeping(): React.ReactElement {
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'IN_PROGRESS'>('PENDING');
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});
  const [cardErrors, setCardErrors] = useState<Record<number, string | null>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  const fetchTasks = async () => {
    try {
      const data = await api.getCleaningTasks();
      setTasks(data);
    } catch {
      // Non-blocking fetch failure
    }
  };

  useEffect(() => {
    fetchTasks();

    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let timeoutId: number | null = null;
    let isUnmounted = false;

    const connect = () => {
      const token = sessionStorage.getItem('token');
      if (!token || isUnmounted) return;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
      const wsHost = baseUrl ? baseUrl.replace(/^https?:\/\//, '') : (window.location.port === '5173' || window.location.port === '3000' ? 'localhost:8080' : window.location.host);
      ws = new WebSocket(`${wsProtocol}//${wsHost}/ws/beds?token=${encodeURIComponent(token)}`);

      ws.onmessage = () => {
        // Automatically sync sanitization queue on real-time hospital bed status updates
        fetchTasks();
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        if (reconnectAttempts < 10) {
          reconnectAttempts++;
          timeoutId = window.setTimeout(connect, 3000);
        }
      };
    };

    connect();

    const handleTokenRefreshed = () => {
      if (isUnmounted) return;
      reconnectAttempts = 0;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connect();
      }
    };
    window.addEventListener('hip:token-refreshed', handleTokenRefreshed);

    const handleSync = () => {
      fetchTasks();
    };
    window.addEventListener('hip:bed-updated', handleSync);
    window.addEventListener('hip:state-sync', handleSync);

    return () => {
      isUnmounted = true;
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('hip:token-refreshed', handleTokenRefreshed);
      window.removeEventListener('hip:bed-updated', handleSync);
      window.removeEventListener('hip:state-sync', handleSync);
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

  const handleStart = async (id: number) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    setCardErrors((prev) => ({ ...prev, [id]: null }));

    try {
      await api.updateCleaningTask(id, { status: 'IN_PROGRESS' });
      await fetchTasks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start cleaning task.';
      setCardErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleComplete = async (id: number) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    setCardErrors((prev) => ({ ...prev, [id]: null }));

    try {
      await api.updateCleaningTask(id, {
        status: 'COMPLETED',
        notes: notes[id]?.trim() || undefined,
      });
      await fetchTasks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to complete cleaning task.';
      setCardErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const pendingCount = tasks.filter((t) => t.status === 'PENDING').length;
  const inProgressCount = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
  const filteredTasks = tasks.filter((t) => t.status === activeTab);

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).toUpperCase();

  return (
    <AppLayout activeNav="housekeeping">
      {/* Full-bleed Clinical Page Hero */}
      <PageHero
        image="/main-hospital.jpg"
        position="center 38%"
        kicker={`${dateLabel} · EVS OPERATIONS`}
        title="Hospital Sanitization & Bed Turnover"
        sub="Real-time terminal disinfection, room turnover, and live floor plan bed availability."
      >
        <div className="hero-stats">
          <HeroStat value={pendingCount} label="Dirty beds queue" tone={pendingCount ? 'alert' : undefined} />
          <HeroStat value={inProgressCount} label="Cleaning in progress" tone={inProgressCount ? 'warn' : undefined} />
          <HeroStat value="< 20m" label="Turnover SLA target" />
          <HeroStat value="Synchronized" label="Live floor plan" tone="text" />
        </div>
      </PageHero>

      {/* Main Content Area */}
      <div className="w-full flex-1 p-6 sm:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Action Row & Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="inline-flex items-center bg-white p-1 rounded-2xl shadow-sm border border-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab('PENDING')}
                style={activeTab === 'PENDING' ? { color: '#ffffff', backgroundColor: '#1b2c49' } : {}}
                className={`px-5 py-2.5 rounded-xl font-semibold text-xs transition-all flex items-center gap-2 ${
                  activeTab === 'PENDING'
                    ? 'bg-[#1b2c49] text-white shadow'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span style={activeTab === 'PENDING' ? { color: '#ffffff' } : {}}>Dirty / Pending</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'PENDING' ? 'bg-amber-400/20 text-amber-300' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {pendingCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('IN_PROGRESS')}
                style={activeTab === 'IN_PROGRESS' ? { color: '#ffffff', backgroundColor: '#1b2c49' } : {}}
                className={`px-5 py-2.5 rounded-xl font-semibold text-xs transition-all flex items-center gap-2 ${
                  activeTab === 'IN_PROGRESS'
                    ? 'bg-[#1b2c49] text-white shadow'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span style={activeTab === 'IN_PROGRESS' ? { color: '#ffffff' } : {}}>Cleaning In Progress</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'IN_PROGRESS' ? 'bg-sky-400/20 text-sky-300' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {inProgressCount}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={fetchTasks}
              className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-xl font-semibold text-xs shadow-sm transition-all flex items-center gap-2 self-start sm:self-auto"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M16.5 10a6.5 6.5 0 1 1-2-4.7M16.5 3.5v3.3h-3.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Refresh Queue</span>
            </button>
          </div>

          {/* Cards Grid or Empty State */}
          {filteredTasks.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center shadow-sm">
              <span className="text-4xl block mb-3">🧹</span>
              <h3 className="text-base font-semibold text-slate-900">
                No {activeTab.toLowerCase().replace('_', ' ')} sanitization tasks right now.
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                When a patient is discharged from the clinical workstation, terminal sanitization tasks populate automatically to restore bed availability.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredTasks.map((task) => (
                <div
                  key={task.cleaning_id}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Top Row: Bed Title + Status Badge */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-slate-900">
                          {task.bed_code}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                          {task.department || 'Ward'}
                        </span>
                      </div>

                      {task.status === 'PENDING' ? (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          DIRTY
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-50 text-sky-800 border border-sky-200 inline-flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                          CLEANING
                        </span>
                      )}
                    </div>

                    {/* Meta Details */}
                    <div className="space-y-1.5 text-xs text-slate-500 mb-4 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                      <div className="flex justify-between">
                        <span>Room Location:</span>
                        <span className="font-semibold text-slate-700">Room {task.room_number}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Requested:</span>
                        <span className="font-semibold text-slate-700">{formatTimeSince(task.requested_datetime)}</span>
                      </div>
                      {task.personnel_id && (
                        <div className="flex justify-between">
                          <span>Staff ID:</span>
                          <span className="font-semibold text-slate-700">#{task.personnel_id}</span>
                        </div>
                      )}
                    </div>

                    {/* In Progress Input for Notes */}
                    {task.status === 'IN_PROGRESS' && (
                      <div className="mb-4">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Disinfection & Turnover Notes:
                        </label>
                        <input
                          type="text"
                          value={notes[task.cleaning_id] || ''}
                          onChange={(e) => setNotes({ ...notes, [task.cleaning_id]: e.target.value })}
                          placeholder="e.g. UV disinfection complete, linens refreshed"
                          className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                        />
                      </div>
                    )}

                    {cardErrors[task.cleaning_id] && (
                      <p className="text-xs text-rose-600 mb-3 bg-rose-50 border border-rose-200 p-2 rounded-lg">
                        {cardErrors[task.cleaning_id]}
                      </p>
                    )}
                  </div>

                  {/* Action Button */}
                  <div className="pt-3 border-t border-slate-100">
                    {task.status === 'PENDING' ? (
                      <button
                        type="button"
                        onClick={() => handleStart(task.cleaning_id)}
                        disabled={actionLoading[task.cleaning_id]}
                        className="w-full py-2.5 px-4 bg-[#1b2c49] text-white hover:bg-[#0f1b31] disabled:opacity-50 rounded-xl font-semibold text-xs shadow-sm transition-all flex items-center justify-center gap-2"
                      >
                        {actionLoading[task.cleaning_id] ? 'Starting…' : 'Start Cleaning'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleComplete(task.cleaning_id)}
                        disabled={actionLoading[task.cleaning_id]}
                        className="w-full py-2.5 px-4 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 rounded-xl font-semibold text-xs shadow-sm transition-all flex items-center justify-center gap-2"
                      >
                        {actionLoading[task.cleaning_id] ? 'Completing…' : 'Complete Clean'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
