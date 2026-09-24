"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { eventActionContext } from "@/lib/data/events";
import type { TablesUpdate } from "@/lib/database.types";
import type { ActionResult } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { all, bool, cents, centsList, dateTime, FormError, int, isoDate, must, oneOf, reqStr, runAction, str } from "@/lib/events/forms";
import { toE164 } from "@/lib/events/format";
import { lunchRulesFromCenter } from "@/lib/events/rules";
import { AUDIENCES, parsePartyLines, planLunchSlots } from "@/lib/events/report";
import { randomToken } from "@/lib/events/tokens";
import { can } from "@/lib/permissions";

type Result = ActionResult<unknown>;

const EVENT_STATUSES = ["draft", "published", "rsvp_closed", "live", "completed", "cancelled"] as const;
const STATIONS = ["entry", "food", "gifts", "parking", "kitchen", "app_seva"] as const;
const FLAGS = ["child_under_12", "senior", "assistance"] as const;

function revalidateEvents() {
  revalidatePath("/events", "layout");
  revalidatePath("/ops", "layout");
}

function eventValues(fd: FormData, tz: string, rules: unknown, publishing: boolean) {
  const startsAt = dateTime(fd, "starts_at", "Starts", tz);
  const endsAt = dateTime(fd, "ends_at", "Ends", tz);
  if (startsAt && endsAt && endsAt <= startsAt) throw new FormError("The event must end after it starts.");
  const rsvpOpens = dateTime(fd, "rsvp_opens_at", "RSVP opens", tz);
  const rsvpCloses = dateTime(fd, "rsvp_closes_at", "RSVP closes", tz);
  if (rsvpOpens && rsvpCloses && rsvpCloses <= rsvpOpens) throw new FormError("RSVPs must close after they open.");
  const lunchEnabled = bool(fd, "lunch_enabled");
  const lunchStarts = dateTime(fd, "lunch_starts_at", "Lunch starts", tz);
  // A draft may leave lunch time for later; a published event needs it.
  if (publishing && lunchEnabled && !lunchStarts) throw new FormError("Set when lunch starts, or turn lunch slots off.");
  const isPaid = bool(fd, "is_paid");
  const reminderOn = bool(fd, "reminder_enabled");
  const lunch = lunchRulesFromCenter(rules);
  return {
    name: reqStr(fd, "name", "Event name"),
    description: str(fd, "description"),
    flyer_path: str(fd, "flyer_path"),
    venue: str(fd, "venue"),
    starts_at: startsAt,
    ends_at: endsAt,
    program_year: str(fd, "program_year"),
    capacity: int(fd, "capacity", "Capacity", { min: 0 }),
    waitlist_enabled: bool(fd, "waitlist_enabled"),
    audience: oneOf(fd, "audience", AUDIENCES, "Audience", "members_and_guests"),
    rsvp_opens_at: rsvpOpens,
    rsvp_closes_at: rsvpCloses,
    // 0 = no confirmation reminder.
    confirmation_hours_before: reminderOn ? (int(fd, "confirmation_hours_before", "Confirmation reminder", { min: 1, max: 336 }) ?? 24) : 0,
    attendee_flags: all(fd, "attendee_flags").filter((f) => (FLAGS as readonly string[]).includes(f)),
    commitment_options: bool(fd, "commitments_enabled")
      ? {
          per_person: centsList(str(fd, "commit_per_person"), "Per-person amounts"),
          lump_sum: centsList(str(fd, "commit_lump_sum"), "Lump-sum amounts"),
          open: bool(fd, "commit_open"),
        }
      : { per_person: [], lump_sum: [], open: false },
    lunch_enabled: lunchEnabled,
    lunch_starts_at: lunchStarts,
    lunch_slot_minutes: int(fd, "lunch_slot_minutes", "Slot length", { min: 5, max: 120 }) ?? 15,
    lunch_seats_per_slot: int(fd, "lunch_seats_per_slot", "Seats per slot", { min: 1 }),
    // Priority comes from Settings › Rules (read-only in the builder).
    lunch_priority_rules: { family_with_child_under_12_at_start: lunch.childAtStart, senior_at_start: lunch.seniorAtStart },
    is_paid: isPaid,
    member_price_cents: isPaid ? cents(fd, "member_price", "Member price") : null,
    guest_price_cents: isPaid ? cents(fd, "guest_price", "Guest price") : null,
    owner_person_id: str(fd, "owner_person_id"),
    confidential: bool(fd, "confidential"),
  };
}

