import { describe, expect, it } from "vitest";

import {
  checkDonationRows,
  donationButtonLabel,
  donationColumns,
  donationSummary,
  donationTemplateRows,
  donationUploadRows,
  readDonationLines,
  readMethod,
  repeatProbe,
  reviewDonations,
} from "@/lib/giving-upload/donations";
import { sampleDonationLookups, sampleDonationRead, sampleDonationTable, uploadConventions, UPLOAD_TODAY } from "@/lib/giving-upload/fixtures";
import { mapColumns } from "@/lib/giving-upload/sheet";

// Upload donations (GV-U slice C): each row an offline payment recorded as the Record payment sheet records one; what it pays is
// planned in file order as the database runs it; a volunteer's rows are recorded and not applied; repeats wait for the person.

const TEMPLE = sampleDonationRead("temple");
const row = (r: ReturnType<typeof reviewDonations>, line: number) => r.rows.find((x) => x.line === line)!;

describe("the file", () => {
  it("maps the usual headings, each once", () => {
    const m = mapColumns(["Donor ID", "Gift Amount", "Payment Type", "Gift Date", "Check #", "Fund", "Pledge Number", "Memo"], donationColumns({ household: "household" }));
    expect(m.at).toMatchObject({ household: 0, amount: 1, method: 2, received_on: 3, reference: 4, for: 5, apply_to: 6, note: 7 });
    expect(m.missing).toEqual([]);
    expect(mapColumns(["Amount"], donationColumns({ household: "household" })).missing).toEqual(["household", "method", "received_on"]);
  });

  it("reads the methods people write, and refuses the ones that come in elsewhere", () => {
    expect(readMethod("Cheque")).toEqual({ ok: true, method: "check" });
    expect(readMethod("bank transfer")).toEqual({ ok: true, method: "ach" });
    expect(readMethod("BACS")).toEqual({ ok: true, method: "ach" });
    expect(readMethod("UPI")).toEqual({ ok: true, method: "ach" });
    expect(readMethod("Zelle")).toEqual({ ok: true, method: "zelle" });
    expect(readMethod("Shares")).toEqual({ ok: true, method: "stock" });
    expect(readMethod("Visa")).toMatchObject({ ok: false, error: expect.stringMatching(/come in through the payment provider/) });
    expect(readMethod("DAF")).toMatchObject({ ok: false, error: expect.stringMatching(/Grants to match/) });
    expect(readMethod("barter")).toEqual({ ok: false, error: "Method “barter” is not one of check, cash, ACH, Zelle or stock." });
  });

  it("writes the template in the community's money and dates", () => {
    const uk = donationTemplateRows({ household: "household" }, uploadConventions("foodbank"));
    expect(uk[0]).toContain("Received on");
    expect(uk[1]).toContain("11/10/2026");
    expect(uk[1]).toContain("250.00");
  });

  it("says what is wrong with a row itself", () => {
    const t = { ...sampleDonationTable("temple"), rows: [{ line: 2, cells: ["0127", "", "x", "", "13/13/2026", "", "", "", "", ""] }, { line: 3, cells: ["0127", "", "5", "stock", "12/01/2026", "", "", "", "", ""] }] };
    const r = readDonationLines(t, uploadConventions("temple"), UPLOAD_TODAY, { household: "household" });
    expect(r.lines[0].problems).toEqual([
      "Amount “x” is not an amount.",
      "Method is empty: write check, cash, ACH, Zelle or stock.",
      "Received on “13/13/2026” is not a date (write it like 12/31/2026).",
    ]);
    expect(r.lines[1].problems).toEqual([
      "Received on is in the future: a payment is recorded on or after the day it arrived.",
      "A stock gift needs the shares and their value on the day received, in the reference column.",
    ]);
  });
});

