import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { REPORTS_COMMANDS } from "@/lib/commands/catalog/reports";
import { CommandRegistry } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/run";
import type { CommandRunResult, CommandVia } from "@/lib/commands/types";
import { suggestionsFor } from "@/lib/assistant/context";

import {
  ATTENDANCE_2025_TO_DATE,
  ATTENDANCE_2026,
  CHANGES,
  FIGURES_OCT_TO_DATE,
  FIGURES_SEP,
  FIGURES_SEP_SAME_DAYS,
  MATRIX,
  PAY_2025_TO_DATE,
  PAY_2026_BY_CAMPAIGN,
  PAY_2026_BY_FUND,
  PAY_2026_BY_METHOD,
  PAY_2026_BY_MONTH,
  PEOPLE_2026,
  PLEDGES_2026,
  SHOP_2026,
} from "../reports/answers";
import { CHILDREN, fakeDb, fakeSession, testContext } from "./helpers";

type Args = Record<string, unknown>;

function answers(over: Record<string, unknown> = {}) {
  return {
    reports_people_overview: PEOPLE_2026,
    reports_membership_matrix: MATRIX,
    reports_membership_changes: CHANGES,
    reports_payments_summary: (a: Args) =>
      a.p_from === "2025-01-01" && a.p_to === "2025-10-10"
        ? PAY_2025_TO_DATE
        : a.p_group === "fund"
          ? PAY_2026_BY_FUND
          : a.p_group === "campaign"
            ? PAY_2026_BY_CAMPAIGN
            : a.p_group === "month"
              ? PAY_2026_BY_MONTH
              : PAY_2026_BY_METHOD,
    reports_pledges_summary: PLEDGES_2026,
    reports_attendance: (a: Args) => (a.p_from === "2025-01-01" ? ATTENDANCE_2025_TO_DATE : ATTENDANCE_2026),
    reports_store_sales: SHOP_2026,
    reports_period_figures: (a: Args) => (a.p_from === "2026-10-01" ? FIGURES_OCT_TO_DATE : a.p_to === "2026-09-10" ? FIGURES_SEP_SAME_DAYS : FIGURES_SEP),
    ...over,
  };
}

const EVERYTHING = ["reports.view", "people.view", "giving.view", "events.view", "store.view"];

function setup(opts: { permissions?: string[]; via?: CommandVia; modulesOff?: string[]; rpc?: Record<string, unknown>; failRpc?: Record<string, { code?: string; message: string }>; fiscalStartMonth?: number } = {}) {
  const tables = opts.fiscalStartMonth ? { org_profiles: [{ center_id: "center-1", fiscal_year_start_month: opts.fiscalStartMonth }] } : undefined;
  const db = fakeDb({ rpc: (opts.rpc ?? answers()) as never, failRpc: opts.failRpc, tables });
  const session = fakeSession({ db, permissions: opts.permissions ?? EVERYTHING, modulesOff: opts.modulesOff ?? [] });
  const registry = new CommandRegistry();
  for (const c of REPORTS_COMMANDS) registry.register(c);
  const ctx = testContext({ session, registry, via: opts.via ?? "screen", minorNames: CHILDREN.full });
  return { ctx, db };
}

