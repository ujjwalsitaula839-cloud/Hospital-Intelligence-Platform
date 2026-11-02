import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_STORAGE_KEY = 'hip_theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';

  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Ignore localStorage errors
  }

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  return 'dark';
}

function applyThemeToDocument(theme: Theme, enableTransition = false) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (enableTransition) {
    root.classList.add('theme-transition');
  }

  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
    root.setAttribute('data-theme', 'dark');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.setAttribute('data-theme', 'light');
  }

  if (enableTransition) {
    window.setTimeout(() => {
      root.classList.remove('theme-transition');
    }, 300);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // Sync initial theme on mount
  useEffect(() => {
    applyThemeToDocument(theme, false);
  }, [theme]);

  // Listen to system preference changes if user hasn't explicitly set a preference
  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (!saved) {
          const newTheme: Theme = e.matches ? 'dark' : 'light';
          setThemeState(newTheme);
          applyThemeToDocument(newTheme, true);
        }
      } catch {
        // Ignore
      }
    };

    mediaQuery.addEventListener?.('change', handleChange);
    return () => {
      mediaQuery.removeEventListener?.('change', handleChange);
    };
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // Ignore
    }
    applyThemeToDocument(newTheme, true);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch {
        // Ignore
      }
      applyThemeToDocument(nextTheme, true);
      return nextTheme;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    // Safe fallback when components are rendered in isolation without ThemeProvider (e.g. unit tests)
    const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('light');
    const fallbackTheme: Theme = isLight ? 'light' : 'dark';
    return {
      theme: fallbackTheme,
      toggleTheme: () => {
        const next: Theme = fallbackTheme === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Ignore
        }
        applyThemeToDocument(next, true);
      },
      setTheme: (newTheme: Theme) => {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, newTheme);
        } catch {
          // Ignore
        }
        applyThemeToDocument(newTheme, true);
      },
    };
  }
  return context;
}
