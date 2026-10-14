import { describe, expect, it } from "vitest";

import { donationTemplateHeader } from "@/lib/onboarding/donations";
import { personTemplateHeader } from "@/lib/onboarding/people";
import { SAMPLE_HEADERS, SAMPLE_OWN_SPREADSHEET, sampleContext, sampleFiles } from "@/lib/onboarding-front/fixtures";
import {
  droppedSummary,
  fileKindOf,
  findHeaderRow,
  formatBytes,
  looksTabSeparated,
  normHeading,
  recogniseFile,
  rowsUnder,
  SOURCE_KEYS,
  splitTabs,
  unreadableFile,
  type FileFacts,
  type SourceKey,
} from "@/lib/onboarding-front/recognise";
import { recogniseContext } from "@/lib/onboarding-front/signatures";

// The front door's recogniser (board 1 of docs/handoff/prototypes/onboarding-data/Main.dc.html): pure, headings only.
const ctx = sampleContext();
const sheet = (name: string, headers: readonly string[] | null, rows: number | null = 120, sheets: number | null = 1): FileFacts => ({
  name,
  type: "",
  size: 52_000,
  headers,
  rows,
  sheets,
});

const LABELS: Record<SourceKey, string> = {
  neon: "a Neon CRM export",
  quickbooks: "a QuickBooks export",
  zeffy: "a Zeffy export",
  paypal: "a PayPal export",
  google_contacts: "a Google Contacts export",
  bank: "a bank statement",
};

describe("recognising the known exports from their heading row", () => {
  it.each(SOURCE_KEYS.map((k) => [k]))("%s", (key) => {
    const r = recogniseFile(sheet(`${key}.csv`, SAMPLE_HEADERS[key], 1240), ctx);
    expect(r.kind).toBe("known_source");
    expect(r.source).toBe(key);
    expect(r.tag).toBe("Known source");
    expect(r.sentence).toMatch(new RegExp(`^Looks like ${LABELS[key]}: 1,240 rows, \\d+ columns? we know\\.$`));
    expect(r.known).toBeGreaterThan(0);
    expect(r.known).toBeLessThanOrEqual(r.columns);
  });

  it("says 'Looks like a Neon CRM export: 1,240 rows, N columns we know' and sends it to Guided onboarding", () => {
    const r = recogniseFile(sheet("accounts.csv", SAMPLE_HEADERS.neon, 1240), ctx);
    expect(r.sentence).toBe(`Looks like a Neon CRM export: 1,240 rows, ${r.known} columns we know.`);
    expect(r.sizeLine).toBe("1,240 rows · 11 columns");
    expect(r.goes).toBe("guided");
    expect(r.next).toMatch(/coming next/);
  });

  it("sends a bank statement to bank matching, not to loading", () => {
    const r = recogniseFile(sheet("chase.csv", SAMPLE_HEADERS.bank, 318), ctx);
    expect(r.goes).toBe("bank");
    expect(r.next).toMatch(/bank matching/);
  });

  it("finds QuickBooks' transaction report too (Transaction type + Num)", () => {
    const r = recogniseFile(sheet("sales.xlsx", ["Date", "Transaction Type", "Num", "Name", "Memo/Description", "Account", "Amount"]), ctx);
    expect(r.source).toBe("quickbooks");
  });

  it("does not call a plain date / description / amount list a bank statement (no balance or check column)", () => {
    const r = recogniseFile(sheet("gifts.csv", ["Date", "Description", "Amount"]), ctx);
    expect(r.kind).toBe("spreadsheet");
  });

  it("works with headings in any case, spacing or punctuation", () => {
    const shouted = SAMPLE_HEADERS.paypal.map((h) => ` ${h.toUpperCase().replace(/ /g, "_")} `);
    expect(recogniseFile(sheet("x.csv", shouted), ctx).source).toBe("paypal");
  });
});

describe("Weaver's own templates: an exact match on headings", () => {
  it("knows the members template, filled in", () => {
    const r = recogniseFile(sheet("filled.xlsx", personTemplateHeader(), 214, 2), ctx);
    expect(r.kind).toBe("template");
    expect(r.templateKey).toBe("people");
    expect(r.tag).toBe("Weaver template");
    expect(r.sentence).toBe("Weaver's own members & households template, filled in: 214 rows.");
    expect(r.sizeLine).toBe("2 sheets · 214 rows");
    expect(r.goes).toBe("guided");
  });

  it("knows the past-donations template when the community has giving", () => {
    expect(recogniseFile(sheet("d.csv", donationTemplateHeader()), ctx).templateKey).toBe("donations");
  });

  it("is not a template once a column is added or missing", () => {
    expect(recogniseFile(sheet("p.csv", [...personTemplateHeader(), "Favourite colour"]), ctx).kind).not.toBe("template");
    expect(recogniseFile(sheet("p.csv", personTemplateHeader().slice(1)), ctx).kind).not.toBe("template");
  });

  it("does not offer the donations template to a community without giving (a neutral club)", () => {
    const club = recogniseContext("members", false);
    expect(club.templates.map((t) => t.key)).toEqual(["people"]);
    expect(recogniseFile(sheet("d.csv", donationTemplateHeader()), club).kind).not.toBe("template");
  });
});

