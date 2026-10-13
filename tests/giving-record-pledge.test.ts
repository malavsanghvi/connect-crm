import { describe, expect, it } from "vitest";

import { buildGivingLane, EMPTY_FOUND, givingEnter, givingHousehold, isRecordRow, readGivingIntent, type GivingFound, type GivingIntent } from "@/lib/find/giving";
import { buildUiRows, enterAction } from "@/lib/find/rows";
import type { FindResponse } from "@/lib/find/types";
import type { GivingHousehold } from "@/lib/giving-actions/family-giving";
import {
  checkPledge,
  designationValue,
  isRequestId,
  parseDesignation,
  PLEDGE_NO_UNDO,
  pledgeButtonLabel,
  pledgeWhatHappens,
  recordedPledgeLabel,
  splitPledgeWords,
  type PledgeDesignation,
} from "@/lib/giving-actions/record-pledge";

// Record a pledge by hand (docs/GIVING_REDESIGN.md slice 7; 0745): the checks, the words, and the box's "pledge 500 patel building
// fund". Built for every organization: a faith community and a sports club, dollars, shillings and euros.

const TODAY = "2026-10-13";
const FUND = "9d000000-0000-4000-8000-000000000001";
const CAMPAIGN = "9d000000-0000-4000-8000-000000000011";
const HOUSEHOLD = "9e000000-0000-4000-8000-000000000127";
const ADULT = "9c000000-0000-4000-8000-000000000001";

const base = { householdId: HOUSEHOLD, amount: "500", designation: `fund:${FUND}`, reason: "Pledged in person" };

const card = (id: string, name: string, number: string, adults: string[]): GivingHousehold =>
  givingHousehold({
    household_id: id,
    household_name: name,
    household_number: number,
    org_household_id: null,
    adults,
    primary_adult: adults[0] ?? null,
    zone: null,
    city: "Springfield",
    last_gift_on: null,
    open_pledge_cents: 0,
    open_pledge: "$0.00",
  });
const patel = card("h-patel", "Patel", "0127", ["Asha Patel", "Ravi Patel"]);
const patel2 = card("h-patel2", "Patel", "0311", ["Mina Patel"]);
const okafor = card("h-okafor", "Okafor", "0042", ["Chidi Okafor"]);

const building: PledgeDesignation = { kind: "fund", id: FUND, name: "Building fund" };
const roof: PledgeDesignation = { kind: "campaign", id: CAMPAIGN, name: "Clubhouse roof" };
const youth: PledgeDesignation = { kind: "campaign", id: "9d000000-0000-4000-8000-000000000012", name: "Youth league" };

const opts = { currency: "USD", locale: "en-US", timeZone: "America/Chicago", canRecord: true, canRecordPledge: true };
const found = (over: Partial<GivingFound>): GivingFound => ({ ...EMPTY_FOUND, ...over });
const pledgeIntent = (text: string) => {
  const i = readGivingIntent(text, { today: TODAY, fmt: { currency: "USD", locale: "en-US" }, scope: "giving" });
  if (!i || i.kind !== "pledge") throw new Error(`expected a pledge, got ${i?.kind ?? "nothing"}`);
  return i;
};

