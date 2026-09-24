// UI permission gating. This mirrors app.has_permission() so the console can
// hide what the database would refuse anyway. It is convenience only — RLS in
// the database is the enforcement.

import type { Json } from "@/lib/database.types";

export type GrantLike = {
  role_key: string;
  scope_kind: string;
  starts_at: string;
  ends_at: string | null;
};

export type RoleLike = { key: string; permissions: Json };

export type PermissionContext = {
  permissions: readonly string[];
  isPlatformAdmin: boolean;
};

export function isGrantActive(grant: Pick<GrantLike, "starts_at" | "ends_at">, now: Date = new Date()): boolean {
  const t = now.getTime();
  return new Date(grant.starts_at).getTime() <= t && (grant.ends_at === null || new Date(grant.ends_at).getTime() > t);
}

function permissionList(p: Json): string[] {
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Effective permission strings for a user in a center. Like the database,
 * only active grants scoped to the whole center (or platform) count; scoped
 * grants (one event, class or zone) never confer center-wide permissions.
 * Note: the database checks `permissions ? 'x'`, which does not expand "*",
 * so neither does this.
 */
export function computePermissions(grants: GrantLike[], roles: RoleLike[], now: Date = new Date()): string[] {
  const byKey = new Map(roles.map((r) => [r.key, permissionList(r.permissions)]));
  const out = new Set<string>();
  for (const g of grants) {
    if (g.scope_kind !== "center" && g.scope_kind !== "platform") continue;
    if (!isGrantActive(g, now)) continue;
    for (const p of byKey.get(g.role_key) ?? []) out.add(p);
  }
  return [...out].sort();
}

/** True when the user holds ANY of the listed permissions (platform admins hold all). */
export function can(ctx: PermissionContext, anyOf: string | readonly string[]): boolean {
  if (ctx.isPlatformAdmin) return true;
  const list = typeof anyOf === "string" ? [anyOf] : anyOf;
  return list.some((p) => ctx.permissions.includes(p));
}

/**
 * What each area needs, taken from the RLS policies (0010_rls.sql, 0012).
 * "anyOf" semantics: holding one of them is enough.
 */
export const ACCESS = {
  dashboard: [] as string[],
  households: ["people.view", "people.manage"],
  householdsEdit: ["people.manage"],
  /** People module: voting eligibility list (read) and the directory listings. */
  voting: ["people.view", "people.approve"],
  memberships: ["people.view", "people.manage"],
  applications: ["people.view", "people.approve"],
  applicationsDecide: ["people.approve"],
  pledges: ["giving.view", "giving.manage", "giving.record_offline"],
  payments: ["giving.view", "giving.manage", "giving.record_offline"],
  paymentsAll: ["giving.view", "giving.manage"],
  recordPayment: ["giving.record_offline", "giving.manage"],
  allocatePayment: ["giving.manage"],
  bank: ["giving.view", "giving.record_offline"],
  bankImport: ["giving.manage", "giving.record_offline"],
  bankConfirm: ["giving.record_offline", "giving.manage"],
  bankIgnore: ["giving.manage"],
  /** Request / complete a write-off or refund (first person). */
  givingManage: ["giving.manage"],
  /** Second approver for refunds and write-offs (app.approve_as_second). */
  givingApprove: ["giving.approve"],
  /** Second approver for voting-eligibility overrides. */
  peopleApprove: ["people.approve"],
  approvals: ["giving.manage", "giving.approve", "people.approve"],
  campaigns: ["giving.view", "giving.manage"],
  campaignsManage: ["giving.manage"],
  recurring: ["giving.view", "giving.manage"],
  statements: ["giving.view", "giving.manage"],
  qboConnection: ["integrations.view", "integrations.manage"],
  qboLedger: ["giving.view", "accounting.manage"],
  qboManage: ["accounting.manage"],
  qbo: ["integrations.view", "integrations.manage", "giving.view", "accounting.manage"],
  audit: ["audit.view"],
  reports: ["reports.view", "people.view", "giving.view"],
  roles: ["roles.manage"],
  centerSettings: ["settings.manage"],
  privacy: ["privacy.manage"],
  identifierSearch: ["people.view", "giving.view", "giving.record_offline"],
} as const satisfies Record<string, readonly string[]>;

export type AccessKey = keyof typeof ACCESS;

export function canAccess(ctx: PermissionContext, key: AccessKey): boolean {
  const need = ACCESS[key];
  return need.length === 0 || can(ctx, need);
}

// ---------------------------------------------------------------------------
// Identifier kinds (app.identifier_kind) — who may see and change which kind.
// ---------------------------------------------------------------------------
export const IDENTIFIER_KINDS = [
  "org_member",
  "org_household",
  "crm",
  "accounting",
  "bank_payer",
  "payment_provider",
  "other",
] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

const PEOPLE_KINDS: readonly IdentifierKind[] = ["org_member", "org_household", "crm", "other"];
const FINANCE_KINDS: readonly IdentifierKind[] = ["accounting", "bank_payer", "payment_provider"];

/** Mirrors external_ids_*_write policies: people.manage for org person/household ids, crm, other; giving.manage for finance kinds. */
export function canManageIdentifierKind(ctx: PermissionContext, kind: IdentifierKind): boolean {
  if (PEOPLE_KINDS.includes(kind)) return can(ctx, "people.manage");
  if (FINANCE_KINDS.includes(kind)) return can(ctx, "giving.manage");
  return false;
}

/** Mirrors external_ids_*_read policies: finance readers see every kind; people readers see org ids, crm, other. */
export function canViewIdentifierKind(ctx: PermissionContext, kind: IdentifierKind): boolean {
  if (can(ctx, ["giving.view", "giving.record_offline"])) return true;
  if (PEOPLE_KINDS.includes(kind)) return can(ctx, ["people.view", "people.manage"]);
  return false;
}

export function manageableIdentifierKinds(ctx: PermissionContext): IdentifierKind[] {
  return IDENTIFIER_KINDS.filter((k) => canManageIdentifierKind(ctx, k));
}

// ---------------------------------------------------------------------------
// Navigation — one flat list of modules in the prototype's order
// (AdminPortal.dc.html NAV: Home, People, Events, Giving, Bolis, Satvik Store,
// Pathshala, Content, Calendar, Communications, Accounting, Reports, Settings,
// Platform). Only modules that exist in this app are listed; the rest arrive
// as they move in from connect-admin. Each module's pages are its tabs.
// Gating is unchanged: every tab uses the same ACCESS key as before.
// ---------------------------------------------------------------------------
export type NavTab = { href: string; label: string; access: AccessKey };
export type NavModule = {
  key: string;
  label: string;
  tabs: NavTab[];
  /** URL prefixes that belong to this module (detail pages included). */
  paths: string[];
};

export const NAV: NavModule[] = [
  { key: "home", label: "Home", tabs: [{ href: "/", label: "Home", access: "dashboard" }], paths: ["/"] },
  {
    key: "people",
    label: "People",
    tabs: [
      { href: "/households", label: "Households", access: "households" },
      { href: "/people", label: "People", access: "households" },
      { href: "/memberships/applications", label: "Membership applications", access: "applications" },
      { href: "/people/directory", label: "Directory & expertise", access: "households" },
      { href: "/people/voting", label: "Voting eligibility", access: "voting" },
    ],
    paths: ["/households", "/people", "/memberships", "/identifiers"],
  },
  {
    key: "giving",
    label: "Giving",
    tabs: [
      { href: "/giving/pledges", label: "Pledges", access: "pledges" },
      { href: "/giving/payments", label: "Payments", access: "payments" },
      { href: "/giving/bank", label: "Bank reconciliation", access: "bank" },
      { href: "/giving/campaigns", label: "Campaigns", access: "campaigns" },
      { href: "/giving/recurring", label: "Recurring gifts", access: "recurring" },
      { href: "/giving/statements", label: "Statements", access: "statements" },
    ],
    paths: ["/giving"],
  },
  {
    key: "accounting",
    label: "Accounting",
    tabs: [{ href: "/accounting/qbo", label: "QuickBooks", access: "qbo" }],
    paths: ["/accounting"],
  },
  {
    key: "reports",
    label: "Reports",
    tabs: [{ href: "/reports", label: "Reports", access: "reports" }],
    paths: ["/reports"],
  },
  {
    key: "settings",
    label: "Settings",
    tabs: [
      { href: "/settings/center", label: "Center settings", access: "centerSettings" },
      { href: "/settings/roles", label: "Roles and access", access: "roles" },
      { href: "/privacy/requests", label: "Privacy requests", access: "privacy" },
      { href: "/audit", label: "Audit log", access: "audit" },
    ],
    paths: ["/settings", "/privacy", "/audit", "/approvals"],
  },
];

export type VisibleTab = { href: string; label: string };
export type VisibleModule = { key: string; label: string; href: string; tabs: VisibleTab[]; paths: string[] };

/** Modules the user can open, each with only the tabs they can open; a module opens on its first visible tab. */
export function visibleNav(ctx: PermissionContext): VisibleModule[] {
  return NAV.flatMap((m) => {
    const tabs = m.tabs.filter((t) => canAccess(ctx, t.access)).map(({ href, label }) => ({ href, label }));
    return tabs.length > 0 ? [{ key: m.key, label: m.label, href: tabs[0].href, tabs, paths: m.paths }] : [];
  });
}

/** True when `pathname` is `prefix` or below it ("/" matches only itself). */
export function pathUnder(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The module that owns a URL (longest matching prefix wins). */
export function activeModule<M extends { paths: string[]; tabs: { href: string }[] }>(modules: M[], pathname: string): M | undefined {
  let best: M | undefined;
  let bestLen = -1;
  for (const m of modules) {
    for (const p of [...m.paths, ...m.tabs.map((t) => t.href)]) {
      if (pathUnder(pathname, p) && p.length > bestLen) {
        best = m;
        bestLen = p.length;
      }
    }
  }
  return best;
}

/** The tab of a module that a URL is on (longest matching href), if any. */
export function activeTabHref(tabs: { href: string }[], pathname: string): string | undefined {
  return tabs.filter((t) => pathUnder(pathname, t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
