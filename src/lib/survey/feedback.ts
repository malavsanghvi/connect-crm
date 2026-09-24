// Event feedback surveys: the standard template, when a request is sent, and
// the results aggregation (response rate, average, NPS, areas, attendance,
// comments). Pure functions, unit-tested.

import { answerText, type SurveyQuestion } from "./questions";

export const FEEDBACK_TEMPLATE_KEY = "event_feedback";

/** Area ratings; the comment "area" filter uses the same names. */
export const FEEDBACK_AREAS = [
  { id: "area_program", area: "Program", label: "Program and pravachan" },
  { id: "area_organization", area: "Organization", label: "Organization and check-in" },
  { id: "area_food", area: "Food", label: "Food and bhojanshala" },
  { id: "area_venue", area: "Venue", label: "Venue and parking" },
] as const;

export const DEFAULT_ATTENDED_OPTIONS = ["Pravachan", "Pratikraman", "Bhojanshala", "Samvatsari", "Kids program"];

/**
 * The standard event feedback survey: overall stars, four area ratings,
 * likelihood to recommend (0–10), what did you attend, and an open comment
 * (with the area it is about, for filtering).
 */
export function standardFeedbackQuestions(attended: string[] = DEFAULT_ATTENDED_OPTIONS): SurveyQuestion[] {
  return [
    { id: "overall", type: "rating", label: "Overall, how was the event?", options: [], required: true },
    ...FEEDBACK_AREAS.map((a) => ({ id: a.id, type: "rating" as const, label: a.label, options: [], required: false })),
    { id: "nps", type: "nps", label: "How likely are you to recommend this event to a friend?", options: [], required: false },
    { id: "attended", type: "multi", label: "What did you attend?", options: attended, required: false },
    { id: "comment", type: "text", label: "Anything you would like to tell the organisers?", options: [], required: false },
    { id: "comment_area", type: "single", label: "Your comment is mostly about", options: FEEDBACK_AREAS.map((a) => a.area), required: false },
  ];
}

export const SEND_TIMINGS = [
  { key: "right_after", label: "Right after" },
  { key: "next_morning", label: "Next morning" },
  { key: "two_days", label: "2 days later" },
] as const;
export type SendTiming = (typeof SEND_TIMINGS)[number]["key"];

export const FEEDBACK_OPEN_DAYS = 14;
const MORNING_HOUR = 9;

/** Template settings kept on the template survey row. */
export type FeedbackTemplateSettings = { sendTiming: SendTiming; reminderAfterDays: number | null; anonymousAllowed: boolean };

export const DEFAULT_TEMPLATE_SETTINGS: FeedbackTemplateSettings = { sendTiming: "next_morning", reminderAfterDays: 3, anonymousAllowed: true };

/** Local wall-clock parts of an instant in a zone. */
function localParts(instant: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

/** The instant of a local wall-clock time in a zone. */
function zonedInstant(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess, tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess += asUtc - shown;
  }
  return guess;
}

/**
 * When a feedback request goes out: right after the event ends (or now, if
 * that has passed), 9 AM the next morning, or 9 AM two days later — in the
 * center's time zone, and never in the past.
 */
export function feedbackSendAt(timing: SendTiming, eventEndIso: string | null, tz: string, now: Date = new Date()): string {
  const nowMs = now.getTime();
  const end = eventEndIso ? Date.parse(eventEndIso) : NaN;
  const base = Number.isFinite(end) ? end : nowMs;
  if (timing === "right_after") return new Date(Math.max(base, nowMs)).toISOString();
  const p = localParts(base, tz);
  const days = timing === "next_morning" ? 1 : 2;
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  let at = zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), MORNING_HOUR, 0, tz);
  // An event that ended long ago still gets its request tomorrow morning, not in the past.
  if (at <= nowMs) {
    const n = localParts(nowMs, tz);
    const tomorrow = new Date(Date.UTC(n.y, n.m - 1, n.d + 1));
    at = zonedInstant(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), MORNING_HOUR, 0, tz);
  }
  return new Date(at).toISOString();
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

/** "Mon 9 AM" / "Thu" for the toast, in the center's zone. */
export function shortWhen(iso: string, tz: string, withTime = true): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  if (!withTime) return day;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "");
  return `${day} ${time}`;
}

// ---------------------------------------------------------------------------
// Status in the Surveys table
// ---------------------------------------------------------------------------
export type FeedbackStatus = "Not sent" | "Draft" | "Scheduled" | "Open" | "Closed";

