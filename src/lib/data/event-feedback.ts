import "server-only";

import type { Json, Tables, TablesInsert } from "@/lib/database.types";
import { allRows, rows } from "@/lib/data/events";
import type { AppSupabase } from "@/lib/supabase/server";
import {
  DEFAULT_TEMPLATE_SETTINGS,
  SEND_TIMINGS,
  standardFeedbackQuestions,
  type FeedbackTemplateSettings,
  type SendTiming,
} from "@/lib/survey/feedback";
import { parseQuestions, type SurveyQuestion } from "@/lib/survey/questions";

// Event feedback surveys are app.surveys rows with kind = 'event_feedback'.
// The standard template is the one such row with no event_id.
//
// The schema stream is adding surveys.send_at, reminder_after_days and
// template_key. Until they exist, writes try them and fall back without
// them (writeSurvey below), and reads take the schedule from opens_at and
// the template settings from the template row's audience JSON.

export type SurveyRow = Tables<"surveys">;

/** Columns the schema stream is adding; read defensively (they are not in the generated types yet). */
export function surveyExtras(s: SurveyRow): { sendAt: string | null; reminderAfterDays: number | null; templateKey: string | null } {
  const r = s as unknown as Record<string, unknown>;
  return {
    sendAt: typeof r.send_at === "string" ? r.send_at : null,
    reminderAfterDays: typeof r.reminder_after_days === "number" ? r.reminder_after_days : null,
    templateKey: typeof r.template_key === "string" ? r.template_key : null,
  };
}

/** The template row has no event; surveys made from it carry template_key = "event_feedback" and their event_id. */
function isTemplate(s: SurveyRow): boolean {
  return s.kind === "event_feedback" && s.event_id === null;
}

export type FeedbackTemplate = { id: string | null; questions: SurveyQuestion[]; settings: FeedbackTemplateSettings };

export function templateFrom(row: SurveyRow | null): FeedbackTemplate {
  if (!row) return { id: null, questions: standardFeedbackQuestions(), settings: DEFAULT_TEMPLATE_SETTINGS };
  const a = row.audience && typeof row.audience === "object" && !Array.isArray(row.audience) ? (row.audience as Record<string, unknown>) : {};
  const timing = SEND_TIMINGS.some((t) => t.key === a.send_timing) ? (a.send_timing as SendTiming) : DEFAULT_TEMPLATE_SETTINGS.sendTiming;
  const extras = surveyExtras(row);
  const reminder =
    extras.reminderAfterDays !== null
      ? extras.reminderAfterDays
      : typeof a.reminder_after_days === "number"
        ? a.reminder_after_days
        : a.reminder_after_days === null
          ? null
          : DEFAULT_TEMPLATE_SETTINGS.reminderAfterDays;
  const questions = parseQuestions(row.questions);
  return {
    id: row.id,
    questions: questions.length ? questions : standardFeedbackQuestions(),
    // anonymous = true forces anonymity; false lets each member choose (the member app offers the choice).
    settings: { sendTiming: timing, reminderAfterDays: reminder && reminder > 0 ? reminder : null, anonymousAllowed: !row.anonymous },
  };
}

export type FeedbackOverview = {
  template: FeedbackTemplate;
  surveys: SurveyRow[];
  /** Events with or without a survey: recent live/completed events and every event a survey belongs to. */
  events: { id: string; name: string; starts_at: string | null; ends_at: string | null; status: string }[];
  responses: { survey_id: string; person_id: string | null; answers: Json; submitted_at: string }[];
  /** Checked-in people per event (the response-rate denominator). */
  attendeesByEvent: Map<string, number>;
};

export async function loadFeedbackOverview(db: AppSupabase, centerId: string, sinceIso: string): Promise<FeedbackOverview> {
  const all = rows(
    await db.from("surveys").select("*").eq("center_id", centerId).eq("kind", "event_feedback").order("created_at", { ascending: false }).limit(200),
    "feedback surveys",
  );
  const templateRow = all.find(isTemplate) ?? null;
  const surveys = all.filter((s) => !isTemplate(s) && s.event_id);
  const surveyEventIds = [...new Set(surveys.map((s) => s.event_id as string))];
  const [recent, linked] = await Promise.all([
    db
      .from("events")
      .select("id, name, starts_at, ends_at, status")
      .eq("center_id", centerId)
      .in("status", ["live", "completed"])
      .gte("starts_at", sinceIso)
      .order("starts_at", { ascending: false })
      .limit(40),
    surveyEventIds.length ? db.from("events").select("id, name, starts_at, ends_at, status").in("id", surveyEventIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const events = new Map<string, FeedbackOverview["events"][number]>();
  for (const e of [...rows(recent, "recent events"), ...rows(linked, "the events these surveys belong to")]) events.set(e.id, e);
  const surveyIds = surveys.map((s) => s.id);
  const eventIds = [...events.keys()];
  const [responses, checkedIn] = await Promise.all([
    surveyIds.length
      ? allRows<{ survey_id: string; person_id: string | null; answers: Json; submitted_at: string }>(
          (f, t) => db.from("survey_responses").select("survey_id, person_id, answers, submitted_at").in("survey_id", surveyIds).order("id").range(f, t),
          "survey responses",
        )
      : Promise.resolve([]),
    eventIds.length
      ? allRows<{ event_id: string }>(
          (f, t) => db.from("attendees").select("event_id").in("event_id", eventIds).not("checked_in_at", "is", null).order("id").range(f, t),
          "attendance",
        )
      : Promise.resolve([]),
  ]);
  const attendeesByEvent = new Map<string, number>();
  for (const a of checkedIn) attendeesByEvent.set(a.event_id, (attendeesByEvent.get(a.event_id) ?? 0) + 1);
  return {
    template: templateFrom(templateRow),
    surveys,
    events: [...events.values()].sort((a, b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? "")),
    responses,
    attendeesByEvent,
  };
}

const MISSING_COLUMN = new Set(["PGRST204", "42703"]);

/**
 * Insert or update a survey, including the columns the schema stream is
 * adding. If the database does not have them yet, retry without them and
 * report which settings could not be stored (never silently).
 */
export async function writeSurvey(
  db: AppSupabase,
  op: { insert: TablesInsert<"surveys"> } | { update: Partial<TablesInsert<"surveys">>; id: string },
  extras: { send_at?: string | null; reminder_after_days?: number | null; template_key?: string | null },
): Promise<{ id: string | null; error: unknown; extrasStored: boolean }> {
  const run = async (withExtras: boolean) => {
    if ("insert" in op) {
      const row = (withExtras ? { ...op.insert, ...extras } : op.insert) as TablesInsert<"surveys">;
      const res = await db.from("surveys").insert(row).select("id").single();
      return { id: res.data?.id ?? null, error: res.error };
    }
    const patch = (withExtras ? { ...op.update, ...extras } : op.update) as Partial<TablesInsert<"surveys">>;
    const res = await db.from("surveys").update(patch).eq("id", op.id).select("id");
    return { id: res.data?.[0]?.id ?? null, error: res.error ?? (res.data && res.data.length === 0 ? { message: "you can't edit this survey" } : null) };
  };
  if (Object.keys(extras).length === 0) return { ...(await run(false)), extrasStored: true };
  const first = await run(true);
  const code = (first.error as { code?: string } | null)?.code;
  if (first.error && code && MISSING_COLUMN.has(code)) {
    console.error("[feedback] survey scheduling columns are not in the database yet; saving without them:", first.error);
    return { ...(await run(false)), extrasStored: false };
  }
  return { ...first, extrasStored: !first.error };
}
