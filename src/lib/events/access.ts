// Event-scoped roles (event_lead, checkin_volunteer, kitchen_lead,
// boli_recorder). Mirrors app.has_scoped_role(center, id, …): the role granted
// center-wide, or granted for that event. Convenience only — RLS enforces.
// Pure module (the grants come from lib/data/events.ts).

import { can, isGrantActive, type PermissionContext } from "@/lib/permissions";

export type ScopedGrant = { role_key: string; scope_kind: string; scope_id: string | null; starts_at: string; ends_at: string | null };

export type EventAccess = PermissionContext & { grants: ScopedGrant[] };

export const EVENT_ROLES = ["event_lead", "checkin_volunteer", "kitchen_lead", "boli_recorder"] as const;

export function hasScopedRole(a: EventAccess, eventId: string, ...roles: string[]): boolean {
  if (a.isPlatformAdmin) return true;
  const now = new Date();
  return a.grants.some(
    (g) => roles.includes(g.role_key) && isGrantActive(g, now) && (g.scope_kind === "center" || g.scope_id === eventId),
  );
}

export function hasRoleAnywhere(a: EventAccess, ...roles: string[]): boolean {
  if (a.isPlatformAdmin) return true;
  const now = new Date();
  return a.grants.some((g) => roles.includes(g.role_key) && isGrantActive(g, now));
}

/** Event ids the user holds one of the roles for through an event-scoped grant. */
export function scopedEventIds(a: EventAccess, ...roles: string[]): string[] {
  const now = new Date();
  const list = roles.length ? roles : [...EVENT_ROLES];
  return [
    ...new Set(
      a.grants.filter((g) => list.includes(g.role_key) && g.scope_id && g.scope_kind !== "center" && isGrantActive(g, now)).map((g) => g.scope_id as string),
    ),
  ];
}

export const eventAreas = {
  /** The Events module (list, builder, live dashboard). */
  view: (a: EventAccess) => can(a, ["events.view", "events.manage"]),
  manage: (a: EventAccess) => can(a, "events.manage"),
  /** One event's page: staff, or this event's lead. */
  event: (a: EventAccess, eventId: string) => can(a, ["events.view", "events.manage"]) || hasScopedRole(a, eventId, "event_lead"),
  edit: (a: EventAccess, eventId: string) => can(a, "events.manage") || hasScopedRole(a, eventId, "event_lead"),
  rsvps: (a: EventAccess, eventId: string) => can(a, "events.manage") || hasScopedRole(a, eventId, "event_lead", "checkin_volunteer"),
  checkIn: (a: EventAccess, eventId: string) => can(a, "events.manage") || hasScopedRole(a, eventId, "event_lead", "checkin_volunteer"),
  kitchen: (a: EventAccess, eventId: string) =>
    can(a, ["events.view", "events.manage", "kitchen.view"]) || hasScopedRole(a, eventId, "event_lead", "kitchen_lead"),
  runLunch: (a: EventAccess, eventId: string) => can(a, "events.manage") || hasScopedRole(a, eventId, "event_lead", "kitchen_lead"),
  volunteers: (a: EventAccess, eventId: string) => can(a, ["events.manage", "volunteers.manage"]) || hasScopedRole(a, eventId, "event_lead"),
  grantRoles: (a: EventAccess) => can(a, "roles.manage"),
};

/** Pick the event a dashboard or volunteer most likely means: live, else today's, else the next upcoming, else the latest. */
export function pickCurrentEvent<E extends { id: string; starts_at: string | null; ends_at: string | null; status: string }>(
  events: E[],
  todayInTz: (iso: string) => string,
  today: string,
  now: Date = new Date(),
): E | null {
  if (!events.length) return null;
  const live = events.find((e) => e.status === "live");
  if (live) return live;
  const t = now.getTime();
  const usable = events.filter((e) => e.status !== "cancelled" && e.status !== "draft" && e.starts_at);
  const todays = usable.find(
    (e) => todayInTz(e.starts_at!) === today || (Date.parse(e.starts_at!) <= t && e.ends_at !== null && Date.parse(e.ends_at) >= t),
  );
  if (todays) return todays;
  const upcoming = usable.filter((e) => Date.parse(e.starts_at!) >= t).sort((a, b) => a.starts_at!.localeCompare(b.starts_at!))[0];
  if (upcoming) return upcoming;
  return usable.sort((a, b) => b.starts_at!.localeCompare(a.starts_at!))[0] ?? null;
}
