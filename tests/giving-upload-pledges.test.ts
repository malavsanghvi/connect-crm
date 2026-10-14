import { describe, expect, it } from "vitest";

import type { Family } from "@/lib/giving-today/queue";
import { hitsFrom, matchHousehold, nameDisagrees, type HouseholdHit } from "@/lib/giving-upload/households";
import {
  emailPlan,
  emailPlanSentence,
  findAdult,
  lookupValues,
  pledgeColumns,
  pledgeTemplateRows,
  readPledgeLines,
  recordButtonLabel,
  reviewPledges,
  reviewSummary,
  uploadRows,
  type PledgeLookups,
} from "@/lib/giving-upload/pledges";
import { conventionsFor, mapColumns, readAmount, readDate, tableFromCells, type UploadTable } from "@/lib/giving-upload/sheet";

// Upload pledges (GV-U slice B). Every row is a household's pledge, found by an identifier of any kind and never by a name alone;
// a child is never named; every pledge gets a due date; a repeat waits for the person.

const TODAY = "2026-10-13";
const LABELS = { orgMemberLabel: "Member ID", orgHouseholdLabel: "Household ID" };
const US = conventionsFor({ currency: "USD", locale: "en-US" });
const UK = conventionsFor({ currency: "GBP", locale: "en-GB" });
const IN = conventionsFor({ currency: "INR", locale: "en-IN" });
const DE = conventionsFor({ currency: "EUR", locale: "en-DE" });

const fam = (id: string, name: string, number: string, primary: string | null = null): Family => ({ id, name, number, orgId: null, primary, city: null });
const ADEYEMI = fam("h-1", "Adeyemi", "0127", "Tunde Adeyemi");
const OKAFOR = fam("h-2", "Okafor", "0388", "Ngozi Okafor");
const OKAFOR2 = fam("h-3", "Okafor", "0390", "Chidi Okafor");
const LIN = fam("h-4", "Lin household", "0441", "Mei Lin");

const hit = (input: string, matchKind: string, family: Family, personId: string | null = null): HouseholdHit => ({
  input,
  matchKind,
  householdId: family.id,
  personId,
  family,
});

const HITS: HouseholdHit[] = [
  hit("0127", "connect_household", ADEYEMI),
  hit("M-0417", "connect_member", OKAFOR, "p-ngozi"),
  hit("NEON-55", "crm", LIN),
  hit("QB-1187", "accounting", OKAFOR),
  hit("OKAFOR N", "bank_payer", OKAFOR),
  hit("OKAFOR N", "bank_payer", OKAFOR2),
  hit("Okafor", "name", OKAFOR),
  hit("Okafor", "name", OKAFOR2),
  hit("Lin", "name", LIN),
  hit("M-0999", "connect_member", ADEYEMI, "p-kid"),
];

const lookups = (over: Partial<PledgeLookups> = {}): PledgeLookups => ({
  today: TODAY,
  dueDays: 30,
  currency: "USD",
  locale: "en-US",
  labels: LABELS,
  household: "household",
  hits: HITS,
  targets: [
    { kind: "fund", id: "f-1", name: "Building fund" },
    { kind: "campaign", id: "c-1", name: "New hall" },
    { kind: "opportunity", id: "o-1", name: "Name a classroom" },
  ],
  adults: {
    "h-1": [{ id: "p-tunde", name: "Tunde Adeyemi" }, { id: "p-bola", name: "Bola Adeyemi" }],
    "h-2": [{ id: "p-ngozi", name: "Ngozi Okafor" }],
    "h-3": [{ id: "p-chidi", name: "Chidi Okafor" }],
    "h-4": [{ id: "p-mei", name: "Mei Lin" }],
  },
  existing: [{ number: "PL-0455", householdId: "h-2", amountCents: 80_000, campaignId: "c-1", fundId: "f-1", opportunityId: null, pledgedOn: "2026-10-01" }],
  ...over,
});

const table = (headers: string[], rows: string[][], source: "csv" | "xlsx" = "csv"): UploadTable => ({
  fileName: "pledges.csv",
  source,
  headers,
  rows: rows.map((cells, i) => ({ line: i + 2, cells })),
});

