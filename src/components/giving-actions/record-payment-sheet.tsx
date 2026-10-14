"use client";

// Record payment, in place (docs/GIVING_REDESIGN.md section 4 "In place" and section 5): the household card at the top, the fields
// with what the box read already in them, what will happen ("Closes PL-20455 and leaves $12.00 open"), and one button that names
// the amount and the family ("Record $200.00 check for the Patel household 0127"). It records through the EXISTING
// recordOfflinePaymentAction, unchanged: the same checks, the same repeat-Zelle warning, the same apply-again retry. Enter never
// submits (there is no form); the button disables while saving and then says "Recorded as R-…"; there is no undo here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { OpenPledge } from "@/app/(app)/giving/actions";
import type { RecordPaymentResult } from "@/app/(app)/giving/payments/actions";
import { HouseholdPicker } from "@/components/household-picker";
import { buttonClass } from "@/components/ui";
import { currencySymbol } from "@/lib/community-format";
import { formatDate } from "@/lib/dates";
import { monthYear, referenceFieldLabel } from "@/lib/giving";
import { recordButtonLabel, recordedLabel, recordedLines, sheetStart, whatHappens, type GivingSheetContext, type RecordPaymentRequest } from "@/lib/giving-actions/record-sheet";
import { familyFrom, familyLine, type Family } from "@/lib/giving-today/queue";
import { OFFLINE_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents, parseAmountToCents } from "@/lib/money";
import type { AllocationMode } from "@/lib/payments/offline-payment";
import { duplicateWarning, type RecordedZelle } from "@/lib/payments/zelle";

import { useGivingSheetBackend } from "./backend";
import { GivingSheet, NO_UNDO } from "./sheet";

const CHIP = "inline-flex min-h-[44px] items-center rounded-full border px-3.5 text-[14px] font-semibold";
const chipTone = (on: boolean) => (on ? "border-navy bg-navy-50 text-navy" : "border-line bg-white text-ink-2 hover:border-navy-300");

