// Suggested custom fields, by the kind of organization (docs/PEOPLE_NOTES_AND_FIELDS.md section 1.2, question B). A DATA FILE: it is
// keyed by the organization's kind (`organization_categories.key`, as src/lib/kind.ts reads it), and nothing in the code asks "is this a
// church". The "Add a field" sheet shows the rows for the community's kind as chips; picking one fills the sheet, and the admin still
// confirms it. A kind with no row of its own gets the shared suggestions. Later the same rows can move to a platform reference table
// (slice 13) with no change to the screens.
//
// Wording rules: plain, neutral, usable by any kind of organization in any country; a label is what a person reads on a card, so no
// jargon, and nothing that names a tradition or a community.

import type { CustomType } from "./import/mapping";

export type FieldSuggestion = {
  label: string;
  type: CustomType;
  choices?: readonly string[];
  /** Left out: staff only (the safe default). */
  sensitivity?: "staff" | "member_self" | "directory";
  /** Found by the one box and usable as a list filter. */
  searchable?: boolean;
};

export type SuggestionEntity = "people" | "households";

type Rows = Record<SuggestionEntity, readonly FieldSuggestion[]>;

/** Suggested for every kind of organization. */
const ANY: Rows = {
  people: [
    { label: "Pronouns", type: "text" },
    { label: "Preferred language of mail", type: "text" },
    { label: "Accessibility needs", type: "text" },
    { label: "Food allergies", type: "text" },
  ],
  households: [
    { label: "Languages spoken at home", type: "text" },
    { label: "Hometown", type: "text" },
    { label: "Preferred contact time", type: "choice", choices: ["Morning", "Afternoon", "Evening"] },
    { label: "Best way to reach us", type: "choice", choices: ["Phone call", "Text message", "Email", "Mail"] },
  ],
};

/** Added to the shared ones for a kind. The keys are the kinds' database keys: data, not branches. */
const BY_KIND: Record<string, Rows> = {
  chamber_of_commerce: {
    people: [
      { label: "Job title", type: "text" },
      { label: "Committee interest", type: "text", searchable: true },
      { label: "Professional profile", type: "url" },
    ],
    households: [
      { label: "Industry", type: "choice", choices: ["Retail", "Services", "Manufacturing", "Technology", "Health care", "Hospitality", "Other"], sensitivity: "directory", searchable: true },
      { label: "Number of employees", type: "number" },
      { label: "Business website", type: "url", sensitivity: "directory" },
      { label: "Year founded", type: "number" },
    ],
  },
  nonprofit_secular: {
    people: [
      { label: "Volunteer availability", type: "text" },
      { label: "Skills offered", type: "text", searchable: true },
    ],
    households: [{ label: "How they heard about us", type: "choice", choices: ["Friend or family", "An event", "Our website", "Social media", "Other"] }],
  },
  faith_other: {
    people: [
      { label: "Small group or study circle", type: "text", searchable: true },
      { label: "Orientation completed", type: "boolean" },
      { label: "Volunteer team", type: "text", searchable: true },
    ],
    households: [{ label: "Year joined the community", type: "number" }],
  },
};

/** What a faith-based kind that has no row of its own is offered (the community-focused ones), so a new kind is never left with only the shared list. */
const FAITH_BASED_FALLBACK = "faith_other";

export type SuggestionKind = { key: string; faithBased?: boolean };

/** Every key that has suggestions of its own (the tests check each is a real kind key). */
export const SUGGESTION_KIND_KEYS: readonly string[] = Object.keys(BY_KIND);

const fold = (s: string) => s.normalize("NFKC").trim().toLowerCase();

/**
 * The suggestions for one kind of record in one kind of organization: the kind's own first, then the shared ones, none repeated, none
 * the community already has (compared without regard to case or accents).
 */
export function suggestionsFor(kind: SuggestionKind, entity: SuggestionEntity, existingLabels: readonly string[] = []): FieldSuggestion[] {
  const own = BY_KIND[kind.key] ?? (kind.faithBased ? BY_KIND[FAITH_BASED_FALLBACK] : undefined);
  const have = new Set(existingLabels.map(fold));
  const out: FieldSuggestion[] = [];
  for (const s of [...(own?.[entity] ?? []), ...ANY[entity]]) {
    const k = fold(s.label);
    if (have.has(k)) continue;
    have.add(k);
    out.push(s);
  }
  return out;
}

/** All suggestion rows (for the tests that check their wording). */
export function allSuggestions(): FieldSuggestion[] {
  return [ANY, ...Object.values(BY_KIND)].flatMap((r) => [...r.people, ...r.households]);
}
