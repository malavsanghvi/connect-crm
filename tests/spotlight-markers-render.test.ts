import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The real screens, drawn once on the server, carry the data-spotlight keys the treasurer's tour lights: on the right elements, only on the
// line the tour picks, and never where the tour has nothing to show. (tests/spotlight-tours.test.ts checks that every key is in the source;
// this checks what the screens actually draw.) The rows call Server Actions; here nothing is called, only drawn.
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

import { GiftLineMatcher, type Suggestion } from "@/app/(app)/giving/payments/bank/gift-line-matcher";
import { BankTab } from "@/components/giving-bank/bank-tab";
import { MyTasksCard } from "@/components/home/my-tasks-card";
import type { HouseholdCardData } from "@/components/household-card";
import { ModuleNav } from "@/components/shell/nav-link";
import { WorkspaceRail, type RailWorkspace } from "@/components/shell/workspace-rail";
import { sampleBankModel } from "@/lib/giving-bank/fixtures";
import { makeTask } from "@/lib/tasks";
import { WORKSPACES } from "@/lib/workspaces";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const draw = (el: ReactElement) => renderToStaticMarkup(el);
const count = (html: string, key: string) => html.split(`data-spotlight="${key}"`).length - 1;

describe("Giving › Bank (New look) for a treasurer", () => {
  const html = draw(h(BankTab, { model: sampleBankModel({ role: "treasurer" }), importer: null }));

  it("marks the view chips once", () => {
    expect(count(html, "bank-views")).toBe(1);
  });

  it("marks one line, its household and its Confirm match button: the first line that has a clear suggestion", () => {
    expect(count(html, "bank-line")).toBe(1);
    expect(count(html, "bank-household")).toBe(1);
    expect(count(html, "bank-confirm")).toBe(1);
    const line = html.indexOf('data-spotlight="bank-line"');
    const household = html.indexOf('data-spotlight="bank-household"');
    const confirm = html.indexOf('data-spotlight="bank-confirm"');
    expect(line).toBeLessThan(household);
    expect(household).toBeLessThan(confirm);
    // All three are in the same row: the one with the best match, not one of the lines that still need a family chosen.
    const row = html.slice(line, html.indexOf("Set aside", confirm));
    expect(row).toContain("best match found");
    expect(row).toContain("Adeyemi household");
    expect(row).not.toContain("choose the family");
    // The marked button is the real Confirm match button, which names the amount and the family.
    expect(html.slice(confirm, confirm + 400)).toContain("Confirm $120.00 for Adeyemi household 0127");
  });

  it("marks nothing on the Deposits view (it has no household suggestion to teach)", () => {
    const deposits = draw(h(BankTab, { model: sampleBankModel({ role: "treasurer", view: "deposits" }), importer: null }));
    expect(count(deposits, "bank-views")).toBe(1);
    for (const key of ["bank-line", "bank-household", "bank-confirm"]) expect(count(deposits, key)).toBe(0);
  });
});