const H = ["Household ID", "Amount", "For", "Pledged on", "Due on", "Pledged by", "Dedication", "Note"];
const read = (rows: string[][], conv = US) => readPledgeLines(table(H, rows), conv, TODAY, { household: "household" });

describe("the file", () => {
  it("finds the heading row under a title line, skips blank rows, keeps each row's line, and refuses more than 500 rows", () => {
    const t = tableFromCells("x.csv", "csv", [["Pledges from the dinner"], H, ["0127", "500"], ["", ""], ["0388", "250"]]);
    expect(t.ok && t.value.headers).toEqual(H);
    expect(t.ok && t.value.rows.map((r) => r.line)).toEqual([3, 5]);
    const big = tableFromCells("x.csv", "csv", [H, ...Array.from({ length: 501 }, () => ["0127", "1"])]);
    expect(big).toEqual({ ok: false, error: "The file has 501 rows; an upload holds at most 500. Split it and upload each part." });
    expect(tableFromCells("x.csv", "csv", [H])).toEqual({ ok: false, error: "The file has headings but no rows under them." });
  });

  it("maps the community's headings and the usual other names, each heading once", () => {
    const cols = pledgeColumns({ household: "family" });
    expect(cols[0].header).toBe("Family ID");
    const m = mapColumns(["Constituent ID", "Name", "Pledge Amount", "Fund", "Due date", "Something else"], cols);
    expect(m.at).toMatchObject({ household: 0, name_check: 1, amount: 2, for: 3, due_on: 4 });
    expect(m.ignored).toEqual(["Something else"]);
    expect(mapColumns(["Notes"], cols).missing).toEqual(["household", "amount"]);
  });

  it("writes the template in the community's own money and dates", () => {
    const us = pledgeTemplateRows({ household: "household" }, US, { forName: "Building fund" });
    expect(us[0][0]).toBe("Household ID");
    expect(us[1]).toContain("10/12/2026");
    expect(us[1]).toContain("500.00");
    const de = pledgeTemplateRows({ household: "household" }, DE, { forName: null });
    expect(de[1]).toContain("12/10/2026");
    expect(de[2]).toContain("1250,50");
  });
});

describe("money and dates in any community", () => {
  it("reads the community's currency and decimal convention", () => {
    expect(readAmount("$1,250.50", US, "csv")).toEqual({ ok: true, value: 125_050 });
    expect(readAmount("USD 80", US, "csv")).toEqual({ ok: true, value: 8_000 });
    expect(readAmount("£12", UK, "csv")).toEqual({ ok: true, value: 1_200 });
    expect(readAmount("₹1,25,000", IN, "csv")).toEqual({ ok: true, value: 12_500_000 });
    expect(readAmount("1.250,50", DE, "csv")).toEqual({ ok: true, value: 125_050 });
    expect(readAmount("EUR 1.250", DE, "csv")).toEqual({ ok: true, value: 125_000 });
    expect(readAmount("1250.5", DE, "xlsx")).toEqual({ ok: true, value: 125_050 });
    expect(readAmount("1.250,50", US, "csv")).toMatchObject({ ok: false });
    expect(readAmount("0", US, "csv")).toEqual({ ok: false, error: "must be more than zero" });
    expect(readAmount("abc", US, "csv")).toEqual({ ok: false, error: "“abc” is not an amount" });
  });

  it("reads dates in the community's order; an ISO date always", () => {
    expect(US.dateOrder).toBe("mdy");
    expect(UK.dateOrder).toBe("dmy");
    expect(IN.dateOrder).toBe("dmy");
    expect(readDate("03/04/2026", US)).toEqual({ ok: true, value: "2026-03-04" });
    expect(readDate("03/04/2026", UK)).toEqual({ ok: true, value: "2026-04-03" });
    expect(readDate("2026-12-31", UK)).toEqual({ ok: true, value: "2026-12-31" });
    expect(readDate("31/02/2026", UK)).toMatchObject({ ok: false, error: expect.stringMatching(/write it like 31\/12\/2026/) });
  });
});

