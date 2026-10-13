import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Giving › Bank (New look, docs/GIVING_REDESIGN.md slice 4) rendered once on the server (the repo has no browser test environment).
// The rows call Server Actions; here nothing is called, only drawn.
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
vi.mock("@/app/(app)/giving/actions", () => ({ openPledgesAction: vi.fn(), findHouseholdsAction: vi.fn() }));
vi.mock("@/app/(app)/giving/lists-actions", () => ({ grantSuggestionsAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/actions", () => ({ applyPaymentAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/bank/actions", () => ({
  attachBankLineAction: vi.fn(),
  confirmBankMatchAction: vi.fn(),
  createBankAccountAction: vi.fn(),
  ignoreBankLineAction: vi.fn(),
  importBankLinesAction: vi.fn(),
  matchDepositAction: vi.fn(),
  restoreBankLineAction: vi.fn(),
}));
vi.mock("@/app/(app)/giving/payments/bank/zelle-actions", () => ({
  confirmExactMatchesAction: vi.fn(),
  linkReportAction: vi.fn(),
  rejectReportAction: vi.fn(),
  saveZelleReportingAction: vi.fn(),
}));
vi.mock("@/app/(app)/giving/payments/counting-actions", () => ({ recordCountingDepositAction: vi.fn() }));
vi.mock("@/app/(app)/accounting/close/actions", () => ({ setCloseItemAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => "/giving/payments/bank",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

// The route: the look cookie, the session and the loader are stand-ins.
const look = { value: "v2" as string | undefined };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (look.value ? { value: look.value } : undefined) }) }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ permissions: ["giving.view"] }), loadSession: async () => ({ status: "signed_out" }) }));
const loads: unknown[] = [];
vi.mock("@/lib/data/giving-bank", async () => {
  const f = await import("@/lib/giving-bank/fixtures");
  return {
    loadBankTab: async (_s: unknown, sp: Record<string, string>) => {
      loads.push(sp);
      return f.sampleBankModel({ role: "treasurer", view: sp.view });
    },
  };
});

import BankRoute from "@/app/(app)/giving/payments/bank/page";
import { BankV2 } from "@/app/(app)/giving/payments/bank/bank-v2";
import { BankTab } from "@/components/giving-bank/bank-tab";
import { sampleBankModel, type BankCommunity, type BankRole } from "@/lib/giving-bank/fixtures";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const draw = (opts: { role?: BankRole; community?: BankCommunity; view?: string; show?: string; accounting?: boolean; bankOff?: boolean } = {}) =>
  renderToStaticMarkup(h(BankTab, { model: sampleBankModel(opts), importer: h("p", null, "IMPORTER") }));

afterEach(() => {
  look.value = "v2";
  loads.length = 0;
});

