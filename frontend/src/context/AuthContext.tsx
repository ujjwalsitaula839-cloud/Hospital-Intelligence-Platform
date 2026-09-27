import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, decodeJwt } from '../lib/api';
import type { TokenClaims } from '../types';

interface AuthContextType {
  claims: TokenClaims | null;
  isAuthenticated: boolean;
  mustChangePassword: boolean;
  login: (credentials: { email: string; password: string }) => Promise<TokenClaims>;
  logout: () => Promise<void>;
  refreshAuth: () => TokenClaims | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStoredClaims(): TokenClaims | null {
  const token = sessionStorage.getItem('token');
  if (!token) return null;
  try {
    const decoded = decodeJwt(token);
    if (decoded.exp * 1000 > Date.now()) return decoded;
  } catch {
    // Malformed token
  }
  sessionStorage.removeItem('token');
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [claims, setClaims] = useState<TokenClaims | null>(getStoredClaims);
  const refreshTimerRef = useRef<number | null>(null);

  const scheduleTokenRefresh = useCallback((expTimestamp: number) => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const now = Date.now();
    const expiryMs = expTimestamp * 1000;
    // Attempt silent refresh 60 seconds before expiration (minimum 5s from now)
    const delay = Math.max(expiryMs - now - 60000, 5000);

    refreshTimerRef.current = window.setTimeout(async () => {
      const refreshToken = sessionStorage.getItem('refresh_token');
      if (!refreshToken) return;

      try {
        const data = await api.refreshToken(refreshToken);
        sessionStorage.setItem('token', data.access_token);
        if (data.refresh_token) {
          sessionStorage.setItem('refresh_token', data.refresh_token);
        }
        const decoded = decodeJwt(data.access_token);
        setClaims(decoded);
        scheduleTokenRefresh(decoded.exp);
      } catch {
        // If refresh fails, api.ts handles eviction or next request triggers retry/expiry
      }
    }, delay);
  }, []);

  const refreshAuth = useCallback((): TokenClaims | null => {
    const current = getStoredClaims();
    setClaims(current);
    if (current?.exp) {
      scheduleTokenRefresh(current.exp);
    }
    return current;
  }, [scheduleTokenRefresh]);

  useEffect(() => {
    const current = refreshAuth();
    if (current?.exp) {
      scheduleTokenRefresh(current.exp);
    }

    const handleAuthExpired = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      setClaims(null);
    };

    const handleTokenRefreshed = (e: Event) => {
      const customEvent = e as CustomEvent<{ token: string }>;
      if (customEvent.detail?.token) {
        try {
          const decoded = decodeJwt(customEvent.detail.token);
          setClaims(decoded);
          scheduleTokenRefresh(decoded.exp);
        } catch {
          // Ignore decode error
        }
      }
    };

    window.addEventListener('hip:auth-expired', handleAuthExpired);
    window.addEventListener('hip:token-refreshed', handleTokenRefreshed);

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      window.removeEventListener('hip:auth-expired', handleAuthExpired);
      window.removeEventListener('hip:token-refreshed', handleTokenRefreshed);
    };
  }, [refreshAuth, scheduleTokenRefresh]);

  const login = async (credentials: { email: string; password: string }): Promise<TokenClaims> => {
    const data = await api.login(credentials);
    sessionStorage.setItem('token', data.access_token);
    if (data.refresh_token) {
      sessionStorage.setItem('refresh_token', data.refresh_token);
    }
    const decoded = decodeJwt(data.access_token);
    setClaims(decoded);
    scheduleTokenRefresh(decoded.exp);
    return decoded;
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('refresh_token');
      setClaims(null);
    }
  };

  const isAuthenticated = !!claims;
  const mustChangePassword = claims?.must_change_password ?? false;

  return (
    <AuthContext.Provider
      value={{
        claims,
        isAuthenticated,
        mustChangePassword,
        login,
        logout,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
