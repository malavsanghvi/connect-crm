import { describe, expect, it } from "vitest";

// Giving's export file (slice 9): amounts as plain decimals with a currency column, households by number and adult household name,
// the watermark, the filter in words, and an audit detail that never carries a search's text. Invented rows only.

import {
  auditDetail,
  exportFileName,
  exportListFromParam,
  filterSentence,
  paymentExportHeader,
  paymentExportLines,
  pledgeExportHeader,
  pledgeExportLines,
  rowsWord,
  watermarkLine,
  type ExportHousehold,
} from "@/lib/giving-export/csv";
import { methodWord, paymentExportFilter, pledgeExportFilter, sourceWord } from "@/lib/giving-export/filters";
import { LISTS_COMMUNITY, ROWING_CLUB, sampleExportLines, samplePaymentsModel, samplePledgesModel } from "@/lib/giving-lists/fixtures";
import { paymentQuery, yearChips, yearFromParam } from "@/lib/giving-lists/payments";
import { toCsv } from "@/lib/import/templates";
import { centsAsDecimal } from "@/lib/money";

const households = new Map<string, ExportHousehold>([
  ["h1", { number: "0127", orgId: "CLUB-H-0961", name: "Okafor household" }],
  ["h2", { number: "0388", orgId: null, name: "Nguyen household" }],
]);

describe("amounts", () => {
  it("are integer cents written as plain decimals, without a sign or grouping", () => {
    expect(centsAsDecimal(123_456)).toBe("1234.56");
    expect(centsAsDecimal(5)).toBe("0.05");
    expect(centsAsDecimal(-200)).toBe("-2.00");
    expect(centsAsDecimal(0)).toBe("0.00");
    expect(centsAsDecimal(BigInt(900_719_925_474_099))).toBe("9007199254740.99");
  });
});

describe("the payment lines", () => {
  const rows = [
    {
      receipt: "R-2026-0413",
      receivedOn: "2026-10-11",
      householdId: "h1",
      method: "check",
      checkNumber: "1042",
      source: sourceWord("offline"),
      status: "settled",
      amountCents: 20_000,
      refundedCents: 2_500,
      appliedTo: ["PL-0455 (New roof)", "PL-0480"],
      openingBalance: false,
    },
    { receipt: null, receivedOn: "2026-10-04", householdId: "h9", method: "card", checkNumber: null, source: sourceWord("stripe"), status: "captured", amountCents: 5_000, refundedCents: 0, appliedTo: [], openingBalance: true },
  ];

  it("name the household by its number, its community ID and the adults' household name, with the currency in its own column", () => {
    const lines = paymentExportLines(rows, households, { currency: "USD", methodWord: methodWord("en-US") });
    expect(paymentExportHeader("Club household ID")).toEqual([
      "Receipt number",
      "Received on",
      "Household number",
      "Club household ID",
      "Household",
      "Method",
      "Check number",
      "Source",
      "Status",
      "Amount",
      "Refunded",
      "Net",
      "Currency",
      "Applied to",
      "Opening balance",
    ]);
    expect(lines[0]).toEqual(["R-2026-0413", "2026-10-11", "0127", "CLUB-H-0961", "Okafor household", "Check", "1042", "Recorded by hand", "Settled", "200.00", "25.00", "175.00", "USD", "PL-0455 (New roof); PL-0480", ""]);
    // A family the cards could not name stays blank rather than guessed.
    expect(lines[1].slice(2, 5)).toEqual(["", "", ""]);
    expect(lines[1][8]).toBe("Received");
    expect(lines[1][14]).toBe("Yes");
  });

  it("keep a spreadsheet from running a formula, and keep negative amounts as numbers", () => {
    const csv = toCsv([["=HYPERLINK(1)", "-2.00", "+1"]]);
    expect(csv).toBe("'=HYPERLINK(1),-2.00,'+1\r\n");
  });
});

describe("the pledge lines", () => {
  it("show what is open only for an open pledge, and a write-off that waits for its second person", () => {
    const lines = pledgeExportLines(
      [
        { number: "PL-0388", pledgedOn: "2026-02-01T15:00:00Z", dueOn: "2026-08-01", householdId: "h2", campaign: "Annual appeal", status: "partially_paid", amountCents: 50_000, paidCents: 35_000, writeOffWaiting: true },
        { number: "PL-0301", pledgedOn: "2025-11-02T15:00:00Z", dueOn: null, householdId: "h1", campaign: null, status: "written_off", amountCents: 15_000, paidCents: 5_000, writeOffWaiting: false },
      ],
      households,
      { currency: "EUR" },
    );
    expect(pledgeExportHeader("Community household ID")[4]).toBe("Community household ID");
    expect(lines[0]).toEqual(["PL-0388", "2026-02-01", "2026-08-01", "0388", "", "Nguyen household", "Annual appeal", "Partly paid", "500.00", "350.00", "150.00", "EUR", "Yes", "0.00", ""]);
    expect(lines[1].slice(7, 12)).toEqual(["Written off", "150.00", "50.00", "0.00", "EUR"]);
  });
});

