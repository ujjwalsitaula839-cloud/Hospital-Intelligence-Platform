import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Activity, LogIn, AlertCircle, Loader2 } from 'lucide-react';

export const LoginView: React.FC = () => {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            await login(email, password);
        } catch (err: any) {
            if (err?.response?.status === 429) {
                setError('Too many login attempts. Please wait and try again.');
            } else if (err?.response?.status === 401) {
                setError('Invalid email or password.');
            } else if (err?.response?.status === 403) {
                setError('Account is inactive. Contact your administrator.');
            } else {
                setError('Unable to connect. Please check your network.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
            {/* Ambient background glow */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-sky-500/5 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">
                {/* Brand Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 shadow-xl shadow-sky-500/20 mb-4">
                        <Activity className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-extrabold text-white tracking-tight">
                        Hospital Intelligence Platform
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                        Secure clinical operations dashboard
                    </p>
                    <div className="inline-flex items-center gap-1.5 mt-3 px-2.5 py-1 bg-sky-500/10 border border-sky-500/20 rounded-full">
                        <span className="text-xs font-semibold text-sky-400">v3.0 HIPAA Compliant</span>
                    </div>
                </div>

                {/* Login Card */}
                <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-8 shadow-2xl shadow-black/40">
                    <h2 className="text-lg font-bold text-white mb-6">Sign in to your account</h2>

                    {error && (
                        <div className="flex items-start gap-2.5 p-3 mb-5 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                            <span className="text-sm text-red-300">{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="login-email" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                                Email Address
                            </label>
                            <input
                                id="login-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@hospital.org"
                                required
                                autoComplete="email"
                                className="w-full px-4 py-3 bg-slate-950/60 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 transition-all text-sm"
                            />
                        </div>

                        <div>
                            <label htmlFor="login-password" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                                Password
                            </label>
                            <input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                autoComplete="current-password"
                                className="w-full px-4 py-3 bg-slate-950/60 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 transition-all text-sm"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold rounded-xl transition-all duration-200 shadow-lg shadow-sky-500/20 hover:shadow-sky-500/30 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Authenticating...</span>
                                </>
                            ) : (
                                <>
                                    <LogIn className="w-4 h-4" />
                                    <span>Sign In</span>
                                </>
                            )}
                        </button>
                    </form>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-slate-600 mt-6">
                    HIP • HIPAA Compliant Real-Time Orchestration
                </p>
            </div>
        </div>
    );
};
