import { eventReadiness, type Readiness, type ReadinessEvent } from "@/lib/events/readiness";
import { parseEventSummary } from "@/lib/events/summary";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";

import { must } from "../db";

import { NOT_FOUND } from "./kit";

export type EventReadinessData = Readiness & { event: { id: string; name: string } };

const input = object({
  event_id: f.uuid("The event (its id, from events.upcoming)."),
  goal: f.withDefault(
    f.enum("publish: opening the event for RSVPs in the member app. event_day: turning on check-in on the day.", ["publish", "event_day"] as const),
    "publish",
  ),
});

/** What is stopping this event from going live: things to fix first, and things worth a look. Changes nothing. */
export const eventReadinessCommand = defineCommand<Infer<typeof input>, EventReadinessData>({
  key: "events.readiness",
  title: "What is blocking an event going live",
  description:
    "Check an event before it opens for RSVPs (goal publish, the default) or before check-in opens on the day (goal event_day). " +
    "Returns 'blockers' to fix first (no start date, the end before the start, lunch on with no start time, a paid event with no price, RSVPs closing before they open ...) " +
    "and 'checks' worth a look (no venue, no flyer, nobody named as lead, shifts with nobody assigned, overdue checklist actions), each with how to fix it. " +
    "It changes nothing. Use events.set_field to fix a detail, or tell the person where to go on the screen.",
  level: "read",
  permission: "events",
  module: "events",
  input,
  async execute(ctx, { event_id, goal }) {
    const { db, center } = ctx.session;
    const event: (ReadinessEvent & { id: string }) | null = must(
      await db
        .from("events")
        .select("id, name, status, starts_at, ends_at, venue, description, capacity, rsvp_opens_at, rsvp_closes_at, lunch_enabled, lunch_starts_at, is_paid, member_price_cents, guest_price_cents, audience, owner_person_id, flyer_path")
        .eq("id", event_id)
        .eq("center_id", center.id)
        .maybeSingle(),
      "read the event",
    );
    if (!event) throw new CommandError(NOT_FOUND);
    const summary = parseEventSummary(must(await db.rpc("event_summary", { p_event: event_id }), "read the event's numbers"));
    if (!summary) throw new CommandError("Could not read the event's numbers, so it could not be checked. Try again.");
    const counts = {
      lunch_slots: summary.lunch.slots,
      shifts: summary.volunteers.shifts,
      shifts_empty: summary.volunteers.shifts_empty,
      checklist_overdue: summary.checklist.overdue,
      checklist_open: summary.checklist.in_progress + summary.checklist.not_started,
    };
    const readiness = eventReadiness(event, counts, goal, ctx.now?.() ?? new Date(), center.time_zone);
    return { ok: true, data: { event: { id: event.id, name: event.name }, ...readiness }, message: readiness.summary };
  },
});