/** Event builder: "Save draft" or "Publish event" (the submit button's `intent`). */
export async function saveEvent(eventId: string | null, _prev: Result | null, fd: FormData): Promise<Result> {
  const publish = str(fd, "intent") === "publish";
  const doing = publish ? "publish the event" : eventId ? "save the event" : "save the draft";
  return runAction("events.saveEvent", doing, async () => {
    const ctx = await eventActionContext(
      (a) => (eventId ? eventAreas.edit(a, eventId) : eventAreas.manage(a)),
      eventId ? "only event managers and this event's lead can edit it." : "only event managers can create events.",
    );
    if (publish && !can(ctx.access, "events.manage") && !eventId) throw new FormError("only event managers can publish events.");
    const values = eventValues(fd, ctx.tz, ctx.session.center.rules, publish);
    if (!eventId) {
      const created = must(
        await ctx.db
          .from("events")
          .insert({ ...values, center_id: ctx.centerId, created_by: ctx.userId, status: publish ? "published" : "draft" })
          .select("id")
          .single(),
        doing,
      );
      revalidateEvents();
      redirect(`/events/builder?event=${created!.id}&saved=${publish ? "published" : "draft"}`);
    }
    const current = must(await ctx.db.from("events").select("status").eq("id", eventId).maybeSingle(), "load the event");
    if (!current) throw new FormError("that event no longer exists, or you can't see it.");
    const patch: TablesUpdate<"events"> = { ...values };
    if (publish && current.status === "draft") patch.status = "published";
    const res = must(await ctx.db.from("events").update(patch).eq("id", eventId).select("id"), doing);
    if (!res?.length) throw new FormError("you can't edit this event.");
    revalidateEvents();
    if (publish) {
      return {
        ok: true,
        message: current.status === "draft" ? "Published · RSVPs open in the member app" : "Saved · the event was already published",
      };
    }
    return { ok: true, message: current.status === "draft" ? "Draft saved" : "Event saved" };
  });
}

const STATUS_MESSAGES: Record<(typeof EVENT_STATUSES)[number], string> = {
  draft: "Back to draft.",
  published: "Published · RSVPs open in the member app",
  rsvp_closed: "RSVPs closed.",
  live: "Event is live — check-in is open.",
  completed: "Marked completed.",
  cancelled: "Event cancelled.",
};

export async function setEventStatus(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.setEventStatus", "change the event status", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), "only event managers and this event's lead can change its status.");
    const status = oneOf(fd, "status", EVENT_STATUSES, "Status");
    const res = must(await db.from("events").update({ status }).eq("id", eventId).select("id"), "change the event status");
    if (!res?.length) throw new FormError("you can't change this event.");
    revalidateEvents();
    return { ok: true, message: STATUS_MESSAGES[status] };
  });
}

// ---------------------------------------------------------------------------
// RSVPs
// ---------------------------------------------------------------------------
export async function setRsvpStatus(eventId: string, rsvpId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.setRsvpStatus", "update the RSVP", async () => {
    const { db } = await eventActionContext((a) => eventAreas.rsvps(a, eventId), "only event staff can change RSVPs.");
    const status = oneOf(fd, "status", ["rsvpd", "confirmed", "cancelled", "waitlisted", "no_show"] as const, "Status");
    const now = new Date().toISOString();
    const patch: TablesUpdate<"rsvps"> = { status };
    if (status === "confirmed") patch.confirmed_at = now;
    if (status === "cancelled") patch.cancelled_at = now;
    const res = must(await db.from("rsvps").update(patch).eq("id", rsvpId).eq("event_id", eventId).select("id"), "update the RSVP");
    if (!res?.length) throw new FormError("you can't change this RSVP.");
    // Keep people who haven't arrived in step with their household's RSVP.
    must(await db.from("attendees").update({ status }).eq("rsvp_id", rsvpId).is("checked_in_at", null), "update the people on this RSVP");
    revalidateEvents();
    return { ok: true, message: `RSVP ${status === "rsvpd" ? "reopened" : status === "no_show" ? "marked no-show" : status}.` };
  });
}

