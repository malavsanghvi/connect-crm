import { dateInTz } from "@/lib/dates";
import { parseLocalDateTime } from "@/lib/events/field-patch";
import { formatDateTime } from "@/lib/events/format";
import { planSend } from "@/lib/events/quiet-hours";
import { hourLabel, quietHoursText, readNotificationSettings } from "@/lib/settings-rules";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";

import { must } from "../db";

import { NOT_FOUND } from "./kit";

export type AudiencePreviewData = {
  event: { id: string; name: string };
  who: string;
  households: number;
  guest_rsvps: number;
  /** Adults in those households (18 or over); null when the person's role cannot see people. */
  adults: number | null;
  /** Adults who have opted in, by channel; null when the person's role cannot see contact choices. */
  channels: { email: number | null; sms: number | null; whatsapp: number | null; push: null };
  adults_with_no_channel: number | null;
  quiet_hours: {
    window: string;
    asked_for: string;
    goes_out_at: string;
    held: boolean;
    applies_to: string;
    note: string;
  };
  notes: string[];
};

const WHO = {
  reminder: { statuses: ["rsvpd", "confirmed"], label: "Families who RSVP'd (RSVP'd or confirmed)" },
  confirmation: { statuses: ["rsvpd"], label: "Families who RSVP'd and have not confirmed yet" },
} as const;

const input = object({
  event_id: f.uuid("The event the reminder is about (its id, from events.upcoming)."),
  who: f.withDefault(
    f.enum("reminder: everyone who RSVP'd. confirmation: only those who RSVP'd and have not confirmed yet.", ["reminder", "confirmation"] as const),
    "reminder",
  ),
  send_at: f.optional(f.string("When it would go out, as a date and time in the community's time zone like 2026-10-24T09:00. Leave out for right now.", { min: 1, max: 20 })),
});

function asCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** How many people a reminder to this event would reach on each channel, and when quiet hours would let it go. Counts only. */
export const audiencePreview = defineCommand<Infer<typeof input>, AudiencePreviewData>({
  key: "events.audience_preview",
  title: "Preview who a reminder would reach",
  description:
    "Before a reminder to an event's RSVPs goes out: how many households and adults it would reach, how many adults have opted in to email, text and WhatsApp, " +
    "how many cannot be reached on any of those, and what quiet hours would do to the send time (they hold push, text and WhatsApp until they end; email is not held). " +
    "Counts only: it never lists or names anyone, and it never sends anything. Push is not counted. Guests who RSVP'd without a household are not messaged. " +
    "Use messages.draft_reminder for the wording.",
  level: "read",
  permission: "events",
  module: "events",
  input,
  async execute(ctx, { event_id, who, send_at }) {
    const { db, center } = ctx.session;
    const tz = center.time_zone;
    const now = ctx.now?.() ?? new Date();
    const event: { id: string; name: string; starts_at: string | null } | null = must(
      await db.from("events").select("id, name, starts_at").eq("id", event_id).eq("center_id", center.id).maybeSingle(),
      "read the event",
    );
    if (!event) throw new CommandError(NOT_FOUND);

    let at = now;
    if (send_at) {
      const parsed = parseLocalDateTime(send_at, tz, "The send time");
      if (!parsed.ok) throw new CommandError(parsed.error);
      at = new Date(String(parsed.value));
    }
    const rpc = must(await db.rpc("event_reminder_audience", { p_event: event_id, p_statuses: [...WHO[who].statuses] }), "count who a reminder would reach");
    const raw = rpc && typeof rpc === "object" && !Array.isArray(rpc) ? (rpc as Record<string, unknown>) : null;
    if (!raw) throw new CommandError(NOT_FOUND);

    const settings = readNotificationSettings(center.rules);
    const eventDay = event.starts_at !== null && dateInTz(event.starts_at, tz) === dateInTz(at, tz);
    const plan = planSend({ at, tz, settings, eventDay });
    const quiet = {
      window: quietHoursText(settings),
      asked_for: formatDateTime(at.toISOString(), tz),
      goes_out_at: formatDateTime(plan.sendAt.toISOString(), tz),
      held: plan.held,
      applies_to: "Push, text and WhatsApp wait for quiet hours to end. Email is not held.",
      note: plan.held
        ? `Quiet hours (${hourLabel(settings.quietStartHour)} to ${hourLabel(settings.quietEndHour)}) would hold push, text and WhatsApp until ${formatDateTime(plan.sendAt.toISOString(), tz)}.`
        : plan.why ?? "That time is outside quiet hours, so everything goes at once.",
    };

    const peopleVisible = raw.people_visible === true;
    const channelsVisible = raw.channels_visible === true;
    const notes: string[] = [];
    if (!peopleVisible) notes.push("Your role can't see people, so the number of adults and the channels can't be counted here. You can still see how many households RSVP'd.");
    else if (!channelsVisible) notes.push("Your role can't see contact choices, so the channels can't be counted here.");
    const guests = asCount(raw.guest_rsvps) ?? 0;
    if (guests > 0) notes.push(`${guests} guest RSVP${guests === 1 ? "" : "s"} without a household are not messaged: no consent is recorded for a guest.`);
    notes.push("Push notifications are not counted here. Everyone with the Weaver app and the Events topic on gets the push.");

    return {
      ok: true,
      data: {
        event: { id: event.id, name: event.name },
        who: WHO[who].label,
        households: asCount(raw.households) ?? 0,
        guest_rsvps: guests,
        adults: peopleVisible ? asCount(raw.adults) : null,
        channels: { email: asCount(raw.email), sms: asCount(raw.sms), whatsapp: asCount(raw.whatsapp), push: null },
        adults_with_no_channel: asCount(raw.no_channel),
        quiet_hours: quiet,
        notes,
      },
    };
  },
});
