"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Modal, type ModalTone } from "@/components/modal";
import { useToast } from "@/components/toast";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { splitConfirmMessage } from "@/lib/confirm";
import type { ActionResult } from "@/lib/errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormAction = (prev: ActionResult<any> | null, formData: FormData) => Promise<ActionResult<any>>;

/**
 * Plain-English outcome of an action, next to the form that triggered it.
 * Errors always render here (they stay on screen until the next attempt).
 * Success renders here only when `showSuccess` is set — inside the portal
 * shell, success goes to the toast instead.
 */
export function ActionMessage({ state, showSuccess = true }: { state: ActionResult<unknown> | null; showSuccess?: boolean }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p role="alert" className="mt-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
        {state.error}
      </p>
    );
  }
  if (!state.message || !showSuccess) return null;
  return (
    <p role="status" className="mt-2 rounded-[10px] border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900">
      {state.message}
    </p>
  );
}

function toneFor(variant: ButtonVariant): ModalTone {
  if (variant === "bad" || variant === "danger" || variant === "bad-solid") return "bad";
  if (variant === "ok" || variant === "success") return "ok";
  if (variant === "warn") return "warn";
  return "primary";
}

type PendingConfirm = { title: string; body: string | null; confirmLabel: string; tone: ModalTone; fd: FormData };

/**
 * A form bound to a Server Action returning { ok, error }. Submits without
 * React's automatic form reset so a failed submission keeps what was typed.
 *
 * - `confirmMessage` (or `data-confirm` on a submit button) asks first in the
 *   prototype's confirmation modal; the question becomes its title.
 * - Success messages show as a green toast (inline when no toast is available).
 * - Errors always show in plain English beside the form, and also as a red toast.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant = "primary",
  size = "md",
  confirmMessage,
  confirmKicker = "Please confirm",
  resetOnSuccess = false,
  className = "",
  buttonsClassName = "",
  extraButtons,
  hideSubmit = false,
  submitDisabled = false,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  confirmMessage?: string;
  confirmKicker?: string;
  resetOnSuccess?: boolean;
  className?: string;
  buttonsClassName?: string;
  extraButtons?: ReactNode;
  hideSubmit?: boolean;
  /** Disable the submit button (e.g. "No changes" on a settings form). */
  submitDisabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      if (state.message) toast?.show(state.message, "ok");
    } else {
      toast?.show(state.error, "bad");
    }
  }, [state, resetOnSuccess, toast]);

  function run(fd: FormData) {
    startTransition(() => formAction(fd));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter ?? undefined);
    const message = submitter?.dataset.confirm ?? confirmMessage;
    if (!message) {
      run(fd);
      return;
    }
    const { title, body } = splitConfirmMessage(message);
    const label = (submitter?.textContent ?? "").trim() || submitLabel;
    const submitterVariant = (submitter?.dataset.variant as ButtonVariant | undefined) ?? variant;
    setConfirm({ title, body, confirmLabel: label, tone: toneFor(submitterVariant), fd });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} aria-busy={pending}>
      {children}
      <div className={`flex flex-wrap items-center gap-2 ${buttonsClassName}`}>
        {hideSubmit ? null : (
          <button type="submit" disabled={pending || submitDisabled} data-variant={variant} className={buttonClass(submitDisabled ? "off" : variant, size)}>
            {pending ? (pendingLabel ?? "Working…") : submitLabel}
          </button>
        )}
        {extraButtons}
      </div>
      <ActionMessage state={state} showSuccess={!toast} />
      <Modal
        open={confirm !== null}
        kicker={confirmKicker}
        title={confirm?.title ?? ""}
        confirmLabel={confirm?.confirmLabel ?? submitLabel}
        tone={confirm?.tone ?? "primary"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const fd = confirm?.fd;
          setConfirm(null);
          if (fd) run(fd);
        }}
      >
        {confirm?.body ?? undefined}
      </Modal>
    </form>
  );
}