export async function addGuestRsvp(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.addGuestRsvp", "add the RSVP", async () => {
    const { db, centerId } = await eventActionContext((a) => eventAreas.edit(a, eventId), "only event managers and this event's lead can add RSVPs.");
    const party = parsePartyLines(reqStr(fd, "party", "People"));
    if (!party.length) throw new FormError("add at least one person.");
    const phoneRaw = str(fd, "guest_phone");
    const phone = phoneRaw ? toE164(phoneRaw) : null;
    if (phoneRaw && !phone) throw new FormError("enter the phone number with area code, e.g. (713) 555-0198.");
    const confirmed = bool(fd, "confirmed");
    const rsvp = must(
      await db
        .from("rsvps")
        .insert({
          center_id: centerId,
          event_id: eventId,
          guest_name: str(fd, "guest_name") ?? party[0].name,
          guest_phone_e164: phone,
          guest_email: str(fd, "guest_email"),
          status: confirmed ? "confirmed" : "rsvpd",
          confirmed_at: confirmed ? new Date().toISOString() : null,
          source: "admin",
        })
        .select("id")
        .single(),
      "add the RSVP",
    );
    must(
      await db.from("attendees").insert(
        party.map((p) => ({
          center_id: centerId,
          event_id: eventId,
          rsvp_id: rsvp!.id,
          display_name: p.name,
          is_child_under_12: p.child_under_12,
          is_senior: p.senior,
          needs_assistance: p.assistance,
        })),
      ),
      "add the people on the RSVP",
    );
    revalidateEvents();
    return { ok: true, message: `RSVP added for ${party.length} ${party.length === 1 ? "person" : "people"}.` };
  });
}

// ---------------------------------------------------------------------------
// Volunteers
// ---------------------------------------------------------------------------
export async function createShift(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.createShift", "add the shift", async () => {
    const { db, centerId, tz } = await eventActionContext(
      (a) => eventAreas.volunteers(a, eventId),
      "only this event's lead or the volunteer coordinator can add shifts.",
    );
    const startsAt = dateTime(fd, "starts_at", "Shift start", tz);
    const endsAt = dateTime(fd, "ends_at", "Shift end", tz);
    if (startsAt && endsAt && endsAt <= startsAt) throw new FormError("the shift must end after it starts.");
    must(
      await db.from("volunteer_shifts").insert({
        center_id: centerId,
        event_id: eventId,
        station: oneOf(fd, "station", STATIONS, "Station"),
        starts_at: startsAt,
        ends_at: endsAt,
        capacity: int(fd, "capacity", "Volunteers needed", { min: 1 }),
        notes: str(fd, "notes"),
      }),
      "add the shift",
    );
    revalidateEvents();
    return { ok: true, message: "Shift added." };
  });
}

export async function deleteShift(eventId: string, shiftId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  void fd;
  return runAction("events.deleteShift", "remove the shift", async () => {
    const { db } = await eventActionContext((a) => eventAreas.volunteers(a, eventId), "only this event's lead or the volunteer coordinator can remove shifts.");
    const res = must(await db.from("volunteer_shifts").delete().eq("id", shiftId).eq("event_id", eventId).select("id"), "remove the shift");
    if (!res?.length) throw new FormError("you can't remove this shift.");
    revalidateEvents();
    return { ok: true, message: "Shift removed." };
  });
}

export async function assignVolunteer(eventId: string, shiftId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.assignVolunteer", "assign the volunteer", async () => {
    const { db, centerId } = await eventActionContext(
      (a) => eventAreas.volunteers(a, eventId),
      "only this event's lead or the volunteer coordinator can assign volunteers.",
    );
    const personIds = all(fd, "person_id");
    if (!personIds.length) throw new FormError("choose who to assign.");
    must(await db.from("volunteer_assignments").insert(personIds.map((person_id) => ({ center_id: centerId, shift_id: shiftId, person_id }))), "assign the volunteer");
    revalidateEvents();
    return { ok: true, message: personIds.length === 1 ? "Volunteer assigned." : `${personIds.length} volunteers assigned.` };
  });
}

export async function setAssignment(eventId: string, assignmentId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.setAssignment", "update the assignment", async () => {
    const { db } = await eventActionContext(
      (a) => eventAreas.volunteers(a, eventId),
      "only this event's lead or the volunteer coordinator can change assignments.",
    );
    if (str(fd, "status") === "remove") {
      const res = must(await db.from("volunteer_assignments").delete().eq("id", assignmentId).select("id"), "remove the assignment");
      if (!res?.length) throw new FormError("you can't remove this assignment.");
      revalidateEvents();
      return { ok: true, message: "Removed." };
    }
    const s = oneOf(fd, "status", ["assigned", "confirmed", "declined", "no_show", "completed"] as const, "Status");
    const res = must(await db.from("volunteer_assignments").update({ status: s }).eq("id", assignmentId).select("id"), "update the assignment");
    if (!res?.length) throw new FormError("you can't change this assignment.");
    revalidateEvents();
    return { ok: true, message: "Updated." };
  });
}

