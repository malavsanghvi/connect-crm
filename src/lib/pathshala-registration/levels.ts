// Pathshala › Levels (plan §2.1): a level's age band, who it is for, and the checks app.save_pathshala_level makes,
// in its words, so the form can explain before it asks. The database decides; this file only mirrors it. Pure.

import { ADULT_AGE, AGE_LIMITS, type LevelRow } from "./contract";

/** An adult class (minimum 18 or more), a children's level (maximum under 18), or open to anyone (§2.1, P24). */
export type LevelAudience = "adult" | "children" | "any";

export function levelAudience(minAge: number | null, maxAge: number | null): LevelAudience {
  if (minAge !== null && minAge >= ADULT_AGE) return "adult";
  if (maxAge !== null && maxAge < ADULT_AGE) return "children";
  return "any";
}

export const AUDIENCE_LABEL: Record<LevelAudience, string> = {
  adult: "Adult class",
  children: "Children's level",
  any: "Open to anyone",
};

/** What the band does for families (P24): a rule for adult classes and children's levels, a suggestion within them. */
export const AUDIENCE_HINT: Record<LevelAudience, string> = {
  adult: "Offered to adults only (18 or older on the term's age cut-off date).",
  children: "Offered to children only (under 18 on the cut-off date). A child outside the band can still be registered; the office then confirms the level.",
  any: "No age rule: offered to anyone.",
};

/** "Ages 8–10", "18 and over", "Up to age 4", "Age 6", or "No age band" (the seed's levels have none yet, F15). */
export function ageBandLabel(minAge: number | null, maxAge: number | null): string {
  if (minAge === null && maxAge === null) return "No age band";
  if (minAge !== null && maxAge !== null) return minAge === maxAge ? `Age ${minAge}` : `Ages ${minAge}–${maxAge}`;
  if (minAge !== null) return `${minAge} and over`;
  return `Up to age ${maxAge}`;
}

/** A key the database can store: lower case letters, digits and _ ("Adult Moms" → "adult_moms"). */
export function normalizeLevelKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * A key for a new level when none is typed, in the seed's style (0006: 'toddler', '1'..'7', 'adult_dads'): the
 * name without the track's name in front ("Jainism 8" in Jainism → "8").
 */
export function suggestLevelKey(name: string, trackName?: string | null): string {
  let base = name.trim();
  const track = (trackName ?? "").trim();
  if (track && base.toLowerCase().startsWith(track.toLowerCase() + " ")) base = base.slice(track.length).trim();
  return normalizeLevelKey(base) || normalizeLevelKey(name);
}

export type AgeEntry = { ok: true; age: number | null } | { ok: false; error: string };

/** A minimum or maximum age box: blank (no limit) or whole years from 0 to 120 (the 0590 check). */
export function parseAgeInput(raw: string | null | undefined, which: "minimum" | "maximum"): AgeEntry {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, age: null };
  if (!/^\d+$/.test(text)) return { ok: false, error: `The ${which} age must be a whole number of years from ${AGE_LIMITS.min} to ${AGE_LIMITS.max}.` };
  const n = Number(text);
  if (n < AGE_LIMITS.min || n > AGE_LIMITS.max) return { ok: false, error: `The ${which} age must be a whole number of years from ${AGE_LIMITS.min} to ${AGE_LIMITS.max}.` };
  return { ok: true, age: n };
}

export type LevelDraft = { name: string; key: string; sort_order: number; min_age: number | null; max_age: number | null };

/** The first problem with a level, in the words app.save_pathshala_level uses (§2.1); null when it can be saved. */
export function levelProblem(d: LevelDraft): string | null {
  if (!d.name.trim()) return "Give the level a name, for example Jainism 3 or Adult class (Moms).";
  if (!d.key) return "Give the level a key: letters, digits or _ (for example 3 or adult_moms).";
  if (!Number.isInteger(d.sort_order)) return "The order must be a whole number.";
  if (d.min_age !== null && d.max_age !== null && d.min_age > d.max_age) {
    return `The minimum age (${d.min_age}) is above the maximum age (${d.max_age}).`;
  }
  return null;
}

/** The order for a new level: after the track's last one. */
export function nextSortOrder(levels: readonly Pick<LevelRow, "sort_order">[]): number {
  return levels.length ? Math.max(...levels.map((l) => l.sort_order)) + 1 : 0;
}

/** Levels in the order families see them: by order, then by name. */
export function sortLevels<L extends Pick<LevelRow, "sort_order" | "name">>(levels: readonly L[]): L[] {
  return [...levels].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

const TRACK_ORDER = ["jainism", "gujarati", "hindi"];

/** Tracks in the order Pathshala uses everywhere (Jainism, Gujarati, Hindi, then the rest by name). */
export function sortTracks<T extends { key: string; name: string }>(tracks: readonly T[]): T[] {
  const rank = (t: T) => (TRACK_ORDER.includes(t.key) ? TRACK_ORDER.indexOf(t.key) : TRACK_ORDER.length);
  return [...tracks].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
