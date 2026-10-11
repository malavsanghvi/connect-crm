// "Who can ...?" in plain words (Settings, B90 phase 4). A person asks "who can see payments?"; the answer is the roles that give that
// right and the adults who hold them. The areas below are a short list in the words a treasurer or a president uses; each one names
// the ACCESS key (src/lib/permissions.ts) the screens already use, so the answer and the screens can never disagree.
// Pure: no server imports.

import { entitlementLabel } from "@/lib/entitlements";
import { ACCESS, type AccessKey } from "@/lib/permissions";

export type AccessArea = { key: string; label: string; access: AccessKey };

/** In the order an administrator is likely to ask. `label` finishes "who can ...". */
export const ACCESS_AREAS = [
  { key: "payments", label: "see payments and gifts", access: "payments" },
  { key: "pledges", label: "see pledges", access: "pledges" },
  { key: "record_payment", label: "record a payment", access: "recordPayment" },
  { key: "approve_money", label: "approve a refund or write-off as the second person", access: "givingApprove" },
  { key: "bank", label: "see the bank lines", access: "bank" },
  { key: "month_close", label: "close the month", access: "closeManage" },
  { key: "quickbooks", label: "work with QuickBooks", access: "qbo" },
  { key: "people", label: "see members and households", access: "households" },
  { key: "edit_people", label: "change members and households", access: "householdsEdit" },
  { key: "applications", label: "approve membership applications", access: "applicationsDecide" },
  { key: "events", label: "see events", access: "events" },
  { key: "run_events", label: "create and run events", access: "eventsManage" },
  { key: "messages", label: "write messages to families", access: "commsDraft" },
  { key: "roles", label: "give and take away roles", access: "roles" },
  { key: "settings", label: "change the community's settings", access: "centerSettings" },
  { key: "integrations", label: "see the connected services", access: "integrations" },
  { key: "audit", label: "read the audit log", access: "audit" },
  { key: "reports", label: "see reports", access: "reports" },
] as const satisfies readonly AccessArea[];

export type AccessAreaKey = (typeof ACCESS_AREAS)[number]["key"];

export const ACCESS_AREA_KEYS = ACCESS_AREAS.map((a) => a.key) as unknown as readonly [AccessAreaKey, ...AccessAreaKey[]];

export function accessArea(key: string): (typeof ACCESS_AREAS)[number] | undefined {
  return ACCESS_AREAS.find((a) => a.key === key);
}

/** The permission keys any one of which opens the area. */
export function permissionsFor(area: { access: AccessKey }): readonly string[] {
  return ACCESS[area.access];
}

/** What those permissions are called on the Roles screen, one plain phrase each. */
export function permissionWords(keys: readonly string[]): string[] {
  return [...new Set(keys.map((k) => entitlementLabel(k)))];
}

export type RoleLike = { key: string; name: string; tier: string; permissions: unknown };

function permissionList(p: unknown): string[] {
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The staff roles that give this area: they hold at least one of its permissions by name. A platform role or a family role
 * (they come from household relationships) is never listed. Like the database, "*" is not expanded.
 */
export function rolesThatGive(area: { access: AccessKey }, roles: readonly RoleLike[]): RoleLike[] {
  const need = permissionsFor(area);
  if (need.length === 0) return [];
  return roles.filter((r) => r.tier !== "platform" && r.tier !== "family" && permissionList(r.permissions).some((p) => need.includes(p)));
}

/** What a role lets a person do, in the Roles screen's words (permissions the screen has no words for are left out). */
export function roleAllows(perms: unknown): string[] {
  return permissionWords(permissionList(perms).filter((p) => p !== "*" && entitlementLabel(p) !== p));
}
