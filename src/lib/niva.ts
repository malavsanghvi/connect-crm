// Content › Niva: pure helpers (tested in tests/niva.test.ts).
//
// The database records why each question has or has not got an answer
// (niva_conversations.answer_status and outcome_detail, migration 0572), and
// app.niva_health(center) says whether Niva can answer at all. These helpers turn
// both into the plain English staff read on Content › Niva.

import { isPlainObject } from "@/lib/center-rules";
import { contentStatusLabel } from "@/lib/content";
import type { Json } from "@/lib/database.types";

type Tone = "ok" | "warn" | "bad";

// ── Why a question has, or has not, got an answer ───────────────────────────

/** niva_conversations.answer_status (the 0572 check constraint). */
export const NIVA_OUTCOMES = ["pending", "answered", "no_source", "unsure", "refused", "paused", "failed"] as const;
export type NivaOutcome = (typeof NIVA_OUTCOMES)[number];

function withDetail(label: string, detail: string | null | undefined): string {
  const d = (detail ?? "").trim();
  return d ? `${label} — ${d}` : label;
}

/**
 * The worker's "unsure" when the model wrote an answer that cited no approved source
 * (worker/src/handlers/niva.answer.ts): staff fix that differently from "no source answers it".
 */
const UNCITED_ANSWER = /could not point to an approved source/i;

/**
 * The "Why" of a question, in plain English. The fixed outcomes have fixed wording; a paused or
 * failed question carries the worker's own plain-English detail (never a secret: 0572 scrubs it).
 */
export function nivaOutcomeLabel(status: string | null | undefined, detail?: string | null): string {
  switch (status) {
    case "pending":
      return "Waiting for Niva";
    case "answered":
      return "Answered";
    case "no_source":
      return "No approved source mentions these words";
    case "unsure":
      return UNCITED_ANSWER.test(detail ?? "")
        ? "Niva wrote an answer but could not point to an approved source for it, so it was not shown"
        : "Sources found but none clearly answers it";
    case "refused":
      return "Niva declined";
    case "paused":
      return withDetail("AI service paused", detail);
    case "failed":
      return withDetail("Failed", detail);
    default:
      return status ? withDetail(status.replace(/_/g, " "), detail) : "Not known";
  }
}

