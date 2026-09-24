"use client";

import { useState, useTransition, type FormEvent, type KeyboardEvent } from "react";

import { findHouseholdsAction, type HouseholdFinderResult } from "@/app/(app)/giving/actions";
import { HouseholdCard, type CardLabels, type HouseholdCardData } from "@/components/household-card";
import { buttonClass } from "@/components/ui";
import { identifierKindLabel } from "@/lib/identifiers";

/**
 * Find a household by name, member name or any identifier and pick it from
 * its disambiguation card — never from a bare name.
 */
export function HouseholdPicker({
  labels,
  timeZone,
  currency,
  onSelect,
  selectLabel = "Choose this household",
  autoFocus = false,
  idPrefix = "hh",
}: {
  labels: CardLabels;
  timeZone: string;
  currency: string;
  onSelect: (card: HouseholdCardData) => void;
  selectLabel?: string;
  autoFocus?: boolean;
  idPrefix?: string;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<HouseholdFinderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function search(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await findHouseholdsAction(query);
        if (!res.ok) {
          setResult(null);
          setError(res.error);
          return;
        }
        setResult(res.data ?? null);
      } catch (err) {
        console.error("[household-picker] search failed:", err);
        setError("Could not search households — the server did not respond. Try again.");
      }
    });
  }

  // A picker is often inside another form: handle Enter here instead of nesting forms.
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  }

  const ambiguousNames =
    result && new Set(result.cards.map((c) => (c.household_name ?? "").trim().toLowerCase())).size < result.cards.length;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor={`${idPrefix}-search`} className="crm-label">
            Find the household
          </label>
          <input
            id={`${idPrefix}-search`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
            placeholder={`Name, ${labels.orgMemberLabel}, ${labels.orgHouseholdLabel}, JSH-H-…, Zelle name…`}
            className="crm-input"
            autoComplete="off"
          />
        </div>
        <button type="button" onClick={() => search()} disabled={pending} className={buttonClass("secondary")}>
          {pending ? "Searching…" : "Search"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 rounded-lg border border-maroon/30 bg-maroon-50 px-3 py-2 text-sm text-maroon">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="mt-3 space-y-2" aria-live="polite">
          {result.hits.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-muted">
              {result.hits.map((h, i) => (
                <li key={`${h.kind}-${h.value}-${i}`}>
                  Matched <span className="font-semibold text-ink">{identifierKindLabel(h.kind, labels)}</span>{" "}
                  <span className="font-mono">{h.value}</span> →{" "}
                  {h.person_id ? `${h.display_name ?? "person"}, ${h.household_name ?? "household"}` : (h.household_name ?? h.display_name)}
                </li>
              ))}
            </ul>
          ) : null}
          {result.cards.length === 0 ? (
            <p className="text-sm text-muted">No household matches. Try an ID, or part of a member&apos;s name.</p>
          ) : null}
          {ambiguousNames || result.cards.length > 1 ? (
            <p className="rounded-md border border-saffron/40 bg-saffron-50 px-3 py-2 text-sm text-brown">
              Several households match — compare the IDs, members and zone before choosing.
            </p>
          ) : null}
          {result.cards.map((c) => (
            <HouseholdCard
              key={c.household_id}
              card={c}
              labels={labels}
              timeZone={timeZone}
              currency={currency}
              href={`/households/${c.household_id}`}
            >
              <button type="button" onClick={() => onSelect(c)} className={buttonClass("primary", "sm")}>
                {selectLabel}
              </button>
            </HouseholdCard>
          ))}
          {result.more ? <p className="text-xs text-muted">Showing the first 12 — refine the search to narrow it down.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
