// How an event's status reads in lists (prototype: coloured bold text).

export type EventStatusTone = "ok" | "warn" | "bad" | "navy" | "muted";

export function eventStatusLabel(
  status: string,
  opts: { waitlistEnabled?: boolean; waitlisted?: number; capacity?: number | null; booked?: number } = {},
): { label: string; tone: EventStatusTone } {
  switch (status) {
    case "draft":
      return { label: "Draft", tone: "warn" };
    case "published": {
      const full = opts.capacity !== null && opts.capacity !== undefined && (opts.booked ?? 0) >= opts.capacity;
      if (opts.waitlistEnabled && ((opts.waitlisted ?? 0) > 0 || full)) return { label: "Waitlist on", tone: "ok" };
      if (full) return { label: "Full", tone: "warn" };
      return { label: "RSVP open", tone: "ok" };
    }
    case "rsvp_closed":
      return { label: "RSVP closed", tone: "navy" };
    case "live":
      return { label: "Live", tone: "ok" };
    case "completed":
      return { label: "Completed", tone: "muted" };
    case "cancelled":
      return { label: "Cancelled", tone: "bad" };
    default:
      return { label: status, tone: "muted" };
  }
}

export const STATUS_TEXT_CLASS: Record<EventStatusTone, string> = {
  ok: "cc-status-ok",
  warn: "cc-status-warn",
  bad: "cc-status-bad",
  navy: "font-bold text-navy",
  muted: "font-semibold text-muted",
};

/** Where a row in All events opens: drafts in the builder, live events on the check-in dashboard, others on the event page. */
export function eventRowHref(e: { id: string; status: string }): string {
  if (e.status === "draft") return `/events/builder?event=${e.id}`;
  if (e.status === "live") return `/events/live?event=${e.id}`;
  return `/events/${e.id}`;
}

/**
 * Reference shown in the ID column: the event's number ({short_name}-EV-901,
 * issued by the database, migration 0121); the id's first characters only for
 * a row that somehow has none.
 */
export function eventRef(e: { id: string; event_number?: string | null }): string {
  if (e.event_number) return e.event_number;
  return `EV-${e.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
