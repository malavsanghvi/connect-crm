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

/** An active role grant with its scope (one class, event or zone — or the whole center). */
export type ScopedGrant = { role_key: string; scope_kind: string; scope_id: string | null };

/** Permissions plus the active grants, for the scoped-role checks below. */
export type ScopedContext = PermissionContext & { grants?: readonly ScopedGrant[] };

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

// ---------------------------------------------------------------------------
// Scoped roles — mirrors app.has_scoped_role(center, scope_id, roles…): the
// role granted center-wide, or granted for that one class/event/zone. Scoped
// grants never add center-wide permissions (see computePermissions); these
// helpers are how a class teacher or an event lead reaches their own records.
// ---------------------------------------------------------------------------

/** Holds one of the roles center-wide, or scoped to `scopeId` (platform admins hold all). */
export function hasScopedRole(ctx: ScopedContext, scopeId: string, ...roles: string[]): boolean {
  if (ctx.isPlatformAdmin) return true;
  return (ctx.grants ?? []).some((g) => roles.includes(g.role_key) && (g.scope_kind === "center" || g.scope_id === scopeId));
}

/** Holds one of the roles anywhere (any scope). */
export function hasRole(ctx: ScopedContext, ...roles: string[]): boolean {
  if (ctx.isPlatformAdmin) return true;
  return (ctx.grants ?? []).some((g) => roles.includes(g.role_key));
}

/** Holds one of the roles center-wide, so it applies to every class, event or zone. */
export function hasCenterRole(ctx: ScopedContext, ...roles: string[]): boolean {
  if (ctx.isPlatformAdmin) return true;
  return (ctx.grants ?? []).some((g) => roles.includes(g.role_key) && g.scope_kind === "center");
}

/** Scope ids (class, event or zone ids) for which the user holds one of the roles through a scoped grant. */
export function scopeIdsForRole(ctx: ScopedContext, ...roles: string[]): string[] {
  const ids = new Set<string>();
  for (const g of ctx.grants ?? []) {
    if (roles.includes(g.role_key) && g.scope_id && g.scope_kind !== "center") ids.add(g.scope_id);
  }
  return [...ids];
}

/** Classes the user teaches through a class-scoped Teacher grant. */
export const teacherClassIds = (ctx: ScopedContext) => scopeIdsForRole(ctx, "teacher");

/**
 * What each area needs, taken from the RLS policies (0010_rls.sql, 0012).
 * "anyOf" semantics: holding one of them is enough.
 */