describe("anything else", () => {
  it("calls an unknown layout the organization's own spreadsheet and counts the headings it knows", () => {
    const r = recogniseFile(sheet("Giving_2019-2025.xlsx", SAMPLE_OWN_SPREADSHEET, 4812, 7), ctx);
    expect(r.kind).toBe("spreadsheet");
    expect(r.tag).toBe("Your own spreadsheet");
    expect(r.sizeLine).toBe("7 sheets · 4,812 rows");
    expect(r.known).toBeGreaterThan(0);
    expect(r.sentence).toBe(`Your own spreadsheet: 4,812 rows, 7 columns, ${r.known} we know.`);
    expect(r.goes).toBe("data_import");
  });

  it("keeps headings in any language (nothing is reduced to an empty string) and says none are known", () => {
    expect(normHeading("ઈમેલ સરનામું")).not.toBe("");
    expect(normHeading("Teléfono")).toBe("teléfono");
    const r = recogniseFile(sheet("socios.csv", ["Socio", "Teléfono móvil", "Cuota anual"], 40), ctx);
    expect(r.kind).toBe("spreadsheet");
    expect(r.sentence).toBe("Your own spreadsheet: 40 rows, 3 columns, none of them we know.");
  });

  it("a photo, a PDF, an old Excel file and a Word document", () => {
    const photo = recogniseFile({ name: "page-14.JPG", type: "image/jpeg", size: 2_500_000, headers: null, rows: null, sheets: null }, ctx);
    expect(photo.kind).toBe("photo");
    expect(photo.sizeLine).toBe("Photo · 2.4 MB");
    expect(photo.goes).toBe("coming_next");
    expect(photo.next).toMatch(/never sent to an AI service/);
    expect(recogniseFile({ name: "list.pdf", type: "application/pdf", size: 220_000, headers: null, rows: null, sheets: null }, ctx).kind).toBe("pdf");
    expect(recogniseFile({ name: "old.xls", type: "", size: 9_000, headers: null, rows: null, sheets: null }, ctx).kind).toBe("old_excel");
    expect(recogniseFile({ name: "notes.docx", type: "", size: 9_000, headers: null, rows: null, sheets: null }, ctx).kind).toBe("unsupported");
  });

  it("an empty spreadsheet says so", () => {
    const r = recogniseFile(sheet("blank.csv", [], 0), ctx);
    expect(r.kind).toBe("empty");
    expect(r.goes).toBe("none");
  });

  it("a file the browser could not read shows the reason, never hides it", () => {
    const r = unreadableFile({ name: "locked.xlsx", size: 12_000 }, "it is protected by a password");
    expect(r.sentence).toBe("Could not read this file — it is protected by a password.");
    expect(r.tone).toBe("danger");
  });
});

describe("the small helpers", () => {
  it("finds the heading row under a report's title rows", () => {
    const report = [["Riverside Neighbours"], ["Customer Contact List"], ["All dates"], [], ["Customer", "Phone Numbers", "Email", "Full Name"], ["A", "1", "a@x", "A"], ["", "", "", ""], ["B", "2", "b@x", "B"]];
    const at = findHeaderRow(report);
    expect(at).toBe(4);
    expect(rowsUnder(report, at)).toBe(2);
    expect(findHeaderRow([])).toBe(-1);
  });

  it("splits tab-separated text", () => {
    const text = "Name\tEmail\tCity\nA\ta@x\tB\n";
    expect(looksTabSeparated(text)).toBe(true);
    expect(looksTabSeparated("a,b,c\n1,2,3")).toBe(false);
    expect(splitTabs(text)).toEqual([
      ["Name", "Email", "City"],
      ["A", "a@x", "B"],
    ]);
  });

  it("names the kind of file from its name and type", () => {
    expect(fileKindOf("a.CSV", "")).toBe("spreadsheet");
    expect(fileKindOf("a", "text/csv")).toBe("spreadsheet");
    expect(fileKindOf("scan", "image/heic")).toBe("photo");
  });

  it("formats sizes and the summary line (photos counted apart)", () => {
    expect(formatBytes(900)).toBe("900 bytes");
    expect(formatBytes(41_000)).toBe("40 KB");
    expect(droppedSummary([])).toBe("");
    expect(droppedSummary(sampleFiles().map((f) => f.rec))).toBe(
      "I looked at 3 files and 1 photo, here in your browser. Here is what each is and where it can go. Nothing has been uploaded or saved.",
    );
  });
});
