import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Giving › Statements (New look) drawn once on the server. The sheet is drawn into document.body in the browser; here it is a plain
// stand-in that shows what it was given (the title, what happens, the button and whether the button is off).
vi.mock("@/components/giving-actions/sheet", () => ({
  FamilyCard: ({ family, children }: { family: { name: string; primary: string | null }; children?: unknown }) =>
    createElement("div", { "data-family": family.name }, family.name, " · ", family.primary ?? "No primary adult on file", children as never),
  GivingSheet: ({ title, what, children, confirmLabel, confirmDisabled }: { title: string; what: unknown; children: unknown; confirmLabel: string; confirmDisabled?: boolean }) =>
    createElement(
      "div",
      { "data-testid": "giving-sheet" },
      createElement("h2", null, title),
      what as never,
      children as never,
      createElement("button", { type: "button", disabled: confirmDisabled === true, "data-confirm": "" }, confirmLabel),
    ),
}));
vi.mock("next/navigation", async (actual) => ({ ...(await actual<typeof import("next/navigation")>()), usePathname: () => "/giving/statements" }));

import { StatementsView } from "@/components/giving-statements/statements-view";
import { sampleStatementsModel } from "@/lib/giving-statements/fixtures";
import type { StatementsModel } from "@/lib/giving-statements/model";
import { parseReceiptCopy, printBlockedReason, receiptCopyLines, receiptFamily } from "@/lib/giving-statements/receipt-copy";
import { communityFormat } from "@/lib/community-format";
import { NEUTRAL_KIND } from "@/lib/kind";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const html = (model: StatementsModel) => renderToStaticMarkup(h(StatementsView, { model }));

describe("the year-end review", () => {
  it("shows the year, the counts sentence, each household with its adults, and Review and send", () => {
    const out = html(sampleStatementsModel());
    expect(out).toContain("Year-end statements for 2026");
    expect(out).not.toContain("(so far)");
    expect(out).toContain("2 by email, 1 by post, 1 in the app only, 2 need a fix, 1 with nothing to state");
    expect(out).toContain("Addressed to: Chidi Okafor and María Okafor");
    expect(out).toContain("No adult on file to address the statement to");
    expect(out).toContain("Review and send");
    expect(out.match(/data-testid="statements-review-row"/g)).toHaveLength(7);
    expect(out).toContain('aria-current="page"');
  });
  it("filters to what needs a fix", () => {
    const out = html(sampleStatementsModel({ show: "fix" }));
    expect(out.match(/data-testid="statements-review-row"/g)).toHaveLength(4);
  });
  it("the sheet counts the statements and its Send button is off and says it is coming next", () => {
    const out = html(sampleStatementsModel({ openReview: true }));
    expect(out).toContain("Year-end statements for 2026");
    expect(out).toMatch(/<button type="button" disabled="" data-confirm="">Send 2 emails and 1 letter · coming next<\/button>/);
    expect(out).toContain("Coming next: the statements service is not connected yet.");
    expect(out).toContain("Nothing has been sent");
  });
  it("Statements switched off says so, and the receipt copy still works", () => {
    const out = html(sampleStatementsModel({ sample: "off", receipt: true }));
    expect(out).toContain("Statements are switched off for Lakeside Community Club");
    expect(out).toContain('data-testid="receipt-copy"');
    expect(out).not.toContain("Review and send");
  });
  it("no access says so instead of an empty table; an error has a retry", () => {
    expect(html(sampleStatementsModel({ sample: "no_access" }))).toContain("You don&#x27;t have access to this area");
    const err = html(sampleStatementsModel({ sample: "error" }));
    expect(err).toContain('role="alert"');
    expect(err).toContain("Try again");
    expect(html(sampleStatementsModel({ sample: "empty" }))).toContain("No household gave in 2026");
  });
});

describe("a copy of one receipt", () => {
  it("previews the copy and links to the printable page while the templates are approved", () => {
    const out = html({ ...sampleStatementsModel({ receipt: true }), printBase: "/giving/statements/receipt" });
    expect(out).toContain("Donation receipt · No. R-2026-0395");
    expect(out).toContain('href="/giving/statements/receipt/00000000-0000-4000-8000-00000000c0b1"');
    expect(out).not.toContain("intangible religious benefits");
  });
  it("printing is off, and says why, until the treasurer approves the templates", () => {
    const out = html({ ...sampleStatementsModel({ receipt: true, templatesApproved: false }), printBase: "/giving/statements/receipt" });
    expect(out).toContain("Printing is off until the treasurer approves the receipt wording.");
    expect(out).not.toContain("Open the printable copy");
  });
  it("a gift a child paid never shows the child's name anywhere on the page", () => {
    const copy = parseReceiptCopy({
      payment_id: "p-6",
      household_id: "h-9",
      household: { name: "Member household", number: "0301", org_id: null, city: "Austin" },
      receipt_number: "R-155-0006",
      received_on: "2025-12-31",
      method: "cash",
      status: "settled",
      amount_cents: 1000,
      refunded_cents: 0,
      receipt_name: "Kiran Member",
      receipt_name_hidden: true,
      joint_receipt: false,
      payer_is_adult: false,
      adults: ["Mira Member"],
      applied_to: [],
      templates: { ok: true, detail: "Approved." },
    })!;
    const lines = receiptCopyLines(copy, {
      centerName: "Lakeside Community Club",
      centerAddress: null,
      signedBy: "",
      note: "",
      fmt: communityFormat({ currency: "USD", country: "US" }),
      timeZone: "America/Chicago",
      today: "2027-01-12",
      orgKind: NEUTRAL_KIND,
    });
    const model: StatementsModel = {
      ...sampleStatementsModel(),
      receiptQuery: "R-155-0006",
      receipt: { state: "ok", view: { copy, family: receiptFamily(copy), lines, printBlocked: printBlockedReason(copy) } },
    };
    const out = html(model);
    expect(out).not.toContain("Kiran");
    expect(out).toContain("Mira Member · $10.00 by cash on Dec 31, 2025");
    expect(out).toContain("the copy is addressed to the household&#x27;s adults");
  });
  it("a receipt that does not exist, or has no copy, is said next to the search", () => {
    const m = sampleStatementsModel();
    const out = html({ ...m, receiptQuery: "R-9", receipt: { state: "not_found", message: "No payment has receipt number R-9." } });
    expect(out).toContain("No payment has receipt number R-9.");
    const refused = html({ ...m, receipt: { state: "refused", message: "An opening-balance line never gets a receipt." } });
    expect(refused).toContain("An opening-balance line never gets a receipt.");
  });
});
