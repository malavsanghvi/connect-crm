// When would a message go out? Quiet hours hold a push, text or WhatsApp until they end (database: app.messaging_quiet_until, 0221),
// except an event-day message, which goes through when the community lets those through (event_day_during_quiet_hours, 0596).
// This is the same rule in plain code, for previews ("if you schedule it now it goes at 7 AM"). Pure.

import { addDays, isoToLocalDateTime } from "@/lib/dates";
import { fromDateTimeLocal } from "@/lib/events/format";

export type QuietSettings = { quietStartHour: number; quietEndHour: number; eventDayDuringQuietHours: boolean };

/** Is this hour of the day (0-23) inside quiet hours? Equal start and end means there are none. */
export function isQuietHour(hour: number, s: Pick<QuietSettings, "quietStartHour" | "quietEndHour">): boolean {
  const { quietStartHour: start, quietEndHour: end } = s;
  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export type SendPlan = {
  /** When it would really go out. */
  sendAt: Date;
  /** True when quiet hours moved it later than asked. */
  held: boolean;
  /** A reason in words, when held. */
  why: string | null;
};

/**
 * `at` is when it would be sent; the answer is when it would really go. `eventDay` is true for a message sent on the event's own
 * day (a reminder that morning): the community's setting decides whether those wait for quiet hours too.
 */
export function planSend(args: { at: Date; tz: string; settings: QuietSettings; eventDay: boolean }): SendPlan {
  const { at, tz, settings, eventDay } = args;
  const local = isoToLocalDateTime(at.toISOString(), tz);
  const hour = Number(local.slice(11, 13));
  if (!local || Number.isNaN(hour) || !isQuietHour(hour, settings)) return { sendAt: at, held: false, why: null };
  if (eventDay && settings.eventDayDuringQuietHours) return { sendAt: at, held: false, why: "It is an event-day message, and this community lets those go during quiet hours." };
  const date = local.slice(0, 10);
  const endLocal = `${date}T${String(settings.quietEndHour).padStart(2, "0")}:00`;
  // Quiet hours that started last night end this morning; ones that started this evening end tomorrow morning.
  const endDate = local >= endLocal ? addDays(date, 1) : date;
  const iso = fromDateTimeLocal(`${endDate}T${String(settings.quietEndHour).padStart(2, "0")}:00`, tz);
  if (!iso) return { sendAt: at, held: false, why: null };
  return { sendAt: new Date(iso), held: true, why: "Quiet hours hold it until they end." };
}
