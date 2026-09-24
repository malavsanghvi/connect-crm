"use client";

import { useActionState, type ReactNode } from "react";

import { ActionMessage } from "@/components/action-form";
import { StatusText, buttonClass, type ButtonVariant } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { emailStatusText } from "@/lib/platform-onboarding";

import type { DecisionResult } from "../onboarding-actions";

type Action = (prev: ActionResult<DecisionResult> | null, fd: FormData) => Promise<ActionResult<DecisionResult>>;

/**
 * A console form whose result may carry a freshly issued sandbox code: the
 * code is shown here ONCE (the database keeps only its hash), with what
 * happened to the email. Several submit buttons may set `decision`.
 */
export function CodeForm({ action, children, buttons }: { action: Action; children: ReactNode; buttons: { label: string; value?: string; variant: ButtonVariant }[] }) {
  const [state, formAction, pending] = useActionState(action, null);
  const code = state?.ok ? state.data?.code : undefined;
  const mail = state?.ok && state.data?.emailStatus ? emailStatusText(state.data.emailStatus) : null;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {children}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button key={b.label} type="submit" name="decision" value={b.value} disabled={pending} className={buttonClass(b.variant, "sm")}>
            {pending ? "Working…" : b.label}
          </button>
        ))}
      </div>
      <ActionMessage state={state} />
      {code ? (
        <div className="rounded-[10px] border border-line bg-canvas px-3 py-3" data-testid="issued-code">
          <p className="crm-label">Sandbox code (shown once)</p>
          <p className="select-all font-mono text-[20px] font-semibold tracking-[0.08em] text-ink" data-code={code}>
            {code}
          </p>
          <p className="mt-1 text-[12px] text-muted">Valid 14 days, for the contact&apos;s email only, one use. They redeem it at /start.</p>
        </div>
      ) : null}
      {mail ? (
        <p data-testid="email-status">
          <StatusText tone={mail.tone}>{mail.text}</StatusText>
        </p>
      ) : null}
    </form>
  );
}
