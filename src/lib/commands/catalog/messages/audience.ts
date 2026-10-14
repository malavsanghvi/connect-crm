import { describeAudience, requiresSecondApprover } from "@/lib/comms";
import type { Json } from "@/lib/database.types";
import { dateInTz } from "@/lib/dates";
import { parseLocalDateTime } from "@/lib/events/field-patch";
import { formatDateTime } from "@/lib/events/format";
import { planSend } from "@/lib/events/quiet-hours";
import { hourLabel, quietHoursText, readNotificationSettings } from "@/lib/settings-rules";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext } from "../../types";
import { must } from "../db";

import { audienceFromInput } from "./shared";

export type QuietHoursInfo = { window: string; asked_for: string; goes_out_at: string; held: boolean; applies_to: string; note: string };

export type MessageAudienceData = {
  /** The audience in words: "All members + West zone". */
  who: string;
  /** Households the audience matches (any channel). Null when the role cannot see people. */
  households_matched: number | null;
  /** The compose form's "Recipients": households with an adult who accepts email. */
  households_reachable_by_email: number;
  /** Adults in those households (18 or over). Null when the role cannot see people. */
  adults: number | null;
  /** Adults who have opted in, by channel. Null when the role cannot see people. Push is not counted. */
  channels: { email: number | null; sms: number | null; whatsapp: number | null; push: null };
  adults_with_no_channel: number | null;
  /** A message to all members needs two different approvers. */
  needs_second_approver: boolean;
  quiet_hours: QuietHoursInfo;
  notes: string[];
};

const input = object({
  to_all_members: f.withDefault(f.boolean("Everyone with an active membership."), false),
  to_life_members: f.withDefault(f.boolean("Life members."), false),
  zone_ids: f.optional(f.string("Zone ids, separated by commas, to include.", { max: 2000 })),
  pathshala_class_ids: f.optional(f.string("Class ids, separated by commas: the families with a child in those classes.", { max: 2000 })),
  event_id: f.optional(f.uuid("An event: the families that RSVP'd to it.")),
  rsvp_statuses: f.optional(f.string("With event_id: which RSVPs, separated by commas (rsvpd, confirmed, attended). Leave out for all three.", { max: 200 })),
  audience_json: f.optional(f.string("The audience exactly as the compose form builds it. Leave out: use the fields above.", { max: 20000 })),
  send_at: f.optional(f.string("When it would go out, in the community's time zone, like 2026-10-24T09:00. Leave out for right now.", { min: 1, max: 20 })),
});
export type AudienceInput = Infer<typeof input>;

function asCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** What quiet hours would do to a send at `at`. Push, text and WhatsApp wait; email does not. */
export function quietHoursInfo(ctx: CommandContext, at: Date, eventDay: boolean): QuietHoursInfo {
  const { center } = ctx.session;
  const tz = center.time_zone;
  const settings = readNotificationSettings(center.rules);
  const plan = planSend({ at, tz, settings, eventDay });
  return {
    window: quietHoursText(settings),
    asked_for: formatDateTime(at.toISOString(), tz),
    goes_out_at: formatDateTime(plan.sendAt.toISOString(), tz),
    held: plan.held,
    applies_to: "Push, text and WhatsApp wait for quiet hours to end. Email is not held.",
    note: plan.held
      ? `Quiet hours (${hourLabel(settings.quietStartHour)} to ${hourLabel(settings.quietEndHour)}) would hold push, text and WhatsApp until ${formatDateTime(plan.sendAt.toISOString(), tz)}.`
      : plan.why ?? "That time is outside quiet hours, so everything goes at once.",
  };
}

type Named = { id: string; name: string };

/** The names of the zones, classes and events some audiences mention, so they can be read back in words. */
export async function audienceNames(ctx: CommandContext, audiences: readonly Record<string, unknown>[]) {
  const { db, center } = ctx.session;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const zoneIds = [...new Set(audiences.flatMap((a) => strings(a.zone_ids)))];
  const classIds = [...new Set(audiences.flatMap((a) => strings(a.pathshala_class_ids)))];
  const eventIds = [...new Set(audiences.flatMap((a) => (typeof a.event_id === "string" ? [a.event_id] : [])))];
  const zones = zoneIds.length ? ((must(await db.from("zones").select("id, name").eq("center_id", center.id).in("id", zoneIds), "read the zones") ?? []) as Named[]) : [];
  const classes = classIds.length ? ((must(await db.from("pathshala_classes").select("id, name").eq("center_id", center.id).in("id", classIds), "read the classes") ?? []) as Named[]) : [];
  const events = eventIds.length ? ((must(await db.from("events").select("id, name, starts_at").eq("center_id", center.id).in("id", eventIds), "read the event") ?? []) as (Named & { starts_at: string | null })[]) : [];
  return {
    names: {
      zones: new Map(zones.map((z) => [z.id, z.name])),
      classes: new Map(classes.map((c) => [c.id, c.name])),
      events: new Map(events.map((e) => [e.id, e.name])),
    },
    eventStartsAt: events[0]?.starts_at ?? null,
  };
}

