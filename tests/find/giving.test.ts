import { describe, expect, it } from "vitest";

import type { CommunityFormat } from "@/lib/community-format";
import {
  buildGivingLane,
  codeTokens,
  EMPTY_FOUND,
  givingEnter,
  givingHousehold,
  normalizeAmounts,
  readGivingIntent,
  usesDecimalComma,
  type GivingFound,
  type GivingIntent,
} from "@/lib/find/giving";
import { buildUiRows, enterAction, selectable } from "@/lib/find/rows";
import type { FindResponse, FindRow } from "@/lib/find/types";
import type { GivingHousehold } from "@/lib/giving-actions/family-giving";

// The Giving lane of the one find box (docs/GIVING_REDESIGN.md section 4): read by rules, for any organization, currency and number
// convention. Nothing here saves: a row opens a sheet, a family's giving or a list.

const TODAY = "2026-10-13";
const USD: CommunityFormat = { currency: "USD", locale: "en-US" };
const KES: CommunityFormat = { currency: "KES", locale: "en-KE" };
const INR: CommunityFormat = { currency: "INR", locale: "en-IN" };
const EUR_DE: CommunityFormat = { currency: "EUR", locale: "en-DE" };

const read = (text: string, fmt: CommunityFormat = USD, scope: "people" | "giving" = "giving") => readGivingIntent(text, { today: TODAY, fmt, scope });
const record = (i: GivingIntent | null) => {
  if (!i || i.kind !== "record") throw new Error(`expected a payment to record, got ${i?.kind ?? "nothing"}`);
  return i;
};

const patel: GivingHousehold = givingHousehold({
  household_id: "h-patel",
  household_name: "Patel",
  household_number: "0127",
  org_household_id: "RCC-H-1127",
  adults: ["Asha Patel", "Ravi Patel"],
  primary_adult: "Asha Patel",
  zone: "North",
  city: "Riverside",
  last_gift_on: null,
  open_pledge_cents: 1200,
  open_pledge: "$12.00",
});
const patel2: GivingHousehold = { ...patel, id: "h-patel-2", number: "0412", orgId: "RCC-H-1412", primary: "Meera Patel", cardLine: "No. 0412 · RCC-H-1412 · Meera Patel · Lakeside" };
const otieno: GivingHousehold = { id: "h-otieno", name: "Otieno household", number: "0031", orgId: null, primary: "Grace Otieno", city: "Kisumu", cardLine: "No. 0031 · Grace Otieno · Kisumu" };

const found = (over: Partial<GivingFound>): GivingFound => ({ ...EMPTY_FOUND, cards: new Map([patel, patel2, otieno].map((f) => [f.id, f])), ...over });
const opts = { currency: "USD", locale: "en-US", timeZone: "America/Chicago", canRecord: true };

describe("reading a payment to record", () => {
  it("reads '200 check patel': a check, $200.00, the family to look for", () => {
    const i = record(read("200 check patel"));
    expect(i.cents).toBe(20000);
    expect(i.ask.method).toBe("check");
    expect(i.who).toBe("patel");
  });

  it("reads the method, the date, the reference and who from a full sentence", () => {
    const i = record(read("received $1,250.50 zelle from household 0127 yesterday ref ZL88412"));
    expect(i.cents).toBe(125050);
    expect(i.ask.method).toBe("zelle");
    expect(i.ask.receivedOn).toBe("2026-10-12");
    expect(i.ask.reference).toBe("ZL88412");
    expect(i.who).toBe("0127");
  });

  it("needs a payment word, or a method with an amount: a name alone or a number alone is not a payment", () => {
    expect(read("patel", USD, "people")).toBeNull();
    expect(read("check patel", USD, "people")).toBeNull();
    expect(record(read("record payment patel")).cents).toBeNull();
    expect(record(read("record payment patel")).who).toBe("patel");
  });

  it("works for a non-faith club in Kenyan shillings, its own way of writing money left out of the name", () => {
    const i = record(readGivingIntent("Ksh 5,000 cash Otieno", { today: TODAY, fmt: KES, scope: "people" }));
    expect(i.cents).toBe(500000);
    expect(i.ask.method).toBe("cash");
    expect(i.who).toBe("Otieno");
  });

  it("reads Indian digit grouping as it is meant", () => {
    expect(record(read("₹2,00,000 check from Iyer", INR)).cents).toBe(20000000);
  });

  it("reads a decimal comma where the community writes one, and only there", () => {
    expect(usesDecimalComma("en-DE")).toBe(true);
    expect(usesDecimalComma("en-US")).toBe(false);
    expect(normalizeAmounts("200,50 cash Müller", true)).toBe("200.50 cash Müller");
    expect(normalizeAmounts("1.234,56 check", true)).toBe("1234.56 check");
    expect(normalizeAmounts("1,250.50 check", false)).toBe("1,250.50 check");
    expect(record(read("200,50 cash Müller", EUR_DE)).cents).toBe(20050);
    expect(record(read("1.234,56 check Weber", EUR_DE)).cents).toBe(123456);
  });

  it("a pledge to record is recognised; a pledge number is looked up", () => {
    expect(read("pledge 500 patel building fund")?.kind).toBe("pledge");
    const lookup = read("pledge 20455");
    expect(lookup?.kind).toBe("lookup");
    expect(lookup && lookup.kind === "lookup" ? lookup.numbered : null).toEqual({ field: "pledge", value: "20455" });
  });
});

