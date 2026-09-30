import { NextResponse, type NextRequest } from "next/server";

import { loadSurveyStats } from "@/lib/data/event-survey";
import { LoadError, loadEventAccess } from "@/lib/data/events";
import { fetchAll } from "@/lib/data/fetch-all";
import { explainError, isStepUpError } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { loadSession } from "@/lib/session";
import { aggregateFeedback, commentQuestionId, feedbackCsv } from "@/lib/survey/feedback";
import { parseQuestions } from "@/lib/survey/questions";
import { responsesByDay, summarizeQuestions } from "@/lib/survey/results";

function problem(message: string, status: number) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * CSV of one feedback survey: the audience numbers, combined totals, results for every question, responses by day
 * and anonymized comments. Open to communications staff and to the manager or lead of the survey's event.
 */
export async function GET(request: NextRequest) {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not export the results — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not export the results — the app could not load your session.", 500);
  const session = state.session;
  const surveyId = request.nextUrl.searchParams.get("survey");
  if (!isUuid(surveyId)) return problem("Could not export the results — choose a survey first.", 400);

  const { db } = session;
  const s = await db.from("surveys").select("id, title, questions, event_id, anonymous").eq("id", surveyId).maybeSingle();
  if (s.error) {
    console.error("[feedback export] survey read failed:", s.error);
    return problem(`Could not export the results — ${explainError(s.error)}.`, 500);
  }
  // Communications staff read every survey; an event's manager or lead reads their event's (app.manages_event_surveys).
  const commsRead = canAccess(session, "eventFeedbackRead");
  const managesEvent = !commsRead && s.data?.event_id ? eventAreas.edit(await loadEventAccess(session), s.data.event_id) : false;
  if (!commsRead && !managesEvent) return problem("Could not export the results — you don't have access to this survey's results.", 403);
  if (!s.data) return problem("Could not export the results — that survey was not found, or you can't see it.", 404);

  const responses = await fetchAll<{ person_id: string | null; answers: unknown; submitted_at: string }>((from, to) =>
    db.from("survey_responses").select("person_id, answers, submitted_at").eq("survey_id", surveyId).order("id").range(from, to),
  );
  if (responses.error) {
    console.error("[feedback export] responses read failed:", responses.error);
    return problem(`Could not export the results — ${explainError(responses.error)}.`, 500);
  }
  if (responses.truncated) {
    console.error(`[feedback export] survey ${surveyId} has more responses than one export holds (${responses.data.length} read)`);
    return problem(`Could not export the results — this survey has more than ${responses.data.length} responses, which is more than one export holds. Ask for help.`, 500);
  }
  let stats;
  try {
    stats = await loadSurveyStats(db, surveyId);
  } catch (error) {
    console.error("[feedback export] audience numbers failed:", error);
    const why = error instanceof LoadError ? error.friendly : `Could not load the survey numbers — ${explainError(error)}`;
    return problem(`Could not export the results. ${why}.`, 500);
  }
  // Exports need a fresh 2FA check and are audited (app.record_export, 0154): counts only, never the data.
  const recorded = await db.rpc("record_export", {
    p_center: session.center.id,
    p_kind: "event_feedback",
    p_detail: { survey_id: s.data.id, responses: responses.data.length },
  });
  if (recorded.error) {
    if (isStepUpError(recorded.error)) {
      return new NextResponse("Could not export the results — this needs a fresh 2FA check.\n", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8", "x-step-up": "required" },
      });
    }
    console.error("[feedback export] record_export failed:", recorded.error);
    return problem(`Could not export the results — ${explainError(recorded.error)}.`, 500);
  }
  // Never pass names: the export is anonymized.
  const questions = parseQuestions(s.data.questions);
  const results = aggregateFeedback(questions, responses.data, stats.invited);
  const csv = feedbackCsv(s.data.title, results, {
    stats,
    questions: summarizeQuestions(questions, responses.data, { alwaysAnonymous: true }),
    byDay: responsesByDay(responses.data, session.center.time_zone),
    commentQuestion: commentQuestionId(questions),
  });
  const file = s.data.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "feedback";
  return new NextResponse(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}-results.csv"` },
  });
}
