// "What kind of organization are you?" on the public Request access page (owner direction 2026-10-08): Weaver is for every
// association and community, so nothing here is faith-specific by default. The choices come from the experiences catalog
// (app.list_experiences(), migrations 0600-0605: the kinds of organization Weaver can be set up for), grouped into the broad
// choices of step 1 (Faith-based, then the catalog's other families) and the more specific choices of step 2 (a Jain temple,
// a Swaminarayan temple, a church ...). A built-in list is used ONLY when the catalog cannot be read, and that is logged.
//
// Pure functions only, so they are unit-tested; the loader that calls the database is src/lib/org-choices-load.ts.

/** One row of app.list_experiences(). Only the fields used here; extra columns are ignored. */
export type ExperienceRow = {
  key: string;
  label: string;
  description?: string | null;
  family_key: string;
  family_label: string;
  faith_based: boolean;
  active?: boolean | null;
  sort?: number | null;
};

/** A specific choice inside a group (step 2): "Jain temple", "Church". */
export type OrgChoice = {
  key: string;
  label: string;
  description: string | null;
  /** The catalog family it belongs to, shown as a heading when a group has more than one. */
  family: string | null;
};

/** A broad choice (step 1). `key` is what is stored as the request's org_type. */
export type OrgGroup = {
  key: string;
  label: string;
  faithBased: boolean;
  /** Step 2, in order. Empty: the group has nothing more specific to ask. */
  choices: OrgChoice[];
  /** The one experience of a group that has only one (so it is stored without being asked). */
  implied: OrgChoice | null;
  /** The question above step 2. */
  choicesLabel: string;
  /** The label of the free-text field. */
  detailLabel: string;
  detailPlaceholder: string;
  /** True when the applicant must write something (Other). */
  detailRequired: boolean;
};

export const FAITH_GROUP_KEY = "faith_based";
export const OTHER_KEY = "other";

const FAITH_DETAIL_LABEL = "Tell us more, for example your temple, church, mosque or tradition";
const FAITH_DETAIL_PLACEHOLDER = "For example: our temple, our church, our mosque or the tradition we follow";
const GENERIC_DETAIL_LABEL = "Anything you would like to add about your organization (optional)";
const OTHER_DETAIL_LABEL = "Tell us what kind of organization you are";

const OTHER_GROUP: OrgGroup = {
  key: OTHER_KEY,
  label: "Other",
  faithBased: false,
  choices: [],
  implied: null,
  choicesLabel: "",
  detailLabel: OTHER_DETAIL_LABEL,
  detailPlaceholder: "For example: a neighborhood association, an alumni network, a cultural society",
  detailRequired: true,
};

const OTHER_FAITH_CHOICE: OrgChoice = { key: OTHER_KEY, label: "Another tradition or community", description: null, family: null };

function faithGroup(choices: OrgChoice[]): OrgGroup {
  return {
    key: FAITH_GROUP_KEY,
    label: "Faith-based",
    faithBased: true,
    choices: [...choices, OTHER_FAITH_CHOICE],
    implied: null,
    choicesLabel: "Which best describes you?",
    detailLabel: FAITH_DETAIL_LABEL,
    detailPlaceholder: FAITH_DETAIL_PLACEHOLDER,
    detailRequired: false,
  };
}

function plainGroup(key: string, label: string, detailLabel = GENERIC_DETAIL_LABEL): OrgGroup {
  return { key, label, faithBased: false, choices: [], implied: null, choicesLabel: "", detailLabel, detailPlaceholder: "", detailRequired: false };
}

/**
 * The built-in list, used only when the catalog cannot be read. Deliberately generic: kinds of place and association, no
 * tradition by name (the applicant names theirs in "Tell us more").
 */