describe("reading refunds, write-offs and lookups", () => {
  it("finds receipt and pledge numbers by shape, with no prefix assumed", () => {
    expect(codeTokens("R-2026-0388")).toEqual(["R-2026-0388"]);
    expect(codeTokens("PL20455 please")).toEqual(["PL20455"]);
    expect(codeTokens("2026-0388")).toEqual(["2026-0388"]);
    expect(codeTokens("on the 3rd")).toEqual([]);
    expect(codeTokens("$200")).toEqual([]);
  });

  it("reads 'refund R-2026-0388' and 'write off PL-20455'", () => {
    expect(read("refund R-2026-0388")).toEqual({ kind: "refund", token: "R-2026-0388", who: null });
    expect(read("write off PL-20455")).toEqual({ kind: "write_off", token: "PL-20455", who: null });
    expect(read("write-off patel")).toEqual({ kind: "write_off", token: null, who: "patel" });
  });

  it("an amount alone is an amount in Giving; elsewhere only with its currency (a bare number is a member number there)", () => {
    expect(read("200")).toMatchObject({ kind: "lookup", cents: 20000 });
    expect(read("200", USD, "people")).toBeNull();
    expect(read("$200", USD, "people")).toMatchObject({ kind: "lookup", cents: 20000 });
    expect(read("KES 5,000 yesterday", KES, "people")).toMatchObject({ kind: "lookup", cents: 500000, date: "2026-10-12" });
  });

  it("words are looked up as campaigns and bank lines in Giving only; a question is never Giving's", () => {
    expect(read("building fund")).toMatchObject({ kind: "lookup", words: "building fund" });
    expect(read("building fund", USD, "people")).toBeNull();
    expect(read("who gave 200 last week?")).toBeNull();
  });
});

