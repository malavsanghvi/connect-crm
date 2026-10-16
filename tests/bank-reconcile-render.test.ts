import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Bank tab's Reconcile preview, the Unbanked report and the deposit proposal, rendered once on the server (the repo has no browser
// test environment). Nothing is called, only drawn.
vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/giving/payments/bank/actions", () => ({
  attachBankLineAction: vi.fn(),
  confirmBankMatchAction: vi.fn(),
  matchDepositAction: vi.fn(),
  ignoreBankLineAction: vi.fn(),
  restoreBankLineAction: vi.fn(),
}));
vi.mock("@/app/(app)/giving/payments/bank/reconcile-actions", () => ({
  approveProofWithBankLineAction: vi.fn(),
  loadReconcileAction: vi.fn(),
  lookalikeOptionsAction: vi.fn(),
  unreconcileBankLineAction: vi.fn(),
}));
vi.mock("@/app/(app)/giving/actions", () => ({ openPledgesAction: vi.fn(), findHouseholdsAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => "/giving/payments/bank",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import { DepositSetPicker } from "@/components/giving-bank/deposit-set-picker";
import { ReconcileBody } from "@/components/giving-bank/reconcile-view";
import { UnbankedView } from "@/components/giving-bank/unbanked-view";
import { parseStatement } from "@/lib/bank-reconcile/model";
import { parseUnbanked } from "@/lib/bank-reconcile/unbanked";
import type { ReconcileModel, UnbankedModel } from "@/lib/data/giving-reconcile";

const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";
const REF = "33333333-3333-4333-8333-333333333333";
const labels = { orgMemberLabel: "Member ID", orgHouseholdLabel: "Household ID" };
const family = (id: string, name: string, number: string) => ({ id, name, number, orgId: "2210", primary: "Adaeze O.", city: "Riverbend" });

const statement = parseStatement([
  {
    txn: { id: "t1", posted_on: "2026-10-14", amount_cents: 25000, description: "CHECK 1048 DEPOSITED", channel: "check", reference: "1048", payer_name: null },
    candidates: [
      {
        tier: "A",
        kind: "proof",
        ref_id: REF,
        household_id: H1,
        household_name: "Okafor household",
        label: "Payment confirmation sent for Oct 10, check 1048",
        reasons: ["Amount matches", "Reference matches"],
        consequence: "The payment confirmation is approved and banked in one step: its pledges become Paid, then Bank reconciled.",
        blocked: false,
      },
    ],
  },
  {
    txn: { id: "t2", posted_on: "2026-10-08", amount_cents: 20000, description: "ZELLE FROM LINH NGUYEN", channel: "zelle", reference: null, payer_name: "LINH NGUYEN" },
    candidates: [
      {
        tier: "D",
        kind: "lookalike",
        ref_id: null,
        household_id: H2,
        household_name: "Nguyen household",
        label: "This family has Receipt R-2291 of this amount not on the bank yet",
        reasons: ["Same family"],
        consequence: "Creating a second payment is blocked. Attach the line to that payment, or say why this is a separate gift.",
        blocked: true,
      },
    ],
  },
  { txn: { id: "t3", posted_on: "2026-10-07", amount_cents: 1000, description: "UNKNOWN", channel: null, reference: null, payer_name: null }, candidates: [] },
])!;

const model: Extract<ReconcileModel, { state: "ok" }> = {
  state: "ok",
  lines: statement,
  families: { [H1]: family(H1, "Okafor household", "H-1042"), [H2]: family(H2, "Nguyen household", "H-0911") },
  refKinds: {},
  limit: 300,
  problems: [],
};

const props = { labels, currency: "USD", locale: "en-US", timeZone: "America/Chicago", refresh: createElement("span", null, "REFRESH") };

describe("Reconcile preview", () => {
  const html = renderToStaticMarkup(createElement(ReconcileBody, { model, canConfirm: true, ...props }));
  it("says nothing has been written, groups the lines, and says what applying does", () => {
    expect(html).toContain("Nothing has been written.");
    expect(html).toContain("Certain");
    expect(html).toContain("Already accounted for");
    expect(html).toContain("Needs review");
    expect(html).toContain("If you apply:");
    expect(html).toContain("its pledges become Paid, then Bank reconciled");
  });
  it("shows the household card with the number, never the name alone", () => {
    expect(html).toContain("Okafor household H-1042");
    expect(html).toContain("No. H-1042");
    expect(html).toContain("Household ID 2210");
  });
  it("offers the batch only for the Certain rows, ticked, and approves the proof with the line", () => {
    expect(html).toContain("Apply the ticked Certain rows (1)");
    expect(html).toContain("Approve and reconcile");
    expect(html.match(/Apply the ticked Certain rows/g)).toHaveLength(1);
  });
  it("blocks a lookalike behind a choice: see what it matches, or a different gift with a reason", () => {
    expect(html).toContain("Lookalike: blocked");
    expect(html).toContain("See what it matches");
    expect(html).toContain("A different gift (say why)");
  });
  it("sends a line nothing explains to Gifts to match", () => {
    expect(html).toContain("No family, payment or confirmation explains this line");
  });
  it("shows no buttons to someone who may only look", () => {
    const view = renderToStaticMarkup(createElement(ReconcileBody, { model, canConfirm: false, ...props }));
    expect(view).not.toContain("Approve and reconcile");
    expect(view).not.toContain("Apply the ticked Certain rows");
    expect(view).toContain("needs giving.record_offline or giving.manage");
  });
  it("says when the statement is clear", () => {
    const clear = renderToStaticMarkup(createElement(ReconcileBody, { model: { ...model, lines: [] }, canConfirm: true, ...props }));
    expect(clear).toContain("Nothing is waiting to be reconciled");
  });
});

describe("Unbanked report", () => {
  const rows = parseUnbanked([
    { payment_id: "p1", receipt_number: "R-2026-0348", household_id: H1, household_name: "Okafor household", method: "check", amount_cents: 40000, verified_on: "2026-09-10", source: "proof", days: 35, window: 30, past_window: true },
    { payment_id: "p3", receipt_number: "R-2026-0377", household_id: H2, household_name: "Nguyen household", method: "ach", amount_cents: 9000, verified_on: "2026-10-08", source: "recorded by hand", days: 7, window: 7, past_window: false },
  ])!;
  const ok: UnbankedModel = { state: "ok", rows, families: { [H1]: family(H1, "Okafor household", "H-1042") }, problems: [] };
  const common = { labels, currency: "USD", locale: "en-US", timeZone: "America/Chicago" };
  const html = renderToStaticMarkup(createElement(UnbankedView, { model: ok, ...common }));
  it("flags the payment past its window and says the next step", () => {
    expect(html).toContain("Paid, not on the bank.");
    expect(html).toContain("35 / 30 · past");
    expect(html).toContain("7 / 7 · due today");
    expect(html).toContain("1 past the window");
    expect(html).toContain("Ask the family whether the check was sent");
    expect(html).toContain("Member confirmation");
    expect(html).toContain("Recorded by hand");
    expect(html).toContain("Okafor household H-1042");
  });
  it("says when nothing is unbanked, when the report is unreadable, and when the person may not see it", () => {
    expect(renderToStaticMarkup(createElement(UnbankedView, { model: { ...ok, rows: [] }, ...common }))).toContain("Every approved payment is on the bank");
    expect(renderToStaticMarkup(createElement(UnbankedView, { model: { state: "error", error: "Could not read the payments not yet on the bank — boom." }, ...common }))).toContain("boom");
    expect(renderToStaticMarkup(createElement(UnbankedView, { model: { state: "no_access" }, ...common }))).toContain("have access to this area");
  });
});

describe("Deposit proposal", () => {
  const pay = (id: string, amountCents: number, receivedOn: string) => ({ id, amountCents, receivedOn, receipt: `R-${id}`, label: `${id} label` });
  const draw = (payments: ReturnType<typeof pay>[], target: number) => renderToStaticMarkup(createElement(DepositSetPicker, { payments, targetCents: target, currency: "USD", onPick: () => {} }));
  it("proposes the one set that adds up and ticks nothing by itself", () => {
    const html = draw([pay("a", 30000, "2026-10-05"), pay("b", 41000, "2026-10-06"), pay("c", 35000, "2026-10-09"), pay("d", 999, "2026-10-10")], 76000);
    expect(html).toContain("Only one set of recorded payments adds up");
    expect(html).toContain("Tick this set");
  });
  it("lists the combinations and chooses none when several fit", () => {
    const html = draw([pay("a", 500, "2026-10-01"), pay("b", 700, "2026-10-02"), pay("c", 300, "2026-10-03"), pay("d", 900, "2026-10-04")], 1200);
    expect(html).toContain("Nothing is chosen for you");
    expect(html).toContain("Combination 1");
    expect(html).toContain("Combination 2");
  });
  it("draws nothing when all the payments already add up (the existing path), and says when none fits", () => {
    expect(draw([pay("a", 500, "2026-10-01"), pay("b", 700, "2026-10-02")], 1200)).toBe("");
    expect(draw([pay("a", 500, "2026-10-01")], 700)).toContain("No combination");
  });
});
