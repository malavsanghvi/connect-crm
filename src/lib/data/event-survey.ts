import "server-only";

import type { Tables } from "@/lib/database.types";
import { LoadError, rows } from "@/lib/data/events";
import { explainError } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";
import { templateOptions, type TemplateOption } from "@/lib/survey/event-survey";
import { parseSurveyStats, type SurveyStats } from "@/lib/survey/results";

// The survey attached to an event (app.surveys, kind event_feedback, event_id set; migrations 0544 and 0547).
// Every read runs as the signed-in user, so RLS decides what comes back: event managers and leads read their
// event's survey through surveys_event_manager_read, communications staff through the staff policies.

export type EventSurvey = Tables<"surveys">;

/** The audience numbers for one survey (app.event_survey_stats): invited adults, answers, completions, points. */
export async function loadSurveyStats(db: AppSupabase, surveyId: string): Promise<SurveyStats> {
  const res = await db.rpc("event_survey_stats", { p_survey: surveyId });
  if (res.error) {
    console.error("[survey] loading the survey numbers failed:", res.error);
    throw new LoadError(`Could not load the survey numbers — ${explainError(res.error)}`);
  }
  const stats = parseSurveyStats(res.data);
  if (!stats) {
    console.error("[survey] the survey numbers came back in an unexpected shape:", res.data);
    throw new LoadError("Could not load the survey numbers — the database returned something unexpected");
  }
  return stats;
}

export type EventSurveyTabData = {
  /** The event's survey; null when none is attached. */
  survey: EventSurvey | null;
  /** Saved survey templates to attach (empty once a survey is attached). */
  templates: TemplateOption[];
  /** Audience numbers; null when there is no survey. */
  stats: SurveyStats | null;
};

export async function loadEventSurveyTab(db: AppSupabase, centerId: string, eventId: string): Promise<EventSurveyTabData> {
  const found = rows(
    await db
      .from("surveys")
      .select("*")
      .eq("center_id", centerId)
      .eq("event_id", eventId)
      .eq("kind", "event_feedback")
      .order("created_at", { ascending: false })
      .limit(1),
    "this event's survey",
  );
  const survey = found[0] ?? null;
  if (survey) return { survey, templates: [], stats: await loadSurveyStats(db, survey.id) };
  const templates = rows(
    await db
      .from("surveys")
      .select("id, title, questions, anonymous")
      .eq("center_id", centerId)
      .eq("kind", "event_feedback")
      .is("event_id", null)
      .order("created_at", { ascending: true }),
    "the saved surveys",
  );
  return { survey: null, templates: templateOptions(templates), stats: null };
}
