// Access levels (migration 0586): which people may use each area of the member app, per community.
// Pure — no server imports — so Settings › Access levels and its tests share it. The database decides
// (app.can_use_feature, app.feature_access_for_me, the three settings RPCs, row level security for the live
// darshan stream); this file mirrors its catalog and rules so the page can explain before it asks.
//
// Model (docs/ACCESS_LEVELS.md):
//   levels  an ordered ladder per community: Public (rank 0) and Community member (rank 10) are fixed and only
//           their names change; the community's own membership levels (rank 20 up) each carry a rule, met by an
//           active membership of the person's household.
//   areas   the catalog below: each has a default level (today's behaviour, except darshan and puja which are
//           public), a floor (the lowest level it may be given) and where it is enforced.

import type { ModuleKey } from "@/lib/modules";

// ---------------------------------------------------------------------------
// The platform's fixed pieces
// ---------------------------------------------------------------------------
export const BASE_LEVEL_KEYS = ["public", "community"] as const;
export type BaseLevelKey = (typeof BASE_LEVEL_KEYS)[number];

export const MEMBERSHIP_TIERS = ["community", "yearly", "life"] as const;
export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number];
export const TIER_LABEL: Record<MembershipTier, string> = { community: "Community", yearly: "Yearly", life: "Life" };

/** A level's key: 2 to 30 lower-case letters and underscores, starting with a letter (the table's check). */
export const LEVEL_KEY_PATTERN = /^[a-z][a-z_]{1,29}$/;
export const LEVEL_LABEL_MAX = 40;
/** Membership levels sit above Community member (rank 10): ranks 20 to 1000. The page numbers them 20, 30, 40 … in order. */
export const MIN_MEMBERSHIP_RANK = 20;
export const RANK_STEP = 10;
export const MAX_MEMBERSHIP_LEVELS = 10;

/** The starting names and ranks (access_seed_center). A community can rename the two base levels and change or remove the other two. */
export const BASE_LEVELS: readonly { key: BaseLevelKey; label: string; rank: number }[] = [
  { key: "public", label: "Public", rank: 0 },
  { key: "community", label: "Community member", rank: 10 },
];
export type DefaultMembershipLevel = { key: string; label: string; rank: number; tiers: MembershipTier[] };
export const DEFAULT_MEMBERSHIP_LEVELS: readonly DefaultMembershipLevel[] = [
  { key: "member", label: "Member", rank: 20, tiers: ["yearly", "life"] },
  { key: "life", label: "Life member", rank: 30, tiers: ["life"] },
];

// ---------------------------------------------------------------------------
// The catalog of areas (app.access_features). tests/access.test.ts reads the migration and fails when they differ.
// ---------------------------------------------------------------------------
export const ACCESS_FEATURE_KEYS = ["darshan", "puja", "timings", "guide", "listen", "look", "learn", "niva"] as const;
export type AccessFeatureKey = (typeof ACCESS_FEATURE_KEYS)[number];

export type FeatureEnforcement = "database" | "app";

export type AccessFeatureDef = {
  key: AccessFeatureKey;
  label: string;
  description: string;
  /** The level a community gets until it chooses. */
  defaultLevel: BaseLevelKey;
  /** The lowest level a community may choose. */
  floorLevel: BaseLevelKey;
  /** The area is off while this module is switched off; null = no module. */
  moduleKey: ModuleKey | null;
  /** database: row level security protects the data. app: the member app hides it; the data is still readable by community members. */
  enforcedBy: FeatureEnforcement;
  sort: number;
};

