// Plain-English catalogue of the app's permission strings, grouped as the
// prototype's entitlement grid (AdminPortal ents(): People, Events, Giving,
// Bolis, Store, Pathshala, Content, Communications, Accounting, Reports,
// Settings, Platform). Keys are the permissions the database checks
// (app.has_permission). Entitlements the prototype shows that the app does
// not have yet are listed as `planned` so admins can see the gap; no role
// can hold them until the owner adds them (docs/parity p1 §F).

import type { Json } from "@/lib/database.types";
import { kindName, moduleNotOffered } from "@/lib/kind";
import type { KindLike } from "@/lib/wording";

export type Entitlement = { key: string; label: string; planned?: boolean };
export type EntitlementGroup = {
  name: string;
  items: Entitlement[];
  /** The organization's own data (0757): who can see it, said next to the group. */
  note?: string;
};

/** What every group of the organization's own data says (WeCare, CatchTheMatch: migration 0757). */
export const PRIVATE_GROUP_NOTE =
  "Your organization's own data. Only the owner and the people you give one of these roles can see it. Weaver's team cannot. The owner or this product's manager gives the roles.";

export const ENTITLEMENT_GROUPS: EntitlementGroup[] = [
  {
    name: "People",
    items: [
      { key: "people.view", label: "View households and people" },
      { key: "people.manage", label: "Edit households and people" },
      { key: "people.approve", label: "Approve memberships and voting overrides" },
      { key: "people.children", label: "View children's details", planned: true },
      { key: "people.merge", label: "Merge duplicates", planned: true },
    ],
  },
  {
    name: "Events",
    items: [
      { key: "events.view", label: "View events" },
      { key: "events.manage", label: "Create and run events" },
      { key: "events.confidential", label: "See confidential event details" },
    ],
  },
  {
    name: "Giving",
    items: [
      { key: "giving.view", label: "View pledges and payments" },
      { key: "giving.amounts", label: "See donor amounts and balances", planned: true },
      { key: "giving.record_offline", label: "Record offline payments and match deposits" },
      { key: "giving.manage", label: "Request refunds and write-offs; campaigns and statements" },
      { key: "giving.approve", label: "Approve refunds and write-offs (second approver)" },
    ],
  },
  {
    name: "Bolis",
    items: [
      { key: "bolis.view", label: "View bolis" },
      { key: "bolis.manage", label: "Create and manage bolis" },
      { key: "bolis.record", label: "Record in-person boli results" },
    ],
  },
  {
    name: "Store",
    items: [
      { key: "store.view", label: "View the store" },
      { key: "store.manage", label: "Menu, pickup windows and orders" },
      { key: "store.pickup", label: "Mark orders picked up" },
      { key: "kitchen.view", label: "Kitchen headcounts and prep lists" },
    ],
  },
  {
    name: "Pathshala",
    items: [
      { key: "pathshala.view", label: "View Pathshala" },
      { key: "pathshala.manage", label: "Classes, teachers, levels" },
      { key: "pathshala.teach", label: "Attendance and sign-offs for own classes" },
    ],
  },
  {
    name: "Content",
    items: [
      { key: "content.view", label: "View content" },
      { key: "content.draft", label: "Draft content" },
      { key: "content.manage", label: "Edit and schedule content" },
      { key: "content.approve", label: "Approve and publish content" },
    ],
  },
  {
    name: "Communications",
    items: [
      { key: "comms.view", label: "View messages and campaigns" },
      { key: "comms.send", label: "Compose newsletters; manage templates" },
      { key: "comms.approve", label: "Approve all-member sends" },
      { key: "comms.inbox", label: "Inbox and WhatsApp queue" },
    ],
  },
  {
    name: "Volunteers and safety",
    items: [
      { key: "volunteers.view", label: "View volunteer groups and shifts" },
      { key: "volunteers.manage", label: "Manage volunteers and shifts" },
      { key: "safety.view", label: "View waivers and background checks" },
      { key: "safety.manage", label: "Manage waivers and background checks" },
    ],
  },
  {
    name: "Governance",
    items: [
      { key: "governance.view", label: "View meetings and resolutions" },
      { key: "governance.manage", label: "Manage meetings and resolutions" },
      { key: "governance.vote", label: "Vote on resolutions" },
    ],
  },
  {
    name: "Accounting",
    items: [
      { key: "accounting.manage", label: "QuickBooks sync, mappings and exceptions" },
      { key: "accounting.close", label: "Close the month" },
    ],
  },
  {
    name: "Reports",
    items: [{ key: "reports.view", label: "View reports" }],
  },
  {
    // Module `care`; named by the kind (Member care / Donor care, 0750). Amounts need a giving role as well.
    name: "WeCare",
    note: PRIVATE_GROUP_NOTE,
    items: [
      { key: "care.view", label: "See every care record (amounts only with a giving role)" },
      { key: "care.own", label: "See care records for the households they own" },
      { key: "care.manage", label: "Relationship owners, playbooks, care plan and care settings" },
    ],
  },
  {
    // Module `matching`.
    name: "CatchTheMatch",
    note: PRIVATE_GROUP_NOTE,
    items: [
      { key: "matching.view", label: "See matching claims and employers on file" },
      { key: "matching.manage", label: "Manage claims, record employers from paper forms, give Weaver filing access" },
    ],
  },
  {
    // Module `market` (0830): a Marketplace product. In this slice the community's own listings; sellers come later.
    name: "Community Market",
    items: [
      { key: "market.view", label: "See the Community Market, including paused listings" },
      { key: "market.manage", label: "Create, edit, pause and remove the market's categories and listings; start the market" },
      { key: "market.moderate", label: "Review listings and reports (the review queue arrives with sellers)" },
    ],
  },
  {
    name: "Settings",
    items: [
      { key: "settings.manage", label: "Rules and configuration" },
      { key: "roles.manage", label: "Roles and entitlements" },
      { key: "integrations.view", label: "View integrations" },
      { key: "integrations.manage", label: "Connect and manage integrations" },
      { key: "privacy.manage", label: "Privacy and data requests" },
      { key: "audit.view", label: "Audit log" },
      { key: "data.export", label: "Export data (Giving lists)" },
    ],
  },
  {
    name: "Platform",
    items: [{ key: "*", label: "Everything, in every center, except each organization's WeCare and CatchTheMatch data (platform owner)" }],
  },
];

