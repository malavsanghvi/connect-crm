import { describe, expect, it } from "vitest";

import { autoMap, buildRow, convertCustom, customKeyFor, DEFAULT_OPTIONS, inferCustomType, missingRequired, normHeader, summarize } from "@/lib/import/mapping";
import { isCategorical, maskedSamples, maskValue } from "@/lib/import/mask";
import { entityDef } from "@/lib/import/registry";
import { csvCell, dictionaryCsv, problemRowsCsv, templateCsv } from "@/lib/import/templates";
import { splitName, toBoolean, toCents, toDate, toDateTime, toE164, toEnum, toIdentifier, toTime } from "@/lib/import/transforms";

const TODAY = "2026-09-24";

describe("transforms", () => {
  it("keeps identifiers as text with their leading zeros", () => {
    expect(toIdentifier(" 0417 ")).toEqual({ ok: true, value: "0417" });
    expect(toIdentifier("")).toMatchObject({ ok: false });
  });

  it("puts phone numbers in E.164", () => {
    expect(toE164("(713) 555-0142")).toEqual({ ok: true, value: "+17135550142" });
    expect(toE164("1-713-555-0142 x12")).toEqual({ ok: true, value: "+17135550142" });
    expect(toE164("+91 98250 12345")).toEqual({ ok: true, value: "+919825012345" });
    expect(toE164("0091 98250 12345")).toEqual({ ok: true, value: "+919825012345" });
    expect(toE164("555-0142")).toMatchObject({ ok: false });
  });

  it("reads dates in the common export formats", () => {
    expect(toDate("2019-08-30")).toEqual({ ok: true, value: "2019-08-30" });
    expect(toDate("8/30/2019")).toEqual({ ok: true, value: "2019-08-30" });
    expect(toDate("30/8/2019")).toEqual({ ok: true, value: "2019-08-30" }); // an unambiguous day wins
    expect(toDate("03/04/2020", "dmy")).toEqual({ ok: true, value: "2020-04-03" });
    expect(toDate("12-Apr-1986")).toEqual({ ok: true, value: "1986-04-12" });
    expect(toDate("April 12, 1986")).toEqual({ ok: true, value: "1986-04-12" });
    expect(toDate("2/30/2020")).toMatchObject({ ok: false });
    expect(toDate("43831")).toEqual({ ok: true, value: "2020-01-01" }); // Excel serial
    expect(toDate("1/2/50", "mdy", new Date("2026-01-01"))).toEqual({ ok: true, value: "1950-01-02" });
    expect(toDate("1/2/25", "mdy", new Date("2026-01-01"))).toEqual({ ok: true, value: "2025-01-02" });
  });

  it("reads date-times", () => {
    expect(toDateTime("2026-10-18 11:00")).toMatchObject({ ok: true });
    expect(toDateTime("10/18/2026 2:30 pm")).toEqual({ ok: true, value: "2026-10-18T14:30:00.000Z" });
    expect(toTime("2:30 pm")).toEqual({ ok: true, value: "14:30:00" });
  });

  it("converts money to cents", () => {
    expect(toCents("$1,250.50")).toEqual({ ok: true, value: 125050 });
    expect(toCents("USD 10")).toEqual({ ok: true, value: 1000 });
    expect(toCents(12.5)).toEqual({ ok: true, value: 1250 });
    expect(toCents("0")).toMatchObject({ ok: false });
    expect(toCents("0", { allowZero: true })).toEqual({ ok: true, value: 0 });
    expect(toCents("-5")).toMatchObject({ ok: false });
  });

  it("translates the organization's words", () => {
    const opts = [
      { value: "life", label: "Life" },
      { value: "yearly", label: "Yearly" },
    ];
    expect(toEnum("Life Member", opts, { "Life Member": "life" })).toEqual({ ok: true, value: "life" });
    expect(toEnum("YEARLY", opts)).toEqual({ ok: true, value: "yearly" });
    expect(toEnum("Gold", opts)).toMatchObject({ ok: false });
    expect(toBoolean("Yes")).toEqual({ ok: true, value: true });
    expect(toBoolean("unsubscribed")).toEqual({ ok: true, value: false });
  });

  it("splits names", () => {
    expect(splitName("Shah, Rahul")).toEqual({ first: "Rahul", last: "Shah" });
    expect(splitName("Rahul K. Shah")).toEqual({ first: "Rahul K.", last: "Shah" });
    expect(splitName("Madonna")).toBeNull();
  });
});

