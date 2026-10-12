"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The slide-over's frame. On a desktop it is a 520 px panel from the right with the page dimmed behind it (a click on the page, or
// Esc, closes it); on a phone it is a full-screen sheet with a back arrow. It does not trap focus (the page behind stays usable by
// keyboard, like the other drawers), moves focus into itself when it opens and gives it back to what opened it when it closes.
// Esc closes it unless something inside already used the key (an editor cancelling, a menu closing, a dialog above it).

const noSubscribe = () => () => {};

export function SlideOverFrame({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  // The latest onClose, without making the effect below run again (it would pull focus back into the panel while someone types).
  const closeNow = useRef(onClose);
  useEffect(() => {
    closeNow.current = onClose;
  });

  useEffect(() => {
    opener.current = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog above the panel (the "Mark as deceased" sheet, a confirmation) closes itself first.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      closeNow.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus({ preventScroll: true });
    };
  }, []);

  // The panel is opened by the address (?person=…), so it renders on the server too, where there is no document.body to portal into;
  // it appears once the page hydrates.
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!onClient) return null;

  return createPortal(
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[39] bg-[rgba(18,32,58,0.38)]" data-testid="slideover-scrim" />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        tabIndex={-1}
        data-testid="person-slideover"
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-white shadow-[-12px_0_40px_rgba(18,32,58,0.22)] outline-none md:w-[520px] md:max-w-[92vw]"
      >
        {children}
      </aside>
    </>,
    document.body,
  );
}
