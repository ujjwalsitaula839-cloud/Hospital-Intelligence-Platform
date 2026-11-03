import React, { createContext, useContext, useEffect, useState } from 'react';
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
    if (sessionStorage.getItem('refresh_token')) return decoded;
  } catch {
    // Malformed token
  }
  sessionStorage.removeItem('token');
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [claims, setClaims] = useState<TokenClaims | null>(getStoredClaims);

  const refreshAuth = (): TokenClaims | null => {
    const current = getStoredClaims();
    setClaims(current);
    return current;
  };

  useEffect(() => {
    refreshAuth();

    const handleAuthExpired = () => {
      setClaims(null);
    };

    window.addEventListener('hip:auth_expired', handleAuthExpired);
    return () => {
      window.removeEventListener('hip:auth_expired', handleAuthExpired);
    };
  }, []);

  const login = async (credentials: { email: string; password: string }): Promise<TokenClaims> => {
    const data = await api.login(credentials);
    sessionStorage.setItem('token', data.access_token);
    // TODO: Implement refresh token logic using data.refresh_token
    if (data.refresh_token) {
      sessionStorage.setItem('refresh_token', data.refresh_token);
    }
    const decoded = decodeJwt(data.access_token);
    setClaims(decoded);
    return decoded;
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
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
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('token') : null;
    let fallbackClaims: TokenClaims | null = null;
    if (token) {
      try {
        const payload = token.split('.')[1];
        if (payload) {
          fallbackClaims = JSON.parse(atob(payload)) as TokenClaims;
        }
      } catch {
        // ignore malformed token
      }
    }
    return {
      claims: fallbackClaims,
      isAuthenticated: Boolean(fallbackClaims),
      mustChangePassword: Boolean(fallbackClaims?.must_change_password),
      login: async () => fallbackClaims as TokenClaims,
      logout: async () => {},
      refreshAuth: () => fallbackClaims,
    };
  }
  return context;
}
