"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { openPledgesAction, type OpenPledge } from "@/app/(app)/giving/actions";
import { HouseholdCard, type CardLabels, type HouseholdCardData } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";
import { Badge, buttonClass } from "@/components/ui";
import { previewAllocation } from "@/lib/allocation";
import { formatDate } from "@/lib/dates";
import { OFFLINE_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { applyPaymentAction, recordOfflinePaymentAction, type RecordPaymentResult } from "./actions";

type Mode = "auto" | "choose" | "none";

export function RecordPaymentForm({
  labels,
  timeZone,
  currency,
  today,
  canAllocate,
  initialHousehold,
}: {
  labels: CardLabels;
  timeZone: string;
  currency: string;
  today: string;
  canAllocate: boolean;
  /** Prefilled from ?household= (e.g. "Record payment" on a household). Shown as its card, so it is still checked, never picked by name. */
  initialHousehold?: HouseholdCardData | null;
}) {
  const [household, setHousehold] = useState<HouseholdCardData | null>(null);
  const [pledges, setPledges] = useState<OpenPledge[] | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("check");
  const [receivedOn, setReceivedOn] = useState(today);
  const [checkNumber, setCheckNumber] = useState("");
  const [envelope, setEnvelope] = useState("");
  const [memo, setMemo] = useState("");
  const [mode, setMode] = useState<Mode>(canAllocate ? "auto" : "none");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordPaymentResult | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amountCents = parseAmountToCents(amount);
  const preview = useMemo(
    () =>
      pledges && amountCents && amountCents > 0 && mode !== "none"
        ? previewAllocation(amountCents, pledges, mode === "choose" ? chosen : null)
        : null,
    [pledges, amountCents, mode, chosen],
  );
  const pledgeById = new Map((pledges ?? []).map((p) => [p.id, p]));

  function pick(card: HouseholdCardData) {
    setHousehold(card);
    setPledges(null);
    setPledgeError(null);
    setChosen([]);
    setResult(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await openPledgesAction(card.household_id);
        if (!res.ok) setPledgeError(res.error);
        else setPledges(res.data ?? []);
      } catch (err) {
        console.error("[record-payment] loading pledges failed:", err);
        setPledgeError("Could not load the household's open pledges — the server did not respond. Choose the household again to retry.");
      }
    });
  }

  const prefilled = useRef(false);
  useEffect(() => {
    if (initialHousehold && !prefilled.current) {
      prefilled.current = true;
      pick(initialHousehold);
    }
    // One-time prefill; pick() only sets state and loads that household's pledges.
  }, [initialHousehold]);

  function toggle(id: string) {
    setChosen((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function reset() {
    setHousehold(null);
    setPledges(null);
    setAmount("");
    setCheckNumber("");
    setEnvelope("");
    setMemo("");
    setChosen([]);
    setMode(canAllocate ? "auto" : "none");
    setResult(null);
    setError(null);
    setRetryMessage(null);
  }

  function submit() {
    setError(null);
    if (!household) return setError("Choose the household first.");
    if (!amountCents || amountCents <= 0) return setError("Enter the amount received, like 251.00.");
    if (mode === "choose" && chosen.length === 0) return setError("Tick at least one pledge, or switch to earliest-first.");
    startTransition(async () => {
      try {
        const res = await recordOfflinePaymentAction({
          householdId: household.household_id,
          amount,
          method,
          receivedOn,
          checkNumber,
          envelopeNumber: envelope,
          memo,
          allocation: mode,
          pledgeIds: mode === "choose" ? chosen : undefined,
        });
        if (!res.ok) return setError(res.error);
        setResult(res.data ?? null);
      } catch (err) {
        console.error("[record-payment] submit failed:", err);
        setError("Could not record the payment — the server did not respond. Check the payments list before trying again so it is not recorded twice.");
      }
    });
  }

  function retryApply() {
    if (!result || !household) return;
    setRetryMessage(null);
    startTransition(async () => {
      try {
        const res = await applyPaymentAction({
          paymentId: result.paymentId,
          householdId: household.household_id,
          pledgeIds: mode === "choose" ? chosen : null,
        });
        if (!res.ok) return setRetryMessage(res.error);
        setResult({
          ...result,
          applied: [...result.applied, ...(res.data?.applied ?? [])],
          unallocatedCents: res.data?.unallocatedCents ?? result.unallocatedCents,
          allocationProblem: null,
        });
        setRetryMessage(res.message ?? null);
      } catch (err) {
        console.error("[record-payment] retry apply failed:", err);
        setRetryMessage("Could not apply the payment — the server did not respond. Try again.");
      }
    });
  }

  if (result && household) {
    return (
      <div className="space-y-3">
        <div role="status" className="rounded-lg border border-success/30 bg-success-50 px-4 py-3 text-success">
          <p className="font-semibold">
            Recorded {formatCents(result.amountCents, currency)} for {household.household_name} — receipt{" "}
            <span className="font-mono">{result.receiptNumber ?? "pending"}</span>.
          </p>
          <p className="mt-1 text-sm">
            {result.qboQueued === true
              ? "Queued for QuickBooks."
              : result.qboQueued === false
                ? "Not yet visible in the QuickBooks queue — check Accounting → QuickBooks."
                : "It is queued for QuickBooks automatically."}
          </p>
        </div>
        {result.applied.length > 0 ? (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Applied to</th>
                <th className="num">Amount</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.applied.map((a) => (
                <tr key={a.pledge_id}>
                  <td className="font-mono">{a.pledge_number ?? "pledge"}</td>
                  <td className="num">{formatCents(a.amount_cents, currency)}</td>
                  <td>{a.closed ? <Badge tone="success">Paid in full</Badge> : <Badge tone="navy">Still partly open</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {result.unallocatedCents > 0 ? (
          <p className="text-sm text-muted">{formatCents(result.unallocatedCents, currency)} is not applied to any pledge.</p>
        ) : null}
        {result.allocationProblem ? (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger">
            <p>{result.allocationProblem[0].toUpperCase() + result.allocationProblem.slice(1)}.</p>
            {canAllocate ? (
              <button type="button" onClick={retryApply} disabled={pending} className={`${buttonClass("secondary", "sm")} mt-2`}>
                {pending ? "Applying…" : "Try applying it again"}
              </button>
            ) : null}
          </div>
        ) : null}
        {retryMessage ? <p className="text-sm">{retryMessage}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={reset} className={buttonClass("primary")}>
            Record another payment
          </button>
          <Link href={`/households/${household.household_id}?tab=payments`} className={buttonClass("secondary")}>
            Open the household
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {household ? (
        <HouseholdCard card={household} labels={labels} timeZone={timeZone} currency={currency} tone="selected">
          <button type="button" onClick={() => setHousehold(null)} className={buttonClass("ghost", "sm")}>
            Change household
          </button>
        </HouseholdCard>
      ) : (
        <HouseholdPicker labels={labels} timeZone={timeZone} currency={currency} onSelect={pick} idPrefix="pay" />
      )}

      {household ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="pay-amount" className="crm-label">
                Amount received ($)
              </label>
              <input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="251.00"
                className="crm-input"
                aria-invalid={amount !== "" && (amountCents === null || amountCents <= 0)}
              />
              {amount !== "" && (amountCents === null || amountCents <= 0) ? (
                <p className="crm-hint text-danger">Enter dollars and cents, like 251.00.</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="pay-method" className="crm-label">
                Method
              </label>
              <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className="crm-input">
                {OFFLINE_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
              {method === "zelle" || method === "ach" ? (
                <p className="crm-hint">Zelle and ACH usually arrive through bank reconciliation — record here only if it is not on a statement.</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="pay-date" className="crm-label">
                Received on
              </label>
              <input id="pay-date" type="date" max={today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="crm-input" />
            </div>
            {method === "check" ? (
              <div>
                <label htmlFor="pay-check" className="crm-label">
                  Check number
                </label>
                <input id="pay-check" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} className="crm-input" />
              </div>
            ) : null}
            <div>
              <label htmlFor="pay-envelope" className="crm-label">
                Envelope number (optional)
              </label>
              <input id="pay-envelope" value={envelope} onChange={(e) => setEnvelope(e.target.value)} className="crm-input" />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="pay-memo" className="crm-label">
                Memo (optional)
              </label>
              <input id="pay-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} className="crm-input" />
            </div>
          </div>

          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-sm font-semibold">Apply to pledges</legend>
            {!canAllocate ? (
              <p className="text-sm text-muted">
                Applying payments to pledges needs the giving.manage permission. The payment will be recorded unapplied and a treasurer applies it.
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {(
                  [
                    ["auto", "Earliest open pledge first"],
                    ["choose", "Choose specific pledges"],
                    ["none", "Don't apply (general gift)"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="pay-mode" checked={mode === k} onChange={() => setMode(k)} className="h-5 w-5" />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {pledgeError ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {pledgeError}
              </p>
            ) : pledges === null ? (
              <p className="mt-2 text-sm text-muted">Loading open pledges…</p>
            ) : pledges.length === 0 ? (
              <p className="mt-2 text-sm text-muted">This household has no open pledges; the payment will stay unapplied.</p>
            ) : canAllocate && mode !== "none" ? (
              <table className="crm-table mt-3">
                <thead>
                  <tr>
                    {mode === "choose" ? <th>Use</th> : null}
                    <th>Pledge</th>
                    <th>Pledged</th>
                    <th className="num">Open now</th>
                    <th className="num">This payment</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {pledges.map((p) => {
                    const line = preview?.lines.find((l) => l.pledge_id === p.id);
                    const order = chosen.indexOf(p.id);
                    return (
                      <tr key={p.id}>
                        {mode === "choose" ? (
                          <td>
                            <label className="flex min-h-9 items-center gap-2">
                              <input type="checkbox" checked={order >= 0} onChange={() => toggle(p.id)} className="h-5 w-5" />
                              {order >= 0 ? <span className="text-xs text-muted">#{order + 1}</span> : null}
                            </label>
                          </td>
                        ) : null}
                        <td>
                          <span className="font-mono text-[0.8125rem]">{p.pledge_number ?? "pledge"}</span>
                          <div className="text-xs text-muted">{p.campaign ?? p.source.replace(/_/g, " ")}</div>
                        </td>
                        <td>{formatDate(p.pledged_at, timeZone)}</td>
                        <td className="num">{formatCents(p.amount_cents - p.paid_cents, currency)}</td>
                        <td className="num font-semibold">{line ? formatCents(line.amount_cents, currency) : "—"}</td>
                        <td>
                          {line ? (
                            line.closes ? (
                              <Badge tone="success">Closes</Badge>
                            ) : (
                              <span className="text-sm">{formatCents(line.open_after_cents, currency)} left</span>
                            )
                          ) : (
                            <span className="text-sm text-muted">Unchanged</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
            {preview ? (
              <p className="mt-2 text-sm">
                {preview.lines.filter((l) => l.closes).length > 0
                  ? `Closes ${preview.lines
                      .filter((l) => l.closes)
                      .map((l) => pledgeById.get(l.pledge_id)?.pledge_number ?? "a pledge")
                      .join(", ")}. `
                  : ""}
                {preview.unallocated_cents > 0 ? `${formatCents(preview.unallocated_cents, currency)} stays unapplied.` : "Fully applied."}
              </p>
            ) : null}
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <button type="button" onClick={submit} disabled={pending} className={buttonClass("primary")}>
            {pending ? "Recording…" : `Record ${amountCents && amountCents > 0 ? formatCents(amountCents, currency) : "payment"}`}
          </button>
        </>
      ) : null}
    </div>
  );
}