describe("mapping", () => {
  const neonHeaders = ["Account ID", "First Name", "Last Name", "Email 1", "Phone 1 Number", "DOB", "Household ID", "Relationship", "Senior status", "Empty"];
  const rows = [
    ["0417", "Priya", "Shah", "priya@example.com", "(713) 555-0101", "04/12/1986", "0212", "Wife", "Yes", ""],
    ["0419", "Dev", "Shah", "", "", "", "0212", "Son", "No", ""],
    ["0420", "Nisha", "Rao", "nisha@example", "555", "2/30/1990", "0212", "Daughter", "No", ""],
  ];

  it("maps Neon export headers by name and synonyms, keeps extra columns as custom fields", () => {
    const m = autoMap("people", neonHeaders, rows);
    expect(m.columns[0]).toEqual({ kind: "field", field: "legacy_id" });
    expect(m.columns[3]).toEqual({ kind: "field", field: "email" });
    expect(m.columns[4]).toEqual({ kind: "field", field: "phone_e164" });
    expect(m.columns[5]).toEqual({ kind: "field", field: "date_of_birth" });
    expect(m.columns[6]).toEqual({ kind: "field", field: "household_legacy_id" });
    expect(m.columns[8]).toEqual({ kind: "custom", label: "Senior status", type: "boolean" });
    expect(m.columns[9]).toEqual({ kind: "skip" });
    expect(missingRequired(entityDef("people")!, m)).toEqual([]);
  });

  it("a saved mapping wins over name matching", () => {
    const m = autoMap("people", neonHeaders, rows, { columns: { [normHeader("Account ID")]: { kind: "field", field: "crm_id" } } });
    expect(m.columns[0]).toEqual({ kind: "field", field: "crm_id" });
  });

  it("checks rows: errors block, warnings don't, links become references", () => {
    const m = autoMap("people", neonHeaders, rows);
    const [a, b, c] = rows.map((r, i) => buildRow("people", m, neonHeaders, r, i + 2, TODAY));
    expect(a.problems).toEqual([]);
    expect(a.source_key).toBe("0417");
    expect(a.data).toMatchObject({ first_name: "Priya", email: "priya@example.com", phone_e164: "+17135550101", date_of_birth: "1986-04-12" });
    expect(a.extra).toMatchObject({ legacy_id: "0417", relationship: "spouse", household_id: { $ref: "household", value: "0212", by: "legacy" } });
    expect(a.custom).toEqual({ senior_status: true });
    expect(b.extra.relationship).toBe("child");
    expect(b.problems.map((p) => p.message)).toContain("A child without a birth date — add it so the rules for minors apply. Listed on the data-quality view.");
    expect(c.problems.every((p) => p.level === "warning")).toBe(true); // bad email, phone and date are left out, the row still imports
    expect(c.data.email).toBeUndefined();
    expect(summarize([a, b, c])).toMatchObject({ rows: 3, blocked: 0 });
  });

  it("counts only explicit email opt-ins with a date and a source; opt-outs always", () => {
    const headers = ["Person ID", "First name", "Last name", "Email", "Email opt-in", "Opt-in date", "Opt-in source"];
    const m = autoMap("people", headers, []);
    const withAll = buildRow("people", m, headers, ["1", "A", "B", "a@x.org", "Yes", "2024-03-01", "Form"], 2, TODAY);
    expect(withAll.extra.email_optin).toEqual({ opted_in: true, date: "2024-03-01", source: "Form" });
    const noDate = buildRow("people", m, headers, ["2", "A", "B", "a@x.org", "Yes", "", "Form"], 3, TODAY);
    expect(noDate.extra.email_optin).toBeUndefined();
    expect(noDate.problems[0].message).toMatch(/counts only with its date and its source/);
    const optOut = buildRow("people", m, headers, ["3", "A", "B", "a@x.org", "No", "", ""], 4, TODAY);
    expect(optOut.extra.email_optin).toEqual({ opted_in: false, date: null, source: "import" });
  });

  it("flags children under 13 by birth date", () => {
    const headers = ["Person ID", "First name", "Last name", "Birth date"];
    const r = buildRow("people", autoMap("people", headers, []), headers, ["9", "Kid", "Shah", "2018-01-01"], 2, TODAY);
    expect(r.problems[0]).toMatchObject({ level: "warning", message: expect.stringMatching(/Under 13/) });
  });

  it("uses a full name when there are no first and last name columns", () => {
    const headers = ["Person ID", "Name"];
    const m = autoMap("people", headers, []);
    expect(m.columns[1]).toEqual({ kind: "field", field: "full_name" });
    expect(missingRequired(entityDef("people")!, m)).toEqual([]);
    const r = buildRow("people", m, headers, ["5", "Shah, Mira"], 2, TODAY);
    expect(r.data).toMatchObject({ first_name: "Mira", last_name: "Shah" });
  });

  it("stops written-off pledges and over-applied payments with a plain error", () => {
    const ph = ["Pledge number", "Household ID", "Amount", "Status"];
    const p = buildRow("pledges", autoMap("pledges", ph, []), ph, ["PL-1", "0212", "$100", "Written off"], 2, TODAY);
    expect(p.problems[0]).toMatchObject({ level: "error", message: expect.stringMatching(/two approvers/) });
    const yh = ["Payment number", "Household ID", "Amount", "Method", "Received on", "Pledge number", "Amount applied to the pledge"];
    const y = buildRow("payments", autoMap("payments", yh, []), yh, ["R-1", "0212", "$100", "Cheque", "1/2/2020", "PL-1", "$150"], 2, TODAY);
    expect(y.data.method).toBe("check");
    expect(y.extra.allocate_to).toEqual({ $ref: "pledge", value: "PL-1" });
    expect(y.problems[0]).toMatchObject({ level: "error", message: expect.stringMatching(/more than the payment/) });
  });

  it("a missing required value is an error with its row", () => {
    const h = ["Fund key", "Fund name"];
    const r = buildRow("funds", autoMap("funds", h, []), h, ["general", ""], 7, TODAY);
    expect(r.problems).toEqual([{ level: "error", column: null, message: "Fund name is required." }]);
  });
});

