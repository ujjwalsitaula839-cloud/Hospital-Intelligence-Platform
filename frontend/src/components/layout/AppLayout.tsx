import React, { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUnifiedWebSocket } from '../../hooks/useUnifiedWebSocket';
import '../../dashboard/exec.css';
import '../../dashboard/showcase.css';

interface AppLayoutProps {
  children: React.ReactNode;
  activeNav?: 'clinical' | 'housekeeping' | 'admin';
  hideHeader?: boolean;
}

interface NavTabItem {
  id: 'clinical' | 'housekeeping' | 'admin';
  label: string;
  icon: 'map' | 'list' | 'layers';
  path: string;
}

function NavIcon({ name }: { name: 'map' | 'list' | 'layers' }) {
  const common: React.SVGProps<SVGSVGElement> = {
    className: 'ab-ico',
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (name === 'map') {
    return (
      <svg {...common}>
        <path d="M2.5 5.2 7 3.2l6 2.3 4.5-2v11.3l-4.5 2-6-2.3-4.5 2V5.2Z" />
        <path d="M7 3.2v11.3M13 5.5v11.3" />
      </svg>
    );
  }
  if (name === 'list') {
    return (
      <svg {...common}>
        <path d="M7 5h10M7 10h10M7 15h10" />
        <circle cx="3.5" cy="5" r=".6" />
        <circle cx="3.5" cy="10" r=".6" />
        <circle cx="3.5" cy="15" r=".6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M10 2.5 2.5 6 10 9.5 17.5 6 10 2.5Z" />
      <path d="M2.5 10 10 13.5 17.5 10M2.5 14 10 17.5 17.5 14" />
    </svg>
  );
}

export default function AppLayout({ children, activeNav, hideHeader = false }: AppLayoutProps): React.ReactElement {
  const { claims, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Mount unified WebSocket listener across all views
  useUnifiedWebSocket();

  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  };

  const currentTab = activeNav || (
    location.pathname.startsWith('/dashboard/admin') ? 'admin' :
      location.pathname.startsWith('/dashboard/housekeeping') ? 'housekeeping' : 'clinical'
  );

  const isAdmin = claims?.role === 'ADMIN';

  const navTabs: NavTabItem[] = [
    { id: 'clinical', label: 'Command Center', icon: 'map', path: '/command-center' },
    { id: 'housekeeping', label: 'EVS Housekeeping', icon: 'list', path: '/dashboard/housekeeping' },
    ...(isAdmin ? [{ id: 'admin' as const, label: 'Staff & Audit', icon: 'layers' as const, path: '/dashboard/admin' }] : []),
  ];

  const listRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    function measure() {
      const node = list?.querySelector(`[data-tab="${currentTab}"]`) as HTMLElement | null;
      if (!node) return;
      setThumb({ left: node.offsetLeft, width: node.offsetWidth });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    document.fonts?.ready?.then(measure);
    return () => observer.disconnect();
  }, [currentTab]);

  return (
    <div className="w-full min-h-screen flex flex-col bg-[#eef3f9] text-slate-800 font-sans antialiased">
      {!hideHeader && (
        <header className="appbar sticky top-0 z-50 flex-none">
          <div className="ab-glow" aria-hidden="true" />

          {/* Left: Brand Lockup */}
          <Link to="/command-center" className="ab-brand" style={{ textDecoration: 'none' }}>
            <span className="ab-mark" aria-hidden="true">
              <img src="/logo_tight.png" alt="HIP" />
            </span>
            <div>
              <strong>HIP</strong>
              <small>Hospital Intelligence Platform</small>
            </div>
          </Link>

          {/* Center: Frosted Pill Navigation */}
          <nav className="ab-nav" aria-label="Views">
            <div className="ab-list" ref={listRef} role="tablist">
              {thumb && (
                <span
                  className="ab-thumb"
                  style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
                  aria-hidden="true"
                />
              )}
              {navTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  data-tab={tab.id}
                  aria-selected={currentTab === tab.id}
                  className={currentTab === tab.id ? 'ab-item is-on' : 'ab-item'}
                  onClick={() => navigate(tab.path)}
                >
                  <NavIcon name={tab.icon} />
                  <span className="ab-label">{tab.label}</span>
                </button>
              ))}
            </div>
          </nav>

          {/* Right: Tools, Clock & User */}
          <div className="ab-tools">
            <div className="ab-clock">
              <strong>{clock}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
              <Link
                to="/dashboard/housekeeping"
                title="Go to EVS Housekeeping Dashboard"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  fontFamily: 'JetBrains Mono, monospace',
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: '#fcd34d',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                }}
              >
                🧹 EVS
              </Link>
              {isAdmin && (
                <Link
                  to="/dashboard/admin"
                  title="Go to Administrator Dashboard"
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    fontFamily: 'JetBrains Mono, monospace',
                    background: 'rgba(168, 85, 247, 0.15)',
                    color: '#d8b4fe',
                    border: '1px solid rgba(168, 85, 247, 0.35)',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                  }}
                >
                  ⚙️ Admin
                </Link>
              )}
            </div>

            {claims && (
              <div
                className="ab-user-pill"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginLeft: '10px',
                  paddingLeft: '10px',
                  borderLeft: '1px solid rgba(255, 255, 255, 0.14)',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    fontFamily: 'JetBrains Mono, monospace',
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: '#93c5fd',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    padding: '2px 7px',
                    borderRadius: '4px',
                  }}
                >
                  {claims.role}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#f1f5f9',
                    fontWeight: 500,
                    maxWidth: '130px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {claims.full_name || claims.username}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign out of station"
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#fca5a5',
                    padding: '4px 9px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontFamily: 'JetBrains Mono, monospace',
                    transition: 'all 0.2s',
                  }}
                >
                  Log Out
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      {/* Main View Body */}
      <main className="flex-1 w-full flex flex-col pb-24">
        {children}
      </main>
    </div>
  );
}
