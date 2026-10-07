"use client";

import { useState } from "react";

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
  suggestion: { cents: number; from: string } | null;
  /** The level's seats in one line ("24 seats · 12 taken · 12 free"), or "—". */
  seats: string;
};

export type FeeEditorGroup = { trackId: string; trackName: string; rows: FeeEditorRow[] };

type Status = { tone: "success" | "warning" | "danger" | "neutral"; text: string };

/** What a row's box means right now: saved, changed, suggested, missing, or not needed. */
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
  return row.offered ? { tone: "danger", text: "Needs a fee" } : { tone: "neutral", text: "No class this term" };
}

/**
 * The fee of every level for the term (§2.2, P21, P22): a box per level, pre-filled with the saved fee or a suggestion
 * from the latest earlier term; tick levels and "Copy to the N selected levels" fills their boxes with one fee (the
 * owner's example: Jainism 1 to 7 → $130). Nothing is saved until "Save fees"; only changed fees are sent. Read-only
 * for people who may not change them now.
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
  // An offered level without a fee starts from its suggestion, for the principal to confirm or change (P22); a level
  // with no class this term starts blank, so saving never prices a level nobody looked at.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.rows.map((r) => [r.levelId, feeInputValue(r.saved ?? (r.offered ? (r.suggestion?.cents ?? null) : null))]))),
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
              inputMode="decimal"
              placeholder="130"
              aria-describedby="fee-copy-problem"
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
                          {r.offered ? `${r.classes} class${r.classes === 1 ? "" : "es"}` : <span className="text-muted">No class this term</span>}
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
                            aria-invalid={status.tone === "danger" && value.trim() !== ""}
                            className="crm-input w-32"
                          />
                        </td>
                        <td className="max-w-[260px] text-[13px]">
                          <Badge tone={status.tone}>{status.tone === "danger" && value.trim() !== "" ? "Check this fee" : status.text}</Badge>
                          {status.tone === "danger" && value.trim() !== "" ? <span className="block text-xs text-danger">{status.text}</span> : null}
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
        until it has a fee. A suggested fee is saved only when you save the fees.
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
                    {r.offered ? `${r.classes} class${r.classes === 1 ? "" : "es"}` : <span className="text-muted">No class this term</span>}
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