describe("custom fields", () => {
  it("guesses the type from the values", () => {
    expect(inferCustomType(["Yes", "No", "yes"])).toEqual({ type: "boolean" });
    expect(inferCustomType(["$10", "$1,200.00"])).toEqual({ type: "money" });
    expect(inferCustomType(["12", "7.5"])).toEqual({ type: "number" });
    expect(inferCustomType(["0012", "0013"])).toEqual({ type: "text" }); // leading zeros: an ID, not a number
    expect(inferCustomType(["1/2/2020", "2020-03-04"])).toEqual({ type: "date" });
    expect(inferCustomType(["a@b.org"])).toEqual({ type: "email" });
    expect(inferCustomType(["Gold", "Silver", "Gold", "Silver"])).toEqual({ type: "choice", choices: ["Gold", "Silver"] });
    expect(inferCustomType([])).toEqual({ type: "text" });
  });

  it("converts values to their type", () => {
    expect(convertCustom("boolean", "Yes", undefined, DEFAULT_OPTIONS)).toEqual({ ok: true, value: true });
    expect(convertCustom("money", "$5", undefined, DEFAULT_OPTIONS)).toEqual({ ok: true, value: 500 });
    expect(convertCustom("choice", "gold", ["Gold"], DEFAULT_OPTIONS)).toEqual({ ok: true, value: "Gold" });
    expect(convertCustom("text", "  ", undefined, DEFAULT_OPTIONS)).toBeNull();
    expect(customKeyFor("Senior status")).toBe("senior_status");
    expect(customKeyFor("2nd phone")).toBe("field_2nd_phone");
  });
});

describe("masking for mapping suggestions", () => {
  it("masks personal values but keeps their shape", () => {
    expect(maskValue("1987-04-12")).toBe("1987-••-••");
    expect(maskValue("mira@example.com")).toBe("m•••@•••.com");
    expect(maskValue("(713) 555-0142")).toBe("(•••) •••-••42");
    expect(maskValue("Mira Shah")).toBe("M••• S•••");
    expect(maskValue("$1,250.00")).toBe("$•,•••.••");
  });

  it("sends category values as they are, and at most three samples", () => {
    expect(isCategorical(["Yes", "No", "Yes", "No"])).toBe(true);
    expect(isCategorical(["Mira", "Dev", "Anya", "Raj"])).toBe(false);
    const cols = maskedSamples(["Name", "Senior"], [
      ["Mira Shah", "Yes"],
      ["Dev Shah", "No"],
      ["Anya Shah", "Yes"],
      ["Raj Mehta", "No"],
    ]);
    expect(cols[0]).toEqual({ header: "Name", categorical: false, samples: ["M••• S•••", "D•• S•••", "A••• S•••"] });
    expect(cols[1]).toEqual({ header: "Senior", categorical: true, samples: ["Yes", "No"] });
  });
});

describe("templates", () => {
  it("builds a template and a column dictionary", () => {
    const e = entityDef("pledges")!;
    const csv = templateCsv(e);
    expect(csv.split("\r\n")[0]).toContain("Pledge number (old system)");
    expect(dictionaryCsv(e)).toContain("Kept as a custom field");
  });

  it("escapes cells and defuses spreadsheet formulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvCell("-12.5")).toBe("-12.5");
  });

  it("lists only rows with problems in the problem-rows file", () => {
    const out = problemRowsCsv(["A"], [
      { row_no: 2, raw: { A: "x" }, problems: [] },
      { row_no: 3, raw: { A: "y" }, problems: [{ level: "error", column: "A", message: "A is required." }] },
    ]);
    expect(out).toBe("Row,A,Problems\r\n3,y,Error: A is required.\r\n");
  });
});