/** The number the compose form shows: households with at least one adult who accepts email (app.segment_recipient_count). */
export async function recipientCount(ctx: CommandContext, audience: Record<string, unknown>): Promise<number> {
  const n = must(await ctx.session.db.rpc("segment_recipient_count", { p_center: ctx.session.center.id, p_audience: audience as Json }), "count the recipients");
  return typeof n === "number" ? n : 0;
}

/**
 * How many people a message to this audience would reach on each channel, and when quiet hours would let it go. Counts only: it never
 * lists or names anyone, and it never sends anything.
 */
export const messageAudiencePreview = defineCommand<AudienceInput, MessageAudienceData>({
  key: "messages.audience_preview",
  title: "Preview who a message would reach",
  description:
    "Before a message to families is scheduled: how many households the audience matches, how many adults have opted in to email, text and WhatsApp, how many cannot be reached on any of those, " +
    "the compose form's 'Recipients' number (households that accept email), whether it needs two approvers (a message to all members does), and what quiet hours would do to the send time " +
    "(they hold push, text and WhatsApp until they end; email is not held). Choose the audience with the fields: all members, life members, zones, school classes or the RSVPs of an event. " +
    "Counts only: it never lists or names anyone and never sends anything. Push is not counted. For the families of one event's RSVPs you can also use events.audience_preview. Use messages.draft_reminder for the wording.",
  level: "read",
  permission: "commsSend",
  module: "comms",
  input,
  async execute(ctx, args) {
    const { db, center } = ctx.session;
    const tz = center.time_zone;
    const now = ctx.now?.() ?? new Date();
    const aud = audienceFromInput(args);
    if (!aud.ok) throw new CommandError(`Could not preview the audience — ${aud.error}.`);

    let at = now;
    if (args.send_at) {
      const parsed = parseLocalDateTime(args.send_at, tz, "The send time");
      if (!parsed.ok) throw new CommandError(parsed.error);
      at = new Date(String(parsed.value));
    }

    const { names, eventStartsAt } = await audienceNames(ctx, [aud.audience]);
    const recipients = await recipientCount(ctx, aud.audience);
    const reach = must(await db.rpc("audience_reach", { p_center: center.id, p_audience: aud.audience as Json }), "count who a message would reach");
    const raw = reach && typeof reach === "object" && !Array.isArray(reach) ? (reach as Record<string, unknown>) : null;
    const peopleVisible = raw?.people_visible === true;

    const eventDay = eventStartsAt !== null && dateInTz(eventStartsAt, tz) === dateInTz(at, tz);
    const notes: string[] = [];
    if (!raw) notes.push("Your role can't preview the reach of a message, so only the recipients number is shown.");
    else if (!peopleVisible) notes.push("Your role can't see people, so the number of adults and the channels can't be counted here. The recipients number above is still right.");
    if (raw?.custom_fields_not_counted === true) notes.push("The breakdown by channel leaves out the custom-field choices; the recipients number includes them.");
    if (peopleVisible && asCount(raw?.households) === 0 && recipients === 0) notes.push("Nobody matches this audience.");
    notes.push("Push notifications are not counted here. Everyone with the Weaver app and the topic on gets the push.");

    return {
      ok: true,
      data: {
        who: describeAudience(aud.audience, { ...names }),
        households_matched: peopleVisible ? asCount(raw?.households) : null,
        households_reachable_by_email: recipients,
        adults: peopleVisible ? asCount(raw?.adults) : null,
        channels: peopleVisible ? { email: asCount(raw?.email), sms: asCount(raw?.sms), whatsapp: asCount(raw?.whatsapp), push: null } : { email: null, sms: null, whatsapp: null, push: null },
        adults_with_no_channel: peopleVisible ? asCount(raw?.no_channel) : null,
        needs_second_approver: requiresSecondApprover(aud.audience),
        quiet_hours: quietHoursInfo(ctx, at, eventDay),
        notes,
      },
    };
  },
});