describe("the checks (the database makes them again)", () => {
  it("accepts a pledge with a fund, a reason and no due date, in whole cents", () => {
    const c = checkPledge(base, TODAY);
    expect(c).toEqual({
      ok: true,
      value: { householdId: HOUSEHOLD, amountCents: 50000, fundId: FUND, campaignId: null, opportunityId: null, dueOn: null, pledgedBy: null, dedication: null, reason: "Pledged in person" },
    });
  });

  it("reads a campaign, an opportunity or nothing (a general pledge), and refuses a choice it does not understand", () => {
    expect(parseDesignation(`campaign:${CAMPAIGN}`)).toEqual({ fundId: null, campaignId: CAMPAIGN, opportunityId: null });
    expect(parseDesignation("")).toEqual({ fundId: null, campaignId: null, opportunityId: null });
    expect(parseDesignation("fund:not-an-id")).toBeNull();
    expect(designationValue(building)).toBe(`fund:${FUND}`);
    expect(checkPledge({ ...base, designation: "bank:x" }, TODAY)).toMatchObject({ ok: false, error: expect.stringContaining("was not understood") });
  });

  it("refuses what the database refuses, with a plain sentence", () => {
    expect(checkPledge({ ...base, amount: "0" }, TODAY)).toMatchObject({ ok: false, error: "Enter the pledge amount, like 500.00." });
    expect(checkPledge({ ...base, amount: "-5" }, TODAY)).toMatchObject({ ok: false });
    expect(checkPledge({ ...base, householdId: "patel" }, TODAY)).toMatchObject({ ok: false, error: "Choose the family first." });
    expect(checkPledge({ ...base, reason: " ok " }, TODAY)).toMatchObject({ ok: false, error: expect.stringContaining("It shows in the family's History") });
    expect(checkPledge({ ...base, dedication: "x".repeat(201) }, TODAY)).toMatchObject({ ok: false, error: expect.stringContaining("200 characters") });
    expect(checkPledge({ ...base, dueOn: "2036-12-31" }, TODAY)).toMatchObject({ ok: false, error: "The due date must be within ten years of today." });
    expect(checkPledge({ ...base, dueOn: "2026-02-30" }, TODAY)).toMatchObject({ ok: false, error: expect.stringContaining("as a date") });
    expect(checkPledge({ ...base, pledgedBy: "Asha" }, TODAY)).toMatchObject({ ok: false });
  });

  it("keeps a due date, the adult who pledged and a dedication", () => {
    const c = checkPledge({ ...base, dueOn: "2027-03-31", pledgedBy: ADULT, dedication: "  In memory of our grandmother " }, TODAY);
    expect(c).toMatchObject({ ok: true, value: { dueOn: "2027-03-31", pledgedBy: ADULT, dedication: "In memory of our grandmother" } });
  });

  it("takes large amounts in any currency as integer cents", () => {
    expect(checkPledge({ ...base, amount: "2,500,000" }, TODAY)).toMatchObject({ ok: true, value: { amountCents: 250_000_000 } });
  });

  it("a sheet's request id is its confirmation: 8 to 120 plain characters", () => {
    expect(isRequestId("pledge-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed")).toBe(true);
    expect(isRequestId("short")).toBe(false);
    expect(isRequestId("x".repeat(121))).toBe(false);
    expect(isRequestId("drop table; --")).toBe(false);
    expect(isRequestId(undefined)).toBe(false);
  });
});

describe("the words", () => {
  it("the button names the amount and the family by its number, never a name alone", () => {
    expect(pledgeButtonLabel({ amount: "500", family: null, currency: "USD" })).toBe("Choose the family first");
    expect(pledgeButtonLabel({ amount: "", family: patel, currency: "USD" })).toBe("Enter the amount");
    expect(pledgeButtonLabel({ amount: "500", family: patel, currency: "USD", locale: "en-US" })).toBe("Record a $500.00 pledge for the Patel household 0127");
    expect(pledgeButtonLabel({ amount: "1500", family: okafor, currency: "KES", locale: "en-KE" })).toMatch(/^Record a Ksh\s?1,500\.00 pledge for the Okafor household 0042$/);
  });

  it("says what happens before the click, that no money moves, and how a mistake is fixed", () => {
    expect(pledgeWhatHappens({ amountCents: 50000, forWhat: "Building fund", pledger: "Asha Patel", currency: "USD", locale: "en-US" })).toBe(
      "Adds a pledge of $500.00 to Building fund, pledged by Asha Patel. It shows as owed until it is paid, and in the family's History with your reason.",
    );
    expect(pledgeWhatHappens({ amountCents: null, forWhat: null, pledger: null, currency: "USD" })).toContain("a pledge (general, no fund chosen), for the household");
    expect(PLEDGE_NO_UNDO).toContain("No money moves");
    expect(PLEDGE_NO_UNDO).toContain("a second person approves");
    expect(recordedPledgeLabel({ pledgeNumber: "PL-20456" })).toBe("Recorded as PL-20456");
    expect(recordedPledgeLabel({ pledgeNumber: null })).toBe("Recorded");
  });
});

