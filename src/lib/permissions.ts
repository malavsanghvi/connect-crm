// UI permission gating. This mirrors app.has_permission() so the console can
// hide what the database would refuse anyway. It is convenience only — RLS in
// the database is the enforcement.

import type { Json } from "@/lib/database.types";
import type { ModuleKey } from "@/lib/modules";

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
export type ScopedContext = PermissionContext & {
  grants?: readonly ScopedGrant[];
  /** Module keys switched off for the center (src/lib/modules.ts); missing means every module is on. */
  modulesOff?: readonly string[];
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
  /** Receipt templates (app.receipt_templates write policy). */
  receiptTemplates: ["giving.manage"],
  /** Labh fulfillment (labh_options + labh pledges). */
  labh: ["giving.view", "giving.manage"],
  labhManage: ["giving.manage"],
  /** Bhandar counting sessions (counting_sessions: read giving.view, write giving.record_offline). */
  counting: ["giving.view", "giving.record_offline"],
  countingRecord: ["giving.record_offline"],
  /** Month-end close (accounting_periods: read giving.view, write accounting.close). */
  close: ["giving.view", "accounting.close"],
  closeManage: ["accounting.close"],
  qboConnection: ["integrations.view", "integrations.manage"],
  qboLedger: ["giving.view", "accounting.manage"],
  qboManage: ["accounting.manage"],
  qbo: ["integrations.view", "integrations.manage", "giving.view", "accounting.manage"],
  audit: ["audit.view"],
  reports: ["reports.view", "people.view", "giving.view"],
  /** Public community dashboard settings (public_kpi_settings: read reports.view, write settings.manage). */
  publicKpis: ["reports.view", "settings.manage"],
  publicKpisManage: ["settings.manage"],
  roles: ["roles.manage"],
  centerSettings: ["settings.manage"],
  /** Setup checklist, Step 0 screens and go-live readiness (settings.manage; the owner too, in the database). */
  setup: ["settings.manage"],
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
  // Content (0010 content_items / photos / gyan_* / practices / guide_sections / daily_timings / niva_*).
  // The prototype's content.edit maps to content.draft + content.manage; content.approve publishes.
  content: ["content.view", "content.draft", "content.manage", "content.approve"],
  contentDraft: ["content.draft", "content.manage"],
  contentManage: ["content.manage"],
  contentApprove: ["content.approve"],
  // Communications (0010 comms_campaigns / whatsapp_* / surveys / alerts / threads).
  // The prototype's comms.compose maps to comms.send.
  comms: ["comms.view", "comms.send"],
  commsSend: ["comms.send"],
  commsApprove: ["comms.approve"],
  commsInbox: ["comms.inbox"],
  /** Settings › Data import: whoever may write one of the importable data types (each run checks its own). */
  dataImport: [
    "people.manage",
    "giving.manage",
    "settings.manage",
    "accounting.manage",
    "store.manage",
    "events.manage",
    "pathshala.manage",
    "content.manage",
    "volunteers.manage",
    "safety.manage",
    "comms.send",
    "bolis.manage",
  ],
  /** Settings › Data quality (app.data_quality). */
  dataQuality: ["people.view", "people.manage"],
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
  /** Module (src/lib/modules.ts) this tab belongs to, when it differs from its NAV module's. */
  module?: ModuleKey;
};
export type NavModule = {
  key: string;
  label: string;
  tabs: NavTab[];
  /** URL prefixes that belong to this module (detail pages included). */
  paths: string[];
  /** Module (src/lib/modules.ts) that owns it; hidden when that module is switched off. Omit for core areas. */
  module?: ModuleKey;
  /** Open the module on this tab instead of the first visible one when `when` holds (e.g. a teacher's landing). */
  landing?: { href: string; when: (ctx: ScopedContext) => boolean };
};

