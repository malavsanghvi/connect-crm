import { EventsTable } from "@/components/people-v2/family/events-table";
import { NoAccess, QueryError } from "@/components/ui";
import { buildEventLines } from "@/lib/people-v2/family-events";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

/** How many of the latest RSVPs the tab reads. One more is asked for, to know whether older ones were left out. */
export const EVENTS_TAB_LIMIT = 100;

/**
 * The Family page's Events tab: this household's RSVPs, the events they were for and who was checked in. Read only, with the viewer's
 * own database access (an event the role cannot read comes back as a plain sentence, never a blank). A failed read says so with a retry.
 */
export async function EventsTab({ session, householdId }: { session: CrmSession; householdId: string }) {
  if (!canAccess(session, "events")) return <NoAccess area="Events and RSVPs" access="events" />;
  const { db, center } = session;
  const retry = `/households/${householdId}?tab=events`;

  const rsvpRes = await db
    .from("rsvps")
    .select("id, event_id, status, source, created_at")
    .eq("center_id", center.id)
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(EVENTS_TAB_LIMIT + 1);
  if (rsvpRes.error) return <QueryError what="this household's RSVPs" error={rsvpRes.error} retryHref={retry} />;
  const all = rsvpRes.data ?? [];
  const olderLeftOut = all.length > EVENTS_TAB_LIMIT;
  const rsvps = all.slice(0, EVENTS_TAB_LIMIT);
  if (rsvps.length === 0) return <EventsTable lines={[]} timeZone={center.time_zone} />;

  const [eventRes, attendeeRes] = await Promise.all([
    db
      .from("events")
      .select("id, name, starts_at")
      .in("id", [...new Set(rsvps.map((r) => r.event_id))]),
    db
      .from("attendees")
      .select("rsvp_id, status, checked_in_at")
      .in(
        "rsvp_id",
        rsvps.map((r) => r.id),
      ),
  ]);
  if (eventRes.error) return <QueryError what="the events these RSVPs are for" error={eventRes.error} retryHref={retry} />;
  if (attendeeRes.error) return <QueryError what="who was checked in" error={attendeeRes.error} retryHref={retry} />;

  const lines = buildEventLines(rsvps, eventRes.data ?? [], attendeeRes.data ?? []);
  return <EventsTable lines={lines} timeZone={center.time_zone} olderLeftOut={olderLeftOut} />;
}