describe("the box: pledge 500 patel building fund", () => {
  it("takes the fund's words out and keeps the rest to look the family up by", () => {
    expect(splitPledgeWords("patel building fund", [building, roof])).toEqual({ designation: building, familyWords: "patel" });
    expect(splitPledgeWords("patel for the building", [building, roof])).toEqual({ designation: building, familyWords: "patel" });
    expect(splitPledgeWords("okafor youth league", [building, roof, youth])).toEqual({ designation: youth, familyWords: "okafor" });
    expect(splitPledgeWords("patel", [building, roof])).toEqual({ designation: null, familyWords: "patel" });
    expect(splitPledgeWords("building fund", [building])).toEqual({ designation: building, familyWords: null });
    expect(splitPledgeWords(null, [building])).toEqual({ designation: null, familyWords: null });
  });

  it("chooses nothing when two names fit equally well (the person picks in the sheet)", () => {
    const appeal: PledgeDesignation = { kind: "campaign", id: "9d000000-0000-4000-8000-000000000013", name: "Building appeal" };
    expect(splitPledgeWords("patel building", [building, appeal])).toEqual({ designation: null, familyWords: "patel building" });
  });

  it("one family: one large row that opens the Record pledge sheet filled in", () => {
    const lane = buildGivingLane(pledgeIntent("pledge 500 patel building fund"), found({ families: [patel], designation: building, pledgeWho: "patel" }), opts);
    expect(lane.first).toBe(true);
    expect(lane.understood).toBe("record a $500.00 pledge for the Patel household 0127 to Building fund");
    expect(lane.rows).toHaveLength(1);
    const row = lane.rows[0];
    expect(row).toMatchObject({ kind: "record_pledge", title: "Record a $500.00 pledge for the Patel household 0127", best: true });
    expect(isRecordRow(row)).toBe(true);
    expect(row.kind === "record_pledge" ? row.request : null).toEqual({ household: patel, prefill: { amount: "500.00", designation: building } });
    expect(givingEnter(row)).toEqual({ type: "record-pledge", request: { household: patel, prefill: { amount: "500.00", designation: building } }, href: "/households/h-patel?tab=pledges" });
  });

  it("two families: choose by the household card in the sheet; nothing is picked by name", () => {
    const lane = buildGivingLane(pledgeIntent("pledge 500 patel"), found({ families: [patel, patel2], pledgeWho: "patel" }), opts);
    expect(lane.rows[0]).toMatchObject({ kind: "record_pledge", key: "pledge-choose", title: "Record a $500.00 pledge: choose the family", household: null, best: true });
    expect(lane.rows[0].kind === "record_pledge" ? lane.rows[0].request.candidates : null).toEqual([patel, patel2]);
    expect(lane.rows.slice(1).map((r) => r.title)).toEqual(["Record a $500.00 pledge for the Patel household 0127", "Record a $500.00 pledge for the Patel household 0311"]);
  });

  it("no family: the sheet opens on the family search and says what was looked for", () => {
    const lane = buildGivingLane(pledgeIntent("pledge 500 zzz building fund"), found({ designation: building, pledgeWho: "zzz" }), opts);
    expect(lane.rows[0]).toMatchObject({ kind: "record_pledge", key: "pledge-none", title: "Record a $500.00 pledge to Building fund", household: null });
    expect(lane.rows[0].detail).toBe("No family matches “zzz”. The sheet opens on the family search.");
    expect(givingEnter(lane.rows[0])).toMatchObject({ type: "record-pledge", href: "/giving/pledges" });
  });

  it("without giving.manage it says so and offers nothing to press", () => {
    const lane = buildGivingLane(pledgeIntent("pledge 500 patel"), found({ families: [patel] }), { ...opts, canRecordPledge: false });
    expect(lane.rows).toEqual([]);
    expect(lane.notes).toEqual(["Recording a pledge needs the giving.manage permission."]);
  });

  it("Enter on the first row opens the sheet (the box hands the request to the sheets)", () => {
    const lane = buildGivingLane(pledgeIntent("pledge 500 patel building fund"), found({ families: [patel], designation: building, pledgeWho: "patel" }), opts);
    const resp: FindResponse = { query: "pledge 500 patel building fund", kind: "name", rows: [], more: 0, filter: null, problem: null, giving: lane };
    const ui = buildUiRows(resp, { niva: "off", scope: "giving" });
    expect(enterAction(ui.rows, 0, { scope: "giving" })).toMatchObject({ type: "record-pledge", request: { household: patel } });
  });

  it("works the same for a sports club in euros", () => {
    const i = readGivingIntent("pledge 250 okafor youth league", { today: TODAY, fmt: { currency: "EUR", locale: "en-IE" }, scope: "giving" }) as GivingIntent;
    expect(i.kind).toBe("pledge");
    const lane = buildGivingLane(i, found({ families: [okafor], designation: youth, pledgeWho: "okafor" }), { ...opts, currency: "EUR", locale: "en-IE" });
    expect(lane.rows[0].title).toBe("Record a €250.00 pledge for the Okafor household 0042");
  });
});
