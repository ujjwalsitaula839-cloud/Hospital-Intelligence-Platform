import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogEntry {
  getPanel: () => HTMLElement | null;
  onClose: () => void;
  opener: HTMLElement | null;
}

/** Global stack tracking open dialogs so only the topmost dialog handles Tab and Escape. */
const dialogStack: DialogEntry[] = [];

/**
 * Accessible modal behaviour for an existing dialog panel:
 * moves focus into the dialog when it opens, keeps Tab / Shift+Tab inside it,
 * closes it on Escape, and returns focus to the element that opened it.
 *
 * Supports nested dialogs: only the topmost open dialog handles keyboard events,
 * and closing a nested dialog restores focus within its parent dialog rather than
 * jumping behind it.
 *
 * Attach the returned ref to the panel and give the panel role="dialog",
 * aria-modal="true", aria-labelledby and tabIndex={-1}.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = ref.current;

    const entry: DialogEntry = {
      getPanel: () => ref.current,
      onClose: () => onCloseRef.current(),
      opener,
    };
    dialogStack.push(entry);

    const isTop = () => dialogStack[dialogStack.length - 1] === entry;

    const focusables = () => {
      const p = ref.current;
      return p ? Array.from(p.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden]')) : [];
    };

    const initial = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? panel;
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // Only the topmost open dialog handles keyboard events
      if (!isTop()) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const currentPanel = ref.current;
      if (!currentPanel) return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !currentPanel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !currentPanel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = dialogStack.indexOf(entry);
      if (index !== -1) {
        dialogStack.splice(index, 1);
      }

      const parentEntry = dialogStack[dialogStack.length - 1];
      if (parentEntry) {
        const parentPanel = parentEntry.getPanel();
        // If opener is inside the parent dialog and still in DOM, return focus to opener.
        if (opener && parentPanel && parentPanel.contains(opener) && document.contains(opener)) {
          opener.focus();
        } else if (parentPanel && document.contains(parentPanel)) {
          // Do not jump to the page behind the still-open parent dialog.
          const parentFocusables = Array.from(parentPanel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => !el.closest('[hidden]')
          );
          const parentInitial =
            parentPanel.querySelector<HTMLElement>('[data-autofocus]') ?? parentFocusables[0] ?? parentPanel;
          parentInitial?.focus();
        }
      } else if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [open]);

  return ref;
}
