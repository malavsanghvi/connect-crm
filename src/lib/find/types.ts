// The shared shapes of the one find box: what a typed text is read as, what the database hands back to be scored, and what the
// box shows. Pure types, no imports from the server, so the top-bar box, the People home, the dev preview and the tests all use
// them. Nothing here names one organization, tradition or language.

import type { FamilyFocus } from "@/lib/giving-actions/family-giving";
import type { RecordPledgeRequest } from "@/lib/giving-actions/record-pledge";
import type { RecordPaymentRequest } from "@/lib/giving-actions/record-sheet";

import type { GivingLane, GivingRow } from "./giving";

/** What a typed text is read as. Decided by rules on the page, never by a model. */
export type InputKind = "identifier" | "name" | "phone" | "email" | "question" | "filter";

export type Classified = {
  kind: InputKind;
  /** The text with the whitespace squeezed. */
  text: string;
  /** What is looked up: the text, or just the number or payer name inside it ("member 1042" looks up 1042). */
  search: string;
  /** The digits of a phone-looking text (the last digits too: any run of 4 or more is searched). Empty otherwise. */
  digits: string;
  /** For an identifier: what it looks like, so the box can say "I understood: a bank payer name". */
  shape: "payer" | "code" | "number" | null;
};

/** One identifier a record holds that matched the typed text (already limited to the kinds the viewer may see). */
export type IdentifierHit = {
  /** The database kind: connect_member, connect_household, org_member, org_household, crm, accounting, bank_payer, payment_provider, other. */
  kind: string;
  system: string | null;
  value: string;
};

/** Why a row matched, in words the person reads next to it ("Old system ID 20417"). */
export type Why = {
  /** A stable code (tests and styling); the words are in `label`. */
  code: "name" | "adult" | "phone" | "email" | "member_number" | "household_number" | "identifier" | "custom" | "recent";
  label: string;
};

/**
 * A searchable custom field of a record, with the value it holds, as the viewer may read it (the label is the field's own name; the value is
 * as it reads on screen). Only fields marked "found by the one box" are looked up, and only under the viewer's own access.
 */
export type CustomHit = { label: string; value: string };

/** A person as the database lookup returns them, ready to be scored. */
export type PersonCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phoneE164: string | null;
  memberNumber: string | null;
  isChild: boolean;
  isDeceased: boolean;
  /** The family this person is shown under (the primary one, else the earliest joined). */
  householdId: string | null;
  relationship: string | null;
  /** Identifiers of this person that matched the typed text. */
  hits: IdentifierHit[];
  /** Searchable custom fields of this person that the lookup found a value for. */
  customHits?: CustomHit[];
};

/** A family (household) as the lookup returns it, ready to be scored. */
export type FamilyCandidate = {
  id: string;
  displayName: string | null;
  householdNumber: string | null;
  /** Identifiers of this family that matched the typed text. */
  hits: IdentifierHit[];
  /** Searchable custom fields of this family that the lookup found a value for. */
  customHits?: CustomHit[];
};

export type Scored<T> = { item: T; score: number; why: Why };

/** One row of the box, for a family or for a person. Always carries the household card line: never a name alone. */
export type FindRow =
  | {
      kind: "family";
      id: string;
      title: string;
      /** "No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside · North Riverside" */
      cardLine: string;
      why: Why;
      href: string;
      score: number;
    }
  | {
      kind: "person";
      id: string;
      householdId: string | null;
      title: string;
      /** "Spouse", or "Child · staff only". */
      subtitle: string;
      /** The name of their family, and its card line; both null when the person is in no household (or the card cannot be read). */
      familyName: string | null;
      cardLine: string | null;
      child: boolean;
      why: Why;
      href: string;
      score: number;
    };

/** A filter the page's rule-based reader found in the words: the same chips the list shows. */
export type FindFilter = {
  href: string;
  chips: string[];
  understood: string;
  /** Which list it opens. Absent: the list of families (the first filters this box knew). */
  list?: "people" | "households";
  /** The row's own sentence for a list of people: "Show 42 adults with no email" (the count only when it could be read). */
  label?: string;
};

/** What the server answers for one typed text. */
export type FindResponse = {
  query: string;
  kind: InputKind;
  rows: FindRow[];
  /** When more rows matched than were kept. */
  more: number;
  /** Words that could be shown as a list on the People screen (a question or a sentence the rule-based reader understands). */
  filter: FindFilter | null;
  /** A part of the lookup failed: plain words, shown with the rows that did load. */
  problem: string | null;
  /** The Giving lane (src/lib/find/giving.ts): absent when the text asks nothing of Giving or the person cannot see Giving. */
  giving?: GivingLane | null;
};

export type FindResult = { ok: true; data: FindResponse } | { ok: false; error: string };

/** How Niva is for this person: it decides what a question does. */
export type NivaState = "on" | "no_key" | "off";

/** What the box draws, one entry per selectable or explanatory line. */
export type UiRow =
  | { type: "family"; key: string; row: Extract<FindRow, { kind: "family" }> }
  | { type: "person"; key: string; row: Extract<FindRow, { kind: "person" }> }
  | { type: "niva"; key: string; text: string }
  | { type: "filter"; key: string; filter: FindFilter }
  | { type: "palette"; key: string; text: string }
  | { type: "message"; key: string; text: string; tone: "plain" | "problem" }
  | { type: "giving"; key: string; row: GivingRow };

export type EnterAction =
  | { type: "open"; href: string; familyId: string | null }
  /** Open the Record payment sheet filled in (it never saves by itself); `href` is where to go when no sheet can open there. */
  | { type: "record-payment"; request: RecordPaymentRequest; href: string }
  /** Open the Record pledge sheet filled in (slice 7; it never saves by itself); `href` is where to go when no sheet can open there. */
  | { type: "record-pledge"; request: RecordPledgeRequest; href: string }
  /** Open the family's giving in place (on Giving pages); `href` is where to go when it cannot open there. */
  | { type: "family-giving"; householdId: string; focus: FamilyFocus | null; href: string }
  | { type: "niva"; text: string }
  | { type: "palette"; text: string }
  | { type: "none" };
