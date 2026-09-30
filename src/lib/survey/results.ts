// Survey analytics that work for ANY survey's questions (the event feedback template's fixed "overall / areas /
// NPS" view lives in feedback.ts): per-question results, responses over time, and the audience numbers that
// app.event_survey_stats (migration 0547) returns. Pure functions, unit-tested.
//
// Anonymity: a response with no person is anonymous. Names are only ever attached to text answers when the
// survey is not "always anonymous" and the member chose to sign; callers pass `alwaysAnonymous` for surveys that
// force anonymity so a name stored before the setting changed is still never shown.

import { shouldFlagComment } from "./feedback";
import { answerText, type SurveyQuestion } from "./questions";

export type ResultResponse = { person_id: string | null; answers: unknown; submitted_at: string };

// ---------------------------------------------------------------------------
// Audience numbers (from app.event_survey_stats)
// ---------------------------------------------------------------------------
export type SurveyStats = {
  /** Adults of households with an active RSVP or who attended (plus anyone who answered). */
  invited: number;
  /** Answers received, anonymous ones included. */
  responses: number;
  anonymous: number;
  /** Rows in app.survey_completions: one per person who answered, anonymous answers included. */
  completions: number;
  /** People who answered: the larger of answers and completions (older surveys have no completion rows). */
  answered: number;
  pointsAwarded: number;
};

function whole(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Read the jsonb app.event_survey_stats returns; null when it is not the expected shape. */
export function parseSurveyStats(raw: unknown): SurveyStats | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const invited = whole(o.invited);
  const responses = whole(o.responses);
  const anonymous = whole(o.anonymous);
  const completions = whole(o.completions);
  const answered = whole(o.answered);
  const pointsAwarded = whole(o.points_awarded);
  if ([invited, responses, anonymous, completions, answered, pointsAwarded].some((v) => v === null)) return null;
  return {
    invited: invited!,
    responses: responses!,
    anonymous: anonymous!,
    completions: completions!,
    answered: answered!,
    pointsAwarded: pointsAwarded!,
  };
}

// ---------------------------------------------------------------------------
// Per-question results
// ---------------------------------------------------------------------------
export type CountBar = { label: string; count: number; ratio: number };

export type QuestionComment = { from: string; anonymous: boolean; text: string; flagged: boolean; submittedAt: string };

type Common = { id: string; label: string; required: boolean; /** Responses that answered this question. */ answers: number };

export type QuestionResult =
  | (Common & { type: "rating"; average: number | null; distribution: { value: number; count: number }[] })
  | (Common & {
      type: "nps";
      nps: number | null;
      promoters: number;
      passives: number;
      detractors: number;
      distribution: { value: number; count: number }[];
    })
  | (Common & { type: "single"; options: CountBar[] })
  | (Common & { type: "multi"; options: CountBar[] })
  | (Common & { type: "text"; comments: QuestionComment[] });

function answerMap(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function asStrings(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" || typeof v === "number" ? [v] : [];
  return list.map((x) => (typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "")).filter(Boolean);
}

/** Choice counts in the question's own order, then any answer that is not one of the options, most common first. */
function countChoices(options: string[], picked: string[][]): { bars: CountBar[]; answers: number } {
  const counts = new Map<string, number>(options.map((o) => [o, 0]));
  for (const p of picked) for (const v of new Set(p)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const answers = picked.length;
  const known = options.map((o) => ({ label: o, count: counts.get(o) ?? 0 }));
  const extra = [...counts.entries()].filter(([k]) => !options.includes(k)).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  return { bars: [...known, ...extra].map((b) => ({ ...b, ratio: answers ? b.count / answers : 0 })), answers };
}

export function summarizeQuestions(
  questions: SurveyQuestion[],
  responses: ResultResponse[],
  opts: { alwaysAnonymous?: boolean; nameFor?: (personId: string) => string | null } = {},
): QuestionResult[] {
  const maps = responses.map((r) => ({ r, a: answerMap(r.answers) }));
  return questions.map((q): QuestionResult => {
    const common = { id: q.id, label: q.label, required: q.required };
    if (q.type === "rating") {
      const dist = [1, 2, 3, 4, 5].map((value) => ({ value, count: 0 }));
      let sum = 0;
      let n = 0;
      for (const { a } of maps) {
        const v = asNumber(a[q.id]);
        if (v === null || !Number.isInteger(v) || v < 1 || v > 5) continue;
        dist[v - 1].count += 1;
        sum += v;
        n += 1;
      }
      return { ...common, type: "rating", answers: n, average: n ? sum / n : null, distribution: dist };
    }
    if (q.type === "nps") {
      const dist = Array.from({ length: 11 }, (_, value) => ({ value, count: 0 }));
      let n = 0;
      for (const { a } of maps) {
        const v = asNumber(a[q.id]);
        if (v === null || !Number.isInteger(v) || v < 0 || v > 10) continue;
        dist[v].count += 1;
        n += 1;
      }
      const promoters = dist.filter((d) => d.value >= 9).reduce((s, d) => s + d.count, 0);
      const detractors = dist.filter((d) => d.value <= 6).reduce((s, d) => s + d.count, 0);
      return {
        ...common,
        type: "nps",
        answers: n,
        nps: n ? Math.round(((promoters - detractors) / n) * 100) : null,
        promoters,
        passives: n - promoters - detractors,
        detractors,
        distribution: dist,
      };
    }
    if (q.type === "single" || q.type === "multi") {
      const picked = maps.map(({ a }) => asStrings(a[q.id])).filter((p) => p.length > 0);
      const { bars, answers } = countChoices(q.options, q.type === "single" ? picked.map((p) => p.slice(0, 1)) : picked);
      return q.type === "single" ? { ...common, type: "single", answers, options: bars } : { ...common, type: "multi", answers, options: bars };
    }
    const comments: QuestionComment[] = [];
    for (const { r, a } of maps) {
      const text = answerText(a[q.id]);
      if (text === "—" || !text.trim()) continue;
      const named = r.person_id !== null && !opts.alwaysAnonymous;
      comments.push({
        from: named ? (opts.nameFor?.(r.person_id as string) ?? "Member") : "Anonymous",
        anonymous: !named,
        text: text.trim(),
        flagged: shouldFlagComment(text),
        submittedAt: r.submitted_at,
      });
    }
    comments.sort((x, y) => y.submittedAt.localeCompare(x.submittedAt));
    return { ...common, type: "text", answers: comments.length, comments };
  });
}

// ---------------------------------------------------------------------------
// Responses over time
// ---------------------------------------------------------------------------
export type DayCount = { /** YYYY-MM-DD in the center's time zone. */ date: string; count: number };

function localDate(iso: string, tz: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  // en-CA prints YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Responses per day in the center's time zone, from the first answer to the last, with the quiet days in
 * between shown as zero. Keeps the most recent `maxDays` when the survey ran longer.
 */
export function responsesByDay(responses: { submitted_at: string }[], tz: string, maxDays = 60): DayCount[] {
  const counts = new Map<string, number>();
  for (const r of responses) {
    const d = localDate(r.submitted_at, tz);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const days = [...counts.keys()].sort();
  const out: DayCount[] = [];
  for (let d = days[0]; d <= days[days.length - 1]; d = nextDay(d)) out.push({ date: d, count: counts.get(d) ?? 0 });
  return out.slice(-Math.max(1, maxDays));
}

/** "Sep 28" for a YYYY-MM-DD date. */
export function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
}

/** One line for a count and its share: "12 (40%)". */
export function countWithShare(count: number, ratio: number): string {
  return `${count} (${Math.round(ratio * 100)}%)`;
}
