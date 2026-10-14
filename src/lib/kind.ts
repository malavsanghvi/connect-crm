// The organization's "kind" (an experience: Jain Temple, Church, Chamber of commerce, Neutral …) as the portal
// sees it after sign-in. It is data in the database (app.category_profile(center), migration 0594 and the
// experiences migrations): the kind's name, its wording terms, and which modules it offers. Nothing here
// names a faith: a new kind needs a catalog row, never a code change.
//
// Pure — no server imports — so it is unit-tested and usable from client components.

// Relative import: files the background service (worker/) imports reach this one, and it does not know the "@/" alias.
import type { Json } from "./database.types";

export type ModuleAvailability = "default_on" | "default_off" | "not_available";

export type KindModule = { availability: ModuleAvailability; label: string | null };

export type KindProfile = {
  key: string;
  /** "Jain Temple", "Chamber of commerce" … */
  label: string;
  faithBased: boolean;
  /** Whether the kind keeps a community tradition (centers.tradition); null when the database does not say. */
  usesTradition: boolean | null;
  /** The kind's named words (greeting, place, store …). A term may be null: the kind has no such thing. */
  terms: Record<string, string | null>;
  /** The kind's rows per module key (its own name for the module, and whether it is offered at all). */
  modules: Record<string, KindModule>;
};

/**
 * The Jain Center kind exactly as migration 0594 seeds it: every module and the tradition's words. It is ONE kind among
 * many, kept as a fixture for the screens and tests that need a faith kind with a tradition pack; it is NOT a fallback. A test
 * pins it to the 0594 seed of the Jain Center row.
 */
export const LEGACY_KIND: KindProfile = {
  key: "jain_center",
  label: "Jain Center",
  faithBased: true,
  usesTradition: true,
  terms: {
    greeting: "Jai Jinendra",
    practice_tab: "Jain Way",
    give_tab: "Give",
    family_tab: "Family",
    store: "My Store",
    school: "Pathshala",
    learning: "Gyan Path",
    place: "derasar",
    assistant_context: "a Jain community",
  },
  modules: {},
};

/**
 * What the portal shows when the database cannot say which kind an organization is (category_profile missing, failing, or
 * unreadable): the neutral kind, the "Community organization" row of 0594/0600, with none of a tradition's words and none of the
 * modules that only a faith kind has. Any organization can be anything; a lookup that fails must never make one look like a Jain
 * Center. The database still enforces what is on; this is only wording. A test pins it to the migration rows.
 */
