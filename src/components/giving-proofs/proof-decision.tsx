"use client";

import { useState, useTransition } from "react";

import { approveProofAction, askProofAction, rejectProofAction, type ProofResult } from "@/app/(app)/giving/proofs/actions";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { changesFromForm, OFFLINE_METHODS, reasonProblem } from "@/lib/payment-proofs/decide";
import { centsAsDecimal } from "@/lib/money";
import { approvePrimary, decisionBlock, methodLabel, type CardCan, type Lookalike, type ProofCard } from "@/lib/payment-proofs/queue";

// The decision on one proof: Approve, Approve with changes, Ask for more, Reject. The database refuses what this screen does not
// (your own household, a second approval by the same person, a lookalike payment without a reason); whatever it says is shown here,
// next to the button, and stays until the next try.

type Mode = "approve" | "changes" | "ask" | "reject";
const MODES: { key: Mode; label: string }[] = [
  { key: "approve", label: "Approve" },
  { key: "changes", label: "Approve with changes" },
  { key: "ask", label: "Ask for more" },
  { key: "reject", label: "Reject" },
];

export function ProofDecision({
  card,
  can,
  onDecided,
}: {
  card: ProofCard;
  can: CardCan;
  onDecided: (state: string) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("approve");
  const [amount, setAmount] = useState(centsAsDecimal(card.amountCents));
  const [paidOn, setPaidOn] = useState(card.paidOn);
  const [method, setMethod] = useState(card.method);
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [dupServer, setDupServer] = useState<Lookalike[] | null>(null);
  const [differentOpen, setDifferentOpen] = useState(false);
  const [separateReason, setSeparateReason] = useState("");
  const [bankId, setBankId] = useState(card.bankLines[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => Promise<ProofResult>) | null>(null);
  const [pending, start] = useTransition();

  const block = decisionBlock(card, can);
  const primary = approvePrimary(card, can);
  // Approve as claimed is blocked by a lookalike up front; with changes, the database checks the new values and asks if needed.
  const dup = dupServer ?? (mode === "approve" && card.lookalikes.length > 0 ? card.lookalikes : null);
  const mergeable = (dup ?? []).filter((l) => l.kind === "payment");
  const others = (dup ?? []).filter((l) => l.kind !== "payment");

  function run(fn: () => Promise<ProofResult>) {
    setError(null);
    setDone(null);
    setRetry(null);
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          if (res.lookalikes) setDupServer(res.lookalikes);
          setError(res.error);
          if (!res.lookalikes) setRetry(() => fn);
          toast?.show(res.error, "bad");
          return;
        }
        setDone(res.message);
        toast?.show(res.message, "ok");
        onDecided(res.state);
      } catch (err) {
        console.error("[giving/proofs] the decision could not be sent:", err);
        const msg = "Could not save the decision — the server could not be reached. Nothing was changed; try again.";
        setError(msg);
        setRetry(() => fn);
        toast?.show(msg, "bad");
      }
    });
  }

  /** The values the treasurer changed (none when approving as claimed), or a sentence when the form is not valid. */
  function changes(): { ok: true; amountCents: number | null; paidOn: string | null; method: string | null } | { ok: false; error: string } {
    if (mode !== "changes") return { ok: true, amountCents: null, paidOn: null, method: null };
    return changesFromForm({ amount, paidOn, method }, { amountCents: card.amountCents, paidOn: card.paidOn, method: card.method });
  }

  function approve(extra: { mergePaymentId?: string; separateReason?: string }) {
    const ch = changes();
    if (!ch.ok) {
      setError(`Could not approve the proof — ${ch.error}`);
      return;
    }
    // The bank line was found for the amount the family claimed: only offered while that amount stands.
    const reconcile = primary.reconcile && !extra.mergePaymentId && ch.amountCents === null && bankId !== "";
    run(() =>
      approveProofAction({
        proofId: card.id,
        amountCents: ch.amountCents,
        paidOn: ch.paidOn,
        method: ch.method,
        note: mode === "changes" ? note : null,
        mergePaymentId: extra.mergePaymentId ?? null,
        separateReason: extra.separateReason ?? null,
        bankTxnId: reconcile ? bankId : null,
      }),
    );
  }

  function submit() {
    if (mode === "ask") {
      const bad = reasonProblem(text, "ask");
      if (bad) return setError(`Could not send the question — ${bad}`);
      return run(() => askProofAction(card.id, text));
    }
    if (mode === "reject") {
      const bad = reasonProblem(text, "reject");
      if (bad) return setError(`Could not reject the proof — ${bad}`);
      return run(() => rejectProofAction(card.id, text));
    }
    approve({});
  }

  function differentGift() {
    if (separateReason.trim().length < 5) {
      setError("Could not record a different gift — say why this is a different gift, in a few words.");
      return;
    }
    approve({ separateReason });
  }

  const label = mode === "approve" ? primary.label : mode === "changes" ? "Approve with these changes" : mode === "ask" ? "Ask the family" : "Reject and tell the family";
  const approving = mode === "approve" || mode === "changes";
  const disabled = pending || done !== null || (approving ? primary.disabled || dup !== null : block !== null);
  const reason = approving ? (block ?? primary.reason) : block;

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Your decision" className="flex flex-wrap gap-1.5">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={mode === m.key}
            disabled={pending || block !== null}
            onClick={() => {
              setMode(m.key);
              setError(null);
              setDupServer(null);
              setDifferentOpen(false);
            }}
            className={`min-h-[44px] rounded-full border border-navy px-3.5 text-[14px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${mode === m.key ? "bg-navy text-white" : "bg-white text-navy"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "changes" ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-2.5">
            <div className="flex min-w-[110px] flex-[1_1_110px] flex-col gap-1">
              <label htmlFor={`amt-${card.id}`} className="text-[13px] font-bold">
                Amount seen on the proof
              </label>
              <input id={`amt-${card.id}`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" className="crm-input min-h-[44px] tabular-nums" />
            </div>
            <div className="flex min-w-[130px] flex-[1_1_130px] flex-col gap-1">
              <label htmlFor={`dt-${card.id}`} className="text-[13px] font-bold">
                Date paid
              </label>
              <input id={`dt-${card.id}`} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="crm-input min-h-[44px]" />
            </div>
            <div className="flex min-w-[130px] flex-[1_1_130px] flex-col gap-1">
              <label htmlFor={`mt-${card.id}`} className="text-[13px] font-bold">
                How it was paid
              </label>
              <select id={`mt-${card.id}`} value={method} onChange={(e) => setMethod(e.target.value)} className="crm-input min-h-[44px]">
                {OFFLINE_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {methodLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`note-${card.id}`} className="text-[13px] font-bold">
              Note kept with the payment (optional)
            </label>
            <input id={`note-${card.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} autoComplete="off" className="crm-input min-h-[44px]" />
          </div>
          <p className="m-0 text-[13.5px] text-ink-2">The payment is recorded as you enter it. Pledges are re-covered oldest first, and the family is told why it differs from what they sent.</p>
        </div>
      ) : null}

      {mode === "ask" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`ask-${card.id}`} className="text-[13px] font-bold">
            What do you need? (the family sees this)
          </label>
          <textarea id={`ask-${card.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} className="crm-input min-h-[88px]" placeholder="For example: could you send a clearer photo of the front of the check?" />
          <p className="m-0 text-[13.5px] text-ink-2">The pledges stay Soft credit. If the family does not answer within the days your organization set, the proof comes back here marked stale. It is never rejected on its own.</p>
        </div>
      ) : null}

      {mode === "reject" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`rej-${card.id}`} className="text-[13px] font-bold">
            Why? (required, the family sees this)
          </label>
          <textarea id={`rej-${card.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} className="crm-input min-h-[88px]" placeholder="For example: the photo does not show the amount." />
          <p className="m-0 text-[13.5px] text-ink-2">The soft credit is released, the pledges are open again and their reminders resume.</p>
        </div>
      ) : null}

      {(mode === "approve" || mode === "changes") && primary.reconcile && card.bankLines.length > 0 && !dup ? (
        <fieldset className="m-0 flex flex-col gap-1.5 rounded-field border border-success/30 bg-success-50 px-3 py-2">
          <legend className="px-1 text-[13px] font-bold text-success-900">Bank line to match in the same click</legend>
          {card.bankLines.map((b) => (
            <label key={b.id} className="flex items-start gap-2 text-[13.5px] text-ink">
              <input type="radio" name={`bank-${card.id}`} value={b.id} checked={bankId === b.id} onChange={() => setBankId(b.id)} className="mt-1" />
              <span>
                {b.postedOn || "Bank line"}
                {b.description ? ` · ${b.description}` : ""}
              </span>
            </label>
          ))}
          {mode === "changes" ? <p className="m-0 text-[12.5px] text-muted">The bank line is only matched while the amount is the one the family sent.</p> : null}
        </fieldset>
      ) : null}

      {dup ? (
        <div role="group" aria-label="This may be a payment you already recorded" className="flex flex-col gap-2 rounded-field border border-saffron bg-warning-50 px-3.5 py-2.5">
          <strong className="text-warning-ink">Approving is blocked: this may be a payment you already recorded.</strong>
          {others.length > 0 ? (
            <ul className="m-0 list-disc pl-5 text-[13.5px] text-ink">
              {others.map((l) => (
                <li key={`${l.kind}-${l.id}`}>{l.label}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {mergeable.map((l) => (
              <button key={l.id} type="button" disabled={pending} onClick={() => approve({ mergePaymentId: l.id })} className={buttonClass("ghost", "sm")}>
                Merge: keep these photos as evidence on {l.label}
              </button>
            ))}
            <button type="button" disabled={pending} aria-expanded={differentOpen} onClick={() => setDifferentOpen((v) => !v)} className={buttonClass("ghost", "sm")}>
              A different gift (say why)
            </button>
          </div>
          {mergeable.length === 0 ? <p className="m-0 text-[13px] text-ink-2">There is no recorded payment to keep the photos with. If this is a separate gift, say why.</p> : null}
          {differentOpen ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`sep-${card.id}`} className="text-[13px] font-bold">
                Why is this a different gift? (kept in the audit log)
              </label>
              <input id={`sep-${card.id}`} value={separateReason} onChange={(e) => setSeparateReason(e.target.value)} maxLength={500} autoComplete="off" className="crm-input min-h-[44px]" />
              <button type="button" disabled={pending} onClick={differentGift} className={`${buttonClass("primary", "sm")} self-start`}>
                {pending ? "Saving…" : "Record it as a different gift"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled} onClick={submit} className={`${buttonClass(mode === "reject" ? "bad-solid" : "primary", "lg")} ${disabled ? "opacity-60" : ""}`}>
          {pending ? "Saving…" : label}
        </button>
        <span className="text-[13px] text-muted">{reason ?? "Every decision is written to the audit log with your name."}</span>
      </div>

      {error ? (
        <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {error}
          {retry && !pending ? (
            <button type="button" onClick={() => run(retry)} className={`${buttonClass("bad", "xs")} ml-2 align-middle`}>
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="m-0 rounded-field border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900">
          {done}
        </p>
      ) : null}
    </div>
  );
}
