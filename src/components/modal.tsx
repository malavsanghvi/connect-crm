"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { buttonClass } from "@/components/ui";
import { normalizeStepUpCode } from "@/lib/confirm";

export type ModalTone = "primary" | "ok" | "warn" | "bad";

const confirmClass: Record<ModalTone, string> = {
  primary: buttonClass("primary"),
  ok: buttonClass("ok"),
  warn: buttonClass("warn"),
  bad: buttonClass("bad-solid"),
};

/**
 * Confirmation / step-up modal, as in the prototype: kicker, Fraunces title,
 * body, optional 6-digit code field, "Cancel" and a coloured confirm button.
 *
 * The code field only COLLECTS a code. Whatever handles `onConfirm(code)` must
 * verify it on the server — the modal never claims a check it did not make.
 */
export function Modal({
  open,
  kicker,
  title,
  children,
  confirmLabel,
  tone = "primary",
  codeLabel,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  kicker?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  tone?: ModalTone;
  /** When set, shows the 6-digit code field with this accessible label (e.g. "Verification code"). */
  codeLabel?: string;
  pending?: boolean;
  /** A failure to show inside the modal (e.g. "That code is wrong"). */
  error?: ReactNode;
  onConfirm: (code: string | null) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const codeId = useId();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    (codeLabel ? codeRef.current : cancelRef.current)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, codeLabel]);

  if (!open) return null;

  function reset() {
    setCode("");
    setCodeError(null);
  }
  function cancel() {
    reset();
    onCancel();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && !pending) {
      e.stopPropagation();
      cancel();
      return;
    }
    if (e.key !== "Tab" || !cardRef.current) return;
    // Keep focus inside the modal.
    const focusable = cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    // Rendered in a portal, but React still bubbles events to the component
    // tree: never let this submit reach a surrounding form (e.g. ActionForm).
    e.stopPropagation();
    if (pending) return;
    if (codeLabel) {
      const normalized = normalizeStepUpCode(code);
      if (!normalized) {
        setCodeError("Enter the 6-digit code (numbers only).");
        codeRef.current?.focus();
        return;
      }
      reset();
      onConfirm(normalized);
      return;
    }
    onConfirm(null);
  }

  return createPortal(
    <div
      className="cc-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) cancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        className="cc-modal"
        onKeyDown={onKeyDown}
      >
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          {kicker ? <p className="cc-kicker">{kicker}</p> : null}
          <h2 id={titleId} className="cc-modal-title">
            {title}
          </h2>
          {children ? (
            <div id={bodyId} className="cc-modal-body">
              {children}
            </div>
          ) : null}
          {codeLabel ? (
            <div>
              <label htmlFor={codeId} className="sr-only">
                {codeLabel}
              </label>
              <input
                ref={codeRef}
                id={codeId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={9}
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={codeError ? true : undefined}
                className="cc-code-input"
              />
              {codeError ? (
                <p role="alert" className="mt-1.5 text-sm font-semibold text-danger">
                  {codeError}
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1.5">
            <button ref={cancelRef} type="button" onClick={cancel} disabled={pending} className={buttonClass("ghost", "modal")}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={`${confirmClass[tone]} min-h-[42px]`}>
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