describe("the lane's rows", () => {
  it("one family: one row that names the amount, the method and the family with its card, and opens the sheet filled in", () => {
    const lane = buildGivingLane(record(read("200 check patel")), found({ families: [patel] }), opts);
    expect(lane.first).toBe(true);
    expect(lane.understood).toBe("record a $200.00 check for the Patel household 0127");
    expect(lane.rows).toHaveLength(1);
    const row = lane.rows[0];
    expect(row.kind).toBe("record");
    expect(row.title).toBe("Record $200.00 check for the Patel household 0127");
    const act = givingEnter(row);
    expect(act.type).toBe("record-payment");
    if (act.type === "record-payment") {
      expect(act.request.household?.id).toBe("h-patel");
      expect(act.request.prefill).toMatchObject({ amount: "200.00", method: "check" });
      expect(act.href).toBe("/giving/payments?household=h-patel");
    }
  });

  it("two families: a 'choose the family' row with both cards, then one row per family", () => {
    const lane = buildGivingLane(record(read("200 check patel")), found({ families: [patel, patel2] }), opts);
    expect(lane.rows.map((r) => r.title)).toEqual([
      "Record $200.00 check: choose the family",
      "Record $200.00 check for the Patel household 0127",
      "Record $200.00 check for the Patel household 0412",
    ]);
    const choose = lane.rows[0];
    expect(choose.kind === "record" ? choose.request.candidates?.map((f) => f.id) : null).toEqual(["h-patel", "h-patel-2"]);
  });

  it("says cash without an article, and a check with one", () => {
    const cash = buildGivingLane(record(read("50 cash patel")), found({ families: [patel] }), opts);
    expect(cash.understood).toBe("record $50.00 cash for the Patel household 0127");
    expect(buildGivingLane(record(read("record ach payment")), found({}), opts).understood).toBe("record an ACH payment");
  });

  it("no family: the sheet opens on the family search; without the permission it says so and offers nothing", () => {
    const none = buildGivingLane(record(read("200 check zzz")), found({}), opts);
    expect(none.rows[0].detail).toContain("No family matches “zzz”");
    const cannot = buildGivingLane(record(read("200 check patel")), found({ families: [patel] }), { ...opts, canRecord: false });
    expect(cannot.rows).toHaveLength(0);
    expect(cannot.notes[0]).toContain("needs the giving.record_offline or giving.manage permission");
  });

  it("a pledge to record needs giving.manage; with it the Record pledge sheet opens filled in (slice 7)", () => {
    const cannot = buildGivingLane(read("pledge 500 patel building fund") as GivingIntent, found({ families: [patel] }), opts);
    expect(cannot.rows).toHaveLength(0);
    expect(cannot.notes).toEqual(["Recording a pledge needs the giving.manage permission."]);
    const lane = buildGivingLane(read("pledge 500 patel building fund") as GivingIntent, found({ families: [patel] }), { ...opts, canRecordPledge: true });
    expect(lane.rows[0]).toMatchObject({ kind: "record_pledge", title: "Record a $500.00 pledge for the Patel household 0127", best: true });
  });

  it("a refund opens Payments on that receipt, with the family's card; a write-off opens Pledges", () => {
    const pay = { id: "p1", receipt: "R-2026-0388", amountCents: 20000, refundedCents: 0, method: "check", status: "captured", receivedOn: "2026-10-03", householdId: "h-patel" };
    const lane = buildGivingLane(read("refund R-2026-0388") as GivingIntent, found({ payments: [pay] }), opts);
    expect(lane.rows[0]).toMatchObject({ kind: "go", href: "/giving/payments?q=R-2026-0388", title: "Ask for a refund of R-2026-0388 ($200.00) for the Patel household 0127" });
    const wo = buildGivingLane(read("write off PL-20455") as GivingIntent, found({}), opts);
    expect(wo.rows[0]).toMatchObject({ kind: "go", href: "/giving/pledges?q=PL-20455" });
  });

  it("a payment found by receipt opens its family's giving in place, the payment first; without a readable card it names no one", () => {
    const pay = { id: "p1", receipt: "R-2026-0388", amountCents: 20000, refundedCents: 0, method: "check", status: "captured", receivedOn: "2026-10-03", householdId: "h-patel" };
    const lane = buildGivingLane(read("R-2026-0388") as GivingIntent, found({ payments: [pay] }), opts);
    expect(lane.understood).toBe("a receipt or pledge number");
    expect(lane.rows[0].title).toBe("R-2026-0388 · $200.00 Check");
    expect(givingEnter(lane.rows[0])).toEqual({ type: "family-giving", householdId: "h-patel", focus: { kind: "payment", id: "p1" }, href: "/giving/payments?q=R-2026-0388" });
    const hidden = buildGivingLane(read("R-2026-0388") as GivingIntent, { ...found({ payments: [{ ...pay, householdId: "h-unknown" }] }) }, opts);
    expect(hidden.rows[0].detail).toContain("Household card not available to your role");
    expect(JSON.stringify(hidden.rows[0])).not.toContain("Patel");
    expect(givingEnter(hidden.rows[0])).toEqual({ type: "open", href: "/giving/payments?q=R-2026-0388" });
  });

  it("money in another currency is written the community's way", () => {
    const lane = buildGivingLane(record(readGivingIntent("Ksh 5,000 cash Otieno", { today: TODAY, fmt: KES, scope: "giving" })), found({ families: [otieno] }), {
      ...opts,
      currency: "KES",
      locale: "en-KE",
    });
    expect(lane.rows[0].title.replace(/\s/g, " ")).toBe("Record Ksh 5,000.00 cash for the Otieno household 0031");
  });
});