const dataOf = <T,>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};
const rpcNamed = (db: ReturnType<typeof setup>["db"], fn: string) => db.rpcCalls.filter((c) => c.fn === fn);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
describe("the Reports commands", () => {
  it("are seven reads and one thing only the person does, in the order a person would ask", () => {
    expect(REPORTS_COMMANDS.map((c) => `${c.key}:${c.level}`)).toEqual([
      "reports.overview:read",
      "reports.giving_totals:read",
      "reports.campaign_progress:read",
      "reports.membership_counts:read",
      "reports.event_attendance:read",
      "reports.store_sales:read",
      "reports.compare_months:read",
      "reports.publish_kpi:only_you",
    ]);
  });

  it("have a plain title and a description written for a model, which says it is read only", () => {
    for (const c of REPORTS_COMMANDS) {
      expect(c.title.length, c.key).toBeGreaterThan(8);
      expect(c.description.length, c.key).toBeGreaterThan(80);
      expect(`${c.title} ${c.description}`, c.key).not.toMatch(/\bbid\b/i);
      if (c.level === "read") expect(c.description, c.key).toMatch(/Read only\./);
    }
  });

  it("ask for the permission of the figures they show, and are part of the Reports module", () => {
    expect(Object.fromEntries(REPORTS_COMMANDS.map((c) => [c.key, c.permission]))).toEqual({
      "reports.overview": "reports",
      "reports.giving_totals": "paymentsAll",
      "reports.campaign_progress": "paymentsAll",
      "reports.membership_counts": "memberships",
      "reports.event_attendance": "events",
      "reports.store_sales": "store",
      "reports.compare_months": "reports",
      "reports.publish_kpi": "publicKpisManage",
    });
    for (const c of REPORTS_COMMANDS) expect(c.module, c.key).toBe("reports");
    for (const c of REPORTS_COMMANDS) expect(c.platformOnly, c.key).toBeUndefined();
  });

  it("cover the one Server Action of Reports, which stays the person's own", () => {
    expect(REPORTS_COMMANDS.flatMap((c) => c.covers ?? [])).toEqual(["src/app/(app)/reports/community/actions.ts#setKpiVisibilityAction"]);
  });

  it("are refused when the Reports module is switched off, and to a person with no permission for them", async () => {
    const off = setup({ modulesOff: ["reports"] });
    expect(await runCommand(off.ctx, "reports.overview", {})).toMatchObject({ ok: false, code: "module_off" });
    expect(off.db.rpcCalls).toEqual([]);
    const none = setup({ permissions: [] });
    expect(await runCommand(none.ctx, "reports.overview", {})).toMatchObject({ ok: false, code: "no_access" });
    const noMoney = setup({ permissions: ["people.view"] });
    expect(await runCommand(noMoney.ctx, "reports.giving_totals", {})).toMatchObject({ ok: false, code: "no_access" });
    expect(noMoney.db.rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("reports.overview", () => {
  it("gives the headline figures, the database's own sums, in dollars and in exact cents", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{
      year: number;
      households: { total: number; new_in_year: number; on_the_app_percent: number; by_zone: unknown[] };
      renewals_due_in_60_days: number;
      giving: Record<string, unknown>;
      event_check_ins: Record<string, unknown>;
      not_shown: unknown[];
    }>(await runCommand(ctx, "reports.overview", {}));
    expect(d.year).toBe(2026);
    expect(d.households).toMatchObject({ total: 4, new_in_year: 3, on_the_app_percent: 50 });
    expect(d.households.by_zone).toEqual(PEOPLE_2026.zones);
    expect(d.renewals_due_in_60_days).toBe(1);
    expect(d.giving).toEqual({
      given_cents: 101700,
      given: "$1,017.00",
      last_year_same_period_cents: 4000,
      last_year_same_period: "$40.00",
      change_percent: 2443,
      open_pledges: 4,
      open_pledges_cents: 62000,
      open_pledges_amount: "$620.00",
    });
    expect(d.event_check_ins).toEqual({ this_year: 4, last_year_same_period: 1, change_percent: 300 });
    expect(d.not_shown).toEqual([]);
    // Six reads, each a sum done in the database over the right days (this year to the end of the year; last year to the same day).
    expect(rpcNamed(db, "reports_people_overview")[0].args).toEqual({ p_center: "center-1", p_year: 2026, p_today: "2026-10-10" });
    expect(rpcNamed(db, "reports_payments_summary").map((c) => [c.args.p_from, c.args.p_to, c.args.p_group])).toEqual([
      ["2026-01-01", "2026-12-31", "none"],
      ["2025-01-01", "2025-10-10", "none"],
    ]);
    expect(rpcNamed(db, "reports_attendance").map((c) => [c.args.p_from, c.args.p_to])).toEqual([
      ["2026-01-01", "2026-10-10"],
      ["2025-01-01", "2025-10-10"],
    ]);
    expect(db.rpcCalls).toHaveLength(6);
  });

  it("leaves out what the role cannot see and says so, without asking the database for it", async () => {
    const { ctx, db } = setup({ permissions: ["people.view"] });
    const d = dataOf<{ households: unknown; giving: unknown; event_check_ins: unknown; not_shown: { area: string; reason: string }[] }>(await runCommand(ctx, "reports.overview", {}));
    expect(d.households).not.toBeNull();
    expect(d.giving).toBeNull();
    expect(d.event_check_ins).toBeNull();
    expect(d.not_shown).toEqual([
      { area: "Giving", reason: "You don't have access to this area." },
      { area: "Event check-ins", reason: "You don't have access to this area." },
    ]);
    expect(db.rpcCalls.map((c) => c.fn)).toEqual(["reports_people_overview"]);
  });

  it("reports on the community's own financial year when it starts in another month (July 1 to June 30)", async () => {
    const { ctx, db } = setup({ fiscalStartMonth: 7 });
    const d = dataOf<{ year: number; year_label: string }>(await runCommand(ctx, "reports.overview", {}));
    // today in the test is October 10, 2026: the year that began on July 1, 2026
    expect(d).toMatchObject({ year: 2026, year_label: "2026-27" });
    expect(rpcNamed(db, "reports_payments_summary").map((c) => [c.args.p_from, c.args.p_to])).toEqual([
      ["2026-07-01", "2027-06-30"],
      ["2025-07-01", "2025-10-10"],
    ]);
    expect(rpcNamed(db, "reports_attendance").map((c) => [c.args.p_from, c.args.p_to])).toEqual([
      ["2026-07-01", "2026-10-10"],
      ["2025-07-01", "2025-10-10"],
    ]);
    // the new households of that year come from the same dates, not from the calendar year
    expect(rpcNamed(db, "reports_period_figures").map((c) => [c.args.p_from, c.args.p_to])).toEqual([["2026-07-01", "2026-10-10"]]);
    // and "last year" is the financial year before it
    await runCommand(ctx, "reports.overview", { year: 2025 });
    expect(rpcNamed(db, "reports_payments_summary").slice(2).map((c) => [c.args.p_from, c.args.p_to])).toEqual([
      ["2025-07-01", "2026-06-30"],
      ["2024-07-01", "2025-06-30"],
    ]);
  });

  it("starts 'this year so far' on the first day of the financial year when no dates are given", async () => {
    const { ctx, db } = setup({ fiscalStartMonth: 4 });
    await runCommand(ctx, "reports.giving_totals", {});
    expect(rpcNamed(db, "reports_payments_summary").map((c) => [c.args.p_from, c.args.p_to])).toEqual([["2026-04-01", "2026-10-10"]]);
    const calendar = setup();
    await runCommand(calendar.ctx, "reports.giving_totals", {});
    expect(rpcNamed(calendar.db, "reports_payments_summary").map((c) => [c.args.p_from, c.args.p_to])).toEqual([["2026-01-01", "2026-10-10"]]);
  });

  it("reports on another year, and compares a finished year with the whole year before", async () => {
    const { ctx, db } = setup();
    await runCommand(ctx, "reports.overview", { year: 2024 });
    expect(rpcNamed(db, "reports_payments_summary").map((c) => [c.args.p_from, c.args.p_to])).toEqual([
      ["2024-01-01", "2024-12-31"],
      ["2023-01-01", "2023-12-31"],
    ]);
    expect(rpcNamed(db, "reports_attendance").map((c) => [c.args.p_from, c.args.p_to])).toEqual([
      ["2024-01-01", "2024-12-31"],
      ["2023-01-01", "2023-12-31"],
    ]);
  });

  it("says what failed, in plain words, and never shows zeros for a figure that could not be read", async () => {
    const { ctx } = setup({ failRpc: { reports_payments_summary: { code: "XX000", message: "boom" } } });
    const r = await runCommand(ctx, "reports.overview", {});
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(r.ok ? "" : r.error).toMatch(/^Could not read the giving figures/);
    expect(JSON.stringify(r)).not.toMatch(/$0.00/);
  });

  it("treats an answer in the wrong shape as a failure", async () => {
    const { ctx } = setup({ rpc: answers({ reports_people_overview: [] }) });
    const r = await runCommand(ctx, "reports.overview", {});
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toMatch(/^Could not read the household figures/);
  });
});

// ---------------------------------------------------------------------------
describe("reports.giving_totals", () => {
  it("adds up this year so far by month when no dates are given", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{ from: string; to: string; group_by: string; total: Record<string, unknown>; groups: { label: string; net: string | null; payments: number }[]; basis: string }>(
      await runCommand(ctx, "reports.giving_totals", {}),
    );
    expect(rpcNamed(db, "reports_payments_summary")[0].args).toEqual({ p_center: "center-1", p_from: "2026-01-01", p_to: "2026-10-10", p_group: "month" });
    expect(d.from).toBe("2026-01-01");
    expect(d.to).toBe("2026-10-10");
    expect(d.total).toMatchObject({ payments: 5, received: "$1,027.00", refunded: "$10.00", net: "$1,017.00", net_cents: 101700 });
    expect(d.groups.map((g) => g.label)).toEqual(["2026-01", "2026-03", "2026-06", "2026-09", "2026-10"]);
    expect(d.groups[3]).toMatchObject({ received_cents: 3000, net_cents: 2000, net: "$20.00" });
    expect(d.basis).toMatch(/net of refunds/);
  });

  it("splits by fund or campaign, and says refunds are not split there", async () => {
    const { ctx } = setup();
    const f = dataOf<{ groups: { label: string; received: string; net: string | null }[]; basis: string }>(await runCommand(ctx, "reports.giving_totals", { group_by: "fund" }));
    expect(f.groups.map((g) => [g.label, g.received, g.net])).toEqual([
      ["Not applied to a pledge", "$847.00", null],
      ["G128 Food", "$150.00", null],
      ["No fund", "$30.00", null],
    ]);
    expect(f.basis).toMatch(/not split by fund/);
    const c = dataOf<{ groups: { label: string }[] }>(await runCommand(ctx, "reports.giving_totals", { group_by: "campaign", from: "2026-01-01", to: "2026-12-31" }));
    expect(c.groups.map((g) => g.label)).toEqual(["Not applied to a pledge", "G128 Paryushan", "G128 Diwali"]);
  });

  it("refuses days that run backwards or span more than ten years, in plain words, before asking the database", async () => {
    const { ctx, db } = setup();
    expect(await runCommand(ctx, "reports.giving_totals", { from: "2026-10-01", to: "2026-09-01" })).toMatchObject({ ok: false, error: "The first day must come before the last day." });
    expect(await runCommand(ctx, "reports.giving_totals", { from: "2010-01-01", to: "2026-01-01" })).toMatchObject({ ok: false, error: "Ask for ten years or less at a time." });
    expect(await runCommand(ctx, "reports.giving_totals", { group_by: "colour" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await runCommand(ctx, "reports.giving_totals", { from: "yesterday" })).toMatchObject({ ok: false, code: "invalid" });
    expect(db.rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("reports.campaign_progress", () => {
  it("gives each campaign's pledged, paid, written off and still owed, and what is open in all", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{
      year: number;
      campaigns: { campaign: string; pledged: string; paid: string; written_off: string; outstanding: string; outstanding_cents: number }[];
      total: Record<string, unknown>;
      open_now: Record<string, unknown>;
    }>(await runCommand(ctx, "reports.campaign_progress", {}));
    expect(rpcNamed(db, "reports_pledges_summary")[0].args).toEqual({ p_center: "center-1", p_from: "2026-01-01", p_to: "2026-12-31" });
    expect(d.campaigns.map((c) => [c.campaign, c.pledged, c.paid, c.written_off, c.outstanding])).toEqual([
      ["G128 Paryushan", "$580.00", "$170.00", "$60.00", "$350.00"],
      ["G128 Diwali", "$200.00", "$30.00", "$0.00", "$170.00"],
      ["No campaign", "$60.00", "$0.00", "$0.00", "$60.00"],
    ]);
    expect(d.total).toMatchObject({ pledges: 4, pledged: "$840.00", paid: "$200.00", written_off: "$60.00", outstanding: "$580.00" });
    expect(d.open_now).toEqual({ pledges: 4, amount_cents: 62000, amount: "$620.00" });
  });

  it("asks about another year", async () => {
    const { ctx, db } = setup();
    await runCommand(ctx, "reports.campaign_progress", { year: 2025 });
    expect(rpcNamed(db, "reports_pledges_summary")[0].args).toMatchObject({ p_from: "2025-01-01", p_to: "2025-12-31" });
  });
});

// ---------------------------------------------------------------------------
describe("reports.membership_counts", () => {
  it("counts by tier and status now, and what changed in the last 30 days", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{
      now: { active: number; by_tier_and_status: { tier: string; status: string; memberships: number }[]; active_households_by_tier: unknown[]; renewals_due_in_60_days: number };
      applications_all_time: unknown[];
      changes: { from: string; to: string; started: number; lapsed_or_ended: number; applications_received: number };
    }>(await runCommand(ctx, "reports.membership_counts", {}));
    expect(rpcNamed(db, "reports_membership_changes")[0].args).toEqual({ p_center: "center-1", p_from: "2026-09-11", p_to: "2026-10-10", p_today: "2026-10-10" });
    expect(d.now.active).toBe(3);
    expect(d.now.by_tier_and_status).toHaveLength(15);
    expect(d.now.by_tier_and_status.find((x) => x.tier === "yearly" && x.status === "active")?.memberships).toBe(2);
    expect(d.now.by_tier_and_status.find((x) => x.tier === "life" && x.status === "suspended")?.memberships).toBe(0);
    expect(d.now.active_households_by_tier).toEqual([
      { tier: "life", households: 1 },
      { tier: "yearly", households: 2 },
      { tier: "community", households: 0 },
    ]);
    expect(d.now.renewals_due_in_60_days).toBe(1);
    expect(d.applications_all_time).toEqual([
      { status: "awaiting_center", applications: 2 },
      { status: "withdrawn", applications: 1 },
    ]);
    expect(d.changes).toMatchObject({ started: 2, lapsed_or_ended: 2, applications_received: 2 });
  });
});

// ---------------------------------------------------------------------------
describe("reports.event_attendance and reports.store_sales", () => {
  it("count check-ins and add up the store for this year so far", async () => {
    const { ctx, db } = setup();
    const a = dataOf<{ check_ins: number; events_with_check_ins: number; top_events: { event: string; check_ins: number }[]; by_month: unknown[] }>(
      await runCommand(ctx, "reports.event_attendance", { top: 3 }),
    );
    expect(rpcNamed(db, "reports_attendance")[0].args).toEqual({ p_center: "center-1", p_from: "2026-01-01", p_to: "2026-10-10", p_top: 3 });
    expect(a).toMatchObject({ check_ins: 4, events_with_check_ins: 1 });
    expect(a.top_events[0]).toMatchObject({ event: "G128 Diwali dinner", check_ins: 4 });
    const s = dataOf<{ orders: number; sales: string; by_month: { month: string; sales: string }[]; top_items: { item: string; units: number; sales: string }[] }>(
      await runCommand(ctx, "reports.store_sales", {}),
    );
    expect(rpcNamed(db, "reports_store_sales")[0].args).toEqual({ p_center: "center-1", p_from: "2026-01-01", p_to: "2026-10-10", p_top: 5 });
    expect(s).toMatchObject({ orders: 3, sales: "$45.00" });
    expect(s.by_month.map((m) => [m.month, m.sales])).toEqual([
      ["2026-09", "$35.00"],
      ["2026-10", "$10.00"],
    ]);
    expect(s.top_items[0]).toEqual({ item: "G128 Kaju katli", units: 3, sales: "$30.00", sales_cents: 3000 });
  });

  it("say so when the community has that module switched off, instead of answering zero", async () => {
    const noEvents = setup({ modulesOff: ["events"] });
    const a = await runCommand(noEvents.ctx, "reports.event_attendance", {});
    expect(a).toMatchObject({ ok: false });
    expect(a.ok ? "" : a.error).toMatch(/Events & RSVP module is switched off/);
    expect(noEvents.db.rpcCalls).toEqual([]);
    const noStore = setup({ modulesOff: ["store"] });
    const s = await runCommand(noStore.ctx, "reports.store_sales", {});
    expect(s.ok ? "" : s.error).toMatch(/module is switched off/);
    expect(noStore.db.rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("reports.compare_months", () => {
  it("compares the month in progress with the same days of last month, and gives last month in full", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{
      month: string;
      compared_with: string;
      month_in_progress: boolean;
      rows: { what: string; this_month: string; last_month: string; difference: number; change_percent: number | null; change: string | null }[];
      last_month_in_full: { from: string; to: string; rows: { what: string; value: string }[] } | null;
      not_shown: unknown[];
    }>(await runCommand(ctx, "reports.compare_months", {}));
    expect(rpcNamed(db, "reports_period_figures").map((c) => [c.args.p_from, c.args.p_to])).toEqual([
      ["2026-10-01", "2026-10-10"],
      ["2026-09-01", "2026-09-10"],
      ["2026-09-01", "2026-09-30"],
    ]);
    expect(d).toMatchObject({ month: "October 2026", compared_with: "September 2026", month_in_progress: true, not_shown: [] });
    expect(d.rows[0]).toEqual({ what: "Money received, net of refunds", this_month: "$70.00", last_month: "$0.00", difference: 7000, change_percent: null, change: null });
    expect(d.last_month_in_full).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(d.last_month_in_full?.rows[0]).toEqual({ what: "Money received, net of refunds", value: "$20.00" });
    expect(d.rows.map((r) => r.what)).toEqual([
      "Money received, net of refunds",
      "Payments received",
      "New households",
      "Memberships started",
      "Membership applications received",
      "Event check-ins",
      "Store sales",
      "Store orders",
    ]);
  });

  it("compares a finished month in full with the month before, with a signed percent", async () => {
    const { ctx, db } = setup({
      rpc: answers({ reports_period_figures: (a: Args) => (a.p_from === "2026-09-01" ? FIGURES_SEP : { ...FIGURES_SEP, giving: { payments: 2, received_cents: 1500, refunded_cents: 0, net_cents: 1500 } }) }),
    });
    const d = dataOf<{ month_in_progress: boolean; last_month_in_full: unknown; rows: { change_percent: number | null; change: string | null }[] }>(
      await runCommand(ctx, "reports.compare_months", { month: "2026-09" }),
    );
    expect(rpcNamed(db, "reports_period_figures").map((c) => [c.args.p_from, c.args.p_to])).toEqual([
      ["2026-09-01", "2026-09-30"],
      ["2026-08-01", "2026-08-31"],
    ]);
    expect(d.month_in_progress).toBe(false);
    expect(d.last_month_in_full).toBeNull();
    expect(d.rows[0]).toMatchObject({ change_percent: 33, change: "+33%" });
  });

  it("refuses a month that has not started, in plain words", async () => {
    const { ctx, db } = setup();
    expect(await runCommand(ctx, "reports.compare_months", { month: "2026-12" })).toMatchObject({ ok: false, error: "December 2026 has not started yet, so there is nothing to compare." });
    expect(await runCommand(ctx, "reports.compare_months", { month: "Oct" })).toMatchObject({ ok: false, code: "invalid" });
    expect(db.rpcCalls).toEqual([]);
  });

  it("leaves out the areas the role cannot see", async () => {
    const { ctx } = setup({ permissions: ["reports.view", "events.view"] });
    const d = dataOf<{ rows: { what: string }[]; not_shown: { area: string }[] }>(await runCommand(ctx, "reports.compare_months", {}));
    expect(d.rows.map((r) => r.what)).toEqual(["Event check-ins"]);
    expect(d.not_shown.map((n) => n.area)).toEqual(["Giving", "Households, memberships and applications", "Store sales"]);
  });
});

// ---------------------------------------------------------------------------
describe("what only the person does, and what no Reports command ever does", () => {
  it("publishing a figure on the public dashboard points to the screen and does nothing", async () => {
    const { ctx, db } = setup({ permissions: ["settings.manage", "reports.view"], via: "assistant" });
    const r = await runCommand(ctx, "reports.publish_kpi", {});
    expect(r).toMatchObject({ ok: false, code: "only_you", onlyYou: { href: "/reports/community" } });
    expect(db.calls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("only ever read: every database function it calls starts with reports_, and nothing is updated", async () => {
    const { ctx, db } = setup();
    for (const [key, input] of [
      ["reports.overview", {}],
      ["reports.giving_totals", { group_by: "fund" }],
      ["reports.campaign_progress", {}],
      ["reports.membership_counts", {}],
      ["reports.event_attendance", {}],
      ["reports.store_sales", {}],
      ["reports.compare_months", {}],
    ] as const) {
      expect((await runCommand(ctx, key, input)).ok, key).toBe(true);
    }
    expect(db.rpcCalls.length).toBeGreaterThan(10);
    for (const c of db.rpcCalls) expect(c.fn, c.fn).toMatch(/^reports_/);
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("Niva's suggestions on the Reports screens", () => {
  it("are the number questions the role may ask, three at a time, and none the role cannot", () => {
    const all = new Set(REPORTS_COMMANDS.map((c) => c.key));
    expect(suggestionsFor("/reports", undefined, all)).toEqual([
      "How are we doing this year compared with last year?",
      "How much did we receive this year, month by month?",
      "How is each campaign doing?",
    ]);
    const noMoney = new Set(["reports.overview", "reports.compare_months", "reports.membership_counts"]);
    expect(suggestionsFor("/reports", undefined, noMoney)).toEqual([
      "How are we doing this year compared with last year?",
      "Compare this month with last month",
      "How many people joined as members this month?",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("D2: nothing about a child reaches Niva from a Reports command", () => {
  it("holds back a name of a child even if an event is named after one", async () => {
    const withName = { ...ATTENDANCE_2026, top_events: [{ event_id: "e1", name: "Birthday party for Zoya Shah", starts_at: null, check_ins: 4 }] };
    const { ctx } = setup({ via: "assistant", rpc: answers({ reports_attendance: withName }) });
    const r = await runCommand(ctx, "reports.event_attendance", {});
    const text = JSON.stringify(r);
    for (const name of [...CHILDREN.full, ...CHILDREN.first]) expect(text, name).not.toContain(name);
  });

  it("answers counts and sums, not people: no result of any Reports command has a name, a birth date or a household", async () => {
    const { ctx } = setup({ via: "assistant" });
    for (const [key, input] of [
      ["reports.overview", {}],
      ["reports.giving_totals", {}],
      ["reports.campaign_progress", {}],
      ["reports.membership_counts", {}],
      ["reports.event_attendance", {}],
      ["reports.store_sales", {}],
      ["reports.compare_months", {}],
    ] as const) {
      const text = JSON.stringify(await runCommand(ctx, key, input));
      for (const name of [...CHILDREN.full, ...CHILDREN.first]) expect(text, `${name} in ${key}`).not.toContain(name);
      expect(text, key).not.toMatch(/date_of_birth|household_id|display_name/);
    }
  });
});
