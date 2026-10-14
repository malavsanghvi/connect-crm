import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Giving › Today rendered once on the server (the repo has no browser test environment). The rows call Server Actions; here
// nothing is called, only drawn.
vi.mock("@/app/(app)/approvals/actions", () => ({
  approveAsSecondAction: vi.fn(),
  approveFlaggedRefundAction: vi.fn(),
  completeWriteOffAction: vi.fn(),
  recordRefundAction: vi.fn(),
  requestWriteOffAction: vi.fn(),
}));
vi.mock("@/app/(app)/giving/actions", () => ({ openPledgesAction: vi.fn(), findHouseholdsAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/actions", () => ({ applyPaymentAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/bank/actions", () => ({ confirmBankMatchAction: vi.fn(), matchDepositAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/bank/zelle-actions", () => ({ confirmExactMatchesAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/counting-actions", () => ({ recordCountingDepositAction: vi.fn(), createCountingSessionAction: vi.fn() }));
vi.mock("@/app/(app)/giving/counts/actions", () => ({ countSheetAction: vi.fn(), depositChoicesAction: vi.fn(), matchCountDepositAction: vi.fn(), unmatchCountDepositAction: vi.fn() }));
vi.mock("@/app/(app)/accounting/close/actions", () => ({ setCloseItemAction: vi.fn() }));
vi.mock("@/app/(app)/accounting/qbo/matching/actions", () => ({ approveMatchAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/search/find-actions", () => ({ findAction: vi.fn() }));
let pathname = "/giving";
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// The route: the look cookie, the session and the loader are stand-ins.
const look = { value: "v2" as string | undefined };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (look.value ? { value: look.value } : undefined) }) }));
const session = { permissions: ["giving.approve"] as string[], isPlatformAdmin: false, modulesOff: ["bolis"] as string[], kind: undefined as unknown };
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const loaded: { show: string | null | undefined }[] = [];
vi.mock("@/lib/data/giving-today", async () => {
  const f = await import("@/lib/giving-today/fixtures");
  return {
    loadGivingToday: async (_s: unknown, o?: { show?: string | null }) => {
      loaded.push({ show: o?.show });
      return f.sampleTodayModel("approver", { show: o?.show ?? undefined });
    },
  };
});

import GivingLayout from "@/app/(app)/giving/layout";
import GivingTodayRoute from "@/app/(app)/giving/page";
import GivingTodayPreview from "@/app/dev/giving-today/page";
import { GivingTabsProvider } from "@/components/giving-today/giving-tabs";
import { TodayPage } from "@/components/giving-today/today-page";
import { LookProvider } from "@/components/shell/look-context";
import { ModulesProvider, ModuleTabs } from "@/components/shell/module-tabs";
import { ROLE_PERMISSIONS, sampleTodayModel } from "@/lib/giving-today/fixtures";
import { givingTabs } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND } from "@/lib/kind";
import { visibleNav } from "@/lib/permissions";

session.kind = NEUTRAL_KIND;

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToStaticMarkup(el);
const page = (role: "treasurer" | "approver" | "volunteer", show?: string) => html(h(TodayPage, { model: sampleTodayModel(role, { show }) }));

afterEach(() => {
  vi.unstubAllEnvs();
  look.value = "v2";
  pathname = "/giving";
  session.permissions = ["giving.approve"];
});

describe("Giving › Today for a treasurer", () => {
  const out = page("treasurer");

  it("draws the tab row, the queue with its tiles and every kind of row, in place", () => {
    expect(out).toContain('aria-label="Giving sections"');
    expect(out).toMatch(/aria-current="page"[^>]*>Today</);
    expect(out).toContain("Work queue");
    for (const t of ["Everything", "Approvals", "Bank", "Pledges", "Cash counts", "Books"]) expect(out).toContain(`>${t}</span>`);
    for (const text of [
      "Approve $25.00 card refund for Kim household 0398 (first approval)",
      "Write off $120.00 for Nguyen household 0441",
      "Mark $30.00 credit for Lindqvist household 0305 handled",
      "2 waiting for the second approver",
      "Confirm 2 exact matches ($150.00)",
      "Confirm $120.00 for Adeyemi household 0127",
      "Choose the family",
      "Review deposit of $310.00",
      "4 more bank lines to match",
      "1 Zelle report not seen at the bank",
      "3 households are behind on pledges",
      "Write off…",
      "Apply $50.00 to the open pledges of Lindqvist household 0305",
      // Slice 5: the counter picks the bank line; the slip reference stays next to it.
      "Match its deposit",
      "Mark deposited",
      "Start a count",
      "October 2026 close: 1 of 3 checks",
      "Mark done",
      "2 QuickBooks postings failed",
    ]) {
      expect(out).toContain(text);
    }
  });

  it("names every family with its number, household id and primary adult, never with the member list", () => {
    expect(out).toContain("No. 0127 · Club household ID LCC-H-1127 · Primary: Tola Adeyemi · Lakeside");
    expect(out).not.toContain("Tomás");
    expect(out).not.toContain("Members:");
  });

  it("shows the month's three numbers, the recent families and the phone bar", () => {
    expect(out).toContain("$8,420.00");
    expect(out).toContain("recorded this month");
    expect(out).toContain("$31,450.00");
    expect(out).toContain("77%");
    expect(out).toContain("of this month&#x27;s bank lines matched (31 of 40)");
    expect(out).toContain("Recent families");
    expect(out).toContain('href="/households/1a2b3c4d-0000-4000-8000-000000000127"');
    expect(out).toContain(">Record payment</a>");
    // The phone bar's Find focuses the large box on the page (slice 2), it no longer opens the palette or another page.
    expect(out).toContain(">Find</button>");
  });

  it("puts the large Giving box above the queue, and the old conversation page is no longer linked (slice 2)", () => {
    expect(out).toContain('aria-label="Find in Giving"');
    expect(out).toContain("A family, a receipt number, an amount, or what you received: 200 check patel");
    expect(out.indexOf('aria-label="Find in Giving"')).toBeLessThan(out.indexOf("Work queue"));
    expect(out).not.toContain("Type what you received");
    expect(out).not.toContain("/giving/ask");
  });

  it("opens on the tile in the address and lists only its rows", () => {
    const bank = page("treasurer", "bank");
    expect(bank).toMatch(/aria-pressed="true"[^>]*><span[^>]*>\d+<\/span><span[^>]*>Bank</);
    expect(bank).toContain("4 more bank lines to match");
    expect(bank).not.toContain("Credit of $30.00 to handle");
  });

  it("says what could not be read next to it, with a way to try again, and says when nothing waits", () => {
    const model = sampleTodayModel("treasurer");
    const failed = html(h(TodayPage, { model: { ...model, queue: { ...model.queue, problems: [{ group: "bank", message: "Could not read the bank lines — timeout." }] } } }));
    expect(failed).toContain("Could not read the bank lines — timeout.");
    expect(failed).toContain("Reload to try again");
    const empty = html(h(TodayPage, { model: { ...model, queue: { ...model.queue, rows: [], problems: [] } } }));
    expect(empty).toContain("Nothing is waiting for you. When something needs you, it shows here.");
  });
});

describe("Giving › Today for other roles", () => {
  it("a second approver (giving.approve only) sees the approvals they can give, and nothing else", () => {
    const out = page("approver");
    expect(out).toContain("You are the second approver.");
    expect(out).toContain("Approve $40.00 refund for Adeyemi household 0127");
    expect(out).toContain("Reason: “Paid twice at the autumn fair”");
    expect(out).toContain("1 card refund waiting for a treasurer&#x27;s first approval");
    expect(out).not.toContain("Recent families");
    expect(out).not.toContain("October 2026");
    expect(out).not.toContain(">Record payment</a>");
    // One tab only: no tab row.
    expect(out).not.toContain('aria-label="Giving sections"');
  });

  it("a finance volunteer sees a limited view: pledges as counts, no write-off", () => {
    const out = page("volunteer");
    expect(out).toContain("Limited view: you see what you can act on.");
    expect(out).toContain("3 households are behind on pledges");
    expect(out).not.toContain("Write off…");
    expect(out).toContain("recorded by you this month");
    expect(out).toContain("Confirm 2 exact matches ($150.00)");
  });
});

describe("the /giving route", () => {
  it("in the classic look goes to the first Giving page the person can open", async () => {
    look.value = undefined;
    session.permissions = ROLE_PERMISSIONS.treasurer;
    await expect(GivingTodayRoute({})).rejects.toMatchObject({ digest: expect.stringContaining("/giving/pledges") });
    session.permissions = [];
    await expect(GivingTodayRoute({})).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("in the New look opens for a second approver, passes the tile on, and says 'no access' to anyone else", async () => {
    const out = html((await GivingTodayRoute({ searchParams: Promise.resolve({ show: "approvals" }) })) as ReactElement);
    expect(out).toContain("Approve $40.00 refund for Adeyemi household 0127");
    expect(loaded.at(-1)).toEqual({ show: "approvals" });
    session.permissions = ["bolis.view"];
    expect(html((await GivingTodayRoute({})) as ReactElement)).toContain("You don&#x27;t have access to this area");
  });
});

describe("one tab row on every Giving page in the New look", () => {
  it("the layout hands the row down in the New look only", async () => {
    session.permissions = ROLE_PERMISSIONS.treasurer;
    const v2 = (await GivingLayout({ children: "page" })) as ReactElement<{ tabs: { key: string }[] }>;
    expect(v2.type).toBe(GivingTabsProvider);
    expect(v2.props.tabs.map((t) => t.key)).toContain("bank");
    look.value = undefined;
    const classic = (await GivingLayout({ children: "page" })) as ReactElement;
    expect(classic.type).not.toBe(GivingTabsProvider);
  });

  it("a Giving page's header draws the Giving row instead of the module pills and the old strip", () => {
    pathname = "/giving/pledges";
    const ctx = { permissions: ROLE_PERMISSIONS.treasurer, isPlatformAdmin: false, modulesOff: ["bolis"], kind: NEUTRAL_KIND };
    const draw = (lk: "classic" | "v2") =>
      html(h(LookProvider, { look: lk }, h(ModulesProvider, { modules: visibleNav(ctx) }, h(GivingTabsProvider, { tabs: givingTabs(ctx) }, h(ModuleTabs, null)))));
    const v2 = draw("v2");
    expect(v2).toMatch(/aria-current="page"[^>]*>Pledges</);
    expect(v2).toContain('href="/giving"');
    expect(v2).toContain(">Bank<");
    expect(v2).not.toContain("Giving areas");
    // The classic look is untouched.
    const classic = draw("classic");
    expect(classic).toContain(">Payments &amp; deposits<");
    expect(classic).not.toContain('href="/giving"');
  });
});

describe("the dev preview", () => {
  const call = (sp: Record<string, string> = {}) => GivingTodayPreview({ searchParams: Promise.resolve(sp) });
  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
  it("draws Today in the shell with invented data for a neutral club, for each role", async () => {
    const out = html(await call());
    expect(out).toContain("DEV PREVIEW · SAMPLE DATA");
    expect(out).toContain("Lakeside Community Club");
    expect(out).toContain("Work queue");
    expect(html(await call({ role: "approver" }))).toContain("You are the second approver.");
    expect(html(await call({ role: "volunteer" }))).toContain("Limited view");
  });
});
