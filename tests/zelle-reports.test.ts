import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_WINDOW_DAYS,
  DUPLICATE_SQLSTATE,
  REPORT_STATUS_LABEL,
  candidateLabel,
  duplicateWarning,
  normalizeConfirmation,
  parseDuplicateError,
  parseExactConfirm,
  parsePossibleDuplicates,
  parseReportQueue,
  queueSections,
  reportProblem,
  zelleWindowDays,
  type ReportInput,
} from "@/lib/payments/zelle";

const MIGRATION = readFileSync(fileURLToPath(new URL("../supabase/migrations/0582_payment_reports.sql", import.meta.url)), "utf8");
const MATCHING = readFileSync(fileURLToPath(new URL("../supabase/migrations/0583_zelle_bank_matching.sql", import.meta.url)), "utf8");

const H = "11111111-1111-4111-8111-111111111111";
const R1 = "22222222-2222-4222-8222-222222222222";
const R2 = "33333333-3333-4333-8333-333333333333";
const R3 = "44444444-4444-4444-8444-444444444444";
const T1 = "55555555-5555-4555-8555-555555555555";
const P1 = "66666666-6666-4666-8666-666666666666";

const base: ReportInput = { amountCents: 25_000, sentOn: "2026-09-28", today: "2026-10-02" };

describe("normalizeConfirmation", () => {
  it("keeps letters and digits only, upper case, like the database trigger", () => {
    expect(normalizeConfirmation("jpm99-bxk2 q1v")).toBe("JPM99BXK2Q1V");
    expect(normalizeConfirmation(" Jpm99bxk2q1v ")).toBe("JPM99BXK2Q1V");
  });
  it("is null when nothing is left", () => {
    expect(normalizeConfirmation("")).toBeNull();
    expect(normalizeConfirmation(" - # ")).toBeNull();
    expect(normalizeConfirmation(null)).toBeNull();
    expect(normalizeConfirmation(undefined)).toBeNull();
  });
});

describe("reportProblem mirrors app.report_payment", () => {
  it("accepts a plain report, with or without a confirmation number", () => {
    expect(reportProblem(base)).toBeNull();
    expect(reportProblem({ ...base, confirmation: "Jpm99bxk2q1v", senderName: "Rahul Shah", pledgeIds: [P1] })).toBeNull();
    expect(reportProblem({ ...base, sentOn: base.today })).toBeNull();
    expect(reportProblem({ ...base, sentOn: "2026-08-03" })).toBeNull(); // exactly 60 days back
  });

  const cases: [string, Partial<ReportInput>, string][] = [
    ["another method", { method: "card" }, "Only a Zelle can be reported here; other gifts are recorded when they arrive."],
    ["no amount", { amountCents: null }, "Enter the amount you sent, from $0.01 to $1,000,000."],
    ["zero", { amountCents: 0 }, "Enter the amount you sent, from $0.01 to $1,000,000."],
    ["too much", { amountCents: 100_000_001 }, "Enter the amount you sent, from $0.01 to $1,000,000."],
    ["fractional cents", { amountCents: 10.5 }, "Enter the amount you sent, from $0.01 to $1,000,000."],
    ["no date", { sentOn: "" }, "Enter the date you sent the Zelle."],
    ["a future date", { sentOn: "2026-10-03" }, "The date you sent the Zelle cannot be after today."],
    ["61 days back", { sentOn: "2026-08-02" }, "Report a Zelle you sent in the last 60 days. For an older one, contact the treasurer."],
    ["a short confirmation", { confirmation: "AB-12" }, "That does not look like a Zelle confirmation number. Leave it blank if you do not have it."],
    ["a long confirmation", { confirmation: "A".repeat(41) }, "That does not look like a Zelle confirmation number. Leave it blank if you do not have it."],
    ["a long sender name", { senderName: "x".repeat(121) }, "The name your bank shows can be at most 120 characters."],
    ["a long note", { note: "x".repeat(501) }, "The note can be at most 500 characters."],
  ];
  for (const [what, over, message] of cases) {
    it(`refuses ${what} in the database's words`, () => {
      expect(reportProblem({ ...base, ...over })).toBe(message);
      expect(MIGRATION).toContain(message);
    });
  }

  it("names the organization when Zelle is not accepted (the same sentence as the SQL)", () => {
    expect(reportProblem({ ...base, zelleAccepted: false, shortName: "JSH" })).toBe("Zelle is not one of the ways JSH takes gifts.");
    expect(MIGRATION).toContain("'Zelle is not one of the ways % takes gifts.'");
  });

  it("checks more than 20 pledges", () => {
    const many = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(reportProblem({ ...base, pledgeIds: many })).toBe("Choose at most 20 pledges.");
    expect(MIGRATION).toContain("Choose at most 20 pledges.");
  });

  it("leaves the checks only the database can make to the database, in plain sentences", () => {
    for (const s of [
      "Only an adult of the family can report a payment.",
      "That confirmation number was already reported.",
      "That Zelle is already on the bank statement and recorded.",
      "You already reported this Zelle; it is waiting for the bank.",
      "Thank you. The treasurer matches it when it reaches the bank, usually within a few days. Until then it shows as Reported and is not counted as given.",
      "Test report saved. In a sandbox no real money moves.",
      "Sandbox: no real money moves",
    ]) {
      expect(MIGRATION).toContain(s);
    }
  });
});

