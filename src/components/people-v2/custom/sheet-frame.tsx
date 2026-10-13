"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The frame of the two small sheets of custom fields (Add a field, Manage): a dialog in the middle of a desktop screen and a sheet from
// the bottom of a phone, over a dimmed page. Esc closes it (the slide-over behind it leaves that key to a dialog above it), Tab stays
// inside it, focus goes to the first field when it opens and back to what opened it when it closes.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SheetFrame({ title, onClose, testId, children }: { title: string; onClose: () => void; testId: string; children: ReactNode }) {
  const uid = useId();
  const titleId = `${uid}-t`;
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const closeNow = useRef(onClose);
  useEffect(() => {
    closeNow.current = onClose;
  });

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>("input:not([type=radio]), select, textarea, button");
    first?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        closeNow.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus({ preventScroll: true });
    };
    // Opened once: running again would steal focus from what is being typed.
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[48] flex items-end justify-center overflow-y-auto bg-[rgba(18,32,58,0.5)] sm:items-center sm:p-3"
      data-testid={testId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[94dvh] w-full max-w-[31rem] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_20px_60px_rgba(18,32,58,0.35)] sm:rounded-2xl sm:pb-5"
      >
        <h2 id={titleId} className="m-0 font-display text-[21px] font-semibold leading-tight text-ink" dir="auto">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