describe("the box draws the Giving lane", () => {
  const family = (id: string): FindRow => ({ kind: "family", id, title: "Patel", cardLine: "No. 0127", why: { code: "name", label: "Name" }, href: `/households/${id}`, score: 80 });
  const child: FindRow = { kind: "person", id: "c1", householdId: "h-patel", title: "Kiran Patel", subtitle: "Child · staff only", familyName: "Patel", cardLine: "No. 0127", child: true, why: { code: "name", label: "Name" }, href: "/households/h-patel?person=c1", score: 70 };
  const resp = (over: Partial<FindResponse>): FindResponse => ({ query: "x", kind: "name", rows: [], more: 0, filter: null, problem: null, ...over });

  it("puts money rows first and says what it understood; Enter opens the sheet, never a save", () => {
    const lane = buildGivingLane(record(read("200 check patel")), found({ families: [patel] }), opts);
    const ui = buildUiRows(resp({ giving: lane }), { niva: "off", scope: "giving" });
    expect(ui.understood).toBe("record a $200.00 check for the Patel household 0127");
    expect(ui.rows[0].type).toBe("giving");
    expect(enterAction(ui.rows, 0, { scope: "giving" }).type).toBe("record-payment");
    expect(ui.rows.some((r) => r.type === "message" && r.text.startsWith("No family or person matches"))).toBe(false);
  });

  it("in Giving a family opens its giving in place, and a child's row is not drawn at all", () => {
    const ui = buildUiRows(resp({ rows: [family("h-patel"), child] }), { niva: "off", scope: "giving" });
    expect(selectable(ui.rows).map((r) => r.key)).toEqual(["f-h-patel"]);
    expect(enterAction(ui.rows, 0, { scope: "giving" })).toEqual({ type: "family-giving", householdId: "h-patel", focus: null, href: "/households/h-patel" });
    const people = buildUiRows(resp({ rows: [family("h-patel"), child] }), { niva: "off" });
    expect(selectable(people.rows)).toHaveLength(2);
    expect(enterAction(people.rows, 0)).toEqual({ type: "open", href: "/households/h-patel", familyId: "h-patel" });
  });

  it("a lookup by words goes below the families", () => {
    const camp = { id: "c1", name: "Building fund", status: "active", goalCents: 5000000 };
    const lane = buildGivingLane(read("building") as GivingIntent, found({ campaigns: [camp] }), opts);
    const ui = buildUiRows(resp({ rows: [family("h-patel")], giving: lane }), { niva: "off", scope: "giving" });
    expect(ui.rows.map((r) => r.type)).toEqual(["family", "giving"]);
    expect(enterAction(ui.rows, 1, { scope: "giving" })).toEqual({ type: "open", href: "/giving/campaigns", familyId: null });
  });

  it("'new campaign …' and 'new opportunity …' open the quick-create sheet named, for those who may create (slice 6)", () => {
    const camp = read("new campaign Building fund", USD, "people");
    expect(camp).toEqual({ kind: "create", cmd: { what: "campaign", name: "Building fund" } });
    const can = { ...opts, canCreate: { campaign: true, opportunity: true } };
    const lane = buildGivingLane(camp as GivingIntent, EMPTY_FOUND, can);
    expect(lane).toMatchObject({ understood: "a new campaign “Building fund”", first: true, notes: [] });
    expect(lane.rows).toHaveLength(1);
    expect(lane.rows[0]).toMatchObject({ kind: "go", title: "New campaign “Building fund”" });
    expect(givingEnter(lane.rows[0])).toEqual({ type: "open", href: "/giving/campaigns?new=campaign&name=Building+fund" });
    const opp = buildGivingLane(read("create an opportunity: Gala tables") as GivingIntent, EMPTY_FOUND, can);
    expect(givingEnter(opp.rows[0])).toEqual({ type: "open", href: "/giving/campaigns?view=opportunities&new=opportunity&name=Gala+tables" });
    // Someone who may not create is told why, and nothing opens.
    const no = buildGivingLane(read("new opportunity Gala") as GivingIntent, EMPTY_FOUND, { ...opts, canCreate: { campaign: true, opportunity: false } });
    expect(no.rows).toEqual([]);
    expect(no.notes[0]).toContain("needs giving.manage and the Opportunities module");
    // "new pledge …" is still a pledge, and words about a campaign are still a lookup.
    expect(read("new pledge 500 patel")?.kind).toBe("pledge");
    expect(read("campaign building")?.kind).toBe("lookup");
  });
});
