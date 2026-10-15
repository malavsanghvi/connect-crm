"use client";

// Record a pledge, in place (docs/GIVING_REDESIGN.md slice 7; section 10 decision 3; NEEDS OWNER OK). The household card at the top,
// the amount and what it is for already filled in from the box, the adult who pledged (never a child), a reason that shows in the
// family's History, and one button that names the amount and the family ("Record a $500.00 pledge for the Patel household 0127").
// It records through recordPledgeAction: giving.manage, recorded once (the sheet's request id), source "manual". Enter never submits
// (there is no form); the button disables while saving and then says "Recorded as PL-…"; there is no undo here. No money moves.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { HouseholdPicker } from "@/components/household-picker";
import { buttonClass } from "@/components/ui";
import { currencySymbol } from "@/lib/community-format";
import { dueRuleSentence } from "@/lib/giving-due";
import {
  DEDICATION_MAX,
  PLEDGE_NO_UNDO,
  PLEDGE_REASONS,
  REASON_MAX,
  REASON_MIN,
  designationValue,
  parseDesignation,
  pledgeButtonLabel,
  pledgeWhatHappens,
  recordedPledgeLabel,
  type PledgeSheetOptions,
  type RecordedPledge,
  type RecordPledgeRequest,
} from "@/lib/giving-actions/record-pledge";
import type { GivingSheetContext } from "@/lib/giving-actions/record-sheet";
import { familyFrom, familyLine, type Family } from "@/lib/giving-today/queue";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { useGivingSheetBackend } from "./backend";
import { GivingSheet } from "./sheet";

const CHIP = "inline-flex min-h-[44px] items-center rounded-full border px-3.5 text-[14px] font-semibold";
const chipTone = (on: boolean) => (on ? "border-navy bg-navy-50 text-navy" : "border-line bg-white text-ink-2 hover:border-navy-300");