describe("zelleWindowDays mirrors app.zelle_report_window_days", () => {
  it("defaults to 10 and clamps to 3..30", () => {
    expect(zelleWindowDays(null)).toBe(DEFAULT_WINDOW_DAYS);
    expect(zelleWindowDays({})).toBe(10);
    expect(zelleWindowDays({ payments: { offline_only: true } })).toBe(10);
    expect(zelleWindowDays({ payments: { zelle: { report_window_days: 14 } } })).toBe(14);
    expect(zelleWindowDays({ payments: { zelle: { report_window_days: "7" } } })).toBe(7);
    expect(zelleWindowDays({ payments: { zelle: { report_window_days: 1 } } })).toBe(3);
    expect(zelleWindowDays({ payments: { zelle: { report_window_days: 90 } } })).toBe(30);
    expect(zelleWindowDays({ payments: { zelle: { report_window_days: "soon" } } })).toBe(10);
  });
});

describe("status labels", () => {
  it("has a plain label for every status the table allows", () => {
    expect(REPORT_STATUS_LABEL).toEqual({
      reported: "Waiting for the bank",
      unmatched: "Not seen at the bank",
      matched: "Matched",
      rejected: "Not accepted",
      withdrawn: "Withdrawn",
    });
    expect(MIGRATION).toContain("check (status in ('reported','matched','unmatched','rejected','withdrawn'))");
  });
});

const household = {
  household_id: H,
  household_name: "Shah family",
  household_number: "JSH-H-2041",
  org_household_id: "0212",
  members: "Rahul, Mira",
  primary_member: "Rahul Shah",
  primary_org_member_id: "0417",
  zone: "West",
  city: "Sugar Land",
  last_gift_on: "2026-09-01",
  open_pledge_cents: 50_000,
};

function queueReport(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "reported",
    is_test: false,
    amount_cents: 25_000,
    sent_on: "2026-09-28",
    due_on: "2026-10-08",
    confirmation: "Jpm99bxk2q1v",
    sender_name: "Rahul Shah",
    note: null,
    reported_by_name: "Rahul Shah",
    created_at: "2026-09-28T15:00:00Z",
    household,
    pledges: [{ id: P1, pledge_number: "PL-0001", open_cents: 25_000 }],
    candidates: [],
    hand_recorded: [],
    bank_recorded: [],
    ...over,
  };
}

describe("parseReportQueue", () => {
  const raw = {
    window_days: 10,
    bank_account_id: null,
    counts: { reported: 2, unmatched: 1, exact: 1 },
    exact: [
      {
        report_id: R1,
        bank_transaction_id: T1,
        amount_cents: 25_000,
        sent_on: "2026-09-28",
        posted_on: "2026-09-29",
        confirmation: "Jpm99bxk2q1v",
        payer_name: "RAHUL SHAH",
        household,
      },
      { report_id: "not-a-pair" },
    ],
    reports: [
      queueReport(R1, {
        candidates: [
          { bank_transaction_id: T1, posted_on: "2026-09-29", amount_cents: 25_000, description: "Zelle Payment From Rahul Shah Jpm99bxk2q1v", payer_name: "RAHUL SHAH", reference: "Jpm99bxk2q1v", exact: true, score: 0.99 },
        ],
      }),
      queueReport(R2, { status: "unmatched", confirmation: null }),
      queueReport(R3, { hand_recorded: [{ kind: "hand_recorded", id: P1, receipt_number: "R-100", date: "2026-09-27", amount_cents: 25_000 }] }),
      { id: "x", status: "lost", amount_cents: 1 },
    ],
  };

  it("reads the queue and drops rows it cannot use", () => {
    const q = parseReportQueue(raw);
    expect(q).not.toBeNull();
    expect(q!.window_days).toBe(10);
    expect(q!.counts).toEqual({ reported: 2, unmatched: 1, exact: 1 });
    expect(q!.exact).toHaveLength(1);
    expect(q!.exact[0].household?.household_number).toBe("JSH-H-2041");
    expect(q!.reports.map((r) => r.id)).toEqual([R1, R2, R3]);
    expect(q!.reports[0].candidates[0]).toMatchObject({ exact: true, score: 0.99 });
    expect(q!.reports[2].hand_recorded[0]).toMatchObject({ kind: "hand_recorded", receipt_number: "R-100" });
  });

  it("is null for an answer in another shape", () => {
    expect(parseReportQueue(null)).toBeNull();
    expect(parseReportQueue([])).toBeNull();
    expect(parseReportQueue({ reports: [] })).toBeNull();
  });

  it("puts each report in exactly one section: exact, waiting, not seen, recorded by hand", () => {
    const s = queueSections(parseReportQueue(raw)!);
    expect(s.exact.map((e) => e.report_id)).toEqual([R1]);
    expect(s.waiting.map((r) => r.id)).toEqual([]);
    expect(s.unmatched.map((r) => r.id)).toEqual([R2]);
    expect(s.recorded.map((r) => r.id)).toEqual([R3]);
  });

  it("matches the keys app.payment_report_queue builds", () => {
    for (const k of ["'window_days'", "'bank_account_id'", "'counts'", "'exact'", "'reports'", "'candidates'", "'hand_recorded'", "'reported_by_name'"]) {
      expect(MATCHING).toContain(k);
    }
  });
});

