// The example words and names the portal's helpers (Niva's suggestions, the routines, the media library) use in sentences, and what
// each kind calls its school and learning path. This file is the TERM TABLE for them: the only place in these helpers where a
// tradition's own example (a festival dinner, a snack, a class level) is written down.
//
// Which one a sentence uses is decided from the organization's kind, never from its name or address:
//   1. a word the kind's own data gives (a term of that name in app.organization_categories.terms);
//   2. else, a kind that keeps a tradition (`uses_tradition`: today's Jain Center, and JSH) says what the portal has always said;
//   3. else the neutral example.
// So a temple reads as before, a chamber, a church or a club never meets a Jain example, and a new kind can name any of these in
// its catalog row with no code change. Pure and unit-tested (tests/kind-aware-wording.test.ts).

import { kindHas, kindName, kindTerm, moduleNotOffered, type KindProfile } from "./kind";
import { PAYMENT_PLUGINS, type PluginKey } from "./payments/plugins/catalog";

export type KindWords = Pick<KindProfile, "terms" | "modules" | "usesTradition">;

// key: what a kind that keeps a tradition says; what a faith community without one says (when it differs); what every other kind says.
type Row = { tradition: string; faith?: string; neutral: string };
const SAMPLES = {
  /** A well-known annual event, for "copy last year's … as a draft". */
  festival_event: { tradition: "Diwali Dinner", neutral: "Annual Gala" },
  /** A thing the store sells, for "change the price of the …". */
  store_item: { tradition: "samosa pack", neutral: "T-shirt" },
  /** A class level, for "what would a fee of … for … change?". */
  level_example: { tradition: "Jainism 2", neutral: "Level 2" },
  /** What owed money is called in a sentence: pledges in a faith community, dues and pledges in a chamber or a club. */
  pledges: { tradition: "pledges", faith: "pledges", neutral: "dues and pledges" },
} as const satisfies Record<string, Row>;

export type SampleKey = keyof typeof SAMPLES;

function pick(kind: KindWords & { faithBased?: boolean }, row: Row): string {
  if (kindHas(kind, "tradition")) return row.tradition;
  return kind.faithBased === true && row.faith !== undefined ? row.faith : row.neutral;
}

/** An example word for this kind: its own term, else the tradition pack's, else the faith community's, else the neutral one. */
export function sample(kind: KindWords & { faithBased?: boolean }, key: SampleKey): string {
  return kindTerm(kind, key, pick(kind, SAMPLES[key]));
}

/** Every example word for a kind (a test, or a screen that needs several). */
export function samplesFor(kind: KindWords & { faithBased?: boolean }): Record<SampleKey, string> {
  return Object.fromEntries((Object.keys(SAMPLES) as SampleKey[]).map((k) => [k, sample(kind, k)])) as Record<SampleKey, string>;
}

/** The tradition pack's example for each key, and the neutral one (the tests compare a kind with both). */
export const TRADITION_SAMPLES: Readonly<Record<SampleKey, string>> = Object.fromEntries((Object.keys(SAMPLES) as SampleKey[]).map((k) => [k, SAMPLES[k].tradition])) as Record<SampleKey, string>;
export const NEUTRAL_SAMPLES: Readonly<Record<SampleKey, string>> = Object.fromEntries((Object.keys(SAMPLES) as SampleKey[]).map((k) => [k, SAMPLES[k].neutral])) as Record<SampleKey, string>;

// ---------------------------------------------------------------------------
// The media library's kinds: the database keeps one key per kind of item; the words follow the kind
// ---------------------------------------------------------------------------

/** The kinds of item in the media library, in the order shown. `key` is the database's name for it; the labels are what a person reads. */
export const MEDIA_KINDS: readonly { key: string; tradition: string; neutral: string }[] = [
  { key: "stavan", tradition: "Stavan", neutral: "Song" },
  { key: "video", tradition: "Video", neutral: "Video" },
  { key: "podcast", tradition: "Podcast", neutral: "Podcast" },
  { key: "recipe", tradition: "Recipe", neutral: "Recipe" },
];