describe("Giving › Bank for a treasurer of a community club", () => {
  it("draws the tab row, the five views with counts, Import and More", () => {
    const out = draw();
    expect(out).toMatch(/aria-current="page"[^>]*>Bank</);
    for (const v of ["To match", "Deposits", "Zelle", "Card payouts", "History"]) expect(out).toContain(`>${v}<`);
    expect(out).toContain("Import a statement");
    expect(out).toContain(">More</summary>");
    // The importer opens in a sheet: nothing of it is drawn until then.
    expect(out).not.toContain("IMPORTER");
  });

  it("lists the Zelle exact matches ticked, then gift lines with the amount and the family on the button", () => {
    const out = draw();
    expect(out).toContain("Confirm 4 exact matches ($251.00)");
    expect(out.match(/type="checkbox"[^>]*checked=""/g)?.length).toBe(4);
    expect(out).toContain("Confirm $120.00 for Adeyemi household 0127");
    expect(out).toContain("Pick another");
    expect(out).toContain("Choose the family");
    expect(out).toContain("Find the family");
    expect(out).toContain("Set aside…");
  });

  it("reviews a deposit whose payments add up", () => {
    const out = draw({ view: "deposits" });
    expect(out).toContain("Deposit $350.00: 2 recorded payments add up exactly");
    expect(out).toContain("Review deposit of $350.00");
  });

  it("shows the Zelle exact matches and the rest of the reports by section", () => {
    const out = draw({ view: "zelle" });
    expect(out).toContain("Confirm 4 exact matches ($251.00)");
    expect(out).toContain("Waiting for the bank (1)");
    // The old screen's own exact-match block is not drawn a second time.
    expect(out).not.toContain(">Exact matches<");
  });

  it("shows each card payout with both sides and the difference; the treasurer explains and accepts it, or undoes a pairing", () => {
    const out = draw({ view: "payouts" });
    expect(out).toContain("Stripe payout po_1Q2W3E");
    expect(out).toContain("STRIPE TRANSFER ST-P8Q2");
    expect(out).toContain("$3.20 less at the bank than the payout");
    expect(out).toContain("Paired by date");
    expect(out).toContain("Explain and accept pairs them; a difference needs a reason.");
    // Slice 9: the pair found by date gets Explain and accept; the pair the treasurer accepted gets Undo pairing.
    expect(out).toMatch(/<button[^>]*>Explain and accept<\/button>/);
    expect(out).toContain("Paired with this bank line.");
    expect(out).toMatch(/<button[^>]*>Undo pairing<\/button>/);
  });

  it("shows card payouts read-only to someone without giving.manage", () => {
    const out = draw({ view: "payouts", role: "viewer" });
    expect(out).toContain("$3.20 less at the bank than the payout");
    expect(out).not.toMatch(/<button[^>]*>Explain and accept/);
    expect(out).not.toMatch(/<button[^>]*>Undo pairing/);
  });

  it("keeps matched, ignored and money out under History", () => {
    expect(draw({ view: "history" })).toContain("Matched to Lindqvist household 0305, receipt R-2026-0402");
    expect(draw({ view: "history", show: "ignored" })).toContain("Restore to the lines to match");
    expect(draw({ view: "history", show: "out" })).toContain("Ignore…");
  });
});

describe("Giving › Bank for other people and communities", () => {
  it("hides Card payouts without the Accounting module, with no error", () => {
    const out = draw({ accounting: false });
    expect(out).not.toContain("Card payouts");
    expect(out).not.toContain('role="alert"');
  });

  it("draws a society in pounds without Zelle", () => {
    const out = draw({ community: "allotment" });
    expect(out).toContain("Confirm £120.00 for Price household 0214");
    expect(out).not.toContain(">Zelle<");
    expect(draw({ community: "allotment", view: "deposits" })).toContain("Review deposit of £90.00");
  });

  it("shows the lines without buttons to someone with giving.view only", () => {
    const out = draw({ role: "viewer" });
    expect(out).toContain("You can see the bank lines. Matching them needs giving.record_offline or giving.manage.");
    expect(out).not.toContain("Confirm $120.00");
    expect(out).not.toContain("Set aside…");
    expect(out).not.toContain("Import a statement");
  });

  it("lets a finance volunteer match but not set a line aside", () => {
    const out = draw({ role: "volunteer" });
    expect(out).toContain("Confirm $120.00 for Adeyemi household 0127");
    expect(out).not.toContain("Set aside…");
  });

  it("says so to someone without access, never an empty list", () => {
    const out = draw({ role: "approver" });
    expect(out).toContain("You don&#x27;t have access to this area");
    expect(out).not.toContain("To match");
  });

  it("says the module is switched off", () => {
    const out = draw({ bankOff: true });
    expect(out).toContain("Bank reconciliation is switched off");
    expect(out).not.toContain("To match");
  });
});

describe("the route", () => {
  it("draws the New look's Bank tab from the loader", async () => {
    const el = (await BankRoute({ searchParams: Promise.resolve({ view: "deposits" }) })) as ReactElement;
    expect(el.type).toBe(BankV2);
    const out = renderToStaticMarkup((await BankV2({ searchParams: Promise.resolve({ view: "deposits" }) })) as ReactElement);
    expect(loads).toEqual([{ view: "deposits" }]);
    expect(out).toContain("Review deposit of $350.00");
  });

  it("keeps the classic page in the classic look", async () => {
    look.value = undefined;
    const el = (await BankRoute({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(el.type).not.toBe(BankV2);
  });
});
