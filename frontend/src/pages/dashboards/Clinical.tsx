import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../../components/layout/AppLayout';
import { useAuth } from '../../context/AuthContext';
// @ts-ignore
import CommandCenter from '../../dashboard/CommandCenter';

export default function Clinical(): React.ReactElement {
  const { claims, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  };

  return (
    <AppLayout activeNav="clinical" hideHeader={true}>
      <CommandCenter user={claims} onLogout={handleLogout} />
    </AppLayout>
  );
}
