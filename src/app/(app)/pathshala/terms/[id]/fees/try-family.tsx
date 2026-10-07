"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";

import { TableWrap, buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { Quote, QuoteLine } from "@/lib/pathshala-registration/contract";
import { additionLabel, formatMoney, reductionLabel } from "@/lib/pathshala-registration/money";

export type ExampleLevel = { id: string; name: string; /** "Jainism 2 · $130.00", "Gujarati 4 · no fee yet" */ label: string };

type Row = { key: number; name: string; age: string; level_id: string };

const MAX_ROWS = 12;
const blank = (key: number): Row => ({ key, name: "", age: "", level_id: "" });

/** "Child · ranked 2nd" / "Adult learner". */
function learnerText(line: QuoteLine): string {
  if (line.learner_kind === "adult") return "Adult learner";
  if (!line.family_rank) return "Child";
  const n = line.family_rank;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `Child · ${n}${suffix} in the family`;
}

/**
 * "Try a family" (plan §2.4, §3.3): made-up learners, their ages on the cut-off date and their levels, priced by the
 * database exactly as a registration would be (app.pathshala_fee_example), so the principal sees what this term's fees
 * and rules do before families do. Nothing is saved or billed.
 */
export function TryFamily({
  action,
  levels,
  cutoffLabel,
  lateFeeLabel,
  currency,
}: {
  action: (prev: ActionResult<Quote> | null, fd: FormData) => Promise<ActionResult<Quote>>;
  levels: ExampleLevel[];
  cutoffLabel: string;
  /** "$25.00 per learner" when the term has a late fee; the late window can then be tried. */
  lateFeeLabel: string | null;
  currency: string;
}) {
  const [rows, setRows] = useState<Row[]>([blank(1), blank(2), blank(3)]);
  const [state, formAction, pending] = useActionState(action, null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Sent by hand so a result never clears what was typed.
    startTransition(() => formAction(fd));
  }

  const set = (key: number, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const levelName = (id: string | null) => levels.find((l) => l.id === id)?.name ?? "—";
  const quote = state?.ok ? state.data : undefined;
  const anyAssistance = quote?.lines.some((l) => l.assistance_cents !== 0) ?? false;

  return (
    <form onSubmit={onSubmit} aria-busy={pending}>
      <p className="mb-2 text-[13px] text-muted">
        Ages are on the term&apos;s cut-off date ({cutoffLabel}): under 18 counts as a child. Give a learner two rows to try two levels (two tracks).
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.4fr)_auto] sm:items-end">
            <label className="block">
              <span className="crm-label">{`Learner ${i + 1}`}</span>
              <input name="name" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} maxLength={40} placeholder="First name" className="crm-input" />
            </label>
            <label className="block">
              <span className="crm-label">Age</span>
              <input name="age" value={r.age} onChange={(e) => set(r.key, { age: e.target.value })} inputMode="numeric" placeholder="9" className="crm-input" />
            </label>
            <label className="block">
              <span className="crm-label">Level</span>
              <select name="level_id" value={r.level_id} onChange={(e) => set(r.key, { level_id: e.target.value })} className="crm-input">
                <option value="">Choose a level</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setRows((cur) => (cur.length > 1 ? cur.filter((x) => x.key !== r.key) : [blank(r.key + 1)]))}
              className={buttonClass("ghost", "xs")}
              aria-label={`Remove learner ${i + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {lateFeeLabel ? (
        <label className="mt-3 flex min-h-10 cursor-pointer items-start gap-3">
          <input type="checkbox" name="late" value="on" className="mt-0.5 h-5 w-5 shrink-0 accent-navy" />
          <span className="text-[13px]">
            <span className="font-bold text-ink">Price it as a late registration</span>
            <span className="block text-xs text-muted">After registration closes each learner pays the late fee too ({lateFeeLabel}).</span>
          </span>
        </label>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rows.length < MAX_ROWS ? (
          <button type="button" onClick={() => setRows((cur) => [...cur, blank(Math.max(0, ...cur.map((x) => x.key)) + 1)])} className={buttonClass("ghost", "sm")}>
            Add a learner
          </button>
        ) : null}
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "Working it out…" : "Work out the fees"}
        </button>
      </div>
      {state && !state.ok ? (
        <p role="alert" className="mt-3 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}
      {quote ? (
        <div className="mt-4" role="status">
          <TableWrap>
            <table className="crm-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Level</th>
                  <th className="text-right">Level fee</th>
                  <th className="text-right">Sibling discount</th>
                  <th className="text-right">Family cap</th>
                  <th className="text-right">Late fee</th>
                  {anyAssistance ? <th className="text-right">Assistance</th> : null}
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <span className="font-bold text-ink">{line.first_name ?? `Learner ${line.index ?? i + 1}`}</span>
                      <span className="block text-xs text-muted">
                        {learnerText(line)}
                        {line.age_on_cutoff !== null ? ` · age ${line.age_on_cutoff}` : ""}
                      </span>
                    </td>
                    <td>{levelName(line.level_id)}</td>
                    <td className="text-right">{formatMoney(line.base_fee_cents, currency)}</td>
                    <td className="text-right">{line.learner_kind === "adult" ? <span className="text-muted">Adult: none</span> : reductionLabel(line.sibling_discount_cents, currency)}</td>
                    <td className="text-right">{line.learner_kind === "adult" ? <span className="text-muted">Adult: outside</span> : reductionLabel(line.cap_reduction_cents, currency)}</td>
                    <td className="text-right">{additionLabel(line.late_fee_cents, currency)}</td>
                    {anyAssistance ? <td className="text-right">{reductionLabel(line.assistance_cents, currency)}</td> : null}
                    <td className="text-right font-bold text-ink">{formatMoney(line.total_cents, currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={anyAssistance ? 7 : 6} className="text-right text-muted">
                    Children
                  </td>
                  <td className="text-right">{formatMoney(quote.children_total_cents, currency)}</td>
                </tr>
                <tr>
                  <td colSpan={anyAssistance ? 7 : 6} className="text-right text-muted">
                    Adult learners
                  </td>
                  <td className="text-right">{formatMoney(quote.adults_total_cents, currency)}</td>
                </tr>
                <tr>
                  <td colSpan={anyAssistance ? 7 : 6} className="text-right font-bold text-ink">
                    The family pays
                  </td>
                  <td className="text-right font-bold text-ink">{formatMoney(quote.total_cents, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
          <p className="mt-2 text-xs text-muted">
            {quote.late ? "Priced as a late registration. " : ""}
            The first child pays the full fee and every other child gets the sibling discount; the children&apos;s total stops at the family cap; adult
            learners pay their class fee outside both. A registration is priced the same way and its lines never change afterwards.
          </p>
        </div>
      ) : null}
    </form>
  );
}
