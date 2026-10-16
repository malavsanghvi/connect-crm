"use client";

// Giving › Bank › Reconcile (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 5.7; prototype Reconcile.dc.html). A PREVIEW of the
// statement: every unmatched incoming line was first tried against payments already recorded, waiting proofs and members' Zelle
// reports, and only then against open pledges. Reading it writes nothing. Each row says what it is and, in words, what applying it
// does; one click applies one row through the same action a person would use (attach, approve with the line, confirm). The Certain
// rows can be applied together: the screen calls the same per-row action one row at a time and reports each result, and the database
// checks each row again. Nothing here writes money on a timer.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  attachBankLineAction,
  confirmBankMatchAction,
} from "@/app/(app)/giving/payments/bank/actions";
import {
  approveProofWithBankLineAction,
  loadReconcileAction,
  lookalikeOptionsAction,
  type LookalikePayment,
  type LookalikeProof,
} from "@/app/(app)/giving/payments/bank/reconcile-actions";
import { GivingSheet } from "@/components/giving-actions/sheet";
import type { CardLabels } from "@/components/household-card";
import { Badge, buttonClass } from "@/components/ui";
import { batchSummary, groupLines, isBatchEligible, kindWord, rowAction, TIER_WORD, type BatchOutcome, type Candidate, type RowAction, type StatementLine } from "@/lib/bank-reconcile/model";
import { formatDate } from "@/lib/dates";
import type { ReconcileModel } from "@/lib/data/giving-reconcile";
import { BANK_CHANNEL_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { familyLine, familyRef } from "@/lib/giving-today/queue";
import { formatCents } from "@/lib/money";

type OkModel = Extract<ReconcileModel, { state: "ok" }>;
type Outcome = { ok: boolean; text: string };

const TIER_TONE = { A: "success", B: "success", C: "warning", D: "danger" } as const;
const MIN_REASON = 5;

type Loaded = { s: "loading" } | { s: "no_access" } | { s: "error"; error: string } | { s: "ok"; model: OkModel };

/**
 * The preview is read when this view opens (and again on "Refresh the preview"), by a server action, NOT while the page renders: every
 * row that is applied refreshes the page, and the whole preview must not be worked out again after each one.
 */
export function ReconcileView({
  accountId,
  labels,
  currency,
  locale,
  timeZone,
  canConfirm,
}: {
  accountId: string | null;
  labels: CardLabels;
  currency: string;
  locale: string;
  timeZone: string;
  canConfirm: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ s: "loading" });
  const [round, setRound] = useState(0);
  const load = useCallback(async (): Promise<Loaded> => {
    try {
      const r = await loadReconcileAction({ accountId });
      if (!r.ok || !r.data) return { s: "error", error: r.ok ? "Could not read the reconciliation preview — nothing came back." : r.error };
      const m = r.data;
      return m.state === "ok" ? { s: "ok", model: m } : m.state === "no_access" ? { s: "no_access" } : { s: "error", error: m.error };
    } catch (err) {
      console.error("[bank] loading the reconciliation preview failed:", err);
      return { s: "error", error: "Could not read the reconciliation preview — the server did not respond. Try again." };
    }
  }, [accountId]);
  useEffect(() => {
    let live = true;
    void load().then((l) => {
      if (live) setLoaded(l);
    });
    return () => {
      live = false;
    };
  }, [load, round]);

  const again = (
    <button
      type="button"
      className={`${buttonClass("ghost", "sm")} min-h-[40px]`}
      onClick={() => {
        setLoaded({ s: "loading" });
        setRound((n) => n + 1);
      }}
    >
      Refresh the preview
    </button>
  );
  if (loaded.s === "loading") return <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-muted">Reading the statement and trying each line against what is recorded…</p>;
  if (loaded.s === "no_access") return <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-ink">You don&apos;t have access to this area.</p>;
  if (loaded.s === "error")
    return (
      <div role="alert" className="rounded-field border border-danger/30 bg-danger-50 px-3 py-3 text-[14px] text-danger">
        <p className="m-0">{loaded.error}</p>
        <div className="mt-2">{again}</div>
      </div>
    );
  return <ReconcileBody key={round} model={loaded.model} labels={labels} currency={currency} locale={locale} timeZone={timeZone} canConfirm={canConfirm} refresh={again} />;
}

