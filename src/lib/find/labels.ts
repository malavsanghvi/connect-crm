// Words for the find box: what an identifier is called, and the one-line household card. Pure. The organization's own words
// (what it calls its member and household IDs, the names of the systems it came from) come from its identifier rules.

import type { HouseholdCard } from "@/lib/commands/types";

import type { IdentifierHit } from "./types";

export type IdLabelRules = {
  orgMemberLabel: string;
  orgHouseholdLabel: string;
  legacySystems: readonly { system: string; label: string }[];
};

/** What an identifier is called in a "why it matched" tag: "Old system ID", "QuickBooks customer", the organization's own label. */
export function idLabel(hit: Pick<IdentifierHit, "kind" | "system">, rules: IdLabelRules): string {
  switch (hit.kind) {
    case "connect_member":
      return "Member no.";
    case "connect_household":
      return "Household no.";
    case "org_member":
      return rules.orgMemberLabel;
    case "org_household":
      return rules.orgHouseholdLabel;
    case "crm": {
      const own = rules.legacySystems.find((s) => s.system === hit.system)?.label;
      return own ?? "Old system ID";
    }
    case "accounting":
      return hit.system === "quickbooks" ? "QuickBooks customer" : "Accounting customer ID";
    case "bank_payer":
      return "Bank payer name";
    case "payment_provider":
      return "Payment provider customer";
    default:
      return "Other ID";
  }
}

/**
 * The household in one line, never a name alone: "No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside · North Riverside".
 * The adults only (a child is never named on a card line), the household number, the organization's own household ID, the city
 * and the area.
 */
export function householdCardLine(card: Pick<HouseholdCard, "household_number" | "org_household_id" | "adults" | "household_name" | "city" | "zone">): string {
  const adults = card.adults.slice(0, 3).join(" & ");
  const more = card.adults.length > 3 ? ` +${card.adults.length - 3}` : "";
  const who = adults ? `${adults}${more}` : null;
  const parts = [card.household_number ? `No. ${card.household_number}` : "No household number", card.org_household_id, who, card.city, card.zone && card.zone !== card.city ? card.zone : null];
  return parts.filter((p): p is string => !!p && p.trim() !== "").join(" · ");
}
