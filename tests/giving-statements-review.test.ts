import { describe, expect, it } from "vitest";

import { communityFormat } from "@/lib/community-format";
import { sampleReviewRows } from "@/lib/giving-statements/fixtures";
import { statementsHref } from "@/lib/giving-statements/model";
import {
  SEND_COMING_NEXT,
  addressedTo,
  chosenStatementYear,
  countsSentence,
  defaultStatementYear,
  deliveryFor,
  matchesFilter,
  notesFor,
  parseReviewRows,
  problemsFor,
  reviewFamily,
  reviewRowView,
  reviewSummary,
  sendLabel,
  statementSeason,
  statementYears,
  yearIsOver,
  type ReviewRowIn,
} from "@/lib/giving-statements/review";
import { buildQueue, type TodayContext, type TodayInput } from "@/lib/giving-today/queue";

const USD = communityFormat({ currency: "USD", country: "US" });
const EUR = communityFormat({ currency: "EUR", country: "DE" });
const INR = communityFormat({ currency: "INR", country: "IN" });

const base: ReviewRowIn = {
  householdId: "h",
  name: "Okafor household",
  number: "0212",
  orgId: "LCC-0212",
  city: "Lakeside",
  adults: [{ name: "Chidi Okafor", primary: true, email: true, app: false }],
  giftCount: 2,
  givenCents: 15000,
  refundedCents: 0,
  refundedCount: 0,
  openingCount: 0,
  openingCents: 0,
  mailOptIn: false,
  addressComplete: false,
};
const r = (o: Partial<ReviewRowIn>): ReviewRowIn => ({ ...base, ...o });

describe("reading app.year_end_review", () => {
  it("reads the rows as the database sends them (bigint as text included) and drops a row without a household", () => {
    const rows = parseReviewRows([
      {
        household_id: "h1",
        household_name: "Okafor household",
        household_number: "0212",
        org_household_id: null,
        city: "Lakeside",
        adults: [{ name: "Chidi Okafor", primary: true, email: true, app: false }, { primary: false }],
        gift_count: 4,
        given_cents: "18500",
        refunded_cents: "5000",
        refunded_count: 1,
        opening_balance_count: 1,
        opening_balance_cents: "50000",
        mail_opt_in: false,
        address_complete: false,
      },
      { household_name: "no id" },
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ givenCents: 18500, refundedCents: 5000, openingCents: 50000, giftCount: 4, orgId: null });
    expect(rows[0].adults).toEqual([{ name: "Chidi Okafor", primary: true, email: true, app: false }]);
    expect(parseReviewRows(null)).toEqual([]);
  });
});

describe("how a statement would reach the household", () => {
  it("goes by post when they asked for paper and the address is complete, even with an email", () => {
    expect(deliveryFor(r({ mailOptIn: true, addressComplete: true }))).toBe("post");
  });
  it("goes by email when an adult has one, and to the app when an adult only has the app", () => {
    expect(deliveryFor(r({}))).toBe("email");
    expect(deliveryFor(r({ adults: [{ name: "Samira Haddad", primary: true, email: false, app: true }] }))).toBe("app");
  });
  it("needs a fix when no adult can be reached, or there is no adult at all", () => {
    expect(deliveryFor(r({ adults: [{ name: "Linh Nguyen", primary: true, email: false, app: false }] }))).toBe("none");
    expect(deliveryFor(r({ adults: [] }))).toBe("none");
  });
  it("asked for paper with an incomplete address: it still goes by email, and the address is a problem to fix", () => {
    const row = r({ mailOptIn: true, addressComplete: false });
    expect(deliveryFor(row)).toBe("email");
    expect(problemsFor(row).map((p) => p.key)).toEqual(["address_incomplete"]);
  });
  it("says what to fix in plain words", () => {
    expect(problemsFor(r({ adults: [] })).map((p) => p.key)).toEqual(["no_adult"]);
    expect(problemsFor(r({ adults: [{ name: "Linh Nguyen", primary: true, email: false, app: false }] }))[0].text).toMatch(/Add an email or a postal address/);
    expect(problemsFor(r({ givenCents: 0, refundedCents: 4000 })).map((p) => p.key)).toEqual(["nothing_given"]);
  });
});

