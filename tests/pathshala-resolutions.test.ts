import { describe, expect, it } from "vitest";
import {
  canStartVoting,
  daysLeft,
  lifecycle,
  nextVoteHistory,
  parseDateRange,
  periodOpen,
  resolutionOutcome,
  tallyVotes,
  toDateRange,
} from "@/lib/logic/resolutions";

const v = (...votes: string[]) => votes.map((vote) => ({ vote }));

describe("resolution outcome", () => {
  it("needs a quorum of 4 ballots, abstentions included", () => {
    expect(resolutionOutcome(v("yes", "yes", "yes"))).toBe("no_quorum");
    expect(resolutionOutcome(v("yes", "yes", "yes", "abstain"))).toBe("passed");
    expect(resolutionOutcome(v("abstain", "abstain", "abstain", "abstain"))).toBe("failed");
  });

  it("passes only when Yes > No; a tie fails", () => {
    expect(resolutionOutcome(v("yes", "yes", "no", "no"))).toBe("failed");
    expect(resolutionOutcome(v("yes", "yes", "no", "abstain"))).toBe("passed");
    expect(resolutionOutcome(v("yes", "no", "no", "abstain"))).toBe("failed");
    expect(resolutionOutcome(v("yes", "yes", "yes", "no", "no"))).toBe("passed");
  });

  it("respects a custom quorum", () => {
    expect(resolutionOutcome(v("yes", "yes"), 2)).toBe("passed");
    expect(resolutionOutcome(v("yes", "yes", "yes", "yes"), 5)).toBe("no_quorum");
  });

  it("tallies only valid ballots", () => {
    expect(tallyVotes(v("yes", "no", "abstain", "maybe"))).toEqual({ yes: 1, no: 1, abstain: 1, total: 3 });
  });
});

describe("resolution lifecycle", () => {
  const base = { comment_status: "not_started", voting_status: "not_started", withdrawn_at: null, quorum: 4, comment_period: null, voting_period: null };

  it("derives a single status", () => {
    expect(lifecycle(base, [])).toBe("Draft");
    expect(lifecycle({ ...base, comment_status: "started" }, [])).toBe("Comment period open");
    expect(lifecycle({ ...base, comment_status: "completed" }, [])).toBe("Ready for vote");
    expect(lifecycle({ ...base, comment_status: "completed", voting_status: "started" }, [])).toBe("Voting open");
    expect(lifecycle({ ...base, voting_status: "completed" }, v("yes", "yes", "yes", "no"))).toBe("Closed – passed");
    expect(lifecycle({ ...base, voting_status: "completed" }, v("yes", "no", "no", "yes"))).toBe("Closed – failed");
    expect(lifecycle({ ...base, voting_status: "completed" }, v("yes"))).toBe("Closed – no quorum");
    expect(lifecycle({ ...base, voting_status: "completed", withdrawn_at: "2026-09-01T00:00:00Z" }, v("yes", "yes", "yes", "yes"))).toBe("Withdrawn");
  });

  it("only allows voting after commenting is done or its end date has passed", () => {
    expect(canStartVoting({ ...base, comment_status: "started" }, "2026-09-23")).toBe(false);
    expect(canStartVoting({ ...base, comment_status: "completed" }, "2026-09-23")).toBe(true);
    expect(canStartVoting({ ...base, comment_status: "started", comment_period: "[2026-09-01,2026-09-16)" }, "2026-09-23")).toBe(true);
    expect(canStartVoting({ ...base, comment_status: "completed", withdrawn_at: "x" }, "2026-09-23")).toBe(false);
  });
});

describe("date ranges", () => {
  it("parses canonical Postgres dateranges as inclusive dates", () => {
    expect(parseDateRange("[2026-09-01,2026-09-16)")).toEqual({ start: "2026-09-01", end: "2026-09-15" });
    expect(parseDateRange("[2026-09-01,)")).toEqual({ start: "2026-09-01", end: null });
    expect(parseDateRange(null)).toEqual({ start: null, end: null });
    expect(parseDateRange("empty")).toEqual({ start: null, end: null });
  });

  it("writes inclusive ranges", () => {
    expect(toDateRange("2026-09-01", "2026-09-15")).toBe("[2026-09-01,2026-09-15]");
    expect(toDateRange(null, null)).toBeNull();
  });

  it("knows whether a period is open today", () => {
    const r = "[2026-09-20,2026-09-26)";
    expect(periodOpen("started", r, "2026-09-23")).toBe(true);
    expect(periodOpen("started", r, "2026-09-26")).toBe(false);
    expect(periodOpen("paused", r, "2026-09-23")).toBe(false);
    expect(daysLeft(r, "2026-09-23")).toBe(2);
  });

  it("keeps a history of changed ballots", () => {
    expect(nextVoteHistory(null)).toEqual([]);
    expect(
      nextVoteHistory({ vote: "no", reason: "r", voted_at: "t1", vote_history: [{ vote: "yes", reason: null, voted_at: "t0" }] }),
    ).toEqual([
      { vote: "yes", reason: null, voted_at: "t0" },
      { vote: "no", reason: "r", voted_at: "t1" },
    ]);
  });
});
