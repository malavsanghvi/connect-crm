import { formatDateTime } from "@/lib/events/format";
import { eventStatusLabel } from "@/lib/events/status";
import { parseEventSummary, placesLeft, summarySentences, type EventSummary } from "@/lib/events/summary";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";

import { must } from "../db";

import { NOT_FOUND } from "./kit";

export type EventSummaryData = {
  event: { id: string; name: string; status: string; starts: string | null };
  /** The numbers as short sentences, ready to say. */
  in_words: string[];
  places_left: number | null;
  numbers: Pick<EventSummary, "households" | "people" | "lunch" | "volunteers" | "checklist"> & { capacity: number | null };
};

const input = object({ event_id: f.uuid("The event (its id, from events.upcoming).") });

/** One event in numbers: the same counts the event's Report tab shows, in one call. Counts only; no name of anyone. */
export const eventSummary = defineCommand<Infer<typeof input>, EventSummaryData>({
  key: "events.summary",
  title: "Summarise an event",
  description:
    "An event in numbers: how many people have RSVP'd and confirmed, the waitlist, the capacity and places left, how many have checked in, " +
    "the counts of children under 12, seniors and people needing help (totals only), lunch slots and seats, volunteer shifts and how many are assigned, and the checklist. " +
    "It returns counts and short sentences, never a name. Use it to answer 'how is this event doing?'. Use events.rsvps if the person needs to find one family.",
  level: "read",
  permission: "events",
  module: "events",
  input,
  async execute(ctx, { event_id }) {
    const tz = ctx.session.center.time_zone;
    const raw = must(await ctx.session.db.rpc("event_summary", { p_event: event_id }), "read the event's numbers");
    const s = parseEventSummary(raw);
    if (!s) throw new CommandError(NOT_FOUND);
    return {
      ok: true,
      data: {
        event: { id: s.event.id, name: s.event.name, status: eventStatusLabel(s.event.status, { waitlistEnabled: s.event.waitlist_enabled }).label, starts: s.event.starts_at ? formatDateTime(s.event.starts_at, tz) : null },
        in_words: summarySentences(s),
        places_left: placesLeft(s),
        numbers: { households: s.households, people: s.people, lunch: s.lunch, volunteers: s.volunteers, checklist: s.checklist, capacity: s.event.capacity },
      },
    };
  },
});