describe("totals, refunds and opening balances", () => {
  it("names the left-out opening balance and the refunds taken off, in the community's currency", () => {
    const notes = notesFor(r({ openingCount: 1, openingCents: 50000, refundedCents: 5000 }), USD);
    expect(notes.map((n) => n.key)).toEqual(["opening_balance", "refunds"]);
    expect(notes[0].text).toBe("1 opening-balance line ($500.00) left out: what was paid before the imported history begins.");
    expect(notes[1].text).toBe("Refunds of $50.00 are taken off the total.");
  });
  it("adds the year's totals in integer cents and writes them in another currency", () => {
    const rows = [r({ givenCents: 12345 }), r({ householdId: "h2", givenCents: 55 })].map((x) => reviewRowView(x, EUR));
    const s = reviewSummary(rows, EUR);
    expect(s.totalCents).toBe(12400);
    expect(s.total).toContain("€");
    expect(s.total).toContain("124");
    expect(reviewRowView(r({ givenCents: 250000 }), INR).total).toContain("₹");
  });
  it("counts each household once, by how it would be reached; a household with nothing to state is not counted to send", () => {
    const rows = sampleReviewRows().map((x) => reviewRowView(x, USD));
    const s = reviewSummary(rows, USD);
    expect(s.households).toBe(7);
    expect(s.counts).toEqual({ email: 2, post: 1, app: 1, none: 2 });
    expect(s.nothingToState).toBe(1);
    expect(s.needFix).toBe(4);
    expect(s.sentence).toBe("2 by email, 1 by post, 1 in the app only, 2 need a fix, 1 with nothing to state");
    expect(s.totalCents).toBe(240000 + 52000 + 18000 + 7500 + 2000 + 30000);
  });
  it("writes the counts sentence in the singular and leaves out empty parts", () => {
    expect(countsSentence({ email: 71, post: 12, app: 0, none: 1 })).toBe("71 by email, 12 by post, 1 needs a fix");
    expect(countsSentence({ email: 0, post: 0, app: 0, none: 0 })).toBe("No household gave this year");
  });
});

describe("adults only", () => {
  it("addresses the statement to the adults the database lists, never anyone else", () => {
    expect(addressedTo([])).toBe("No adult on file");
    expect(
      addressedTo([
        { name: "Chidi Okafor", primary: true, email: true, app: false },
        { name: "María Okafor", primary: false, email: false, app: false },
      ]),
    ).toBe("Chidi Okafor and María Okafor");
  });
  it("the household card names the primary adult, or nobody when there is no adult", () => {
    expect(reviewFamily(r({})).primary).toBe("Chidi Okafor");
    expect(reviewFamily(r({ adults: [] })).primary).toBeNull();
  });
});

