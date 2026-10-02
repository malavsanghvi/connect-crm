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
  outcomes7d: Record<NivaOutcome, number>;
  usage: NivaUsage | null;
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
  return { moduleOn, state, problems, jobs, outcomes7d, usage };
}
