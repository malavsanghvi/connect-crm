// What the Weaver team sees (docs/PAYMENT_ADDONS.md §11.2): the "Chip In and card fees" card on Platform › Centers › [organization] and the
// Stripe fee rates on Platform › Payments, who can see them, what an organization's owner sees on Home, and every state in words
// (not set, set but off, on, refused by the database, a read that failed).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/platform",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), loadSession: vi.fn(), dbWithReason: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/lib/experiences-db", () => ({ loadExperiences: vi.fn(async () => ({ status: "ok", experiences: [{ key: "jain_center", label: "Jain Center" }] })) }));
vi.mock("@/lib/assistant/key", () => ({ assistantApiKey: vi.fn(async () => null) }));

import PlatformCenterPage from "@/app/(app)/platform/centers/[id]/page";
import { ChipInCard } from "@/app/(app)/platform/centers/[id]/chip-in-card";
import { FeeRatesCard } from "@/app/(app)/platform/payments/fee-rates-card";
import PlatformPaymentsPage from "@/app/(app)/platform/payments/page";
import { HomeNotices } from "@/components/home/notices";
import type { ChipInCardData, PlatformFeeRatesData, Section } from "@/lib/data/chip-in-platform";
import { loadHomeNotices } from "@/lib/data/home-notices";
import type { ChipInSettings, FeeRates } from "@/lib/payments/chip-in-platform";
import { getSession } from "@/lib/session";

import { fakeDb, fakeSession } from "./commands/helpers";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const TZ = "America/Chicago";
const CENTER = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1150";
const ok = <T,>(value: T): Section<T> => ({ ok: true, value });
const refused: Section<never> = { ok: false, reason: "no_access" };

const JSH: ChipInSettings = {
  asking: false,
  yearlyLimitCents: 5000,
  suggestedCents: [200, 500, 1000],
  reason: "Owner decision 2026-10-15: $50 yearly Chip In limit per account for JSH; asking stays off until the go-live gate",
  updatedBy: null,
  updatedAt: "2026-10-15T17:00:00Z",
};
const OVERVIEW = {
  calendarYear: 2026,
  asking: false,
  yearlyLimitCents: 5000,
  live: { accounts: 4, collectedCents: 12_500, refundedCents: 500, inFlightCents: 200, accountsAtLimit: 1 },
  test: { accounts: 2, collectedCents: 700, refundedCents: 0, inFlightCents: 0, accountsAtLimit: 0 },
};
const STANDARD: FeeRates = {
  card: { bps: 290, fixedCents: 30, capCents: null, custom: false, effectiveFrom: "2020-01-01T00:00:00Z", sourceNote: "Stripe US standard pricing: cards 2.9% + 30 cents" },
  ach: { bps: 80, fixedCents: 0, capCents: 500, custom: false, effectiveFrom: "2020-01-01T00:00:00Z", sourceNote: "Stripe US standard pricing: ACH 0.8% capped at $5.00" },
};
const data = (over: Partial<ChipInCardData> = {}): ChipInCardData => ({ settings: ok<ChipInSettings | null>(JSH), overview: ok(OVERVIEW), rates: ok(STANDARD), changedBy: "Weaver's team", ...over });
const card = (d: ChipInCardData) => render(createElement(ChipInCard, { centerId: CENTER, data: d, tz: TZ }));
const switchTag = (html: string) => html.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? "";
// The attribute, not the word: the switch's class names mention disabled.
const isDisabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag);
const attr = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getSession).mockReset();
});

