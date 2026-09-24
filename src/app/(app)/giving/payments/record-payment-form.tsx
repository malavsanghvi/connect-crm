"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { openPledgesAction, type OpenPledge } from "@/app/(app)/giving/actions";
import { ChipGroup } from "@/components/controls";
import { HouseholdCard, type CardLabels, type HouseholdCardData } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";
import { useToast } from "@/components/toast";
import { Card, StatusText, buttonClass } from "@/components/ui";
import { previewAllocation } from "@/lib/allocation";
import { allocationPreviewText, monthYear, paymentRecordedToast, referenceFieldLabel } from "@/lib/giving";
import { OFFLINE_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { applyPaymentAction, recordOfflinePaymentAction, type RecordPaymentResult } from "./actions";

type Mode = "auto" | "choose" | "none";

const PREVIEW_TONE = { ok: "text-success-900 font-bold", warn: "text-brown font-semibold", muted: "text-muted font-semibold" } as const;

/**
 * Record an offline payment (prototype L585–588): the form (span 7) beside a
 * green Allocation preview (span 5). Renders two blocks for a <BlockGrid>.
 */
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
  const toast = useToast();
  const [household, setHousehold] = useState<HouseholdCardData | null>(null);
  const [pledges, setPledges] = useState<OpenPledge[] | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("check");
  const [receivedOn, setReceivedOn] = useState(today);
  const [reference, setReference] = useState("");
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

  function pick(card: HouseholdCardData) {
    setHousehold(card);
    setPledges(null);
    setPledgeError(null);
    setChosen([]);
    setMode(canAllocate ? "auto" : "none");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHousehold]);

  function togglePledge(id: string) {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    setChosen(next);
    setMode(next.length > 0 ? "choose" : "auto");
  }

  function reset() {
    setHousehold(null);
    setPledges(null);
    setAmount("");
    setReference("");
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
    if (!amountCents || amountCents <= 0) return setError("Enter the amount received, like 400.00.");
    if (mode === "choose" && chosen.length === 0) return setError("Choose a pledge, or switch back to earliest first.");
    startTransition(async () => {
      try {
        const res = await recordOfflinePaymentAction({
          householdId: household.household_id,
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
          toast?.show(res.error, "bad");
          return;
        }
        const data = res.data ?? null;
        setResult(data);
        if (data) toast?.show(paymentRecordedToast(data.applied.length, data.qboQueued), "ok");
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

  const previewLines =
    household && pledges
      ? allocationPreviewText({
          lines: preview?.lines ?? [],
          unallocatedCents: preview?.unallocated_cents ?? 0,
          pledges,
          mode,
          hasOpenPledges: pledges.length > 0,
          currency,
          timeZone,
        })
      : [];
  const showPledgeChips = Boolean(household && canAllocate && pledges && pledges.length > 0 && !result);

  const previewCard = (
    <Card
      span={5}
      title="Allocation preview"
      description={mode === "choose" ? "Applied to the chosen pledge first" : mode === "none" ? "Not applied to pledges" : "Earliest open pledge first"}
    >
      <div className="flex flex-col gap-1.5 rounded-xl bg-success-50 px-3.5 py-3 text-[13px] leading-[1.45]">
        {!household ? (
          <p className="font-semibold text-muted">Choose a household to see which pledges this payment closes.</p>
        ) : pledgeError ? (
          <p role="alert" className="font-semibold text-danger">
            {pledgeError}
          </p>
        ) : pledges === null ? (
          <p className="font-semibold text-muted">Loading open pledges…</p>
        ) : !canAllocate ? (
          <p className="font-semibold text-muted">
            Applying payments to pledges needs the giving.manage permission. The payment is recorded unapplied and a treasurer applies it.
          </p>
        ) : !amountCents || amountCents <= 0 ? (
          <p className="font-semibold text-muted">
            {pledges.length === 0 ? "No open pledges; the full amount stays unapplied as a general gift" : "Enter the amount to see the allocation."}
          </p>
        ) : (
          previewLines.map((l, i) => (
            <p key={i} className={PREVIEW_TONE[l.tone]}>
              {l.text}
            </p>
          ))
        )}
        {showPledgeChips ? <p className="font-medium text-muted">Tie to a specific pledge instead:</p> : null}
      </div>
      {showPledgeChips && pledges ? (
        <div className="mt-3">
          <p className="crm-label">Specific pledge (optional)</p>
          <div role="group" aria-label="Apply to" className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="cc-chip min-h-[34px]"
              aria-pressed={mode === "auto"}
              onClick={() => {
                setChosen([]);
                setMode("auto");
              }}
            >
              Earliest first
            </button>
            {pledges.map((p) => (
              <button
                key={p.id}
                type="button"
                className="cc-chip min-h-[34px]"
                aria-pressed={chosen.includes(p.id)}
                onClick={() => togglePledge(p.id)}
                title={`${p.pledge_number ?? "Pledge"} · ${formatCents(p.amount_cents - p.paid_cents, currency)} open`}
              >
                {p.campaign ?? p.source.replace(/_/g, " ")} · {monthYear(p.pledged_at, timeZone)}
                {chosen.includes(p.id) && chosen.length > 1 ? ` (#${chosen.indexOf(p.id) + 1})` : ""}
              </button>
            ))}
            <button
              type="button"
              className="cc-chip min-h-[34px]"
              aria-pressed={mode === "none"}
              onClick={() => {
                setChosen([]);
                setMode("none");
              }}
            >
              Don&apos;t apply (general gift)
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );

  if (result && household) {
    return (
      <>
        <Card span={7} title="Payment recorded" description={`Receipt ${result.receiptNumber ?? "pending"}`}>
          <div className="space-y-3">
            <p role="status" className="rounded-[10px] border border-success/30 bg-success-50 px-3 py-2 text-[13px] font-semibold text-success-900">
              Recorded {formatCents(result.amountCents, currency)} for {household.household_name} · {result.applied.length} pledge
              {result.applied.length === 1 ? "" : "s"} updated ·{" "}
              {result.qboQueued === true
                ? "QuickBooks sales receipt queued"
                : result.qboQueued === false
                  ? "not yet visible in the QuickBooks queue — check Accounting › QuickBooks sync"
                  : "queued for QuickBooks automatically"}
              .
            </p>
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
                      <td>{a.closed ? <StatusText tone="ok">Closes</StatusText> : <StatusText tone="warn">Stays open (partial)</StatusText>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {result.unallocatedCents > 0 ? (
              <p className="text-[13px] text-muted">{formatCents(result.unallocatedCents, currency)} stays unapplied as a general gift.</p>
            ) : null}
            {result.allocationProblem ? (
              <div role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
                <p>{result.allocationProblem[0].toUpperCase() + result.allocationProblem.slice(1)}.</p>
                {canAllocate ? (
                  <button type="button" onClick={retryApply} disabled={pending} className={`${buttonClass("bad", "sm")} mt-2`}>
                    {pending ? "Applying…" : "Try applying it again"}
                  </button>
                ) : null}
              </div>
            ) : null}
            {retryMessage ? <p className="text-[13px]">{retryMessage}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Link href={`/households/${household.household_id}?tab=payments`} className={buttonClass("ghost")}>
                Open the household
              </Link>
              <button type="button" onClick={reset} className={buttonClass("primary")}>
                Record another payment
              </button>
            </div>
          </div>
        </Card>
        {previewCard}
      </>
    );
  }

  return (
    <>
      <Card span={7} title="Record an offline payment" description="Check, cash, ACH or stock received at the office or an event">
        <div className="flex flex-col gap-3">
          <div>
            <p className="crm-label">Household</p>
            {household ? (
              <HouseholdCard card={household} labels={labels} timeZone={timeZone} currency={currency} tone="selected">
                <button type="button" onClick={() => setHousehold(null)} className={buttonClass("ghost", "xs")}>
                  Change household
                </button>
              </HouseholdCard>
            ) : (
              <HouseholdPicker labels={labels} timeZone={timeZone} currency={currency} onSelect={pick} idPrefix="pay" />
            )}
          </div>
          <div>
            <p className="crm-label">Method</p>
            <ChipGroup label="Method" value={method} onChange={setMethod} options={OFFLINE_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
            {method === "zelle" || method === "ach" ? (
              <p className="crm-hint">Zelle and ACH usually arrive through bank reconciliation — record here only if it is not on a statement.</p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pay-amount" className="crm-label">
                Amount ($)
              </label>
              <input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="400.00"
                className="crm-input"
                aria-invalid={amount !== "" && (amountCents === null || amountCents <= 0)}
              />
              {amount !== "" && (amountCents === null || amountCents <= 0) ? (
                <p className="crm-hint text-danger">Enter dollars and cents, like 400.00.</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="pay-ref" className="crm-label">
                {referenceFieldLabel(method)}
              </label>
              <input
                id="pay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === "stock" ? "10 shares · value on receipt date" : method === "check" ? "#4417" : "Reference (optional)"}
                maxLength={method === "check" ? 40 : 200}
                className="crm-input"
              />
            </div>
            <div>
              <label htmlFor="pay-date" className="crm-label">
                Received on
              </label>
              <input id="pay-date" type="date" max={today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="crm-input" />
            </div>
            <div>
              <label htmlFor="pay-envelope" className="crm-label">
                Envelope number (optional)
              </label>
              <input id="pay-envelope" value={envelope} onChange={(e) => setEnvelope(e.target.value)} className="crm-input" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pay-memo" className="crm-label">
                Memo (optional)
              </label>
              <input id="pay-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={280} className="crm-input" />
            </div>
          </div>
          {error ? (
            <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <button type="button" onClick={submit} disabled={pending || !household} className={buttonClass(household ? "primary" : "off")}>
              {pending ? "Saving…" : "Save payment"}
            </button>
          </div>
        </div>
      </Card>
      {previewCard}
    </>
  );
}
