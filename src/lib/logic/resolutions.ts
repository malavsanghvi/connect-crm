// Committee resolutions (EAMS governance): comment period -> voting period ->
// outcome. Quorum = 4 ballots INCLUDING abstentions; passes only when
// Yes > No (a tie fails). Abstain counts toward quorum, not toward Yes/No.

export const DEFAULT_QUORUM = 4;
export type PeriodStatus = "not_started" | "started" | "paused" | "completed";
export type Vote = "yes" | "no" | "abstain";

export type Tally = { yes: number; no: number; abstain: number; total: number };

export function tallyVotes(votes: { vote: string }[]): Tally {
  const t: Tally = { yes: 0, no: 0, abstain: 0, total: 0 };
  for (const v of votes) {
    if (v.vote === "yes") t.yes += 1;
    else if (v.vote === "no") t.no += 1;
    else if (v.vote === "abstain") t.abstain += 1;
    else continue;
    t.total += 1;
  }
  return t;
}

export type Outcome = "passed" | "failed" | "no_quorum";

export function resolutionOutcome(votes: { vote: string }[], quorum = DEFAULT_QUORUM): Outcome {
  const t = tallyVotes(votes);
  if (t.total < quorum) return "no_quorum";
  return t.yes > t.no ? "passed" : "failed";
}

export type ResolutionLike = {
  comment_status: string;
  voting_status: string;
  withdrawn_at: string | null;
  quorum: number;
  comment_period: string | null;
  voting_period: string | null;
};

export type Lifecycle =
  | "Draft"
  | "Comment period open"
  | "Comment period paused"
  | "Ready for vote"
  | "Voting open"
  | "Voting paused"
  | "Closed – passed"
  | "Closed – failed"
  | "Closed – no quorum"
  | "Withdrawn";

export function lifecycle(r: ResolutionLike, votes: { vote: string }[]): Lifecycle {
  if (r.withdrawn_at) return "Withdrawn";
  if (r.voting_status === "completed") {
    const o = resolutionOutcome(votes, r.quorum || DEFAULT_QUORUM);
    return o === "passed" ? "Closed – passed" : o === "failed" ? "Closed – failed" : "Closed – no quorum";
  }
  if (r.voting_status === "started") return "Voting open";
  if (r.voting_status === "paused") return "Voting paused";
  if (r.comment_status === "completed") return "Ready for vote";
  if (r.comment_status === "started") return "Comment period open";
  if (r.comment_status === "paused") return "Comment period paused";
  return "Draft";
}

// ---------------------------------------------------------------------------
// Postgres daterange <-> inclusive start/end dates.
// Postgres canonicalizes a date range to [start, end) — so "[2026-09-01,2026-09-16)"
// means Sep 1 through Sep 15 inclusive.
// ---------------------------------------------------------------------------
export type DateSpan = { start: string | null; end: string | null };

function shiftDay(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parseDateRange(range: string | null | undefined): DateSpan {
  if (!range || range === "empty") return { start: null, end: null };
  const m = /^([[(])\s*"?([^,"]*)"?\s*,\s*"?([^\])"]*)"?\s*([\])])$/.exec(range.trim());
  if (!m) return { start: null, end: null };
  const [, lb, lo, hi, ub] = m;
  const start = lo ? (lb === "(" ? shiftDay(lo, 1) : lo) : null;
  const end = hi ? (ub === ")" ? shiftDay(hi, -1) : hi) : null;
  return { start, end };
}

/** Inclusive dates -> a daterange literal. */
export function toDateRange(start: string | null, endInclusive: string | null): string | null {
  if (!start && !endInclusive) return null;
  return `[${start ?? ""},${endInclusive ?? ""}]`;
}

/** Is a period accepting input today? (status started AND today within the dates, when set) */
export function periodOpen(status: string, range: string | null, todayIso: string): boolean {
  if (status !== "started") return false;
  const { start, end } = parseDateRange(range);
  if (start && todayIso < start) return false;
  if (end && todayIso > end) return false;
  return true;
}

/** Voting may begin once commenting is completed, or its closing date has passed. */
export function canStartVoting(r: ResolutionLike, todayIso: string): boolean {
  if (r.withdrawn_at || r.voting_status !== "not_started") return false;
  if (r.comment_status === "completed") return true;
  const { end } = parseDateRange(r.comment_period);
  return Boolean(end && todayIso > end);
}

/** Days left in a period, for urgency badges (negative = closed N days ago). */
export function daysLeft(range: string | null, todayIso: string): number | null {
  const { end } = parseDateRange(range);
  if (!end) return null;
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(todayIso + "T00:00:00Z")) / 86_400_000);
}

export type VoteHistoryEntry = { vote: string; reason: string | null; voted_at: string };

/** When a member changes their ballot, the previous one is appended to history. */
export function nextVoteHistory(previous: { vote: string; reason: string | null; voted_at: string; vote_history: unknown } | null): VoteHistoryEntry[] {
  if (!previous) return [];
  const history = Array.isArray(previous.vote_history) ? (previous.vote_history as VoteHistoryEntry[]) : [];
  return [...history, { vote: previous.vote, reason: previous.reason, voted_at: previous.voted_at }];
}