export function RecordPaymentSheet({
  ctx,
  request,
  onClose,
  onRecorded,
}: {
  ctx: GivingSheetContext;
  request: RecordPaymentRequest;
  onClose: () => void;
  onRecorded?: (result: RecordPaymentResult) => void;
}) {
  const backend = useGivingSheetBackend();
  const router = useRouter();
  const start = useMemo(() => sheetStart(request.prefill, ctx.today, ctx.canAllocate), [request.prefill, ctx.today, ctx.canAllocate]);
  const candidates = request.candidates ?? [];
  const [picked, setPicked] = useState<Family | null>(request.household ?? (candidates.length === 1 ? candidates[0] : null));
  const [searching, setSearching] = useState(false);
  /** "Choose another family" was pressed: the family the sheet opened with is no longer the one. */
  const [cleared, setCleared] = useState(false);
  const [byId, setById] = useState<{ family: Family | null; error: string | null } | null>(null);
  const [byIdAttempt, setByIdAttempt] = useState(0);
  const [pledgeState, setPledgeState] = useState<{ id: string; pledges: OpenPledge[] | null; error: string | null } | null>(null);
  const [pledgeAttempt, setPledgeAttempt] = useState(0);
  const [amount, setAmount] = useState(start.amount);
  const [method, setMethod] = useState<string>(start.method);
  const [receivedOn, setReceivedOn] = useState(start.receivedOn);
  const [reference, setReference] = useState(start.reference);
  const [envelope, setEnvelope] = useState("");
  const [memo, setMemo] = useState("");
  const [mode, setMode] = useState<AllocationMode>(start.mode);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordPaymentResult | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dupCheck, setDupCheck] = useState<{ key: string; rows: RecordedZelle[]; error: string | null } | null>(null);
  const [dupAttempt, setDupAttempt] = useState(0);
  const dupSeq = useRef(0);

  // Opened with a household id only (a Family page button): read its card, adults only.
  const lookupId = !request.household && request.householdId ? request.householdId : null;
  useEffect(() => {
    if (!lookupId) return;
    let live = true;
    backend
      .household(lookupId)
      .then((res) => {
        if (!live) return;
        setById(res.ok && res.data ? { family: res.data, error: null } : { family: null, error: res.ok ? "Could not open the family — it was not found." : res.error });
      })
      .catch((err: unknown) => {
        console.error("[record-sheet] reading the family failed:", err);
        if (live) setById({ family: null, error: "Could not open the family — the server did not respond. Try again." });
      });
    return () => {
      live = false;
    };
  }, [backend, lookupId, byIdAttempt]);

  const family: Family | null = picked ?? (cleared ? null : (byId?.family ?? null));
  const familyId = family?.id ?? null;

  // The family's open pledges, for the "what happens" line (only for people who may apply payments to pledges).
  useEffect(() => {
    if (!familyId || !ctx.canAllocate) return;
    let live = true;
    backend
      .pledges(familyId)
      .then((res) => {
        if (live) setPledgeState(res.ok ? { id: familyId, pledges: res.data ?? [], error: null } : { id: familyId, pledges: null, error: res.error });
      })
      .catch((err: unknown) => {
        console.error("[record-sheet] loading pledges failed:", err);
        if (live) setPledgeState({ id: familyId, pledges: null, error: "Could not load the family's open pledges — the server did not respond." });
      });
    return () => {
      live = false;
    };
  }, [backend, familyId, ctx.canAllocate, pledgeAttempt]);
  const pledgesNow = pledgeState && pledgeState.id === familyId ? pledgeState : null;
  const pledges = pledgesNow?.pledges ?? null;

  const cents = parseAmountToCents(amount);
  const amountBad = amount !== "" && (cents === null || cents <= 0);

  // Before a Zelle is recorded by hand: the same warning as the Record payment screen (a warning only; saving is unchanged).
  const dupKey = method === "zelle" && familyId && cents && cents > 0 && /^\d{4}-\d{2}-\d{2}$/.test(receivedOn) ? `${familyId}|${cents}|${receivedOn}` : null;
  useEffect(() => {
    if (!dupKey) return;
    const [householdId, c, on] = dupKey.split("|");
    const mine = ++dupSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await backend.duplicateZelle({ householdId, amountCents: Number(c), receivedOn: on });
        if (mine !== dupSeq.current) return;
        setDupCheck(res.ok ? { key: dupKey, rows: res.data ?? [], error: null } : { key: dupKey, rows: [], error: res.error });
      } catch (err) {
        if (mine !== dupSeq.current) return;
        console.error("[record-sheet] duplicate Zelle check failed:", err);
        setDupCheck({ key: dupKey, rows: [], error: "Could not check whether this Zelle is already recorded — the server did not respond." });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [backend, dupKey, dupAttempt]);
  const dup = dupKey && dupCheck?.key === dupKey ? dupCheck : null;
  const dupText = dup ? duplicateWarning(dup.rows, ctx.currency, (d) => formatDate(d, ctx.timeZone)) : null;

  function choose(f: Family) {
    setPicked(f);
    setSearching(false);
    setChosen([]);
    setMode(start.mode);
    setError(null);
  }

  function chooseAnother() {
    setPicked(null);
    setCleared(true);
    setSearching(candidates.length <= 1);
    setError(null);
  }

  function togglePledge(id: string) {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    setChosen(next);
    setMode(next.length > 0 ? "choose" : "auto");
  }

  function submit() {
    setError(null);
    if (!family) return setError("Choose the family first.");
    if (!cents || cents <= 0) return setError("Enter the amount received, like 200.00.");
    if (mode === "choose" && chosen.length === 0) return setError("Choose a pledge, or switch back to earliest first.");
    startTransition(async () => {
      try {
        const res = await backend.record({
          householdId: family.id,
          amount,
          method,
          receivedOn,
          reference,
          envelopeNumber: envelope,
          memo,
          allocation: mode,
          pledgeIds: mode === "choose" ? chosen : undefined,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (!res.data) {
          setError("Could not confirm the payment was recorded — open Payments to check before trying again so it is not recorded twice.");
          return;
        }
        setResult(res.data);
        onRecorded?.(res.data);
        router.refresh();
      } catch (err) {
        console.error("[record-sheet] submit failed:", err);
        setError("Could not record the payment — the server did not respond. Check Payments before trying again so it is not recorded twice.");
      }
    });
  }

  function retryApply() {
    if (!result || !family) return;
    setRetryMessage(null);
    startTransition(async () => {
      try {
        const res = await backend.apply({ paymentId: result.paymentId, householdId: family.id, pledgeIds: mode === "choose" ? chosen : null });
        if (!res.ok) return setRetryMessage(res.error);
        setResult({
          ...result,
          applied: [...result.applied, ...(res.data?.applied ?? [])],
          unallocatedCents: res.data?.unallocatedCents ?? result.unallocatedCents,
          allocationProblem: null,
        });
        setRetryMessage(res.message ?? null);
        router.refresh();
      } catch (err) {
        console.error("[record-sheet] retry apply failed:", err);
        setRetryMessage("Could not apply the payment — the server did not respond. Try again.");
      }
    });
  }

  function another() {
    setResult(null);
    setAmount("");
    setReference("");
    setEnvelope("");
    setMemo("");
    setChosen([]);
    setMode(start.mode);
    setRetryMessage(null);
    setError(null);
    setPledgeAttempt((n) => n + 1);
  }

  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const symbol = currencySymbol({ currency: ctx.currency, locale: ctx.locale });
  const showPicker = !result && !family && (searching || (candidates.length === 0 && (!lookupId || cleared || byId?.error != null)));
  const showCandidates = !result && !family && !searching && candidates.length > 1;
  const what = result ? null : family ? (
    <>
      <p className="m-0" data-testid="what-happens">
        {whatHappens({ amountCents: cents, pledges: ctx.canAllocate ? (pledgesNow ? pledges : null) : [], mode, chosen, canAllocate: ctx.canAllocate, currency: ctx.currency, locale: ctx.locale })}
      </p>
      <p className="m-0 mt-1 text-[13px] text-muted">{NO_UNDO}</p>
    </>
  ) : null;

  return (
    <GivingSheet
      title="Record a payment"
      family={family}
      labels={ctx.labels}
      what={what}
      error={error}
      confirmLabel={result ? recordedLabel(result) : recordButtonLabel({ amount, method, family, currency: ctx.currency, locale: ctx.locale })}
      pendingLabel="Recording…"
      pending={pending}
      confirmDisabled={!!result || !family || !cents || cents <= 0}
      cancelLabel={result ? "Close" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
    >
      {result && family ? (
        <div role="status" className="flex flex-col gap-2 rounded-[12px] border border-success/30 bg-success-50 px-3 py-2.5 text-[14px] text-success-900">
          <p className="m-0 font-bold">
            {recordedLabel(result)}: {money(result.amountCents)} for {family.name}
            {family.number ? ` ${family.number}` : ""}.
          </p>
          {recordedLines(result, ctx.currency, ctx.locale).map((line) => (
            <p key={line} className="m-0">
              {line}
            </p>
          ))}
          {result.allocationProblem ? (
            <div role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              <p className="m-0">{result.allocationProblem[0].toUpperCase() + result.allocationProblem.slice(1)}.</p>
              {ctx.canAllocate ? (
                <button type="button" onClick={retryApply} disabled={pending} className={`${buttonClass("bad", "sm")} mt-2 min-h-[44px]`}>
                  {pending ? "Applying…" : "Try applying it again"}
                </button>
              ) : null}
            </div>
          ) : null}
          {retryMessage ? <p className="m-0 text-[13px]">{retryMessage}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={another} className={`${buttonClass("ghost", "sm")} min-h-[44px]`}>
              Record another for this family
            </button>
            {ctx.canOpenFamily ? (
              <Link href={`/households/${family.id}`} className={`${buttonClass("ghost", "sm")} min-h-[44px]`}>
                Open family page
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {!result && family ? (
        <button type="button" onClick={chooseAnother} className="min-h-[36px] self-start text-[13px] font-semibold text-navy underline">
          Choose another family
        </button>
      ) : null}

      {!result && !family && lookupId && !cleared && !byId ? <p className="m-0 text-[14px] text-muted">Opening the family…</p> : null}
      {!result && !family && lookupId && !cleared && byId?.error ? (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-danger">
          {byId.error}
          <button type="button" onClick={() => { setById(null); setByIdAttempt((n) => n + 1); }} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : null}

      {showCandidates ? (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-[14px] font-bold text-ink">Which family? Check the household card.</legend>
          {candidates.map((f) => (
            <label key={f.id} className="flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-[12px] border border-line px-3 py-2 text-[14px] hover:border-navy-300">
              <input type="radio" name="record-family" className="mt-1 h-[18px] w-[18px] flex-none" onChange={() => choose(f)} />
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-ink">{f.name}</span>
                <span className="block text-[13px] leading-[1.4] text-muted">{familyLine(f, ctx.labels)}</span>
              </span>
            </label>
          ))}
          <button type="button" onClick={() => setSearching(true)} className="self-start text-[13px] font-semibold text-navy underline">
            Search for another family
          </button>
        </fieldset>
      ) : null}

      {showPicker ? (
        <div>
          <p className="m-0 mb-1 text-[14px] font-bold text-ink">Find the family</p>
          <HouseholdPicker
            labels={ctx.labels}
            timeZone={ctx.timeZone}
            currency={ctx.currency}
            onSelect={(card) => choose(familyFrom(card))}
            selectLabel="Record for this family"
            idPrefix="rec"
            finder={backend.findHouseholds}
          />
        </div>
      ) : null}

      {!result ? (
        <div className="flex flex-col gap-3">
          {request.prefill && (request.prefill.amount || request.prefill.method || request.prefill.reference) ? (
            <p role="status" className="m-0 text-[13px] text-muted">
              Filled in from what you typed{request.prefill.about ? ` (for ${request.prefill.about})` : ""}. Check each detail: nothing is saved until you press the button.
            </p>
          ) : null}
          <div>
            <label htmlFor="rec-amount" className="crm-label">
              Amount ({symbol})
            </label>
            <input
              id="rec-amount"
              inputMode="decimal"
              enterKeyHint="next"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="200.00"
              aria-invalid={amountBad}
              className="crm-input min-h-[44px] text-[18px] font-bold tabular-nums"
            />
            {amountBad ? <p className="crm-hint text-danger">Enter the amount with a dot for the decimals, like 200.00.</p> : null}
          </div>
          <fieldset className="m-0 border-0 p-0">
            <legend className="crm-label">Method</legend>
            <div className="flex flex-wrap gap-2">
              {OFFLINE_METHODS.map((m) => (
                <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`${CHIP} ${chipTone(method === m)}`}>
                  {PAYMENT_METHOD_LABEL[m]}
                </button>
              ))}
            </div>
            {ctx.bankOn && (method === "zelle" || method === "ach") ? (
              <p className="crm-hint">Zelle and ACH usually arrive through bank reconciliation: record here only if it is not on a statement.</p>
            ) : null}
          </fieldset>
          {dupText ? (
            <p role="status" className="m-0 rounded-[10px] border border-saffron/60 bg-saffron-50 px-3 py-2 text-[13px] font-semibold text-brown">
              {dupText}
            </p>
          ) : dup?.error ? (
            <p role="status" className="m-0 text-[13px] text-muted">
              {dup.error} Saving still works.{" "}
              <button type="button" onClick={() => setDupAttempt((n) => n + 1)} className="font-semibold underline">
                Check again
              </button>
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rec-date" className="crm-label">
                Received on
              </label>
              <input id="rec-date" type="date" max={ctx.today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="crm-input min-h-[44px]" />
            </div>
            <div>
              <label htmlFor="rec-ref" className="crm-label">
                {referenceFieldLabel(method)}
              </label>
              <input
                id="rec-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                inputMode={method === "check" ? "numeric" : undefined}
                placeholder={method === "stock" ? "10 shares · value on receipt date" : method === "check" ? "4417" : "Reference (optional)"}
                maxLength={method === "check" ? 40 : 200}
                className="crm-input min-h-[44px]"
              />
            </div>
          </div>
          <details className="text-[14px]">
            <summary className="min-h-[44px] cursor-pointer py-2 font-semibold text-navy">Envelope number and memo</summary>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="rec-envelope" className="crm-label">
                  Envelope number (optional)
                </label>
                <input id="rec-envelope" value={envelope} onChange={(e) => setEnvelope(e.target.value)} className="crm-input min-h-[44px]" />
              </div>
              <div>
                <label htmlFor="rec-memo" className="crm-label">
                  Memo (optional)
                </label>
                <input id="rec-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={280} className="crm-input min-h-[44px]" />
              </div>
            </div>
          </details>
          {family && ctx.canAllocate ? (
            pledgesNow?.error ? (
              <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-danger">
                {pledgesNow.error}
                <button type="button" onClick={() => setPledgeAttempt((n) => n + 1)} className="font-semibold underline">
                  Try again
                </button>
              </p>
            ) : pledges && pledges.length > 0 ? (
              <fieldset className="m-0 border-0 p-0">
                <legend className="crm-label">Apply to</legend>
                <div className="flex flex-wrap gap-2">
                  <button type="button" aria-pressed={mode === "auto"} onClick={() => { setChosen([]); setMode("auto"); }} className={`${CHIP} ${chipTone(mode === "auto")}`}>
                    Earliest first
                  </button>
                  {pledges.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={chosen.includes(p.id)}
                      onClick={() => togglePledge(p.id)}
                      className={`${CHIP} ${chipTone(chosen.includes(p.id))}`}
                      title={`${p.pledge_number ?? "Pledge"} · ${money(p.amount_cents - p.paid_cents)} open`}
                    >
                      {p.pledge_number ?? p.campaign ?? "Pledge"} · {money(p.amount_cents - p.paid_cents)} open · {monthYear(p.pledged_at, ctx.timeZone)}
                    </button>
                  ))}
                  <button type="button" aria-pressed={mode === "none"} onClick={() => { setChosen([]); setMode("none"); }} className={`${CHIP} ${chipTone(mode === "none")}`}>
                    Don&apos;t apply (general gift)
                  </button>
                </div>
              </fieldset>
            ) : null
          ) : null}
        </div>
      ) : null}
    </GivingSheet>
  );
}
