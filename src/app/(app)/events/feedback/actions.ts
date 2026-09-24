"use server";

import { revalidatePath } from "next/cache";

import { eventActionContext } from "@/lib/data/events";
import { templateFrom, writeSurvey } from "@/lib/data/event-feedback";
import type { ActionResult } from "@/lib/errors";
import { eventAreas, type EventAccess } from "@/lib/events/access";
import { bool, dateTime, DbFailure, FormError, must, oneOf, reqStr, runAction, str } from "@/lib/events/forms";
import { can } from "@/lib/permissions";
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
    if (existing.length) throw new FormError(`${event.name} already has a feedback survey. Open it from the Surveys table.`);
    const templateRow = (
      must(
        await db.from("surveys").select("*").eq("center_id", centerId).eq("kind", "event_feedback").is("event_id", null).limit(1),
        "load the feedback template",
      ) ?? []
    )[0];
    const template = templateFrom(templateRow ?? null);
    const sendAt = feedbackSendAt(template.settings.sendTiming, event.ends_at ?? event.starts_at, tz);
    const reminderAt = template.settings.reminderAfterDays ? addDaysIso(sendAt, template.settings.reminderAfterDays) : null;
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
      { send_at: sendAt, reminder_after_days: template.settings.reminderAfterDays, template_key: FEEDBACK_TEMPLATE_KEY },
    );
    if (res.error) throw new DbFailure(res.error, "save the survey");
    revalidateFeedback();
    const when = `Feedback request scheduled for ${shortWhen(sendAt, tz)}`;
    if (!res.extrasStored) {
      return {
        ok: true,
        message: `${when} — it opens in the member app then. The push notification and reminder need the latest database update, so they are not scheduled yet.`,
      };
    }
    return { ok: true, message: reminderAt ? `${when} · reminder ${shortWhen(reminderAt, tz, false)}` : when };
  });
}

/** Save the standard event feedback survey template (questions, anonymity, timing, reminder). */
export async function saveFeedbackTemplate(templateId: string | null, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.saveFeedbackTemplate", "save the survey template", async () => {
    const { db, centerId, userId } = await eventActionContext(canSend, DENIED);
    const parsed = validateQuestionsJson(str(fd, "questions"));
    if (!parsed.ok) throw new FormError(parsed.error);
    const timing = oneOf(fd, "send_timing", TIMING_KEYS, "When to send", "next_morning");
    const reminder = str(fd, "reminder") === "after_3_days" ? 3 : null;
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