export const FALLBACK_ORG_GROUPS: readonly OrgGroup[] = [
  faithGroup([
    { key: "church", label: "Church", description: null, family: null },
    { key: "temple", label: "Temple", description: null, family: null },
    { key: "mosque", label: "Mosque", description: null, family: null },
    { key: "synagogue", label: "Synagogue", description: null, family: null },
    { key: "gurdwara", label: "Gurdwara", description: null, family: null },
  ]),
  plainGroup("business_association", "Chamber of commerce or business association"),
  plainGroup("club_association", "Club or association"),
  plainGroup("nonprofit", "Non-profit"),
  OTHER_GROUP,
];

function clean(s: unknown, max: number): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

const KEY_RE = /^[a-z][a-z0-9_]{1,59}$/;

function bySortThenLabel<T extends { sort: number; label: string }>(a: T, b: T): number {
  return a.sort - b.sort || a.label.localeCompare(b.label);
}

/** Reads whatever list_experiences returned into rows; anything that is not an experience is dropped. */
export function parseExperiences(data: unknown): ExperienceRow[] {
  if (!Array.isArray(data)) return [];
  const out: ExperienceRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const key = clean(r.key, 60);
    const label = clean(r.label, 120);
    const familyKey = clean(r.family_key, 40);
    if (!KEY_RE.test(key) || !label || !/^[a-z][a-z0-9_]{1,39}$/.test(familyKey)) continue;
    out.push({
      key,
      label,
      description: clean(r.description, 300) || null,
      family_key: familyKey,
      family_label: clean(r.family_label, 120) || label,
      faith_based: r.faith_based === true,
      active: r.active === false ? false : true,
      sort: typeof r.sort === "number" && Number.isFinite(r.sort) ? r.sort : 0,
    });
  }
  return out;
}

/**
 * The catalog's experiences as the form's groups. Faith-based experiences are one group, "Faith-based", whose second step lists
 * them (under their family when there is more than one); every other family is its own group, with a second step only when it
 * holds more than one experience. "Other" is always last. Inactive experiences are not offered. An empty catalog gives null,
 * so the caller falls back to the built-in list (and says so).
 */
export function groupExperiences(rows: readonly ExperienceRow[]): OrgGroup[] | null {
  const live = rows.filter((r) => r.active !== false);
  if (live.length === 0) return null;
  const toChoice = (r: ExperienceRow, showFamily: boolean): OrgChoice => ({
    key: r.key,
    label: r.label,
    description: r.description?.trim() || null,
    family: showFamily ? r.family_label : null,
  });
  const sorted = [...live].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.label.localeCompare(b.label));

  const groups: OrgGroup[] = [];
  const faith = sorted.filter((r) => r.faith_based);
  if (faith.length > 0) {
    const families = new Set(faith.map((r) => r.family_key));
    groups.push(faithGroup(faith.map((r) => toChoice(r, families.size > 1))));
  }

  const used = new Set<string>([FAITH_GROUP_KEY, OTHER_KEY]);
  const families = new Map<string, { label: string; sort: number; rows: ExperienceRow[] }>();
  for (const r of sorted.filter((x) => !x.faith_based)) {
    const f = families.get(r.family_key) ?? { label: r.family_label, sort: r.sort ?? 0, rows: [] };
    f.rows.push(r);
    families.set(r.family_key, f);
  }
  for (const [familyKey, f] of [...families.entries()].sort((a, b) => bySortThenLabel(a[1], b[1]))) {
    // A family called faith_based or other would collide with the two fixed groups: keep it, under a distinct key.
    const key = used.has(familyKey) ? `${familyKey}_family` : familyKey;
    used.add(key);
    const group = plainGroup(key, f.label);
    if (f.rows.length > 1) {
      group.choices = [...f.rows.map((r) => toChoice(r, false)), { key: OTHER_KEY, label: "Another kind", description: null, family: null }];
      group.choicesLabel = "Which best describes you?";
    } else {
      group.implied = toChoice(f.rows[0], false);
    }
    groups.push(group);
  }
  groups.push(OTHER_GROUP);
  return groups;
}

const FALLBACK_BY_KEY = new Map(FALLBACK_ORG_GROUPS.map((g) => [g.key, g]));

export type OrgSelection = {
  orgType: string;
  orgTypeLabel: string;
  experienceKey: string | null;
  experienceLabel: string | null;
  detail: string | null;
};

