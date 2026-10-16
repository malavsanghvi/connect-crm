"use client";

// Proposes which recorded payments make up a deposit (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 5.6). The search is
// src/lib/bank-reconcile/deposit-sets.ts: a bounded subset-sum, oldest payments first, at most 3 sets. It only TICKS payments; the
// existing Match deposit action does the matching, and the database checks the total to the cent again. When more than one set fits
// nothing is ticked for the person: each set is shown and they choose.

import { useMemo } from "react";

import { buttonClass } from "@/components/ui";
import { depositSetsSentence, findDepositSets, type DepositPayment } from "@/lib/bank-reconcile/deposit-sets";
import { formatCents } from "@/lib/money";

export type PickerPayment = DepositPayment & { label: string };

export function DepositSetPicker({
  payments,
  targetCents,
  currency,
  locale,
  disabled,
  onPick,
}: {
  payments: readonly PickerPayment[];
  targetCents: number;
  currency: string;
  locale?: string;
  disabled?: boolean;
  onPick: (ids: string[]) => void;
}) {
  const result = useMemo(() => findDepositSets(payments, targetCents), [payments, targetCents]);
  if (payments.length === 0 || result.allFit) return null;
  const byId = new Map(payments.map((p) => [p.id, p]));
  const count = (n: number) => `${n} ${n === 1 ? "payment" : "payments"}`;
  const noteLeftOut = result.leftOut > 0 ? ` Only the oldest ${result.searched} of ${result.searched + result.leftOut} payments were searched.` : "";
  return (
    <div className="space-y-2 rounded-field border border-line bg-ground px-3 py-2 text-sm" data-testid="deposit-sets">
      <p className="m-0 font-semibold text-ink">
        {depositSetsSentence(result, count)}
        {noteLeftOut}
      </p>
      {result.sets.map((set, i) => {
        const total = set.reduce((s, id) => s + (byId.get(id)?.amountCents ?? 0), 0);
        return (
          <div key={set.join("-")} className="rounded-field border border-line bg-white px-3 py-2">
            <p className="m-0 font-semibold text-ink">
              {result.sets.length > 1 ? `Combination ${i + 1}: ` : ""}
              {count(set.length)}, {formatCents(total, currency, locale)}
            </p>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-muted">
              {set.map((id) => (
                <li key={id}>{byId.get(id)?.label ?? id}</li>
              ))}
            </ul>
            <button type="button" disabled={disabled} className={`${buttonClass("ghost", "sm")} mt-2 min-h-[40px]`} onClick={() => onPick(set)}>
              {result.sets.length > 1 ? `Tick combination ${i + 1}` : "Tick this set"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
