import { describe, expect, it } from "vitest";

import { expiringNotice, expiringTaskCopy, parseExpiringCounts, parseProofCounts, parseUnbankedCounts, proofsTaskCopy, unbankedTaskCopy } from "@/lib/payment-proofs/counts";

describe("payment proof counts", () => {
  it("reads the database answer and treats anything else as zero", () => {
    expect(parseProofCounts({ waiting: 3, needs_info: 2, stale: 1, oldest_days: 9 })).toEqual({ waiting: 3, needsInfo: 2, stale: 1, oldestDays: 9 });
    expect(parseProofCounts({ waiting: "4", stale: -2 })).toEqual({ waiting: 4, needsInfo: 0, stale: 0, oldestDays: 0 });
    expect(parseProofCounts(null)).toEqual({ waiting: 0, needsInfo: 0, stale: 0, oldestDays: 0 });
    expect(parseProofCounts("nonsense")).toEqual({ waiting: 0, needsInfo: 0, stale: 0, oldestDays: 0 });
    expect(parseUnbankedCounts({ total: 5, past_window: 2, oldest_days: 31 })).toEqual({ total: 5, pastWindow: 2, oldestDays: 31 });
    expect(parseUnbankedCounts(undefined)).toEqual({ total: 0, pastWindow: 0, oldestDays: 0 });
  });

  it("makes no task when nothing is waiting for the treasury team", () => {
    expect(proofsTaskCopy({ waiting: 0, needsInfo: 0, stale: 0, oldestDays: 0 })).toBeNull();
    // Proofs waiting only for a member's reply are not the treasury team's work.
    expect(proofsTaskCopy({ waiting: 0, needsInfo: 3, stale: 0, oldestDays: 0 })).toBeNull();
  });

  it("counts waiting proofs and the ones a member never answered", () => {
    const one = proofsTaskCopy({ waiting: 1, needsInfo: 0, stale: 0, oldestDays: 0 });
    expect(one).toEqual({ count: 1, title: "1 payment confirmation to review", meta: "Sent by members as soft credit" });
    const many = proofsTaskCopy({ waiting: 4, needsInfo: 3, stale: 2, oldestDays: 12 });
    expect(many?.count).toBe(6);
    expect(many?.title).toBe("6 payment confirmations to review");
    expect(many?.meta).toContain("oldest waiting 12 days");
    expect(many?.meta).toContain("2 replies overdue from members");
    expect(proofsTaskCopy({ waiting: 0, needsInfo: 1, stale: 1, oldestDays: 0 })?.meta).toContain("1 reply overdue from members");
  });

  it("words the payments that are paid but not on the bank", () => {
    expect(unbankedTaskCopy({ total: 0, pastWindow: 0, oldestDays: 0 })).toBeNull();
    expect(unbankedTaskCopy({ total: 1, pastWindow: 0, oldestDays: 0 })).toEqual({
      count: 1,
      title: "1 payment paid, not on the bank",
      meta: "Recorded as received, waiting for a bank statement line",
    });
    const c = unbankedTaskCopy({ total: 7, pastWindow: 2, oldestDays: 1 });
    expect(c?.title).toBe("7 payments paid, not on the bank");
    expect(c?.meta).toBe("2 payments past the usual days to reach the bank · oldest 1 day");
  });

  it("reads the files about to be removed and treats anything else as none", () => {
    expect(parseExpiringCounts({ count: 3, soonest_on: "2027-01-01", legal_hold: false, days: 30 })).toEqual({ count: 3, soonestOn: "2027-01-01", legalHold: false, days: 30 });
    expect(parseExpiringCounts({ count: "2", soonest_on: "soon", legal_hold: true })).toEqual({ count: 2, soonestOn: null, legalHold: true, days: 30 });
    expect(parseExpiringCounts(null)).toEqual({ count: 0, soonestOn: null, legalHold: false, days: 30 });
    expect(parseExpiringCounts({ count: -4 }).count).toBe(0);
  });

  const date = (v: string) => `on ${v}`;

  it("makes a Home task only when files are about to be removed and no legal hold is on", () => {
    expect(expiringTaskCopy({ count: 0, soonestOn: null, legalHold: false, days: 30 }, date)).toBeNull();
    // A hold stops all removal, so there is nothing to warn about.
    expect(expiringTaskCopy({ count: 5, soonestOn: "2027-01-01", legalHold: true, days: 30 }, date)).toBeNull();
    expect(expiringTaskCopy({ count: 1, soonestOn: "2027-01-01", legalHold: false, days: 30 }, date)).toEqual({
      count: 1,
      title: "1 confirmation file about to be removed",
      meta: "The first is due on 2027-01-01 · keep a copy of anything you still need · Settings › Storage",
    });
    const many = expiringTaskCopy({ count: 12, soonestOn: null, legalHold: false, days: 30 }, date);
    expect(many?.title).toBe("12 confirmation files about to be removed");
    expect(many?.meta).toBe("keep a copy of anything you still need · Settings › Storage");
  });

  it("words the Settings notice, with the hold when it is on", () => {
    expect(expiringNotice({ count: 0, soonestOn: null, legalHold: false, days: 30 }, date)).toBeNull();
    expect(expiringNotice({ count: 1, soonestOn: "2027-01-01", legalHold: false, days: 30 }, date)).toBe(
      "1 file becomes due for removal by on 2027-01-01. Keep a copy of anything you still need before then.",
    );
    expect(expiringNotice({ count: 4, soonestOn: null, legalHold: true, days: 30 }, date)).toBe(
      "4 files become due for removal within 30 days. Keep a copy of anything you still need before then. The legal hold is on, so none is removed while it stays on.",
    );
  });
});
