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
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** The contract's table, in its order. The database catalog (app.modules) wins when it is available. */
export const MODULES: readonly ModuleDef[] = [
  { key: "people", label: "Members & families", core: true, dependsOn: [], description: "Households, people, the directory, zones, change requests and merges." },
  { key: "membership", label: "Membership", core: false, dependsOn: ["people"], description: "Membership types, memberships, applications, new-member onboarding and voting eligibility." },
  { key: "events", label: "Events & RSVP", core: false, dependsOn: ["people"], description: "Events, templates, RSVPs, tickets, check-in, lunch slots, event volunteers and feedback." },
  { key: "giving", label: "Pledges & donations", core: false, dependsOn: ["people"], description: "Funds, campaigns, opportunities, pledges, payments, recurring gifts, labh, receipts, statements, bank and bhandar counting." },
  { key: "bolis", label: "Bolis", core: false, dependsOn: ["giving"], description: "Bolis, boli pledges and the in-person upload." },
  { key: "store", label: "Satvik Store", core: false, dependsOn: ["people"], description: "Store items, inventory, orders and pickup windows." },
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
  { key: "niva", label: "Niva assistant", core: false, dependsOn: ["content"], description: "Niva conversations." },
  { key: "governance", label: "Governance", core: false, dependsOn: ["people"], description: "Resolutions, votes, concerns and comments." },
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
  return !(ctx.modulesOff ?? []).includes(key);
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
// Dependency rules (mirrors app.set_module_enabled so the Settings screen can
// explain before asking; the database still decides).
// ---------------------------------------------------------------------------
export type ModuleState = { key: string; enabled: boolean; core: boolean; dependsOn: readonly string[] };

/** Why a module cannot be switched off right now: it is core, or enabled modules depend on it (their keys). */
export function blockersToDisable(key: string, states: readonly ModuleState[]): { core: boolean; dependents: string[] } {
  const me = states.find((s) => s.key === key);
  return {
    core: Boolean(me?.core),
    dependents: states.filter((s) => s.enabled && s.key !== key && s.dependsOn.includes(key)).map((s) => s.key),
  };
}

/** Dependencies that are switched off, so the module cannot be switched on yet. */
export function missingToEnable(key: string, states: readonly ModuleState[]): string[] {
  const me = states.find((s) => s.key === key);
  if (!me) return [];
  return me.dependsOn.filter((d) => states.find((s) => s.key === d)?.enabled === false);
}
