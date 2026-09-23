import { describe, expect, it } from "vitest";

import { detectStatementFormat, parseBankStatementCsv, parseCsv, parseStatementDate } from "@/lib/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and newlines inside quotes", () => {
    const rows = parseCsv('a,"b, c","say ""hi""","multi\nline"\r\n1,2,3,4\n');
    expect(rows).toEqual([
      ["a", "b, c", 'say "hi"', "multi\nline"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("strips a BOM and drops blank lines", () => {
    expect(parseCsv("﻿x,y\n\n1,2\n")).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });

  it("keeps empty trailing fields", () => {
    expect(parseCsv("a,b,\n")).toEqual([["a", "b", ""]]);
  });
});

describe("parseStatementDate", () => {
  it("reads ISO and US formats", () => {
    expect(parseStatementDate("2026-09-14")).toBe("2026-09-14");
    expect(parseStatementDate("09/14/2026")).toBe("2026-09-14");
    expect(parseStatementDate("9/4/26")).toBe("2026-09-04");
  });
  it("rejects impossible dates", () => {
    expect(parseStatementDate("02/30/2026")).toBeNull();
    expect(parseStatementDate("14/09/2026")).toBeNull();
    expect(parseStatementDate("yesterday")).toBeNull();
  });
});

const CHASE = [
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
  "CREDIT,09/14/2026,Zelle Payment From Rahul Shah Jpm99bxk2q1v,101.00,QUICKPAY_CREDIT,15234.10,,",
  'CREDIT,09/15/2026,"ORIG CO NAME:FIDELITY CHARITABLE ORIG ID:1234567890 DESC DATE:250915 CO ENTRY DESCR:GRANT, PAYMENT",2500.00,ACH_CREDIT,17734.10,,',
  "DSLIP,09/16/2026,REMOTE ONLINE DEPOSIT #          1,1353.00,CHECK_DEPOSIT,19087.10,1,",
  "DEBIT,09/16/2026,ADP PAYROLL FEES ADP FEES,-45.00,ACH_DEBIT,19042.10,,",
  "CHECK,09/17/2026,CHECK 1042,-300.00,CHECK_PAID,18742.10,1042,",
].join("\n");

describe("parseBankStatementCsv — Chase", () => {
  it("detects the Chase format from the header", () => {
    expect(detectStatementFormat(["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"])).toBe("chase_csv");
    expect(detectStatementFormat(["date", "amount", "description"])).toBe("generic_csv");
  });

  it("imports only credits by default and maps the Chase columns", () => {
    const r = parseBankStatementCsv(CHASE);
    expect(r.format).toBe("chase_csv");
    expect(r.errors).toEqual([]);
    expect(r.skippedDebits).toBe(2);
    expect(r.rows).toHaveLength(3);
    const [zelle, ach, deposit] = r.rows;
    expect(zelle).toMatchObject({
      posted_on: "2026-09-14",
      amount_cents: 10100,
      description: "Zelle Payment From Rahul Shah Jpm99bxk2q1v",
      bank_type: "QUICKPAY_CREDIT",
      bank_details: "CREDIT",
      check_or_slip: null,
    });
    expect(ach.description).toContain("GRANT, PAYMENT"); // quoted comma kept
    expect(ach.bank_type).toBe("ACH_CREDIT");
    expect(deposit).toMatchObject({ bank_type: "CHECK_DEPOSIT", bank_details: "DSLIP", check_or_slip: "1", amount_cents: 135300 });
    expect(deposit.description).toBe("REMOTE ONLINE DEPOSIT # 1"); // whitespace collapsed
    expect(r.periodStart).toBe("2026-09-14");
    expect(r.periodEnd).toBe("2026-09-16");
  });

  it("keeps the original row as raw, ignoring Chase's trailing comma", () => {
    const r = parseBankStatementCsv(CHASE);
    expect(r.rows[0].raw).toEqual({
      Details: "CREDIT",
      "Posting Date": "09/14/2026",
      Description: "Zelle Payment From Rahul Shah Jpm99bxk2q1v",
      Amount: "101.00",
      Type: "QUICKPAY_CREDIT",
      Balance: "15234.10",
      "Check or Slip #": "",
    });
  });

  it("includes debits when asked", () => {
    const r = parseBankStatementCsv(CHASE, { includeDebits: true });
    expect(r.rows).toHaveLength(5);
    expect(r.skippedDebits).toBe(0);
    expect(r.rows.find((x) => x.bank_type === "CHECK_PAID")).toMatchObject({ amount_cents: -30000, check_or_slip: "1042" });
  });
});

describe("parseBankStatementCsv — generic", () => {
  it("reads a date, amount, description file with a header in any order", () => {
    const r = parseBankStatementCsv("Description,Date,Amount\nZELLE FROM PRIYA S SHAH ON 09/14 REF # PP0ABC123,2026-09-14,$51.00\n");
    expect(r.format).toBe("generic_csv");
    expect(r.rows).toEqual([
      expect.objectContaining({ posted_on: "2026-09-14", amount_cents: 5100, description: "ZELLE FROM PRIYA S SHAH ON 09/14 REF # PP0ABC123", bank_type: null }),
    ]);
  });

  it("reads a headerless file as date, amount, description", () => {
    const r = parseBankStatementCsv("09/14/2026,25.00,Deposit\n09/15/2026,(10.00),Fee\n");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].raw).toEqual({ date: "09/14/2026", amount: "25.00", description: "Deposit" });
    expect(r.skippedDebits).toBe(1);
  });

  it("supports separate credit / debit columns", () => {
    const r = parseBankStatementCsv("Date,Description,Credit,Debit\n2026-09-14,Gift,100.00,\n2026-09-14,Fee,,5.00\n", { includeDebits: true });
    expect(r.rows.map((x) => x.amount_cents)).toEqual([10000, -500]);
  });

  it("reports unreadable lines instead of dropping them silently", () => {
    const r = parseBankStatementCsv("date,amount,description\nnot a date,1.00,x\n2026-09-14,abc,y\n2026-09-14,1.00,\n2026-09-14,2.00,ok\n");
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(r.errors[0].message).toMatch(/not a date/);
    expect(r.errors[1].message).toMatch(/not an amount/);
    expect(r.errors[2].message).toMatch(/blank/);
  });

  it("explains a header without the needed columns", () => {
    const r = parseBankStatementCsv("when,how much\n2026-09-14,1.00\n");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toMatch(/no date, amount, description column/);
  });

  it("handles an empty file", () => {
    expect(parseBankStatementCsv("").errors[0].message).toMatch(/empty/);
  });
});