export const MEDIA_KIND_KEYS: readonly string[] = MEDIA_KINDS.map((k) => k.key);

/** The singular label of a media kind in this kind's words ("Stavan" for a tradition, "Song" for everyone else). */
export function mediaKindLabel(kind: KindWords, key: string): string {
  const row = MEDIA_KINDS.find((k) => k.key === key);
  if (!row) return key.replace(/_/g, " ");
  return kindHas(kind, "tradition") ? row.tradition : row.neutral;
}

/** "stavans, videos and podcasts" / "songs, videos and podcasts": the first three kinds as a plural phrase. */
export function mediaKindsPhrase(kind: KindWords, count = 3): string {
  const labels = MEDIA_KINDS.slice(0, count).map((k) => `${mediaKindLabel(kind, k.key).toLowerCase()}s`);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

// ---------------------------------------------------------------------------
// The school and the learning path
// ---------------------------------------------------------------------------

/**
 * What this kind calls its school ("Pathshala", "Religious school"): the kind's own name for the module, else its `school` term,
 * else the plain word "School" for a kind that offers the module but has not named it. null when the kind has no school at all.
 */
export function schoolWord(kind: Pick<KindProfile, "modules" | "terms">): string | null {
  if (moduleNotOffered(kind, "pathshala")) return null;
  return kindName(kind, "pathshala", "School");
}

/** What this kind calls its learning path ("Gyan Path", "Learning path"), or null when it has none. */
export function learningWord(kind: Pick<KindProfile, "modules" | "terms">): string | null {
  if (moduleNotOffered(kind, "gyan_path")) return null;
  return kindName(kind, "gyan_path", "Learning path");
}

/** The school's word for a sentence that must always have one ("the school" when the kind has none). */
export function schoolOrGeneric(kind: Pick<KindProfile, "modules" | "terms">): string {
  return schoolWord(kind) ?? "school";
}

/** "<School> principal": the routine role of the person who runs the school. */
export function principalTitle(kind: Pick<KindProfile, "modules" | "terms">): string {
  const school = schoolWord(kind);
  return school ? `${school} principal` : "School principal";
}

/** The kind's words a model is told, so it uses the community's own names when it talks to the person. */
export function wordsForModel(kind: Pick<KindProfile, "modules" | "terms">): string[] {
  const out: string[] = [];
  const school = schoolWord(kind);
  if (school) out.push(`its school is called "${school}"`);
  const learning = learningWord(kind);
  if (learning) out.push(`its learning path is called "${learning}"`);
  const store = moduleNotOffered(kind, "store") ? "" : kindName(kind, "store", kindTerm(kind, "store", ""));
  if (store) out.push(`its store is called "${store}"`);
  const place = kindTerm(kind, "place", "");
  if (place) out.push(`its building is called the ${place}`);
  return out;
}

// ---------------------------------------------------------------------------
// Payment ways
// ---------------------------------------------------------------------------

/** A payment plugin's plain name from the catalog ("Zelle", "PayPal"). */
export function pluginName(key: PluginKey | string): string {
  return PAYMENT_PLUGINS.find((p) => p.key === key)?.label ?? key;
}

/** English spells the paper payment "check" in the United States and Canada and "cheque" elsewhere. */
export function checkWord(locale: string): string {
  return /-(US|CA|PH)$/i.test(locale) || !/-/.test(locale) ? "check" : "cheque";
}

/**
 * The offline way of paying a sentence can name ("check", "cash"): the first the community has switched on. `plugins` is the list
 * of enabled payment plugin keys, or null when it is not known (then no particular way is named).
 */
export function offlineMethodWord(plugins: readonly string[] | null | undefined, locale: string): string | null {
  if (!plugins) return null;
  if (plugins.includes("check")) return checkWord(locale);
  if (plugins.includes("cash")) return "cash";
  return null;
}
