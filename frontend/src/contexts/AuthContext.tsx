import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { AuthResponse, PersonnelProfile } from '../types/auth';
import { authService } from '../services/hipServices';

interface AuthContextType {
    user: Partial<PersonnelProfile> | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<AuthResponse>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<Partial<PersonnelProfile> | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearAuth = useCallback(() => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('hip_access_token');
        localStorage.removeItem('hip_refresh_token');
        localStorage.removeItem('hip_user');
        if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = null;
        }
    }, []);

    const scheduleRefresh = useCallback((expiresIn: number) => {
        if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
        }
        // Refresh 60 seconds before expiry
        const refreshDelay = Math.max((expiresIn - 60) * 1000, 30000);
        refreshTimerRef.current = setTimeout(async () => {
            const refreshToken = localStorage.getItem('hip_refresh_token');
            if (!refreshToken) {
                clearAuth();
                return;
            }
            try {
                const response = await authService.refresh(refreshToken);
                setToken(response.access_token);
                localStorage.setItem('hip_access_token', response.access_token);
                localStorage.setItem('hip_refresh_token', response.refresh_token);
                setUser({
                    personnel_id: response.personnel_id,
                    username: response.username,
                    full_name: response.full_name,
                    role: response.role,
                    department: response.department,
                });
                localStorage.setItem('hip_user', JSON.stringify({
                    personnel_id: response.personnel_id,
                    username: response.username,
                    full_name: response.full_name,
                    role: response.role,
                    department: response.department,
                }));
                scheduleRefresh(response.expires_in);
            } catch {
                clearAuth();
            }
        }, refreshDelay);
    }, [clearAuth]);

    // Check for existing session on mount
    useEffect(() => {
        const existingToken = localStorage.getItem('hip_access_token');
        const existingUser = localStorage.getItem('hip_user');
        if (existingToken && existingUser) {
            setToken(existingToken);
            try {
                setUser(JSON.parse(existingUser));
            } catch {
                clearAuth();
            }
            // Schedule a refresh — we don't know exact expiry, so refresh in 5 min
            scheduleRefresh(300);
        }
        setIsLoading(false);

        return () => {
            if (refreshTimerRef.current) {
                clearTimeout(refreshTimerRef.current);
            }
        };
    }, [clearAuth, scheduleRefresh]);

    const login = useCallback(async (email: string, password: string): Promise<AuthResponse> => {
        const response = await authService.login({ email, password });
        setToken(response.access_token);
        const userData: Partial<PersonnelProfile> = {
            personnel_id: response.personnel_id,
            username: response.username,
            full_name: response.full_name,
            role: response.role,
            department: response.department,
        };
        setUser(userData);
        scheduleRefresh(response.expires_in);
        return response;
    }, [scheduleRefresh]);

    const logout = useCallback(() => {
        authService.logout();
        clearAuth();
    }, [clearAuth]);

    return (
        <AuthContext.Provider value={{
            user,
            token,
            isAuthenticated: !!token && !!user,
            isLoading,
            login,
            logout,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export function useAuth(): AuthContextType {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
