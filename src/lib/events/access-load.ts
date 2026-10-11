// The signed-in person's roles with their scope, for the event checks in access.ts. Shared by the pages (lib/data/events.ts) and the
// event commands (lib/commands/catalog/events), so there is one way to read them. Importing only types keeps this free of the session
// code: a command can use it without pulling the whole session into every test that loads the catalog.

import type { EventAccess, ScopedGrant } from "@/lib/events/access";
import type { CrmSession } from "@/lib/session";

export type EventAccessSession = Pick<CrmSession, "db" | "userId" | "permissions" | "isPlatformAdmin" | "isOwner"> & { center: Pick<CrmSession["center"], "id"> };

/**
 * The user's grants with their scope, so checks can honour event-scoped roles (an event lead or check-in volunteer for one event).
 * A failed read falls back to center-wide permissions only, and says so in the log.
 */
export async function loadEventAccessFor(session: EventAccessSession): Promise<EventAccess> {
  const { data, error } = await session.db
    .from("role_grants")
    .select("role_key, scope_kind, scope_id, starts_at, ends_at")
    .eq("center_id", session.center.id)
    .eq("user_id", session.userId);
  if (error) {
    console.error("[events] could not load event-scoped roles; using center-wide permissions only:", error);
  }
  const grants: ScopedGrant[] = data ?? [];
  return { permissions: session.permissions, isPlatformAdmin: session.isPlatformAdmin, isOwner: session.isOwner, grants };
}
