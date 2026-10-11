import { describe, expect, it } from "vitest";

import { asHouseholdCard, describeResult, friendlyDate, humanize, householdFacts, isEmptyView } from "@/lib/assistant/result-view";

const card = {
  household_id: "h1",
  household_name: "Shah household",
  household_number: "H-1042",
  org_household_id: "JSH-77",
  adults: ["Rahul Shah", "Mira Shah"],
  primary_adult: "Rahul Shah",
  zone: "East",
  city: "Edison",
  last_gift_on: "2026-09-14",
  open_pledge_cents: 25000,
  open_pledge: "$250.00",
};

describe("household cards from the command layer", () => {
  it("keeps adults only, whatever else was sent", () => {
    const view = asHouseholdCard({ ...card, children: ["Kid Shah"], members: "Rahul Shah, Mira Shah, Kid Shah" });
    expect(view).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain("Kid Shah");
    expect(view?.adults).toEqual(["Rahul Shah", "Mira Shah"]);
  });

  it("is not a card without an id and a list of adults", () => {
    expect(asHouseholdCard({ household_id: "h1" })).toBeNull();
    expect(asHouseholdCard({ adults: [] })).toBeNull();
    expect(asHouseholdCard("x")).toBeNull();
  });

  it("shows open pledges in dollars even when only cents arrived", () => {
    expect(asHouseholdCard({ ...card, open_pledge: undefined })?.open_pledge).toBe("$250.00");
    expect(householdFacts(asHouseholdCard(card)!)).toEqual(["East zone", "Edison", "Last gift Sep 14, 2026", "Open pledges $250.00"]);
  });

  it("writes a date as the calendar day it is, without a time zone moving it", () => {
    expect(friendlyDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(friendlyDate("2026-12-31T23:30:00-08:00")).toBe("Dec 31, 2026");
    expect(friendlyDate(null)).toBeNull();
    expect(friendlyDate("last week")).toBe("last week");
  });
});

describe("showing a result without knowing the command", () => {
  it("who is behind on pledges: totals as facts, a note, household cards with their numbers", () => {
    const view = describeResult({
      households_behind: 2,
      pledges_behind: 3,
      total_open_cents: 40000,
      total_open: "$400.00",
      basis: "Pledges at least 1 day past due on 2026-10-10.",
      showing: [{ household: card, pledges_behind: 2, open_cents: 25000, open: "$250.00", oldest_days_overdue: 41 }],
    });
    expect(view.notes).toEqual(["Pledges at least 1 day past due on 2026-10-10."]);
    expect(view.facts).toEqual([
      { label: "Households behind", value: "2" },
      { label: "Pledges behind", value: "3" },
      { label: "Total open", value: "$400.00" },
    ]);
    expect(view.households).toHaveLength(1);
    expect(view.households[0].card.household_number).toBe("H-1042");
    expect(view.households[0].facts).toEqual([
      { label: "Pledges behind", value: "2" },
      { label: "Open", value: "$250.00" },
      { label: "Oldest days overdue", value: "41" },
    ]);
  });

  it("never shows raw cents or ids as numbers", () => {
    const view = describeResult({ id: "abc", household_id: "h", amount_cents: 12345, count: 3 });
    expect(view.facts).toEqual([
      { label: "Amount", value: "$123.45" },
      { label: "Count", value: "3" },
    ]);
  });

  it("my tasks: a small table whose first column carries the links", () => {
    const view = describeResult({
      count: 2,
      tasks: [
        { id: "t1", area: "Refund", title: "Approve a refund", detail: "$40.00", open: [{ label: "Open", href: "/approvals" }] },
        { id: "t2", area: "Deposit", title: "Match a deposit", detail: "3 checks", open: [] },
      ],
      could_not_load: [],
    });
    expect(view.facts).toEqual([{ label: "Count", value: "2" }]);
    expect(view.tables).toHaveLength(1);
    const t = view.tables[0];
    expect(t.title).toBe("Tasks");
    expect(t.columns.map((c) => c.label)).toEqual(["Area", "Title", "Detail"]);
    expect(t.rows[0].cells).toEqual({ area: "Refund", title: "Approve a refund", detail: "$40.00" });
    expect(t.rows[0].links).toEqual([{ label: "Open", href: "/approvals" }]);
    expect(t.rows[1].links).toEqual([]);
  });

  it("only links that stay inside the portal are kept", () => {
    const view = describeResult({ tasks: [{ title: "x", open: [{ label: "Go", href: "https://evil.example/x" }] }] });
    expect(view.tables[0].rows[0].links).toEqual([]);
    const proto = describeResult({ tasks: [{ title: "x", open: [{ label: "Go", href: "//evil.example/x" }] }] });
    expect(proto.tables[0].rows[0].links).toEqual([]);
  });

  it("people search: each result is a household card with how it matched", () => {
    const view = describeResult({ count: 1, results: [{ household: card, matched_on: ["phone", "name"] }], more: 0, hidden: 0 });
    expect(view.households).toHaveLength(1);
    expect(view.households[0].facts).toEqual([{ label: "Matched on", value: "phone, name" }]);
  });

  it("upcoming events: a table of what is plain", () => {
    const view = describeResult({
      count: 2,
      looked_ahead_days: 60,
      events: [
        { id: "e1", number: "EV-1", name: "Diwali Dinner", date: "2026-11-08", starts: "6:00 PM", venue: "Main Hall", status: "published", who_can_rsvp: "Members", capacity: 200 },
        { id: "e2", number: "EV-2", name: "Garba", date: "2026-10-18", starts: null, venue: null, status: "draft", who_can_rsvp: "Everyone", capacity: null },
      ],
    });
    const t = view.tables[0];
    expect(t.columns.map((c) => c.key)).toEqual(["number", "name", "date", "starts", "venue"]);
    expect(t.rows[1].cells.venue).toBe("—");
  });

  it("caps a long list and says how many more there are", () => {
    const view = describeResult({ rows: Array.from({ length: 14 }, (_, i) => ({ name: `Row ${i}` })) });
    expect(view.tables[0].rows).toHaveLength(10);
    expect(view.tables[0].more).toBe(4);
  });

  it("a bare list, a single household and a plain value all work", () => {
    expect(describeResult([card]).households).toHaveLength(1);
    expect(describeResult(card).households).toHaveLength(1);
    expect(describeResult(7).facts).toEqual([{ label: "Result", value: "7" }]);
    expect(describeResult([{ a: 1 }, { a: 2 }]).tables[0].rows).toHaveLength(2);
  });

  it("nothing to show is recognised", () => {
    expect(isEmptyView(describeResult(null))).toBe(true);
    expect(isEmptyView(describeResult({}))).toBe(true);
    expect(isEmptyView(describeResult({ count: 0 }))).toBe(false);
  });

  it("turns a key into words", () => {
    expect(humanize("households_behind")).toBe("Households behind");
    expect(humanize("whoCanRsvp")).toBe("Who can rsvp");
  });
});
