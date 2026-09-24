"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";

import { buttonClass, type ButtonVariant } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormAction = (prev: ActionResult<any> | null, formData: FormData) => Promise<ActionResult<any>>;

/** Plain-English outcome of an action, next to the form that triggered it. */
export function ActionMessage({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p role="alert" className="mt-2 rounded-lg border border-maroon/30 bg-maroon-50 px-3 py-2 text-sm text-maroon">
        {state.error}
      </p>
    );
  }
  if (!state.message) return null;
  return (
    <p role="status" className="mt-2 rounded-lg border border-success/30 bg-success-50 px-3 py-2 text-sm text-success">
      {state.message}
    </p>
  );
}

/**
 * A form bound to a Server Action returning { ok, error }. Submits without
 * React's automatic form reset so a failed submission keeps what was typed,
 * and renders the error in plain English beside the form.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant = "primary",
  size = "md",
  confirmMessage,
  resetOnSuccess = false,
  className = "",
  buttonsClassName = "",
  extraButtons,
  hideSubmit = false,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  confirmMessage?: string;
  resetOnSuccess?: boolean;
  className?: string;
  buttonsClassName?: string;
  extraButtons?: ReactNode;
  hideSubmit?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const message = submitter?.dataset.confirm ?? confirmMessage;
    if (message && !window.confirm(message)) return;
    const fd = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => formAction(fd));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} aria-busy={pending}>
      {children}
      <div className={`flex flex-wrap items-center gap-2 ${buttonsClassName}`}>
        {hideSubmit ? null : (
          <button type="submit" disabled={pending} className={buttonClass(variant, size)}>
            {pending ? (pendingLabel ?? "Working…") : submitLabel}
          </button>
        )}
        {extraButtons}
      </div>
      <ActionMessage state={state} />
    </form>
  );
}
