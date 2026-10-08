// Words the portal's screens use that belong to the TRADITION PACK (the Jain Center's own vocabulary: darshan, aarti,
// pachchakhan, derasar …) and what every other kind says instead. Which one a screen shows is decided from the
// organization's kind, never hard-coded in the screen:
//
//   1. a word the kind's own data gives (a term in app.organization_categories.terms, for example `live_stream`);
//   2. else, a kind that keeps a tradition (`uses_tradition`: today's Jain Center, and JSH) says what the portal has
//      always said;
//   3. else the neutral word.
//
// So a Jain Center reads exactly as before, a chamber or a neutral organization never meets a Jain word, and a new kind
// can name any of these in its catalog row with no code change. Pure — unit-tested (tests/kind-screens.test.ts).

import { kindHas, kindName, kindSchool, kindTerm, moduleNotOffered, type KindProfile } from "./kind";

export type KindLike = Pick<KindProfile, "terms" | "modules" | "usesTradition">;

// key: [what a kind that keeps a tradition says (today's wording), what every other kind says]
const WORDS = {
  // Content
  today_tab: ["Today & darshan", "Live stream"],
  live_stream: ["Live darshan", "Live stream"],
  live_stream_item: ["Live darshan stream", "Live stream"],
  // Calendar
  festival_dates: ["Parva and festival dates", "Holiday and festival dates"],
  // Giving
  cash_box: ["bhandar", "cash box"],
  cash_box_counting: ["Bhandar counting sessions", "Cash box counting sessions"],
  cash_box_new_session: ["New bhandar counting session", "New cash box counting session"],
  cash_method: ["Cash (bhandar)", "Cash"],
  pledge_item: ["Pujan", "Item"],
  pledge_items_section: ["Pujans and fixed bolis", "Fixed items"],
  pledge_item_add: ["Add pujan", "Add item"],
  pledge_list_type: ["Fixed pujan list (multi-select)", "Fixed item list (multi-select)"],
  opportunity_example: ["e.g. Diwali aarti and pujans", "e.g. Annual gala sponsors"],
  pledge_item_example: ["e.g. Pehli aarti", "e.g. Table sponsor"],
  // Samples and examples
  address_example: ["123 Temple Rd, Houston TX", "123 Main St, Houston TX"],
  payee_example: ["Jain Society of Houston", "Houston Community Association"],
  // Setup
  house_of_worship: ["House of worship (church, temple, derasar)", "House of worship (church, temple, mosque, synagogue)"],
  pin_drives: ["The pin drives the daily timings (sunrise, navkarsi, chauvihar)", "The pin drives the daily timings (sunrise and sunset)"],
} as const;

export type WordKey = keyof typeof WORDS;

/** A word for this kind: its own term, else the tradition pack's, else the neutral one. */
export function word(kind: KindLike, key: WordKey): string {
  const [tradition, neutral] = WORDS[key];
  return kindTerm(kind, key, kindHas(kind, "tradition") ? tradition : neutral);
}

/** Every word for a kind, for a test or a screen that needs several. */
export function wordsFor(kind: KindLike): Record<WordKey, string> {
  return Object.fromEntries((Object.keys(WORDS) as WordKey[]).map((k) => [k, word(kind, k)])) as Record<WordKey, string>;
}

/** The tradition pack's word for each key (what a Jain Center has always read), for the tests that compare old and new. */
export const TRADITION_WORDS: Readonly<Record<WordKey, string>> = Object.fromEntries((Object.keys(WORDS) as WordKey[]).map((k) => [k, WORDS[k][0]])) as Record<WordKey, string>;
export const NEUTRAL_WORDS: Readonly<Record<WordKey, string>> = Object.fromEntries((Object.keys(WORDS) as WordKey[]).map((k) => [k, WORDS[k][1]])) as Record<WordKey, string>;

// ── Niva (Content › Niva) ─────────────────────────────────────────────────────

type NivaKind = Pick<KindProfile, "terms" | "modules" | "usesTradition" | "faithBased">;

/** Whom Niva sends a member to for a question she must not answer by herself: a teacher of the kind's school, a leader, or the office. */
function referral(kind: NivaKind): string {
  if (!kind.faithBased) return "the office";
  const school = kindSchool(kind);
  return school ? `${school} teachers` : "a leader of the community";
}

/** The guardrail row about doctrinal questions (a kind that is not a faith community has questions that need a decision instead). */
export function nivaGuardrail(kind: NivaKind): [string, string] {
  return kind.faithBased
    ? ["Doctrinal questions", `Answer from approved content, then refer to ${referral(kind)}`]
    : ["Questions that need a decision", `Answer from approved content, then refer to ${referral(kind)}`];
}

/** The sentence in the "answers from approved sources only" note. */
export function nivaReferralSentence(kind: NivaKind): string {
  return kind.faithBased ? `Doctrinal questions are always referred on to ${referral(kind)} as well.` : `Questions that need a decision are always referred on to ${referral(kind)} as well.`;
}

/** The empty-state sentence about what to add as a source (the kind's learning path only where it has one). */
export function nivaSourcesHint(kind: NivaKind): string {
  const learning = moduleNotOffered(kind, "gyan_path") ? "" : ` and ${kindName(kind, "gyan_path", "Gyan Path")} content`;
  return learning ? `Add the calendar, guide, membership rules${learning} Niva may answer from.` : "Add the calendar, guide and membership rules Niva may answer from.";
}
