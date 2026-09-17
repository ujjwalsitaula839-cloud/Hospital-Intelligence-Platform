import React, { useState } from 'react';
import { DashboardView } from './views/DashboardView';
import { Activity, User } from 'lucide-react';
import type { UserRole } from './types/auth';

export const App: React.FC = () => {
    const [currentRole, setCurrentRole] = useState<UserRole>('NURSE');
    const [userName, setUserName] = useState('Charge Nurse Sarah, RN');

    const handleRoleChange = (role: UserRole) => {
        setCurrentRole(role);
        if (role === 'NURSE') setUserName('Charge Nurse Sarah, RN');
        else if (role === 'DOCTOR') setUserName('Dr. Michael Chen, MD');
        else if (role === 'CLEANING_CREW') setUserName('Marcus Vance (EVS Lead)');
        else if (role === 'PHARMACY') setUserName('Elena Rostova, PharmD');
        else setUserName('Admin Hospital Operations');
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
            {/* TOP NAVIGATION BAR */}
            <header className="bg-slate-900/80 border-b border-slate-800 sticky top-0 z-40 backdrop-blur">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
                    {/* Brand */}
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
                            <Activity className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="font-extrabold text-base tracking-tight text-white">HIP</span>
                                <span className="text-2xs font-semibold px-1.5 py-0.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded">
                                    v2.0 HIPAA
                                </span>
                            </div>
                            <p className="text-2xs text-slate-400">Hospital Intelligence Platform</p>
                        </div>
                    </div>

                    {/* Active Live Stream Indicator & Role Switcher */}
                    <div className="flex items-center gap-4">
                        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                            <span className="text-2xs font-medium text-emerald-400">WebSocket Live Sync</span>
                        </div>

                        {/* Role Simulator */}
                        <div className="flex items-center gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800">
                            <User className="w-3.5 h-3.5 text-slate-400 ml-1" />
                            <div className="text-left hidden md:block">
                                <span className="text-2xs font-bold text-white block">{userName}</span>
                            </div>
                            <select
                                value={currentRole}
                                onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                                className="bg-slate-900 border border-slate-700 text-2xs text-sky-300 font-semibold rounded-lg px-2 py-1 outline-none cursor-pointer"
                            >
                                <option value="NURSE">Role: Charge Nurse</option>
                                <option value="DOCTOR">Role: Attending MD</option>
                                <option value="CLEANING_CREW">Role: EVS Cleaning Crew</option>
                                <option value="PHARMACY">Role: Pharmacist</option>
                                <option value="ADMIN">Role: Admin Operations</option>
                            </select>
                        </div>
                    </div>
                </div>
            </header>

            {/* MAIN CONTENT AREA */}
            <main className="flex-1">
                <DashboardView />
            </main>

            {/* FOOTER */}
            <footer className="border-t border-slate-800/80 bg-slate-950 py-4 text-center text-2xs text-slate-500">
                <p>Hospital Intelligence Platform (HIP) • HIPAA Compliant Real-Time Orchestration • PostgreSQL / Redis Mesh</p>
            </footer>
        </div>
    );
};

export default App;
