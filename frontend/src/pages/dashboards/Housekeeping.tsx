import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
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
  const { claims, logout } = useAuth();
  const navigate = useNavigate();

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
        // Automatically sync sanitization queue on any real-time hospital bed event
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

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

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

  const filteredTasks = tasks.filter((t) => t.status === activeTab);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2.5 pr-3.5 border-r border-zinc-800">
              <img
                src="/logo_icon.png"
                alt="HIP Logo"
                className="h-7 w-7 object-contain bg-zinc-950 p-0.5 border border-zinc-800 rounded-xs"
              />
              <span className="font-display font-bold text-white text-sm tracking-tight hidden sm:inline">
                HIP
              </span>
            </div>
            <span className="font-mono text-xs uppercase px-2 py-1 bg-zinc-800 text-zinc-300 font-semibold tracking-wider">
              EVS Housekeeping
            </span>
            <span className="text-sm text-zinc-300">
              Staff: <span className="font-semibold text-white">{claims?.full_name || claims?.username || 'Staff'}</span>
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white px-3 py-1.5 text-xs font-mono tracking-wider transition-colors"
          >
            Log Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold text-white tracking-tight">
              Bed Sanitization Queue
            </h1>
            <p className="text-xs font-mono text-zinc-400 mt-1 uppercase tracking-wider">
              Real-time terminal disinfection workflow
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchTasks}
              className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white px-3 py-1.5 text-xs font-mono tracking-wider transition-colors"
            >
              Refresh Queue
            </button>
          </div>
        </div>

        {/* Tab Filters (Underlined, not pills/badges) */}
        <div className="flex space-x-8 border-b border-zinc-800 mb-6">
          <button
            onClick={() => setActiveTab('PENDING')}
            className={`pb-3 text-xs font-mono uppercase tracking-wider transition-colors border-b-2 ${
              activeTab === 'PENDING'
                ? 'border-white text-white font-bold'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Pending ({tasks.filter((t) => t.status === 'PENDING').length})
          </button>
          <button
            onClick={() => setActiveTab('IN_PROGRESS')}
            className={`pb-3 text-xs font-mono uppercase tracking-wider transition-colors border-b-2 ${
              activeTab === 'IN_PROGRESS'
                ? 'border-white text-white font-bold'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            In Progress ({tasks.filter((t) => t.status === 'IN_PROGRESS').length})
          </button>
        </div>

        {/* Tasks List */}
        {filteredTasks.length === 0 ? (
          <div className="border border-dashed border-zinc-800 p-12 text-center text-zinc-500 font-mono text-sm">
            No {activeTab.toLowerCase().replace('_', ' ')} cleaning tasks at this time.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredTasks.map((task) => (
              <div
                key={task.cleaning_id}
                className="bg-zinc-900 border border-zinc-800 p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Bed Code</span>
                      <h2 className="text-xl font-bold font-mono text-white tracking-tight">
                        {task.bed_code}
                      </h2>
                    </div>
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-1">
                      Room {task.room_number}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 text-xs font-mono text-zinc-400 mb-4">
                    <span>Requested:</span>
                    <span className="text-zinc-300">{formatTimeSince(task.requested_datetime)}</span>
                  </div>

                  {task.disinfection_notes && (
                    <p className="text-xs text-zinc-400 bg-zinc-950 p-2 border border-zinc-800 mb-4 font-mono">
                      {task.disinfection_notes}
                    </p>
                  )}

                  {/* Inline Error Per Card */}
                  {cardErrors[task.cleaning_id] && (
                    <div className="mb-4 p-2 bg-red-950 border border-red-800 text-red-200 text-xs font-mono">
                      {cardErrors[task.cleaning_id]}
                    </div>
                  )}

                  {/* IN_PROGRESS: Textarea for Disinfection Notes */}
                  {task.status === 'IN_PROGRESS' && (
                    <div className="mb-4">
                      <label className="block text-xs font-mono text-zinc-400 uppercase tracking-wider mb-1">
                        Disinfection Notes
                      </label>
                      <textarea
                        rows={2}
                        value={notes[task.cleaning_id] || ''}
                        onChange={(e) =>
                          setNotes((prev) => ({
                            ...prev,
                            [task.cleaning_id]: e.target.value,
                          }))
                        }
                        placeholder="e.g. UV terminal cleaning completed. Standard PPE used."
                        className="w-full bg-zinc-950 border border-zinc-800 p-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  )}
                </div>

                {/* Card Action Button */}
                <div className="pt-2">
                  {task.status === 'PENDING' ? (
                    <button
                      type="button"
                      disabled={actionLoading[task.cleaning_id]}
                      onClick={() => handleStart(task.cleaning_id)}
                      className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-400 py-2.5 text-xs font-mono uppercase tracking-wider font-semibold transition-colors"
                    >
                      {actionLoading[task.cleaning_id] ? 'Starting...' : 'Start Cleaning'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actionLoading[task.cleaning_id]}
                      onClick={() => handleComplete(task.cleaning_id)}
                      className="w-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-400 py-2.5 text-xs font-mono uppercase tracking-wider font-semibold transition-colors"
                    >
                      {actionLoading[task.cleaning_id] ? 'Completing...' : 'Complete'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
