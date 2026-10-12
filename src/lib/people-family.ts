// "Add a family" (People redesign, slice 6): the pieces the command, the Server Actions and the AddFamilySheet share. Pure: no server
// imports, so the sheet (a client component) can use the same parsers the server checks again with.

import { isEmail, normalizePhone } from "@/lib/people";

/** Why an existing family may be the one being added. Worded for the person in REASON_LABELS. */
export const FAMILY_MATCH_REASONS = ["mobile", "email", "name", "last_name"] as const;
export type FamilyMatchReason = (typeof FAMILY_MATCH_REASONS)[number];

export const FAMILY_MATCH_LABELS: Record<FamilyMatchReason, string> = {
  mobile: "Same mobile",
  email: "Same email",
  name: "Same name",
  last_name: "Same last name",
};

/** A family that may already be this one, as the sheet draws it: the household card's facts (never a name alone), adults only. */
export type FamilyMatchView = {
  householdId: string;
  reasons: FamilyMatchReason[];
  householdNumber: string | null;
  /** The community's own household ID (its own word for it comes from the community's settings). */
  orgHouseholdId: string | null;
  adults: string[];
  city: string | null;
  zone: string | null;
};

export type FamilyMatchesView = {
  /** How many families may match in all (only the strongest few are shown). */
  total: number;
  matches: FamilyMatchView[];
};

/** What the sheet sends to be checked or added. The mobile and email are what the person typed; the server normalises them. */
export type FamilyDraft = { firstName: string; lastName: string; contact: string; street: string };

/**
 * One box for "mobile or email": an at sign makes it an email, anything else is read as a mobile number. Empty gives neither. A mobile
 * number that is not complete yet (a person is still typing) is `incompletePhone`, not an error, so the matching check can wait for it.
 */
export function parseContact(text: string): { mobile: string | null; email: string | null; incompletePhone: boolean; badEmail: boolean; phoneProblem: string | null } {
  const raw = (text ?? "").trim();
  if (!raw) return { mobile: null, email: null, incompletePhone: false, badEmail: false, phoneProblem: null };
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    return isEmail(email) ? { mobile: null, email, incompletePhone: false, badEmail: false, phoneProblem: null } : { mobile: null, email: null, incompletePhone: false, badEmail: true, phoneProblem: null };
  }
  const phone = normalizePhone(raw);
  return phone.ok ? { mobile: phone.value, email: null, incompletePhone: false, badEmail: false, phoneProblem: null } : { mobile: null, email: null, incompletePhone: true, badEmail: false, phoneProblem: phone.error };
}

/** Whether there is enough typed to look for a family that may already be here: a last name of two letters, or a whole mobile or email. */
export function canCheckForMatches(d: FamilyDraft): boolean {
  const c = parseContact(d.contact);
  return d.lastName.trim().length >= 2 || !!c.mobile || !!c.email;
}

/** Whether the family can be added: a first and a last name, and a mobile or email that is complete when one is given. */
export function familyDraftProblem(d: FamilyDraft): string | null {
  if (!d.firstName.trim() || !d.lastName.trim()) return "Enter the first adult's first and last name.";
  const c = parseContact(d.contact);
  if (c.badEmail) return "That email address does not look right.";
  if (c.incompletePhone) return c.phoneProblem ? `${c.phoneProblem}.` : "That mobile number does not look right.";
  if (d.street.trim().length > 300) return "The street address is too long.";
  return null;
}

/** The family name as one line for a message: "Priya Shah" (first adult). */
export function familyAdultName(d: Pick<FamilyDraft, "firstName" | "lastName">): string {
  return `${d.firstName.trim()} ${d.lastName.trim()}`.trim();
}

export type RawFamilyMatch = { householdId: string; reasons: FamilyMatchReason[]; strength: number };

const isReason = (x: unknown): x is FamilyMatchReason => typeof x === "string" && (FAMILY_MATCH_REASONS as readonly string[]).includes(x);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database's answer to "which families may be this one" ({"total": n, "matches": [...]}), read defensively. Anything odd is left out. */
export function parseFamilyMatches(json: unknown): { total: number; matches: RawFamilyMatch[] } {
  const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const list = Array.isArray(obj.matches) ? obj.matches : [];
  const matches: RawFamilyMatch[] = [];
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    if (typeof r.household_id !== "string" || !UUID.test(r.household_id)) continue;
    const reasons = (Array.isArray(r.reasons) ? r.reasons : []).filter(isReason);
    matches.push({ householdId: r.household_id, reasons, strength: Number(r.strength ?? 0) || 0 });
  }
  const total = Math.max(matches.length, Number(obj.total ?? 0) || 0);
  return { total, matches };
}

/** The sentence over the matches: "2 families may already be this one". */
export function matchesHeading(total: number): string {
  if (total <= 0) return "No family like this yet.";
  return total === 1 ? "1 family may already be this one." : `${total} families may already be this one.`;
}

/** Strong signs (the same mobile or email, or the same whole name) first; a shared last name alone is a weaker hint. */
export function isStrongMatch(m: Pick<FamilyMatchView, "reasons">): boolean {
  return m.reasons.some((r) => r !== "last_name");
}
