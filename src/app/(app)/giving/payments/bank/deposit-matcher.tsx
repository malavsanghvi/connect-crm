"use client";

import { useState, useTransition } from "react";

import { buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";

import { matchDepositAction } from "./actions";
import { useReportOutcome } from "./bank-results";

export type DepositCandidate = {
  payment_id: string;
  household_name: string | null;
  receipt_number: string | null;
  method: string;
  amount_cents: number;
  received_on: string;
  check_number: string | null;
  envelope_number: string | null;
};

/**
 * A check / cash deposit line is a batch: tick the recorded payments that
 * make it up. The total must equal the deposit exactly (the database checks too).
 */
export function DepositMatcher({
  txnId,
  amountCents,
  candidates,
  exactTotal,
  candidateError,
  currency,
  timeZone,
  canConfirm,
}: {
  txnId: string;
  amountCents: number;
  candidates: DepositCandidate[];
  exactTotal: boolean;
  candidateError: string | null;
  currency: string;
  timeZone: string;
  canConfirm: boolean;
}) {
  const report = useReportOutcome();
  const [selected, setSelected] = useState<string[]>(exactTotal ? candidates.map((c) => c.payment_id) : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const total = candidates.filter((c) => selected.includes(c.payment_id)).reduce((s, c) => s + c.amount_cents, 0);
  const diff = amountCents - total;

  if (candidateError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {candidateError}
      </p>
    );
  }
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted">
        No undeposited checks or cash recorded in the 3 weeks before this deposit. Record each check as an offline payment first
        (Giving → Payments), then match the deposit here.
      </p>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await matchDepositAction({ txnId, paymentIds: selected });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        report({
          id: txnId,
          title: `Deposit of ${formatCents(amountCents, currency)} matched to ${res.data?.count ?? selected.length} recorded payments`,
          lines: [res.message ?? ""],
        });
      } catch (err) {
        console.error("[bank] deposit match failed:", err);
        setError("Could not match the deposit — the server did not respond. Reload to see whether it went through.");
      }
    });
  }

  return (
    <div className="space-y-2">
      {exactTotal ? (
        <p className="text-sm text-success">These {candidates.length} undeposited payments add up exactly to the deposit — check and confirm.</p>
      ) : (
        <p className="text-sm text-muted">Tick the payments in this deposit.</p>
      )}
      <ul className="space-y-1 text-sm">
        {candidates.map((c) => (
          <li key={c.payment_id}>
            <label className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
              <input
                type="checkbox"
                disabled={!canConfirm}
                checked={selected.includes(c.payment_id)}
                onChange={() => setSelected((s) => (s.includes(c.payment_id) ? s.filter((x) => x !== c.payment_id) : [...s, c.payment_id]))}
                className="h-5 w-5"
              />
              <span className="w-24 text-right font-semibold tabular-nums">{formatCents(c.amount_cents, currency)}</span>
              <span>{c.household_name ?? "Household"}</span>
              <span className="text-muted">
                {PAYMENT_METHOD_LABEL[c.method] ?? c.method}
                {c.check_number ? ` #${c.check_number}` : ""}
                {c.envelope_number ? ` · envelope ${c.envelope_number}` : ""} · {formatDate(c.received_on, timeZone)} ·{" "}
                <span className="font-mono">{c.receipt_number ?? ""}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className={`text-sm font-semibold ${diff === 0 ? "text-success" : "text-brown"}`} aria-live="polite">
        Selected {formatCents(total, currency)} of {formatCents(amountCents, currency)} —{" "}
        {diff === 0 ? "matches exactly" : diff > 0 ? `${formatCents(diff, currency)} still missing` : `${formatCents(-diff, currency)} too much`}
      </p>
      {error ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {canConfirm ? (
        <button type="button" onClick={submit} disabled={pending || diff !== 0 || selected.length === 0} className={buttonClass("primary", "sm")}>
          {pending ? "Matching…" : "Match deposit"}
        </button>
      ) : null}
    </div>
  );
}
