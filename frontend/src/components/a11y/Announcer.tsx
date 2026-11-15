import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type Politeness = 'polite' | 'assertive';
export type AnnounceFn = (message: string, politeness?: Politeness) => void;

const AnnouncerContext = createContext<AnnounceFn | null>(null);

/**
 * One shared pair of screen-reader live regions for the whole app.
 * Polite messages (successes, new notifications) wait for the screen reader to finish;
 * assertive messages (errors) interrupt.
 */
export function AnnouncerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const timers = useRef<number[]>([]);

  const announce = useCallback<AnnounceFn>((message, politeness = 'polite') => {
    const set = politeness === 'assertive' ? setAssertive : setPolite;
    // Clear first so the same message is announced again if it repeats.
    set('');
    timers.current.push(window.setTimeout(() => set(message), 50));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer-polite">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="announcer-assertive">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

const noop: AnnounceFn = () => {};

// eslint-disable-next-line react-refresh/only-export-components
export function useAnnounce(): AnnounceFn {
  return useContext(AnnouncerContext) ?? noop;
}
