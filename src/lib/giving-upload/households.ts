// Giving uploads: which household a row means. Pure. A household is never chosen by a name alone: an identifier of any kind (the
// community's household or member number, its own IDs, the old CRM's, QuickBooks', a learned bank payer name) that names exactly one
// household is a match; anything else (an identifier shared by two households, or a name) is a pick, made by the person with the
// household card in front of them. The database looks the values up (app.giving_upload_households, 0776).

import { identifierKindLabel } from "@/lib/identifiers";
import { familyFrom, type Family } from "@/lib/giving-today/queue";
import type { CardLabels } from "@/components/household-card";

/** One row of app.giving_upload_households. `matchKind` "name" means found by name only. */
export type HouseholdHit = {
  input: string;
  matchKind: string;
  householdId: string;
  personId: string | null;
  family: Family;
};

export type HouseholdMatch =
  | { status: "matched"; family: Family; via: string; personId: string | null }
  | { status: "pick"; why: "shared" | "name"; candidates: Family[] }
  | { status: "none" };

/** The database's rows as hits (the household card fields become a Family). */
export function hitsFrom(
  rows: readonly {
    input: string | null;
    match_kind: string | null;
    household_id: string | null;
    person_id: string | null;
    household_name: string | null;
    household_number: string | null;
    org_household_id: string | null;
    primary_member: string | null;
    city: string | null;
  }[],
): HouseholdHit[] {
  return rows
    .filter((r) => r.input && r.household_id)
    .map((r) => ({
      input: r.input!,
      matchKind: r.match_kind ?? "other",
      householdId: r.household_id!,
      personId: r.person_id,
      family: familyFrom({ ...r, household_id: r.household_id! }),
    }));
}

/** The key a value is looked up by (as the database trims it). */
export function lookupKey(value: string): string {
  return value.trim().slice(0, 200);
}

/** What a value in the household column means. */
export function matchHousehold(value: string, hits: readonly HouseholdHit[], labels: CardLabels): HouseholdMatch {
  const key = lookupKey(value);
  const mine = hits.filter((h) => h.input === key);
  const byId = mine.filter((h) => h.matchKind !== "name");
  const ids = [...new Set(byId.map((h) => h.householdId))];
  if (ids.length === 1) {
    const h = byId.find((x) => x.householdId === ids[0])!;
    const personHit = byId.find((x) => x.personId);
    return {
      status: "matched",
      family: h.family,
      via: `${identifierKindLabel(h.matchKind, { orgMemberLabel: labels.orgMemberLabel, orgHouseholdLabel: labels.orgHouseholdLabel })} ${key}`,
      personId: personHit?.personId ?? null,
    };
  }
  if (ids.length > 1) return { status: "pick", why: "shared", candidates: uniqueFamilies(byId) };
  const byName = mine.filter((h) => h.matchKind === "name");
  if (byName.length > 0) return { status: "pick", why: "name", candidates: uniqueFamilies(byName) };
  return { status: "none" };
}

function uniqueFamilies(hits: readonly HouseholdHit[]): Family[] {
  const seen = new Map<string, Family>();
  for (const h of hits) if (!seen.has(h.householdId)) seen.set(h.householdId, h.family);
  return [...seen.values()];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !["the", "and", "family", "household", "mr", "mrs", "ms", "dr"].includes(w));

/**
 * The optional "Name (to check)" column: true when the name in the file shares no word with the household it matched (its name or
 * primary adult). The row is then left for the person to look at; it is never matched or refused by a name.
 */
export function nameDisagrees(nameInFile: string, family: Family): boolean {
  const given = words(nameInFile);
  if (given.length === 0) return false;
  const known = new Set([...words(family.name), ...words(family.primary ?? "")]);
  return !given.some((w) => known.has(w));
}

/** "Several households have the ID 0127" / "Found by name only". */
export function pickReason(m: Extract<HouseholdMatch, { status: "pick" }>, value: string): string {
  return m.why === "shared"
    ? `${m.candidates.length} households have “${value}”. Pick the right one.`
    : "Found by name only. Pick the household: a name alone never chooses one.";
}
