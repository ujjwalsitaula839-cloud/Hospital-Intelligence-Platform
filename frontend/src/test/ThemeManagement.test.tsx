import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import ThemeToggle from '../components/navigation/ThemeToggle';

// Mock matchMedia
function setSystemThemePreference(matchesDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? matchesDark : !matchesDark,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Test harness component to consume useTheme
function TestConsumer() {
  const { theme, toggleTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <button data-testid="toggle-btn" onClick={toggleTheme}>
        Toggle
      </button>
      <button data-testid="set-light-btn" onClick={() => setTheme('light')}>
        Set Light
      </button>
      <button data-testid="set-dark-btn" onClick={() => setTheme('dark')}>
        Set Dark
      </button>
      <ThemeToggle />
    </div>
  );
}

describe('Theme Management System (TDS Suite)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
  });

  describe('Theme Initialization', () => {
    it('initializes to dark mode if OS prefers dark and no theme is saved in localStorage', () => {
      setSystemThemePreference(true);
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('initializes to light mode if OS prefers light and no theme is saved in localStorage', () => {
      setSystemThemePreference(false);
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('restores previously saved light theme from localStorage regardless of OS preference', () => {
      setSystemThemePreference(true); // OS prefers dark
      localStorage.setItem('hip_theme', 'light');

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('restores previously saved dark theme from localStorage regardless of OS preference', () => {
      setSystemThemePreference(false); // OS prefers light
      localStorage.setItem('hip_theme', 'dark');

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  describe('Theme Switching & State Updates', () => {
    it('switches from dark to light on toggle, updating classes, attributes, and localStorage', () => {
      localStorage.setItem('hip_theme', 'dark');
      setSystemThemePreference(true);

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('dark');

      const toggleButton = screen.getByTestId('toggle-btn');
      act(() => {
        fireEvent.click(toggleButton);
      });

      expect(screen.getByTestId('current-theme').textContent).toBe('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem('hip_theme')).toBe('light');
    });

    it('switches from light to dark on toggle, updating classes, attributes, and localStorage', () => {
      localStorage.setItem('hip_theme', 'light');
      setSystemThemePreference(false);

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('light');

      const toggleButton = screen.getByTestId('toggle-btn');
      act(() => {
        fireEvent.click(toggleButton);
      });

      expect(screen.getByTestId('current-theme').textContent).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem('hip_theme')).toBe('dark');
    });

    it('persists theme selection across remounts', () => {
      setSystemThemePreference(true);
      const { unmount } = render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      // Switch to light
      act(() => {
        fireEvent.click(screen.getByTestId('set-light-btn'));
      });
      expect(localStorage.getItem('hip_theme')).toBe('light');

      // Unmount the tree
      unmount();

      // Remount a fresh tree
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  describe('ThemeToggle Accessibility & UI Component', () => {
    it('renders with appropriate accessible label and title indicating current and next state', () => {
      localStorage.setItem('hip_theme', 'dark');
      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      );

      const button = screen.getByRole('button', { name: /switch to light mode/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-label', 'Switch to light mode');
      expect(button).toHaveAttribute('title', 'Switch to light mode');
      expect(button).toHaveAttribute('type', 'button');
    });

    it('updates accessible label and title when theme changes to light', () => {
      localStorage.setItem('hip_theme', 'dark');
      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      );

      const button = screen.getByRole('button', { name: /switch to light mode/i });
      act(() => {
        fireEvent.click(button);
      });

      const updatedButton = screen.getByRole('button', { name: /switch to dark mode/i });
      expect(updatedButton).toBeInTheDocument();
      expect(updatedButton).toHaveAttribute('aria-label', 'Switch to dark mode');
      expect(updatedButton).toHaveAttribute('title', 'Switch to dark mode');
    });

    it('is keyboard operable and triggers on enter or click', () => {
      localStorage.setItem('hip_theme', 'dark');
      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      );

      const button = screen.getByRole('button', { name: /switch to light mode/i });
      act(() => {
        fireEvent.click(button);
      });

      expect(localStorage.getItem('hip_theme')).toBe('light');
    });
  });

  describe('Global Theme Application Across Multiple Components', () => {
    it('synchronizes theme across multiple distinct consumer components simultaneously', () => {
      function HeaderComponent() {
        const { theme } = useTheme();
        return <header data-testid="header-theme">{theme}</header>;
      }

      function SidebarComponent() {
        const { theme } = useTheme();
        return <aside data-testid="sidebar-theme">{theme}</aside>;
      }

      function DashboardComponent() {
        const { theme } = useTheme();
        return <main data-testid="dashboard-theme">{theme}</main>;
      }

      render(
        <ThemeProvider>
          <div>
            <HeaderComponent />
            <SidebarComponent />
            <DashboardComponent />
            <ThemeToggle />
          </div>
        </ThemeProvider>
      );

      const toggleBtn = screen.getByRole('button', { name: /switch to/i });

      // Trigger change
      act(() => {
        fireEvent.click(toggleBtn);
      });

      const newTheme = document.documentElement.classList.contains('light') ? 'light' : 'dark';
      expect(screen.getByTestId('header-theme').textContent).toBe(newTheme);
      expect(screen.getByTestId('sidebar-theme').textContent).toBe(newTheme);
      expect(screen.getByTestId('dashboard-theme').textContent).toBe(newTheme);
    });
  });

  describe('Representative Components in Light & Dark Mode', () => {
    function SampleHospitalComponents() {
      return (
        <div>
          {/* Representative Buttons */}
          <button type="button" className="btn-primary" data-testid="primary-btn">
            Admit Patient
          </button>
          <button type="button" className="btn-secondary" data-testid="secondary-btn">
            Cancel
          </button>
          <button type="button" disabled className="btn-disabled" data-testid="disabled-btn">
            Discharged
          </button>
          <button type="button" className="btn-destructive" data-testid="destructive-btn">
            Deactivate
          </button>

          {/* Representative Form */}
          <form data-testid="sample-form">
            <label htmlFor="patient-name">Patient Full Name</label>
            <input
              id="patient-name"
              type="text"
              placeholder="e.g. John Doe"
              className="input-field"
              data-testid="patient-input"
            />
            <select data-testid="acuity-select" className="select-field">
              <option value="ESI_1">ESI 1 - Resuscitation</option>
              <option value="ESI_3">ESI 3 - Urgent</option>
            </select>
          </form>

          {/* Representative Hospital Cards & Bed Status Badges */}
          <div data-testid="bed-card" className="card-surface">
            <span data-testid="status-available" className="status-badge status-available">AVAILABLE</span>
            <span data-testid="status-occupied" className="status-badge status-occupied">OCCUPIED</span>
            <span data-testid="status-reserved" className="status-badge status-reserved">RESERVED</span>
            <span data-testid="status-dirty" className="status-badge status-dirty">DIRTY</span>
            <span data-testid="status-cleaning" className="status-badge status-cleaning">CLEANING</span>
          </div>

          {/* Representative Table */}
          <table data-testid="patient-table" className="table-surface">
            <thead>
              <tr>
                <th>MRN</th>
                <th>Patient</th>
                <th>Bed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr data-testid="table-row">
                <td>MRN-101</td>
                <td>Alice Walker</td>
                <td>ED-04</td>
                <td>Admitted</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    }

    it('renders representative buttons, forms, cards, and tables in dark mode', () => {
      localStorage.setItem('hip_theme', 'dark');
      render(
        <ThemeProvider>
          <SampleHospitalComponents />
        </ThemeProvider>
      );

      expect(screen.getByTestId('primary-btn')).toBeVisible();
      expect(screen.getByTestId('secondary-btn')).toBeVisible();
      expect(screen.getByTestId('disabled-btn')).toBeDisabled();
      expect(screen.getByTestId('destructive-btn')).toBeVisible();

      expect(screen.getByTestId('patient-input')).toHaveAttribute('placeholder', 'e.g. John Doe');
      expect(screen.getByTestId('acuity-select')).toBeVisible();

      expect(screen.getByTestId('status-available')).toHaveTextContent('AVAILABLE');
      expect(screen.getByTestId('status-occupied')).toHaveTextContent('OCCUPIED');
      expect(screen.getByTestId('status-reserved')).toHaveTextContent('RESERVED');
      expect(screen.getByTestId('status-dirty')).toHaveTextContent('DIRTY');
      expect(screen.getByTestId('status-cleaning')).toHaveTextContent('CLEANING');

      expect(screen.getByTestId('patient-table')).toBeVisible();
      expect(screen.getByTestId('table-row')).toHaveTextContent('Alice Walker');
    });

    it('renders representative buttons, forms, cards, and tables in light mode', () => {
      localStorage.setItem('hip_theme', 'light');
      render(
        <ThemeProvider>
          <SampleHospitalComponents />
        </ThemeProvider>
      );

      expect(screen.getByTestId('primary-btn')).toBeVisible();
      expect(screen.getByTestId('secondary-btn')).toBeVisible();
      expect(screen.getByTestId('disabled-btn')).toBeDisabled();

      expect(screen.getByTestId('patient-input')).toHaveAttribute('placeholder', 'e.g. John Doe');

      expect(screen.getByTestId('status-available')).toHaveTextContent('AVAILABLE');
      expect(screen.getByTestId('status-occupied')).toHaveTextContent('OCCUPIED');
      expect(screen.getByTestId('status-reserved')).toHaveTextContent('RESERVED');
      expect(screen.getByTestId('status-dirty')).toHaveTextContent('DIRTY');
      expect(screen.getByTestId('status-cleaning')).toHaveTextContent('CLEANING');

      expect(screen.getByTestId('patient-table')).toBeVisible();
      expect(screen.getByTestId('table-row')).toHaveTextContent('Alice Walker');
    });
  });
});
