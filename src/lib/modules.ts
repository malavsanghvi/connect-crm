// Module registry (WAVE2 contract): the canonical module keys shared by the
// database (app.modules), the portal and the member app, plus which portal
// URLs belong to which module. Pure — no server imports — so it is testable
// and usable from client components.
//
// A module that is switched off is hidden from NAV (src/lib/permissions.ts
// reads `modulesOff` from the context) and its direct URLs render a plain
// "switched off" page (src/components/module-gate.tsx). The database is the
// enforcement (restrictive RLS + app.assert_module_enabled); this is UI.

import { NAV, pathUnder } from "@/lib/permissions";

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  /** Core modules can never be switched off. */
  core: boolean;
  dependsOn: readonly ModuleKey[];
  description: string;
};

export const MODULE_KEYS = [
  "people",
  "membership",
  "events",
  "giving",
  "giving_bank",
  "giving_proofs",
  "giving_counts",
  "giving_insights",
  "giving_opportunities",
  "giving_recurring",
  "giving_statements",
  "labh",
  "bolis",
  "store",
  "pathshala",
  "gyan_path",
  "jain_way",
  "content",
  "calendar",
  "comms",
  "surveys",
  "volunteers",
  "accounting",
  "reports",
  "niva",
  "governance",
  // The Marketplace products (connect-crm 0750): neutral keys, brand labels. Installed member apps ignore keys they do not know.
  "ai",
  "website",
  "channels",
  "care",
  "matching",
  // The Community Market (0830): a second section of the store; off for every kind until Weaver grants it.
  "market",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** The contract's table, in its order. The database catalog (app.modules) wins when it is available. */
export const MODULES: readonly ModuleDef[] = [
  { key: "people", label: "Members & families", core: true, dependsOn: [], description: "Households, people, the directory, zones, change requests and merges." },
  { key: "membership", label: "Membership", core: false, dependsOn: ["people"], description: "Membership types, memberships, applications, new-member onboarding and voting eligibility." },
  { key: "events", label: "Events & RSVP", core: false, dependsOn: ["people"], description: "Events, templates, RSVPs, tickets, check-in, lunch slots, event volunteers and feedback." },
  { key: "giving", label: "Pledges & donations", core: false, dependsOn: ["people"], description: "Funds, campaigns, pledges, payments, allocations, refunds, receipts and the ways to pay. Its add-ons follow." },
  { key: "giving_bank", label: "Bank reconciliation", core: false, dependsOn: ["giving"], description: "Bank accounts, statement imports and lines, known payers, and member Zelle reports matched to the bank statement." },
  { key: "giving_proofs", label: "Payment confirmations", core: false, dependsOn: ["giving"], description: "Members send a photo or file when they paid another way. The pledges it covers show Soft credit until the treasury team approves it." },
  { key: "giving_counts", label: "Offering counts", core: false, dependsOn: ["giving"], description: "Counting sessions for cash and checks collected in person, and the valuables register." },
  { key: "giving_insights", label: "Insights", core: false, dependsOn: ["giving"], description: "Giving insights for the treasurer and the household panel under Giving at a glance." },
  { key: "giving_opportunities", label: "Opportunities", core: false, dependsOn: ["giving"], description: "Sponsorships and other opportunities inside campaigns that members choose from." },
  { key: "giving_recurring", label: "Recurring gifts", core: false, dependsOn: ["giving"], description: "Gifts that repeat on a schedule or on a family's special day." },
  { key: "giving_statements", label: "Statements", core: false, dependsOn: ["giving"], description: "Year-end and pledge statements issued to households. Receipts stay part of Giving." },
  { key: "labh", label: "Special-day offerings", core: false, dependsOn: ["giving"], description: "The offerings menu on a family's special days and the fulfillment of each offering taken." },
  { key: "bolis", label: "Bolis", core: false, dependsOn: ["giving"], description: "Bolis, boli pledges and the in-person upload." },
  { key: "store", label: "My Store", core: false, dependsOn: ["people"], description: "Store items, inventory, orders and pickup windows." },
  { key: "pathshala", label: "Pathshala", core: false, dependsOn: ["people"], description: "Terms, tracks, classes, teachers, enrollments, attendance, progress reports and the committee." },
  { key: "gyan_path", label: "Gyan Path (learning)", core: false, dependsOn: [], description: "Gyan goals, levels, steps, progress and sign-offs." },
  { key: "jain_way", label: "My Jain Way", core: false, dependsOn: [], description: "Practices, logs, streaks, points, saathi, anumodana, pachchakhan and daily timings." },
  { key: "content", label: "Content & library", core: false, dependsOn: [], description: "Content items, the library, the guide, legal documents and photo albums." },
  { key: "calendar", label: "Calendar", core: false, dependsOn: [], description: "Calendar layers, entries and tithi days." },
  { key: "comms", label: "Communications", core: false, dependsOn: ["people"], description: "Newsletters, messages, templates, the inbox, WhatsApp, alerts and notification topics." },
  { key: "surveys", label: "Surveys & data", core: false, dependsOn: [], description: "Surveys, survey responses and saved segments." },
  { key: "volunteers", label: "Volunteers", core: false, dependsOn: ["people"], description: "Volunteer groups, shifts, assignments, interests and background checks." },
  { key: "accounting", label: "Accounting & QuickBooks", core: false, dependsOn: ["giving"], description: "Accounts, QuickBooks mappings, ledger postings, payouts, month-end close and the sync log." },
  { key: "reports", label: "Reports & dashboard", core: false, dependsOn: [], description: "Center health and the public community dashboard." },
  { key: "niva", label: "Niva assistant", core: false, dependsOn: ["content", "ai"], description: "Niva conversations. Needs iWeaver (0750)." },
  { key: "governance", label: "Governance", core: false, dependsOn: ["people"], description: "Resolutions, votes, concerns and comments." },
  { key: "ai", label: "iWeaver", core: false, dependsOn: [], description: "Every AI feature except AI used in onboarding: Niva for members and staff, and AI flyer art." },
  { key: "website", label: "WeaverSite", core: false, dependsOn: ["people"], description: "The organization's website draft, its pages and the private preview." },
  { key: "channels", label: "Weaver Connect", core: false, dependsOn: ["comms"], description: "WhatsApp Business messages: the account, its templates and sending." },
  { key: "care", label: "DonorDelight", core: false, dependsOn: ["people"], description: "Donor care and member care: a thank-you for every gift, a relationship owner for each household, a short weekly list, and a yearly care plan from the mission." },
  { key: "matching", label: "CatchTheMatch", core: false, dependsOn: ["giving"], description: "Employer and grant matching. Not built yet." },
  { key: "market", label: "Community Market", core: false, dependsOn: ["store"], description: "A second section of the store for the community's own non-food products and services, organized in categories." },
];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export function isModuleKey(v: unknown): v is ModuleKey {
  return typeof v === "string" && BY_KEY.has(v as ModuleKey);
}

export function moduleDef(key: ModuleKey): ModuleDef {
  return BY_KEY.get(key)!;
}

export function moduleLabelFor(key: string | null | undefined): string {
  if (!key) return "Core platform";
  return isModuleKey(key) ? moduleDef(key).label : key;
}

/** Anything carrying the switched-off module keys (a CrmSession, or a test context). */
export type ModuleContext = { modulesOff?: readonly string[] };

/** True unless the module is switched off for the center. Missing data means ON (the contract's default). */
export function isModuleEnabled(ctx: ModuleContext, key: ModuleKey | string): boolean {
  const off = ctx.modulesOff ?? [];
  if (off.length === 0) return true;
  // 0740: a module is off while a module it needs is off (dependencies are evaluated), as the database answers; so Giving's
  // add-ons (0741) are off whenever Giving is, even before my_modules says so for each of them.
  const seen = new Set<string>();
  const on = (k: string): boolean => {
    if (off.includes(k)) return false;
    if (seen.has(k)) return true;
    seen.add(k);
    return (BY_KEY.get(k as ModuleKey)?.dependsOn ?? []).every(on);
  };
  return on(key);
}

// ---------------------------------------------------------------------------
// URL → module. Built from NAV (a module's paths and tab hrefs, with a tab's
// own `module` overriding its NAV module's) plus a few routes that are not tabs.
// Longest prefix wins, so /content/practices is jain_way while /content is content.
// ---------------------------------------------------------------------------
const EXTRA_PATHS: readonly [string, ModuleKey][] = [
  ["/memberships", "membership"],
  ["/events/volunteers", "volunteers"],
  ["/ops", "events"],
  ["/comms/surveys", "surveys"],
  // Giving's add-ons (0741) that are not NAV tabs of their own; the Campaigns list under Opportunities stays core.
  ["/giving/payments/bank", "giving_bank"],
  ["/giving/bank", "giving_bank"],
  // Payment proofs (0865): members send a photo when they paid another way; the treasury team verifies it here.
  ["/giving/proofs", "giving_proofs"],
  ["/giving/opportunities", "giving_opportunities"],
  ["/giving/opportunities/campaigns", "giving"],
  ["/giving/campaigns", "giving"],
  ["/giving/insights", "giving_insights"],
  // WeaverSite (0751): the private preview of the website draft. Setup › Your website itself stays core (reading the current
  // website teaches the organization's agent at onboarding); its draft panel checks the module on its own.
  ["/setup/website/preview", "website"],
  // The Pathshala committee holds governance (resolutions, concerns) and event planning.
  ["/pathshala/committee/resolutions", "governance"],
  ["/pathshala/committee/concerns", "governance"],
  ["/pathshala/committee/actions", "events"],
  ["/pathshala/committee/templates", "events"],
  ["/pathshala/committee/year", "events"],
];

function buildPathMap(): [string, ModuleKey][] {
  const out = new Map<string, ModuleKey>();
  for (const m of NAV) {
    if (m.module) for (const p of [...m.paths, ...m.tabs.map((t) => t.href)]) out.set(p, m.module);
    for (const t of m.tabs) if (t.module) out.set(t.href, t.module);
  }
  for (const [p, k] of EXTRA_PATHS) out.set(p, k);
  return [...out.entries()];
}

export const MODULE_PATHS: readonly [string, ModuleKey][] = buildPathMap();

/** The module that owns a URL, or null for core platform pages (Home, Settings, households, people…). */
export function moduleForPath(pathname: string): ModuleKey | null {
  let best: ModuleKey | null = null;
  let bestLen = -1;
  for (const [p, k] of MODULE_PATHS) {
    if (p !== "/" && pathUnder(pathname, p) && p.length > bestLen) {
      best = k;
      bestLen = p.length;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Dependency rules. Since 0740 the database evaluates them instead of refusing
// a switch: a module is off while a module it needs is off. These helpers say
// so before asking (switchWarning); only a core module and a module Weaver has
// not enabled block a switch (switchBlocker).
// ---------------------------------------------------------------------------
export type ModuleState = { key: string; enabled: boolean; core: boolean; dependsOn: readonly string[] };

/** Is it core, and which enabled modules depend on it (their keys): they go off with it. */
export function blockersToDisable(key: string, states: readonly ModuleState[]): { core: boolean; dependents: string[] } {
  const me = states.find((s) => s.key === key);
  return {
    core: Boolean(me?.core),
    dependents: states.filter((s) => s.enabled && s.key !== key && s.dependsOn.includes(key)).map((s) => s.key),
  };
}

/** Dependencies that are off, so the module stays off until they are on. */
export function missingToEnable(key: string, states: readonly ModuleState[]): string[] {
  const me = states.find((s) => s.key === key);
  if (!me) return [];
  return me.dependsOn.filter((d) => states.find((s) => s.key === d)?.enabled === false);
}

/** The Marketplace products (0750): Weaver turns them on (an administrator requests one); the community pauses and resumes them. */
export const PRODUCT_MODULES: readonly ModuleKey[] = ["ai", "website", "channels", "care", "matching", "market"];

export function isProductModule(key: string): boolean {
  return (PRODUCT_MODULES as readonly string[]).includes(key);
}

/** The contract's wording for a direct URL to a switched-off module (`label`: the organization's kind's own name for it). */
export function moduleOffMessage(key: ModuleKey, centerName: string, label: string = moduleDef(key).label): string {
  if (isProductModule(key)) {
    return `${label} is not on for ${centerName}. It is a Marketplace product: an administrator can request it, or resume it if it is paused, in Settings › Marketplace.`;
  }
  return `The ${label} module is switched off for ${centerName}. An administrator can switch it on in Settings › Modules.`;
}

// ---------------------------------------------------------------------------
// Settings › Modules rows: the database catalog (app.modules) with this
// center's switches (app.center_modules) laid over it. No row = on.
// ---------------------------------------------------------------------------
export type CatalogLike = { key: string; label: string; description: string | null; core: boolean; depends_on: string[] | null; sort: number | null };
export type SwitchLike = { module_key: string; enabled: boolean; changed_by: string | null; changed_at: string | null; reason: string | null };
export type ModuleRow = {
  key: string;
  label: string;
  description: string;
  core: boolean;
  dependsOn: string[];
  /** The organization's kind decides: on unless switched off (default_on), off until switched on (default_off), or never offered (not_available). */
  availability: "default_on" | "default_off" | "not_available";
  /** False for a core module and for one the kind never offers: no switch. */
  switchable: boolean;
  /** On for the community: offered, enabled by Weaver, not paused, and every module it needs on. */
  enabled: boolean;
  changedBy: string | null;
  changedAt: string | null;
  reason: string | null;
  /** Weaver has enabled it for this community (0740; the kind's default_on counts). Always true for a core module. */
  granted: boolean;
  /** The community switched it off itself (its own switch; kept while Weaver's grant changes). */
  paused: boolean;
  /** Modules it needs that are off (keys): it is off until they are on. */
  waitingFor: string[];
  grantedBy: string | null;
  grantedAt: string | null;
  grantReason: string | null;
};

/** With `catalog` null (not in the database yet), the registry above stands in. */
export function buildModuleRows(catalog: readonly CatalogLike[] | null, switches: readonly SwitchLike[]): ModuleRow[] {
  const base: readonly CatalogLike[] =
    catalog ?? MODULES.map((m, i) => ({ key: m.key, label: m.label, description: m.description, core: m.core, depends_on: [...m.dependsOn], sort: i }));
  const byKey = new Map(switches.map((s) => [s.module_key, s]));
  const order = (c: CatalogLike) => c.sort ?? MODULE_KEYS.indexOf(c.key as ModuleKey);
  return [...base]
    .sort((a, b) => order(a) - order(b) || a.key.localeCompare(b.key))
    .map((c) => {
      const s = byKey.get(c.key);
      return {
        key: c.key,
        label: c.label,
        description: c.description ?? (isModuleKey(c.key) ? moduleDef(c.key).description : ""),
        core: c.core,
        dependsOn: c.depends_on ?? [],
        availability: "default_on" as const,
        switchable: !c.core,
        enabled: c.core ? true : (s?.enabled ?? true),
        changedBy: s?.changed_by ?? null,
        changedAt: s?.changed_at ?? null,
        reason: s?.reason ?? null,
        granted: true,
        paused: !c.core && s?.enabled === false,
        waitingFor: [],
        grantedBy: null,
        grantedAt: null,
        grantReason: null,
      };
    });
}

/** One row of app.module_states(center): the catalog, the kind's availability and the organization's own switch. */
export type ModuleStateLike = {
  key: string;
  label: string;
  description: string | null;
  core: boolean;
  depends_on: string[] | null;
  sort: number | null;
  availability: string | null;
  enabled: boolean | null;
  switchable: boolean | null;
  changed_by: string | null;
  changed_at: string | null;
  reason: string | null;
  /** 0740's columns; absent before that database update (then every offered module counts as granted). */
  granted?: boolean | null;
  granted_by?: string | null;
  granted_at?: string | null;
  grant_reason?: string | null;
  paused?: boolean | null;
  waiting_for?: string[] | null;
};

const AVAILABILITY = ["default_on", "default_off", "not_available"] as const;

/**
 * Settings › Modules rows from app.module_states: the kind's own names for the modules, a module the kind starts
 * off marked as such, and the modules the kind never offers listed LAST and locked (no switch).
 */
export function buildModuleRowsFromStates(states: readonly ModuleStateLike[]): ModuleRow[] {
  const rows = [...states]
    .sort((a, b) => (a.sort ?? 1000) - (b.sort ?? 1000) || a.key.localeCompare(b.key))
    .map((m): ModuleRow => {
      const availability = AVAILABILITY.find((a) => a === m.availability) ?? "default_on";
      const locked = availability === "not_available";
      const enabled = m.core ? true : locked ? false : (m.enabled ?? availability !== "default_off");
      return {
        key: m.key,
        label: m.label,
        description: m.description ?? (isModuleKey(m.key) ? moduleDef(m.key).description : ""),
        core: m.core,
        dependsOn: m.depends_on ?? [],
        availability,
        switchable: !m.core && !locked && m.switchable !== false,
        enabled,
        changedBy: m.changed_by ?? null,
        changedAt: m.changed_at ?? null,
        reason: m.reason ?? null,
        granted: m.core || (!locked && m.granted !== false),
        paused: !m.core && !locked && (m.paused ?? !enabled),
        waitingFor: m.waiting_for ?? [],
        grantedBy: m.granted_by ?? null,
        grantedAt: m.granted_at ?? null,
        grantReason: m.grant_reason ?? null,
      };
    });
  return [...rows.filter((r) => r.availability !== "not_available"), ...rows.filter((r) => r.availability === "not_available")];
}

/** The sentence for a module Weaver has not enabled for the community (the database's own words, 0740). */
export function notGrantedSentence(label: string): string {
  return `Weaver has not enabled ${label} for this community.`;
}

/**
 * Plain-English reason a switch cannot be flipped right now, or null when it can: a core module is always on, and a module
 * Weaver has not enabled cannot be switched on (or off: it is off already). Dependencies no longer block (see switchWarning).
 */
export function switchBlocker(key: string, turnOn: boolean, rows: readonly ModuleRow[]): string | null {
  const label = (k: string) => rows.find((r) => r.key === k)?.label ?? moduleLabelFor(k);
  const me = rows.find((r) => r.key === key);
  if (me?.core) return turnOn ? null : `${label(key)} is a core module and is always on.`;
  if (me && me.availability !== "not_available" && !me.granted) {
    return turnOn ? `${notGrantedSentence(label(key))} Ask Weaver to enable it.` : `${notGrantedSentence(label(key))} It is off already.`;
  }
  return null;
}

/** What else a switch does, in plain English, or null: the modules that go off with it, or what it waits for. */
export function switchWarning(key: string, turnOn: boolean, rows: readonly ModuleRow[]): string | null {
  const label = (k: string) => rows.find((r) => r.key === k)?.label ?? moduleLabelFor(k);
  const states = rows.map((r) => ({ key: r.key, enabled: r.enabled, core: r.core, dependsOn: r.dependsOn }));
  // "A", "A and B", "A, B and C" (Giving has nine modules that need it).
  const list = (keys: readonly string[]) => {
    const names = keys.map(label);
    return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  };
  if (turnOn) {
    const me = rows.find((r) => r.key === key);
    const waiting = me && me.waitingFor.length > 0 ? me.waitingFor : missingToEnable(key, states);
    if (waiting.length === 0) return null;
    return `${label(key)} stays off until ${list(waiting)} ${waiting.length === 1 ? "is" : "are"} on.`;
  }
  const { dependents } = blockersToDisable(key, states);
  if (dependents.length === 0) return null;
  const one = dependents.length === 1;
  return `${list(dependents)} ${one ? "goes" : "go"} off with it and ${one ? "comes" : "come"} back when ${label(key)} is switched on again.`;
}

export type ModuleStatus = { key: "always_on" | "on" | "paused" | "not_granted" | "waiting" | "not_offered"; text: string };

/** What Settings › Modules (and Niva) say about a module: On, Paused, Not enabled by Weaver, Off while … is off. */
export function moduleStatus(row: ModuleRow, rows: readonly ModuleRow[]): ModuleStatus {
  const label = (k: string) => rows.find((r) => r.key === k)?.label ?? moduleLabelFor(k);
  if (row.core) return { key: "always_on", text: "Always on" };
  if (row.availability === "not_available") return { key: "not_offered", text: "Not offered" };
  if (!row.granted) return { key: "not_granted", text: "Not enabled by Weaver" };
  if (row.paused) return { key: "paused", text: "Paused" };
  if (!row.enabled && row.waitingFor.length > 0) {
    return { key: "waiting", text: `Off while ${row.waitingFor.map(label).join(" and ")} ${row.waitingFor.length === 1 ? "is" : "are"} off` };
  }
  return row.enabled ? { key: "on", text: "On" } : { key: "paused", text: "Paused" };
}