export const NAV: NavModule[] = [
  { key: "home", label: "Home", tabs: [{ href: "/", label: "Home", access: "dashboard" }], paths: ["/"] },
  {
    key: "people",
    module: "people",
    label: "People",
    tabs: [
      { href: "/households", label: "Households", access: "households" },
      { href: "/people", label: "People", access: "households" },
      { href: "/memberships/applications", label: "Membership applications", access: "applications", module: "membership" },
      { href: "/people/directory", label: "Directory & expertise", access: "households" },
      { href: "/people/voting", label: "Voting eligibility", access: "voting", module: "membership" },
    ],
    paths: ["/households", "/people", "/memberships", "/identifiers"],
  },
  {
    key: "events",
    module: "events",
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
    module: "giving",
    label: "Giving",
    tabs: [
      { href: "/giving/pledges", label: "Pledges", access: "pledges" },
      { href: "/giving/payments", label: "Payments & deposits", access: "payments" },
      { href: "/giving/opportunities", label: "Opportunities", access: "campaigns" },
      { href: "/giving/recurring", label: "Recurring", access: "recurring" },
      { href: "/giving/labh", label: "Labh fulfillment", access: "labh" },
      { href: "/giving/statements", label: "Receipts & statements", access: "statements" },
    ],
    paths: ["/giving"],
  },
  {
    key: "bolis",
    module: "bolis",
    label: "Bolis",
    tabs: [
      { href: "/bolis", label: "Digital bolis", access: "bolis" },
      { href: "/bolis/upload", label: "In-person upload", access: "bolis" },
    ],
    paths: ["/bolis"],
  },
  {
    key: "store",
    module: "store",
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
    module: "pathshala",
    label: "Pathshala",
    tabs: [
      { href: "/pathshala", label: "Classes", access: "pathshala" },
      { href: "/pathshala/signoffs", label: "Gyan Path sign-offs", access: "pathshalaSignoffs", roles: ["teacher"], module: "gyan_path" },
      { href: "/pathshala/terms", label: "Terms", access: "pathshala" },
      { href: "/pathshala/enrollments", label: "Enrollments", access: "pathshala" },
      { href: "/pathshala/teachers", label: "Teacher positions", access: "pathshala" },
      { href: "/pathshala/committee", label: "Committee", access: "pathshalaCommittee" },
      { href: "/pathshala/my-classes", label: "My classes", roles: ["teacher"] },
    ],
    paths: ["/pathshala"],
    // A teacher without the principal's view lands on their own classes.
    landing: { href: "/pathshala/my-classes", when: (ctx) => !canAccess(ctx, "pathshala") && hasRole(ctx, "teacher") },
  },
  {
    key: "content",
    module: "content",
    label: "Content",
    tabs: [
      { href: "/content/queue", label: "Approval queue", access: "content" },
      { href: "/content/today", label: "Today & darshan", access: "content" },
      { href: "/content/practices", label: "Practices & points", access: "content", module: "jain_way" },
      { href: "/content/gyan-path", label: "Gyan Path", access: "content", module: "gyan_path" },
      { href: "/content/library", label: "Library", access: "content" },
      { href: "/content/photos", label: "Photo albums", access: "content" },
      { href: "/content/niva", label: "Niva", access: "content", module: "niva" },
      { href: "/content/guide", label: "Guide & directory", access: "content" },
      { href: "/content/legal", label: "Legal & waivers", access: "content" },
    ],
    paths: ["/content"],
  },
  {
    key: "calendar",
    module: "calendar",
    label: "Calendar",
    tabs: [{ href: "/calendar", label: "Layers", access: "calendar" }],
    paths: ["/calendar"],
  },
  {
    key: "comms",
    module: "comms",
    label: "Communications",
    tabs: [
      { href: "/comms/newsletters", label: "Newsletters", access: "comms" },
      { href: "/comms/inbox", label: "Inbox", access: "commsInbox" },
      { href: "/comms/whatsapp", label: "WhatsApp queue", access: "comms" },
      { href: "/comms/surveys", label: "Surveys", access: "comms", module: "surveys" },
      { href: "/comms/alerts", label: "Alerts", access: "comms" },
    ],
    paths: ["/comms"],
  },
  {
    key: "accounting",
    module: "accounting",
    label: "Accounting",
    tabs: [
      { href: "/accounting/qbo", label: "QuickBooks sync", access: "qbo" },
      { href: "/accounting/close", label: "Month-end close", access: "close" },
    ],
    paths: ["/accounting"],
  },
  {
    key: "reports",
    module: "reports",
    label: "Reports",
    tabs: [
      { href: "/reports", label: "Center health", access: "reports" },
      { href: "/reports/community", label: "Community dashboard", access: "publicKpis" },
    ],
    paths: ["/reports"],
  },
  {
    // Onboarding (ONBOARDING_PLAN §4): the organization's own Setup checklist.
    key: "setup",
    label: "Setup",
    tabs: [
      { href: "/setup", label: "Checklist", access: "setup" },
      { href: "/setup/organization", label: "Legal identity", access: "setup" },
      { href: "/setup/profile", label: "Profile & brand", access: "setup" },
      { href: "/setup/leaders", label: "Leaders", access: "setup" },
      { href: "/setup/readiness", label: "Go-live readiness", access: "setup" },
    ],
    paths: ["/setup"],
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
      // Not in the prototype: org-level module switches (WAVE2), after the prototype's eight.
      { href: "/settings/modules", label: "Modules", access: "centerSettings" },
      // Not in the prototype (onboarding, o-security): staff invitations, 2FA and the owner; the organization's agreements.
      { href: "/settings/team", label: "Team", access: "roles" },
      { href: "/settings/agreements", label: "Agreements", access: "centerSettings" },
      // Onboarding (o-tenancy): the member-app join code, and the sandbox / plan limits.
      { href: "/settings/member-app", label: "Member app", access: "centerSettings" },
      { href: "/settings/limits", label: "Limits", access: "centerSettings" },
      // Onboarding (o-import): loading the organization's data, its custom fields and their quality.
      { href: "/settings/import", label: "Data import", access: "dataImport" },
      { href: "/settings/custom-fields", label: "Custom fields", access: "centerSettings" },
      { href: "/settings/data-quality", label: "Data quality", access: "dataQuality" },
    ],
    paths: ["/settings", "/privacy", "/audit", "/approvals"],
  },
  {
    key: "platform",
    label: "Platform",
    tabs: [
      { href: "/platform", label: "Centers", access: "dashboard", platformOnly: true },
      { href: "/platform/new", label: "New center wizard", access: "dashboard", platformOnly: true },
      { href: "/platform/verification", label: "Verification", access: "dashboard", platformOnly: true },
    ],
    paths: ["/platform"],
  },
];

export type VisibleTab = { href: string; label: string };
export type VisibleModule = { key: string; label: string; href: string; tabs: VisibleTab[]; paths: string[] };

/** False only when the center switched the module off (same rule as isModuleEnabled in src/lib/modules.ts). */
function moduleOn(ctx: ScopedContext, key: string): boolean {
  return !(ctx.modulesOff ?? []).includes(key);
}

/** True when the user may open a nav tab: its access key, or one of its roles in any scope. */
export function canOpenTab(ctx: ScopedContext, tab: Pick<NavTab, "access" | "roles" | "platformOnly" | "module">): boolean {
  if (tab.module && !moduleOn(ctx, tab.module)) return false;
  if (tab.platformOnly) return Boolean(ctx.isPlatformAdmin);
  if (tab.access !== undefined && canAccess(ctx, tab.access)) return true;
  return Boolean(tab.roles && tab.roles.length > 0 && hasRole(ctx, ...tab.roles));
}

/** Modules the user can open, each with only the tabs they can open; a module opens on its first visible tab (or its landing tab). */
export function visibleNav(ctx: ScopedContext): VisibleModule[] {
  return NAV.flatMap((m) => {
    if (m.module && !moduleOn(ctx, m.module)) return [];
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
