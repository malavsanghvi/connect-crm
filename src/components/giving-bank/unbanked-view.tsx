// Giving › Bank › Unbanked: "Paid, not on the bank" (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 5.8, scenario C26; prototype
// Reconcile.dc.html, second tab). Payments from verified proofs, or recorded by hand, that no bank line has banked. The ones past the
// usual window for their method are flagged: this is the safety net behind "closed by soft credit with no bank reconciliation".
// Read only. The link /giving/payments/bank?view=unbanked opens here.

import Link from "next/link";

import type { CardLabels } from "@/components/household-card";
import { Badge } from "@/components/ui";
import { daysText, nextStep, sourceWord } from "@/lib/bank-reconcile/unbanked";
import type { UnbankedModel } from "@/lib/data/giving-reconcile";
import { formatDate } from "@/lib/dates";
import { familyLine, familyRef } from "@/lib/giving-today/queue";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";

export function UnbankedView({
  model,
  labels,
  currency,
  locale,
  timeZone,
}: {
  model: UnbankedModel;
  labels: CardLabels;
  currency: string;
  locale: string;
  timeZone: string;
}) {
  if (model.state === "no_access") return <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-ink">You don&apos;t have access to this area.</p>;
  if (model.state === "error") {
    return (
      <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-3 text-[14px] text-danger">
        {model.error}
      </p>
    );
  }
  const past = model.rows.filter((r) => r.pastWindow).length;
  return (
    <div className="flex flex-col gap-3" data-testid="unbanked-view">
      <div className="rounded-field border border-line bg-ground px-3 py-2 text-[14px] text-ink">
        <strong>Paid, not on the bank.</strong> Payments from approved confirmations (or recorded by hand) that no bank line has banked. Those past the usual window for their method are
        flagged: this is the safety net behind &ldquo;closed by soft credit with no bank reconciliation&rdquo;.{" "}
        {model.rows.length > 0 ? (
          <strong>
            {model.rows.length} {model.rows.length === 1 ? "payment" : "payments"}
            {past > 0 ? `, ${past} past the window` : ", none past the window"}.
          </strong>
        ) : null}
      </div>
      {model.problems.map((p) => (
        <p key={p} role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {p}
        </p>
      ))}
      {model.rows.length === 0 ? (
        <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-muted">Every approved payment is on the bank. Nothing to chase.</p>
      ) : (
        <div className="overflow-x-auto rounded-field border border-line bg-white">
          <table className="crm-table min-w-[56rem]">
            <thead>
              <tr>
                <th scope="col">Receipt</th>
                <th scope="col">Household</th>
                <th scope="col">Method</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Approved</th>
                <th scope="col">Came from</th>
                <th scope="col">Days / usual</th>
                <th scope="col">Next step</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((r) => {
                const family = model.families[r.householdId] ?? null;
                return (
                  <tr key={r.paymentId}>
                    <td className="font-mono text-[0.8125rem]">{r.receipt ?? "—"}</td>
                    <td>
                      <Link href={`/households/${r.householdId}?tab=payments`} className="crm-link font-semibold">
                        {family ? familyRef(family) : (r.householdName ?? "Household")}
                      </Link>
                      {family ? <span className="block text-xs text-muted">{familyLine(family, labels)}</span> : null}
                    </td>
                    <td>{PAYMENT_METHOD_LABEL[r.method] ?? r.method.replace(/_/g, " ")}</td>
                    <td className="num">{formatCents(r.amountCents, currency, locale)}</td>
                    <td className="whitespace-nowrap">{r.verifiedOn ? formatDate(r.verifiedOn, timeZone) : "—"}</td>
                    <td>{sourceWord(r.source)}</td>
                    <td className="whitespace-nowrap">{r.pastWindow ? <Badge tone="danger">{daysText(r)}</Badge> : <span>{daysText(r)}</span>}</td>
                    <td className="text-[0.8125rem]">{nextStep(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