describe("which household", () => {
  it("matches one household by any identifier, and says which", () => {
    expect(matchHousehold("0127", HITS, LABELS)).toEqual({ status: "matched", family: ADEYEMI, via: "Household no. 0127", personId: null });
    expect(matchHousehold("M-0417", HITS, LABELS)).toMatchObject({ status: "matched", family: OKAFOR, via: "Member no. M-0417", personId: "p-ngozi" });
    expect(matchHousehold("NEON-55", HITS, LABELS)).toMatchObject({ status: "matched", family: LIN, via: "Legacy CRM id NEON-55" });
    expect(matchHousehold("QB-1187", HITS, LABELS)).toMatchObject({ status: "matched", via: "Accounting (QuickBooks) customer QB-1187" });
  });

  it("never chooses by a name, and asks for a pick when two households share an ID", () => {
    expect(matchHousehold("OKAFOR N", HITS, LABELS)).toEqual({ status: "pick", why: "shared", candidates: [OKAFOR, OKAFOR2] });
    expect(matchHousehold("Okafor", HITS, LABELS)).toEqual({ status: "pick", why: "name", candidates: [OKAFOR, OKAFOR2] });
    expect(matchHousehold("Lin", HITS, LABELS)).toEqual({ status: "pick", why: "name", candidates: [LIN] });
    expect(matchHousehold("9999", HITS, LABELS)).toEqual({ status: "none" });
  });

  it("checks the optional name against the household and its primary adult", () => {
    expect(nameDisagrees("Adeyemi", ADEYEMI)).toBe(false);
    expect(nameDisagrees("Mr Tunde A.", ADEYEMI)).toBe(false);
    expect(nameDisagrees("The Patel family", ADEYEMI)).toBe(true);
    expect(nameDisagrees("", ADEYEMI)).toBe(false);
  });

  it("reads the database's rows into hits", () => {
    const rows = hitsFrom([
      { input: "0127", match_kind: "connect_household", household_id: "h-1", person_id: null, household_name: "Adeyemi", household_number: "0127", org_household_id: null, primary_member: "Tunde Adeyemi", city: "Leeds" },
      { input: null, match_kind: null, household_id: null, person_id: null, household_name: null, household_number: null, org_household_id: null, primary_member: null, city: null },
    ]);
    expect(rows).toEqual([{ input: "0127", matchKind: "connect_household", householdId: "h-1", personId: null, family: { ...ADEYEMI, city: "Leeds" } }]);
  });
});