describe("the classic Bank screen's matcher", () => {
  const labels = { orgMemberLabel: "Member ID", orgHouseholdLabel: "Household ID" };
  const card = (id: string, name: string): HouseholdCardData => ({
    household_id: id,
    household_name: name,
    household_number: "H-1",
    org_household_id: "0127",
    members: "Tola Adeyemi",
    primary_member: "Tola Adeyemi",
    primary_org_member_id: "0412",
    zone: "North",
    city: "Lakeside",
    last_gift_on: "2026-09-01",
    open_pledge_cents: 0,
  });
  const clear: Suggestion = { ...card("11111111-0000-4000-8000-000000000001", "Adeyemi household"), score: 0.95, reason: "Known payer name", ambiguous: false };
  const unsure: Suggestion = { ...card("11111111-0000-4000-8000-000000000002", "Shah household"), score: 0.45, reason: "Several households match", ambiguous: true };
  const matcher = (suggestions: Suggestion[], tour: boolean) =>
    draw(
      h(GiftLineMatcher, {
        txnId: "22222222-0000-4000-8000-000000000001",
        amountCents: 12000,
        payerName: "T ADEYEMI",
        originatorKind: null,
        suggestions,
        suggestionError: null,
        labels,
        timeZone: "America/Chicago",
        currency: "USD",
        canConfirm: true,
        tour,
      }),
    );

  it("lights the first clear suggestion's household card and its Confirm match button when the tour is on this line", () => {
    const out = matcher([unsure, clear], true);
    expect(count(out, "bank-household")).toBe(1);
    expect(count(out, "bank-confirm")).toBe(1);
    // The marked card is the clear one, not the ambiguous one before it.
    expect(out.slice(out.indexOf('data-spotlight="bank-household"'))).toContain("Adeyemi household");
    expect(out.slice(out.indexOf('data-spotlight="bank-household"'), out.indexOf('data-spotlight="bank-confirm"'))).not.toContain("Shah household");
    expect(out.slice(out.indexOf('data-spotlight="bank-confirm"'), out.indexOf('data-spotlight="bank-confirm"') + 400)).toContain("Confirm match");
  });

  it("marks nothing on a line the tour is not on", () => {
    const out = matcher([clear], false);
    expect(count(out, "bank-household")).toBe(0);
    expect(count(out, "bank-confirm")).toBe(0);
  });

  it("has no Confirm match button to light when every suggestion needs a careful look, and says nothing false", () => {
    const out = matcher([unsure], true);
    expect(count(out, "bank-confirm")).toBe(0);
    expect(count(out, "bank-household")).toBe(0);
    expect(out).toContain("Review this household");
  });
});

describe("Home", () => {
  const bankTask = makeTask("deposits", "all", "4 bank lines to match", "Money in without a matched gift", [{ label: "Open", href: "/giving/bank" }], undefined, {
    kind: "bank_lines",
    stage: "open",
    id: "all",
    householdId: null,
    amountCents: null,
    reference: null,
    reason: null,
    askedBy: null,
    mine: false,
    since: null,
    provider: null,
    count: 4,
    deposits: 1,
  });
  const otherTask = makeTask("writeoff", "w1", "A write-off waits", "Asked for by a colleague", [{ label: "Open", href: "/giving/pledges" }]);

  it("lights the bank-lines row and no other row", () => {
    const out = draw(h(MyTasksCard, { tasks: [otherTask, bankTask], failures: [], hasSources: true }));
    expect(count(out, "home-bank-task")).toBe(1);
    const at = out.indexOf('data-spotlight="home-bank-task"');
    expect(out.slice(at, at + 600)).toContain("4 bank lines to match");
    expect(out.slice(at, at + 600)).not.toContain("A write-off waits");
  });

  it("marks nothing for a person whose tasks have no bank lines", () => {
    expect(count(draw(h(MyTasksCard, { tasks: [otherTask], failures: [], hasSources: true })), "home-bank-task")).toBe(0);
  });
});

describe("the navigation", () => {
  it("the classic sidebar's Giving link is found by nav-giving, and each module by its own key", () => {
    const modules = [
      { key: "home", label: "Home", href: "/", paths: ["/"], tabs: [{ href: "/" }] },
      { key: "giving", label: "Giving", href: "/giving/pledges", paths: ["/giving"], tabs: [{ href: "/giving/pledges" }] },
    ];
    const out = draw(h(ModuleNav, { modules }));
    expect(count(out, "nav-home")).toBe(1);
    expect(count(out, "nav-giving")).toBe(1);
    expect(out.slice(out.indexOf('data-spotlight="nav-giving"'))).toContain("Giving");
  });

  it("the New look's rail has the same key for the Giving workspace", () => {
    const giving = WORKSPACES.find((w) => w.key === "giving")!;
    const workspaces: RailWorkspace[] = [{ key: giving.key, label: giving.label, href: "/giving", icon: giving.icon, placement: "start", paths: ["/giving"], tabs: [] }];
    const out = draw(h(WorkspaceRail, { workspaces, account: h("span", null, "A") }));
    expect(count(out, "nav-giving")).toBe(1);
  });
});