export const ACCESS = {
  dashboard: [] as string[],
  households: ["people.view", "people.manage"],
  householdsEdit: ["people.manage"],
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
  /** Settings › Integrations (reads app.integration_connections). */
  integrations: ["integrations.view", "integrations.manage"],
  /** Settings › Security: readable by rules or roles managers; saving writes centers.rules (settings.manage). */
  security: ["settings.manage", "roles.manage"],
  privacy: ["privacy.manage"],
  identifierSearch: ["people.view", "giving.view", "giving.record_offline"],
  // Pathshala (moved from connect-admin; same checks as its access.ts). Class
  // teachers reach their own classes through a scoped Teacher grant instead —
  // see pathshalaAreas in src/lib/pathshala/access.ts.
  pathshala: ["pathshala.view", "pathshala.manage"],
  pathshalaManage: ["pathshala.manage"],
  pathshalaSignoffs: ["pathshala.teach", "pathshala.manage"],
  pathshalaCommittee: ["events.view", "events.manage", "governance.view", "pathshala.view", "pathshala.manage"],
  // Events (0010: events/rsvps/attendees/lunch_slots/scan_log staff policies).
  events: ["events.view", "events.manage"],
  eventsManage: ["events.manage"],
  /** Event feedback surveys are app.surveys rows: read with comms.view/send, written with comms.send. */
  eventFeedbackRead: ["comms.view", "comms.send"],
  eventFeedbackSend: ["comms.send"],
  /** Volunteer groups, sign-ups and background checks (volunteer_* and background_checks policies). */
  volunteers: ["volunteers.view", "volunteers.manage", "safety.view", "safety.manage"],
  bolis: ["bolis.view", "bolis.manage"],
  bolisManage: ["bolis.manage"],
  /** Record in-person pledges one by one (boli_entries_recorder policy). */
  bolisRecord: ["bolis.manage", "bolis.record"],
  /** Draft messages to families (comms_campaigns staff policy). */
  commsDraft: ["comms.send"],
  store: ["store.view", "store.manage"],
  storeManage: ["store.manage"],
  storeOrders: ["store.view", "store.manage", "store.pickup"],
  /** Move orders along (store_orders_pickup_update / staff write). */
  storePickup: ["store.manage", "store.pickup"],
  /** Calendar layers are content (0010 calendar_layers_manage needs content.manage). */
  calendar: ["content.manage", "content.draft", "settings.manage"],
  calendarManage: ["content.manage"],
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
export type NavTab = {
  href: string;
  label: string;
  /** Center-wide permissions that open the tab (omit when only `roles` open it). */
  access?: AccessKey;
  /** Also open to holders of these roles in any scope (e.g. a class-scoped Teacher). */
  roles?: readonly string[];
  /** Shown only to platform admins (session.isPlatformAdmin), whatever the access key says. */
  platformOnly?: boolean;
};
export type NavModule = {
  key: string;
  label: string;
  tabs: NavTab[];
  /** URL prefixes that belong to this module (detail pages included). */
  paths: string[];
  /** Open the module on this tab instead of the first visible one when `when` holds (e.g. a teacher's landing). */
  landing?: { href: string; when: (ctx: ScopedContext) => boolean };
};

export const NAV: NavModule[] = [
  { key: "home", label: "Home", tabs: [{ href: "/", label: "Home", access: "dashboard" }], paths: ["/"] },
  {
    key: "people",
    label: "People",
    tabs: [
      { href: "/households", label: "Households", access: "households" },
      { href: "/memberships/applications", label: "Membership applications", access: "applications" },
    ],
    paths: ["/households", "/people", "/memberships", "/identifiers"],
  },
  {
    key: "events",
    label: "Events",
    tabs: [
      { href: "/events", label: "All events", access: "events" },
      { href: "/events/builder", label: "Event builder", access: "events" },
      { href: "/events/live", label: "Live check-in", access: "events" },
      { href: "/events/feedback", label: "Feedback", access: "events" },
    ],
    paths: ["/events"],
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
    key: "bolis",
    label: "Bolis",
    tabs: [
      { href: "/bolis", label: "Digital bolis", access: "bolis" },
      { href: "/bolis/upload", label: "In-person upload", access: "bolis" },
    ],
    paths: ["/bolis"],
  },
  {
    key: "store",
    label: "Satvik Store",
    tabs: [
      { href: "/store", label: "Inventory", access: "store" },
      { href: "/store/menu", label: "Menu & pickup", access: "store" },
      { href: "/store/orders", label: "Orders by pickup", access: "storeOrders" },
    ],
    paths: ["/store"],
  },
  {
    key: "pathshala",
    label: "Pathshala",
    tabs: [
      { href: "/pathshala", label: "Classes", access: "pathshala" },
      { href: "/pathshala/signoffs", label: "Gyan Path sign-offs", access: "pathshalaSignoffs", roles: ["teacher"] },
      { href: "/pathshala/terms", label: "Terms", access: "pathshala" },
      { href: "/pathshala/enrollments", label: "Enrollments", access: "pathshala" },
      { href: "/pathshala/committee", label: "Committee", access: "pathshalaCommittee" },
      { href: "/pathshala/my-classes", label: "My classes", roles: ["teacher"] },
    ],
    paths: ["/pathshala"],
    // A teacher without the principal's view lands on their own classes.
    landing: { href: "/pathshala/my-classes", when: (ctx) => !canAccess(ctx, "pathshala") && hasRole(ctx, "teacher") },
  },
  {
    key: "calendar",
    label: "Calendar",
    tabs: [{ href: "/calendar", label: "Layers", access: "calendar" }],
    paths: ["/calendar"],
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
      { href: "/settings/rules", label: "Rules", access: "centerSettings" },
      { href: "/settings/roles", label: "Roles & entitlements", access: "roles" },
      { href: "/settings/integrations", label: "Integrations", access: "integrations" },
      { href: "/settings/privacy", label: "Privacy", access: "privacy" },
      { href: "/settings/onboarding", label: "Onboarding fields", access: "centerSettings" },
      { href: "/settings/notifications", label: "Notifications", access: "centerSettings" },
      { href: "/settings/security", label: "Security", access: "security" },
      { href: "/settings/audit", label: "Audit log", access: "audit" },
    ],
    paths: ["/settings", "/privacy", "/audit", "/approvals"],
  },
  {
    key: "platform",
    label: "Platform",
    tabs: [
      { href: "/platform", label: "Centers", access: "dashboard", platformOnly: true },
      { href: "/platform/new", label: "New center wizard", access: "dashboard", platformOnly: true },
    ],
    paths: ["/platform"],
  },
];

export type VisibleTab = { href: string; label: string };
export type VisibleModule = { key: string; label: string; href: string; tabs: VisibleTab[]; paths: string[] };

/** True when the user may open a nav tab: its access key, or one of its roles in any scope. */
export function canOpenTab(ctx: ScopedContext, tab: Pick<NavTab, "access" | "roles" | "platformOnly">): boolean {
  if (tab.platformOnly) return Boolean(ctx.isPlatformAdmin);
  if (tab.access !== undefined && canAccess(ctx, tab.access)) return true;
  return Boolean(tab.roles && tab.roles.length > 0 && hasRole(ctx, ...tab.roles));
}

/** Modules the user can open, each with only the tabs they can open; a module opens on its first visible tab (or its landing tab). */
export function visibleNav(ctx: ScopedContext): VisibleModule[] {
  return NAV.flatMap((m) => {
    const tabs = m.tabs.filter((t) => canOpenTab(ctx, t)).map(({ href, label }) => ({ href, label }));
    if (tabs.length === 0) return [];
    const landing = m.landing && m.landing.when(ctx) && tabs.some((t) => t.href === m.landing?.href) ? m.landing.href : tabs[0].href;
    return [{ key: m.key, label: m.label, href: landing, tabs, paths: m.paths }];
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
