// Pathshala › Levels (plan §2.1): a level's age band, who it is for, and the checks app.save_pathshala_level makes,
// in its words, so the form can explain before it asks. The database decides; this file only mirrors it. Pure.

import { ADULT_AGE, AGE_LIMITS, SORT_ORDER_LIMITS, type LevelRow } from "./contract";

/** The keys app.save_pathshala_level accepts (0590): letters, digits, - and _, starting with a letter or digit, up to 40. */
const LEVEL_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const KEY_RULE = "A level's key can use letters, digits, - and _ (for example 3 or adult_moms), up to 40 characters.";

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

/** A key the database can store: lower case letters, digits, - and _ ("Adult Moms" → "adult_moms", "adult-dads" kept). */
export function normalizeLevelKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
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

/** A minimum or maximum age box: blank (no limit) or whole years from 0 to 120 (the 0590 check, in its words). */
export function parseAgeInput(raw: string | null | undefined, which: "minimum" | "maximum"): AgeEntry {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, age: null };
  if (!/^-?\d+$/.test(text)) return { ok: false, error: `The ${which} age must be a whole number.` };
  const n = Number(text);
  if (n < AGE_LIMITS.min || n > AGE_LIMITS.max) return { ok: false, error: `The ${which} age must be between ${AGE_LIMITS.min} and ${AGE_LIMITS.max} (it is ${n}).` };
  return { ok: true, age: n };
}

export type LevelDraft = { name: string; key: string; sort_order: number; min_age: number | null; max_age: number | null };

/** The first problem with a level, in the words app.save_pathshala_level uses (§2.1, 0590); null when it can be saved. */
export function levelProblem(d: LevelDraft): string | null {
  if (!d.name.trim()) return "Give the level a name.";
  if ([...d.name.trim()].length > 80) return "A level's name can be at most 80 characters.";
  if (!LEVEL_KEY.test(d.key)) return KEY_RULE;
  if (!Number.isInteger(d.sort_order) || d.sort_order < SORT_ORDER_LIMITS.min || d.sort_order > SORT_ORDER_LIMITS.max) {
    return `The order must be between ${SORT_ORDER_LIMITS.min} and ${SORT_ORDER_LIMITS.max}.`;
  }
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

/**
 * The levels a picker offers (a new class, "Enroll a student", a recommended next level): the levels still offered
 * — 0590's `active` flag, read from a row loaded with every column; a database without 0590 has no flag, so every
 * level is offered — plus `keep`, the level a record already has, so editing it never drops its level.
 */
export function pickableLevels<L extends { id: string }>(levels: readonly L[], keep?: string | null): L[] {
  return levels.filter((l) => (l as { active?: unknown }).active !== false || (keep != null && l.id === keep));
}

const TRACK_ORDER = ["jainism", "gujarati", "hindi"];

/** Tracks in the order Pathshala uses everywhere (Jainism, Gujarati, Hindi, then the rest by name). */
export function sortTracks<T extends { key: string; name: string }>(tracks: readonly T[]): T[] {
  const rank = (t: T) => (TRACK_ORDER.includes(t.key) ? TRACK_ORDER.indexOf(t.key) : TRACK_ORDER.length);
  return [...tracks].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
