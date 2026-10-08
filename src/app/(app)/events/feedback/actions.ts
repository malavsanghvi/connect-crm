"use server";

import { revalidatePath } from "next/cache";

import { eventActionContext } from "@/lib/data/events";
import { templateFrom, writeSurvey } from "@/lib/data/event-feedback";
import { readSurveyNotices } from "@/lib/data/event-survey";
import type { ActionResult } from "@/lib/errors";
import { eventAreas, type EventAccess } from "@/lib/events/access";
import { bool, dateTime, DbFailure, FormError, must, oneOf, reqStr, runAction, str } from "@/lib/events/forms";
import { can } from "@/lib/permissions";
import { feedbackRequestMessage, feedbackRequestUnreadMessage, requestWentNow } from "@/lib/survey/event-survey";
import {
  FEEDBACK_OPEN_DAYS,
  FEEDBACK_TEMPLATE_KEY,
  SEND_TIMINGS,
  addDaysIso,
  feedbackSendAt,
  shortWhen,
} from "@/lib/survey/feedback";
import { validateQuestionsJson } from "@/lib/survey/questions";

type Result = ActionResult<unknown>;

// Surveys are written under the surveys RLS policy, which needs comms.send.
const canSend = (a: EventAccess) => can(a, "comms.send") && eventAreas.view(a);
const DENIED = "sending feedback surveys needs the communications permission (comms.send) as well as Events access. Ask your center admin.";

const TIMING_KEYS = SEND_TIMINGS.map((t) => t.key);

function revalidateFeedback() {
  revalidatePath("/events/feedback", "layout");
}

/** "Request feedback": a survey for the event's checked-in attendees, from the standard template, scheduled per the template. */
export async function requestFeedback(_prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.requestFeedback", "schedule the feedback request", async () => {
    const { db, centerId, tz, userId } = await eventActionContext(canSend, DENIED);
    const eventId = reqStr(fd, "event_id", "Event");
    const event = (must(await db.from("events").select("id, name, starts_at, ends_at, status").eq("id", eventId).limit(1), "load the event") ?? [])[0];
    if (!event) throw new FormError("that event no longer exists, or you can't see it.");
    const existing =
      must(
        await db.from("surveys").select("id, status").eq("center_id", centerId).eq("kind", "event_feedback").eq("event_id", eventId).limit(1),
        "check for an existing feedback survey",
      ) ?? [];
    // An event has one survey. The event's Survey tab is where it is attached, edited and launched.
    if (existing.length) {
      throw new FormError(`the event "${event.name}" already has a survey, so a second one was not created. Open the event and use its Survey tab to see or change it.`);
    }
    const templateRow = (
      must(
        await db.from("surveys").select("*").eq("center_id", centerId).eq("kind", "event_feedback").is("event_id", null).limit(1),
        "load the feedback template",
      ) ?? []
    )[0];
    const template = templateFrom(templateRow ?? null);
    const sendAt = feedbackSendAt(template.settings.sendTiming, event.ends_at ?? event.starts_at, tz);
    // The database (0596) schedules the pushes for the send time: one background job then queues each invited adult's
    // push and a reminder on day 1 and day 2 after it, until they answer. There is no other reminder choice.
    const res = await writeSurvey(
      db,
      {
        insert: {
          center_id: centerId,
          title: `${event.name} · feedback`,
          description: "Tell us how it went. You can answer anonymously.",
          questions: template.questions,
          // Checked-in attendees: check-in marks their RSVP "attended".
          audience: { event_id: event.id, rsvp_statuses: ["attended"] },
          anonymous: !template.settings.anonymousAllowed,
          // Open (members see it in the app) from the send time; answers close after two weeks.
          status: "open",
          opens_at: sendAt,
          closes_at: addDaysIso(sendAt, FEEDBACK_OPEN_DAYS),
          event_id: event.id,
          kind: "event_feedback",
          created_by: userId,
        },
      },
      { send_at: sendAt, reminder_after_days: null, template_key: FEEDBACK_TEMPLATE_KEY },
    );
    if (res.error) throw new DbFailure(res.error, "save the survey");
    revalidateFeedback();
    if (!res.extrasStored) {
      return {
        ok: true,
        message: `Feedback request scheduled for ${shortWhen(sendAt, tz)}: it opens in the member app then. Its pushes need the latest database update, so none are scheduled yet.`,
      };
    }
    // One rule for "now", the database's (0598): a send time that is not in the future goes at once, and the counts are
    // taken when the request is saved; a later one is counted when it goes. The page does not guess from the clock (a
    // 60-second window here used to call a request "sent" that the database had scheduled): it reads what the database did.
    const read = res.id ? await readSurveyNotices(db, res.id) : ({ ok: true, notices: null } as const);
    if (!read.ok) return { ok: true, message: feedbackRequestUnreadMessage(shortWhen(sendAt, tz)) };
    return { ok: true, message: feedbackRequestMessage(shortWhen(sendAt, tz), read.notices, requestWentNow(read.notices)) };
  });
}

