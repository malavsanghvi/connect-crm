// Pure helpers for the Settings commands about roles (B90 phase 4): finding a role by what a person calls it, telling the adults
// from the children among the people who hold roles, and saying a grant in plain words. No server imports.
//
// The rules about WHO MAY GRANT WHAT (platform roles, family roles, a role for yourself, the second person) are not here: they live
// in the Server Action today (src/app/(app)/settings/roles/actions.ts) and in the database trigger app.enforce_role_grant. The
// helpers below only describe.

import { isAdultMember } from "@/lib/commands/child-filter";
import { addDays } from "@/lib/dates";

export type RoleName = { key: string; name: string; tier: string };

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** Words that mean nothing when someone names a role: "the treasurer role" is "treasurer". */
const FILLER = new Set(["the", "a", "an", "role", "roles", "of", "for", "as", "our", "my"]);

/**
 * The roles a person means by this text, best matches only. An exact name or key wins; then a role whose name holds every word they
 * typed. A role is never guessed from one word of several ("platform admin" is not "Center admin"). Several results mean the
 * question is ambiguous (ask which).
 */
export function matchRoles<R extends RoleName>(query: string, roles: readonly R[]): R[] {
  const q = words(query).filter((w) => !FILLER.has(w));
  if (q.length === 0) return [];
  const joined = q.join(" ");
  const score = (r: R): number => {
    const name = words(r.name).join(" ");
    const key = words(r.key).join(" ");
    if (name === joined || key === joined) return 3;
    const have = new Set([...words(r.name), ...words(r.key)]);
    return q.every((w) => have.has(w)) ? 2 : 0;
  };
  const scored = roles.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0);
  const best = Math.max(0, ...scored.map((x) => x.s));
  return scored.filter((x) => x.s === best).map((x) => x.r);
}

/** "Whole community", "Event: Diwali Dinner" ... */
export function scopeWords(kind: string, name: string | null): string {
  if (kind === "center" || kind === "platform") return "The whole community";
  const label = kind === "event" ? "Event" : kind === "class" ? "Class" : kind === "zone" ? "Zone" : "One part of the community";
  return name ? `${label}: ${name}` : label;
}

/** The last day of a grant as people say it: "until October 10, 2027", or "until someone takes it away". */
export function endsWords(endsOn: string | null): string {
  if (!endsOn) return "until someone takes it away";
  const [y, m, d] = endsOn.split("-").map(Number);
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
  return `until ${month} ${d}, ${y}`;
}

/** `iso` (YYYY-MM-DD) plus whole months, keeping the day (the last day of a shorter month when it does not exist), minus one day: "for a year" from Oct 11 ends Oct 10. */
export function lastDayAfterMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastOfMonth);
  const start = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return addDays(start, -1);
}

// ---------------------------------------------------------------------------
// Adults only (D2): who may be named in an answer
// ---------------------------------------------------------------------------
export type HolderPerson = { date_of_birth: string | null; household_roles: readonly string[] };

/**
 * A person who holds a role is named only when nothing says they are under 18. A birth date decides; with none on file, any
 * household relationship that is not a head, spouse or parent (a child, a sibling, "other") counts as a child, and a person with
 * no household at all (a staff login) counts as an adult. The caller says how many were left out.
 */
export function isAdultHolder(p: HolderPerson, today: string): boolean {
  if (p.date_of_birth) return isAdultMember({ date_of_birth: p.date_of_birth }, today);
  if (p.household_roles.length === 0) return true;
  return p.household_roles.every((role) => isAdultMember({ date_of_birth: null, role }, today));
}
