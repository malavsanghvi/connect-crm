// QuickBooks donor matches waiting for a person (o-qbo-match, 0240), grouped for Giving › Today and Books. Pure.
//
// A QuickBooks customer can have several suggested households. Only a customer with exactly ONE suggestion is approved in a row:
// a customer with several is a choice between households, made in Donor matching where they are side by side. Nothing is
// approved on its own; every Approve names the QuickBooks customer and the household, and asks for a reason (the audit log).

import { confidencePct, methodLabel, readEvidence } from "@/lib/qbo-match";

export type MatchRow = {
  id: string;
  qbo_customer_id: string;
  household_id: string;
  confidence: number | string | null;
  method: string | null;
  evidence: unknown;
};

export type DonorSuggestion = {
  matchId: string;
  qboCustomerId: string;
  /** The QuickBooks customer's display name, as QuickBooks has it. */
  qboName: string;
  /** "Email · 97%": how it was matched and how sure. */
  how: string;
  householdId: string;
  confidence: number;
};

export type DonorGroups = {
  /** QuickBooks customers with at least one suggestion. */
  customers: number;
  /** Customers with exactly one suggestion, the surest first. */
  single: DonorSuggestion[];
  /** Customers with more than one suggested household. */
  several: number;
};

const num = (c: number | string | null) => {
  const n = typeof c === "string" ? Number(c) : c;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

export function groupSuggestions(rows: readonly MatchRow[]): DonorGroups {
  const byCustomer = new Map<string, MatchRow[]>();
  for (const r of rows) byCustomer.set(r.qbo_customer_id, [...(byCustomer.get(r.qbo_customer_id) ?? []), r]);
  const single: DonorSuggestion[] = [];
  let several = 0;
  for (const [customer, list] of byCustomer) {
    const households = new Set(list.map((r) => r.household_id));
    if (households.size > 1) {
      several += 1;
      continue;
    }
    const r = list.reduce((a, b) => (num(b.confidence) > num(a.confidence) ? b : a));
    const ev = readEvidence(r.evidence);
    single.push({
      matchId: r.id,
      qboCustomerId: customer,
      qboName: ev.qb.display_name ?? ev.qb.company ?? `QuickBooks customer ${customer}`,
      how: `${methodLabel(r.method)} · ${confidencePct(r.confidence)}`,
      householdId: r.household_id,
      confidence: num(r.confidence),
    });
  }
  single.sort((a, b) => b.confidence - a.confidence || a.qboName.localeCompare(b.qboName));
  return { customers: byCustomer.size, single, several };
}
