import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Admin from './pages/dashboards/Admin';
import Clinical from './pages/dashboards/Clinical';
import Housekeeping from './pages/dashboards/Housekeeping';
import ForceReset from './pages/ForceReset';
import ForgotPassword from './pages/ForgotPassword';
import Landing from './pages/Landing';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import type { Role } from './types';

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: Role[] }) {
  const { isAuthenticated, mustChangePassword, claims } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/force-reset" replace />;
  if (allowedRoles && claims && !allowedRoles.includes(claims.role)) {
    return <h1 className="p-8 text-2xl font-bold text-red-600 font-mono">403 Forbidden - Access Denied</h1>;
  }
  return <>{children}</>;
}

export default function App(): React.ReactElement {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/force-reset" element={<ForceReset />} />
          <Route
            path="/dashboard/admin"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/clinical"
            element={
              <ProtectedRoute allowedRoles={['DOCTOR', 'NURSE']}>
                <Clinical />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/housekeeping"
            element={
              <ProtectedRoute allowedRoles={['CLEANING_CREW']}>
                <Housekeeping />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