/** Save the standard event feedback survey template (questions, anonymity, timing, reminder). */
export async function saveFeedbackTemplate(templateId: string | null, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.saveFeedbackTemplate", "save the survey template", async () => {
    const { db, centerId, userId } = await eventActionContext(canSend, DENIED);
    const parsed = validateQuestionsJson(str(fd, "questions"));
    if (!parsed.ok) throw new FormError(parsed.error);
    const timing = oneOf(fd, "send_timing", TIMING_KEYS, "When to send", "next_morning");
    // Reminders are fixed (0596): day 1 and day 2 after each person's push, until they answer.
    const reminder = null;
    const anonymousAllowed = bool(fd, "anonymous_allowed");
    const values = {
      title: "Event feedback survey template",
      description: "Standard questions sent after each event.",
      questions: parsed.questions,
      // The template is never shown to members (status draft); its audience also keeps the timing settings.
      audience: { rsvp_statuses: ["attended"], send_timing: timing, reminder_after_days: reminder },
      anonymous: !anonymousAllowed,
      kind: "event_feedback",
      status: "draft",
    };
    const res = templateId
      ? await writeSurvey(db, { update: values, id: templateId }, { reminder_after_days: reminder, template_key: FEEDBACK_TEMPLATE_KEY })
      : await writeSurvey(
          db,
          { insert: { ...values, center_id: centerId, created_by: userId, event_id: null } },
          { reminder_after_days: reminder, template_key: FEEDBACK_TEMPLATE_KEY },
        );
    if (res.error) throw new DbFailure(res.error, "save the survey template");
    revalidateFeedback();
    return { ok: true, message: "Event feedback survey template · saved" };
  });
}

/** Edit one feedback survey (title, intro, questions, window, anonymity). */
export async function saveSurvey(surveyId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.saveSurvey", "save the survey", async () => {
    const { db, tz } = await eventActionContext(canSend, DENIED);
    const parsed = validateQuestionsJson(str(fd, "questions"));
    if (!parsed.ok) throw new FormError(parsed.error);
    const opens = dateTime(fd, "opens_at", "Opens", tz);
    const closes = dateTime(fd, "closes_at", "Closes", tz);
    if (opens && closes && closes <= opens) throw new FormError("the survey must close after it opens.");
    const res = await writeSurvey(
      db,
      {
        update: {
          title: reqStr(fd, "title", "Title"),
          description: str(fd, "description"),
          questions: parsed.questions,
          anonymous: bool(fd, "anonymous"),
          opens_at: opens,
          closes_at: closes,
        },
        id: surveyId,
      },
      { send_at: opens },
    );
    if (res.error) throw new DbFailure(res.error, "save the survey");
    revalidateFeedback();
    return { ok: true, message: "Survey saved." };
  });
}

export async function setSurveyStatus(surveyId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.setSurveyStatus", "update the survey", async () => {
    const { db } = await eventActionContext(canSend, DENIED);
    const status = oneOf(fd, "status", ["draft", "open", "closed"] as const, "Status");
    const patch: { status: string; opens_at?: string; send_at?: string } = { status };
    // "Open now" on a scheduled survey opens (and sends) it immediately, so the Sent column is truthful.
    if (status === "open" && str(fd, "now") === "1") patch.opens_at = patch.send_at = new Date().toISOString();
    const res = must(await db.from("surveys").update(patch).eq("id", surveyId).select("id"), "update the survey") ?? [];
    if (!res.length) throw new FormError("you can't change this survey.");
    revalidateFeedback();
    return { ok: true, message: status === "open" ? "Survey is open in the member app." : status === "closed" ? "Survey closed." : "Back to draft." };
  });
}
