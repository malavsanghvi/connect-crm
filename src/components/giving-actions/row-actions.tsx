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
  cancelWriteOffRequestAction,
  completeWriteOffAction,
  recordPaypalRefundAction,
  recordRefundAction,
  refundThroughProviderAction,
  requestRefundAction,
  requestWriteOffAction,
} from "@/app/(app)/approvals/actions";
import { openPledgesAction, type OpenPledge } from "@/app/(app)/giving/actions";
import { changePledgeDueAction } from "@/app/(app)/giving/pledges/due-date-actions";
import { grantSuggestionsAction, type GrantSuggestion } from "@/app/(app)/giving/lists-actions";
import { applyPaymentAction } from "@/app/(app)/giving/payments/actions";
import { confirmBankMatchAction, matchDepositAction } from "@/app/(app)/giving/payments/bank/actions";
import { confirmExactMatchesAction } from "@/app/(app)/giving/payments/bank/zelle-actions";
import { recordCountingDepositAction } from "@/app/(app)/giving/payments/counting-actions";
import { DonorMatchApprove } from "@/components/books/donor-match-act";
import type { CardLabels } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";
import { useStepUp } from "@/components/step-up";
import { buttonClass } from "@/components/ui";
import { previewAllocation } from "@/lib/allocation";
import { formatDate } from "@/lib/dates";
import { isRealDate } from "@/lib/giving-due";
import { familyFrom, familyLine, familyRef, type Act, type BehindView, type CloseItemView, type Family, type QueueRow, type ZellePairView } from "@/lib/giving-today/queue";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { MatchCountAct, UnmatchCountAct } from "./count-acts";
import { GiftAct } from "./gift-act";
import { RecordPaymentButton } from "./provider";
import { FamilyCard, GivingSheet, NO_UNDO } from "./sheet";

export type ActContext = {
  currency: string;
  locale: string;
  timeZone: string;
  labels: CardLabels;
  /** The row is done: it stays on the page as "Done: …" until the page is reloaded. */
  onDone: (text: string) => void;
  /** "menu": the act opens from a row menu (⋯) item instead of a button (Pledges and Payments). */
  trigger?: "button" | "menu";
  /** The community's today (YYYY-MM-DD), the default date of a refund made in PayPal. */
  today?: string;
};

/** What an act repeats from its row in its sheet: the household card, then the evidence (a Today row or a list row). */
export type RowLike = Pick<QueueRow, "family" | "title" | "lines">;

const MENU_ITEM = "flex min-h-[44px] w-full items-center rounded-[10px] px-3 py-2 text-left text-[14px] font-semibold hover:bg-canvas";

/** The button that opens an act: a small button on a row, or an item of the row menu. */
function triggerClass(ctx: ActContext, primary: boolean, tone?: "primary" | "danger"): string {
  if (ctx.trigger === "menu") return `${MENU_ITEM} ${tone === "danger" ? "text-danger" : "text-ink"}`;
  return `${buttonClass(primary ? (tone === "danger" ? "bad" : "primary") : "ghost", "sm")} ${SMALL}`;
}

type Result = { ok: boolean; error?: string; message?: string; stepUp?: boolean };