/** One confirmation per sheet: pressing the button twice, or again after a lost answer, records once. */
function newRequestId(): string {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return `pledge-${c.randomUUID()}`;
  return `pledge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function RecordPledgeSheet({
  ctx,
  request,
  onClose,
  onRecorded,
}: {
  ctx: GivingSheetContext;
  request: RecordPledgeRequest;
  onClose: () => void;
  onRecorded?: (result: RecordedPledge) => void;
}) {
  const backend = useGivingSheetBackend();
  const router = useRouter();
  const candidates = request.candidates ?? [];
  const [picked, setPicked] = useState<Family | null>(request.household ?? (candidates.length === 1 ? candidates[0] : null));
  const [searching, setSearching] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [byId, setById] = useState<{ family: Family | null; error: string | null } | null>(null);
  const [byIdAttempt, setByIdAttempt] = useState(0);
  const [options, setOptions] = useState<{ key: string; data: PledgeSheetOptions | null; error: string | null } | null>(null);
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [requestId, setRequestId] = useState(newRequestId);
  const [amount, setAmount] = useState(request.prefill?.amount ?? "");
  const [designation, setDesignation] = useState(designationValue(request.prefill?.designation ?? null));
  /** "" = the household (no one named); null = not chosen yet (the primary adult is offered once the adults are known). */
  const [pledgedBy, setPledgedBy] = useState<string | null>(null);
  // null until the person changes it: the community's default for a pledge made today (every pledge has a due date, 0775).
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [dedication, setDedication] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordedPledge | null>(null);
  const [pending, startTransition] = useTransition();
  const reasonInput = useRef<HTMLInputElement>(null);

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
        console.error("[pledge-sheet] reading the family failed:", err);
        if (live) setById({ family: null, error: "Could not open the family — the server did not respond. Try again." });
      });
    return () => {
      live = false;
    };
  }, [backend, lookupId, byIdAttempt]);

  const family: Family | null = picked ?? (cleared ? null : (byId?.family ?? null));
  const familyId = family?.id ?? null;

  // The funds, campaigns and opportunities, and the chosen family's adults (never a child).
  const optionsKey = `${familyId ?? ""}|${optionsAttempt}`;
  useEffect(() => {
    let live = true;
    backend
      .pledgeOptions(familyId)
      .then((res) => {
        if (live) setOptions(res.ok && res.data ? { key: optionsKey, data: res.data, error: null } : { key: optionsKey, data: null, error: res.ok ? "Could not load the funds and campaigns." : res.error });
      })
      .catch((err: unknown) => {
        console.error("[pledge-sheet] loading the choices failed:", err);
        if (live) setOptions({ key: optionsKey, data: null, error: "Could not load the funds, campaigns and adults — the server did not respond." });
      });
    return () => {
      live = false;
    };
  }, [backend, familyId, optionsKey]);
  const opts = options?.key === optionsKey ? options : null;
  const adults = opts?.data?.adults ?? [];
  const primary = adults.find((a) => a.isPrimary) ?? null;
  // Until the person chooses, the primary adult is the one who pledged (when there is one); "" is the household.
  const pledger = pledgedBy ?? primary?.id ?? "";
  const dueShown = dueOn ?? opts?.data?.defaultDueOn ?? "";

  // Everything the box could fill is filled: the cursor goes to the reason (the one thing only the person knows).
  const prefilled = !!family && !!request.prefill?.amount;
  useEffect(() => {
    if (!prefilled) return;
    const t = window.setTimeout(() => reasonInput.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [prefilled]);

  function choose(f: Family) {
    setPicked(f);
    setSearching(false);
    setPledgedBy(null);
    setError(null);
  }

  function chooseAnother() {
    setPicked(null);
    setCleared(true);
    setSearching(candidates.length <= 1);
    setPledgedBy(null);
    setError(null);
  }

  const cents = parseAmountToCents(amount);
  const amountBad = amount !== "" && (cents === null || cents <= 0);
  const reasonOk = reason.trim().length >= REASON_MIN;

  function submit() {
    setError(null);
    if (!family) return setError("Choose the family first.");
    if (!cents || cents <= 0) return setError("Enter the pledge amount, like 500.00.");
    if (!reasonOk) return setError('Say why this pledge is recorded here (for example "Pledged in person"). It shows in the family\'s History.');
    startTransition(async () => {
      try {
        const res = await backend.recordPledge({
          requestId,
          householdId: family.id,
          amount,
          designation,
          dueOn: dueShown || null,
          pledgedBy: pledger || null,
          dedication: dedication || null,
          reason,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (!res.data) {
          setError("Could not confirm the pledge was recorded — open the family's Pledges to check before trying again.");
          return;
        }
        setResult(res.data);
        onRecorded?.(res.data);
        router.refresh();
      } catch (err) {
        console.error("[pledge-sheet] submit failed:", err);
        setError("Could not record the pledge — the server did not respond. Press the button again: the same pledge is never recorded twice.");
      }
    });
  }

  function another() {
    setResult(null);
    setRequestId(newRequestId());
    setAmount("");
    setDueOn("");
    setDedication("");
    setReason("");
    setError(null);
  }

  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const symbol = currencySymbol({ currency: ctx.currency, locale: ctx.locale });
  const data = opts?.data ?? null;
  const chosen = parseDesignation(designation);
  const forWhat = !chosen
    ? null
    : chosen.fundId
      ? (data?.funds.find((f) => f.id === chosen.fundId)?.name ?? request.prefill?.designation?.name ?? null)
      : chosen.campaignId
        ? (data?.campaigns.find((c) => c.id === chosen.campaignId)?.name ?? request.prefill?.designation?.name ?? null)
        : chosen.opportunityId
          ? (data?.opportunities.find((o) => o.id === chosen.opportunityId)?.name ?? request.prefill?.designation?.name ?? null)
          : null;
  const pledgerName = pledger ? (adults.find((a) => a.id === pledger)?.name ?? null) : null;
  const showPicker = !result && !family && (searching || (candidates.length === 0 && (!lookupId || cleared || byId?.error != null)));
  const showCandidates = !result && !family && !searching && candidates.length > 1;
  const what = result ? null : family ? (
    <>
      <p className="m-0" data-testid="what-happens">
        {pledgeWhatHappens({ amountCents: cents, forWhat, pledger: pledgerName, currency: ctx.currency, locale: ctx.locale })}
      </p>
      <p className="m-0 mt-1 text-[13px] text-muted">{PLEDGE_NO_UNDO}</p>
    </>
  ) : null;

  return (
    <GivingSheet
      title="Record a pledge"
      family={family}
      labels={ctx.labels}
      what={what}
      error={error}
      confirmLabel={result ? recordedPledgeLabel(result) : pledgeButtonLabel({ amount, family, currency: ctx.currency, locale: ctx.locale })}
      pendingLabel="Recording…"
      pending={pending}
      confirmDisabled={!!result || !family || !cents || cents <= 0 || !reasonOk}
      cancelLabel={result ? "Close" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
    >
      {result && family ? (
        <div role="status" className="flex flex-col gap-2 rounded-field border border-success/30 bg-success-50 px-3 py-2.5 text-[14px] text-success-900">
          <p className="m-0 font-bold">
            {recordedPledgeLabel(result)}: {money(result.amountCents)} for {family.name}
            {family.number ? ` ${family.number}` : ""}.
          </p>
          <p className="m-0">{result.replayed ? "It was already recorded: nothing was added." : "No money moved. It shows as owed until it is paid."}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={another} className={`${buttonClass("ghost", "sm")} min-h-[44px]`}>
              Record another for this family
            </button>
            {ctx.canOpenFamily ? (
              <Link href={`/households/${family.id}?tab=pledges`} className={`${buttonClass("ghost", "sm")} min-h-[44px]`}>
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
            <label key={f.id} className="flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-field border border-line px-3 py-2 text-[14px] hover:border-navy-300">
              <input type="radio" name="pledge-family" className="mt-1 h-[18px] w-[18px] flex-none" onChange={() => choose(f)} />
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
            selectLabel="Record a pledge for this family"
            idPrefix="plg"
            finder={backend.findHouseholds}
          />
        </div>
      ) : null}

      {!result ? (
        <div className="flex flex-col gap-3">
          {request.prefill && (request.prefill.amount || request.prefill.designation) ? (
            <p role="status" className="m-0 text-[13px] text-muted">
              Filled in from what you typed. Check each detail: nothing is saved until you press the button.
            </p>
          ) : null}
          {opts?.error ? (
            <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-danger">
              {opts.error}
              <button type="button" onClick={() => setOptionsAttempt((n) => n + 1)} className="font-semibold underline">
                Try again
              </button>
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="plg-amount" className="crm-label">
                Pledge amount ({symbol})
              </label>
              <input
                id="plg-amount"
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500.00"
                aria-invalid={amountBad}
                className="crm-input min-h-[44px] text-[18px] font-bold tabular-nums"
              />
              {amountBad ? <p className="crm-hint text-danger">Enter the amount with a dot for the decimals, like 500.00.</p> : null}
            </div>
            <div>
              <label htmlFor="plg-for" className="crm-label">
                For
              </label>
              <select id="plg-for" value={designation} onChange={(e) => setDesignation(e.target.value)} className="crm-input min-h-[44px]">
                <option value="">General (no fund)</option>
                {/* What the box chose stays offered while the lists load. */}
                {request.prefill?.designation && !data ? <option value={designationValue(request.prefill.designation)}>{request.prefill.designation.name}</option> : null}
                {data && data.funds.length > 0 ? (
                  <optgroup label="Funds">
                    {data.funds.map((f) => (
                      <option key={f.id} value={`fund:${f.id}`}>
                        {f.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {data && data.campaigns.length > 0 ? (
                  <optgroup label="Campaigns">
                    {data.campaigns.map((c) => (
                      <option key={c.id} value={`campaign:${c.id}`}>
                        {c.fundName ? `${c.name} (${c.fundName})` : c.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {data && data.opportunities.length > 0 ? (
                  <optgroup label="Opportunities">
                    {data.opportunities.map((o) => (
                      <option key={o.id} value={`opportunity:${o.id}`}>
                        {o.name}
                        {o.campaignName ? ` · ${o.campaignName}` : ""}
                        {o.amountCents ? ` · ${money(o.amountCents)}` : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="plg-reason" className="crm-label">
              Why it is recorded here
            </label>
            <input
              id="plg-reason"
              ref={reasonInput}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={REASON_MAX}
              placeholder="Pledged in person"
              autoComplete="off"
              aria-describedby="plg-reason-hint"
              className="crm-input min-h-[44px]"
            />
            <p id="plg-reason-hint" className="crm-hint">
              Shows in the family&apos;s History.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {PLEDGE_REASONS.map((r) => (
                <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={`${CHIP} ${chipTone(reason === r)}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          {family ? (
            <div>
              <label htmlFor="plg-by" className="crm-label">
                Who pledged
              </label>
              <select id="plg-by" value={pledger} onChange={(e) => setPledgedBy(e.target.value)} className="crm-input min-h-[44px]" disabled={!opts}>
                <option value="">The household (no one named)</option>
                {adults.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="crm-hint">Adults of this household only.</p>
            </div>
          ) : null}
          <div>
            <label htmlFor="plg-due" className="crm-label">
              Due on
            </label>
            <input
              id="plg-due"
              type="date"
              value={dueShown}
              onChange={(e) => setDueOn(e.target.value)}
              aria-describedby="plg-due-hint"
              className="crm-input min-h-[44px]"
            />
            <p id="plg-due-hint" className="crm-hint">
              {opts?.data ? `${dueRuleSentence(opts.data.dueDays)} Change it if this pledge is due on another day.` : "Every pledge has a due date."}
            </p>
          </div>
          <details className="text-[14px]">
            <summary className="min-h-[44px] cursor-pointer py-2 font-semibold text-navy">Dedication</summary>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="plg-dedication" className="crm-label">
                  Dedication (optional)
                </label>
                <input id="plg-dedication" value={dedication} onChange={(e) => setDedication(e.target.value)} maxLength={DEDICATION_MAX} className="crm-input min-h-[44px]" />
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </GivingSheet>
  );
}
