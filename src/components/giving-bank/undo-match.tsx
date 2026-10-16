"use client";

// Undo a bank match (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md I8, scenario C21): giving.manage, a typed reason, and the database
// puts the payment back to "not on the bank" and the line back to Gifts to match. It refuses a line that created its own payment,
// a deposit of several payments, a month that is locked, and a deposit QuickBooks already has, and says so in plain words.

import { useState } from "react";

import { unreconcileBankLineAction } from "@/app/(app)/giving/payments/bank/reconcile-actions";
import { useReportOutcome } from "@/app/(app)/giving/payments/bank/bank-results";
import { GivingSheet } from "@/components/giving-actions/sheet";
import { SMALL, useRun } from "@/components/giving-actions/row-actions";
import type { CardLabels } from "@/components/household-card";
import { buttonClass } from "@/components/ui";

export function UndoMatchAct({ txnId, amount, labels, onDone }: { txnId: string; amount: string; labels: CardLabels; onDone?: (text: string) => void }) {
  const report = useReportOutcome();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, setError, run } = useRun();
  const ready = reason.trim().length >= 5;
  return (
    <>
      <button
        type="button"
        className={`${buttonClass("ghost", "sm")} ${SMALL}`}
        onClick={() => {
          setError(null);
          setReason("");
          setOpen(true);
        }}
      >
        Undo match…
      </button>
      {open ? (
        <GivingSheet
          title={`Undo the match of the ${amount} bank line?`}
          labels={labels}
          what="The bank line goes back to Gifts to match and the payment is no longer on the bank. No pledge changes. Say why; the reason is kept in the audit log."
          error={error}
          confirmLabel={`Undo the ${amount} match`}
          pendingLabel="Undoing…"
          pending={pending}
          confirmDisabled={!ready}
          tone="danger"
          onClose={() => setOpen(false)}
          onConfirm={() =>
            run(
              "Undo the match",
              () => unreconcileBankLineAction({ txnId, reason: reason.trim() }),
              (r) => {
                setOpen(false);
                const text = `Done: ${r.message ?? `the ${amount} match is undone.`}`;
                if (onDone) onDone(text);
                else report({ id: txnId, title: `Match of ${amount} undone`, lines: [r.message ?? ""] });
              },
            )
          }
        >
          <label htmlFor={`undo-${txnId}`} className="mb-1 block text-[13px] font-bold text-ink">
            Why
          </label>
          <textarea
            id={`undo-${txnId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className="crm-input w-full"
            placeholder="For example: matched to the wrong check"
          />
          <p className="m-0 mt-1 text-[12.5px] text-muted">At least 5 characters.</p>
        </GivingSheet>
      ) : null}
    </>
  );
}
