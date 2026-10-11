import { eventAreas } from "@/lib/events/access";
import { eventReadiness } from "@/lib/events/readiness";
import { EVENT_STATUSES, EVENT_STATUS_MESSAGES, EVENT_STATUS_WORDS, checkEventTransition, type EventStatus } from "@/lib/events/status-machine";
import { surveySentMessage } from "@/lib/survey/event-survey";
import type { AppSupabase } from "@/lib/supabase/server";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandPreview } from "../../types";

import { must } from "../db";

import { NOT_FOUND, refuse, requireArea } from "./kit";

const DOING = "change the event status";
export const SET_STATUS_DENIED = "only event managers and this event's lead can change its status.";

const input = object({
  event_id: f.uuid("The event (its id, from events.upcoming)."),
  status: f.enum(
    "The status to move the event to. draft -> published (opens RSVPs in the app) or cancelled; published -> rsvp_closed, live or cancelled; rsvp_closed -> published (reopen), live or cancelled; live -> completed or cancelled; completed -> live (reopen); cancelled -> draft (restore).",
    EVENT_STATUSES,
  ),
});
export type SetStatusInput = Infer<typeof input>;
export type SetStatusData = { event: { id: string; name?: string }; from: string | null; to: EventStatus; changed: boolean };

/**
 * Marking an event completed opens its survey when it is set to send by itself (0544); the database takes the counts at once and the
 * background service queues the pushes (0596). Says what happened, or that it could not be checked.
 */
async function completedMessage(db: AppSupabase, eventId: string): Promise<string> {
  const found = await db.from("surveys").select("id").eq("event_id", eventId).eq("kind", "event_feedback").limit(1);
  if (found.error) {
    console.error("[events] events.setEventStatus: the event is completed, but its survey could not be checked:", found.error);
    return "Marked completed. Whether its survey went out could not be checked; open the event's Survey tab to see.";
  }
  const id = found.data?.[0]?.id;
  if (!id) return EVENT_STATUS_MESSAGES.completed;
  // Loaded here, not at the top: it reads the whole session, which a plain list of the commands should not.
  const { readSurveyNotices } = await import("@/lib/data/event-survey");
  const read = await readSurveyNotices(db, id);
  if (!read.ok) return "Marked completed. Its survey's numbers could not be loaded; open the event's Survey tab to see who gets a push.";
  if (!read.notices) return EVENT_STATUS_MESSAGES.completed;
  return `Marked completed. ${surveySentMessage(read.notices, "The survey opened")}`;
}

/** What members and staff would notice, said before anything changes. */
function noticeFor(to: EventStatus): string | null {
  switch (to) {
    case "published":
      return "Members will be able to RSVP in the app. Nothing is sent to them automatically.";
    case "rsvp_closed":
      return "Families can no longer RSVP in the app. Existing RSVPs stay.";
    case "live":
      return "Check-in opens in volunteer mode.";
    case "completed":
      return "The event's feedback survey opens by itself if it is set to.";
    case "cancelled":
      return "RSVPs stay on record. Families are not told automatically: send them a message yourself.";
    default:
      return null;
  }
}

/**
 * Move an event to another status. The rule for which moves are allowed is checkEventTransition (src/lib/events/status-machine.ts), the
 * same table the event page's buttons are built from. The Server Action setEventStatus calls this and returns its answer unchanged.
 */
export const setEventStatusCommand = defineCommand<SetStatusInput, SetStatusData>({
  key: "events.set_status",
  title: "Change an event's status",
  description:
    "Move an event to another status: publish it (opens RSVPs in the member app), close or reopen RSVPs, go live on the day (opens check-in), mark it completed, cancel it, or restore a cancelled one as a draft. " +
    "This asks the person to confirm first. Only the moves the Events screen offers are allowed: a draft cannot go straight to live, a completed event can only be reopened as live. " +
    "Nothing is sent to families. Use events.readiness first to see what is missing before publishing or going live.",
  level: "confirm",
  permission: "eventsManage",
  module: "events",
  // Off until the owner switches it on in the community's settings (assistant.tools.events.set_status).
  enabledByDefault: false,
  input,
  async preview(ctx, { event_id, status }): Promise<CommandPreview> {
    const { db, center } = ctx.session;
    const event = must(await db.from("events").select("name, status, starts_at, ends_at, venue, description, capacity, rsvp_opens_at, rsvp_closes_at, lunch_enabled, lunch_starts_at, is_paid, member_price_cents, guest_price_cents, audience, owner_person_id, flyer_path").eq("id", event_id).eq("center_id", center.id).maybeSingle(), "read the event");
    if (!event) throw new CommandError(NOT_FOUND);
    const check = checkEventTransition(event.status, status);
    if (!check.ok) refuse(DOING, check.error);
    const warnings: string[] = [];
    if (check.same) warnings.push(`It is already ${EVENT_STATUS_WORDS[status]}, so nothing would change.`);
    else {
      const notice = noticeFor(status);
      if (notice) warnings.push(notice);
      if (status === "published" || status === "live") {
        // Only what the event row itself shows; events.readiness has the full list.
        const goal = status === "published" ? "publish" : "event_day";
        const ready = eventReadiness({ ...event, status: event.status }, { lunch_slots: 0, shifts: 0, shifts_empty: null, checklist_overdue: 0, checklist_open: 0 }, goal, ctx.now?.() ?? new Date(), center.time_zone);
        for (const b of ready.blockers.filter((x) => x.code !== "no_slots")) warnings.push(`Before this: ${b.text} ${b.fix}`);
      }
    }
    return {
      summary: `Change ${event.name} from ${EVENT_STATUS_WORDS[event.status as EventStatus] ?? event.status} to ${EVENT_STATUS_WORDS[status]}.`,
      lines: [{ label: "Status", before: EVENT_STATUS_WORDS[event.status as EventStatus] ?? event.status, after: EVENT_STATUS_WORDS[status] }],
      warnings,
    };
  },
  confirmText: (_input, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, { event_id, status }) {
    await requireArea(ctx, (a) => eventAreas.edit(a, event_id), DOING, SET_STATUS_DENIED);
    const { db } = ctx.session;
    const before = (must(await db.from("events").select("name, status").eq("id", event_id).limit(1), "load the event") ?? [])[0];
    if (before) {
      const check = checkEventTransition(before.status, status);
      if (!check.ok) refuse(DOING, check.error);
    }
    const res = must(await db.from("events").update({ status }).eq("id", event_id).select("id"), DOING);
    if (!res?.length) refuse(DOING, "you can't change this event.");
    revalidateAfterCommand(["/events", "/ops"]);
    const data: SetStatusData = { event: { id: event_id, name: before?.name }, from: before?.status ?? null, to: status, changed: before?.status !== status };
    if (status === "completed" && before?.status !== "completed") return { ok: true, data, message: await completedMessage(db, event_id) };
    return { ok: true, data, message: EVENT_STATUS_MESSAGES[status] };
  },
});