export const NEUTRAL_KIND: KindProfile = {
  key: "nonprofit_secular",
  label: "Community organization",
  faithBased: false,
  usesTradition: false,
  terms: {
    greeting: "Welcome",
    practice_tab: null,
    give_tab: "Give",
    family_tab: "Family",
    store: "Store",
    school: null,
    learning: null,
    place: "office",
    assistant_context: "a community organization",
  },
  modules: {
    bolis: { availability: "not_available", label: null },
    jain_way: { availability: "not_available", label: null },
    pathshala: { availability: "not_available", label: null },
    gyan_path: { availability: "not_available", label: null },
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

const AVAILABILITIES: readonly string[] = ["default_on", "default_off", "not_available"];

/**
 * Reads app.category_profile(center)'s answer. Returns null when it is not the shape the contract promises
 * (the caller then keeps LEGACY_KIND and logs). Unknown extra keys are kept: a new kind may add terms.
 */
export function parseKindProfile(raw: Json | null | undefined): KindProfile | null {
  if (!isRecord(raw)) return null;
  const cat = raw.category;
  if (!isRecord(cat)) return null;
  const key = str(cat.key);
  const label = str(cat.label);
  if (!key || !label) return null;
  const terms: Record<string, string | null> = {};
  if (isRecord(cat.terms)) {
    for (const [k, v] of Object.entries(cat.terms)) {
      if (typeof v === "string") terms[k] = v;
      else if (v === null) terms[k] = null;
    }
  }
  const modules: Record<string, KindModule> = {};
  if (isRecord(raw.modules)) {
    for (const [k, v] of Object.entries(raw.modules)) {
      if (!isRecord(v)) continue;
      const availability = typeof v.availability === "string" && AVAILABILITIES.includes(v.availability) ? (v.availability as ModuleAvailability) : "default_on";
      modules[k] = { availability, label: str(v.label) };
    }
  }
  return {
    key,
    label,
    faithBased: cat.faith_based === true,
    usesTradition: typeof cat.uses_tradition === "boolean" ? cat.uses_tradition : null,
    terms,
    modules,
  };
}

/** The kind's word for something (`greeting`, `place` …), or `fallback` when the kind has none (or says it has no such thing). */
export function kindTerm(kind: Pick<KindProfile, "terms">, key: string, fallback = ""): string {
  const v = kind.terms[key];
  return typeof v === "string" && v.trim() !== "" ? v : fallback;
}

/** True when the kind explicitly has no such thing (the term is JSON null), for example a chamber has no `school`. */
export function kindLacks(kind: Pick<KindProfile, "terms">, key: string): boolean {
  return key in kind.terms && kind.terms[key] === null;
}

/** The kind's availability of a module. A module the kind has no row for is `default_on` (the "no row means on" contract). */
export function moduleAvailabilityIn(kind: Pick<KindProfile, "modules">, moduleKey: string): ModuleAvailability {
  return kind.modules[moduleKey]?.availability ?? "default_on";
}

/** True when the kind never offers the module: no switch, hidden everywhere. */
export function moduleNotOffered(kind: Pick<KindProfile, "modules">, moduleKey: string): boolean {
  return moduleAvailabilityIn(kind, moduleKey) === "not_available";
}

/** "a Church" / "an Other club": the article a sentence needs before the kind's name. */
export function withArticle(label: string): string {
  return /^[aeiou]/i.test(label.trim()) ? `an ${label.trim()}` : `a ${label.trim()}`;
}

/**
 * The kind's name followed by "organization", without saying the word twice: the neutral kind is called "Community
 * organization" already ("a Community organization", not "a Community organization organization").
 */
export function kindOrganization(label: string): string {
  const l = label.trim();
  return /organi[sz]ation$/i.test(l) ? l : `${l} organization`;
}

/** The same, plural: "Chamber of commerce organizations", "Community organizations". */
export function kindOrganizations(label: string): string {
  return `${kindOrganization(label)}s`;
}

/** The sentence for a module this kind does not offer ("Bolis is not part of a Chamber of commerce organization."). */
export function notPartOfKindSentence(moduleLabel: string, kindLabel: string): string {
  return `${moduleLabel} is not part of ${withArticle(kindOrganization(kindLabel))}.`;
}

/** The longer explanation under it, for a page. */
export function notOfferedExplanation(centerName: string, kindLabel: string, what = "this module"): string {
  return `${centerName} is set up as ${withArticle(kindOrganization(kindLabel))}, which does not have ${what}. Weaver can change an organization's kind if that is wrong.`;
}

/** The module's name in this kind (the kind's own wording, else the catalog's). */
export function kindModuleLabel(kind: Pick<KindProfile, "modules">, moduleKey: string, catalogLabel: string): string {
  return kind.modules[moduleKey]?.label ?? catalogLabel;
}

// ---------------------------------------------------------------------------
// Reading the database's answer, with the same graceful fallback the module list has
// ---------------------------------------------------------------------------

export type LoadedKind = { kind: KindProfile; status: "ok" | "missing" | "error" };

type KindProfileResult = { data: Json | null; error: { code?: string | null; message?: string | null } | null };

/**
 * The result of `app.category_profile(center)` for the session. When the function is not in the database yet
 * ("missing"), fails ("error") or answers with something unreadable, the portal shows the NEUTRAL kind (NEUTRAL_KIND: no
 * tradition words) rather than breaking the page or guessing a faith; the failure is logged by the caller, once.
 */
export function kindFromProfileResult(res: KindProfileResult): LoadedKind {
  if (res.error) {
    const code = res.error.code ?? "";
    const missing = ["PGRST202", "42883"].includes(code) || /could not find the function|function .* does not exist/i.test(res.error.message ?? "");
    return { kind: NEUTRAL_KIND, status: missing ? "missing" : "error" };
  }
  const parsed = parseKindProfile(res.data);
  return parsed ? { kind: parsed, status: "ok" } : { kind: NEUTRAL_KIND, status: "error" };
}

const quietUntil = new Map<string, number>();
const QUIET_MS = 10 * 60_000;

/**
 * True the first time a fallback is reported for `key` (an organization and why), then false for ten minutes: a database that
 * is down logs the neutral fallback once, not once for every page and request.
 */
export function shouldReportKindFallback(key: string, now: number = Date.now()): boolean {
  if ((quietUntil.get(key) ?? 0) > now) return false;
  quietUntil.set(key, now + QUIET_MS);
  return true;
}

/**
 * Why the portal is showing the default wording instead of the organization's own kind, for the caller to log with
 * `failure()`; null when the kind loaded. Every fallback is reported, not just a failed call: the function not being in
 * the database yet ("missing"), and an answer the portal cannot read (the database returns no error of its own then, so
 * one is made here rather than logging "null").
 */
export function kindFallbackProblem(loaded: LoadedKind, res: KindProfileResult): { context: string; error: unknown } | null {
  if (loaded.status === "ok") return null;
  if (loaded.status === "missing") {
    return { context: "The organization's kind is not available from the database yet (showing the default wording)", error: res.error };
  }
  return {
    context: "Could not read the organization's kind (showing the default wording)",
    error: res.error ?? new Error("app.category_profile answered with something the portal could not read"),
  };
}

// ---------------------------------------------------------------------------
// What a kind has, beyond the modules it offers
// ---------------------------------------------------------------------------

/**
 * Parts of a screen that exist only for some kinds. Each is decided from the kind's own data, never from its name:
 *   labh        Labh fulfillment (a gift of a pledge's blessing): the `labh` module when the database has one, else
 *               the Bolis module, which a kind always has or lacks together with it.
 *   tradition   the tradition pack: panchang and tithi, the daily timings (navkarsi, chauvihar), pachchakhan, the
 *               tradition's flyer occasions and KPIs. The kinds whose `uses_tradition` is true. A kind the database
 *               says nothing about keeps today's screens.
 *   live_stream the live stream (the access area "darshan"). Migration 0600 tags that area for the Jain Center only:
 *               the database leaves it out for any other kind and gives no stream to a member there, so a stream added
 *               for such a kind could never be watched and the portal does not offer to add one.
 */
export type KindFeature = "labh" | "tradition" | "live_stream";

export function kindHas(kind: Pick<KindProfile, "modules" | "usesTradition">, feature: KindFeature): boolean {
  switch (feature) {
    case "labh":
      return !moduleNotOffered(kind, "labh" in kind.modules ? "labh" : "bolis");
    case "tradition":
    case "live_stream":
      return kind.usesTradition !== false;
  }
}

/** A part of the kind's own wording for a module that the NAV and the screens name by default. */
const MODULE_TERM: Readonly<Record<string, string>> = { store: "store", pathshala: "school", gyan_path: "learning" };

/**
 * A module's name in this kind: the kind's own name for the module (category_modules.label) first, else the kind's
 * term for it (the store, the school, the learning path), else `fallback`, the name the screens always had.
 */
export function kindName(kind: Pick<KindProfile, "modules" | "terms">, moduleKey: string, fallback: string): string {
  const own = kind.modules[moduleKey]?.label;
  if (own) return own;
  const term = MODULE_TERM[moduleKey];
  return term ? kindTerm(kind, term, fallback) : fallback;
}

/** What the kind calls its religious school ("Pathshala"), or null when the kind has none (a chamber, a club …). */
export function kindSchool(kind: Pick<KindProfile, "modules" | "terms">): string | null {
  return moduleNotOffered(kind, "pathshala") ? null : kindName(kind, "pathshala", "Pathshala");
}
