// Shared fakes for the routine tests: a person with roles (and the permissions those roles carry in supabase/seed.sql) and facts.

import type { ScopedContext } from "@/lib/permissions";
import type { CounterKey } from "@/lib/routines/recipes";
import type { FactEvent, RoutineFacts } from "@/lib/routines/resolve";

/** The default roles' permissions, copied from supabase/seed.sql (a test below fails if a role key is not in the seed). */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  center_admin: [
    "people.view", "people.manage", "events.view", "events.manage", "events.confidential", "giving.view", "bolis.view", "store.view",
    "content.view", "content.manage", "comms.view", "comms.send", "comms.approve", "comms.inbox", "pathshala.view", "reports.view",
    "settings.manage", "roles.manage", "audit.view", "integrations.view", "integrations.manage", "volunteers.view", "volunteers.manage",
    "safety.view", "governance.view",
  ],
  treasurer: [
    "people.view", "people.manage", "events.view", "giving.view", "giving.manage", "giving.approve", "giving.record_offline", "bolis.view",
    "store.view", "reports.view", "accounting.manage", "accounting.close", "integrations.view", "audit.view",
  ],
  membership_coordinator: ["people.view", "people.manage", "people.approve", "events.view", "reports.view"],
  event_lead: ["events.view", "reports.view"],
  pathshala_principal: [
    "pathshala.view", "pathshala.manage", "pathshala.teach", "events.view", "reports.view", "governance.view", "governance.manage",
    "governance.vote", "safety.view",
  ],
};

export type Held = string | { key: string; scope?: { kind: string; id: string } };

/** A person holding roles. Center-wide grants carry the role's permissions; a scoped grant carries none (as in the database). */
export function viewer(held: Held[], over: Partial<ScopedContext> = {}): ScopedContext {
  const grants = held.map((h) => {
    const key = typeof h === "string" ? h : h.key;
    const scope = typeof h === "string" ? undefined : h.scope;
    return { role_key: key, scope_kind: scope?.kind ?? "center", scope_id: scope?.id ?? null };
  });
  const permissions = [
    ...new Set(grants.filter((g) => g.scope_kind === "center").flatMap((g) => ROLE_PERMISSIONS[g.role_key] ?? [])),
  ].sort();
  return { permissions, isPlatformAdmin: false, isOwner: false, grants, modulesOff: [], ...over };
}

/** Monday 12 October 2026. 2026-10-16 is a Friday, 2026-10-25 a Sunday, 2026-10-10 a Saturday. */
export const MONDAY = "2026-10-12";
export const FRIDAY = "2026-10-16";
export const TUESDAY = "2026-10-13";

export function facts(over: Partial<RoutineFacts> & { counts?: Partial<Record<CounterKey, number>> } = {}): RoutineFacts {
  return { today: TUESDAY, counts: {}, failed: {}, events: [], ...over };
}

export const event = (days: number, name = "Diwali Dinner", id = `event-${days}`): FactEvent => ({ id, name, days });