/** The preview once it is read (exported for the render test). */
export function ReconcileBody({
  model,
  labels,
  currency,
  locale,
  timeZone,
  canConfirm,
  refresh,
}: {
  model: OkModel;
  labels: CardLabels;
  currency: string;
  locale: string;
  timeZone: string;
  canConfirm: boolean;
  refresh: ReactNode;
}) {
  const money = (c: number) => formatCents(c, currency, locale);
  const groups = groupLines(model.lines);
  const [done, setDone] = useState<Record<string, Outcome>>({});
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(model.lines.filter(isBatchEligible).map((l) => l.id)));
  const [batch, setBatch] = useState<{ running: boolean; outcomes: BatchOutcome[] } | null>(null);
  const busy = useRef(new Set<string>());

  async function apply(line: StatementLine, c: Candidate, action: RowAction, extra?: { reason?: string }): Promise<Outcome> {
    if (busy.current.has(line.id)) return { ok: false, text: "That row is already being applied." };
    busy.current.add(line.id);
    try {
      const r = await runAction(line, c, action, extra);
      if (r.ok) setDone((d) => ({ ...d, [line.id]: r }));
      return r;
    } finally {
      busy.current.delete(line.id);
    }
  }

  async function applyBatch() {
    const rows = model.lines.filter((l) => ticked.has(l.id) && isBatchEligible(l) && !done[l.id]);
    setBatch({ running: true, outcomes: [] });
    const outcomes: BatchOutcome[] = [];
    // One row at a time, in the order shown: each is its own transaction in the database, checked again as it runs.
    for (const line of rows) {
      const c = line.candidates[0];
      const action = rowAction(c, model.refKinds[c.refId ?? ""] ?? null, line, currency, locale);
      const r = await apply(line, c, action);
      outcomes.push({ lineId: line.id, ok: r.ok, message: r.text });
      setBatch({ running: true, outcomes: [...outcomes] });
    }
    setBatch({ running: false, outcomes });
  }

  if (model.lines.length === 0) {
    return (
      <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-muted">
        Every incoming line on this account is matched or set aside. Nothing is waiting to be reconciled.
        <span className="ml-2">{refresh}</span>
      </p>
    );
  }

  const summary = batch && !batch.running ? batchSummary(batch.outcomes) : null;
  return (
    <div className="flex flex-col gap-4" data-testid="reconcile-view">
      <div className="rounded-field border border-line bg-ground px-3 py-2 text-[14px] text-ink">
        <strong>
          {model.lines.length} incoming {model.lines.length === 1 ? "line" : "lines"} on this account.
        </strong>{" "}
        <strong>Nothing has been written.</strong> Each line was first tried against payments already recorded, waiting proofs and Zelle reports, and only then against open
        pledges. Review each row and apply what is right.
        {model.lines.length >= model.limit ? ` The preview shows the newest ${model.limit} lines; apply some and refresh to see the rest.` : ""}
        <span className="ml-2 inline-block">{refresh}</span>
      </div>
      {model.problems.map((p) => (
        <p key={p} role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {p}
        </p>
      ))}
      <nav aria-label="Groups" className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <a key={g.key} href={`#reconcile-${g.key}`} className="rounded-full bg-subtle px-3 py-1 text-[13px] font-semibold text-ink">
            {g.title} {g.lines.length}
          </a>
        ))}
      </nav>

      {groups.map((g) => {
        const eligible = g.lines.filter((l) => isBatchEligible(l) && !done[l.id]);
        const tickedHere = eligible.filter((l) => ticked.has(l.id));
        return (
          <section key={g.key} id={`reconcile-${g.key}`} aria-labelledby={`h-${g.key}`} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <h2 id={`h-${g.key}`} className="m-0 text-[18px] font-bold text-ink">
                  {g.title} <span className="text-muted">({g.lines.length})</span>
                </h2>
                <p className="m-0 max-w-3xl text-[13px] text-muted">{g.desc}</p>
              </div>
              {g.batch && canConfirm ? (
                <button
                  type="button"
                  className={`${buttonClass("primary", "sm")} min-h-[44px]`}
                  disabled={batch?.running === true || tickedHere.length === 0}
                  onClick={applyBatch}
                >
                  {batch?.running ? "Applying…" : `Apply the ticked Certain rows (${tickedHere.length})`}
                </button>
              ) : null}
            </div>
            {g.batch && summary ? (
              <div role="status" className={`rounded-field border px-3 py-2 text-[13.5px] ${summary.failed > 0 ? "border-danger/30 bg-danger-50 text-danger" : "border-success/30 bg-success-50 text-ink"}`}>
                {summary.text}
              </div>
            ) : null}
            {g.lines.map((l) => (
              <LineCard
                key={l.id}
                line={l}
                model={model}
                labels={labels}
                currency={currency}
                locale={locale}
                timeZone={timeZone}
                canConfirm={canConfirm}
                outcome={done[l.id] ?? null}
                batchOutcome={batch?.outcomes.find((o) => o.lineId === l.id) ?? null}
                tickable={g.batch && eligible.some((e) => e.id === l.id)}
                ticked={ticked.has(l.id)}
                onTick={(on) =>
                  setTicked((t) => {
                    const n = new Set(t);
                    if (on) n.add(l.id);
                    else n.delete(l.id);
                    return n;
                  })
                }
                apply={apply}
                money={money}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------- Running one row

/** One row, through the same action a person would use. Each one asks the database again; nothing is assumed from the preview. */
async function runAction(line: StatementLine, c: Candidate, action: RowAction, extra?: { reason?: string }): Promise<Outcome> {
  try {
    if (action.type === "attach") {
      const r = await attachBankLineAction({ txnId: line.id, paymentId: action.paymentId });
      return r.ok ? { ok: true, text: r.message ?? "Attached." } : { ok: false, text: r.error };
    }
    if (action.type === "approve") {
      const r = await approveProofWithBankLineAction({ proofId: action.proofId, txnId: line.id, ...(extra?.reason ? { separateReason: extra.reason } : {}) });
      // First approval only: the line is NOT attached yet, so the row stays and says why.
      if (r.ok && r.data?.state === "first_approved") return { ok: false, text: r.message ?? "First approval recorded; a second person must approve." };
      return r.ok ? { ok: true, text: r.message ?? "Approved and reconciled." } : { ok: false, text: r.error };
    }
    if (action.type === "conflict_proof") {
      const r = await approveProofWithBankLineAction({ proofId: action.proofId, txnId: line.id, amountCents: line.amountCents, note: extra?.reason ?? "" });
      if (r.ok && r.data?.state === "first_approved") return { ok: false, text: r.message ?? "First approval recorded; a second person must approve." };
      return r.ok ? { ok: true, text: r.message ?? "Approved at the bank's amount and reconciled." } : { ok: false, text: r.error };
    }
    if (action.type === "confirm") {
      const r = await confirmBankMatchAction({
        txnId: line.id,
        householdId: action.householdId,
        pledgeIds: null,
        learnPayer: true,
        reportId: action.reportId,
        ...(extra?.reason ? { separateReason: extra.reason } : {}),
      });
      return r.ok ? { ok: true, text: r.message ?? "Confirmed." } : { ok: false, text: r.error };
    }
    return { ok: false, text: action.type === "none" ? action.why : "This row needs a choice first." };
  } catch (err) {
    console.error("[bank] applying a reconcile row failed:", err);
    return { ok: false, text: `Could not apply the ${c.kind.replace(/_/g, " ")} row — the server did not respond. Reload the page to see whether it went through before trying again.` };
  }
}

// ---------------------------------------------------------------------------- A line and its candidates

function LineCard({
  line,
  model,
  labels,
  currency,
  locale,
  timeZone,
  canConfirm,
  outcome,
  batchOutcome,
  tickable,
  ticked,
  onTick,
  apply,
  money,
}: {
  line: StatementLine;
  model: OkModel;
  labels: CardLabels;
  currency: string;
  locale: string;
  timeZone: string;
  canConfirm: boolean;
  outcome: Outcome | null;
  batchOutcome: BatchOutcome | null;
  tickable: boolean;
  ticked: boolean;
  onTick: (on: boolean) => void;
  apply: (line: StatementLine, c: Candidate, action: RowAction, extra?: { reason?: string }) => Promise<Outcome>;
  money: (c: number) => string;
}) {
  if (outcome?.ok) {
    return (
      <div role="status" className="rounded-field border border-success/30 bg-success-50 px-3 py-2 text-[14px] text-ink">
        <strong className="tabular-nums">{money(line.amountCents)}</strong> · {formatDate(line.postedOn, timeZone)} · Done: {outcome.text}
      </div>
    );
  }
  return (
    <div className="rounded-field border border-line bg-white px-3 py-3" data-testid="reconcile-line">
      <div className="flex flex-wrap items-start gap-3">
        {tickable ? (
          <label className="flex min-h-[40px] items-center">
            <input type="checkbox" className="h-5 w-5" checked={ticked} onChange={(e) => onTick(e.target.checked)} aria-label={`Include the ${money(line.amountCents)} line in the batch`} />
          </label>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-baseline gap-x-3">
            <strong className="font-display text-[22px] tabular-nums text-ink">{money(line.amountCents)}</strong>
            <span className="text-[13px] text-muted">{formatDate(line.postedOn, timeZone)}</span>
            {line.channel ? <Badge tone="navy">{BANK_CHANNEL_LABEL[line.channel] ?? line.channel}</Badge> : null}
          </p>
          <p className="m-0 break-words font-mono text-[13px] text-ink">{line.description}</p>
          {line.payerName || line.reference ? (
            <p className="m-0 text-[13px] text-muted">
              {line.payerName ? `Payer ${line.payerName}` : ""}
              {line.payerName && line.reference ? " · " : ""}
              {line.reference ? `Reference ${line.reference}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      {batchOutcome && !batchOutcome.ok ? (
        <p role="alert" className="m-0 mt-2 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          Not applied: {batchOutcome.message}
        </p>
      ) : null}
      {line.candidates.length === 0 ? (
        <p className="m-0 mt-2 text-[14px] text-muted">
          No family, payment or proof explains this line.{" "}
          <Link href="/giving/payments/bank" className="crm-link font-semibold">
            Match it by hand in Gifts to match
          </Link>
          .
        </p>
      ) : (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {line.candidates.map((c, i) => (
            <CandidateRow
              key={`${c.kind}-${c.refId ?? c.householdId}-${i}`}
              line={line}
              c={c}
              model={model}
              labels={labels}
              currency={currency}
              locale={locale}
              timeZone={timeZone}
              canConfirm={canConfirm}
              apply={apply}
              money={money}
              only={line.candidates.length === 1}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateRow({
  line,
  c,
  model,
  labels,
  currency,
  locale,
  timeZone,
  canConfirm,
  apply,
  money,
  only,
}: {
  line: StatementLine;
  c: Candidate;
  model: OkModel;
  labels: CardLabels;
  currency: string;
  locale: string;
  timeZone: string;
  canConfirm: boolean;
  apply: (line: StatementLine, c: Candidate, action: RowAction, extra?: { reason?: string }) => Promise<Outcome>;
  money: (c: number) => string;
  only: boolean;
}) {
  const family = model.families[c.householdId] ?? null;
  const action = rowAction(c, model.refKinds[c.refId ?? ""] ?? null, line, currency, locale);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"reason" | "lookalike" | null>(null);
  const [reason, setReason] = useState("");
  // The database refused a second payment (SQLSTATE CCDUP): from then on the row also offers "A different gift (say why)".
  const [offerReason, setOfferReason] = useState(false);

  async function go(a: RowAction, extra?: { reason?: string }) {
    setError(null);
    setPending(true);
    const r = await apply(line, c, a, extra);
    setPending(false);
    if (!r.ok) {
      setError(r.text);
      if (/separate gift|different gift|lookalike/i.test(r.text)) setOfferReason(true);
    } else setSheet(null);
  }

  // The reason sheet: a typed reason is what lets a row go ahead (a different gift, or the bank's amount when it differs).
  const needsReason = action.type === "conflict_proof";
  const reasonValid = reason.trim().length >= MIN_REASON;

  return (
    <li className="rounded-field border border-line bg-canvas px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TIER_TONE[c.tier]}>{c.kind === "lookalike" || c.kind === "conflict" ? kindWord(c.kind) : TIER_WORD[c.tier]}</Badge>
        {c.kind !== "lookalike" && c.kind !== "conflict" ? <span className="text-[13px] font-semibold text-ink">{kindWord(c.kind)}</span> : null}
      </div>
      <p className="m-0 mt-1 text-[14px] font-semibold text-ink">
        {family ? (
          <>
            <Link href={`/households/${family.id}?tab=payments`} className="crm-link">
              {familyRef(family)}
            </Link>
            <span className="block text-[13px] font-normal text-muted">{familyLine(family, labels)}</span>
          </>
        ) : (
          (c.householdName ?? "Family")
        )}
      </p>
      <p className="m-0 mt-1 text-[14px] text-ink">{c.label}</p>
      <p className="m-0 mt-1 text-[13.5px] text-ink">
        <strong>If you apply:</strong> {c.consequence}
      </p>
      {c.reasons.length > 0 ? (
        <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0">
          {c.reasons.map((r) => (
            <li key={r} className="rounded-full bg-subtle px-2.5 py-0.5 text-[12.5px] text-ink">
              {r}
            </li>
          ))}
        </ul>
      ) : null}
      {!only ? <p className="m-0 mt-1 text-[12.5px] text-muted">One of several candidates for this line: you choose.</p> : null}
      {error ? (
        <p role="alert" className="m-0 mt-2 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {canConfirm ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {action.type === "attach" || action.type === "approve" || action.type === "confirm" ? (
            <button type="button" className={`${buttonClass("primary", "sm")} min-h-[44px]`} disabled={pending} onClick={() => go(action)}>
              {pending ? "Applying…" : action.label}
            </button>
          ) : null}
          {action.type === "conflict_proof" ? (
            <button type="button" className={`${buttonClass("primary", "sm")} min-h-[44px]`} disabled={pending} onClick={() => setSheet("reason")}>
              {action.label}
            </button>
          ) : null}
          {action.type === "conflict_payment" ? (
            <p className="m-0 text-[13px] text-muted">
              The recorded payment has a different amount, so nothing is attached. Correct the payment first{family ? " on the family's page" : ""}, then attach the line. The bank is the truth.
              {family ? (
                <>
                  {" "}
                  <Link href={`/households/${family.id}?tab=payments`} className="crm-link font-semibold">
                    Open the family
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}
          {action.type === "lookalike" ? (
            <>
              <button type="button" className={`${buttonClass("primary", "sm")} min-h-[44px]`} onClick={() => setSheet("lookalike")}>
                See what it matches
              </button>
              <button type="button" className={`${buttonClass("ghost", "sm")} min-h-[44px]`} onClick={() => setSheet("reason")}>
                A different gift (say why)
              </button>
            </>
          ) : null}
          {offerReason && (action.type === "approve" || action.type === "confirm") ? (
            <button type="button" className={`${buttonClass("ghost", "sm")} min-h-[44px]`} onClick={() => setSheet("reason")}>
              A different gift (say why)
            </button>
          ) : null}
          {action.type === "none" ? <p className="m-0 text-[13px] text-muted">{action.why}</p> : null}
        </div>
      ) : (
        <p className="m-0 mt-2 text-[13px] text-muted">Applying a row needs giving.record_offline or giving.manage.</p>
      )}

      {sheet === "reason" ? (
        <GivingSheet
          title={needsReason ? `Record ${money(line.amountCents)} and reconcile` : `Record ${money(line.amountCents)} as a separate gift`}
          family={family}
          labels={labels}
          what={
            needsReason
              ? "The bank is the truth: the proof is approved at the amount the bank shows, the rest of the pledge stays open, and the family is told. Say why the amount differs."
              : "A payment is created only because you say this is a different gift from the one already recorded. The reason is kept in the audit log."
          }
          error={error}
          confirmLabel={needsReason ? "Approve and reconcile" : `Record ${money(line.amountCents)} as a separate gift`}
          pendingLabel="Applying…"
          pending={pending}
          confirmDisabled={!reasonValid}
          onClose={() => setSheet(null)}
          onConfirm={() =>
            go(
              needsReason || action.type === "approve"
                ? action
                : { type: "confirm", householdId: c.householdId, reportId: action.type === "confirm" ? action.reportId : null, label: "Confirm" },
              { reason: reason.trim() },
            )
          }
        >
          <label htmlFor={`why-${line.id}-${c.householdId}`} className="mb-1 block text-[13px] font-bold text-ink">
            Why
          </label>
          <textarea
            id={`why-${line.id}-${c.householdId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className="crm-input w-full"
            placeholder={needsReason ? "For example: the check was written for $180, not $200" : "For example: a second gift for the building fund, not the check already recorded"}
          />
          <p className="m-0 mt-1 text-[12.5px] text-muted">At least {MIN_REASON} characters.</p>
        </GivingSheet>
      ) : null}
      {sheet === "lookalike" ? (
        <LookalikeSheet line={line} c={c} family={family} labels={labels} currency={currency} locale={locale} timeZone={timeZone} onClose={() => setSheet(null)} apply={apply} money={money} />
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------- Lookalike: attach to what it looks like

function LookalikeSheet({
  line,
  c,
  family,
  labels,
  currency,
  locale,
  timeZone,
  onClose,
  apply,
  money,
}: {
  line: StatementLine;
  c: Candidate;
  family: OkModel["families"][string] | null;
  labels: CardLabels;
  currency: string;
  locale: string;
  timeZone: string;
  onClose: () => void;
  apply: (line: StatementLine, c: Candidate, action: RowAction, extra?: { reason?: string }) => Promise<Outcome>;
  money: (c: number) => string;
}) {
  const [state, setState] = useState<
    { s: "loading" } | { s: "error"; error: string } | { s: "ok"; payments: LookalikePayment[]; proofs: LookalikeProof[] }
  >({ s: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await lookalikeOptionsAction({ txnId: line.id, householdId: c.householdId });
        if (live) setState(r.ok && r.data ? { s: "ok", payments: r.data.payments, proofs: r.data.proofs } : { s: "error", error: r.ok ? "Could not look up the payment it looks like — nothing came back." : r.error });
      } catch (err) {
        console.error("[bank] looking up the lookalike failed:", err);
        if (live) setState({ s: "error", error: "Could not look up the payment it looks like — the server did not respond. Close this and try again." });
      }
    })();
    return () => {
      live = false;
    };
  }, [line.id, c.householdId]);

  async function go(a: RowAction) {
    setError(null);
    setPending(true);
    const r = await apply(line, c, a);
    setPending(false);
    if (!r.ok) setError(r.text);
    else onClose();
  }

  return (
    <GivingSheet
      title={`${money(line.amountCents)} looks like money already counted`}
      family={family}
      labels={labels}
      what="Attach the bank line to the payment it matches, or approve the waiting proof with it. No second payment is created and no pledge changes."
      error={error}
      pending={pending}
      cancelLabel="Close"
      onClose={onClose}
    >
      {state.s === "loading" ? <p className="m-0 text-[14px] text-muted">Looking up this family&apos;s payments and proofs of {money(line.amountCents)}…</p> : null}
      {state.s === "error" ? (
        <p role="alert" className="m-0 text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}
      {state.s === "ok" && state.payments.length === 0 && state.proofs.length === 0 ? (
        <p className="m-0 text-[14px] text-muted">Nothing of exactly {money(line.amountCents)} is waiting for this family any more. Close this and refresh the preview.</p>
      ) : null}
      {state.s === "ok" ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {state.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-line px-3 py-2 text-[14px]">
              <span>
                Receipt <span className="font-mono">{p.receipt ?? "(none)"}</span> · {PAYMENT_METHOD_LABEL[p.method] ?? p.method} · {p.receivedOn ? formatDate(p.receivedOn, timeZone) : "no date"} ·{" "}
                {formatCents(p.amountCents, currency, locale)}, not on the bank yet
              </span>
              <button type="button" className={`${buttonClass("primary", "sm")} min-h-[44px]`} disabled={pending} onClick={() => go({ type: "attach", paymentId: p.id, label: "Attach" })}>
                Attach to this payment
              </button>
            </li>
          ))}
          {state.proofs.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-line px-3 py-2 text-[14px]">
              <span>
                Proof sent for {p.paidOn ? formatDate(p.paidOn, timeZone) : "an unknown day"} · {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                {p.reference ? ` ${p.reference}` : ""} · {formatCents(p.amountCents, currency, locale)}, waiting
              </span>
              <button type="button" className={`${buttonClass("primary", "sm")} min-h-[44px]`} disabled={pending} onClick={() => go({ type: "approve", proofId: p.id, label: "Approve" })}>
                Approve this proof with the line
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </GivingSheet>
  );
}
