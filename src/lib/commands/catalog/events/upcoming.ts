import { addDays } from "@/lib/dates";
import { eventStatusLabel, eventRef } from "@/lib/events/status";
import { formatDateTime, formatEventRange, fromDateTimeLocal, todayIso } from "@/lib/events/format";
import { audienceLabel } from "@/lib/events/report";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { must } from "../db";

export type UpcomingEvent = {
  id: string;
  number: string;
  name: string;
  date: string;
  starts: string | null;
  venue: string | null;
  status: string;
  who_can_rsvp: string;
  capacity: number | null;
};
export type EventsUpcomingData = { count: number; events: UpcomingEvent[]; looked_ahead_days: number };

const input = object({
  days: f.withDefault(f.integer("How many days ahead to look.", { min: 1, max: 365 }), 60),
  limit: f.withDefault(f.integer("The most events to return.", { min: 1, max: 25 }), 10),
});

/** The Events list's "Upcoming" view, short: the next events by date, cancelled ones left out. */
export const eventsUpcoming = defineCommand<Infer<typeof input>, EventsUpcomingData>({
  key: "events.upcoming",
  title: "Show upcoming events",
  description:
    "List the community's upcoming events in date order: name, date and time, venue, whether RSVPs are open, who can RSVP and the capacity. " +
    "Looks 60 days ahead by default (up to 365) and returns at most 10 events (up to 25). Cancelled events are left out. " +
    "Use the id to refer to an event in other tools. It shows only events the person's role may see.",
  level: "read",
  permission: "events",
  module: "events",
  input,
  async execute(ctx, { days, limit }) {
    const { db, center } = ctx.session;
    const tz = center.time_zone;
    const today = todayIso(tz, ctx.now?.());
    const from = fromDateTimeLocal(`${today}T00:00`, tz);
    const until = fromDateTimeLocal(`${addDays(today, days)}T23:59`, tz);
    const rows =
      must(
        await db
          .from("events")
          .select("id, event_number, name, starts_at, ends_at, venue, status, audience, capacity, waitlist_enabled")
          .eq("center_id", center.id)
          .gte("starts_at", from as string)
          .lte("starts_at", until as string)
          .neq("status", "cancelled")
          .order("starts_at")
          .limit(limit),
        "read the upcoming events",
      ) ?? [];
    const events = rows.map((e) => ({
      id: e.id,
      number: eventRef(e),
      name: e.name,
      date: formatEventRange(e.starts_at, e.ends_at, tz, ctx.now?.()),
      starts: e.starts_at ? formatDateTime(e.starts_at, tz) : null,
      venue: e.venue,
      status: eventStatusLabel(e.status, { waitlistEnabled: e.waitlist_enabled }).label,
      who_can_rsvp: audienceLabel(e.audience),
      capacity: e.capacity,
    }));
    return {
      ok: true,
      data: { count: events.length, events, looked_ahead_days: days },
      message: events.length === 0 ? `No events in the next ${days} days.` : undefined,
    };
  },
});