/**
 * Turns what the applicant submitted into what is stored, with the labels taken from the catalog (never from the form). An unknown
 * group or choice, a missing second step and an empty "Other" each give one plain sentence. The built-in list is also accepted, so a
 * form that was drawn while the catalog was unreachable still validates once the catalog answers (and the other way round for the
 * groups; a specific catalog choice the built-in list does not know needs the catalog to be readable again).
 */
export function resolveOrgSelection(
  groups: readonly OrgGroup[],
  input: { group: string; choice: string; detail: string },
): { ok: true; value: OrgSelection } | { ok: false; error: string } {
  const detail = clean(input.detail, 500) || null;
  const key = input.group.trim();
  const offered = groups.find((g) => g.key === key) ?? FALLBACK_BY_KEY.get(key);
  if (!offered) return { ok: false, error: "Choose what kind of organization you are." };
  const wanted = input.choice.trim();
  const candidates = [...offered.choices, ...(FALLBACK_BY_KEY.get(key)?.choices ?? [])];
  let choice: OrgChoice | null = wanted ? (candidates.find((c) => c.key === wanted) ?? null) : null;
  if (!choice && offered.choices.length > 1) {
    return { ok: false, error: `Choose which best describes your ${offered.faithBased ? "faith community" : "organization"}, or Other.` };
  }
  if (!choice) choice = offered.implied;
  const isOther = offered.key === OTHER_KEY || choice?.key === OTHER_KEY;
  if (isOther && (!detail || detail.length < 3)) {
    return { ok: false, error: "Tell us a little about your organization so we can set it up." };
  }
  return {
    ok: true,
    value: {
      orgType: offered.key,
      orgTypeLabel: offered.label,
      experienceKey: choice?.key ?? null,
      experienceLabel: choice?.label ?? null,
      detail,
    },
  };
}

// ── What the organization wants to use Weaver for ───────────────────────────
// Neutral needs mapped to the module keys the database already has (app.modules); nothing consumes them yet beyond Platform >
// Requests, which shows them to the Weaver team. No faith words here: "Classes and learning" is the Pathshala and Gyan Path
// modules for the organizations that have them.
export const NEEDS = [
  { key: "members", label: "Members and dues", modules: ["people", "membership"] },
  { key: "events", label: "Events and tickets", modules: ["events"] },
  { key: "donations", label: "Donations and fundraising", modules: ["giving"] },
  { key: "communications", label: "Email and text communications", modules: ["comms"] },
  { key: "volunteers", label: "Volunteers", modules: ["volunteers"] },
  { key: "learning", label: "Classes and learning", modules: ["pathshala", "gyan_path"] },
  { key: "store", label: "A store or shop", modules: ["store"] },
] as const;
export type NeedKey = (typeof NEEDS)[number]["key"];

/** The module keys for the needs a form ticked (unknown needs are ignored; the result is sorted and has no repeats). */
export function modulesForNeeds(needs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of NEEDS) if (needs.includes(n.key)) for (const m of n.modules) out.add(m);
  return [...out].sort();
}

// ── Showing a stored request ────────────────────────────────────────────────
const LEGACY_KIND_LABEL: Record<string, string> = {
  temple: "Temple",
  community_center: "Community center",
  other_nonprofit: "Other non-profit",
};

/** "Faith-based · Jain temple" (or the older "Temple") for the requests list. Labels stored with the request win. */
export function requestKindText(r: {
  org_type: string;
  org_type_label?: string | null;
  experience_key?: string | null;
  experience_label?: string | null;
}): string {
  const group = r.org_type_label?.trim() || LEGACY_KIND_LABEL[r.org_type] || humanizeKey(r.org_type);
  let specific = r.experience_label?.trim() || "";
  if (!specific && r.experience_key) specific = r.experience_key === OTHER_KEY ? "Other" : humanizeKey(r.experience_key);
  return specific && specific !== group ? `${group} · ${specific}` : group;
}

function humanizeKey(k: string): string {
  const s = k.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Other";
}
