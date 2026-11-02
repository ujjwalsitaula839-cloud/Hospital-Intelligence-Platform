import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export default function ThemeToggle({
  className = '',
  showLabel = false,
}: ThemeToggleProps): React.ReactElement {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={`relative inline-flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-xs border text-xs font-mono tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 focus-visible:ring-sky-400 focus-visible:ring-offset-zinc-950'
          : 'bg-white border-slate-300 text-slate-700 hover:text-slate-900 hover:border-slate-400 focus-visible:ring-blue-600 focus-visible:ring-offset-white shadow-xs'
      } ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400 transition-transform hover:rotate-45" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4 text-slate-600 transition-transform hover:-rotate-12" aria-hidden="true" />
      )}
      {showLabel && (
        <span className="text-[11px] font-medium uppercase">
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </button>
  );
}

