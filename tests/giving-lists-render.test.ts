import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Giving › Pledges and Giving › Payments (New look) rendered once on the server (the repo has no browser test environment). The
// rows call Server Actions; here nothing is called, only drawn.
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
  usePathname: () => "/giving/pledges",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => {
    redirected.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));

// The routes: the look cookie, the session and the loader are stand-ins.
const look = { value: "v2" as string | undefined };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (look.value ? { value: look.value } : undefined) }) }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ permissions: ["giving.view"] }), loadSession: async () => ({ status: "signed_out" }) }));
const loads: string[] = [];
vi.mock("@/lib/data/giving-lists", async () => {
  const f = await import("@/lib/giving-lists/fixtures");
  return {
    loadPledgesList: async (_s: unknown, sp: Record<string, string>) => {
      loads.push("pledges");
      return f.samplePledgesModel("treasurer", sp);
    },
    loadPaymentsList: async (_s: unknown, sp: Record<string, string>) => {
      loads.push("payments");
      return { ...f.samplePaymentsModel("treasurer", sp), record: null, counters: null };
    },
  };
});

import PaymentsRoute from "@/app/(app)/giving/payments/page";
import PledgesRoute from "@/app/(app)/giving/pledges/page";
import RecurringRoute from "@/app/(app)/giving/recurring/page";
import GivingListsPreview from "@/app/dev/giving-lists/page";
import { PaymentsView } from "@/components/giving-lists/payments-view";
import { PledgesView } from "@/components/giving-lists/pledges-view";
import { samplePaymentsModel, samplePledgesModel } from "@/lib/giving-lists/fixtures";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToStaticMarkup(el);

afterEach(() => {
  vi.unstubAllEnvs();
  look.value = "v2";
  loads.length = 0;
  redirected.length = 0;
});

describe("Giving › Pledges", () => {
  const out = html(h(PledgesView, { model: samplePledgesModel("treasurer") }));

  it("draws the tab row, the search, the chips, the buckets and the rows", () => {
    expect(out).toMatch(/aria-current="page"[^>]*>Pledges</);
    expect(out).toContain('placeholder="Find a pledge by family, pledge number or amount"');
    expect(out).toMatch(/aria-current="page"[^>]*>Open<span[^>]*>6<\/span>/);
    // The Behind-by buckets are one dropdown on the toolbar; its options are links drawn once it is open (filter-menu).
    expect(out).toMatch(/<button[^>]*>Behind by</);
    expect(out).not.toContain("Over 90 days");
    expect(out).toContain("open across 6 pledges");
    expect(out).toContain("PL-0455");
    expect(out).toContain("12 days behind");
  });

  it("names every family with its household card, never with the member list", () => {
    expect(out).toContain("No. 0127 · Club household ID LCC-H-1127 · Primary: Tola Adeyemi · Lakeside");
    expect(out).not.toContain("Members:");
  });

  it("acts in the row: the state's button on it, the rest in its menu (kept mounted, hidden until opened)", () => {
    expect(out).toContain("Write off $120.00 for Nguyen household 0441");
    expect(out).toContain("You asked for this write-off, so a different person with approval rights approves it.");
    expect(out).toContain('aria-label="More for PL-0455"');
    expect(out).toMatch(/<div id="[^"]+" hidden=""/);
    expect(out).toContain(">Write off…</button>");
    expect(out).toContain('href="/giving/payments?record=1&amp;household=1a2b3c4d-0000-4000-8000-000000000127"');
  });

  it("is a card per row on a phone, with chips that scroll sideways", () => {
    expect(out).toContain("rounded-[14px] border border-line bg-white p-3 md:rounded-none");
    expect(out).toContain("overflow-x-auto");
  });

  it("a search that finds one pledge shows its actions open, with no menu to go through", () => {
    const one = html(h(PledgesView, { model: samplePledgesModel("treasurer", { q: "PL-0455" }) }));
    expect(one).toContain("Found by its pledge number");
    expect(one).not.toContain('aria-label="More for PL-0455"');
    expect(one).toContain(">Write off…</button>");
    expect(one).toContain(">Record payment</a>");
  });

  it("someone who cannot open Pledges is told so, never shown an empty table", () => {
    const model = { ...samplePledgesModel("treasurer"), body: { state: "no_access" as const, area: "Pledges", access: "pledges" as const } };
    const denied = html(h(PledgesView, { model }));
    expect(denied).toContain("You don&#x27;t have access to this area");
    expect(denied).not.toContain('aria-label="Pledges"');
  });

  it("an error says what failed, with a retry", () => {
    const model = { ...samplePledgesModel("treasurer"), body: { state: "error" as const, error: "Could not read the pledges — timeout.", retry: "/giving/pledges" } };
    const failed = html(h(PledgesView, { model }));
    expect(failed).toContain("Could not read the pledges — timeout.");
    expect(failed).toContain(">Try again</a>");
  });
});