export const ACCESS_FEATURES: readonly AccessFeatureDef[] = [
  { key: "darshan", label: "Live darshan", description: "The live stream from the derasar, on Home and in the library. The database only gives the stream's link to people at or above this level. The stream plays from that link's own site, so anyone who already has the link can still watch it (use a private or unlisted link if that matters).", defaultLevel: "public", floorLevel: "public", moduleKey: "content", enforcedBy: "database", sort: 10 },
  { key: "puja", label: "Virtual puja", description: "The guided virtual puja (the Navang puja lesson). Anyone at or above this level can open it; progress and points are only kept for people who are signed in.", defaultLevel: "public", floorLevel: "public", moduleKey: "gyan_path", enforcedBy: "app", sort: 20 },
  { key: "timings", label: "Today's timings", description: "Sunrise, navkarsi, chauvihar and aarti for today, on Home. The timings are readable by everyone in the database; this choice is for the member app.", defaultLevel: "public", floorLevel: "public", moduleKey: null, enforcedBy: "app", sort: 30 },
  { key: "guide", label: "New to the community guide and directory", description: "The guide for newcomers: first steps and who to ask (who looks after what). The member directory of families is not part of this area: it always needs a signed-in community member.", defaultLevel: "public", floorLevel: "public", moduleKey: null, enforcedBy: "app", sort: 40 },
  { key: "listen", label: "Stavans, podcasts and playlist", description: "Listen in the member app: stavans, podcast episodes and My playlist. The files are kept for community members only, so this cannot be opened to the public.", defaultLevel: "community", floorLevel: "community", moduleKey: "content", enforcedBy: "app", sort: 50 },
  { key: "look", label: "Videos and recipes", description: "Look in the member app: videos and recipes. The files are kept for community members only, so this cannot be opened to the public.", defaultLevel: "community", floorLevel: "community", moduleKey: "content", enforcedBy: "app", sort: 60 },
  { key: "learn", label: "Gyan Path lessons and progress", description: "Learn in the member app: Gyan Path lessons and each person's progress. Progress is personal, so this cannot be opened to the public.", defaultLevel: "community", floorLevel: "community", moduleKey: "gyan_path", enforcedBy: "app", sort: 70 },
  { key: "niva", label: "Ask Niva", description: "Niva, the assistant that answers from the community's own pages. Questions are kept for the person who asked, so this cannot be opened to the public.", defaultLevel: "community", floorLevel: "community", moduleKey: "niva", enforcedBy: "app", sort: 80 },
];

const FEATURE_BY_KEY = new Map<string, AccessFeatureDef>(ACCESS_FEATURES.map((f) => [f.key, f]));

export function isAccessFeatureKey(v: unknown): v is AccessFeatureKey {
  return typeof v === "string" && FEATURE_BY_KEY.has(v);
}

export function accessFeatureDef(key: AccessFeatureKey): AccessFeatureDef {
  return FEATURE_BY_KEY.get(key)!;
}

// ---------------------------------------------------------------------------
// What app.access_settings(center) returns, read defensively
// ---------------------------------------------------------------------------
export type LevelKind = "public" | "community" | "membership";

export type AccessLevel = {
  key: string;
  label: string;
  rank: number;
  kind: LevelKind;
  tiers: MembershipTier[];
  membershipTypeKeys: string[];
  /** A base level: its key and rank are fixed, only its name changes. */
  locked: boolean;
};

export type AccessFeatureRow = {
  key: string;
  label: string;
  description: string;
  defaultLevel: string;
  floorLevel: string;
  /** The level the area needs now (the community's choice, else the default). */
  levelKey: string;
  enforcedBy: FeatureEnforcement;
  moduleKey: string | null;
  moduleOn: boolean;
};

export type MembershipTypeRow = { key: string; name: string; tier: string; active: boolean };

