import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Giving › the counts tab (New look, slice 5) rendered once on the server (the repo has no browser test environment). The rows
// and sheets call Server Actions; here nothing is called, only drawn.
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
vi.mock("@/app/(app)/giving/payments/actions", () => ({ applyPaymentAction: vi.fn(), recordOfflinePaymentAction: vi.fn(), possibleDuplicateZelleAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/bank/actions", () => ({ confirmBankMatchAction: vi.fn(), matchDepositAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/bank/zelle-actions", () => ({ confirmExactMatchesAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/counting-actions", () => ({ recordCountingDepositAction: vi.fn(), createCountingSessionAction: vi.fn() }));
vi.mock("@/app/(app)/giving/counts/actions", () => ({ countSheetAction: vi.fn(), depositChoicesAction: vi.fn(), matchCountDepositAction: vi.fn(), unmatchCountDepositAction: vi.fn() }));
vi.mock("@/app/(app)/accounting/close/actions", () => ({ setCloseItemAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));
const redirected: string[] = [];
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => "/giving/counts",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => {
    redirected.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));
const look = { value: "v2" as string | undefined };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (look.value ? { value: look.value } : undefined) }) }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ permissions: ["giving.view"] }), loadSession: async () => ({ status: "signed_out" }) }));
const loads: string[] = [];
vi.mock("@/lib/data/giving-counts", async () => {
  const f = await import("@/lib/giving-counts/fixtures");
  return {
    loadCountsTab: async (_s: unknown, sp: Record<string, string>) => {
      loads.push("counts");
      return f.sampleCountsModel("treasurer", sp);
    },
  };
});

import CountsPage from "@/app/(app)/giving/counts/page";
import GivingCountsPreview from "@/app/dev/giving-counts/page";
import { CountsView } from "@/components/giving-counts/counts-view";
import { sampleCountsModel } from "@/lib/giving-counts/fixtures";
import { ROWING_CLUB } from "@/lib/giving-lists/fixtures";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToStaticMarkup(el);

afterEach(() => {
  vi.unstubAllEnvs();
  look.value = "v2";
  loads.length = 0;
  redirected.length = 0;
});

describe("Giving › the counts tab", () => {
  it("a treasurer: the kind's word, Start a count, the rows with their deposits and in-row actions", () => {
    const out = html(h(CountsView, { model: sampleCountsModel("treasurer") }));
    expect(out).toContain(">Cash counts</h1>");
    expect(out).toMatch(/aria-current="page"[^>]*>Cash counts</);
    expect(out).toContain(">Start a count</button>");
    expect(out).toContain("2 counts waiting for the deposit · $412.50");
    expect(out).toContain("Bags 118, 119");
    expect(out).toContain("Counted by Sam Carter and Linh Nguyen");
    expect(out).toContain(">Match its deposit</button>");
    expect(out).toContain("Matched to the bank");
    expect(out).toContain("Bank deposit of Oct 6, 2026 · $380.00 · Operating ••4410");
    expect(out).toContain("Deposit slip SLIP-4471");
    // No family is named on a count: it has no donor.
    expect(out).not.toContain("household 0127");
  });

  it("Bank reconciliation off: Mark deposited with the slip, no line to pick", () => {
    const out = html(h(CountsView, { model: sampleCountsModel("treasurer", {}, undefined, { modulesOff: ["giving_bank"] }) }));
    expect(out).toContain(">Mark deposited</button>");
    expect(out).not.toContain("Match its deposit");
    expect(out).toContain("with the slip number.");
  });

  it("a viewer reads; no Start a count, no buttons", () => {
    const out = html(h(CountsView, { model: sampleCountsModel("approver") }));
    expect(out).not.toContain("Start a count");
    expect(out).not.toContain("Match its deposit");
    expect(out).toContain("You can see the counts.");
  });

  it("switched off: the module sentence, never an empty page", () => {
    const out = html(h(CountsView, { model: sampleCountsModel("treasurer", {}, undefined, { modulesOff: ["giving_counts"] }) }));
    expect(out).toContain('data-testid="view-switched-off"');
    expect(out).toContain("switched off");
    expect(out).not.toContain("Start a count");
  });

  it("a non-faith club in euros", () => {
    const out = html(h(CountsView, { model: sampleCountsModel("volunteer", {}, ROWING_CLUB) }));
    expect(out).toContain("€412.50");
    expect(out).toContain(">Start a count</button>");
  });
});

describe("the route", () => {
  type Route = (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
  it("the New look draws the tab through its loader", async () => {
    const el = (await (CountsPage as Route)({ searchParams: Promise.resolve({ view: "waiting" }) })) as ReactElement;
    expect(loads).toEqual(["counts"]);
    const out = html(el);
    // The counts to show are a switch on the toolbar (cc-seg); the open one is marked.
    expect(out).toMatch(/class="cc-seg"[\s\S]*aria-current="page"/);
    expect(out).toContain("Waiting for the deposit");
  });

  it("the classic look keeps its counting section on Payments", async () => {
    look.value = undefined;
    await expect((CountsPage as Route)({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected).toEqual(["/giving/payments#counting"]);
    expect(loads).toEqual([]);
  });

  it("the dev preview is not served in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(GivingCountsPreview({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });
});