/** Give an assigned volunteer the event-scoped role (check-in, kitchen…) so the ops screens open for them. */
export async function grantEventRole(eventId: string, personId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.grantEventRole", "grant event access", async () => {
    const { db, centerId, userId } = await eventActionContext(
      (a) => eventAreas.grantRoles(a),
      "only a center admin can grant access. Ask them to give this volunteer the role for this event.",
    );
    const role = oneOf(fd, "role", ["checkin_volunteer", "kitchen_lead", "boli_recorder", "event_lead"] as const, "Role");
    const cu = must(await db.from("center_users").select("user_id").eq("center_id", centerId).eq("person_id", personId).maybeSingle(), "find their login");
    if (!cu) throw new FormError("this person hasn't signed in to the app yet, so there's no login to give access to.");
    const existing = must(
      await db.from("role_grants").select("id").eq("center_id", centerId).eq("user_id", cu.user_id).eq("role_key", role).eq("scope_id", eventId).is("ends_at", null),
      "check existing access",
    );
    if (existing?.length) return { ok: true, message: "They already have this access." };
    must(
      await db.from("role_grants").insert({
        center_id: centerId,
        user_id: cu.user_id,
        role_key: role,
        scope_kind: "event",
        scope_id: eventId,
        granted_by: userId,
        reason: "Event volunteer",
      }),
      "grant event access",
    );
    revalidateEvents();
    return { ok: true, message: "Access granted for this event." };
  });
}

// ---------------------------------------------------------------------------
// Lunch slots
// ---------------------------------------------------------------------------
export async function generateLunchSlots(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  void fd;
  return runAction("events.generateLunchSlots", "create the lunch slots", async () => {
    const { db, centerId } = await eventActionContext((a) => eventAreas.runLunch(a, eventId), "only this event's lead or kitchen lead can set up lunch slots.");
    const e = must(
      await db.from("events").select("lunch_enabled, lunch_starts_at, ends_at, lunch_slot_minutes, lunch_seats_per_slot").eq("id", eventId).maybeSingle(),
      "load the event",
    );
    if (!e) throw new FormError("that event no longer exists.");
    if (!e.lunch_enabled || !e.lunch_starts_at) throw new FormError("turn on lunch slots and set the lunch start time in the event builder first.");
    const existing = must(await db.from("lunch_slots").select("id").eq("event_id", eventId).limit(1), "check existing slots");
    if (existing?.length) throw new FormError("slots already exist for this event.");
    const plan = planLunchSlots({ lunchStartsAt: e.lunch_starts_at, eventEndsAt: e.ends_at, slotMinutes: e.lunch_slot_minutes, seatsPerSlot: e.lunch_seats_per_slot });
    if (!plan.length) throw new FormError("no slots fit between lunch start and the end of the event. Check the times.");
    must(await db.from("lunch_slots").insert(plan.map((p) => ({ ...p, center_id: centerId, event_id: eventId }))), "create the lunch slots");
    revalidateEvents();
    return { ok: true, message: `${plan.length} slots created.` };
  });
}

export async function setSlotStatus(eventId: string, slotId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.setSlotStatus", "update the lunch slot", async () => {
    const { db } = await eventActionContext((a) => eventAreas.runLunch(a, eventId), "only this event's lead or kitchen lead can run lunch.");
    const status = oneOf(fd, "status", ["scheduled", "now_serving", "done"] as const, "Status");
    if (status === "now_serving") {
      // One slot is served at a time: the previous one is done.
      must(
        await db.from("lunch_slots").update({ status: "done" }).eq("event_id", eventId).eq("status", "now_serving").neq("id", slotId),
        "finish the previous slot",
      );
    }
    const res = must(await db.from("lunch_slots").update({ status }).eq("id", slotId).eq("event_id", eventId).select("id"), "update the lunch slot");
    if (!res?.length) throw new FormError("you can't change this slot.");
    revalidateEvents();
    return { ok: true, message: status === "now_serving" ? "Now serving." : status === "done" ? "Slot done." : "Slot reset." };
  });
}

export async function updateSlotSeats(eventId: string, slotId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.updateSlotSeats", "change the seats", async () => {
    const { db } = await eventActionContext((a) => eventAreas.runLunch(a, eventId), "only this event's lead or kitchen lead can change seats.");
    const seats = int(fd, "seats", "Seats", { min: 0 });
    if (seats === null) throw new FormError("enter the number of seats.");
    const res = must(await db.from("lunch_slots").update({ seats }).eq("id", slotId).eq("event_id", eventId).select("id"), "change the seats");
    if (!res?.length) throw new FormError("you can't change this slot.");
    revalidateEvents();
    return { ok: true, message: "Seats updated." };
  });
}

// ---------------------------------------------------------------------------
// Checklist (actions with event_id) and lessons learned
// ---------------------------------------------------------------------------
const ACTION_STATES = ["not_started", "in_progress", "completed", "removed"] as const;

