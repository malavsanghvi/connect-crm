// The kinds of organization Weaver can set up ("experiences": Jain Temple, Swaminarayan Temple, several kinds
// of church, Chamber of commerce, Club, Non-profit, Neutral …). The catalog is DATA in the database
// (app.list_experiences()): a new kind is a catalog row with its module defaults and wording terms, never a
// code change. This file turns the rows into the two-step picker the Platform screens show:
//
//   Faith-based  →  tradition family (Jain, Swaminarayan, Christian …)  →  the specific kind
//   Chamber of commerce / Club / Non-profit / Other / Neutral …            (one step: the kind itself)
//
// Pure — no server imports — so it is unit-tested and usable from client components.

import type { OrgType } from "@/lib/platform-onboarding";

/** One row of app.list_experiences(): the contract (key, label, description, family, faith_based, active, sort). */
export type ExperienceRow = {
  key: string;
  label: string;
  description?: string | null;
  family_key?: string | null;
  family_label?: string | null;
  faith_based?: boolean | null;
  active?: boolean | null;
  sort?: number | null;
  /** Not in the contract yet: read from the catalog table when the database offers it, else unknown (null). */
  uses_tradition?: boolean | null;
};

export type Experience = {
  key: string;
  label: string;
  description: string;
  familyKey: string | null;
  familyLabel: string | null;
  faithBased: boolean;
  /** Only an active kind can be chosen for a live organization; an inactive one only as a sandbox preview. */
  active: boolean;
  sort: number;
  /** Whether the kind keeps a community tradition (centers.tradition). null = the database did not say. */
  usesTradition: boolean | null;
};

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** Turns the database rows into experiences; a row that is not usable (no key or name) is left out. */
export function toExperiences(rows: readonly unknown[] | null | undefined): Experience[] {
  const out: Experience[] = [];
  const seen = new Set<string>();
  for (const raw of rows ?? []) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as ExperienceRow;
    if (typeof r.key !== "string" || !KEY_RE.test(r.key) || seen.has(r.key)) continue;
    if (typeof r.label !== "string" || r.label.trim() === "") continue;
    seen.add(r.key);
    out.push({
      key: r.key,
      label: r.label.trim(),
      description: typeof r.description === "string" ? r.description.trim() : "",
      familyKey: typeof r.family_key === "string" && r.family_key.trim() ? r.family_key.trim() : null,
      familyLabel: typeof r.family_label === "string" && r.family_label.trim() ? r.family_label.trim() : null,
      faithBased: r.faith_based === true,
      active: r.active === true,
      sort: typeof r.sort === "number" ? r.sort : 1_000_000,
      usesTradition: typeof r.uses_tradition === "boolean" ? r.uses_tradition : null,
    });
  }
  return out.sort(bySort);
}

function bySort(a: { sort: number; label: string }, b: { sort: number; label: string }): number {
  return a.sort - b.sort || a.label.localeCompare(b.label);
}

// ---------------------------------------------------------------------------
// The two-step picker
// ---------------------------------------------------------------------------

/** The value of the first step's "Faith-based" choice. Real keys match ^[a-z][a-z0-9_]+$, so this cannot collide. */
export const FAITH_TOP = "__faith__";
/** The family a faith-based kind falls into when the catalog gives it none. */
export const NO_FAMILY = "__other__";

export type KindFamily = { key: string; label: string; experiences: Experience[] };

export type KindPickerModel = {
  /** Faith-based kinds, grouped by tradition family (empty when the catalog has none). */
  families: KindFamily[];
  /** Every other kind (chamber, club, non-profit, neutral …): each is a choice of the first step by itself. */
  others: Experience[];
};

/** Which kinds the picker offers. A live organization may only have an active kind; a sandbox may preview any. */
export function buildKindPicker(list: readonly Experience[], opts: { includeInactive: boolean }): KindPickerModel {
  const usable = list.filter((e) => opts.includeInactive || e.active);
  const byFamily = new Map<string, KindFamily & { sort: number }>();
  for (const e of usable.filter((x) => x.faithBased)) {
    const key = e.familyKey ?? NO_FAMILY;
    const fam = byFamily.get(key) ?? { key, label: e.familyLabel ?? (e.familyKey ? e.familyKey : "Other"), experiences: [], sort: e.sort };
    fam.experiences.push(e);
    fam.sort = Math.min(fam.sort, e.sort);
    if (e.familyLabel && fam.label !== e.familyLabel && fam.label === e.familyKey) fam.label = e.familyLabel;
    byFamily.set(key, fam);
  }
  const families = [...byFamily.values()]
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map((f): KindFamily => ({ key: f.key, label: f.label, experiences: [...f.experiences].sort(bySort) }));
  return { families, others: usable.filter((e) => !e.faithBased).sort(bySort) };
}

