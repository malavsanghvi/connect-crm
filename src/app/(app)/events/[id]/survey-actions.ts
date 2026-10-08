"use server";

import { revalidatePath } from "next/cache";

import { readSurveyNotices } from "@/lib/data/event-survey";
import { eventActionContext } from "@/lib/data/events";
import type { Json } from "@/lib/database.types";
import type { ActionResult } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { bool, FormError, int, must, oneOf, runAction, str } from "@/lib/events/forms";
import { isUuid } from "@/lib/search-params";
import { parseSurveyNotices, surveySentMessage } from "@/lib/survey/event-survey";
import { validateQuestionsJson } from "@/lib/survey/questions";

// The event's Survey tab. Each action calls one database function (migrations 0544, 0547 and 0596) that re-checks
// who may do it (events.manage, or this event's lead) and whether the survey is still an unsent draft. The
// checks here only give a plain-English answer before the round trip.

type Result = ActionResult<unknown>;

const DENIED = "only event managers and this event's lead can change its survey.";

function revalidateSurveys() {
  // The event page (Survey tab) and Event feedback both read the survey.
  revalidatePath("/events", "layout");
}

function surveyId(id: string): string {
  if (!isUuid(id)) throw new FormError("that survey link is not valid. Reload the page and try again.");
  return id;
}

/** The settings shared by the attach and edit forms. */
function settings(fd: FormData) {
  return {
    title: str(fd, "title"),
    points: int(fd, "points", "Points", { min: 0, max: 1000 }) ?? 0,
    // "always" = no names are stored; "choose" = each member decides in the app.
    anonymous: oneOf(fd, "anonymity", ["choose", "always"] as const, "Anonymity", "choose") === "always",
    auto: bool(fd, "auto"),
  };
}

export async function attachEventSurvey(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.attachSurvey", "attach the survey", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), DENIED);
    const mode = oneOf(fd, "mode", ["template", "new"] as const, "Survey source");
    const s = settings(fd);
    let source: { p_template: string } | { p_questions: Json };
    if (mode === "template") {
      const template = str(fd, "template_id");
      if (!template || !isUuid(template)) throw new FormError("choose a saved survey, or write a new one.");
      source = { p_template: template };
    } else {
      const parsed = validateQuestionsJson(str(fd, "questions"));
      if (!parsed.ok) throw new FormError(parsed.error);
      source = { p_questions: parsed.questions as unknown as Json };
    }
    const event = (must(await db.from("events").select("status").eq("id", eventId).limit(1), "load the event") ?? [])[0];
    if (!event) throw new FormError("that event no longer exists, or you can't see it.");
    const attached = must(
      await db.rpc("attach_event_survey", {
        p_event: eventId,
        ...source,
        ...(s.title ? { p_title: s.title } : {}),
        p_points: s.points,
        p_auto: s.auto,
        p_anonymous: s.anonymous,
      }),
      "attach the survey",
    );
    revalidateSurveys();
    if (event.status === "completed" && s.auto) {
      // Sent at once (0596): the counts were taken in the database; when they cannot be read the message says so.
      const read = typeof attached === "string" ? await readSurveyNotices(db, attached) : ({ ok: false } as const);
      return { ok: true, message: surveySentMessage(read.ok ? read.notices : null, "Survey attached and sent") };
    }
    if (s.auto) return { ok: true, message: "Survey attached. It opens by itself when the event is marked completed." };
    return { ok: true, message: "Survey attached. It will not be sent by itself; send it from here once the event is completed." };
  });
}

export async function updateEventSurvey(eventId: string, id: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.updateSurvey", "save the survey", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), DENIED);
    const parsed = validateQuestionsJson(str(fd, "questions"));
    if (!parsed.ok) throw new FormError(parsed.error);
    const s = settings(fd);
    must(
      await db.rpc("update_event_survey", {
        p_survey: surveyId(id),
        ...(s.title ? { p_title: s.title } : {}),
        p_questions: parsed.questions as unknown as Json,
        p_points: s.points,
        p_auto: s.auto,
        p_anonymous: s.anonymous,
      }),
      "save the survey",
    );
    revalidateSurveys();
    return { ok: true, message: "Survey saved." };
  });
}

export async function removeEventSurvey(eventId: string, id: string, _prev: Result | null, fd: FormData): Promise<Result> {
  void fd;
  return runAction("events.removeSurvey", "remove the survey", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), DENIED);
    must(await db.rpc("remove_event_survey", { p_survey: surveyId(id) }), "remove the survey");
    revalidateSurveys();
    return { ok: true, message: "Survey removed from the event." };
  });
}

export async function launchEventSurvey(eventId: string, id: string, _prev: Result | null, fd: FormData): Promise<Result> {
  void fd;
  return runAction("events.launchSurvey", "send the survey", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), DENIED);
    // What would stop every push (a community template asking for a value a survey push does not have) is refused by
    // the database in a sentence: "Could not send the survey — …". Otherwise it returns the counts at once (0596); the
    // pushes themselves are queued by the background service.
    const res = await db.rpc("launch_event_survey_now", { p_survey: surveyId(id) });
    must(res, "send the survey");
    revalidateSurveys();
    const notices = parseSurveyNotices(res.data);
    if (!notices) console.error("[events] events.launchSurvey: the survey was sent, but its counts came back in an unexpected shape:", res.data);
    return { ok: true, message: surveySentMessage(notices) };
  });
}
