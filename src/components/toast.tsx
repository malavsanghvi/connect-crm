"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "ok" | "bad";
type ToastState = { id: number; message: string; tone: ToastTone } | null;
export type ToastApi = { show: (message: string, tone?: ToastTone) => void };

/** How long a toast stays up (the prototype's flash() uses 2.8s). Errors stay a little longer. */
export const TOAST_MS = 2800;
const TOAST_BAD_MS = 6000;

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Top-centre toast, as in the prototype: green for success, red for errors.
 * A toast never replaces an inline error — forms keep their error text on
 * screen (see ActionForm); the toast is an extra, short-lived confirmation.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((message: string, tone: ToastTone = "ok") => {
    if (!message) return;
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setToast({ id: seq.current, message, tone });
    timer.current = setTimeout(() => setToast(null), tone === "bad" ? TOAST_BAD_MS : TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="true">
        {toast ? (
          <div
            key={toast.id}
            role={toast.tone === "bad" ? "alert" : "status"}
            data-tone={toast.tone}
            className="cc-toast"
            onClick={() => setToast(null)}
          >
            {toast.message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

/** The toast API, or null outside a ToastProvider (callers then fall back to inline text). */
export function useToast(): ToastApi | null {
  return useContext(ToastContext);
}
