// Contact-gap lists, the pure part: which ADULTS have no email, no mobile, no street address or no app account, and how those people
// become rows and CSV lines. The loader (gap-load.ts) reads the people; this decides. Nothing here reads or writes, and nothing here
// is specific to one kind of organization.
//
// Children (plan section 7, D2): a child has no email or mobile field, so a list of "who has no email" would be a list of children.
// Every list here is adults only, whatever band the URL asks for, and a child's name never appears in a row or a line of an export.

import { isAdultMember } from "@/lib/commands/child-filter";
import { foldName } from "@/lib/commands/name-fold";
import { ageOn } from "@/lib/dates";
import { effectiveBand, GAP_KEYS, type HouseholdFilters } from "@/lib/people-v2/ask";
import { formatPhone } from "@/lib/people";

/** One person as the gap list needs them: facts only, read under the signed-in person's own access. */
export type GapPerson = {
  id: string;
  name: string;
  memberNumber: string | null;
  email: string | null;
  /** E.164, as stored. */
  phone: string | null;
  dateOfBirth: string | null;
  /** The role in the household this person is the head of or belongs to: it decides adulthood when no birth date is on file. */
  role: string | null;
  /** A signed-in app account exists for this person. */
  onApp: boolean;
  /** On a team or a role, as far as the viewer can see (only used by the "on a team or role" band). */
  onTeam: boolean;
  household: { id: string; name: string; number: string | null; hasAddress: boolean; zoneId: string | null } | null;
};

export type GapContext = { today: string; majority: number };

/** An empty, missing or blank-only value. */
export const isBlank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === "";

/** Does this person have every gap the filters ask for? A gap is true when the thing is missing. */
export function hasGaps(p: GapPerson, f: HouseholdFilters): boolean {
  if (f.noEmail === true && !isBlank(p.email)) return false;
  if (f.noMobile === true && !isBlank(p.phone)) return false;
  // A person in no family has no address on file either.
  if (f.noAddress === true && p.household?.hasAddress) return false;
  if (f.notOnApp === true && p.onApp) return false;
  return true;
}

/** Is this person in the list's age band? Always adults (or older); see the note at the top. */
export function inBand(p: GapPerson, f: HouseholdFilters, ctx: GapContext): boolean {
  if (!isAdultMember({ date_of_birth: p.dateOfBirth, role: p.role }, ctx.today, ctx.majority)) return false;
  const band = effectiveBand(f);
  // A list of children is never made: someone who is an adult is not "under 18".
  if (band === "minors") return false;
  if (band === "seniors") return (ageOn(p.dateOfBirth, ctx.today) ?? -1) >= 65;
  if (band === "roles") return p.onTeam;
  return true;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Does the typed search find this person? By their own name (any script, accents ignored), or through their family: `searchIds` is
 * the families the server's search found by name, number or any identifier. No search asked: everyone.
 */
export function matchesSearch(p: GapPerson, q: string | null, searchIds: ReadonlySet<string> | null): boolean {
  if (!q) return true;
  if (p.household && searchIds?.has(p.household.id)) return true;
  const want = foldName(q);
  return want !== "" && foldName(p.name).includes(want);
}

/** The adults who meet every filter this list reads (the gaps, the band, an area and a search), in name order. */
export function gapPeople(all: readonly GapPerson[], f: HouseholdFilters, ctx: GapContext & { searchIds?: ReadonlySet<string> | null }): GapPerson[] {
  return all
    .filter((p) => inBand(p, f, ctx) && hasGaps(p, f) && (!f.zone || p.household?.zoneId === f.zone) && matchesSearch(p, f.q, ctx.searchIds ?? null))
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
}

/** The families that have at least one of these adults: the way a gap filter narrows the list of families. */
export function householdIdsOf(people: readonly GapPerson[]): Set<string> {
  const ids = new Set<string>();
  for (const p of people) if (p.household) ids.add(p.household.id);
  return ids;
}

/** How many gaps are asked (for a title and for a check that there is anything to do). */
export function gapCount(f: HouseholdFilters): number {
  return GAP_KEYS.filter((k) => f[k] === true).length;
}

/** "(713) 555-0138", or "—" when there is none: a list shows the gap rather than a blank. */
export function contactCell(value: string | null, kind: "email" | "phone"): string {
  if (isBlank(value)) return "—";
  return kind === "phone" ? formatPhone(value) : (value ?? "").trim();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------------------------------------------------------------

export const PEOPLE_EXPORT_HEADER = ["Name", "Relationship", "Member number", "Email", "Mobile", "On the app", "Age", "Household number", "Community household ID", "Household", "City"] as const;

export type ExportCard = { name: string | null; number: string | null; orgId: string | null; city: string | null; zone: string | null; /** The ADULTS' names only. */ adults: string[] };

/**
 * One CSV line per adult. The household comes from its card (number, the organization's ID, the name WITHOUT any child's first
 * name, the city), so a family is never identified by a name alone. `relationship` is the community's own word (kind terms).
 */
export function peopleExportLines(people: readonly GapPerson[], cards: ReadonlyMap<string, ExportCard>, relationship: (role: string | null) => string, today: string): (string | number)[][] {
  return people.map((p) => {
    const card = p.household ? cards.get(p.household.id) : undefined;
    const age = ageOn(p.dateOfBirth, today);
    return [
      p.name,
      relationship(p.role),
      p.memberNumber ?? "",
      (p.email ?? "").trim(),
      formatPhone(p.phone),
      p.onApp ? "Yes" : "No",
      age === null ? "" : age,
      card?.number ?? p.household?.number ?? "",
      card?.orgId ?? "",
      card?.name ?? "",
      card?.city ?? "",
    ];
  });
}

/** A file name for an export: the list's heading in lower-case words, plus the day. Safe on every file system. */
export function exportFileName(heading: string, day: string): string {
  const words = heading
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${words || "list"}-${day}.csv`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The export of a list of families
// ---------------------------------------------------------------------------------------------------------------------------------

export const HOUSEHOLD_EXPORT_HEADER = ["Household number", "Community household ID", "Household", "Adults", "City", "Area"] as const;

export type HouseholdExportRow = { id: string; number: string | null; openCents: number | null };

/**
 * One CSV line per family, from its card: the number, the organization's ID, the name without any child's first name, the ADULTS' names,
 * the city and the area. The open balance is a last column only when the person may see giving (`withBalance`), in major units.
 */
export function householdExportLines(rows: readonly HouseholdExportRow[], cards: ReadonlyMap<string, ExportCard>, opts: { withBalance: boolean; areaOf: (id: string) => string | null }): (string | number)[][] {
  return rows.map((r) => {
    const c = cards.get(r.id);
    const line: (string | number)[] = [c?.number ?? r.number ?? "", c?.orgId ?? "", c?.name ?? "", (c?.adults ?? []).join("; "), c?.city ?? "", opts.areaOf(r.id) ?? c?.zone ?? ""];
    if (opts.withBalance) line.push(r.openCents === null ? "" : (r.openCents / 100).toFixed(2));
    return line;
  });
}
