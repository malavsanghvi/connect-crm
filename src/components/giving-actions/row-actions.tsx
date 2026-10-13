"use client";

// What a Today row does in place. Every button calls an EXISTING server action with its existing checks (the two-person rule,
// the bank match and deposit checks, the allocation rules, fresh 2FA where the database asks for it); nothing here decides
// anything about money. A result shows next to the button that caused it, in plain English, and "Done: …" appears only after
// the server said so. These pieces are built once for Giving: the Family page and the later tabs reuse them.

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";

import { setCloseItemAction } from "@/app/(app)/accounting/close/actions";
import {
  approveAsSecondAction,
  approveFlaggedRefundAction,
  completeWriteOffAction,
  recordRefundAction,
  requestWriteOffAction,
} from "@/app/(app)/approvals/actions";
import { openPledgesAction, type OpenPledge } from "@/app/(app)/giving/actions";
import { applyPaymentAction } from "@/app/(app)/giving/payments/actions";
import { confirmBankMatchAction, matchDepositAction } from "@/app/(app)/giving/payments/bank/actions";
import { confirmExactMatchesAction } from "@/app/(app)/giving/payments/bank/zelle-actions";
import { recordCountingDepositAction } from "@/app/(app)/giving/payments/counting-actions";
import type { CardLabels } from "@/components/household-card";
import { useStepUp } from "@/components/step-up";
import { buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { familyLine, familyRef, type Act, type BehindView, type CloseItemView, type Family, type QueueRow, type SuggestionView, type ZellePairView } from "@/lib/giving-today/queue";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { FamilyCard, GivingSheet, NO_UNDO } from "./sheet";

export type ActContext = {
  currency: string;
  locale: string;
  timeZone: string;
  labels: CardLabels;
  /** The row is done: it stays on the page as "Done: …" until the page is reloaded. */
  onDone: (text: string) => void;
};

type Result = { ok: boolean; error?: string; message?: string; stepUp?: boolean };

// A button that names the amount and the family can be long: it wraps instead of running off a phone screen.
const SMALL = "min-h-[40px] max-w-full whitespace-normal py-1.5 text-center";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Run a server action: a fresh 2FA check when the database asks for one, the error in plain English otherwise. */
function useRun() {
  const stepUp = useStepUp();
  const [pending, start] = useTransition();
  const [error, setError] = useState<ReactNode>(null);
  function run<R extends Result>(doing: string, fn: () => Promise<R>, onOk: (r: R) => void) {
    setError(null);
    start(async () => {
      try {
        const res = stepUp ? await stepUp.run(fn, doing) : await fn();
        if (!res.ok) {
          setError(res.error ?? `Could not ${doing.toLowerCase()}.`);
          return;
        }
        onOk(res);
      } catch (err) {
        console.error(`[giving-today] ${doing} failed:`, err);
        setError(`Could not ${doing.toLowerCase()}: the server did not respond. Reload the page to see whether it went through before trying again.`);
      }
    });
  }
  return { pending, error, setError, run };
}

function doneFrom(message: string | undefined, fallback: string): string {
  const m = (message ?? "").trim();
  return m ? `Done: ${m}` : fallback;
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 mt-2 rounded-[10px] border border-[#f0b9b4] bg-danger-50 px-3 py-2 text-[13px] leading-[1.45] text-[#7a1a14]">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------- One button, one sheet

function SheetAct({
  buttonLabel,
  primary = true,
  title,
  family,
  what,
  confirmLabel,
  tone,
  ctx,
  doing,
  call,
  done,
  children,
  ready = true,
  onOpen,
}: {
  buttonLabel: string;
  primary?: boolean;
  title: string;
  family: Family | null;
  what: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  ctx: ActContext;
  doing: string;
  call: () => Promise<Result>;
  done: (r: Result) => string;
  children?: ReactNode;
  ready?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run } = useRun();
  return (
    <>
      <button
        type="button"
        className={`${buttonClass(primary ? (tone === "danger" ? "bad" : "primary") : "ghost", "sm")} ${SMALL}`}
        onClick={() => {
          setError(null);
          onOpen?.();
          setOpen(true);
        }}
      >
        {buttonLabel}
      </button>
      {open ? (
        <GivingSheet
          title={title}
          family={family}
          labels={ctx.labels}
          what={what}
          error={error}
          confirmLabel={confirmLabel}
          pending={pending}
          confirmDisabled={!ready}
          tone={tone}
          onClose={() => setOpen(false)}
          onConfirm={() =>
            run(doing, call, (r) => {
              setOpen(false);
              ctx.onDone(done(r));
            })
          }
        >
          {children}
        </GivingSheet>
      ) : null}
    </>
  );
}

function ReasonField({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-bold text-ink">
        {label}
      </label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={1000} required className="crm-input min-h-20 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------- Approvals

function ApproveAct({ act, row, ctx }: { act: Extract<Act, { kind: "approve" }>; row: QueueRow; ctx: ActContext }) {
  return (
    <SheetAct
      buttonLabel={act.label}
      title="Approve as the second person"
      family={row.family}
      what={
        <>
          <p className="m-0 font-bold text-ink">{row.title}</p>
          {row.lines.map((l) => (
            <p key={l} className="m-0">
              {l}
            </p>
          ))}
          <p className="m-0 mt-1">{act.what}</p>
        </>
      }
      confirmLabel={act.label}
      ctx={ctx}
      doing="Approve the request"
      call={() => approveAsSecondAction(null, fd({ table: act.table, id: act.id }))}
      done={() => act.done}
    />
  );
}

function CreditAct({ act, row, ctx }: { act: Extract<Act, { kind: "credit" }>; row: QueueRow; ctx: ActContext }) {
  return (
    <SheetAct
      buttonLabel={act.label}
      title="Mark the credit handled"
      family={row.family}
      what={act.what}
      confirmLabel={act.label}
      ctx={ctx}
      doing="Mark the credit handled"
      call={() => approveAsSecondAction(null, fd({ table: "rsvp_credit_releases", id: act.id }))}
      done={() => act.done}
    />
  );
}

function FlaggedAct({ act, row, ctx }: { act: Extract<Act, { kind: "flagged" }>; row: QueueRow; ctx: ActContext }) {
  const [reason, setReason] = useState("");
  return (
    <SheetAct
      buttonLabel={act.label}
      title={act.stage === "first" ? "Approve the card refund (first approval)" : "Approve the card refund as second person"}
      family={row.family}
      what={
        <>
          <p className="m-0 font-bold text-ink">{row.title}</p>
          <p className="m-0">{act.what}</p>
        </>
      }
      confirmLabel={act.label}
      ctx={ctx}
      ready={reason.trim().length > 0}
      onOpen={() => setReason("")}
      doing="Approve the refund"
      call={() => approveFlaggedRefundAction(null, fd({ id: act.id, stage: act.stage, reason: reason.trim() }))}
      done={(r) => doneFrom(r.message, "Done: approval recorded.")}
    >
      <ReasonField id={`flag-${act.id}`} value={reason} onChange={setReason} label="Reason (kept in the audit log)" />
    </SheetAct>
  );
}

function CompleteWriteOffAct({ act, row, ctx }: { act: Extract<Act, { kind: "complete_write_off" }>; row: QueueRow; ctx: ActContext }) {
  return (
    <SheetAct
      buttonLabel={act.label}
      tone="danger"
      title="Complete the write-off"
      family={row.family}
      what={act.what}
      confirmLabel={act.label}
      ctx={ctx}
      doing="Write off the pledge"
      call={() => completeWriteOffAction(null, fd({ id: act.id }))}
      done={(r) => doneFrom(r.message, "Done: the pledge is written off.")}
    />
  );
}

function RecordRefundAct({ act, row, ctx }: { act: Extract<Act, { kind: "record_refund" }>; row: QueueRow; ctx: ActContext }) {
  const initial = (act.amountCents / 100).toFixed(2);
  const [amount, setAmount] = useState(initial);
  const cents = parseAmountToCents(amount);
  const id = `refund-${act.id}`;
  return (
    <SheetAct
      buttonLabel={act.label}
      tone="danger"
      title="Record the refund"
      family={row.family}
      what={act.what}
      confirmLabel={cents !== null && cents > 0 ? `Record ${formatCents(cents, ctx.currency, ctx.locale)} refund for ${act.familyRef}` : "Enter the amount refunded"}
      ctx={ctx}
      ready={cents !== null && cents > 0}
      onOpen={() => setAmount(initial)}
      doing="Record the refund"
      call={() => recordRefundAction(null, fd({ id: act.id, amount: amount.trim() }))}
      done={(r) => doneFrom(r.message, "Done: refund recorded.")}
    >
      <div>
        <label htmlFor={id} className="mb-1 block text-[13px] font-bold text-ink">
          Amount refunded
        </label>
        <input id={id} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" className="crm-input w-full sm:w-48" />
      </div>
    </SheetAct>
  );
}

// ---------------------------------------------------------------------------- Bank

function ZelleExact({ pairs, ctx }: { pairs: ZellePairView[]; ctx: ActContext }) {
  const [ticked, setTicked] = useState<string[]>(() => pairs.map((p) => p.reportId));
  const { pending, error, run } = useRun();
  const chosen = pairs.filter((p) => ticked.includes(p.reportId));
  const total = chosen.reduce((a, p) => a + p.amountCents, 0);
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  return (
    <div className="mt-2">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {pairs.map((p) => (
          <li key={p.reportId}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line bg-white px-2.5 py-2 text-[13.5px]">
              <input
                type="checkbox"
                className="mt-0.5 h-[18px] w-[18px] flex-none"
                checked={ticked.includes(p.reportId)}
                onChange={(e) => setTicked((t) => (e.target.checked ? [...t, p.reportId] : t.filter((x) => x !== p.reportId)))}
              />
              <span className="min-w-0 flex-1">
                <span className="font-bold text-ink">{p.family ? p.family.name : "No family on the report"}</span>
                <span className="block text-[13px] text-muted">
                  {p.family ? `${familyLine(p.family, ctx.labels)} · ` : ""}
                  {p.line}
                </span>
              </span>
              <span className="whitespace-nowrap pl-2 font-bold tabular-nums">{money(p.amountCents)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${buttonClass("primary", "sm")} ${SMALL}`}
          disabled={pending || chosen.length === 0}
          onClick={() =>
            run(
              "Confirm the exact matches",
              () => confirmExactMatchesAction(chosen.map((p) => ({ report_id: p.reportId, bank_transaction_id: p.bankTransactionId }))),
              (r) => {
                const receipts = (r.data?.confirmed ?? []).map((c) => c.receipt_number).filter(Boolean);
                ctx.onDone(`Done: ${r.message ?? "confirmed"}${receipts.length > 0 ? ` Receipts ${receipts.join(", ")}.` : ""}`);
              },
            )
          }
        >
          {pending ? "Confirming…" : `Confirm ${chosen.length} exact ${chosen.length === 1 ? "match" : "matches"} (${money(total)})`}
        </button>
        <span className="text-[12px] text-muted">Untick any pair you are not sure of; it stays on the Bank screen.</span>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}

function GiftAct({ act, ctx }: { act: Extract<Act, { kind: "gift" }>; ctx: ActContext }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const all = [...(act.best ? [act.best] : []), ...act.others];
  const [pick, setPick] = useState<SuggestionView | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const money = formatCents(act.amountCents, ctx.currency, ctx.locale);

  function confirm(s: SuggestionView, close: () => void) {
    setDuplicate(false);
    run(
      "Confirm the match",
      async () => {
        const res = await confirmBankMatchAction({ txnId: act.txnId, householdId: s.family.id, pledgeIds: null, learnPayer: act.learnPayer, reportId: s.reportId });
        if (!res.ok && res.duplicate) setDuplicate(true);
        return res;
      },
      (r) => {
        close();
        const d = r.data;
        const applied = d && d.applied.length > 0 ? ` Applied to ${d.applied.map((a) => `${a.pledge_number ?? "a pledge"} (${formatCents(a.amount_cents, ctx.currency, ctx.locale)})`).join(", ")}.` : "";
        ctx.onDone(
          d
            ? `Done: ${formatCents(d.amountCents, ctx.currency, ctx.locale)} matched to ${d.householdName}, receipt ${d.receiptNumber ?? "pending"}.${applied}`
            : `Done: ${money} matched to ${familyRef(s.family)}.`,
        );
      },
    );
  }

  return (
    <>
      {act.best ? (
        <button type="button" className={`${buttonClass("primary", "sm")} ${SMALL}`} disabled={pending} onClick={() => confirm(act.best!, () => {})}>
          {pending && !open ? "Confirming…" : act.best.label}
        </button>
      ) : null}
      <button
        type="button"
        className={`${buttonClass(act.best ? "ghost" : "primary", "sm")} ${SMALL}`}
        disabled={pending}
        onClick={() => {
          setPick(act.best ? (act.others[0] ?? null) : (all[0] ?? null));
          setOpen(true);
        }}
      >
        {act.best ? "Pick another" : "Choose the family"}
      </button>
      {!open && error ? (
        <InlineError>
          {error}
          {duplicate ? (
            <>
              {" "}
              <Link href="/giving/payments/bank" className="font-bold underline">
                Open Bank to decide
              </Link>
            </>
          ) : null}
        </InlineError>
      ) : null}
      {open ? (
        <GivingSheet
          title={`Which family gave ${money}?`}
          labels={ctx.labels}
          what="Each family is shown with its number, household id and primary adult. The bank line is recorded as their gift and applied to their open pledges."
          error={
            error ? (
              <>
                {error}
                {duplicate ? (
                  <>
                    {" "}
                    <Link href="/giving/payments/bank" className="font-bold underline">
                      Open Bank to decide
                    </Link>
                  </>
                ) : null}
              </>
            ) : null
          }
          confirmLabel={pick ? pick.label : "Choose a family"}
          confirmDisabled={!pick}
          pending={pending}
          onClose={() => setOpen(false)}
          onConfirm={() => pick && confirm(pick, () => setOpen(false))}
        >
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">Suggested families</legend>
            {all.map((s) => (
              <label key={s.family.id} className="flex cursor-pointer items-start gap-2.5">
                <input type="radio" name={`gift-${act.txnId}`} className="mt-3 h-[18px] w-[18px] flex-none" checked={pick?.family.id === s.family.id} onChange={() => setPick(s)} />
                <span className="min-w-0 flex-1">
                  <FamilyCard family={s.family} labels={ctx.labels}>
                    {s.reason ? <p className="m-0 mt-1 text-[12.5px] text-ink-2">{s.reason}</p> : null}
                  </FamilyCard>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="m-0 text-[13px] text-muted">
            Not here?{" "}
            <Link href="/giving/payments/bank" className="font-bold text-navy">
              Search every family on the Bank screen
            </Link>
          </p>
        </GivingSheet>
      ) : null}
    </>
  );
}

function DepositAct({ act, ctx }: { act: Extract<Act, { kind: "deposit" }>; ctx: ActContext }) {
  const [selected, setSelected] = useState<string[]>(act.exact ? act.candidates.map((c) => c.paymentId) : []);
  const chosen = act.candidates.filter((c) => selected.includes(c.paymentId));
  const total = chosen.reduce((a, c) => a + c.amountCents, 0);
  const diff = act.amountCents - total;
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  return (
    <SheetAct
      buttonLabel={act.label}
      title={`Deposit of ${money(act.amountCents)}`}
      family={null}
      what={
        diff === 0
          ? `The ticked payments add up to the deposit exactly. Confirming marks them as deposited in this bank line. ${NO_UNDO}`
          : `Tick the recorded payments in this deposit. They must add up to ${money(act.amountCents)} exactly; ${diff > 0 ? `${money(diff)} is still missing` : `${money(-diff)} too much is ticked`}.`
      }
      confirmLabel={`Confirm deposit of ${money(act.amountCents)} for ${chosen.length} ${chosen.length === 1 ? "payment" : "payments"}`}
      ctx={ctx}
      ready={chosen.length > 0 && diff === 0}
      onOpen={() => setSelected(act.exact ? act.candidates.map((c) => c.paymentId) : [])}
      doing="Match the deposit"
      call={() => matchDepositAction({ txnId: act.txnId, paymentIds: chosen.map((c) => c.paymentId) })}
      done={(r) => doneFrom(r.message, `Done: deposit of ${money(act.amountCents)} matched to ${chosen.length} payments.`)}
    >
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {act.candidates.map((c) => (
          <li key={c.paymentId}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line bg-white px-2.5 py-2 text-[13.5px]">
              <input
                type="checkbox"
                className="mt-0.5 h-[18px] w-[18px] flex-none"
                checked={selected.includes(c.paymentId)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.paymentId] : s.filter((x) => x !== c.paymentId)))}
              />
              <span className="min-w-0 flex-1">
                <span className="font-bold text-ink">{c.family ? c.family.name : (c.householdName ?? "Household not shown")}</span>
                <span className="block text-[13px] text-muted">
                  {c.family ? `${familyLine(c.family, ctx.labels)} · ` : ""}
                  {c.line}
                </span>
              </span>
              <span className="whitespace-nowrap pl-2 font-bold tabular-nums">{c.amount}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[13px] font-bold text-ink">
        Ticked {money(total)} of {money(act.amountCents)}
      </p>
    </SheetAct>
  );
}

// ---------------------------------------------------------------------------- Pledges

function BehindFamily({ h, ctx }: { h: BehindView; ctx: ActContext }) {
  const [open, setOpen] = useState(false);
  const [pledges, setPledges] = useState<OpenPledge[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const { pending, error, setError, run } = useRun();
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);

  function openSheet() {
    setOpen(true);
    setError(null);
    setReason("");
    setPick(null);
    setLoadError(null);
    startLoading(async () => {
      try {
        const res = await openPledgesAction(h.family.id);
        if (!res.ok) setLoadError(res.error);
        else setPledges(res.data ?? []);
      } catch (err) {
        console.error("[giving-today] loading the pledges failed:", err);
        setLoadError("Could not load the family's pledges: the server did not respond. Try again.");
      }
    });
  }

  const chosen = pledges?.find((p) => p.id === pick) ?? null;
  const openCents = chosen ? chosen.amount_cents - chosen.paid_cents : 0;
  return (
    <li className="flex flex-col gap-2 rounded-[10px] border border-line bg-white px-2.5 py-2 text-[13.5px] sm:flex-row sm:items-start">
      <span className="min-w-0 flex-1">
        <span className="font-bold text-ink">{h.family.name}</span>
        <span className="block text-[13px] text-muted">
          {familyLine(h.family, ctx.labels)} · {h.line}
        </span>
        {done ? <span className="mt-1 block font-bold text-success">{done}</span> : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="whitespace-nowrap font-bold tabular-nums">{h.open}</span>
        {done ? null : (
          <button type="button" className={`${buttonClass("ghost", "xs")} min-h-[36px]`} onClick={openSheet}>
            Write off…
          </button>
        )}
        <Link href={`/households/${h.family.id}?tab=pledges`} className={`${buttonClass("ghost", "xs")} min-h-[36px]`}>
          Open family
        </Link>
      </span>
      {open ? (
        <GivingSheet
          title="Ask for a write-off"
          family={h.family}
          labels={ctx.labels}
          what="A write-off needs a reason the second approver reads. Nothing changes until a different person approves it and a treasurer completes it."
          error={error ?? loadError}
          confirmLabel={chosen ? `Ask to write off ${money(openCents)} on ${chosen.pledge_number ?? "the pledge"} for ${familyRef(h.family)}` : "Choose a pledge"}
          confirmDisabled={!chosen || reason.trim().length === 0}
          pending={pending}
          tone="danger"
          onClose={() => setOpen(false)}
          onConfirm={() =>
            chosen &&
            run(
              "Request the write-off",
              () => requestWriteOffAction(null, fd({ id: chosen.id, reason: reason.trim() })),
              (r) => {
                setOpen(false);
                setDone(doneFrom(r.message, "Done: write-off requested."));
              },
            )
          }
        >
          {loading ? <p className="m-0 text-[13px] text-muted">Loading the family&apos;s open pledges…</p> : null}
          {pledges && pledges.length === 0 ? <p className="m-0 text-[13px] text-muted">This family has no open pledge now.</p> : null}
          {pledges && pledges.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1 text-[13px] font-bold text-ink">Which pledge?</legend>
              {pledges.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line px-2.5 py-2 text-[13.5px]">
                  <input type="radio" name={`wo-${h.family.id}`} className="mt-0.5 h-[18px] w-[18px] flex-none" checked={pick === p.id} onChange={() => setPick(p.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">{p.pledge_number ?? "Pledge"}</span>
                    {p.campaign ? ` · ${p.campaign}` : ""}
                    <span className="block text-[12.5px] text-muted">
                      {money(p.paid_cents)} of {money(p.amount_cents)} paid · {p.due_on ? `due ${formatDate(p.due_on, ctx.timeZone)}` : "no due date"}
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-bold tabular-nums">{money(p.amount_cents - p.paid_cents)}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <ReasonField id={`wo-reason-${h.family.id}`} value={reason} onChange={setReason} label="Reason (the second approver reads it)" />
        </GivingSheet>
      ) : null}
    </li>
  );
}

function ApplyAct({ act, row, ctx }: { act: Extract<Act, { kind: "apply" }>; row: QueueRow; ctx: ActContext }) {
  return (
    <SheetAct
      buttonLabel={act.label}
      title="Apply the payment to pledges"
      family={row.family}
      what={act.what}
      confirmLabel={act.label}
      ctx={ctx}
      doing="Apply the payment"
      call={async () => await applyPaymentAction({ paymentId: act.paymentId, householdId: act.householdId, pledgeIds: null })}
      done={(r) => {
        const d = (r as { data?: { applied: { pledge_number: string | null; amount_cents: number }[]; unallocatedCents: number } }).data;
        if (!d || d.applied.length === 0) return doneFrom(r.message, "Done: nothing was left to apply.");
        const list = d.applied.map((a) => `${a.pledge_number ?? "a pledge"} (${formatCents(a.amount_cents, ctx.currency, ctx.locale)})`).join(", ");
        return `Done: applied to ${list}${d.unallocatedCents > 0 ? `; ${formatCents(d.unallocatedCents, ctx.currency, ctx.locale)} stays not applied` : ""}.`;
      }}
    />
  );
}

// ---------------------------------------------------------------------------- Counts and books

function CountDepositAct({ act, row, ctx }: { act: Extract<Act, { kind: "count_deposit" }>; row: QueueRow; ctx: ActContext }) {
  const [ref, setRef] = useState("");
  const [total, setTotal] = useState(act.totalCents === null ? "" : (act.totalCents / 100).toFixed(2));
  return (
    <SheetAct
      buttonLabel="Record the deposit"
      title={act.label}
      family={null}
      what={
        <>
          <p className="m-0 font-bold text-ink">{row.title}</p>
          {row.lines.map((l) => (
            <p key={l} className="m-0">
              {l}
            </p>
          ))}
          <p className="m-0 mt-1">{act.what}</p>
        </>
      }
      confirmLabel={ref.trim() ? `Record deposit ${ref.trim()}` : "Record the total"}
      ctx={ctx}
      ready={ref.trim().length > 0 || total.trim().length > 0}
      onOpen={() => {
        setRef("");
        setTotal(act.totalCents === null ? "" : (act.totalCents / 100).toFixed(2));
      }}
      doing="Record the deposit"
      call={() => recordCountingDepositAction(null, fd({ id: act.id, deposit_ref: ref.trim(), total: total.trim() }))}
      done={(r) => doneFrom(r.message, "Done: deposit recorded.")}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`dep-${act.id}`} className="mb-1 block text-[13px] font-bold text-ink">
            Deposit slip or reference
          </label>
          <input id={`dep-${act.id}`} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} autoComplete="off" className="crm-input w-full" />
        </div>
        <div>
          <label htmlFor={`tot-${act.id}`} className="mb-1 block text-[13px] font-bold text-ink">
            Counted total
          </label>
          <input id={`tot-${act.id}`} value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" autoComplete="off" className="crm-input w-full" />
        </div>
      </div>
    </SheetAct>
  );
}

function CloseItem({ item, month, canMark }: { item: CloseItemView; month: string; canMark: boolean }) {
  const [done, setDone] = useState(item.done);
  const [note, setNote] = useState<string | null>(null);
  const { pending, error, run } = useRun();
  return (
    <li className="flex flex-wrap items-start gap-2 rounded-[10px] border border-line bg-white px-2.5 py-2 text-[13.5px]">
      <span className="min-w-0 flex-1">
        <span className={`font-bold ${done ? "text-success" : "text-ink"}`}>
          {done ? "✓ " : ""}
          {item.text}
        </span>
        <span className="sr-only">{done ? " (done)" : " (still to do)"}</span>
        {note ? <span className="block text-[12.5px] font-bold text-success">{note}</span> : item.why && !done ? <span className="block text-[12.5px] text-muted">{item.why}</span> : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </span>
      {!done && canMark && item.key ? (
        <button
          type="button"
          className={`${buttonClass("ghost", "xs")} min-h-[36px]`}
          disabled={pending}
          onClick={() =>
            run("Update the close checklist", () => setCloseItemAction(null, fd({ month, key: item.key!, done: "true" })), (r) => {
              setDone(true);
              setNote(doneFrom(r.message, "Done: marked done."));
            })
          }
        >
          {pending ? "Saving…" : "Mark done"}
        </button>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------- A row's actions

/** The part of a row that sits under its text: lists that act item by item (Zelle pairs, families behind, close checks). */
export function RowInline({ row, ctx }: { row: QueueRow; ctx: ActContext }) {
  return (
    <>
      {row.acts.map((a, i) => {
        if (a.kind === "zelle_exact") return <ZelleExact key={i} pairs={a.pairs} ctx={ctx} />;
        if (a.kind === "behind") {
          return (
            <ul key={i} className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
              {a.households.map((h) => (
                <BehindFamily key={h.family.id} h={h} ctx={ctx} />
              ))}
            </ul>
          );
        }
        if (a.kind === "close") {
          return (
            <ul key={i} className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
              {a.items.map((it) => (
                <CloseItem key={it.text} item={it} month={a.month} canMark={a.canMark} />
              ))}
            </ul>
          );
        }
        return null;
      })}
    </>
  );
}

/** The row's buttons, on the right on a computer and under the text on a phone. */
export function RowButtons({ row, ctx }: { row: QueueRow; ctx: ActContext }) {
  return (
    <>
      {row.acts.map((a, i) => {
        switch (a.kind) {
          case "approve":
            return <ApproveAct key={i} act={a} row={row} ctx={ctx} />;
          case "credit":
            return <CreditAct key={i} act={a} row={row} ctx={ctx} />;
          case "flagged":
            return <FlaggedAct key={i} act={a} row={row} ctx={ctx} />;
          case "complete_write_off":
            return <CompleteWriteOffAct key={i} act={a} row={row} ctx={ctx} />;
          case "record_refund":
            return <RecordRefundAct key={i} act={a} row={row} ctx={ctx} />;
          case "gift":
            return <GiftAct key={i} act={a} ctx={ctx} />;
          case "deposit":
            return <DepositAct key={i} act={a} ctx={ctx} />;
          case "apply":
            return <ApplyAct key={i} act={a} row={row} ctx={ctx} />;
          case "count_deposit":
            return <CountDepositAct key={i} act={a} row={row} ctx={ctx} />;
          case "link":
            return (
              <Link key={i} href={a.href} className={`${buttonClass(a.primary ? "primary" : "ghost", "sm")} ${SMALL}`}>
                {a.label}
              </Link>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