/** The short status beside the "Why": Answered, Waiting, Paused, Failed or Unanswered. */
export function nivaOutcomeStatus(status: string | null | undefined): { label: string; tone: Tone } {
  switch (status) {
    case "answered":
      return { label: "Answered", tone: "ok" };
    case "pending":
      return { label: "Waiting", tone: "warn" };
    case "paused":
      return { label: "Paused", tone: "warn" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    default:
      return { label: "Unanswered", tone: "warn" };
  }
}

/**
 * One question in the Recent list: its short status and its "Why". A question that shows an answer
 * is answered; when a later try (Regenerate) could not improve on it, the worker's note says why
 * the answer was kept.
 */
export function nivaConversationView(r: { answer: string | null; answer_status: string; outcome_detail: string | null }): {
  status: { label: string; tone: Tone };
  why: string;
} {
  if (r.answer) {
    const d = (r.outcome_detail ?? "").trim();
    return { status: nivaOutcomeStatus("answered"), why: d ? `The last try kept this answer: ${d}` : "—" };
  }
  // No answer to show: "answered" cannot be right, so it reads as still waiting.
  const status = r.answer_status === "answered" ? "pending" : r.answer_status;
  return { status: nivaOutcomeStatus(status), why: nivaOutcomeLabel(status, r.outcome_detail) };
}

// ── Unanswered questions, grouped by what was asked ─────────────────────────

export type UnansweredRow = { id: string; question: string; answer_status: string; outcome_detail: string | null; created_at: string };
export type UnansweredGroup = {
  /** The question as first written (trimmed). */
  text: string;
  /** Every conversation with this question, newest first. */
  ids: string[];
  n: number;
  /** The outcome of the newest one: what "Try again" would change. */
  latest: { status: string; detail: string | null; created_at: string };
};

/** "Try again (N)" on one group queues at most this many questions (one niva_regenerate each). */
export const NIVA_GROUP_RETRY_MAX = 25;

export function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Group unanswered questions by their normalised text: most asked first, then most recent. */
export function groupUnanswered(rows: UnansweredRow[], limit = 25): UnansweredGroup[] {
  const groups = new Map<string, UnansweredGroup>();
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  for (const r of sorted) {
    const key = normalizeQuestion(r.question);
    if (!key) continue;
    const g = groups.get(key);
    if (g) {
      g.ids.push(r.id);
      g.n += 1;
    } else {
      groups.set(key, { text: r.question.trim(), ids: [r.id], n: 1, latest: { status: r.answer_status, detail: r.outcome_detail, created_at: r.created_at } });
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.n - a.n || (a.latest.created_at < b.latest.created_at ? 1 : a.latest.created_at > b.latest.created_at ? -1 : 0))
    .slice(0, limit);
}

// ── Sources: one row per imported page ───────────────────────────────────────

export type NivaSourceLite = { id: string; center_id: string | null; status: string; metadata: unknown };
export type SourceCounts = { total: number; included: number; waiting: number; draft: number; retired: number };
export type SourceGroup = {
  /** "shared" (the platform's own sources), "hand" (written here) or "url:<address>" (imported from that page). */
  key: string;
  kind: "shared" | "hand" | "page";
  url: string | null;
  /** The imported page's title, when the import recorded one. */
  pageTitle: string | null;
  counts: SourceCounts;
  /** Imported drafts of this group: what "Send for approval" on the page moves to the queue. */
  importedDrafts: number;
};

const meta = (m: unknown): Record<string, unknown> => (isPlainObject(m) ? (m as Record<string, unknown>) : {});

export function sourceUrlOf(metadata: unknown): string | null {
  const u = meta(metadata).source_url;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

/** Which group a source belongs to: shared rows first, then the center's own by imported page. */
export function nivaSourceGroupKey(row: { center_id: string | null; metadata: unknown }): string {
  if (row.center_id === null) return "shared";
  const url = sourceUrlOf(row.metadata);
  return url ? `url:${url}` : "hand";
}

const emptyCounts = (): SourceCounts => ({ total: 0, included: 0, waiting: 0, draft: 0, retired: 0 });

/**
 * Count a source into its status. 'approved' is not a status Niva answers from (only 'published' is,
 * and 0572 moved any 'approved' niva_source back to the queue), so it counts as waiting.
 */
function countInto(c: SourceCounts, status: string) {
  c.total += 1;
  if (status === "published") c.included += 1;
  else if (status === "in_review" || status === "approved") c.waiting += 1;
  else if (status === "retired") c.retired += 1;
  else c.draft += 1;
}

/** Every source, summed per group (shared, written here, then each imported page by address). */
export function summarizeSourceGroups(rows: NivaSourceLite[]): Map<string, SourceGroup> {
  const out = new Map<string, SourceGroup>();
  for (const r of rows) {
    const key = nivaSourceGroupKey(r);
    let g = out.get(key);
    if (!g) {
      const url = key.startsWith("url:") ? key.slice(4) : null;
      g = { key, kind: key === "shared" ? "shared" : key === "hand" ? "hand" : "page", url, pageTitle: null, counts: emptyCounts(), importedDrafts: 0 };
      out.set(key, g);
    }
    if (g.kind === "page" && !g.pageTitle) {
      const t = meta(r.metadata).page_title;
      if (typeof t === "string" && t.trim()) g.pageTitle = t.trim();
    }
    countInto(g.counts, r.status);
    if (r.status === "draft" && r.center_id !== null && meta(r.metadata).imported === true) g.importedDrafts += 1;
  }
  return out;
}

/** The same counts over every source, and how many imported drafts wait to be sent for approval. */
export function nivaSourceTotals(rows: NivaSourceLite[]): SourceCounts & { importedDrafts: number } {
  const c = { ...emptyCounts(), importedDrafts: 0 };
  for (const r of rows) {
    countInto(c, r.status);
    if (r.status === "draft" && r.center_id !== null && meta(r.metadata).imported === true) c.importedDrafts += 1;
  }
  return c;
}

/** "12 sections · 8 included · 2 awaiting approval · 2 drafts" (retired only when there are some). */
export function sourceCountsLine(c: SourceCounts): string {
  const parts = [`${c.total} section${c.total === 1 ? "" : "s"}`, `${c.included} included`];
  if (c.waiting > 0) parts.push(`${c.waiting} awaiting approval`);
  if (c.draft > 0) parts.push(`${c.draft} draft${c.draft === 1 ? "" : "s"}`);
  if (c.retired > 0) parts.push(`${c.retired} retired`);
  return parts.join(" · ");
}

/** Consecutive rows of one group (the rows come ordered by group), keeping their order. */
export function splitIntoGroups<T extends { center_id: string | null; metadata: unknown }>(rows: T[]): { key: string; rows: T[] }[] {
  const out: { key: string; rows: T[] }[] = [];
  for (const r of rows) {
    const key = nivaSourceGroupKey(r);
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else out.push({ key, rows: [r] });
  }
  return out;
}

/**
 * A source's status on Content › Niva: "Included" when Niva answers from it, else the content status.
 * 'approved' is not one Niva answers from (published only, 0572), so it never reads as plain "Approved".
 */
export function nivaSourceStatus(status: string): { label: string; tone: Tone } {
  if (status === "published") return { label: "Included", tone: "ok" };
  if (status === "approved") return { label: "Approved, not included yet", tone: "warn" };
  return { label: contentStatusLabel(status), tone: status === "retired" ? "bad" : "warn" };
}

/** The first `max` characters of a source's text, on one line, cut at a word. */
export function nivaBodyPreview(body: string | null | undefined, max = 200): string {
  const flat = (body ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:–—-]+$/, "")}…`;
}

// ── Usage against the monthly cap ────────────────────────────────────────────

/** The usage line turns into a warning at this share of niva.monthly_questions. */
export const NIVA_USAGE_WARN_AT = 0.8;

export type NivaUsage = { used: number; limit: number | null; pct: number | null; level: "ok" | "warn" | "full"; label: string };

/** "142 of 300 questions this month": warn from 80 %, full at the limit. No limit: just the count. */
export function nivaUsage(used: number, limit: number | null): NivaUsage {
  const u = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const n = (v: number) => v.toLocaleString("en-US");
  if (limit === null || !Number.isFinite(limit) || limit < 0) {
    return { used: u, limit: null, pct: null, level: "ok", label: `${n(u)} question${u === 1 ? "" : "s"} this month · no monthly limit` };
  }
  const pct = limit === 0 ? 1 : u / limit;
  const level = u >= limit ? "full" : pct >= NIVA_USAGE_WARN_AT ? "warn" : "ok";
  return { used: u, limit, pct, level, label: `${n(u)} of ${n(limit)} questions this month` };
}

// ── app.niva_health(center) ──────────────────────────────────────────────────

export type NivaHealthProblem = {
  tone: "danger" | "warning";
  title: string;
  detail: string;
  /** "Try all unanswered questions again" helps once the cause is fixed. */
  retry: boolean;
};

export type NivaHealthView = {
  moduleOn: boolean;
  state: "running" | "stopped" | "not_configured" | "unknown";
  problems: NivaHealthProblem[];
  jobs: { queued: number; running: number; failed24h: number; done24h: number; lastError: string | null };
  /** Members' questions of the last 7 days by outcome (staff tests are left out, 0575). */
  outcomes7d: Record<NivaOutcome, number>;
  /** Members' questions this month against niva.monthly_questions (staff tests are left out, 0575). */
  usage: NivaUsage | null;
  /** Staff tests used today against the daily allowance (0575); null before 0575. */
  testsToday: NivaTestsToday | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} seconds ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

const questions = (n: number) => `${n} question${n === 1 ? "" : "s"}`;

const SAVED = "Members' questions are saved, so nothing is lost.";
const TRY_ALL = '"Try all unanswered questions again"';

/**
 * What the alert at the top of Content › Niva says. It shows when the background service is not
 * running, Niva's answering job is not set up there, questions of the last 7 days are still failed,
 * or questions are waiting out the AI service's spending limit. Nothing shows while Niva is switched off.
 *
 * `canRetry`: the reader has the "Try all unanswered questions again" button (content.manage). Without
 * it the alert says a content manager can press it, rather than pointing at a button that is not there.
 */
export function nivaHealthView(raw: Json | null | undefined, opts: { canRetry?: boolean } = {}): NivaHealthView {
  const canRetry = opts.canRetry === true;
  /** "Press … once it is fixed." / "Once it is fixed, a content manager can press …." */
  const tryAllOnce = (when: string) => (canRetry ? `Press ${TRY_ALL} ${when}.` : `${when.charAt(0).toUpperCase()}${when.slice(1)}, a content manager can press ${TRY_ALL}.`);
  const s = isPlainObject(raw) ? raw : {};
  const j = isPlainObject(s.jobs) ? s.jobs : {};
  const o = isPlainObject(s.outcomes_7d) ? s.outcomes_7d : {};
  const m = isPlainObject(s.month) ? s.month : null;
  const handler = isPlainObject(s.handler) ? s.handler : null;
  const state = s.state === "running" || s.state === "stopped" || s.state === "not_configured" ? s.state : "unknown";
  const moduleOn = s.module_on !== false;
  const jobs = {
    queued: num(j.queued),
    running: num(j.running),
    failed24h: num(j.failed_24h),
    done24h: num(j.done_24h),
    lastError: str(j.last_error),
  };
  const outcomes7d = Object.fromEntries(NIVA_OUTCOMES.map((k) => [k, num(o[k])])) as Record<NivaOutcome, number>;
  const usage = m ? nivaUsage(num(m.used), typeof m.limit === "number" ? m.limit : null) : null;
  const t = isPlainObject(s.tests_today) ? s.tests_today : null;
  const testsToday = t ? nivaTestsToday(num(t.used), typeof t.limit === "number" ? t.limit : NIVA_TEST_DAILY_LIMIT) : null;

  const problems: NivaHealthProblem[] = [];
  if (moduleOn) {
    if (state === "not_configured") {
      problems.push({
        tone: "danger",
        title: "Niva can't answer yet — the background service that writes its answers has never started",
        detail: `${SAVED} They are answered once a platform administrator sets up the background service.`,
        retry: false,
      });
    } else if (state === "stopped") {
      const age = typeof s.age_seconds === "number" ? s.age_seconds : null;
      problems.push({
        tone: "danger",
        title: "Niva can't answer right now — the background service has stopped",
        detail: `It last reported in ${age === null ? "a while ago" : ago(age)}. ${SAVED} They are answered once it is running again.`,
        retry: false,
      });
    }
    if (handler && handler.configured === false) {
      const reason = str(handler.reason);
      problems.push({
        tone: "danger",
        title: "Niva can't answer right now — its answering job is not set up on the background service",
        detail: `${reason ? `The background service says: ${reason.replace(/\.?$/, ".")} ` : ""}${SAVED} ${tryAllOnce("once it is fixed")}`,
        retry: true,
      });
    }
    // Questions that are failed now, not failed jobs: a question answered by a later try leaves this
    // count (its answer_status changes), while jobs.failed_24h would keep the alert up for a day and
    // count a question that failed twice twice.
    if (outcomes7d.failed > 0) {
      problems.push({
        tone: "danger",
        title: `${questions(outcomes7d.failed)} from the last 7 days could not be answered`,
        detail: `${jobs.lastError ? `The last error: ${jobs.lastError.replace(/\.?$/, ".")} ` : ""}${SAVED} ${tryAllOnce("once the cause is fixed")}`,
        retry: true,
      });
    }
    if (outcomes7d.paused > 0) {
      problems.push({
        tone: "warning",
        title: `${questions(outcomes7d.paused)} ${outcomes7d.paused === 1 ? "is" : "are"} waiting for the AI service`,
        detail: `The AI service's spending limit was reached, so Niva tries again by itself later (each question says when). Once the limit is raised, ${
          canRetry ? "press" : "a content manager can press"
        } ${TRY_ALL} to answer them now.`,
        retry: true,
      });
    }
  }
  return { moduleOn, state, problems, jobs, outcomes7d, usage, testsToday };
}

// ── Staff tests (app.niva_test_ask and app.niva_test_result, 0575) ──────────

/** Staff tests allowed per community per day (app.niva_test_daily_limit). */
export const NIVA_TEST_DAILY_LIMIT = 100;
/** The test box asks for the result this often… */
export const NIVA_TEST_POLL_MS = 2500;
/** …for up to this long, then says Niva has not answered yet and offers Check again. */
export const NIVA_TEST_MAX_WAIT_MS = 90_000;

export type NivaTestsToday = { used: number; limit: number; left: number; full: boolean; label: string };

/** "12 of 100 staff tests today", or, once they are used up, when testing opens again. */
export function nivaTestsToday(used: number, limit: number = NIVA_TEST_DAILY_LIMIT): NivaTestsToday {
  const u = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const l = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : NIVA_TEST_DAILY_LIMIT;
  const full = u >= l;
  return {
    used: u,
    limit: l,
    left: Math.max(0, l - u),
    full,
    label: full
      ? `All ${l} of today's staff tests are used. Testing opens again tomorrow; members can still ask Niva as usual.`
      : `${u} of ${l} staff tests today`,
  };
}

