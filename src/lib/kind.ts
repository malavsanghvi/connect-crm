// The organization's "kind" (an experience: Jain Temple, Church, Chamber of commerce, Neutral …) as the portal
// sees it after sign-in. It is data in the database (app.category_profile(center), migration 0594 and the
// experiences migrations): the kind's name, its wording terms, and which modules it offers. Nothing here
// names a faith: a new kind needs a catalog row, never a code change.
//
// Pure — no server imports — so it is unit-tested and usable from client components.

import type { Json } from "@/lib/database.types";

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
 * What the portal showed before kinds existed: a Jain Center, which has every module and today's words.
 * Used ONLY when the database cannot answer (category_profile missing or failing), so the live organization
 * never changes because of a hiccup; a test pins it to the 0594 seed of the Jain Center row. Every other kind
 * comes from the database.
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
    store: "Satvik Store",
    school: "Pathshala",
    learning: "Gyan Path",
    place: "derasar",
    assistant_context: "a Jain community",
  },
  modules: {},
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
export function notOfferedExplanation(centerName: string, kindLabel: string): string {
  return `${centerName} is set up as ${withArticle(kindOrganization(kindLabel))}, which does not have this module. Weaver can change an organization's kind if that is wrong.`;
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
 * ("missing") or fails ("error"), the portal keeps showing what it showed before kinds existed (LEGACY_KIND:
 * a Jain Center, every module) rather than breaking the page; the failure is logged by the caller.
 */
export function kindFromProfileResult(res: KindProfileResult): LoadedKind {
  if (res.error) {
    const code = res.error.code ?? "";
    const missing = ["PGRST202", "42883"].includes(code) || /could not find the function|function .* does not exist/i.test(res.error.message ?? "");
    return { kind: LEGACY_KIND, status: missing ? "missing" : "error" };
  }
  const parsed = parseKindProfile(res.data);
  return parsed ? { kind: parsed, status: "ok" } : { kind: LEGACY_KIND, status: "error" };
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
