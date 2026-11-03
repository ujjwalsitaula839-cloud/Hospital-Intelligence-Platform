import React, { useState, useRef, useEffect } from 'react';
import { Bell, CheckCheck, Trash2, X } from 'lucide-react';

export interface AppNotification {
  id: string;
  eventType: string;
  title: string;
  message: string;
  actor?: string;
  bedCode?: string;
  status?: string;
  time: string;
  read?: boolean;
}

interface NotificationBellProps {
  notifications: AppNotification[];
  onMarkAllAsRead?: () => void;
  onClearAll?: () => void;
  onDismissNotification?: (id: string) => void;
  onSelectNotification?: (notification: AppNotification) => void;
  className?: string;
}

function getEventBadgeStyle(eventType: string, status?: string): string {
  const code = (status || eventType || '').toUpperCase();
  switch (code) {
    case 'AVAILABLE':
    case 'BED_AVAILABLE':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-700/80';
    case 'RESERVED':
    case 'BED_RESERVED':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/90 dark:text-amber-300 dark:border-amber-700/80';
    case 'OCCUPIED':
    case 'BED_OCCUPIED':
      return 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/90 dark:text-sky-300 dark:border-sky-700/80';
    case 'DIRTY':
    case 'BED_DIRTY':
      return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-red-950/90 dark:text-red-300 dark:border-red-700/80';
    case 'HOLD_CANCELLED':
      return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800/80';
    case 'AMBULANCE_APPROACHING':
      return 'bg-amber-100 text-amber-950 border-amber-400 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-600 font-bold';
    case 'AMBULANCE_OVERDUE':
      return 'bg-red-100 text-red-950 border-red-400 dark:bg-red-950 dark:text-red-200 dark:border-red-600 font-bold';
    case 'BED_TRANSFER':
      return 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-800/80';
    default:
      return 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
  }
}

export default function NotificationBell({
  notifications,
  onMarkAllAsRead,
  onClearAll,
  onDismissNotification,
  onSelectNotification,
  className = '',
}: NotificationBellProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const hasUnread = unreadCount > 0;
  const badgeLabel = unreadCount > 9 ? '9+' : `${unreadCount}`;
  const buttonLabel = hasUnread ? `Notifications (${unreadCount} unread)` : 'Notifications';

  // Toggle dropdown
  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  // Close on click outside or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleMarkAll = () => {
    if (onMarkAllAsRead) {
      onMarkAllAsRead();
    }
  };

  const handleClear = () => {
    if (onClearAll) {
      onClearAll();
    }
  };

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      {/* Facebook-style Bell Button */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label={buttonLabel}
        title={buttonLabel}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={`relative inline-flex items-center justify-center p-2 rounded-xs border text-xs font-mono tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
          isOpen
            ? 'bg-zinc-800 border-zinc-600 text-white dark:bg-zinc-800 dark:border-zinc-500'
            : 'bg-white border-slate-300 text-slate-700 hover:text-slate-900 hover:border-slate-400 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-white dark:hover:border-zinc-500 shadow-xs'
        }`}
      >
        <Bell className="w-4 h-4" aria-hidden="true" />

        {/* Facebook-style Red Badge Counter */}
        {hasUnread && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-xs">
              {badgeLabel}
            </span>
          </span>
        )}
      </button>

      {/* Pop-up Menu Dropdown */}
      {isOpen && (
        <div
          role="region"
          aria-label="Notification center"
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 z-50 bg-white dark:bg-zinc-900/98 border border-slate-200 dark:border-zinc-700/90 shadow-2xl rounded-2xl overflow-hidden backdrop-blur-md transition-all animate-fadeIn"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/90">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm text-slate-900 dark:text-white">
                Notifications
              </span>
              {hasUnread ? (
                <span className="px-2 py-0.5 text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80 rounded-full">
                  {unreadCount} unread
                </span>
              ) : (
                <span className="px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400 rounded-full">
                  {notifications.length}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-1">
              {hasUnread && onMarkAllAsRead && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  className="inline-flex items-center space-x-1 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-zinc-800 rounded transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5 mr-1" />
                  <span>Mark all as read</span>
                </button>
              )}
              {notifications.length > 0 && onClearAll && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="inline-flex items-center space-x-1 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                  title="Clear all notifications"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  <span>Clear all</span>
                </button>
              )}
            </div>
          </div>

          {/* Notifications Scrollable List */}
          <div className="max-h-80 sm:max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/70">
            {notifications.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center justify-center space-y-2">
                <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-zinc-800/80 flex items-center justify-center text-slate-400 dark:text-zinc-500">
                  <Bell className="w-5 h-5" />
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  All caught up!
                </p>
                <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-[200px]">
                  No notifications right now. New clinical events will show up here.
                </p>
              </div>
            ) : (
              notifications.map((item) => {
                const isUnread = !item.read;
                const badgeStyle = getEventBadgeStyle(item.eventType, item.status);

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (onSelectNotification) onSelectNotification(item);
                    }}
                    className={`p-3.5 transition-colors relative flex items-start space-x-3 cursor-pointer ${
                      isUnread
                        ? 'bg-sky-50/70 dark:bg-sky-950/20 hover:bg-sky-100/60 dark:hover:bg-sky-950/40'
                        : 'bg-white dark:bg-zinc-900/60 hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    {/* Unread Indicator Dot */}
                    <div className="pt-1 shrink-0">
                      {isUnread ? (
                        <span className="block h-2 w-2 rounded-full bg-sky-500 shadow-xs" title="Unread" />
                      ) : (
                        <span className="block h-2 w-2 rounded-full bg-transparent" />
                      )}
                    </div>

                    {/* Notification Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                          <span
                            className={`text-[10px] font-mono uppercase font-bold tracking-wider px-1.5 py-0.5 border rounded ${badgeStyle}`}
                          >
                            {item.status || item.eventType}
                          </span>
                          {item.bedCode && (
                            <span className="font-mono text-[11px] font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-zinc-950 px-1.5 py-0.5 border border-slate-300 dark:border-zinc-800 rounded">
                              {item.bedCode}
                            </span>
                          )}
                        </div>

                        {onDismissNotification && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDismissNotification(item.id);
                            }}
                            aria-label="Dismiss notification"
                            className="text-slate-400 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-200 text-xs px-1 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                        {item.title}
                      </p>

                      <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed break-words">
                        {item.message}
                      </p>

                      <div className="pt-1 flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-zinc-400">
                        {item.actor && (
                          <span>
                            By: <span className="text-slate-700 dark:text-zinc-200 font-semibold">{item.actor}</span>
                          </span>
                        )}
                        <span className="ml-auto">{item.time}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/60 flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400">
            <span className="flex items-center space-x-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Real-time Clinical Broadcasts</span>
            </span>
            <span>{notifications.length} logged</span>
          </div>
        </div>
      )}
    </div>
  );
}

