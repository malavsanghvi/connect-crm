// Households that are already in the records, prepared for the onboarding matcher (pure; no I/O).
//
// The server action (actions.ts) reads them under the signed-in user's row-level security: only the columns the
// matcher needs, a page at a time. This file turns what it read into matcher rows and plain words. An uploaded row
// that belongs to one of these households is linked to it, never added as a duplicate.
//
// HOW AN EXISTING HOUSEHOLD IS NAMED TO THE IMPORT TOOL. The import engine already resolves a household link
// (app.import_ref) from any of: the organization's own household ID, a legacy CRM ID, a key an earlier import
// registered, or the Connect household number. Every household has a Connect number (a trigger issues one on
// insert, 0012), so the people and donation files point at an existing household by that number, in the same
// "Household ID (old system)" column the new households use. Nothing is added to the household and no schema
// change is needed (supabase/tests/47_onboarding_progress_test.sql pins this).

import type { Json } from "@/lib/database.types";

import type { ExistingRef, PayerInput } from "./match";

export type ExistingPerson = { name: string; email: string | null; phone: string | null };

export type ExistingHousehold = {
  id: string;
  /** The Connect household number (the reference the import tool takes). */
  number: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  zip: string | null;
  /** Current members: name, email and mobile are what the matcher compares. */
  people: ExistingPerson[];
  /** Names the household has paid under: bank payer names and the "Also paid as" custom field. */
  aliases: string[];
};

/** Row numbers of the records' own rows start here, far above any uploaded row (a file is at most ~20 MB). */
export const EXISTING_ROW_BASE = 10_000_000;

export const refOfExisting = (h: Pick<ExistingHousehold, "id" | "number" | "name">): ExistingRef => ({ householdId: h.id, number: h.number, label: h.name });

/**
 * The matcher rows for the records' households: one row for the household's own name, one per person and one per
 * name it has paid under, all at the household's address and all tagged with it. Rows that share a tag are one
 * household without asking, and never join another tagged household.
 */
export function existingToInputs(list: readonly ExistingHousehold[]): PayerInput[] {
  const out: PayerInput[] = [];
  let rowNo = EXISTING_ROW_BASE;
  for (const h of list) {
    const existing = refOfExisting(h);
    const at = { address1: h.address1, address2: h.address2, zip: h.zip };
    const push = (name: string, extra: Partial<PayerInput> = {}) => {
      if (name.trim()) out.push({ rowNo: rowNo++, name, ...at, ...extra, existing });
    };
    push(h.name);
    for (const p of h.people) push(p.name, { email: p.email, phone: p.phone });
    for (const a of h.aliases) push(a);
  }
  return out;
}

/** "Also paid as" holds names separated by semicolons (or one per line). */
export function parseAliases(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[;\n]/)) {
    const name = part.replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** One line that tells two households with the same name apart (the founder rule: never by name alone). */
export function describeExisting(h: Pick<ExistingHousehold, "number" | "city" | "address1" | "people">): string {
  const members = h.people.map((p) => p.name).filter(Boolean);
  const shown = members.slice(0, 4).join(", ") + (members.length > 4 ? ` and ${members.length - 4} more` : "");
  return [h.number, h.address1 || h.city || null, members.length ? `members: ${shown}` : "no members yet"].filter(Boolean).join(" · ");
}

// ── Putting what the server read together ──────────────────────────────────────

export type ExistingSources = {
  households: readonly { id: string; display_name: string; household_number: string | null; address_line1: string | null; address_line2: string | null; city: string | null; postal_code: string | null; custom?: Json }[];
  /** Current members only (the server asks for rows without a leaving date). */
  members: readonly { household_id: string; person_id: string }[];
  people: readonly { id: string; first_name: string; last_name: string; preferred_name: string | null; email: string | null; phone_e164: string | null }[];
  /** Bank payer names (external IDs of that kind) with the household they belong to. */
  payerNames: readonly { household_id: string | null; value: string }[];
  /** Staff-only custom values of households (kept apart from the record), by household id. */
  staffValues: readonly { record_key: string; custom: Json }[];
  /** The key of the "Also paid as" custom field, when the organization has one. */
  aliasKey: string | null;
};

function customValue(custom: Json | undefined, key: string): unknown {
  return custom && typeof custom === "object" && !Array.isArray(custom) ? (custom as Record<string, Json>)[key] : undefined;
}

/**
 * The households of the records in the form the matcher takes. A household's payer names come from the bank payer
 * names learned for it and from its "Also paid as" custom field, wherever the organization keeps that value. A
 * household with no Connect number cannot be named to the import tool, so it is counted and left out.
 */
export function assembleExisting(src: ExistingSources): { households: ExistingHousehold[]; withoutNumber: number } {
  const personById = new Map(src.people.map((p) => [p.id, p]));
  const peopleOf = new Map<string, ExistingPerson[]>();
  for (const m of src.members) {
    const p = personById.get(m.person_id);
    if (!p) continue;
    const list = peopleOf.get(m.household_id) ?? [];
    list.push({ name: `${p.first_name} ${p.last_name}`.trim(), email: p.email || null, phone: p.phone_e164 });
    // What a person likes to be called is another name a cheque may carry.
    const liked = p.preferred_name?.trim();
    if (liked && liked.toLowerCase() !== p.first_name.trim().toLowerCase()) list.push({ name: `${liked} ${p.last_name}`.trim(), email: null, phone: null });
    peopleOf.set(m.household_id, list);
  }
  const aliasesOf = new Map<string, string[]>();
  const addAlias = (id: string, text: unknown) => {
    const add = parseAliases(text);
    if (add.length) aliasesOf.set(id, [...(aliasesOf.get(id) ?? []), ...add]);
  };
  for (const r of src.payerNames) if (r.household_id) addAlias(r.household_id, r.value);
  if (src.aliasKey) for (const r of src.staffValues) addAlias(r.record_key, customValue(r.custom, src.aliasKey));

  let withoutNumber = 0;
  const households: ExistingHousehold[] = [];
  for (const h of src.households) {
    if (!h.household_number) {
      withoutNumber++;
      continue;
    }
    if (src.aliasKey) addAlias(h.id, customValue(h.custom, src.aliasKey));
    households.push({
      id: h.id,
      number: h.household_number,
      name: h.display_name,
      address1: h.address_line1,
      address2: h.address_line2,
      city: h.city,
      zip: h.postal_code,
      people: peopleOf.get(h.id) ?? [],
      // The same name written twice (or in another case) counts once.
      aliases: dedupeNames(aliasesOf.get(h.id) ?? []),
    });
  }
  return { households, withoutNumber };
}

function dedupeNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
