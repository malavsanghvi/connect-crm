"use client";

// What only the Bank tab does to a bank line (docs/GIVING_REDESIGN.md slice 4): set a line aside (ignore it, with an optional note)
// and put an ignored line back with the lines to match. Both call the existing server actions; neither moves money.

import { useState } from "react";

import { ignoreBankLineAction, restoreBankLineAction } from "@/app/(app)/giving/payments/bank/actions";
import { InlineError, SMALL, useRun, type ActContext } from "@/components/giving-actions/row-actions";
import { GivingSheet } from "@/components/giving-actions/sheet";
import { buttonClass } from "@/components/ui";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** "Set aside…" on a line to match, "Ignore…" on money out: the line moves to History › Ignored, where it can be restored. */
export function IgnoreLineAct({ id, amount, label, ctx }: { id: string; amount: string; label: "Set aside…" | "Ignore…"; ctx: ActContext }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { pending, error, setError, run } = useRun();
  return (
    <>
      <button
        type="button"
        className={`${buttonClass("ghost", "sm")} ${SMALL}`}
        onClick={() => {
          setError(null);
          setNote("");
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open ? (
        <GivingSheet
          title={`Set aside the ${amount} bank line?`}
          labels={ctx.labels}
          what="Nothing is recorded for any family. The line leaves the lines to match and waits under History › Ignored, where it can be restored."
          error={error}
          confirmLabel={`Set aside the ${amount} line`}
          pendingLabel="Setting aside…"
          pending={pending}
          onClose={() => setOpen(false)}
          onConfirm={() =>
            run(
              "Set the bank line aside",
              () => ignoreBankLineAction(null, fd({ id, note: note.trim() })),
              () => {
                setOpen(false);
                ctx.onDone(`Done: the ${amount} line is set aside. Restore it from History › Ignored.`);
              },
            )
          }
        >
          <div>
            <label htmlFor={`note-${id}`} className="mb-1 block text-[13px] font-bold text-ink">
              Why (optional)
            </label>
            <textarea
              id={`note-${id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              className="crm-input w-full"
              placeholder="For example: a transfer between our own accounts"
            />
          </div>
        </GivingSheet>
      ) : null}
    </>
  );
}

/** An ignored line goes back to the lines to match (no money moves, so no sheet). */
export function RestoreLineAct({ id, amount, ctx }: { id: string; amount: string; ctx: ActContext }) {
  const { pending, error, run } = useRun();
  return (
    <>
      <button
        type="button"
        className={`${buttonClass("ghost", "sm")} ${SMALL}`}
        disabled={pending}
        onClick={() => run("Restore the bank line", () => restoreBankLineAction(null, fd({ id })), () => ctx.onDone(`Done: the ${amount} line is back with the lines to match.`))}
      >
        {pending ? "Restoring…" : "Restore to the lines to match"}
      </button>
      {error ? <InlineError>{error}</InlineError> : null}
    </>
  );
}