/** What app.niva_test_ask returns. */
export type NivaTestAsked = { id: string; question: string; includeInReview: boolean; testsToday: NivaTestsToday };

export function parseNivaTestAsked(raw: unknown): NivaTestAsked | null {
  if (!isPlainObject(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    question: typeof raw.question === "string" ? raw.question : "",
    includeInReview: raw.include_in_review === true,
    testsToday: nivaTestsToday(num(raw.tests_today), typeof raw.daily_limit === "number" ? raw.daily_limit : NIVA_TEST_DAILY_LIMIT),
  };
}

/**
 * A source a test answer cites, with its status now (a content status, or 'hidden' / 'missing'). A live
 * item from the schedule (0574) has kind 'event', 'timings' or 'center' and status 'live' or 'missing'.
 */
export type NivaTestSource = { id: string; title: string; url: string | null; kind: string | null; status: string };
/** The test's latest niva.answer job. */
export type NivaTestJob = { status: string; attempts: number; maxAttempts: number | null; runAfter: string | null };
/** What app.niva_test_result returns. */
export type NivaTestResult = {
  id: string;
  question: string;
  answer: string | null;
  answerStatus: string;
  outcomeDetail: string | null;
  createdAt: string | null;
  answeredAt: string | null;
  model: string | null;
  includeInReview: boolean;
  job: NivaTestJob | null;
  sources: NivaTestSource[];
};

export function parseNivaTestResult(raw: unknown): NivaTestResult | null {
  if (!isPlainObject(raw)) return null;
  const id = str(raw.id);
  if (!id || typeof raw.question !== "string") return null;
  const j = isPlainObject(raw.job) ? raw.job : null;
  const sources = (Array.isArray(raw.sources) ? raw.sources : []).flatMap((s): NivaTestSource[] => {
    if (!isPlainObject(s)) return [];
    const sid = str(s.id);
    if (!sid) return [];
    return [{ id: sid, title: str(s.title) ?? "Untitled source", url: str(s.url), kind: str(s.kind), status: str(s.status) ?? "missing" }];
  });
  return {
    id,
    question: raw.question,
    answer: str(raw.answer),
    answerStatus: str(raw.answer_status) ?? "pending",
    outcomeDetail: str(raw.outcome_detail),
    createdAt: str(raw.created_at),
    answeredAt: str(raw.answered_at),
    model: str(raw.model),
    includeInReview: raw.include_in_review === true,
    job: j
      ? { status: str(j.status) ?? "queued", attempts: num(j.attempts), maxAttempts: typeof j.max_attempts === "number" ? j.max_attempts : null, runAfter: str(j.run_after) }
      : null,
    sources,
  };
}

/**
 * True once nothing more will happen to the test by itself: it has an answer or an outcome (no
 * source, unsure, declined, paused, failed), or its job ended without one (a job that fails before
 * Niva runs, for example when the AI service is not set up, leaves the question pending).
 */
export function nivaTestFinished(r: NivaTestResult): boolean {
  if (r.answer) return true;
  if (r.answerStatus !== "pending" && r.answerStatus !== "answered") return true;
  return r.job?.status === "failed" || r.job?.status === "done";
}

export type NivaTestPhase = "waiting" | "done" | "timed_out";

/** Whether the test box keeps asking (waiting), shows the outcome (done), or stops and offers Check again (timed_out). */
export function nivaTestPhase(r: NivaTestResult | null, elapsedMs: number): NivaTestPhase {
  if (r && nivaTestFinished(r)) return "done";
  return elapsedMs >= NIVA_TEST_MAX_WAIT_MS ? "timed_out" : "waiting";
}

/** While the test box waits: what is happening, from the job. */
export function nivaTestWaitingLine(r: NivaTestResult | null, elapsedMs: number): string {
  const job = r?.job ?? null;
  const what =
    job?.status === "running"
      ? "Niva is reading the sources and writing an answer"
      : job?.status === "queued" && job.attempts > 0
        ? "The first try ran into a problem; Niva is trying again"
        : job?.status === "queued"
          ? "Waiting for the background service to pick the question up"
          : "Niva is looking this up";
  return `${what}… (${Math.max(0, Math.round(elapsedMs / 1000))} s)`;
}

/** The live schedule's items a Niva answer can cite (0574): an event, a day's timings, the address or regular timings. */
const NIVA_LIVE_KINDS: ReadonlySet<string> = new Set(["event", "timings", "center"]);

/** A cited source's status in a test: whether members would get an answer from it. */
export function nivaTestSourceStatus(s: Pick<NivaTestSource, "kind" | "status">): { label: string; tone: Tone } {
  // Members' questions read the same live schedule, so a live item holds an answer back only once it is off it.
  if (s.kind !== null && NIVA_LIVE_KINDS.has(s.kind)) {
    return s.status === "missing" ? { label: "No longer on the schedule", tone: "warn" } : { label: "Live schedule", tone: "ok" };
  }
  if (s.status === "missing") return { label: "No longer exists", tone: "bad" };
  if (s.kind === "guide_section") {
    return s.status === "published" ? { label: "Guide section, public", tone: "ok" } : { label: "Guide section, not public", tone: "warn" };
  }
  if (s.status === "published") return { label: s.kind === "faq" ? "FAQ, published" : "Included", tone: "ok" };
  return nivaSourceStatus(s.status);
}

/** A test's outcome: its short status, its "Why", and a note when members would not get this answer yet. */
export function nivaTestOutcome(r: NivaTestResult): { status: { label: string; tone: Tone }; why: string | null; note: string | null } {
  if (r.answer) {
    const notYet = r.sources.filter((s) => nivaTestSourceStatus(s).tone !== "ok").length;
    return {
      status: nivaOutcomeStatus("answered"),
      why: null,
      note:
        notYet > 0
          ? `Members would not get this answer yet: it uses ${notYet === 1 ? "a source that is" : `${notYet} sources that are`} not included in Niva (waiting for approval, a draft, no longer public or no longer on the schedule).`
          : null,
    };
  }
  if (r.answerStatus === "pending" || r.answerStatus === "answered") {
    if (r.job?.status === "failed") {
      return {
        status: nivaOutcomeStatus("failed"),
        why: "The background service could not run Niva's answering job. Niva's status at the top of this page says why; once it is fixed, ask again.",
        note: null,
      };
    }
    if (r.job?.status === "done") {
      return { status: { label: "Unanswered", tone: "warn" }, why: "Niva finished without saying why there is no answer. Ask again; if it keeps happening, check Niva's status at the top of this page.", note: null };
    }
    return { status: nivaOutcomeStatus("pending"), why: nivaOutcomeLabel("pending"), note: null };
  }
  if (r.answerStatus === "no_source" && r.includeInReview) {
    return { status: nivaOutcomeStatus("no_source"), why: "No source mentions these words, approved or waiting for approval", note: null };
  }
  return { status: nivaOutcomeStatus(r.answerStatus), why: nivaOutcomeLabel(r.answerStatus, r.outcomeDetail), note: null };
}

// ── What Niva also answers from (centers.rules.niva.answer_from, 0573) ──────

export type NivaAnswerFrom = { guide: boolean; faq: boolean };

/** Read centers.rules.niva.answer_from: approved Niva sources always, plus the Guide and/or FAQ when listed. */
export function nivaAnswerFrom(rules: unknown): NivaAnswerFrom {
  const r = isPlainObject(rules) ? rules : {};
  const n = isPlainObject(r.niva) ? r.niva : {};
  const list = Array.isArray(n.answer_from) ? n.answer_from : [];
  return { guide: list.includes("guide"), faq: list.includes("faq") };
}

/** What app.niva_set_answer_from takes (niva_source is always on and is not listed). */
export function nivaAnswerFromKinds(a: NivaAnswerFrom): ("guide" | "faq")[] {
  return [...(a.guide ? (["guide"] as const) : []), ...(a.faq ? (["faq"] as const) : [])];
}

/** "Niva answers from its approved sources, the Guide's public sections and published FAQ items." */
export function nivaAnswerFromLine(a: NivaAnswerFrom): string {
  const extra = [a.guide ? "the Guide's public sections" : null, a.faq ? "published FAQ items" : null].filter((x): x is string => x !== null);
  if (extra.length === 0) return "Niva answers from its approved sources only.";
  return `Niva answers from its approved sources${extra.length === 2 ? `, ${extra[0]} and ${extra[1]}` : ` and ${extra[0]}`}.`;
}
