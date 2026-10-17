"use client";

import { useId, useState, useTransition } from "react";

import { logCareTouchAction } from "@/app/(app)/households/[id]/care-actions";
import { reopenThankAction, setAsideThankAction } from "@/app/(app)/care/thanks/actions";
import { buttonClass } from "@/components/ui";
import { waysFor } from "@/lib/care/thanks";

// The one-tap buttons of a thank-you step (DonorDelight slice 3): "Called", "Card sent" and the rest record a thank-you touch for the
// household (the Care card's own action; the step closes because that touch exists), and "No thanks needed" sets the step aside with a
// reason. Every failure is said next to the buttons, in words, and what was typed stays. A personal step offers only the ways that close it.

export function ThankActions({ stepId, householdId, needsPersonal }: { stepId: string; householdId: string; needsPersonal: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();

  function thank(channel: string) {
    setError(null);
    start(async () => {
      const r = await logCareTouchAction({ householdId, kind: "thank_you", channel, outcome: "done", isAsk: false });
      if (!r.ok) setError(r.error);
    });
  }
  function setAside() {
    setError(null);
    start(async () => {
      const r = await setAsideThankAction({ thankId: stepId, reason });
      if (!r.ok) setError(r.error);
      else {
        setAsking(false);
        setReason("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Record the thank-you">
        {waysFor(needsPersonal).map((w) => (
          <button key={w.key} type="button" disabled={pending} onClick={() => thank(w.channel)} className={buttonClass("ghost", "xs")}>
            {w.label}
          </button>
        ))}
        <button type="button" disabled={pending} onClick={() => setAsking((a) => !a)} aria-expanded={asking} className={buttonClass("plain", "xs")}>
          No thanks needed
        </button>
      </div>
      {asking ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label htmlFor={reasonId} className="crm-label">
              Why is no thank-you needed?
            </label>
            <input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="crm-input" placeholder="For example: a test gift" />
          </div>
          <button type="button" disabled={pending || reason.trim() === ""} onClick={setAside} className={buttonClass("primary", "xs")}>
            {pending ? "Saving…" : "Set aside"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Bring a set-aside step back. */
export function ReopenThank({ stepId }: { stepId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await reopenThankAction({ thankId: stepId });
            if (!r.ok) setError(r.error);
          });
        }}
        className={buttonClass("ghost", "xs")}
      >
        {pending ? "Reopening…" : "Reopen"}
      </button>
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
