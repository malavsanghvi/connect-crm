"use client";

import { useState, type KeyboardEvent } from "react";

import { ActionForm, type FormAction } from "@/components/action-form";
import { Badge, TableWrap, buttonClass } from "@/components/ui";
import { FEE_RULE, feeInputValue, feeLabel, parseFeeInput } from "@/lib/pathshala-registration/money";

export type FeeEditorRow = {
  levelId: string;
  name: string;
  /** "Children's level · Ages 8–10", "No age band" … */
  band: string;
  offered: boolean;
  classes: number;
  retired: boolean;
  /** The fee saved for the term, in cents; null = none yet. */
  saved: number | null;
  /** A fee from an earlier term (or the term's old single fee): offered with a "Use" button, never put in the box by itself. */
  suggestion: { cents: number; from: string } | null;
  /** The level's seats in one line ("24 seats · 12 taken · 12 free"), or "—". */
  seats: string;
};

export type FeeEditorGroup = { trackId: string; trackName: string; rows: FeeEditorRow[] };

type Status = { tone: "success" | "warning" | "danger" | "neutral"; text: string };

/** What a row's box means right now: saved, changed, taken from a suggestion, missing, or not needed. */
export function rowStatus(row: FeeEditorRow, value: string, currency: string): Status {
  const parsed = parseFeeInput(value, row.name, currency);
  if (!parsed.ok) return { tone: "danger", text: parsed.error };
  if (row.saved !== null) {
    if (parsed.cents === null || parsed.cents === row.saved) return { tone: "success", text: "Saved" };
    return { tone: "warning", text: `Changed from ${feeLabel(row.saved, currency)} · not saved yet` };
  }
  if (parsed.cents !== null) {
    const fromSuggestion = row.suggestion && parsed.cents === row.suggestion.cents;
    return { tone: "warning", text: fromSuggestion ? `Suggested from ${row.suggestion?.from} · not saved yet` : "Not saved yet" };
  }
  if (row.offered) return { tone: "danger", text: "Needs a fee" };
  return { tone: "neutral", text: row.retired && row.classes > 0 ? "Retired: not offered, no fee needed" : "No class this term" };
}

/** The offered levels with no fee saved, an empty box and a suggestion: what "Use the suggestions" fills. */
export function suggestionsToUse(groups: readonly FeeEditorGroup[], values: Readonly<Record<string, string>>): FeeEditorRow[] {
  return groups.flatMap((g) => g.rows.filter((r) => r.offered && r.saved === null && r.suggestion !== null && (values[r.levelId] ?? "").trim() === ""));
}

/** "Use $130.00 (2025-26)": the button that puts a row's suggestion in its box. */
export function suggestionButtonLabel(s: { cents: number; from: string }, currency: string): string {
  return `Use ${feeLabel(s.cents, currency)} (${s.from})`;
}

/** "Use the suggestions for the 8 levels without a fee". */
export function bulkSuggestionLabel(n: number): string {
  return `Use the suggestions for the ${n === 1 ? "1 level" : `${n} levels`} without a fee`;
}

/**
 * Enter in the "Fee to copy" box copies the fee. It must never reach the form: Enter in a text box submits it, and
 * that would save every box on the screen.
 */
export function copyOnEnter(e: Pick<KeyboardEvent<HTMLInputElement>, "key" | "preventDefault">, copy: () => void): void {
  if (e.key !== "Enter") return;
  e.preventDefault();
  copy();
}

/** "2 classes", "No class this term", or "2 classes · retired, not offered" (0590 offers active levels only). */
function classesText(row: FeeEditorRow): string {
  if (row.classes === 0) return "No class this term";
  const n = `${row.classes} class${row.classes === 1 ? "" : "es"}`;
  return row.offered ? n : `${n} · retired, not offered`;
}

/**
 * The fee of every level for the term (§2.2, P21, P22): a box per level, holding only the fee saved for this term.
 * A fee from an earlier term (or the term's old single fee) is offered as the box's placeholder with a "Use $X
 * (term)" button, and "Use the suggestions for the N levels without a fee" takes them all at once: nothing goes in a
 * box, and so nothing is saved, unless the principal chooses it. Tick levels and "Copy to the N selected levels"
 * gives them one fee (the owner's example: Jainism 1 to 7 → $130). Nothing is saved until "Save fees"; only changed
 * fees are sent. Read-only for people who may not change them now.
 */