describe("the review", () => {
  it("gets every row ready with its household, purpose, dates and the default due date", () => {
    const r = reviewPledges(
      read([
        ["0127", "500", "Building fund", "10/01/2026", "12/31/2026", "Bola Adeyemi", "", "card 14"],
        ["NEON-55", "1,250.50", "", "", "", "", "In memory of Ba", ""],
        ["M-0417", "200", "Name a classroom", "", "", "", "", ""],
      ]),
      lookups(),
    );
    expect(r.rows.map((x) => x.status)).toEqual(["ready", "ready", "ready"]);
    expect(r.rows[0]).toMatchObject({ family: ADEYEMI, target: { kind: "fund", id: "f-1" }, pledgedOn: "2026-10-01", dueOn: "2026-12-31", dueIsDefault: false, pledgedBy: { id: "p-bola" } });
    expect(r.rows[1]).toMatchObject({ family: LIN, target: null, forLabel: "General (no fund)", pledgedOn: TODAY, dueOn: "2026-11-12", dueIsDefault: true });
    // Found by Ngozi's own member ID: she pledged.
    expect(r.rows[2].pledgedBy).toEqual({ id: "p-ngozi", name: "Ngozi Okafor" });
    expect(r.tickedCount).toBe(3);
    expect(r.tickedCents).toBe(50_000 + 125_050 + 20_000);
    expect(recordButtonLabel(r, "USD", "en-US")).toBe("Record 3 pledges, $1,950.50");
    expect(reviewSummary(r)).toBe("3 ready");
  });

  it("says what the email tick will do: how many families, and which ticked rows are old pledge cards (they are emailed too, 0794)", () => {
    const r = reviewPledges(
      read([
        ["0127", "500", "", "", "", "", "", ""],
        ["0127", "600", "", "10/01/2026", "", "", "", ""],
        ["NEON-55", "700", "", "01/05/2024", "", "", "", ""],
        ["M-0417", "200", "", "10/05/2026", "", "", "", ""],
      ]),
      lookups(),
    );
    const plan = emailPlan(r, TODAY);
    expect(plan).toEqual({ rows: 4, families: 3, old: 1 });
    expect(emailPlanSentence(plan)).toBe("The ticked rows email 3 families, 1 of them is dated more than 30 days ago and gets the email too.");
    expect(emailPlanSentence({ rows: 5, families: 4, old: 3 })).toBe("The ticked rows email 4 families, 3 of them are dated more than 30 days ago and get the email too.");
    expect(emailPlanSentence({ rows: 1, families: 1, old: 0 })).toBe("The ticked rows email 1 family.");
    expect(emailPlanSentence({ rows: 0, families: 0, old: 0 })).toBe("");
    // An unticked row is not counted.
    const unticked = reviewPledges(read([["0127", "500", "", "01/05/2024", "", "", "", ""]]), lookups(), { picks: {}, ticks: { 2: false } });
    expect(emailPlan(unticked, TODAY)).toEqual({ rows: 0, families: 0, old: 0 });
  });

  it("counts the due date from the community's own rule", () => {
    const r = reviewPledges(read([["0127", "500", "", "10/01/2026", "", "", "", ""]]), lookups({ dueDays: 14 }));
    expect(r.rows[0].dueOn).toBe("2026-10-15");
  });

  it("asks for a pick on a name or a shared ID, and records nothing for it until picked", () => {
    const rows = read([
      ["Okafor", "100", "", "", "", "", "", ""],
      ["OKAFOR N", "150", "", "", "", "", "", ""],
    ]);
    const r = reviewPledges(rows, lookups());
    expect(r.rows.map((x) => [x.status, x.ticked])).toEqual([["pick", false], ["pick", false]]);
    expect(r.rows[0].warnings[0]).toMatch(/a name alone never chooses one/);
    expect(r.rows[1].warnings[0]).toMatch(/2 households have “OKAFOR N”/);
    expect(uploadRows(r)).toEqual([]);
    const picked = reviewPledges(rows, lookups(), { picks: { 2: "h-3" }, ticks: {} });
    expect(picked.rows[0]).toMatchObject({ status: "ready", ticked: true, family: OKAFOR2, via: "Picked by you" });
    expect(uploadRows(picked).map((x) => x.household_id)).toEqual(["h-3"]);
  });

  it("never names a child: a pledger who is not an adult of the household is a problem that does not repeat the name", () => {
    const r = reviewPledges(read([["0127", "500", "", "", "", "Kavi", "", ""]]), lookups());
    expect(r.rows[0].status).toBe("problem");
    expect(r.rows[0].problems.join(" ")).not.toContain("Kavi");
    expect(r.rows[0].problems[0]).toMatch(/not one adult of this household/);
    // Found by a child's own member ID: the pledge is the household's, nobody is named.
    const viaChild = reviewPledges(read([["M-0999", "500", "", "", "", "", "", ""]]), lookups());
    expect(viaChild.rows[0]).toMatchObject({ status: "ready", pledgedBy: null });
  });

  it("says what is wrong with a row in plain words", () => {
    const r = reviewPledges(
      read([
        ["", "100", "", "", "", "", "", ""],
        ["0127", "ten", "", "", "", "", "", ""],
        ["0127", "100", "Roof appeal", "", "", "", "", ""],
        ["0127", "100", "", "12/01/2026", "", "", "", ""],
        ["0127", "100", "", "10/01/2026", "09/01/2026", "", "", ""],
        ["0000", "100", "", "", "", "", "", ""],
      ]),
      lookups(),
    );
    expect(r.rows.every((x) => x.status === "problem" && !x.ticked)).toBe(true);
    expect(r.rows[0].problems[0]).toMatch(/^No household/);
    expect(r.rows[1].problems[0]).toBe("Amount “ten” is not an amount.");
    expect(r.rows[2].problems[0]).toMatch(/No fund, campaign or opportunity open for pledges is called “Roof appeal”/);
    expect(r.rows[2].forLabel).toBe("“Roof appeal” (not found)");
    expect(r.rows[3].problems[0]).toMatch(/in the future/);
    expect(r.rows[4].problems[0]).toMatch(/before the day it was pledged/);
    expect(r.rows[5].problems[0]).toMatch(/No household has the ID “0000”/);
    expect(recordButtonLabel(r, "USD", "en-US")).toBe("Tick the rows to record");
  });

  it("leaves a repeat (a pledge already recorded, or an earlier row) unticked until the person says so", () => {
    const rows = read([
      ["M-0417", "800", "New hall", "10/01/2026", "", "", "", ""],
      ["0127", "75", "", "", "", "", "", ""],
      ["0127", "75", "", "", "", "", "", ""],
    ]);
    const r = reviewPledges(rows, lookups());
    expect(r.rows.map((x) => [x.status, x.ticked, x.repeatOf])).toEqual([
      ["repeat", false, "PL-0455"],
      ["ready", true, null],
      ["repeat", false, "line 3 of this file"],
    ]);
    const anyway = reviewPledges(rows, lookups(), { picks: {}, ticks: { 2: true } });
    expect(uploadRows(anyway).find((x) => x.row === 2)).toMatchObject({ repeat_ok: true, household_id: "h-2", campaign_id: "c-1" });
    expect(reviewSummary(r)).toBe("1 ready · 2 possible repeats");
  });

  it("asks the person to look when the name in the file does not match the household", () => {
    const t = table(["Household ID", "Name (to check)", "Amount"], [["0127", "Patel", "50"]]);
    const r = reviewPledges(readPledgeLines(t, US, TODAY, { household: "household" }), lookups());
    expect(r.rows[0]).toMatchObject({ status: "check", ticked: false });
    expect(r.rows[0].warnings[0]).toMatch(/“Patel” does not match the Adeyemi 0127|does not match Adeyemi 0127/);
  });

  it("finds the adult by member ID, full name or a unique first name", () => {
    const lk = lookups({ hits: [...HITS, hit("M-0500", "connect_member", ADEYEMI, "p-bola")] });
    expect(findAdult("M-0500", "h-1", lk)).toEqual({ ok: true, adult: { id: "p-bola", name: "Bola Adeyemi" } });
    expect(findAdult("tunde adeyemi", "h-1", lk)).toEqual({ ok: true, adult: { id: "p-tunde", name: "Tunde Adeyemi" } });
    expect(findAdult("Bola", "h-1", lk)).toEqual({ ok: true, adult: { id: "p-bola", name: "Bola Adeyemi" } });
    expect(findAdult("", "h-1", lk)).toEqual({ ok: true, adult: null });
    expect(findAdult("Ngozi", "h-1", lk)).toMatchObject({ ok: false });
  });

  it("works for a non-faith community in pounds, day first", () => {
    const r = reviewPledges(read([["0127", "£80", "Building fund", "01/10/2026", "", "", "", ""]], UK), lookups({ currency: "GBP", locale: "en-GB" }));
    expect(r.rows[0]).toMatchObject({ status: "ready", pledgedOn: "2026-10-01", dueOn: "2026-10-31", amountCents: 8_000 });
    expect(recordButtonLabel(r, "GBP", "en-GB")).toBe("Record 1 pledge, £80.00");
  });

  it("sends the database exactly the ticked rows, as the person saw them", () => {
    const r = reviewPledges(read([["0127", "500", "Building fund", "10/01/2026", "", "Tunde", "In memory", "card 3"]]), lookups());
    expect(uploadRows(r)).toEqual([
      {
        row: 2,
        household_id: "h-1",
        amount_cents: 50_000,
        fund_id: "f-1",
        campaign_id: null,
        opportunity_id: null,
        pledged_on: "2026-10-01",
        due_on: "2026-10-31",
        pledged_by_person_id: "p-tunde",
        dedication: "In memory",
        note: "card 3",
        repeat_ok: false,
      },
    ]);
    const unticked = reviewPledges(read([["0127", "500", "", "", "", "", "", ""]]), lookups(), { picks: {}, ticks: { 2: false } });
    expect(uploadRows(unticked)).toEqual([]);
  });

  it("looks up every household and pledger value once", () => {
    expect(lookupValues(read([["0127", "1", "", "", "", "M-0500", "", ""], ["0127", "2", "", "", "", "", "", ""]]).lines)).toEqual(["0127", "M-0500"]);
  });
});