describe("filters, the year and the Send button", () => {
  const rows = sampleReviewRows().map((x) => reviewRowView(x, USD));
  it("filters by what needs a fix and by delivery", () => {
    expect(rows.filter((x) => matchesFilter(x, "fix")).map((x) => x.householdId)).toEqual(["h-4", "h-5", "h-6", "h-7"]);
    expect(rows.filter((x) => matchesFilter(x, "email")).map((x) => x.householdId)).toEqual(["h-1", "h-6"]);
    expect(rows.filter((x) => matchesFilter(x, "all"))).toHaveLength(7);
  });
  it("opens on last year from January to March and on this year (so far) afterwards; December 31 and January 1 belong to their own years", () => {
    expect(defaultStatementYear("2027-01-12")).toBe(2026);
    expect(defaultStatementYear("2026-03-31")).toBe(2025);
    expect(defaultStatementYear("2026-04-01")).toBe(2026);
    expect(defaultStatementYear("2026-12-31")).toBe(2026);
    expect(yearIsOver(2026, "2026-12-31")).toBe(false);
    expect(yearIsOver(2026, "2027-01-01")).toBe(true);
    expect(statementSeason("2027-02-01")).toBe(2026);
    expect(statementSeason("2026-10-13")).toBeNull();
  });
  it("takes a year from the address only when it is a real, past or current year", () => {
    expect(chosenStatementYear("2024", "2026-10-13")).toBe(2024);
    expect(chosenStatementYear("2027", "2026-10-13")).toBe(2026);
    expect(chosenStatementYear("abc", "2026-10-13")).toBe(2026);
    expect(chosenStatementYear("1800", "2027-02-01")).toBe(2026);
    expect(statementYears("2026-10-13")).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]);
  });
  it("names what Send would do and says honestly that it is not connected yet", () => {
    expect(sendLabel({ email: 71, post: 1, app: 19, none: 3 })).toBe("Send 71 emails and 1 letter");
    expect(sendLabel({ email: 0, post: 0, app: 4, none: 0 })).toBe("Send statements");
    expect(SEND_COMING_NEXT).toBe("Coming next: the statements service is not connected yet.");
  });
  it("keeps the year, the filter, the page, the sheet and the receipt in the address", () => {
    expect(statementsHref("/giving/statements", { year: 2026, show: "fix", page: 2, review: true, receipt: "R-1" })).toBe(
      "/giving/statements?year=2026&show=fix&page=2&review=1&receipt=R-1",
    );
    expect(statementsHref("/giving/statements", { year: 2026, show: "all", page: 1 })).toBe("/giving/statements?year=2026");
  });
});

describe("Today's row for year-end statements", () => {
  const ctx: TodayContext = {
    can: { approve: false, manage: true, bankConfirm: false, allocate: false, countRecord: false, closeManage: false },
    currency: "USD",
    locale: "en-US",
    timeZone: "America/Chicago",
    today: "2027-01-12",
    labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
    countsWord: "Cash counts",
    zelleWord: "Zelle",
    visible: { approvals: false, bank: false, pledges: false, counts: false, books: false },
  };
  const input = (statements: TodayInput["statements"]): TodayInput => ({
    tasks: [],
    taskFailures: [],
    families: {},
    bank: null,
    behind: null,
    apply: null,
    counts: null,
    close: null,
    statements,
  });
  it("offers Review and send in one click (Giving, Review and send, Send: three)", () => {
    const q = buildQueue(input({ state: "ok", data: { year: 2026, households: 98, needFix: 3, sentence: "71 by email, 19 in the app only, 8 by post" } }), ctx);
    const row = q.rows.find((x) => x.id === "statements:2026");
    expect(row?.title).toBe("Year-end statements for 2026");
    expect(row?.lines[0]).toBe("98 households gave in 2026: 71 by email, 19 in the app only, 8 by post.");
    expect(row?.acts).toEqual([{ kind: "link", href: "/giving/statements?year=2026&review=1", label: "Review and send", primary: true }]);
  });
  it("shows nothing when no household gave, when it is not shown to the person, and says when it could not be read", () => {
    expect(buildQueue(input({ state: "ok", data: { year: 2026, households: 0, needFix: 0, sentence: "" } }), ctx).rows).toEqual([]);
    expect(buildQueue(input(null), ctx).rows).toEqual([]);
    expect(buildQueue(input(undefined), ctx).rows).toEqual([]);
    expect(buildQueue(input({ state: "off" }), ctx).rows).toEqual([]);
    const q = buildQueue(input({ state: "error", error: "Could not read the 2026 year-end review — try again." }), ctx);
    expect(q.problems).toEqual([{ group: "books", message: "Could not read the 2026 year-end review — try again." }]);
  });
});