export function FeesEditor({
  groups,
  action,
  canEdit,
  needsReason,
  currency,
}: {
  groups: FeeEditorGroup[];
  action: FormAction;
  canEdit: boolean;
  needsReason: boolean;
  currency: string;
}) {
  // Only what is saved: a suggestion is never a value until someone chooses it.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.rows.map((r) => [r.levelId, feeInputValue(r.saved)]))),
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [copyAmount, setCopyAmount] = useState("");
  const [copyProblem, setCopyProblem] = useState<string | null>(null);

  if (!canEdit) return <ReadOnlyFees groups={groups} currency={currency} />;

  const toggle = (ids: string[], on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const fill = (rows: readonly FeeEditorRow[]) =>
    setValues((cur) => ({ ...cur, ...Object.fromEntries(rows.filter((r) => r.suggestion).map((r) => [r.levelId, feeInputValue(r.suggestion?.cents)])) }));

  function copy() {
    const parsed = parseFeeInput(copyAmount, "the selected levels", currency);
    if (!parsed.ok) return setCopyProblem(parsed.error);
    if (parsed.cents === null) return setCopyProblem("Type the fee to copy: an amount like 130 or 130.50, or Free.");
    if (selected.size === 0) return setCopyProblem("Tick the levels to copy the fee to.");
    setCopyProblem(null);
    const value = feeInputValue(parsed.cents);
    setValues((cur) => ({ ...cur, ...Object.fromEntries([...selected].map((id) => [id, value])) }));
  }

  const n = selected.size;
  const waiting = suggestionsToUse(groups, values);
  return (
    <ActionForm action={action} submitLabel="Save fees" pendingLabel="Saving fees…" buttonsClassName="mt-3">
      <div className="mb-3 rounded-[12px] border border-line bg-ground p-3">
        <p className="text-[13px] font-bold text-ink">Copy one fee to many levels</p>
        <p className="text-xs text-muted">Tick the levels below, type the fee, then copy. {FEE_RULE}</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="crm-label">Fee to copy</span>
            <input
              value={copyAmount}
              onChange={(e) => setCopyAmount(e.target.value)}
              onKeyDown={(e) => copyOnEnter(e, copy)}
              inputMode="decimal"
              placeholder="130"
              aria-describedby={copyProblem ? "fee-copy-problem" : undefined}
              aria-invalid={copyProblem ? true : undefined}
              className="crm-input w-32"
            />
          </label>
          <button type="button" onClick={copy} className={buttonClass(n ? "primary" : "off", "sm")} aria-disabled={n === 0}>
            {n === 1 ? "Copy to the 1 selected level" : `Copy to the ${n} selected levels`}
          </button>
          {n ? (
            <button type="button" onClick={() => setSelected(new Set())} className={buttonClass("ghost", "sm")}>
              Clear the ticks
            </button>
          ) : null}
        </div>
        {copyProblem ? (
          <p id="fee-copy-problem" role="alert" className="mt-2 text-[13px] text-danger">
            {copyProblem}
          </p>
        ) : null}
        {waiting.length ? (
          <div className="mt-3 border-t border-line-soft pt-3">
            <button type="button" onClick={() => fill(waiting)} className={buttonClass("ghost", "sm")}>
              {bulkSuggestionLabel(waiting.length)}
            </button>
            <p className="mt-1 text-xs text-muted">
              Fills each of those boxes with the fee suggested beside it (the level&apos;s fee in an earlier term). Check them, then Save fees.
            </p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const ids = g.rows.map((r) => r.levelId);
          const allOn = ids.every((id) => selected.has(id));
          return (
            <TableWrap key={g.trackId}>
              <table className="crm-table min-w-[720px]">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={allOn}
                        onChange={(e) => toggle(ids, e.target.checked)}
                        aria-label={`Tick every level of ${g.trackName}`}
                        className="h-5 w-5 accent-navy"
                      />
                    </th>
                    <th>{g.trackName}</th>
                    <th>Classes and seats</th>
                    <th>Fee</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const value = values[r.levelId] ?? "";
                    const status = rowStatus(r, value, currency);
                    const invalid = status.tone === "danger" && value.trim() !== "";
                    const statusId = `fee-status-${r.levelId}`;
                    return (
                      <tr key={r.levelId}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(r.levelId)}
                            onChange={(e) => toggle([r.levelId], e.target.checked)}
                            aria-label={`Tick ${r.name}`}
                            className="h-5 w-5 accent-navy"
                          />
                        </td>
                        <td>
                          <span className="font-bold text-ink">{r.name}</span>
                          {r.retired ? <span className="ml-2 text-xs text-muted">Retired</span> : null}
                          <span className="block text-xs text-muted">{r.band}</span>
                        </td>
                        <td className="text-[13px]">
                          {r.offered ? classesText(r) : <span className="text-muted">{classesText(r)}</span>}
                          {r.offered ? <span className="block text-xs text-muted">{r.seats}</span> : null}
                        </td>
                        <td>
                          <input
                            name={`fee:${r.levelId}`}
                            value={value}
                            onChange={(e) => setValues((cur) => ({ ...cur, [r.levelId]: e.target.value }))}
                            inputMode="decimal"
                            placeholder={r.suggestion ? `${feeInputValue(r.suggestion.cents)} (${r.suggestion.from})` : r.offered ? "Required" : "Optional"}
                            aria-label={`Fee for ${r.name}`}
                            aria-describedby={statusId}
                            aria-invalid={invalid ? true : undefined}
                            className="crm-input w-32"
                          />
                          {r.suggestion && value.trim() === "" ? (
                            <button
                              type="button"
                              onClick={() => fill([r])}
                              aria-label={`Use the suggested fee for ${r.name}: ${feeLabel(r.suggestion.cents, currency)}, from ${r.suggestion.from}`}
                              className={`${buttonClass("ghost", "xs")} mt-1 block`}
                            >
                              {suggestionButtonLabel(r.suggestion, currency)}
                            </button>
                          ) : null}
                        </td>
                        <td className="max-w-[260px] text-[13px]">
                          <span id={statusId}>
                            <Badge tone={status.tone}>{invalid ? "Check this fee" : status.text}</Badge>
                            {invalid ? <span className="block text-xs text-danger">{status.text}</span> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          );
        })}
      </div>
      <p className="crm-hint mt-2">
        Type Free (or 0) for a level with no fee. A blank box leaves the level as it is; a level with a class this term cannot be chosen by families
        until it has a fee. A fee suggested from an earlier term is only shown beside its box: it is saved only after you press Use (or Use the
        suggestions) and then Save fees.
      </p>
      {needsReason ? (
        <label className="mt-3 block max-w-xl">
          <span className="crm-label">Why the fees change</span>
          <input name="reason" required maxLength={300} className="crm-input" placeholder="For example: the committee approved the new Toddler fee on Sep 3" />
          <span className="crm-hint block">Required after registration opens. Fees already quoted or billed never change.</span>
        </label>
      ) : null}
    </ActionForm>
  );
}

function ReadOnlyFees({ groups, currency }: { groups: FeeEditorGroup[]; currency: string }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <TableWrap key={g.trackId}>
          <table className="crm-table crm-table-first-bold min-w-[620px]">
            <thead>
              <tr>
                <th>{g.trackName}</th>
                <th>Classes and seats</th>
                <th>Fee</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.levelId}>
                  <td>
                    {r.name}
                    {r.retired ? <span className="ml-2 text-xs font-normal text-muted">Retired</span> : null}
                    <span className="block text-xs font-normal text-muted">{r.band}</span>
                  </td>
                  <td className="text-[13px]">
                    {r.offered ? classesText(r) : <span className="text-muted">{classesText(r)}</span>}
                    {r.offered ? <span className="block text-xs text-muted">{r.seats}</span> : null}
                  </td>
                  <td>
                    {r.saved !== null ? (
                      feeLabel(r.saved, currency)
                    ) : r.offered ? (
                      <Badge tone="danger">Needs a fee</Badge>
                    ) : (
                      <span className="text-muted">Not set</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ))}
    </div>
  );
}