export type AccessSettings = {
  levels: AccessLevel[];
  features: AccessFeatureRow[];
  membershipTypes: MembershipTypeRow[];
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UNEXPECTED = "The database sent the access settings in a shape this page does not know. Reload; if it keeps happening, the portal and the database are out of step.";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function isTier(v: unknown): v is MembershipTier {
  return typeof v === "string" && (MEMBERSHIP_TIERS as readonly string[]).includes(v);
}

function stringList(v: unknown): string[] | null {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return null;
  return v as string[];
}

export function parseAccessSettings(raw: unknown): Parsed<AccessSettings> {
  if (!isRecord(raw) || !Array.isArray(raw.levels) || !Array.isArray(raw.features)) return { ok: false, error: UNEXPECTED };
  const levels: AccessLevel[] = [];
  for (const l of raw.levels) {
    if (!isRecord(l)) return { ok: false, error: UNEXPECTED };
    const key = text(l.key);
    const label = text(l.label);
    const kind = l.kind;
    const tiers = stringList(l.tiers);
    const types = stringList(l.membership_type_keys);
    if (!key || label === null || typeof l.rank !== "number" || !Number.isFinite(l.rank) || (kind !== "public" && kind !== "community" && kind !== "membership") || !tiers || !types) {
      return { ok: false, error: UNEXPECTED };
    }
    levels.push({ key, label, rank: l.rank, kind, tiers: tiers.filter(isTier), membershipTypeKeys: types, locked: l.locked === true || kind !== "membership" });
  }
  const features: AccessFeatureRow[] = [];
  for (const f of raw.features) {
    if (!isRecord(f)) return { ok: false, error: UNEXPECTED };
    const key = text(f.key);
    const label = text(f.label);
    const levelKey = text(f.level_key);
    const enforced = f.enforced_by;
    if (!key || label === null || !levelKey || (enforced !== "database" && enforced !== "app")) return { ok: false, error: UNEXPECTED };
    features.push({
      key,
      label,
      description: text(f.description) ?? "",
      defaultLevel: text(f.default_level) ?? "community",
      floorLevel: text(f.floor_level) ?? "community",
      levelKey,
      enforcedBy: enforced,
      moduleKey: text(f.module_key),
      moduleOn: f.module_on !== false,
    });
  }
  const types: MembershipTypeRow[] = [];
  for (const t of Array.isArray(raw.membership_types) ? raw.membership_types : []) {
    if (!isRecord(t)) return { ok: false, error: UNEXPECTED };
    const key = text(t.key);
    if (!key) return { ok: false, error: UNEXPECTED };
    types.push({ key, name: text(t.name) ?? key, tier: text(t.tier) ?? "", active: t.active !== false });
  }
  return {
    ok: true,
    value: {
      levels: [...levels].sort((a, b) => a.rank - b.rank),
      features,
      membershipTypes: types,
    },
  };
}

// ---------------------------------------------------------------------------
// Who can use each area
// ---------------------------------------------------------------------------

/** The rank of a level by key (the floor of an area is a base level). Unknown keys read as the community level. */
export function levelRank(levels: readonly Pick<AccessLevel, "key" | "rank">[], key: string): number {
  const found = levels.find((l) => l.key === key);
  if (found) return found.rank;
  return key === "public" ? 0 : 10;
}

/** The levels an area may be given: at or above its floor, lowest first. */
export function levelsAtOrAbove<L extends Pick<AccessLevel, "key" | "rank">>(levels: readonly L[], floorKey: string): L[] {
  const floor = levelRank(levels, floorKey);
  return levels.filter((l) => l.rank >= floor).sort((a, b) => a.rank - b.rank);
}

/** The areas whose chosen level differs from what is saved, as the pairs the save action sends. */
export function featureChanges(saved: Readonly<Record<string, string>>, chosen: Readonly<Record<string, string>>): { feature: string; level: string }[] {
  const out: { feature: string; level: string }[] = [];
  for (const [feature, level] of Object.entries(chosen)) {
    if (saved[feature] !== undefined && saved[feature] !== level) out.push({ feature, level });
  }
  return out;
}

export function enforcementNote(f: Pick<AccessFeatureRow, "enforcedBy">): string {
  return f.enforcedBy === "database" ? "Also enforced by the database" : "Applies in the app";
}

/** Why members cannot use an area although a level is chosen: its module is switched off. Null when it is on. */
export function moduleOffNote(f: Pick<AccessFeatureRow, "moduleOn" | "moduleKey">, moduleLabel: string): string | null {
  if (f.moduleOn) return null;
  return `${moduleLabel} is switched off (Settings › Modules), so nobody can use this area until it is switched back on.`;
}

/** Labels of the areas that use a level (the database refuses to remove a level an area still uses). */
export function removalBlockers(levelKey: string, features: readonly Pick<AccessFeatureRow, "label" | "levelKey">[]): string[] {
  return features.filter((f) => f.levelKey === levelKey).map((f) => f.label);
}

// ---------------------------------------------------------------------------
// The ladder (Levels card)
// ---------------------------------------------------------------------------

/** One membership level as the page edits it. A new level has no key yet (made from its name when saved). */
export type EditableLevel = {
  key: string;
  label: string;
  tiers: MembershipTier[];
  membershipTypeKeys: string[];
  isNew?: boolean;
};

export function editableLevels(levels: readonly AccessLevel[]): EditableLevel[] {
  return levels
    .filter((l) => l.kind === "membership")
    .sort((a, b) => a.rank - b.rank)
    .map((l) => ({ key: l.key, label: l.label, tiers: [...l.tiers], membershipTypeKeys: [...l.membershipTypeKeys] }));
}

export function newEditableLevel(): EditableLevel {
  return { key: "", label: "", tiers: [], membershipTypeKeys: [], isNew: true };
}

/** Move the item at `index` one place up (-1) or down (+1); out of range changes nothing. */
export function moveLevel<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** 2 → "b", 3 → "c" … 26 → "z", 27 → "aa": a key has no digits, so a repeated key gets a letter suffix. */
function letterSuffix(n: number): string {
  let i = n - 1;
  let out = "";
  do {
    out = String.fromCharCode(97 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
}

/**
 * A key for a new level, made from its name: lower-case letters and underscores only (the table's check, so no
 * digits), 2 to 30 long, not taken and not a base key. A name that makes a key that is already used gets a letter
 * on the end: life_member, life_member_b, life_member_c.
 */
export function slugifyLevelKey(label: string, taken: readonly string[]): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "level";
  base = base.slice(0, 30).replace(/_+$/g, "");
  if (base.length < 2) base = "level";
  const reserved = new Set<string>([...BASE_LEVEL_KEYS, ...taken]);
  if (!reserved.has(base)) return base;
  for (let n = 2; n < 703; n += 1) {
    const suffix = `_${letterSuffix(n)}`;
    const candidate = `${base.slice(0, 30 - suffix.length).replace(/_+$/g, "")}${suffix}`;
    if (!reserved.has(candidate)) return candidate;
  }
  return "level_x"; // unreachable with at most ten levels; the database would refuse a repeat anyway
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The first thing wrong with the ladder as typed, in plain English, or null. The same rules as
 * app.save_access_levels (the database still decides): names 1 to 40 characters and all different,
 * every membership level says who it is for, at most ten of them.
 */
export function levelsProblem(levels: readonly EditableLevel[], base: { public: string; community: string }): string | null {
  const names: { name: string; what: string }[] = [
    { name: base.public, what: "the Public level" },
    { name: base.community, what: "the community level" },
  ];
  for (const n of names) {
    const len = n.name.trim().length;
    if (len < 1 || len > LEVEL_LABEL_MAX) return `Give ${n.what} a name of 1 to ${LEVEL_LABEL_MAX} characters.`;
  }
  if (sameName(base.public, base.community)) return `Two levels cannot share the name "${base.public.trim()}". Give each level its own name.`;
  if (levels.length > MAX_MEMBERSHIP_LEVELS) return `A community can have at most ${MAX_MEMBERSHIP_LEVELS} membership levels above its community level.`;
  const seen = names.map((n) => n.name);
  for (const [i, l] of levels.entries()) {
    const label = l.label.trim();
    const place = `membership level ${i + 1}`;
    if (label.length < 1 || label.length > LEVEL_LABEL_MAX) return `Give ${place} a name of 1 to ${LEVEL_LABEL_MAX} characters.`;
    if (seen.some((s) => sameName(s, label))) return `Two levels cannot share the name "${label}". Give each level its own name.`;
    seen.push(label);
    if (l.tiers.length + l.membershipTypeKeys.length === 0) return `Choose at least one membership tier or type for "${label}", so the level says who it is for.`;
  }
  return null;
}

export type LevelPayload = { key: string; label: string; rank: number; tiers: MembershipTier[]; membership_type_keys: string[] };

/**
 * What app.save_access_levels takes: the levels in the order shown, numbered 20, 30, 40 …, each new one given
 * a key from its name. Tiers are sent in the database's order (community, yearly, life).
 */
export function buildLevelsPayload(levels: readonly EditableLevel[]): LevelPayload[] {
  const taken: string[] = levels.filter((l) => !l.isNew && l.key).map((l) => l.key);
  return levels.map((l, i) => {
    let key = l.key;
    if (l.isNew || !key) {
      key = slugifyLevelKey(l.label, taken);
      taken.push(key);
    }
    return {
      key,
      label: l.label.trim(),
      rank: MIN_MEMBERSHIP_RANK + RANK_STEP * i,
      tiers: MEMBERSHIP_TIERS.filter((t) => l.tiers.includes(t)),
      membership_type_keys: [...new Set(l.membershipTypeKeys)].sort(),
    };
  });
}

/**
 * How many changes the ladder as edited has against the saved one, for the Save button ("Save · 3 changes"):
 * each renamed base level, each level removed or added, each kept level whose name or rule changed, and one for
 * a new order.
 */
export function levelsChangeCount(
  saved: readonly AccessLevel[],
  editable: readonly EditableLevel[],
  base: { public: string; community: string },
): number {
  let n = 0;
  const pub = saved.find((l) => l.key === "public")?.label ?? BASE_LEVELS[0].label;
  const com = saved.find((l) => l.key === "community")?.label ?? BASE_LEVELS[1].label;
  if (base.public !== pub) n += 1;
  if (base.community !== com) n += 1;
  const before = editableLevels(saved);
  const nowKeys = new Set(editable.filter((l) => !l.isNew).map((l) => l.key));
  const beforeKeys = new Set(before.map((l) => l.key));
  n += before.filter((l) => !nowKeys.has(l.key)).length; // removed
  n += editable.filter((l) => l.isNew || !beforeKeys.has(l.key)).length; // added
  const kept = editable.filter((l) => !l.isNew && beforeKeys.has(l.key));
  for (const l of kept) {
    const old = before.find((b) => b.key === l.key)!;
    const sameTiers = MEMBERSHIP_TIERS.filter((t) => old.tiers.includes(t)).join() === MEMBERSHIP_TIERS.filter((t) => l.tiers.includes(t)).join();
    const sameTypes = [...old.membershipTypeKeys].sort().join() === [...l.membershipTypeKeys].sort().join();
    if (old.label !== l.label || !sameTiers || !sameTypes) n += 1;
  }
  if (kept.map((l) => l.key).join() !== before.filter((l) => nowKeys.has(l.key)).map((l) => l.key).join()) n += 1; // a new order
  return n;
}

function joinOr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** A membership level's rule in words, for the page and the audit trail. */
export function describeRule(level: Pick<EditableLevel, "tiers" | "membershipTypeKeys">, types: readonly Pick<MembershipTypeRow, "key" | "name">[]): string {
  const tiers = MEMBERSHIP_TIERS.filter((t) => level.tiers.includes(t)).map((t) => TIER_LABEL[t]);
  const names = level.membershipTypeKeys.map((k) => types.find((t) => t.key === k)?.name ?? k);
  const parts: string[] = [];
  if (tiers.length) parts.push(`an active ${joinOr(tiers)} membership`);
  if (names.length) parts.push(`an active membership of ${names.length === 1 ? "the type" : "the types"} ${joinOr(names)}`);
  if (!parts.length) return "No rule yet: choose who this level is for";
  const sentence = parts.join(", or ");
  return sentence[0].toUpperCase() + sentence.slice(1);
}

/** What a level means, for the line under an area's choice: who is at or above it. */
export function describeLevel(
  level: Pick<AccessLevel, "kind" | "tiers" | "membershipTypeKeys">,
  types: readonly Pick<MembershipTypeRow, "key" | "name">[],
  centerName: string,
): string {
  if (level.kind === "public") return "Anyone, signed in or not.";
  if (level.kind === "community") return `Anyone who is signed in and part of ${centerName}.`;
  return `${describeRule(level, types)}. Higher levels are included.`;
}

// ---------------------------------------------------------------------------
// The two forms post JSON in a hidden field; the actions read it back with these
// ---------------------------------------------------------------------------

/** `changes`: [{feature, level}], from the "Who can use each area" form. */
export function parseChangesField(raw: unknown): Parsed<{ feature: AccessFeatureKey; level: string }[]> {
  const bad = { ok: false, error: "the page is out of date. Reload and try again." } as const;
  if (typeof raw !== "string") return bad;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return bad;
  }
  if (!Array.isArray(data) || data.length > ACCESS_FEATURE_KEYS.length) return bad;
  const out: { feature: AccessFeatureKey; level: string }[] = [];
  for (const row of data) {
    if (!isRecord(row) || !isAccessFeatureKey(row.feature) || typeof row.level !== "string" || !LEVEL_KEY_PATTERN.test(row.level)) return bad;
    if (out.some((o) => o.feature === row.feature)) return bad;
    out.push({ feature: row.feature, level: row.level });
  }
  return { ok: true, value: out };
}

/** `levels`: the membership levels in the order shown, from the "Levels" form. */
export function parseLevelsField(raw: unknown): Parsed<EditableLevel[]> {
  const bad = { ok: false, error: "the page is out of date. Reload and try again." } as const;
  if (typeof raw !== "string") return bad;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return bad;
  }
  if (!Array.isArray(data) || data.length > MAX_MEMBERSHIP_LEVELS + 5) return bad;
  const out: EditableLevel[] = [];
  for (const row of data) {
    if (!isRecord(row) || typeof row.label !== "string" || typeof row.key !== "string") return bad;
    const tiers = stringList(row.tiers);
    const types = stringList(row.membershipTypeKeys);
    if (!tiers || !types || tiers.some((t) => !isTier(t)) || types.some((t) => t.length === 0 || t.length > 80)) return bad;
    const isNew = row.isNew === true;
    if (!isNew && !LEVEL_KEY_PATTERN.test(row.key)) return bad;
    out.push({ key: isNew ? "" : row.key, label: row.label, tiers: tiers as MembershipTier[], membershipTypeKeys: types, ...(isNew ? { isNew: true } : {}) });
  }
  return { ok: true, value: out };
}