export async function setChecklistState(eventId: string, actionId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.setChecklistState", "update the action", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), "only event managers and this event's lead can change the checklist.");
    const state = oneOf(fd, "state", ACTION_STATES, "State");
    const res = must(await db.from("actions").update({ state }).eq("id", actionId).eq("event_id", eventId).select("id"), "update the action");
    if (!res?.length) throw new FormError("you can't change this action.");
    revalidateEvents();
    return { ok: true, message: state === "completed" ? "Marked done." : state === "in_progress" ? "Marked in progress." : "Updated." };
  });
}

export async function addChecklistAction(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.addChecklistAction", "add the action", async () => {
    const { db, centerId, userId } = await eventActionContext((a) => eventAreas.edit(a, eventId), "only event managers and this event's lead can add actions.");
    const phase = oneOf(fd, "phase", ["pre", "during", "after"] as const, "Phase", "pre");
    must(
      await db.from("actions").insert({
        center_id: centerId,
        event_id: eventId,
        phase,
        name: reqStr(fd, "name", "Action"),
        description: str(fd, "description"),
        owner_person_id: str(fd, "owner_person_id"),
        // "During" actions take the event date from the database trigger.
        due_on: phase === "during" ? null : isoDate(fd, "due_on", "Due date"),
        priority: oneOf(fd, "priority", ["low", "medium", "high", "critical"] as const, "Priority", "medium"),
        created_by: userId,
      }),
      "add the action",
    );
    revalidateEvents();
    return { ok: true, message: "Action added." };
  });
}

type Lesson = { id: string; text: string; author: string; created_at: string };

function lessonList(v: unknown): Lesson[] {
  return Array.isArray(v) ? (v as Lesson[]).filter((l) => l && typeof l === "object" && typeof l.id === "string") : [];
}

export async function addLesson(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.addLesson", "save the lesson", async () => {
    const { db, session } = await eventActionContext((a) => eventAreas.edit(a, eventId), "only event managers and this event's lead can add lessons.");
    const text = reqStr(fd, "text", "Lesson");
    const current = must(await db.from("events").select("lessons_learned").eq("id", eventId).maybeSingle(), "load lessons learned");
    if (!current) throw new FormError("that event no longer exists or you can't see it.");
    const author = session.person?.name ?? session.email ?? "Staff";
    const next = [...lessonList(current.lessons_learned), { id: randomToken(8), text, author, created_at: new Date().toISOString() }];
    const res = must(await db.from("events").update({ lessons_learned: next }).eq("id", eventId).select("id"), "save the lesson");
    if (!res?.length) throw new FormError("you can't edit this event.");
    revalidateEvents();
    return { ok: true, message: "Lesson added." };
  });
}

export async function removeLesson(eventId: string, lessonId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  void fd;
  return runAction("events.removeLesson", "remove the lesson", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), "only event managers and this event's lead can remove lessons.");
    const current = must(await db.from("events").select("lessons_learned").eq("id", eventId).maybeSingle(), "load lessons learned");
    if (!current) throw new FormError("that event no longer exists or you can't see it.");
    const next = lessonList(current.lessons_learned).filter((l) => l.id !== lessonId);
    const res = must(await db.from("events").update({ lessons_learned: next }).eq("id", eventId).select("id"), "remove the lesson");
    if (!res?.length) throw new FormError("you can't edit this event.");
    revalidateEvents();
    return { ok: true, message: "Lesson removed." };
  });
}

/** Merge an event's lessons learned into its template (same id overwrites, new ones append). */
export async function pushLessonsToTemplate(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  void fd;
  return runAction("events.pushLessonsToTemplate", "copy lessons to the template", async () => {
    const { db } = await eventActionContext((a) => eventAreas.manage(a), "only committee members who manage events can change templates.");
    const event = must(await db.from("events").select("template_id, lessons_learned").eq("id", eventId).maybeSingle(), "load the event");
    if (!event?.template_id) throw new FormError("this event wasn't created from a template.");
    const template = must(await db.from("event_templates").select("lessons_learned").eq("id", event.template_id).maybeSingle(), "load the template");
    if (!template) throw new FormError("the template no longer exists.");
    const merged = new Map(lessonList(template.lessons_learned).map((l) => [l.id, l]));
    for (const l of lessonList(event.lessons_learned)) merged.set(l.id, l);
    const list = [...merged.values()];
    must(await db.from("event_templates").update({ lessons_learned: list }).eq("id", event.template_id), "save the template lessons");
    revalidateEvents();
    return { ok: true, message: `Template now has ${list.length} lesson${list.length === 1 ? "" : "s"}.` };
  });
}