// A button that names the amount and the family can be long: it wraps instead of running off a phone screen.
export const SMALL = "min-h-[40px] max-w-full whitespace-normal py-1.5 text-center";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Run a server action: a fresh 2FA check when the database asks for one, the error in plain English otherwise. */
export function useRun() {
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

export function InlineError({ children }: { children: ReactNode }) {
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
        className={triggerClass(ctx, primary, tone)}
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

function ApproveAct({ act, row, ctx }: { act: Extract<Act, { kind: "approve" }>; row: RowLike; ctx: ActContext }) {
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

function CreditAct({ act, row, ctx }: { act: Extract<Act, { kind: "credit" }>; row: RowLike; ctx: ActContext }) {
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

function FlaggedAct({ act, row, ctx }: { act: Extract<Act, { kind: "flagged" }>; row: RowLike; ctx: ActContext }) {
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

function CompleteWriteOffAct({ act, row, ctx }: { act: Extract<Act, { kind: "complete_write_off" }>; row: RowLike; ctx: ActContext }) {
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

function RecordRefundAct({ act, row, ctx }: { act: Extract<Act, { kind: "record_refund" }>; row: RowLike; ctx: ActContext }) {
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
        else {
          const list = res.data ?? [];
          setPledges(list);
          // One open pledge: it is the one (Giving, Write off…, Ask: three clicks).
          if (list.length === 1) setPick(list[0].id);
        }
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

function ApplyAct({ act, row, ctx }: { act: Extract<Act, { kind: "apply" }>; row: RowLike; ctx: ActContext }) {
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

function CountDepositAct({ act, row, ctx }: { act: Extract<Act, { kind: "count_deposit" }>; row: RowLike; ctx: ActContext }) {
  const [ref, setRef] = useState("");
  const [total, setTotal] = useState(act.totalCents === null ? "" : (act.totalCents / 100).toFixed(2));
  return (
    <SheetAct
      buttonLabel={act.button ?? "Record the deposit"}
      primary={!act.secondary}
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
        {note ? <span className="block text-[12.5px] font-bold text-success">{note}</span> : item.why ? <span className="block text-[12.5px] text-muted">{item.why}</span> : null}
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

// ---------------------------------------------------------------------------- One pledge or one payment (Pledges and Payments)

function MoneyField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-bold text-ink">
        {label}
      </label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" autoComplete="off" className="crm-input w-full sm:w-48" />
      {hint ? <p className="m-0 mt-1 text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

function RequestWriteOffAct({ act, row, ctx }: { act: Extract<Act, { kind: "request_write_off" }>; row: RowLike; ctx: ActContext }) {
  const [reason, setReason] = useState("");
  const money = formatCents(act.openCents, ctx.currency, ctx.locale);
  return (
    <SheetAct
      buttonLabel={act.label}
      primary={false}
      tone="danger"
      title="Ask for a write-off"
      family={row.family}
      what={
        <>
          <p className="m-0 font-bold text-ink">{row.title}</p>
          <p className="m-0">A write-off needs a reason the second approver reads. Nothing changes until a different person approves it and a treasurer completes it.</p>
        </>
      }
      confirmLabel={`Ask to write off ${money} on ${act.reference} for ${familyRef(row.family)}`}
      ctx={ctx}
      ready={reason.trim().length > 0}
      onOpen={() => setReason("")}
      doing="Request the write-off"
      call={() => requestWriteOffAction(null, fd({ id: act.id, reason: reason.trim() }))}
      done={(r) => doneFrom(r.message, "Done: write-off requested.")}
    >
      <ReasonField id={`wo-${act.id}`} value={reason} onChange={setReason} label="Reason (the second approver reads it)" />
    </SheetAct>
  );
}

/** Every pledge has a due date (0775): a treasurer moves it, with a reason that shows in the family's History. No money moves. */
function ChangeDueAct({ act, row, ctx }: { act: Extract<Act, { kind: "change_due" }>; row: RowLike; ctx: ActContext }) {
  const [due, setDue] = useState(act.dueOn ?? "");
  const [reason, setReason] = useState("");
  const valid = isRealDate(due) && due >= act.pledgedOn;
  const shown = valid ? formatDate(due, ctx.timeZone) : null;
  return (
    <SheetAct
      buttonLabel={act.label}
      primary={false}
      title="Change the due date"
      family={row.family}
      what={
        <>
          <p className="m-0 font-bold text-ink">{row.title}</p>
          <p className="m-0">
            {act.dueOn ? `Due now on ${formatDate(act.dueOn, ctx.timeZone)}.` : "It has no due date yet."} No money moves. The new date and your reason show in
            the family&apos;s History, and the pledge counts as behind from the new date.
          </p>
        </>
      }
      confirmLabel={shown ? `Make ${act.reference} due on ${shown}` : "Choose the new due date"}
      ctx={ctx}
      ready={valid && due !== act.dueOn && reason.trim().length >= 3}
      onOpen={() => {
        setDue(act.dueOn ?? "");
        setReason("");
      }}
      doing="Change the due date"
      call={() => changePledgeDueAction({ pledgeId: act.id, dueOn: due, reason: reason.trim() })}
      done={(r) => doneFrom(r.message, "Done: due date changed.")}
    >
      <div>
        <label htmlFor={`due-${act.id}`} className="mb-1 block text-[13px] font-bold text-ink">
          New due date
        </label>
        <input
          id={`due-${act.id}`}
          type="date"
          min={act.pledgedOn}
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="crm-input min-h-[44px] w-full"
        />
        {due && isRealDate(due) && due < act.pledgedOn ? <InlineError>The due date cannot be before the day it was pledged.</InlineError> : null}
      </div>
      <ReasonField id={`due-why-${act.id}`} value={reason} onChange={setReason} label="Reason (shows in the family's History)" />
    </SheetAct>
  );
}

function WithdrawWriteOffAct({ act, row, ctx }: { act: Extract<Act, { kind: "withdraw_write_off" }>; row: RowLike; ctx: ActContext }) {
  return (
    <SheetAct
      buttonLabel={act.label}
      primary={false}
      title="Withdraw the write-off request"
      family={row.family}
      what={
        <>
          <p className="m-0 font-bold text-ink">{row.title}</p>
          <p className="m-0">The pledge stays open, as it was before anyone asked. No money moves.</p>
        </>
      }
      confirmLabel={`Withdraw the request on ${act.reference}`}
      ctx={ctx}
      doing="Withdraw the write-off request"
      call={() => cancelWriteOffRequestAction(null, fd({ id: act.id }))}
      done={(r) => doneFrom(r.message, "Done: write-off request withdrawn.")}
    />
  );
}

function RequestRefundAct({ act, row, ctx }: { act: Extract<Act, { kind: "request_refund" }>; row: RowLike; ctx: ActContext }) {
  const initial = (act.refundableCents / 100).toFixed(2);
  const [amount, setAmount] = useState(initial);
  const [reason, setReason] = useState("");
  const cents = parseAmountToCents(amount);
  const most = formatCents(act.refundableCents, ctx.currency, ctx.locale);
  const fits = cents !== null && cents > 0 && cents <= act.refundableCents;
  return (
    <SheetAct
      buttonLabel={act.label}
      primary={false}
      tone="danger"
      title="Ask for a refund"
      family={row.family}
      what={
        <>
          <p className="m-0 font-bold text-ink">{row.title}</p>
          <p className="m-0">A refund needs a reason the second approver reads. Nothing changes until a different person approves it; then a treasurer records it.</p>
        </>
      }
      confirmLabel={fits && cents !== null ? `Ask to refund ${formatCents(cents, ctx.currency, ctx.locale)} to ${familyRef(row.family)}` : `Enter an amount up to ${most}`}
      ctx={ctx}
      ready={fits && reason.trim().length > 0}
      onOpen={() => {
        setAmount(initial);
        setReason("");
      }}
      doing="Request the refund"
      call={() => requestRefundAction(null, fd({ id: act.id, amount: amount.trim(), reason: reason.trim() }))}
      done={(r) => doneFrom(r.message, "Done: refund requested.")}
    >
      <MoneyField id={`rfa-${act.id}`} label="Amount to refund" value={amount} onChange={setAmount} hint={`At most ${most} of ${act.reference} can be refunded.`} />
      <ReasonField id={`rfr-${act.id}`} value={reason} onChange={setReason} label="Reason (the second approver reads it)" />
    </SheetAct>
  );
}

function ProviderRefundAct({ act, row, ctx }: { act: Extract<Act, { kind: "provider_refund" }>; row: RowLike; ctx: ActContext }) {
  const name = act.provider === "paypal" ? "PayPal" : "Stripe";
  return (
    <SheetAct
      buttonLabel={act.label}
      tone="danger"
      title={`Refund through ${name}`}
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
      doing="Send the refund"
      call={() => refundThroughProviderAction(null, fd({ id: act.id }))}
      done={(r) => doneFrom(r.message, `Done: refund sent to ${name}.`)}
    />
  );
}

function PaypalRefundAct({ act, row, ctx }: { act: Extract<Act, { kind: "paypal_refund" }>; row: RowLike; ctx: ActContext }) {
  const initial = (act.amountCents / 100).toFixed(2);
  const [amount, setAmount] = useState(initial);
  const [on, setOn] = useState(ctx.today ?? "");
  const [txn, setTxn] = useState("");
  const [reason, setReason] = useState(act.reason ?? "");
  const cents = parseAmountToCents(amount);
  const ok = cents !== null && cents > 0 && /^\d{4}-\d{2}-\d{2}$/.test(on) && txn.trim().length > 0;
  return (
    <SheetAct
      buttonLabel={act.label}
      tone="danger"
      title="Record the refund made in PayPal"
      family={row.family}
      what={
        <>
          <p className="m-0 font-bold text-ink">{row.title}</p>
          <p className="m-0">{act.what}</p>
        </>
      }
      confirmLabel={cents !== null && cents > 0 ? `Record ${formatCents(cents, ctx.currency, ctx.locale)} PayPal refund for ${familyRef(row.family)}` : "Enter the amount refunded"}
      ctx={ctx}
      ready={ok}
      onOpen={() => {
        setAmount(initial);
        setOn(ctx.today ?? "");
        setTxn("");
        setReason(act.reason ?? "");
      }}
      doing="Record the PayPal refund"
      call={() => recordPaypalRefundAction(null, fd({ id: act.id, amount: amount.trim(), refunded_on: on, paypal_txn: txn.trim(), reason: reason.trim() }))}
      done={(r) => doneFrom(r.message, "Done: PayPal refund recorded.")}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField id={`ppa-${act.id}`} label="Amount refunded in PayPal" value={amount} onChange={setAmount} />
        <div>
          <label htmlFor={`ppd-${act.id}`} className="mb-1 block text-[13px] font-bold text-ink">
            Date PayPal made the refund
          </label>
          <input id={`ppd-${act.id}`} type="date" value={on} onChange={(e) => setOn(e.target.value)} className="crm-input w-full" />
        </div>
      </div>
      <div>
        <label htmlFor={`ppt-${act.id}`} className="mb-1 block text-[13px] font-bold text-ink">
          PayPal transaction id of the refund
        </label>
        <input id={`ppt-${act.id}`} value={txn} onChange={(e) => setTxn(e.target.value)} maxLength={30} autoComplete="off" className="crm-input w-full font-mono" />
      </div>
      <ReasonField id={`ppr-${act.id}`} value={reason} onChange={setReason} label="Reason" />
    </SheetAct>
  );
}

const GRANT_WORD: Record<Extract<Act, { kind: "grant_match" }>["grant"], string> = {
  daf: "fund grant",
  matching_gift: "matching gift",
  payroll_giving: "payroll gift",
};

/** A fund grant or matching gift from the bank, matched to a family: the former DAF drawer as a sheet. The payer is never learned. */
function GrantMatchAct({ act, ctx }: { act: Extract<Act, { kind: "grant_match" }>; ctx: ActContext }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<GrantSuggestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<Family | null>(null);
  const [picking, setPicking] = useState(false);
  const [pledges, setPledges] = useState<OpenPledge[] | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const { pending, error, setError, run } = useRun();
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const amount = money(act.amountCents);

  function choose(f: Family) {
    setPick(f);
    setPicking(false);
    setPledges(null);
    setPledgeError(null);
    startLoading(async () => {
      try {
        const res = await openPledgesAction(f.id);
        if (!res.ok) setPledgeError(res.error);
        else setPledges(res.data ?? []);
      } catch (err) {
        console.error("[giving-lists] loading the family's pledges failed:", err);
        setPledgeError("Could not load the family's open pledges: the server did not respond. Choose the family again.");
      }
    });
  }

  function openSheet() {
    setOpen(true);
    setError(null);
    setPick(null);
    setPicking(false);
    setPledges(null);
    setSuggestions(null);
    setLoadError(null);
    startLoading(async () => {
      try {
        const res = await grantSuggestionsAction(act.txnId);
        if (!res.ok) {
          setLoadError(res.error);
          setSuggestions([]);
          return;
        }
        const list = res.data ?? [];
        setSuggestions(list);
        const first = list.find((s) => !s.ambiguous);
        if (first) choose(first.family);
      } catch (err) {
        console.error("[giving-lists] loading the suggested families failed:", err);
        setLoadError("Could not load the suggested families: the server did not respond. Find the family below.");
        setSuggestions([]);
      }
    });
  }

  const preview = pledges ? previewAllocation(act.amountCents, pledges) : null;
  const byId = new Map((pledges ?? []).map((p) => [p.id, p]));
  return (
    <>
      <button type="button" className={triggerClass(ctx, true)} onClick={openSheet}>
        {act.label}
      </button>
      {open ? (
        <GivingSheet
          title={`Which family is the ${GRANT_WORD[act.grant]} of ${amount} for?`}
          family={pick}
          labels={ctx.labels}
          what={
            <>
              <p className="m-0 font-bold text-ink">
                {act.reference} · from {act.source} · {formatDate(act.postedOn, ctx.timeZone)}
              </p>
              {act.memo ? <p className="m-0">{act.memo}</p> : null}
              <p className="m-0 mt-1">
                It is recorded as the family&apos;s gift and applied to their earliest open pledges.{" "}
                {act.grant === "matching_gift" ? "No tax receipt: the matching platform receipts its donor." : "No tax receipt: the fund's sponsor receipts the donor."} The
                sender&apos;s name is not learned, because it is not the family. {NO_UNDO}
              </p>
            </>
          }
          error={error ?? loadError ?? pledgeError}
          confirmLabel={pick ? `Record ${amount} ${GRANT_WORD[act.grant]} for ${familyRef(pick)}` : "Choose the family"}
          confirmDisabled={!pick || loading}
          pending={pending}
          onClose={() => setOpen(false)}
          onConfirm={() =>
            pick &&
            run(
              "Match the gift",
              () => confirmBankMatchAction({ txnId: act.txnId, householdId: pick.id, pledgeIds: null, learnPayer: false }),
              (r) => {
                setOpen(false);
                const d = r.data;
                ctx.onDone(d ? `Done: ${money(d.amountCents)} matched to ${d.householdName}, receipt ${d.receiptNumber ?? "pending"}.` : `Done: ${amount} matched to ${familyRef(pick)}.`);
              },
            )
          }
        >
          {loading && !suggestions ? <p className="m-0 text-[13px] text-muted">Looking for the family…</p> : null}
          {suggestions && suggestions.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-[13px] font-bold text-ink">Suggested families</legend>
              {suggestions.map((s) => (
                <label key={s.family.id} className="flex cursor-pointer items-start gap-2.5">
                  <input type="radio" name={`grant-${act.txnId}`} className="mt-3 h-[18px] w-[18px] flex-none" checked={pick?.id === s.family.id} onChange={() => choose(s.family)} />
                  <span className="min-w-0 flex-1">
                    <FamilyCard family={s.family} labels={ctx.labels}>
                      <p className="m-0 mt-1 text-[12.5px] text-ink-2">
                        {s.reason}
                        {s.ambiguous ? " · several families match: check the details" : ""}
                      </p>
                    </FamilyCard>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : suggestions ? (
            <p className="m-0 text-[13px] text-muted">No family is suggested. Find it by name or any number below.</p>
          ) : null}
          {picking ? (
            <HouseholdPicker
              labels={ctx.labels}
              timeZone={ctx.timeZone}
              currency={ctx.currency}
              onSelect={(card) => choose(familyFrom(card))}
              idPrefix={`grant-${act.txnId.slice(0, 6)}`}
            />
          ) : (
            <button type="button" className={`${buttonClass("ghost", "sm")} ${SMALL} self-start`} onClick={() => setPicking(true)}>
              Find another family
            </button>
          )}
          {pick && preview ? (
            <div className="rounded-[12px] border border-line px-3 py-2 text-[13.5px]">
              <p className="m-0 mb-1 font-bold text-ink">Where it goes</p>
              {preview.lines.length === 0 ? <p className="m-0 text-muted">No open pledge: it stays a general gift.</p> : null}
              {preview.lines.map((l) => (
                <p key={l.pledge_id} className="m-0 flex justify-between gap-3">
                  <span>{byId.get(l.pledge_id)?.pledge_number ?? "A pledge"}</span>
                  <span className="whitespace-nowrap font-bold tabular-nums">{money(l.amount_cents)}</span>
                </p>
              ))}
              {preview.unallocated_cents > 0 ? (
                <p className="m-0 flex justify-between gap-3 text-muted">
                  <span>Left as a general gift</span>
                  <span className="whitespace-nowrap tabular-nums">{money(preview.unallocated_cents)}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </GivingSheet>
      ) : null}
    </>
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
        if (a.kind === "qbo_match") return <DonorMatchApprove key={i} matchId={a.matchId} label={a.label} onDone={ctx.onDone} />;
        return null;
      })}
    </>
  );
}

/** The row's buttons, on the right on a computer and under the text on a phone. */
export function RowButtons({ row, ctx }: { row: QueueRow; ctx: ActContext }) {
  return <ActButtons acts={row.acts} row={row} ctx={ctx} />;
}

/**
 * Any list of acts with its row's evidence: Today's row buttons, a list row's buttons, or its menu items (ctx.trigger "menu").
 * Pledges, Payments and (later) the Family page draw their rows with this, so a row acts the same everywhere.
 */
export function ActButtons({ acts, row, ctx }: { acts: readonly Act[]; row: RowLike; ctx: ActContext }) {
  return (
    <>
      {acts.map((a, i) => {
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
          case "count_match":
            return <MatchCountAct key={i} act={a} row={row} ctx={ctx} />;
          case "count_unmatch":
            return <UnmatchCountAct key={i} act={a} row={row} ctx={ctx} />;
          case "request_write_off":
            return <RequestWriteOffAct key={i} act={a} row={row} ctx={ctx} />;
          case "withdraw_write_off":
            return <WithdrawWriteOffAct key={i} act={a} row={row} ctx={ctx} />;
          case "change_due":
            return <ChangeDueAct key={i} act={a} row={row} ctx={ctx} />;
          case "request_refund":
            return <RequestRefundAct key={i} act={a} row={row} ctx={ctx} />;
          case "provider_refund":
            return <ProviderRefundAct key={i} act={a} row={row} ctx={ctx} />;
          case "paypal_refund":
            return <PaypalRefundAct key={i} act={a} row={row} ctx={ctx} />;
          case "grant_match":
            return <GrantMatchAct key={i} act={a} ctx={ctx} />;
          case "link":
            return (
              <Link
                key={i}
                href={a.href}
                className={ctx.trigger === "menu" ? `${MENU_ITEM} text-ink no-underline` : `${buttonClass(a.primary ? "primary" : "ghost", "sm")} ${SMALL}`}
              >
                {a.label}
              </Link>
            );
          case "record_payment":
            // The Record payment sheet in place, with the family's card read first; the screen's address where no sheet can open.
            return (
              <RecordPaymentButton
                key={i}
                householdId={a.householdId}
                href={a.href}
                className={ctx.trigger === "menu" ? `${MENU_ITEM} text-ink no-underline` : `${buttonClass("ghost", "sm")} ${SMALL}`}
              >
                {a.label}
              </RecordPaymentButton>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
