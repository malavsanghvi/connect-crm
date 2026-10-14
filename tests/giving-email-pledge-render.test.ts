import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Email sheet and the Print and Email buttons, drawn once on the server (the repo has no browser test environment). The sheet's
// fields are a plain component, so each state of the To box can be drawn with the data the database would give. The rules and the
// sentences are tested in pledge-email.test.ts, pledge-print.test.ts and pledge-email-actions.test.ts.
vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/approvals/actions", () => ({
  approveAsSecondAction: vi.fn(),
  approveFlaggedRefundAction: vi.fn(),
  cancelWriteOffRequestAction: vi.fn(),
  completeWriteOffAction: vi.fn(),
  recordPaypalRefundAction: vi.fn(),
  recordRefundAction: vi.fn(),
  refundThroughProviderAction: vi.fn(),
  requestRefundAction: vi.fn(),
  requestWriteOffAction: vi.fn(),
}));
vi.mock("@/app/(app)/giving/lists-actions", () => ({ grantSuggestionsAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/due-date-actions", () => ({ changePledgeDueAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/bank/actions", () => ({ confirmBankMatchAction: vi.fn(), matchDepositAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/bank/zelle-actions", () => ({ confirmExactMatchesAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/counting-actions", () => ({ recordCountingDepositAction: vi.fn(), createCountingSessionAction: vi.fn() }));
vi.mock("@/app/(app)/giving/counts/actions", () => ({ countSheetAction: vi.fn(), depositChoicesAction: vi.fn(), matchCountDepositAction: vi.fn(), unmatchCountDepositAction: vi.fn() }));
vi.mock("@/app/(app)/accounting/close/actions", () => ({ setCloseItemAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));
vi.mock("react-dom", async (orig) => ({ ...((await orig()) as object), createPortal: (node: unknown) => node }));
vi.stubGlobal("document", { body: {} });
vi.mock("next/navigation", async (orig) => ({ ...((await orig()) as object), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/giving/actions", () => ({ openPledgesAction: vi.fn(), findHouseholdsAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/actions", () => ({ applyPaymentAction: vi.fn(), possibleDuplicateZelleAction: vi.fn(), recordOfflinePaymentAction: vi.fn() }));
vi.mock("@/app/(app)/giving/sheet-actions", () => ({ sheetHouseholdAction: vi.fn(), familyGivingAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/record-pledge-actions", () => ({ pledgeSheetOptionsAction: vi.fn(), recordPledgeAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/edit-pledge-actions", () => ({ pledgeEditSheetAction: vi.fn(), editPledgeAction: vi.fn(), deletePledgeAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/email-pledge-actions", () => ({
  pledgeEmailSheetAction: vi.fn(() => new Promise(() => {})),
  emailPledgeAction: vi.fn(),
  pledgeEmailStatusAction: vi.fn(),
}));

import { EmailPledgeFields, EmailPledgeSheet } from "@/components/giving-actions/email-pledge-sheet";
import { PrintPledgeButton } from "@/components/giving-actions/pledge-print";
import { EmailPledgeButton, GivingSheetsProvider } from "@/components/giving-actions/provider";
import { ActButtons, type ActContext } from "@/components/giving-actions/row-actions";
import type { GivingSheetContext } from "@/lib/giving-actions/record-sheet";
import type { PledgeEmailSheetData } from "@/lib/pledge-email/sheet";

// The provider with its children as createElement's own argument (the lint rule), which its props type does not offer.
const SheetsProvider = GivingSheetsProvider as unknown as FunctionComponent<{ ctx: GivingSheetContext | null; children?: ReactNode }>;

const ctx: GivingSheetContext = {
  currency: "USD",
  locale: "en-US",
  timeZone: "America/Chicago",
  today: "2026-10-14",
  labels: { orgMemberLabel: "Member ID", orgHouseholdLabel: "Household ID" },
  canRecord: true,
  canAllocate: true,
  bankOn: true,
  canOpenFamily: true,
  canEmailPledge: true,
};
const PLEDGE = "18400000-0000-4000-8000-000000000201";

const data = (over: Partial<PledgeEmailSheetData["primary"]> = {}, earlier: PledgeEmailSheetData["earlier"] = []): PledgeEmailSheetData => ({
  pledge: { id: PLEDGE, number: "PL-0455", status: "open", householdId: "h-1", amountCents: 120_000 },
  primary: { personId: "p-1", name: "Tarun Patni", email: "tarun@example.org", problem: null, message: null, ...over },
  earlier,
});

const fields = (d: PledgeEmailSheetData, over: Partial<Parameters<typeof EmailPledgeFields>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(EmailPledgeFields, {
      data: d,
      address: d.primary.email ?? "",
      onAddress: () => {},
      onBlur: () => {},
      touched: false,
      phase: "compose",
      sent: null,
      waitedLong: false,
      currency: "USD",
      locale: "en-US",
      timeZone: "America/Chicago",
      ...over,
    }),
  );

describe("the To box", () => {
  it("starts with the primary member's email in an editable text box, and says whose it is", () => {
    const html = fields(data());
    expect(html).toContain('id="email-pledge-to"');
    expect(html).toContain('type="email"');
    expect(html).toContain('value="tarun@example.org"');
    expect(html).not.toContain("disabled");
    expect(html).toContain("Tarun Patni, primary member");
    expect(html).toContain("PL-0455 · $1,200.00");
    expect(html).not.toContain("no-address-note");
  });

  it("is empty with a plain note when the primary member has no email, and can still be typed into", () => {
    const html = fields(data({ email: null, name: "Ravi Shah", problem: "no_email", message: "The primary member (Ravi Shah) has no email address on file." }));
    expect(html).toContain('value=""');
    expect(html).not.toContain("disabled");
    expect(html).toContain("The primary member (Ravi Shah) has no email address on file. Type an address to send it to.");
    expect(html).toContain("nobody on file can be emailed");
  });

  it("an address typed instead says it is not the primary member's, and offers to go back to theirs", () => {
    const html = fields(data(), { address: "someone.else@example.org" });
    expect(html).toContain('value="someone.else@example.org"');
    expect(html).toContain("Not Tarun Patni&#x27;s address on file: the pledge goes to exactly this address.");
    expect(html).toContain("Use Tarun Patni&#x27;s address instead");
  });

  it("an address that is not an address says so once the person has left the box, and is marked invalid", () => {
    const quiet = fields(data(), { address: "tarun@example" });
    expect(quiet).not.toContain("does not look like");
    const html = fields(data(), { address: "tarun@example", touched: true });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("does not look like an email address");
  });

  it("lists what was sent before, with when, to whom and how it went", () => {
    const html = fields(
      data({}, [
        { at: "2026-10-03T15:00:00Z", to: "tarun@example.org", how: "automatic", outcome: "sent", reason: null },
        { at: "2026-10-04T15:00:00Z", to: "x@y.co", how: "manual", outcome: "failed", reason: "bounced" },
      ]),
    );
    expect(html).toContain("Sent before");
    expect(html).toContain("Oct 3, 2026");
    expect(html).toContain("Sent automatically to tarun@example.org · sent");
    expect(html).toContain("Emailed from the menu to x@y.co · failed (bounced)");
  });
});

describe("after Send", () => {
  const sent = (status: PledgeEmailSheetData extends never ? never : { status: "waiting" | "sent" | "failed" | "not_sent"; to: string; reason: string | null } | null) => ({ to: "tarun@example.org", status });

  it("locks the box and says it is sending, not that it is sent", () => {
    const html = fields(data(), { phase: "sending", sent: sent(null) });
    expect(html).toContain("disabled");
    expect(html).toContain("Sending the pledge to tarun@example.org…");
    expect(html).not.toContain("with the pledge&#x27;s PDF attached");
  });

  it("says it is sent only when the server did, with the PDF and the History", () => {
    const html = fields(data(), { phase: "sent", sent: sent({ status: "sent", to: "tarun@example.org", reason: null }) });
    expect(html).toContain('data-testid="email-outcome"');
    expect(html).toContain("Sent to tarun@example.org, with the pledge&#x27;s PDF attached. It is in the pledge&#x27;s History.");
  });

  it("says why it failed, as an alert, and leaves the box open to fix the address", () => {
    const html = fields(data(), { phase: "not_sent", sent: sent({ status: "failed", to: "tarun@example.org", reason: "Resend could not send the email (HTTP 422)" }) });
    expect(html).toContain('role="alert"');
    expect(html).toContain("could not be sent: resend could not send the email (HTTP 422)");
    expect(html).not.toContain("disabled");
  });

  it("says when it is taking longer than usual", () => {
    expect(fields(data(), { phase: "sending", sent: sent(null), waitedLong: true })).toContain("taking longer than usual");
  });
});

describe("the sheet while it opens", () => {
  it("is a dialog that says it is opening the pledge, with no Send button yet", () => {
    const html = renderToStaticMarkup(createElement(EmailPledgeSheet, { ctx, request: { pledgeId: PLEDGE }, onClose: () => {} }));
    expect(html).toContain("Email the pledge");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Opening the pledge…");
    expect(html).not.toContain("data-confirm");
    expect(html).not.toContain("email-pledge-to");
  });
});

describe("the buttons", () => {
  it("Print… is a button named for its pledge", () => {
    const html = renderToStaticMarkup(createElement(PrintPledgeButton, { pledgeId: PLEDGE, reference: "PL-0455" }));
    expect(html).toContain('aria-label="Print pledge PL-0455"');
    expect(html).toContain(">Print…<");
  });

  it("Email draws nothing where no sheet can open, and a button where it can (giving.manage)", () => {
    expect(renderToStaticMarkup(createElement(EmailPledgeButton, { pledgeId: PLEDGE }))).toBe("");
    const on = renderToStaticMarkup(createElement(SheetsProvider, { ctx }, createElement(EmailPledgeButton, { pledgeId: PLEDGE, label: "Email pledge PL-0455" })));
    expect(on).toContain('aria-label="Email pledge PL-0455"');
    expect(on).toContain(">Email<");
    const off = renderToStaticMarkup(createElement(SheetsProvider, { ctx: { ...ctx, canEmailPledge: false } }, createElement(EmailPledgeButton, { pledgeId: PLEDGE })));
    expect(off).toBe("");
  });

  it("the row menu draws Print… and Email… from the row's acts, each naming its pledge", () => {
    const actCtx: ActContext = { ...ctx, trigger: "menu", onDone: () => {} };
    const row = { family: null, title: "Pledge PL-0455", lines: [] };
    const acts = [
      { kind: "print_pledge", id: PLEDGE, reference: "PL-0455", label: "Print…" },
      { kind: "email_pledge", id: PLEDGE, reference: "PL-0455", label: "Email…" },
    ] as const;
    const withSheets = renderToStaticMarkup(createElement(SheetsProvider, { ctx }, createElement(ActButtons, { acts, row, ctx: actCtx })));
    expect(withSheets).toContain('aria-label="Print pledge PL-0455"');
    expect(withSheets).toContain('aria-label="Email pledge PL-0455"');
    expect(withSheets).toContain(">Print…<");
    expect(withSheets).toContain(">Email…<");
    // Where no sheet can open (the classic look), Print still works (it is a PDF, not a sheet) and Email is not drawn.
    const bare = renderToStaticMarkup(createElement(ActButtons, { acts, row, ctx: actCtx }));
    expect(bare).toContain(">Print…<");
    expect(bare).not.toContain("Email pledge");
  });
});
