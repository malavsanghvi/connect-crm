"use client";

// "Explain and accept" on a card payout row of Giving › Bank (docs/GIVING_REDESIGN.md slice 9, section 2 "Handle a payout
// difference"): the provider's side and the bank's side together, the difference, a typed reason and a sentence when they differ,
// and a button that names the difference ("Accept the $2.00 difference"). No money moves: the payout already reached the bank. The
// pairing can be undone with a reason until the month is locked ("Undo pairing"). The database (app.explain_payout,
// app.unpair_payout, 0747) checks everything again; its refusal is shown next to the button, with the button still there.

import { useId, useState } from "react";

import { explainPayoutAction, unpairPayoutAction } from "@/app/(app)/giving/payments/bank/payout-actions";
import { GivingSheet } from "@/components/giving-actions/sheet";
import type { CardLabels } from "@/components/household-card";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { PayoutRowView } from "@/lib/giving-bank/views";
import { DIFFERENCE_REASONS, explainProblem } from "@/lib/giving-payouts/explain";

function Sides({ row }: { row: PayoutRowView }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="rounded-[14px] border border-line bg-white px-3.5 py-2.5">
        <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-faint">Provider</p>
        {row.provider ? (
          <>
            <p className="m-0 text-[14px] font-bold text-ink">{row.provider.title}</p>
            <p className="m-0 text-[13px] text-muted">{row.provider.date}</p>
            <p className="m-0 text-[13px] text-muted">
              Gross {row.provider.gross} · fees {row.provider.fees} · <span className="font-bold text-ink">net {row.provider.net}</span>
            </p>
          </>
        ) : null}
      </div>
      <div className="rounded-[14px] border border-line bg-white px-3.5 py-2.5">
        <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-faint">Bank</p>
        {row.bank ? (
          <>
            <p className="m-0 text-[14px] font-bold tabular-nums text-ink">{row.bank.amount}</p>
            <p className="m-0 text-[13px] text-muted">{row.bank.date}</p>
            <p className="m-0 break-words font-mono text-[12px] text-muted">{row.bank.title}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function ExplainPayoutButton({ row, labels }: { row: PayoutRowView; labels: CardLabels }) {
  const toast = useToast();
  const name = useId();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const explain = row.explain;
  if (!explain) return null;
  if (done) return <p className="m-0 text-[13px] font-bold text-success">Paired</p>;
  const differs = explain.differenceCents !== 0;
  const missing = explainProblem(explain.differenceCents, code, note);

  async function accept() {
    if (!explain || missing) return;
    setPending(true);
    setError(null);
    try {
      const res = await explainPayoutAction({ payoutId: explain.payoutId, bankLineId: explain.bankLineId, differenceCents: explain.differenceCents, code, note });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      setOpen(false);
      toast?.show(differs ? "Difference accepted · the payout is paired with its bank line" : "Paired · the payout and its bank line agree", "ok");
    } catch (err) {
      console.error("[payout] explain failed:", err);
      setError("Could not pair the payout — the server did not respond. Nothing was saved; try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => (setError(null), setOpen(true))} className={`${buttonClass(differs ? "primary" : "ghost", "sm")} min-h-[44px] self-start`}>
        {differs ? "Explain and accept" : "Confirm the pair"}
      </button>
      {open ? (
        <GivingSheet
          title={differs ? "Explain the difference" : "Confirm the pair"}
          labels={labels}
          what={
            <>
              <strong>{explain.sentence}</strong> Pairing records that these are the same money; nothing moves. You can undo it until the month is
              locked.
            </>
          }
          error={error}
          confirmLabel={explain.button}
          pendingLabel="Saving…"
          pending={pending}
          confirmDisabled={missing !== null}
          onConfirm={() => void accept()}
          onClose={() => setOpen(false)}
        >
          <Sides row={row} />
          {differs ? (
            <>
              <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1 text-[14px] font-bold text-ink">Why do they differ?</legend>
                {DIFFERENCE_REASONS.map((r) => (
                  <label key={r.code} className="flex min-h-[40px] items-center gap-2.5 text-[14px] text-ink-2">
                    <input type="radio" name={name} value={r.code} checked={code === r.code} onChange={() => setCode(r.code)} className="h-4 w-4" />
                    {r.label}
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1 text-[14px] font-bold text-ink">
                What happened, in a sentence
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="The bank took a fee for the incoming transfer."
                  className="rounded-field border border-line px-3 py-2 text-[14px] font-normal text-ink"
                />
                <span className="text-[12px] font-normal text-muted">Kept in the audit log, and read at the month-end close.</span>
              </label>
              {missing ? <p className="m-0 text-[13px] text-muted">{missing}</p> : null}
            </>
          ) : null}
        </GivingSheet>
      ) : null}
    </>
  );
}

export function UnpairPayoutButton({ row, labels }: { row: PayoutRowView; labels: CardLabels }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const paired = row.paired;
  if (!paired) return null;
  if (done) return <p className="m-0 text-[13px] font-bold text-muted">Pairing undone</p>;

  async function undo() {
    if (!paired || !reason.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await unpairPayoutAction({ payoutId: paired.payoutId, reason });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      setOpen(false);
      toast?.show("Pairing undone · the payout waits to be paired again", "ok");
    } catch (err) {
      console.error("[payout] unpair failed:", err);
      setError("Could not undo the pairing — the server did not respond. Nothing was changed; try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => (setError(null), setOpen(true))} className={`${buttonClass("ghost", "sm")} min-h-[44px] self-start`}>
        Undo pairing
      </button>
      {open ? (
        <GivingSheet
          title="Undo the pairing"
          labels={labels}
          what="The payout and the bank line go back to waiting, and the month-end close counts the payout as not matched until it is paired again. No money moves."
          error={error}
          confirmLabel="Undo the pairing"
          pendingLabel="Saving…"
          pending={pending}
          confirmDisabled={!reason.trim()}
          onConfirm={() => void undo()}
          onClose={() => setOpen(false)}
        >
          <Sides row={row} />
          <label className="flex flex-col gap-1 text-[14px] font-bold text-ink">
            Why undo it?
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Paired with the wrong bank line."
              className="rounded-field border border-line px-3 py-2 text-[14px] font-normal text-ink"
            />
          </label>
        </GivingSheet>
      ) : null}
    </>
  );
}