const KNOWN = new Set(ENTITLEMENT_GROUPS.flatMap((g) => g.items.filter((i) => !i.planned).map((i) => i.key)));

export function rolePermissions(p: Json): string[] {
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}

/** Permissions a role holds that the catalogue does not describe (shown raw, never hidden). */
export function unknownPermissions(perms: string[]): string[] {
  return perms.filter((p) => !KNOWN.has(p)).sort();
}

/** The "RIGHTS" count in the roles table ("All" for the wildcard). */
export function rightsCount(perms: string[]): string {
  return perms.includes("*") ? "All" : String(perms.length);
}

/** Plain-English label for one permission string (falls back to the key). */
export function entitlementLabel(key: string): string {
  for (const g of ENTITLEMENT_GROUPS) {
    const hit = g.items.find((i) => i.key === key);
    if (hit) return hit.label;
  }
  return key;
}

/** The module each permission group belongs to, when a kind of organization may not have it. */
const GROUP_MODULE: Readonly<Record<string, string>> = {
  Bolis: "bolis",
  Store: "store",
  Pathshala: "pathshala",
  WeCare: "care",
  CatchTheMatch: "matching",
  "Community Market": "market",
};

/** Groups that are a Marketplace product of their own: shown only while the community has that product on. */
const PRODUCT_GROUPS: ReadonlySet<string> = new Set(["WeCare", "CatchTheMatch", "Community Market"]);

/**
 * The permission groups to show for this organization's kind: no Bolis group where the kind has no bolis, no Pathshala
 * group where it has no school, and the school, the store and WeCare named in the kind's words. WeCare and CatchTheMatch
 * show only while the community has them on (`modulesOff`, src/lib/modules.ts). A Jain Center gets the catalogue as is.
 */
export function entitlementGroupsFor(kind: KindLike, modulesOff: readonly string[] = []): EntitlementGroup[] {
  return ENTITLEMENT_GROUPS.filter((g) => !GROUP_MODULE[g.name] || !moduleNotOffered(kind, GROUP_MODULE[g.name]))
    .filter((g) => !PRODUCT_GROUPS.has(g.name) || !modulesOff.includes(GROUP_MODULE[g.name]))
    .map((g) => {
      if (g.name === "WeCare") return { ...g, name: kindName(kind, "care", "WeCare") };
      if (g.name !== "Pathshala") return g;
      const school = kindName(kind, "pathshala", "Pathshala");
      if (school === "Pathshala") return g;
      return { name: school, items: g.items.map((i) => ({ ...i, label: i.label.replace("Pathshala", school) })) };
    });
}