describe("parseDuplicateError (the double-count guard, SQLSTATE CCDUP)", () => {
  it("reads the plain message and the hand-recorded payment ids", () => {
    const d = parseDuplicateError({
      code: DUPLICATE_SQLSTATE,
      message: "This family already has a Zelle of $250.00 recorded by hand on September 27, 2026 (receipt R-100).",
      details: `${P1}, ${R1},nonsense`,
    });
    expect(d).toEqual({
      message: "This family already has a Zelle of $250.00 recorded by hand on September 27, 2026 (receipt R-100).",
      paymentIds: [P1, R1],
    });
    expect(MATCHING).toContain("errcode = 'CCDUP'");
  });
  it("is null for any other error", () => {
    expect(parseDuplicateError({ code: "P0001", message: "bank line already matched" })).toBeNull();
    expect(parseDuplicateError(null)).toBeNull();
    expect(parseDuplicateError("CCDUP")).toBeNull();
  });
});

describe("possible duplicates and the record-payment warning", () => {
  const rows = parsePossibleDuplicates([
    { kind: "hand_recorded", id: P1, receipt_number: "R-100", date: "2026-09-27", amount_cents: 25_000 },
    { kind: "report", id: R1, receipt_number: null, date: "2026-09-28", amount_cents: 25_000 },
    { kind: "other", id: R2, date: "2026-09-28", amount_cents: 25_000 },
  ]);
  it("keeps the three kinds the database returns", () => {
    expect(rows.map((r) => r.kind)).toEqual(["hand_recorded", "report"]);
  });
  it("says plainly what may already be recorded, and nothing when nothing is", () => {
    const text = duplicateWarning(rows, "USD", (d) => d);
    expect(text).toMatch(/^This may already be recorded: /);
    expect(text).toContain("recorded by hand on 2026-09-27 (receipt R-100)");
    expect(text).toContain("a member reported a Zelle of $250.00 sent on 2026-09-28");
    expect(duplicateWarning([], "USD", (d) => d)).toBeNull();
  });
});

describe("bulk confirm outcome", () => {
  it("reads confirmed and skipped pairs", () => {
    expect(
      parseExactConfirm({
        confirmed: [{ report_id: R1, payment_id: P1, receipt_number: "R-101" }, { report_id: R2 }],
        skipped: [{ report_id: R3, reason: "It is no longer an exact match (matched, changed or now ambiguous); match it by hand." }],
      }),
    ).toEqual({
      confirmed: [{ report_id: R1, payment_id: P1, receipt_number: "R-101" }],
      skipped: [{ report_id: R3, reason: "It is no longer an exact match (matched, changed or now ambiguous); match it by hand." }],
    });
    expect(parseExactConfirm({ confirmed: [] })).toBeNull();
  });
  it("labels candidate lines by how sure they are", () => {
    expect(candidateLabel(0.99, true)).toBe("Exact: confirmation number, amount and date");
    expect(candidateLabel(0.99, false)).toBe("Same confirmation number");
    expect(candidateLabel(0.93, false)).toBe("Same amount, date and sender name");
    expect(candidateLabel(0.8, false)).toBe("Same amount and date");
  });
});
