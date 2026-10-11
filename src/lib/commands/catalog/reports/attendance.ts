import { formatDateTime } from "@/lib/dates";
import { reportReads } from "@/lib/reports/load";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { dateFields, got, plural, requireModule, resolveRange, fiscalYearStart } from "./shared";

export type EventAttendanceData = {
  from: string;
  to: string;
  check_ins: number;
  events_with_check_ins: number;
  top_events: { event: string; when: string | null; check_ins: number }[];
  by_month: { month: string; check_ins: number }[];
};

const input = object({
  ...dateFields,
  top: f.withDefault(f.integer("How many of the busiest events to list.", { min: 1, max: 25 }), 5),
});

/** Event check-ins in a range of days: the total, how many events, the busiest events and the months. */
export const eventAttendance = defineCommand<Infer<typeof input>, EventAttendanceData>({
  key: "reports.event_attendance",
  title: "Count event check-ins",
  description:
    "Count the people who checked in at events between two days: the total, at how many events, the busiest events and the count by month. Leave the dates out for the year so far (the community's financial year). " +
    "Use it for 'how many people came to events this year?' and 'which events were busiest?'. The sums are done by the database and are exact. " +
    "It returns counts and event names only: no attendee is named and nothing is split by age. Use events.summary for the RSVPs of one event. Read only.",
  level: "read",
  permission: "events",
  module: "reports",
  input,
  async execute(ctx, { from, to, top }) {
    requireModule(ctx, "events");
    const start = await fiscalYearStart(ctx);
    const range = resolveRange(ctx, { from, to }, start.from);
    const a = got(await reportReads.attendance(ctx.session.db, ctx.session.center.id, range.from, range.to, top), "count the event check-ins");
    const tz = ctx.session.center.time_zone;
    const data: EventAttendanceData = {
      from: range.from,
      to: range.to,
      check_ins: a.checkIns,
      events_with_check_ins: a.events,
      top_events: a.topEvents.map((e) => ({ event: e.name, when: e.startsAt ? formatDateTime(e.startsAt, tz) : null, check_ins: e.checkIns })),
      by_month: a.byMonth.map((m) => ({ month: m.month, check_ins: m.checkIns })),
    };
    return { ok: true, data, message: `${range.words}: ${plural(a.checkIns, "check-in")} at ${plural(a.events, "event")}.${start.note ? ` ${start.note}.` : ""}` };
  },
});