/** Where the person is in the picker: the first step's choice, the family (faith only), and the chosen kind. */
export type KindSelection = { top: string | null; family: string | null; key: string | null };

export const EMPTY_SELECTION: KindSelection = { top: null, family: null, key: null };

/** The choices of the first step: "Faith-based" (when the catalog has faith-based kinds), then each other kind. */
export function topChoices(model: KindPickerModel): { value: string; label: string }[] {
  return [
    ...(model.families.length > 0 ? [{ value: FAITH_TOP, label: "Faith-based" }] : []),
    ...model.others.map((e) => ({ value: e.key, label: e.label })),
  ];
}

function familyOf(model: KindPickerModel, key: string | null): KindFamily | null {
  return model.families.find((f) => f.key === key) ?? null;
}

/** Choose the first step. A family or a kind that is the only one is chosen with it, so nobody clicks through a single option. */
export function chooseTop(model: KindPickerModel, top: string): KindSelection {
  if (top === FAITH_TOP) {
    if (model.families.length === 1) return chooseFamily(model, model.families[0].key);
    return { top: FAITH_TOP, family: null, key: null };
  }
  const e = model.others.find((x) => x.key === top);
  return e ? { top, family: null, key: e.key } : EMPTY_SELECTION;
}

export function chooseFamily(model: KindPickerModel, family: string): KindSelection {
  const fam = familyOf(model, family);
  if (!fam) return { top: FAITH_TOP, family: null, key: null };
  return { top: FAITH_TOP, family: fam.key, key: fam.experiences.length === 1 ? fam.experiences[0].key : null };
}

export function chooseKind(model: KindPickerModel, key: string): KindSelection {
  return selectionFor(model, key) ?? EMPTY_SELECTION;
}

/** The picker position of a kind key, or null when the picker does not offer it. */
export function selectionFor(model: KindPickerModel, key: string | null | undefined): KindSelection | null {
  if (!key) return null;
  for (const f of model.families) if (f.experiences.some((e) => e.key === key)) return { top: FAITH_TOP, family: f.key, key };
  if (model.others.some((e) => e.key === key)) return { top: key, family: null, key };
  return null;
}

/** The kind the selection points at, or null while the person has not finished choosing. */
export function chosenKind(model: KindPickerModel, sel: KindSelection): Experience | null {
  if (!sel.key) return null;
  return [...model.families.flatMap((f) => f.experiences), ...model.others].find((e) => e.key === sel.key) ?? null;
}

/** The family step's options once "Faith-based" is chosen. */
export function familyChoices(model: KindPickerModel): { value: string; label: string }[] {
  return model.families.map((f) => ({ value: f.key, label: f.label }));
}

/** The specific kinds of the chosen family. */
export function kindChoices(model: KindPickerModel, family: string | null): Experience[] {
  return familyOf(model, family)?.experiences ?? [];
}

// ---------------------------------------------------------------------------
// The applicant's own words ("Kind of organization" on the public request form) as a hint
// ---------------------------------------------------------------------------

/**
 * Where the picker starts for an access request: the kind Weaver already chose (if any), else a guess from
 * what the applicant said (a hint only; Weaver decides). A temple is faith-based, so the first step is chosen
 * and Weaver picks the tradition; the other answers pre-select a matching non-faith kind when the catalog has one.
 */
export function selectionForRequest(model: KindPickerModel, chosenKey: string | null | undefined, orgType: string | null | undefined): KindSelection {
  const chosen = selectionFor(model, chosenKey);
  if (chosen) return chosen;
  if (orgType === "temple" && model.families.length > 0) return model.families.length === 1 ? chooseFamily(model, model.families[0].key) : { top: FAITH_TOP, family: null, key: null };
  const find = (re: RegExp) => model.others.find((e) => re.test(e.key) || re.test(e.label));
  const guess = orgType === "community_center" ? (find(/club|community/i) ?? find(/non.?profit/i)) : orgType === "other_nonprofit" ? find(/non.?profit/i) : undefined;
  return guess ? { top: guess.key, family: null, key: guess.key } : EMPTY_SELECTION;
}

/**
 * The older "kind" the sandbox function still wants next to the new choice (app.platform_create_sandbox's
 * p_org_type, kept in rules.onboarding.org_type and read by nothing else): a faith-based kind is a temple, any
 * other is an other non-profit. The kind itself is the category key.
 */
export function legacyOrgType(kind: Pick<Experience, "faithBased"> | null | undefined): OrgType {
  return kind?.faithBased ? "temple" : "other_nonprofit";
}

/** The label of a kind key, for lists; the key itself when the catalog does not have it. */
export function experienceLabel(list: readonly Experience[], key: string | null | undefined): string {
  if (!key) return "—";
  return list.find((e) => e.key === key)?.label ?? key;
}
