"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { openPledgesAction, type OpenPledge } from "@/app/(app)/giving/actions";
import { Drawer } from "@/components/drawer";
import { HouseholdCard, type CardLabels, type HouseholdCardData } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";
import { useToast } from "@/components/toast";
import { DrawerSection, KeyValueRow, buttonClass } from "@/components/ui";
import { previewAllocation } from "@/lib/allocation";
import { formatDate } from "@/lib/dates";
import { monthYear } from "@/lib/giving";
import { formatCents } from "@/lib/money";

import { confirmBankMatchAction } from "./bank/actions";
import type { Suggestion } from "./bank/gift-line-matcher";

export type DafLine = { id: string; ref: string; source: string; amountCents: number; postedOn: string; memo: string; kind: string | null };

/**
 * "Match" on a DAF grant or matching gift (prototype drawer `dep`, L750–758):
 * apply to household (suggestions first), the allocation preview, and the
 * receipt rule — the fund's sponsor receipts the donor, so no tax receipt is
 * issued; the gift is credited to the household. The payer name is never
 * learned for a fund (it is not the family).
 */
export function DafMatchButton({
  line,
  suggestions,
  suggestionError,
  labels,
  timeZone,
  currency,
}: {
  line: DafLine;
  suggestions: Suggestion[];
  suggestionError: string | null;
  labels: CardLabels;
  timeZone: string;
  currency: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<HouseholdCardData | null>(null);
  const [picking, setPicking] = useState(false);
  const [pledges, setPledges] = useState<OpenPledge[] | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(card: HouseholdCardData) {
    setSelected(card);
    setPicking(false);
    setPledges(null);
    setPledgeError(null);
    setError(null);
    start(async () => {
      try {
        const res = await openPledgesAction(card.household_id);
        if (!res.ok) setPledgeError(res.error);
        else setPledges(res.data ?? []);
      } catch (err) {
        console.error("[daf] loading pledges failed:", err);
        setPledgeError("Could not load the household's open pledges — the server did not respond. Choose the household again.");
      }
    });
  }

  function openDrawer() {
    setOpen(true);
    const first = suggestions.find((s) => !s.ambiguous);
    if (first && !selected) choose(first);
  }

  function apply() {
    if (!selected) return setError("Choose the household first.");
    setError(null);
    start(async () => {
      try {
        const res = await confirmBankMatchAction({ txnId: line.id, householdId: selected.household_id, pledgeIds: null, learnPayer: false });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        toast?.show(`${line.ref} applied to ${res.data?.householdName ?? selected.household_name ?? "the household"} · queued for QuickBooks`, "ok");
        setOpen(false);
        router.refresh();
      } catch (err) {
        console.error("[daf] apply failed:", err);
        setError("Could not apply the gift — the server did not respond. Reload to see whether it went through before trying again.");
      }
    });
  }

  const preview = pledges ? previewAllocation(line.amountCents, pledges) : null;
  const byId = new Map((pledges ?? []).map((p) => [p.id, p]));
  const selectedIsSuggested = selected ? suggestions.some((s) => s.household_id === selected.household_id) : false;

  return (
    <>
      <button type="button" onClick={openDrawer} className={buttonClass("primary", "xs")}>
        Match
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        kicker={`MATCH DEPOSIT · ${line.ref}`}
        title={line.source}
        subtitle={`${formatCents(line.amountCents, currency)} · ${formatDate(line.postedOn, timeZone)} · ${line.memo}`}
        footer={
          <button type="button" onClick={apply} disabled={pending || !selected} className={buttonClass(selected ? "primary" : "off", "sm")}>
            {pending ? "Applying…" : "Apply to household"}
          </button>
        }
      >
        <DrawerSection title="APPLY TO HOUSEHOLD">
          {suggestionError ? <p className="text-[13px] text-danger">{suggestionError}</p> : null}
          {suggestions.map((s) => {
            const on = selected?.household_id === s.household_id;
            return (
              <button
                key={s.household_id}
                type="button"
                onClick={() => choose(s)}
                aria-pressed={on}
                className={`cc-kv w-full text-left ${on ? "border border-navy bg-navy-50" : "border border-line bg-white"}`}
              >
                <span className="min-w-0">
                  {s.household_name ?? "Household"} {s.household_number ? <span className="font-mono text-xs text-muted">{s.household_number}</span> : null}
                  <span className="block text-xs text-muted">
                    {/statement mentions|memo/i.test(s.reason) ? "suggested from memo · " : ""}
                    {s.reason}
                    {s.ambiguous ? " · check the details, several households match" : ""}
                  </span>
                </span>
                <span className={`whitespace-nowrap font-bold ${on ? "text-navy" : "text-muted"}`}>{on ? "Selected" : "Choose"}</span>
              </button>
            );
          })}
          {suggestions.length === 0 && !suggestionError ? <p className="text-[13px] text-muted">No household suggested — find it by name or any ID.</p> : null}
          {selected && !selectedIsSuggested ? (
            <HouseholdCard card={selected} labels={labels} timeZone={timeZone} currency={currency} tone="selected" />
          ) : null}
          {picking ? (
            <HouseholdPicker labels={labels} timeZone={timeZone} currency={currency} onSelect={choose} idPrefix={`daf-${line.id.slice(0, 6)}`} />
          ) : (
            <button type="button" onClick={() => setPicking(true)} className={buttonClass("ghost", "xs")}>
              Find another household
            </button>
          )}
        </DrawerSection>
        <DrawerSection title="ALLOCATION PREVIEW · EARLIEST OPEN PLEDGE FIRST">
          {!selected ? (
            <p className="text-[13px] text-muted">Choose a household to see the allocation.</p>
          ) : pledgeError ? (
            <p className="text-[13px] text-danger">{pledgeError}</p>
          ) : !preview ? (
            <p className="text-[13px] text-muted">Loading open pledges…</p>
          ) : preview.lines.length === 0 ? (
            <KeyValueRow label="No open pledges" value="Stays unapplied as a general gift" tone="warn" />
          ) : (
            <>
              {preview.lines.map((l) => {
                const p = byId.get(l.pledge_id);
                return (
                  <KeyValueRow
                    key={l.pledge_id}
                    label={`${p?.campaign ?? p?.source.replace(/_/g, " ") ?? "Pledge"} · ${p ? monthYear(p.pledged_at, timeZone) : ""}`}
                    value={`${formatCents(l.amount_cents, currency)}${l.closes ? " · closes" : " · partial"}`}
                    tone="ok"
                  />
                );
              })}
              {preview.unallocated_cents > 0 ? (
                <KeyValueRow label="Remaining, unapplied (general gift)" value={formatCents(preview.unallocated_cents, currency)} tone="warn" />
              ) : null}
            </>
          )}
        </DrawerSection>
        <DrawerSection title="RECEIPT">
          <KeyValueRow label="Tax receipt" value={line.kind === "matching_gift" ? "Not issued · the matching platform receipts its donor" : "Not issued · the DAF sponsor receipts the donor"} />
          <KeyValueRow label="Recognition" value={line.kind === "matching_gift" ? "Credited to household as a matching gift" : "Credited to household as a DAF grant"} />
        </DrawerSection>
        {error ? (
          <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </Drawer>
    </>
  );
}
