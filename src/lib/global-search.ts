// Global search in the portal top bar: households and people. Pure mapping
// from the database rows to result rows, so the component and the tests
// agree on what a result looks like. The query itself runs in
// src/app/(app)/search/actions.ts.

export const GLOBAL_SEARCH_MIN_CHARS = 2;
export const GLOBAL_SEARCH_LIMIT = 8;

export type GlobalSearchResult = {
  kind: "household" | "person";
  id: string;
  /** Bold first line, e.g. "Shah, Priya & Rahul". */
  title: string;
  /** Second line that tells two same-named records apart (never the name alone). */
  detail: string;
  href: string;
};

export type HouseholdSearchRow = {
  household_id: string;
  household_name: string | null;
  household_number: string | null;
  org_household_id: string | null;
  members: string | null;
  city: string | null;
};

export type PersonSearchRow = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  member_number: string | null;
};

export type PersonHouseholdRow = { person_id: string; household_name: string | null };

/** Trim and collapse whitespace; null when too short to search. */
export function normalizeSearchQuery(raw: string): string | null {
  const q = raw.replace(/\s+/g, " ").trim();
  return q.length >= GLOBAL_SEARCH_MIN_CHARS ? q.slice(0, 80) : null;
}

function join(parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");
}

export function householdResult(row: HouseholdSearchRow, orgHouseholdLabel: string): GlobalSearchResult {
  return {
    kind: "household",
    id: row.household_id,
    title: (row.household_name ?? "").trim() || "Household without a name",
    detail: join([
      row.household_number ? `Household no. ${row.household_number}` : null,
      row.org_household_id ? `${orgHouseholdLabel} ${row.org_household_id}` : null,
      row.members ? `Members: ${row.members}` : null,
      row.city,
    ]),
    href: `/households/${row.household_id}`,
  };
}

export function personResult(row: PersonSearchRow, householdName: string | null | undefined): GlobalSearchResult {
  const first = (row.preferred_name ?? "").trim() || row.first_name;
  return {
    kind: "person",
    id: row.id,
    title: `${first} ${row.last_name}`.trim(),
    detail: join([
      row.member_number ? `Member no. ${row.member_number}` : "No member number",
      householdName ? `Household: ${householdName}` : "Not in a household",
    ]),
    href: `/people/${row.id}`,
  };
}

/** Households first (the prototype searches households first), then people; duplicates dropped. */
export function mapGlobalSearch(
  households: HouseholdSearchRow[],
  people: PersonSearchRow[],
  personHouseholds: PersonHouseholdRow[],
  orgHouseholdLabel: string,
  limit = GLOBAL_SEARCH_LIMIT,
): GlobalSearchResult[] {
  const hhName = new Map(personHouseholds.map((r) => [r.person_id, r.household_name]));
  const seen = new Set<string>();
  const out: GlobalSearchResult[] = [];
  for (const h of households) {
    if (seen.has(`h:${h.household_id}`)) continue;
    seen.add(`h:${h.household_id}`);
    out.push(householdResult(h, orgHouseholdLabel));
  }
  const hhResults = out.slice(0, Math.ceil(limit / 2));
  const peopleResults: GlobalSearchResult[] = [];
  for (const p of people) {
    if (seen.has(`p:${p.id}`)) continue;
    seen.add(`p:${p.id}`);
    peopleResults.push(personResult(p, hhName.get(p.id)));
  }
  // Fill up to the limit: half each when both have plenty, otherwise whichever has more.
  const room = limit - hhResults.length;
  const people_ = peopleResults.slice(0, room);
  const extraHh = out.slice(hhResults.length, hhResults.length + (room - people_.length));
  return [...hhResults, ...extraHh, ...people_];
}