describe("the filter, the watermark and the audit detail", () => {
  it("say the list's chips and search in words, and the audit detail keeps the chips but never the search's text", () => {
    const q = paymentQuery("all", (k) => ({ method: "check", year: "2026", source: "nope" })[k], "2026-10-12");
    expect(q.source).toBeNull();
    const filter = paymentExportFilter(q, "Okafor", "en-US");
    expect(filterSentence(filter, "every payment")).toBe("check, received in 2026, matching “Okafor”");
    const detail = auditDetail(filter, 12);
    expect(detail).toEqual({ rows: 12, chips: { method: "check", year: "2026" }, searched: true });
    expect(JSON.stringify(detail)).not.toContain("Okafor");
    expect(exportFileName("payments", filter, "2026-10-13")).toBe("payments-check-2026-2026-10-13.csv");
  });

  it("say the whole list when no chip is on, and refund requests ignore the payment chips as the list does", () => {
    const q = paymentQuery("refunds", (k) => ({ method: "check", year: "2026" })[k], "2026-10-12");
    expect(q).toEqual({ view: "refunds", method: null, source: null, year: null });
    expect(filterSentence(paymentExportFilter(q, null, "en-US"), "every payment")).toBe("refund requests");
    expect(filterSentence(paymentExportFilter(paymentQuery("all", () => undefined, "2026-10-12"), "  ", "en-US"), "every payment")).toBe("every payment");
  });

  it("say a behind bucket instead of the chip for pledges, as the list shows them", () => {
    expect(filterSentence(pledgeExportFilter("closed", "d31_60", null), "every pledge")).toBe("behind by 31 to 60 days");
    expect(filterSentence(pledgeExportFilter("open", null, null), "every pledge")).toBe("open");
    expect(auditDetail(pledgeExportFilter("waiting", null, null), 3)).toEqual({ rows: 3, chips: { status: "waiting" }, searched: false });
  });

  it("name the community, who exported it, when, the list, the filter and the count", () => {
    const line = watermarkLine({
      community: "Riverside Rowing Club",
      who: "Siobhán Murphy",
      email: "treasurer@rowing.example",
      at: "Oct 13, 2026, 10:15 AM (Europe/Dublin)",
      list: "pledges",
      filter: pledgeExportFilter("open", null, null),
      rows: 1,
    });
    expect(line).toBe(
      "Exported from Riverside Rowing Club by Siobhán Murphy (treasurer@rowing.example) on Oct 13, 2026, 10:15 AM (Europe/Dublin). Pledges: open. 1 pledge. Confidential: for Riverside Rowing Club's records only; this export is recorded in the audit log.",
    );
    expect(rowsWord("payments", 1_204)).toBe("1,204 payments");
    expect(exportListFromParam("payments")).toBe("payments");
    expect(exportListFromParam("bank_lines")).toBe("bank_lines");
    expect(exportListFromParam("donors")).toBeNull();
  });
});

describe("the year chip", () => {
  it("reads a four-digit year from 1990 to next year and offers this year and the two before it", () => {
    expect(yearFromParam("2026", "2026-10-12")).toBe(2026);
    expect(yearFromParam("2027", "2026-10-12")).toBe(2027);
    expect(yearFromParam("2028", "2026-10-12")).toBeNull();
    expect(yearFromParam("1989", "2026-10-12")).toBeNull();
    expect(yearFromParam("26", "2026-10-12")).toBeNull();
    const chips = yearChips(2019, "2026-10-12", (k) => `/giving/payments${k ? `?year=${k}` : ""}`);
    expect(chips.map((c) => c.label)).toEqual(["All years", "2026", "2025", "2024", "2019"]);
    expect(chips.find((c) => c.on)?.key).toBe("2019");
  });
});

describe("the dev preview's export (the same core, invented rows)", () => {
  it("offers Export to the treasurer with the list's filter in words, and a line instead of a button to a second approver", () => {
    const pay = samplePaymentsModel("treasurer", { tab: "payments", method: "check" });
    expect(pay.exportOffer).toMatchObject({ state: "ready", list: "payments", filterText: "check" });
    expect(pay.exportOffer?.state === "ready" && pay.exportOffer.href).toContain("/dev/giving-lists/export?");
    expect(pay.years.map((c) => c.label)).toEqual(["All years", "2026", "2025", "2024"]);
    expect(samplePledgesModel("approver").exportOffer).toEqual({ state: "no_permission" });
  });

  it("writes the watermark, the header and the rows; a non-faith club in euros has EUR in the currency column", () => {
    const lines = sampleExportLines("payments", "treasurer", { year: "2026" }, ROWING_CLUB);
    expect(lines[0][0]).toMatch(/^Exported from Riverside Rowing Club by .+\. Payments: received in 2026\. \d+ payments?\./);
    expect(lines[1][0]).toBe("Receipt number");
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.slice(2).every((l) => l[12] === "EUR")).toBe(true);
    const pledges = sampleExportLines("pledges", "treasurer", {}, LISTS_COMMUNITY);
    expect(pledges[1][0]).toBe("Pledge number");
    expect(sampleExportLines("pledges", "volunteer", {}, LISTS_COMMUNITY)[0][0]).toContain("You don't have access to this area");
  });
});