describe("Giving › Payments", () => {
  it("lists every payment with the method and source chips and the views", () => {
    const out = html(h(PaymentsView, { model: samplePaymentsModel("treasurer") }));
    expect(out).toMatch(/aria-current="page"[^>]*>Payments</);
    for (const t of ["All payments", "Refunds", "Grants to match", "Recurring"]) expect(out).toContain(`>${t}`);
    // Method and Source are dropdowns on the one-line toolbar.
    for (const t of ["Method", "Source", "Year"]) expect(out).toMatch(new RegExp(`<button[^>]*>${t}<`));
    // The counts have their own tab since slice 5: no counts view here, the tab row links to it.
    expect(out).not.toContain("view=counts");
    expect(out).toContain('href="/giving/counts"');
    expect(out).toContain("Refund $25.00 to Kim household 0398 through Stripe");
    expect(out).toContain("Apply $120.00 to Nguyen household 0441&#x27;s pledges");
    expect(out).toContain(">Refund…</button>");
  });

  it("Refunds shows the provider's flagged refunds above the requests", () => {
    const out = html(h(PaymentsView, { model: samplePaymentsModel("treasurer", { view: "refunds" }) }));
    expect(out).toContain("Refunds made in a card provider&#x27;s dashboard");
    expect(out).toContain("Approve $15.00 card refund for Kim household 0398 (first approval)");
    expect(out).toContain("Refund requests");
  });

  it("Grants to match, and Recurring as a read-only view", () => {
    expect(html(h(PaymentsView, { model: samplePaymentsModel("treasurer", { view: "grants" }) }))).toContain("Match $250.00…");
    const rec = html(h(PaymentsView, { model: samplePaymentsModel("treasurer", { view: "recurring" }) }));
    expect(rec).toContain("Recurring gifts are set up in the member app.");
    expect(rec).toContain("Payment failed");
    expect(rec).not.toContain("Refund…");
  });

  it("an add-on that is off says so at its address", () => {
    const out = html(h(PaymentsView, { model: samplePaymentsModel("treasurer", { view: "recurring" }, undefined, { modulesOff: ["giving_recurring"] }) }));
    expect(out).toContain("Recurring gifts is switched off");
    expect(out).toContain('data-testid="view-switched-off"');
  });

  it("a finance volunteer reads a limited view", () => {
    const out = html(h(PaymentsView, { model: samplePaymentsModel("volunteer") }));
    expect(out).toContain("Limited view: you see the payments you recorded yourself.");
    expect(out).not.toContain(">Refund…</button>");
  });

  it("offers Export and the Year chips to the treasurer; a second approver is told why there is no Export (slice 9)", () => {
    const out = html(h(PaymentsView, { model: samplePaymentsModel("treasurer", { year: "2026" }) }));
    expect(out).toMatch(/<button[^>]*>Export<\/button>/);
    expect(out).toMatch(/<button[^>]*data-on="true"[^>]*>Year: 2026</);
    const approver = html(h(PledgesView, { model: samplePledgesModel("approver") }));
    expect(approver).not.toMatch(/<button[^>]*>Export<\/button>/);
    expect(approver).toContain("Exporting needs the data-export permission. Ask your administrator.");
    // Grants to match has no export.
    expect(html(h(PaymentsView, { model: samplePaymentsModel("treasurer", { view: "grants" }) }))).not.toMatch(/<button[^>]*>Export<\/button>/);
  });
});

describe("the routes", () => {
  type Route = (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
  const drawn = async (route: Route, sp: Record<string, string>) => {
    const el = (await route({ searchParams: Promise.resolve(sp) })) as ReactElement<Record<string, unknown>>;
    // The route hands an async server component to the framework: run it here, then draw what it returns.
    return html((await (el.type as (p: unknown) => Promise<ReactElement>)(el.props)) as ReactElement);
  };

  it("the New look draws the new tabs through their loaders", async () => {
    const p = await drawn(PledgesRoute as Route, { q: "PL-0455" });
    expect(loads).toEqual(["pledges"]);
    expect(p).toContain("Found by its pledge number");
    const pay = await drawn(PaymentsRoute as Route, { view: "refunds" });
    expect(loads).toEqual(["pledges", "payments"]);
    expect(pay).toContain("Refund requests");
  });

  it("the classic look keeps the classic pages", async () => {
    look.value = undefined;
    const el = (await PledgesRoute({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect((el.type as { name: string }).name).toBe("PledgesPage");
    const pay = (await PaymentsRoute({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect((pay.type as { name: string }).name).toBe("PaymentsPage");
    expect(loads).toEqual([]);
  });

  it("Recurring is a view of Payments in the New look", async () => {
    await expect(RecurringRoute({ searchParams: Promise.resolve({ status: "failed" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected).toEqual(["/giving/payments?view=recurring&rstatus=failed"]);
  });

  it("the old counts view of Payments sends to the counts tab (slice 5)", async () => {
    await expect(drawn(PaymentsRoute as Route, { view: "counts" })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected).toContain("/giving/counts");
    expect(loads).not.toContain("payments");
  });

  it("the dev preview is not served in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(GivingListsPreview({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });

});
