// What the Events commands share: the permission check the Server Actions make (event managers, an event's own lead, ...), the way a
// refusal is worded, and reading one event. Kept to this folder so the other areas' commands do not depend on it.

import type { EventAccess } from "@/lib/events/access";
import { loadEventAccessFor } from "@/lib/events/access-load";

import { CommandError, type CommandContext } from "../../types";

/** "Could not change the event status — only event managers and this event's lead can change its status." */
export function refuse(doing: string, why: string): never {
  throw new CommandError(`Could not ${doing} — ${why}`);
}

/**
 * The same check the Server Action makes for this area (a role for everything in the community, or one for this event only).
 * The row-level security in the database is what really decides; this gives the person a sentence instead of an empty result.
 */
export async function requireArea(ctx: CommandContext, check: (a: EventAccess) => boolean, doing: string, denied: string): Promise<EventAccess> {
  const access = await loadEventAccessFor(ctx.session);
  if (!check(access)) refuse(doing, denied);
  return access;
}

/** Event columns most commands need. */
export const EVENT_COLUMNS = "id, event_number, name, status, starts_at, ends_at, venue, description, audience, capacity, rsvp_opens_at, rsvp_closes_at, confirmation_hours_before, waitlist_enabled";

export const NOT_FOUND = "That event was not found, or you can't see it.";

/** Whether a string looks like a database id; used where a list of ids arrives as one piece of text. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
