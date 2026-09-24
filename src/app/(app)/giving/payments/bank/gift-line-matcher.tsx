"use client";

import { useState, useTransition } from "react";

import { openPledgesAction, type OpenPledge } from "@/app/(app)/giving/actions";
import { HouseholdCard, type CardLabels, type HouseholdCardData } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";
import { Badge, buttonClass } from "@/components/ui";
import { previewAllocation } from "@/lib/allocation";
import { formatCents } from "@/lib/money";

import { confirmBankMatchAction } from "./actions";
import { useReportOutcome } from "./bank-results";

export type Suggestion = HouseholdCardData & { score: number; reason: string; ambiguous: boolean };

type Choice = { card: HouseholdCardData; ambiguous: boolean; fromSuggestion: boolean };

/**
 * Match one incoming bank line (Zelle, ACH, wire, DAF…) to a household.
 * Unambiguous suggestions can be confirmed in one click; ambiguous ones and
 * manual picks open a review panel that must be confirmed explicitly.
 */
export function GiftLineMatcher({
  txnId,
  amountCents,
  payerName,
  originatorKind,
  suggestions,
  suggestionError,
  labels,
  timeZone,
  currency,
  canConfirm,
}: {
  txnId: string;
  amountCents: number;
  payerName: string | null;
  originatorKind: string | null;
  suggestions: Suggestion[];
  suggestionError: string | null;
  labels: CardLabels;
  timeZone: string;
  currency: string;
  canConfirm: boolean;
}) {
  const report = useReportOutcome();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [searching, setSearching] = useState(false);
  const [specific, setSpecific] = useState(false);
  const [pledges, setPledges] = useState<OpenPledge[] | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [learn, setLearn] = useState(originatorKind === null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isPlatformGift = originatorKind === "daf" || originatorKind === "matching_gift" || originatorKind === "payroll_giving";

  function open(card: HouseholdCardData, ambiguous: boolean, fromSuggestion: boolean) {
    setChoice({ card, ambiguous, fromSuggestion });
    setSearching(false);
    setSpecific(false);
    setPledges(null);
    setChosen([]);
    setChecked(false);
    setError(null);
  }

  function loadPledges(householdId: string) {
    setPledgeError(null);
    startTransition(async () => {
      try {
        const res = await openPledgesAction(householdId);
        if (!res.ok) setPledgeError(res.error);
        else setPledges(res.data ?? []);
      } catch (err) {
        console.error("[bank] loading pledges failed:", err);
        setPledgeError("Could not load open pledges — the server did not respond. Try again.");
      }
    });
  }

  function confirm(card: HouseholdCardData, pledgeIds: string[] | null) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await confirmBankMatchAction({ txnId, householdId: card.household_id, pledgeIds, learnPayer: learn && !isPlatformGift });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const d = res.data!;
        report({
          id: txnId,
          title: `${formatCents(d.amountCents, currency)} matched to ${d.householdName} — receipt ${d.receiptNumber ?? "pending"}`,
          lines: [
            d.applied.length > 0
              ? `Applied to ${d.applied.map((a) => `${a.pledge_number ?? "pledge"} (${formatCents(a.amount_cents, currency)})`).join(", ")}.`
              : "Not applied to a pledge (no open pledges).",
            d.learnedPayer
              ? `Learned payer name "${d.learnedPayer.value}" for this household (seen ${d.learnedPayer.times}×) — next time it is suggested first.`
              : isPlatformGift
                ? "Payer name not learned: it is a fund or platform, not the family."
                : "Payer name not learned.",
          ],
        });
      } catch (err) {
        console.error("[bank] confirm failed:", err);
        setError("Could not confirm the match — the server did not respond. Reload the page to see whether it went through before trying again.");
      }
    });
  }

  if (!canConfirm) {
    return (
      <SuggestionList
        suggestions={suggestions}
        labels={labels}
        timeZone={timeZone}
        currency={currency}
        renderActions={() => null}
        suggestionError={suggestionError}
      />
    );
  }

  if (choice) {
    const preview = pledges ? previewAllocation(amountCents, pledges, specific ? chosen : null) : null;
    const needsCheck = choice.ambiguous;
    return (
      <div className="space-y-3 rounded-lg border border-navy/30 bg-navy-50/40 p-3">
        {choice.ambiguous ? (
          <p className="rounded-md border border-saffron/50 bg-saffron-50 px-3 py-2 text-sm font-semibold text-brown" role="alert">
            Several households match this name — check the details before confirming.
          </p>
        ) : null}
        <HouseholdCard card={choice.card} labels={labels} timeZone={timeZone} currency={currency} tone="selected" href={`/households/${choice.card.household_id}`} />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={specific}
            onChange={(e) => {
              setSpecific(e.target.checked);
              if (e.target.checked && pledges === null) loadPledges(choice.card.household_id);
            }}
            className="h-5 w-5"
          />
          Apply to specific pledges (otherwise the earliest open pledge first)
        </label>
        {specific ? (
          pledgeError ? (
            <p role="alert" className="text-sm text-danger">
              {pledgeError}
            </p>
          ) : pledges === null ? (
            <p className="text-sm text-muted">Loading open pledges…</p>
          ) : pledges.length === 0 ? (
            <p className="text-sm text-muted">No open pledges — the payment will be recorded unapplied.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {pledges.map((p) => {
                const line = preview?.lines.find((l) => l.pledge_id === p.id);
                return (
                  <li key={p.id}>
                    <label className="flex min-h-9 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={chosen.includes(p.id)}
                        onChange={() => setChosen((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))}
                        className="h-5 w-5"
                      />
                      <span className="font-mono">{p.pledge_number ?? "pledge"}</span>
                      <span className="text-muted">{p.campaign ?? p.source.replace(/_/g, " ")}</span>
                      <span>{formatCents(p.amount_cents - p.paid_cents, currency)} open</span>
                      {line ? <Badge tone={line.closes ? "success" : "navy"}>{line.closes ? "closes" : `${formatCents(line.amount_cents, currency)} applied`}</Badge> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={learn && !isPlatformGift} disabled={isPlatformGift || !payerName} onChange={(e) => setLearn(e.target.checked)} className="h-5 w-5" />
          {isPlatformGift
            ? "Payer name is a fund or platform, so it is never learned as the family's name"
            : payerName
              ? `Remember "${payerName}" as this household's bank payer name`
              : "No payer name on this line to remember"}
        </label>
        {needsCheck ? (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-5 w-5" />
            I checked the IDs and members — this is the right household, not just a matching name
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || (needsCheck && !checked) || (specific && chosen.length === 0 && (pledges?.length ?? 0) > 0)}
            onClick={() => confirm(choice.card, specific && chosen.length > 0 ? chosen : null)}
            className={buttonClass("primary", "sm")}
          >
            {pending ? "Confirming…" : `Confirm ${formatCents(amountCents, currency)} for this household`}
          </button>
          <button type="button" onClick={() => setChoice(null)} disabled={pending} className={buttonClass("ghost", "sm")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <SuggestionList
        suggestions={suggestions}
        labels={labels}
        timeZone={timeZone}
        currency={currency}
        suggestionError={suggestionError}
        renderActions={(s) =>
          s.ambiguous ? (
            <button type="button" onClick={() => open(s, true, true)} className={buttonClass("secondary", "sm")}>
              Review this household…
            </button>
          ) : (
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => confirm(s, null)}
                className={buttonClass("primary", "sm")}
                title="Records the payment, applies it to the earliest open pledge and learns the payer name"
              >
                {pending ? "Confirming…" : "Confirm match"}
              </button>
              <button type="button" onClick={() => open(s, false, true)} className={buttonClass("ghost", "sm")}>
                Options…
              </button>
            </span>
          )
        }
      />
      {searching ? (
        <div className="rounded-lg border border-line p-3">
          <HouseholdPicker
            labels={labels}
            timeZone={timeZone}
            currency={currency}
            idPrefix={`bank-${txnId.slice(0, 8)}`}
            selectLabel="Match to this household…"
            onSelect={(card) => open(card, false, false)}
          />
          <button type="button" onClick={() => setSearching(false)} className={`${buttonClass("ghost", "sm")} mt-2`}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setSearching(true)} className={buttonClass("ghost", "sm")}>
          {suggestions.length > 0 ? "Match to a different household…" : "Find the household…"}
        </button>
      )}
    </div>
  );
}

function SuggestionList({
  suggestions,
  labels,
  timeZone,
  currency,
  renderActions,
  suggestionError,
}: {
  suggestions: Suggestion[];
  labels: CardLabels;
  timeZone: string;
  currency: string;
  renderActions: (s: Suggestion) => React.ReactNode;
  suggestionError: string | null;
}) {
  if (suggestionError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {suggestionError}
      </p>
    );
  }
  if (suggestions.length === 0) return <p className="text-sm text-muted">No suggestions — find the household by name or ID.</p>;
  const anyAmbiguous = suggestions.some((s) => s.ambiguous);
  return (
    <div className="space-y-2">
      {anyAmbiguous ? (
        <p className="rounded-md border border-saffron/50 bg-saffron-50 px-3 py-2 text-sm font-semibold text-brown">
          Several households match this name — check the details and choose explicitly.
        </p>
      ) : null}
      {suggestions.slice(0, 4).map((s) => (
        <HouseholdCard
          key={s.household_id}
          card={s}
          labels={labels}
          timeZone={timeZone}
          currency={currency}
          tone={s.ambiguous ? "warning" : "plain"}
          href={`/households/${s.household_id}`}
        >
          <p className="mb-2 text-sm">
            <Badge tone={s.ambiguous ? "warning" : s.score >= 0.9 ? "success" : "navy"}>
              {s.ambiguous ? "Ambiguous · " : ""}
              {Math.round(Number(s.score) * 100)}% match
            </Badge>{" "}
            <span className="text-muted">{s.reason}</span>
          </p>
          {renderActions(s)}
        </HouseholdCard>
      ))}
    </div>
  );
}
