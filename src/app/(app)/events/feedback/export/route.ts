import { NextResponse, type NextRequest } from "next/server";

import { explainError, isStepUpError } from "@/lib/errors";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { loadSession } from "@/lib/session";
import { aggregateFeedback, feedbackCsv } from "@/lib/survey/feedback";
import { parseQuestions } from "@/lib/survey/questions";

function problem(message: string, status: number) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** CSV of one feedback survey: combined totals and anonymized comments. */
export async function GET(request: NextRequest) {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not export the results — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not export the results — the app could not load your session.", 500);
  const session = state.session;
  if (!canAccess(session, "eventFeedbackRead")) return problem("Could not export the results — you don't have access to feedback surveys.", 403);
  const surveyId = request.nextUrl.searchParams.get("survey");
  if (!isUuid(surveyId)) return problem("Could not export the results — choose a survey first.", 400);

  const { db } = session;
  const s = await db.from("surveys").select("id, title, questions, event_id").eq("id", surveyId).maybeSingle();
  if (s.error) {
    console.error("[feedback export] survey read failed:", s.error);
    return problem(`Could not export the results — ${explainError(s.error)}.`, 500);
  }
  if (!s.data) return problem("Could not export the results — that survey was not found, or you can't see it.", 404);
  const [responses, attendees] = await Promise.all([
    db.from("survey_responses").select("person_id, answers, submitted_at").eq("survey_id", surveyId).limit(10000),
    s.data.event_id
      ? db.from("attendees").select("id", { count: "exact", head: true }).eq("event_id", s.data.event_id).not("checked_in_at", "is", null)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (responses.error || attendees.error) {
    console.error("[feedback export] responses read failed:", responses.error ?? attendees.error);
    return problem(`Could not export the results — ${explainError(responses.error ?? attendees.error)}.`, 500);
  }
  // Exports need a fresh 2FA check and are audited (app.record_export, 0154): counts only, never the data.
  const recorded = await db.rpc("record_export", {
    p_center: session.center.id,
    p_kind: "event_feedback",
    p_detail: { survey_id: s.data.id, responses: (responses.data ?? []).length },
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
  const results = aggregateFeedback(parseQuestions(s.data.questions), responses.data ?? [], attendees.count ?? 0);
  const csv = feedbackCsv(s.data.title, results);
  const file = s.data.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "feedback";
  return new NextResponse(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}-results.csv"` },
  });
}