export function feedbackStatus(
  s: { status: string; opens_at: string | null; closes_at: string | null } | null,
  now: Date = new Date(),
): FeedbackStatus {
  if (!s) return "Not sent";
  if (s.status === "closed") return "Closed";
  if (s.status === "draft") return "Draft";
  const t = now.getTime();
  if (s.opens_at && Date.parse(s.opens_at) > t) return "Scheduled";
  if (s.closes_at && Date.parse(s.closes_at) <= t) return "Closed";
  return "Open";
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
export type ResponseLike = { person_id: string | null; answers: unknown; submitted_at: string };

export type FeedbackComment = {
  from: string;
  anonymous: boolean;
  rating: number | null;
  area: string;
  text: string;
  flagged: boolean;
  submittedAt: string;
};

export type FeedbackResults = {
  responses: number;
  anonymous: number;
  /** responses ÷ attendees (checked in), 0..1, or null when there were no attendees. */
  rate: number | null;
  overall: number | null;
  nps: number | null;
  promoters: number;
  detractors: number;
  npsAnswers: number;
  areas: { id: string; label: string; average: number | null; answers: number }[];
  attended: { label: string; count: number }[];
  comments: FeedbackComment[];
  flagged: number;
};

const SAFETY_WORDS =
  /\b(unsafe|safety|injur(?:y|ed)|hurt|harass(?:ed|ment)?|abuse[d]?|assault(?:ed)?|threat(?:en|ened)?|danger(?:ous)?|emergency|police|fight|fell|allerg(?:y|ic)|bully(?:ing)?|inappropriate)\b/i;
const NAMES_SOMEONE = /\b(?:Mr|Mrs|Ms|Dr)\.?\s+[A-Z][a-z]+|\b[A-Z][a-z]+\s+(?:[Uu]ncle|[Aa]unt(?:ie|y)|[Bb]hai|[Bb]en)\b/;

/**
 * A comment that reports a safety concern or names someone is flagged to the
 * event lead rather than published in reports (prototype "Exports" note).
 * This is a first pass; the lead decides.
 */
export function shouldFlagComment(text: string): boolean {
  return SAFETY_WORDS.test(text) || NAMES_SOMEONE.test(text);
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function avg(list: number[]): number | null {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

/**
 * Aggregate responses to a feedback survey. Works on any survey: questions are
 * found by id (standard template) or, failing that, by type (first rating =
 * overall, first nps, first multi = attended, first text = comment).
 */
export function aggregateFeedback(
  questions: SurveyQuestion[],
  responses: ResponseLike[],
  attendees: number,
  nameFor: (personId: string) => string | null = () => null,
): FeedbackResults {
  const byId = (id: string) => questions.find((q) => q.id === id);
  const overallQ = byId("overall") ?? questions.find((q) => q.type === "rating");
  const npsQ = byId("nps") ?? questions.find((q) => q.type === "nps");
  const attendedQ = byId("attended") ?? questions.find((q) => q.type === "multi");
  const commentQ = byId("comment") ?? questions.find((q) => q.type === "text");
  const areaQ = byId("comment_area");
  const areaQs = FEEDBACK_AREAS.map((a) => ({ ...a, q: byId(a.id) })).filter((a) => a.q);

  const overall: number[] = [];
  const npsScores: number[] = [];
  const areaScores = new Map<string, number[]>();
  const attendedCounts = new Map<string, number>((attendedQ?.options ?? []).map((o) => [o, 0]));
  const comments: FeedbackComment[] = [];
  let anonymous = 0;

  for (const r of responses) {
    const a = r.answers && typeof r.answers === "object" && !Array.isArray(r.answers) ? (r.answers as Record<string, unknown>) : {};
    if (!r.person_id) anonymous += 1;
    const o = overallQ ? num(a[overallQ.id]) : null;
    if (o !== null && o >= 1 && o <= 5) overall.push(o);
    const n = npsQ ? num(a[npsQ.id]) : null;
    if (n !== null && n >= 0 && n <= 10) npsScores.push(n);
    for (const ar of areaQs) {
      const v = num(a[ar.id]);
      if (v !== null && v >= 1 && v <= 5) areaScores.set(ar.id, [...(areaScores.get(ar.id) ?? []), v]);
    }
    if (attendedQ) {
      const picked = a[attendedQ.id];
      for (const p of Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : []) {
        if (typeof p === "string") attendedCounts.set(p, (attendedCounts.get(p) ?? 0) + 1);
      }
    }
    const text = commentQ ? answerText(a[commentQ.id]) : "—";
    if (commentQ && text !== "—" && text.trim()) {
      const areaAnswer = areaQ ? a[areaQ.id] : null;
      const name = r.person_id ? nameFor(r.person_id) : null;
      comments.push({
        from: r.person_id ? (name ?? "Member") : "Anonymous",
        anonymous: !r.person_id,
        rating: o,
        area: typeof areaAnswer === "string" && areaAnswer ? areaAnswer : "General",
        text: text.trim(),
        flagged: shouldFlagComment(text),
        submittedAt: r.submitted_at,
      });
    }
  }

  const promoters = npsScores.filter((s) => s >= 9).length;
  const detractors = npsScores.filter((s) => s <= 6).length;
  const nps = npsScores.length ? Math.round(((promoters - detractors) / npsScores.length) * 100) : null;

  return {
    responses: responses.length,
    anonymous,
    rate: attendees > 0 ? responses.length / attendees : null,
    overall: avg(overall),
    nps,
    promoters,
    detractors,
    npsAnswers: npsScores.length,
    areas: areaQs.map((ar) => ({ id: ar.id, label: ar.q!.label, average: avg(areaScores.get(ar.id) ?? []), answers: (areaScores.get(ar.id) ?? []).length })),
    attended: [...attendedCounts.entries()].map(([label, count]) => ({ label, count })).sort((x, y) => y.count - x.count),
    comments: comments.sort((x, y) => y.submittedAt.localeCompare(x.submittedAt)),
    flagged: comments.filter((c) => c.flagged).length,
  };
}

/** "+46", "−12", "—". */
export function formatNps(n: number | null): string {
  if (n === null) return "—";
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

export function formatPct(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

/** Averages below this show in red (prototype bars). */
export const LOW_AREA_SCORE = 3.8;