describe("Platform › Centers › [organization] · Chip In and card fees", () => {
  it("not set: says so, keeps the switch off and shut, and says why in plain words", () => {
    const html = card(data({ settings: ok(null), changedBy: "" }));
    expect(html).toContain("Chip In and card fees");
    expect(html).toContain("Not set. No Chip In is asked of this organization&#x27;s members.");
    expect(switchTag(html)).toContain('aria-checked="false"');
    expect(isDisabled(switchTag(html))).toBe(true);
    expect(html).toContain('data-testid="chip-in-turn-on-blocked"');
    expect(html).toContain("A Chip In cannot be turned on until a yearly limit and at least one suggested amount are saved. Save them first, then switch it on.");
    expect(attr(html, "limit")).toContain('value=""');
    expect(html.match(/name="suggestion"/g)).toHaveLength(4);
    // Nothing was ever saved, so there is no "last changed" line.
    expect(html).not.toContain("Last changed by");
  });

  it("a row with nothing in it is also 'not set'", () => {
    const html = card(data({ settings: ok({ ...JSH, yearlyLimitCents: null, suggestedCents: [] }) }));
    expect(html).toContain("Not set. No Chip In is asked of this organization&#x27;s members.");
    expect(isDisabled(switchTag(html))).toBe(true);
  });

  it("limit and suggestions saved, asking off (JSH today): the amounts in dollars, the switch ready, who changed it and why", () => {
    const html = card(data());
    expect(html).toContain("Members are not asked");
    expect(html).toContain("<strong>$50.00</strong>");
    expect(html).toContain("<strong>$2.00, $5.00 and $10.00</strong>");
    expect(html).not.toContain("Not set. No Chip In");
    expect(isDisabled(switchTag(html))).toBe(false);
    expect(switchTag(html)).toContain('aria-checked="false"');
    expect(html).not.toContain('data-testid="chip-in-turn-on-blocked"');
    expect(attr(html, "limit")).toContain('value="50.00"');
    const boxes = html.match(/<input[^>]*name="suggestion"[^>]*>/g) ?? [];
    expect(boxes.map((b) => b.match(/value="([^"]*)"/)?.[1] ?? "")).toEqual(["2.00", "5.00", "10.00", ""]);
    expect(html).toContain("Yearly limit per account ($)");
    expect(html).toContain("Suggested amounts ($)");
    expect(html).toContain("Ask members for a Chip In");
    expect(html).toContain("Reason (required)");
    expect(html).toContain(">Save Chip In settings<");
    expect(html).toContain(`name="center" value="${CENTER}"`);
    expect(html).toContain(
      "Last changed by Weaver&#x27;s team on Oct 15, 2026: Owner decision 2026-10-15: $50 yearly Chip In limit per account for JSH; asking stays off until the go-live gate",
    );
    expect(html).toContain("Nothing is asked of any member until the switch below is on.");
  });

  it("asking on: the switch is on and sends 'on' with the form", () => {
    const html = card(data({ settings: ok({ ...JSH, asking: true, updatedBy: "u1", reason: "Pilot" }), changedBy: "Priya Shah" }));
    expect(html).toContain("Members are asked");
    expect(switchTag(html)).toContain('aria-checked="true"');
    expect(attr(html, "asking")).toContain('value="on"');
    expect(html).toContain("Last changed by Priya Shah on Oct 15, 2026: Pilot");
  });

  it("says plainly when no reason was recorded", () => {
    expect(card(data({ settings: ok({ ...JSH, reason: null }) }))).toContain("Last changed by Weaver&#x27;s team on Oct 15, 2026: no reason was recorded");
  });

  it("This year: live and test apart, labelled, in dollars, with no names", () => {
    const html = card(data());
    expect(html).toContain("Live (real money)");
    expect(html).toContain("Test mode (sandbox, not real money)");
    const row = (key: string) => html.slice(html.indexOf(`data-figure="${key}"`), html.indexOf("</tr>", html.indexOf(`data-figure="${key}"`)));
    expect(row("accounts")).toMatch(/data-column="live">4</);
    expect(row("accounts")).toMatch(/data-column="test"[^>]*>2</);
    expect(row("collected")).toMatch(/data-column="live">\$125\.00</);
    expect(row("collected")).toMatch(/data-column="test"[^>]*>\$7\.00</);
    expect(row("refunded")).toMatch(/data-column="live">\$5\.00</);
    expect(row("in_flight")).toMatch(/data-column="live">\$2\.00</);
    expect(row("at_limit")).toMatch(/data-column="live">1</);
    expect(html).toContain("Calendar year 2026");
    expect(html).toContain("Counts and amounts only: no names.");
    expect(html).toContain("They never count toward a real member&#x27;s yearly limit and are never part of any revenue figure.");
  });

  it("Card fee estimate: the standard rate, or the organization's own row with its date and note", () => {
    const standard = card(data());
    expect(standard).toContain("Standard rate");
    expect(standard).toContain("2.9% + $0.30");
    expect(standard).toContain("0.8%, never more than $5.00");
    expect(standard).toContain("Stripe US standard pricing: cards 2.9% + 30 cents");
    expect(standard).not.toContain("Custom rate");

    const custom = card(
      data({
        rates: ok<FeeRates>({
          ...STANDARD,
          card: { bps: 220, fixedCents: 30, capCents: null, custom: true, effectiveFrom: "2026-11-02T16:00:00Z", sourceNote: "approved nonprofit pricing, letter of 2026-11-02" },
        }),
      }),
    );
    expect(custom).toContain("Custom rate");
    expect(custom).toContain("2.2% + $0.30");
    expect(custom).toContain("From Nov 2, 2026 · approved nonprofit pricing, letter of 2026-11-02");
    // The standard bank-debit rate is still the standard one.
    expect(custom).toContain("Standard rate");
    expect(custom).toContain("Add a custom rate for this organization");
    expect(custom).toContain('name="method_class"');
    expect(custom).toContain("Where this rate comes from");
  });

  it("says so when a way to pay has no rate at all", () => {
    expect(card(data({ rates: ok<FeeRates>({ card: STANDARD.card }) }))).toContain("No rate is set, so a member cannot be offered to cover this fee.");
  });

  it("when the database refuses the platform check it says 'You don't have access to this area', and offers no form and no table", () => {
    const html = card({ settings: refused, overview: refused, rates: refused, changedBy: "" });
    expect(html).toContain('data-testid="chip-in-no-access"');
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Save Chip In settings");
    expect(html).not.toContain("Not set. No Chip In");
  });

  it("a part that could not be read says so with a retry; it is never an empty table or a made-up zero", () => {
    const down: Section<never> = { ok: false, reason: "error", error: { message: "fetch failed" } };
    const figures = card(data({ overview: down }));
    expect(figures).toContain("Could not load the Chip In figures");
    expect(figures).toContain("The database could not be reached");
    expect(figures).toContain(`href="/platform/centers/${CENTER}"`);
    expect(figures).toContain("Try again");
    expect(figures).not.toContain('data-figure="collected"');
    expect(figures).toContain("Save Chip In settings");

    // Without the saved setting there is no way to know whether the switch may be turned on, so there is no form.
    const noSettings = card(data({ settings: down }));
    expect(noSettings).toContain("Could not load the Chip In settings");
    expect(noSettings).not.toContain("Save Chip In settings");
    expect(noSettings).not.toContain("Not set. No Chip In");

    const rates = card(data({ rates: down }));
    expect(rates).toContain("Could not load the card fee rates");
  });
});

describe("Platform › Payments · Stripe fee estimate", () => {
  const rows: PlatformFeeRatesData = {
    effective: {
      card: { bps: 280, fixedCents: 30, capCents: null, custom: false, effectiveFrom: "2026-09-01T12:00:00Z", sourceNote: "Stripe's new US pricing, read 2026-09-01" },
      ach: { ...STANDARD.ach!, effectiveFrom: null },
    },
    earlier: [
      { id: "r2", methodClass: "card", bps: 270, fixedCents: 30, capCents: null, effectiveFrom: "2026-05-04T15:00:00Z", sourceNote: "A trial rate", setBy: "u1", by: "Priya Shah" },
      { id: "r1", methodClass: "card", bps: 290, fixedCents: 30, capCents: null, effectiveFrom: "2020-01-01T00:00:00Z", sourceNote: "Stripe US standard pricing", setBy: null, by: "Weaver's team" },
    ],
  };
  const panel = (d: Section<PlatformFeeRatesData>) => render(createElement(FeeRatesCard, { data: d, tz: TZ }));

  it("shows the rate in force for card and bank debit, in percent and dollars, where it comes from, and the earlier ones", () => {
    const html = panel(ok(rows));
    expect(html).toContain("Stripe fee estimate");
    expect(html).toMatch(/data-rate="card"[\s\S]*2\.8% \+ \$0\.30[\s\S]*From Sep 1, 2026[\s\S]*Stripe&#x27;s new US pricing, read 2026-09-01/);
    expect(html).toMatch(/data-rate="ach"[\s\S]*0\.8%, never more than \$5\.00/);
    expect(html).toContain("Earlier rates (2)");
    // A date only for a rate a person set: the rows the migration seeded start nominally at 1 January 2020 UTC.
    expect(html).toContain("Card</span> · 2.7% + $0.30 · from May 4, 2026 · Priya Shah · A trial rate");
    expect(html).toContain("Card</span> · 2.9% + $0.30 · Weaver&#x27;s team · Stripe US standard pricing");
    expect(html).not.toContain("2019");
  });

  it("adds a rate: way to pay, percentage, fixed part, cap, source and a reason (and no organization)", () => {
    const html = panel(ok(rows));
    expect(html).toContain("Add a new platform rate");
    expect(html).toContain(">Add platform rate<");
    for (const field of ["method_class", "percent", "fixed", "cap", "note", "reason"]) expect(html).toContain(`name="${field}"`);
    expect(html).not.toContain('name="center"');
    expect(html).toContain("Reason (required)");
    expect(html).toContain("Only an estimate of what Stripe charges");
  });

  it("says when there are no earlier rates, and when no rate is in force", () => {
    const html = panel(ok({ effective: { card: STANDARD.card }, earlier: [] }));
    expect(html).not.toContain("Earlier rates");
    expect(html).toContain("No rate is set, so a member cannot be offered to cover this fee.");
  });

  it("read refused or failed: 'You don't have access to this area', or the reason with a retry", () => {
    const denied = panel(refused);
    expect(denied).toContain("You don&#x27;t have access to this area");
    expect(denied).not.toContain("<table");
    const down = panel({ ok: false, reason: "error", error: { message: "boom" } });
    expect(down).toContain("Could not load the Stripe fee rates");
    expect(down).toContain('href="/platform/payments"');
    expect(down).not.toContain("<table");
  });
});

describe("who sees what", () => {
  const CENTER_ROW = { id: CENTER, slug: "g1", name: "Sunrise Chamber", status: "active", environment: "production", sandbox_for: null, category_key: "jain_center", rules: {} };
  function sessionFor(admin: boolean, over: Parameters<typeof fakeDb>[0] = {}) {
    const db = fakeDb({
      tables: {
        centers: [CENTER_ROW],
        center_domains: [],
        member_join_codes: [],
        chip_in_settings: [{ center_id: CENTER, ...{ asking: false, yearly_limit_cents: 5000, suggested_cents: [200, 500, 1000], reason: "Owner decision", updated_by: null, updated_at: "2026-10-15T17:00:00Z" } }],
        payment_fee_rates: [
          { id: "r1", center_id: null, method_class: "card", bps: 290, fixed_cents: 30, cap_cents: null, effective_from: "2020-01-01T00:00:00Z", source_note: "Stripe US standard pricing", set_by: null },
          { id: "a1", center_id: null, method_class: "ach", bps: 80, fixed_cents: 0, cap_cents: 500, effective_from: "2020-01-01T00:00:00Z", source_note: "ACH standard", set_by: null },
        ],
        ...over.tables,
      },
      rpc: {
        center_entitlement_list: [],
        module_states: [],
        chip_in_overview: { center_id: CENTER, calendar_year: 2026, asking: false, yearly_limit_cents: 5000, live: { accounts: 0, collected_cents: 0, refunded_cents: 0, in_flight_cents: 0, accounts_at_limit: 0 }, test: { accounts: 0, collected_cents: 0, refunded_cents: 0, in_flight_cents: 0, accounts_at_limit: 0 } },
        payment_fee_rates_for: { card: { bps: 290, fixed_cents: 30, cap_cents: null, custom: false, effective_from: "2020-01-01T00:00:00Z", source_note: "Stripe US standard pricing" } },
        payment_plugin_pauses: { plugins: [{ key: "card", label: "Card", family: "cards", status: "available", platform_pause: null, centers: [] }], history: [], centers: [] },
        ...(over.rpc as object),
      } as never,
      failRpc: over.failRpc,
    });
    vi.mocked(getSession).mockResolvedValue(fakeSession({ db, isPlatformAdmin: admin }) as never);
    return db;
  }
  const centerPage = async () => render((await PlatformCenterPage({ params: Promise.resolve({ id: CENTER }) })) as ReactElement);
  const paymentsPage = async () => render((await PlatformPaymentsPage()) as ReactElement);

  it("a platform admin sees the card on the organization's page, with the organization's own data", async () => {
    sessionFor(true);
    const html = await centerPage();
    expect(html).toContain("Chip In and card fees");
    expect(html).toContain("<strong>$50.00</strong>");
    expect(html).toContain("Last changed by Weaver&#x27;s team on Oct 15, 2026: Owner decision");
    expect(html).toContain("Standard rate");
  });

  it("anyone else gets 'You don't have access to this area' and none of the card, whatever else they can do", async () => {
    const db = sessionFor(false);
    const html = await centerPage();
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("Chip In and card fees");
    expect(html).not.toContain("$50.00");
    expect((db as unknown as { rpcCalls: unknown[] }).rpcCalls).toEqual([]);
    expect((db as unknown as { calls: unknown[] }).calls).toEqual([]);
  });

  it("a platform admin sees the Stripe fee rates beside the pauses", async () => {
    sessionFor(true);
    const html = await paymentsPage();
    expect(html).toContain("Ways to pay and their pauses");
    expect(html).toContain("Stripe fee estimate");
    expect(html.indexOf("Ways to pay and their pauses")).toBeLessThan(html.indexOf("Stripe fee estimate"));
    expect(html).toContain("2.9% + $0.30");
  });

  it("anyone else gets 'You don't have access to this area' on Payments too, with nothing read", async () => {
    const db = sessionFor(false);
    const html = await paymentsPage();
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("Stripe fee estimate");
    expect(html).not.toContain("Ways to pay and their pauses");
    expect((db as unknown as { rpcCalls: unknown[] }).rpcCalls).toEqual([]);
  });

  it("when the pauses cannot be read the rates are still shown, and the failure is said", async () => {
    sessionFor(true, { failRpc: { payment_plugin_pauses: { code: "XX000", message: "boom" } } });
    const html = await paymentsPage();
    expect(html).toContain("Could not load the paused ways to pay");
    expect(html).toContain("Stripe fee estimate");
  });

  it("when the database refuses the signed-in admin, the card says so instead of showing nothing", async () => {
    sessionFor(true, { failRpc: { chip_in_overview: { code: "42501", message: "Only the Weaver team can see the Chip In figures." } } });
    const html = await centerPage();
    expect(html).toContain("Chip In and card fees");
    expect(html).toContain('data-testid="chip-in-no-access"');
    expect(html).not.toContain("Save Chip In settings");
  });
});

describe("the owner's notice on Home", () => {
  const summary = { configured: true, asking: true, yearly_limit_cents: 5000, suggested_cents: [200, 500, 1000], updated_at: new Date().toISOString() };
  function owner(over: { owner?: boolean; modulesOff?: string[]; rpc?: unknown; fail?: { code?: string; message: string } } = {}) {
    const db = fakeDb({ rpc: { chip_in_summary: over.rpc ?? summary } as never, failRpc: over.fail ? { chip_in_summary: over.fail } : undefined });
    return { db, session: fakeSession({ db, isOwner: over.owner ?? true, modulesOff: over.modulesOff ?? [] }) };
  }

  it("shows the owner what changed: members are now asked, up to what, with which amounts", async () => {
    const { session, db } = owner();
    const notices = await loadHomeNotices(session);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toMatch(/^Weaver's team changed your Chip In settings on /);
    expect(notices[0].lines[0]).toContain("up to $50.00 a year each. Suggested amounts: $2.00, $5.00 and $10.00.");
    expect((db as unknown as { rpcCalls: { fn: string; args: unknown }[] }).rpcCalls).toEqual([{ fn: "chip_in_summary", args: { p_center: "center-1" } }]);
    const html = render(createElement(HomeNotices, { notices }));
    expect(html).toContain('data-notice="chip-in-settings"');
    expect(html).toContain('role="status"');
    expect(html).toContain("a contribution to Weaver, not a gift to your organization");
  });

  it("is for the owner only: nobody else is told, and nothing is read for them", async () => {
    const { session, db } = owner({ owner: false });
    expect(await loadHomeNotices(session)).toEqual([]);
    expect((db as unknown as { rpcCalls: unknown[] }).rpcCalls).toEqual([]);
  });

  it("says nothing where Giving is off, nothing is set, or the change is old", async () => {
    expect(await loadHomeNotices(owner({ modulesOff: ["giving"] }).session)).toEqual([]);
    expect(await loadHomeNotices(owner({ rpc: { ...summary, configured: false, yearly_limit_cents: null, suggested_cents: [], updated_at: null } }).session)).toEqual([]);
    expect(await loadHomeNotices(owner({ rpc: { ...summary, updated_at: "2026-01-01T00:00:00Z" } }).session)).toEqual([]);
  });

  it("stays quiet for a database that does not have the function yet, or where Giving is not part of the organization", async () => {
    expect(await loadHomeNotices(owner({ fail: { code: "PGRST202", message: "Could not find the function" } }).session)).toEqual([]);
    expect(await loadHomeNotices(owner({ fail: { code: "42501", message: "Weaver has not enabled Dues & payments for this community." } }).session)).toEqual([]);
  });

  it("says so, in a warning, when the notice could not be checked: never a missing notice", async () => {
    const down = await loadHomeNotices(owner({ fail: { code: "XX000", message: "fetch failed" } }).session);
    expect(down).toEqual([
      {
        key: "chip-in-unreadable",
        tone: "warning",
        title: "Could not check for changes to your Chip In settings",
        lines: ["The database could not be reached — check the connection and try again. Reload the page to try again."],
      },
    ]);
    expect(console.error).toHaveBeenCalled();
    const odd = await loadHomeNotices(owner({ rpc: { weird: true } }).session);
    expect(odd[0]).toMatchObject({ key: "chip-in-unreadable", tone: "warning" });
    const html = render(createElement(HomeNotices, { notices: down }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Could not check for changes to your Chip In settings");
  });

  it("renders nothing at all when there is nothing to say", () => {
    expect(render(createElement(HomeNotices, { notices: [] }))).toBe("");
  });
});