describe("the review (a treasurer, who applies)", () => {
  const r = reviewDonations(TEMPLE, sampleDonationLookups("temple"));

  it("pays the household's open pledges oldest first, as the sheet does, and asks about a pledge that is not a gift", () => {
    const a = row(r, 2);
    expect(a.family?.number).toBe("0127");
    expect(a).toMatchObject({ method: "check", checkNumber: "1044", envelope: "12", receivedOn: "2026-10-11", mode: "auto" });
    expect(a.allocations).toEqual([{ pledge_id: "9c000000-0000-4000-8000-000000000001", amount_cents: 30_000, pledge_amount_cents: 50_000, pledge_paid_cents: 20_000 }]);
    expect(a.after[0]).toMatch(/would be paid in full/);
    expect(a.status).toBe("ready");
  });

  it("pays the pledge a row names, and records a general gift where the row says none", () => {
    expect(row(r, 3).allocations).toEqual([{ pledge_id: "9c000000-0000-4000-8000-000000000003", amount_cents: 25_000, pledge_amount_cents: 80_000, pledge_paid_cents: 0 }]);
    expect(row(r, 4)).toMatchObject({ mode: "none", allocations: [], status: "ready" });
  });

  it("plans each row after the rows above it: the next payment to the same pledge sees what they paid", () => {
    // Line 6 (Okafor, $75 check) comes after line 3 paid $250 on PL-0455, so its card says $250 paid.
    const anyway = reviewDonations(TEMPLE, sampleDonationLookups("temple"), { picks: {}, ticks: { 6: true } });
    expect(row(anyway, 6).allocations).toEqual([{ pledge_id: "9c000000-0000-4000-8000-000000000003", amount_cents: 7_500, pledge_amount_cents: 80_000, pledge_paid_cents: 25_000 }]);
    // Unticking line 3 changes what line 6 sees.
    const without3 = reviewDonations(TEMPLE, sampleDonationLookups("temple"), { picks: {}, ticks: { 3: false, 6: true } });
    expect(row(without3, 6).allocations[0].pledge_paid_cents).toBe(0);
    expect(row(without3, 3).allocations).toEqual([]);
  });

  it("holds back what looks like a repeat: a payment already recorded, or a Zelle the family reported", () => {
    expect(row(r, 6)).toMatchObject({ status: "repeat", ticked: false, repeatOf: "receipt R-2026-0410" });
    expect(row(r, 5)).toMatchObject({ status: "repeat", ticked: false });
    expect(row(r, 5).warnings.join(" ")).toMatch(/A Zelle of this amount from this household was reported by the family/);
  });

  it("refuses a card gift and asks for a pick on a name", () => {
    expect(row(r, 7).status).toBe("problem");
    expect(row(r, 7).problems[0]).toMatch(/payment provider/);
    expect(row(r, 8)).toMatchObject({ status: "pick", ticked: false });
    expect(row(r, 8).warnings[0]).toMatch(/a name alone never chooses one/);
  });

  it("names how many and how much, and what goes to pledges", () => {
    expect(donationSummary(r)).toBe("3 ready · 1 to pick · 2 possible repeats · 1 problem");
    expect(r.tickedCount).toBe(3);
    expect(donationButtonLabel(r, "USD", "en-US")).toBe("Record 3 payments, $590.00");
    expect(r.appliedCents).toBe(30_000 + 25_000);
  });

  it("sends the database exactly the ticked rows as the review showed them", () => {
    const rows = donationUploadRows(r);
    expect(rows.map((x) => x.row)).toEqual([2, 3, 4]);
    expect(rows[0]).toEqual({
      row: 2,
      household_id: "9d000000-0000-4000-8000-000000000001",
      amount_cents: 30_000,
      method: "check",
      received_on: "2026-10-11",
      check_number: "1044",
      envelope_number: "12",
      memo: "Sunday",
      note: "Sunday",
      allocations: [{ pledge_id: "9c000000-0000-4000-8000-000000000001", amount_cents: 30_000, pledge_amount_cents: 50_000, pledge_paid_cents: 20_000 }],
      repeat_ok: false,
    });
    expect(checkDonationRows(rows, UPLOAD_TODAY)).toEqual({ ok: true, value: rows });
  });
});

describe("a finance volunteer (records, does not apply)", () => {
  it("records every row and applies none, saying so, exactly as the sheet does", () => {
    const r = reviewDonations(TEMPLE, sampleDonationLookups("temple", false));
    const a = row(r, 2);
    expect(a.allocations).toEqual([]);
    expect(a.after).toEqual(["Recorded but not applied: a treasurer can apply it to the family's pledges."]);
    expect(donationUploadRows(r).every((x) => x.allocations.length === 0)).toBe(true);
  });
});

describe("a food bank in pounds, day first", () => {
  it("records a bank transfer for a campaign's open pledge and asks for a pick on a name", () => {
    const r = reviewDonations(sampleDonationRead("foodbank"), sampleDonationLookups("foodbank"));
    expect(row(r, 2)).toMatchObject({ method: "ach", receivedOn: "2026-10-12", mode: "choose", status: "ready", memo: "Ref BACS 7781" });
    expect(row(r, 2).allocations[0]).toMatchObject({ amount_cents: 8_000 });
    expect(row(r, 3).status).toBe("pick");
    expect(donationButtonLabel(r, "GBP", "en-GB")).toBe("Record 1 payment, £80.00");
  });

  it("records a gift for a fund with no open pledge as a general gift, the purpose kept in the memo", () => {
    const t = { ...sampleDonationTable("foodbank"), rows: [{ line: 2, cells: ["H-0021", "", "£12", "cash", "12/10/2026", "", "", "Meals", "", ""] }] };
    const r = reviewDonations(readDonationLines(t, uploadConventions("foodbank"), UPLOAD_TODAY, { household: "household" }), sampleDonationLookups("foodbank"));
    expect(row(r, 2)).toMatchObject({ mode: "none", memo: "For: Meals", status: "check", allocations: [] });
    expect(row(r, 2).warnings[0]).toMatch(/No open pledge for Meals/);
  });
});

describe("the server's shape check", () => {
  const ok = donationUploadRows(reviewDonations(TEMPLE, sampleDonationLookups("temple")));
  it("refuses anything the review would not send", () => {
    expect(checkDonationRows([], UPLOAD_TODAY)).toEqual({ ok: false, error: "Tick at least one row to record." });
    expect(checkDonationRows([{ ...ok[0], method: "card" }], UPLOAD_TODAY)).toMatchObject({ ok: false });
    expect(checkDonationRows([{ ...ok[0], received_on: "2027-01-01" }], UPLOAD_TODAY)).toMatchObject({ ok: false });
    expect(checkDonationRows([{ ...ok[0], allocations: [{ ...ok[0].allocations[0], amount_cents: 999_999 }] }], UPLOAD_TODAY)).toMatchObject({ ok: false });
    expect(checkDonationRows([ok[0], ok[0]], UPLOAD_TODAY)).toMatchObject({ ok: false });
  });

  it("asks the database about repeats only for rows whose household an ID matched", () => {
    const probe = repeatProbe(TEMPLE, sampleDonationLookups("temple"));
    expect(probe.map((p) => p.row)).toEqual([2, 3, 4, 5, 6]);
    expect(probe[0]).toEqual({ row: 2, household_id: "9d000000-0000-4000-8000-000000000001", amount_cents: 30_000, received_on: "2026-10-11", method: "check", check_number: "1044" });
  });
});
