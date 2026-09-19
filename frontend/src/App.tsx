import React from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DashboardView } from './views/DashboardView';
import { LoginView } from './views/LoginView';
import { Activity, LogOut, User, Loader2 } from 'lucide-react';

const AuthenticatedApp: React.FC = () => {
    const { user, logout, isLoading } = useAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
            </div>
        );
    }

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
                                    v3.0 HIPAA
                                </span>
                            </div>
                            <p className="text-2xs text-slate-400">Hospital Intelligence Platform</p>
                        </div>
                    </div>

                    {/* User Info & Actions */}
                    <div className="flex items-center gap-4">
                        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                            <span className="text-2xs font-medium text-emerald-400">WebSocket Live Sync</span>
                        </div>

                        {/* Current User */}
                        <div className="flex items-center gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800">
                            <User className="w-3.5 h-3.5 text-slate-400 ml-1" />
                            <div className="text-left hidden md:block">
                                <span className="text-2xs font-bold text-white block">{user?.full_name || 'User'}</span>
                                <span className="text-2xs text-slate-400 block">{user?.role || ''} • {user?.department || ''}</span>
                            </div>
                            <span className="text-2xs font-semibold px-2 py-0.5 bg-sky-500/10 text-sky-300 border border-sky-500/20 rounded-lg">
                                {user?.role || 'USER'}
                            </span>
                        </div>

                        {/* Logout Button */}
                        <button
                            onClick={logout}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors text-xs font-semibold"
                            title="Sign out"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Sign Out</span>
                        </button>
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

const AppRouter: React.FC = () => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return <LoginView />;
    }

    return <AuthenticatedApp />;
};

export const App: React.FC = () => {
    return (
        <AuthProvider>
            <AppRouter />
        </AuthProvider>
    );
};

export default App;
