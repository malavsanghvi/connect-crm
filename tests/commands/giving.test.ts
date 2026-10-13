import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { CATALOG } from "@/lib/commands/catalog";
import { uuidList, dollars } from "@/lib/commands/catalog/giving-fields";
import { CommandRegistry } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/run";
import type { CommandRunResult, CommandVia } from "@/lib/commands/types";

import { CHILDREN, fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";
import { MEHTA, PATEL, SHAH, givingWorld, noWrites, type Rpc } from "./giving-world";

const ALL = ["people.view", "giving.view", "giving.manage", "giving.record_offline", "giving.approve", "accounting.manage", "accounting.close"];

function setup(opts: { via?: CommandVia; permissions?: string[]; rpc?: Rpc; failRpc?: FakeDbOptions["failRpc"]; tables?: FakeDbOptions["tables"]; rules?: unknown; readOnly?: boolean } = {}) {
  const real = fakeDb(givingWorld(opts.rpc, opts.failRpc, opts.tables));
  const db = opts.readOnly ? noWrites(real) : real;
  const session = fakeSession({ db, permissions: opts.permissions ?? ALL, center: { ...fakeSession().center, rules: opts.rules ?? {} } });
  const registry = new CommandRegistry();
  for (const c of CATALOG) registry.register(c);
  const ctx = testContext({ session, registry, via: opts.via ?? "screen", minorNames: CHILDREN.full });
  return { ctx, db, session };
}

const dataOf = <T,>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** A database answer that also remembers what it was asked. */
const spy = <T,>(seen: Record<string, unknown>[], answer: T) => (args: Record<string, unknown>) => (seen.push(args), answer);

const everything = (r: CommandRunResult) => JSON.stringify(r);
const noChild = (text: string) => {
  for (const word of [...CHILDREN.first, ...CHILDREN.full, "date_of_birth"]) expect(text).not.toContain(word);
};

// ---------------------------------------------------------------------------
describe("the Giving commands in the catalog", () => {
  it("are reads and one draft, plus three money commands and recording a pledge, off until an owner switches each on", () => {
    const giving = CATALOG.filter((c) => c.key.startsWith("giving."));
    expect(giving.filter((c) => c.level !== "confirm").map((c) => `${c.key}:${c.level}`)).toEqual([
      "giving.pledges_behind:read",
      "giving.household_summary:read",
      "giving.bank_lines_unmatched:read",
      "giving.zelle_waiting:read",
      "giving.waiting_for_second_approver:read",
      "giving.fund_mapping_status:read",
      "giving.draft_payment:draft",
    ]);
    expect(giving.filter((c) => c.level === "confirm").map((c) => [c.key, c.requiresOwnerSwitch, c.enabledByDefault ?? false])).toEqual([
      ["giving.record_payment", true, false],
      ["giving.confirm_exact_zelle_matches", true, false],
      ["giving.match_deposit", true, false],
      ["giving.record_pledge", true, false],
    ]);
  });

  it("are all described for a model, and 'pledge' is never 'bid'", () => {
    for (const c of CATALOG.filter((x) => x.key.startsWith("giving."))) {
      expect(c.description.length).toBeGreaterThan(80);
      expect(`${c.title} ${c.description}`).not.toMatch(/\bbid/i);
    }
  });

  it("are offered to Niva with their permission, and hidden when Giving is off", () => {
    const { session } = setup();
    const tools = new CommandRegistry();
    for (const c of CATALOG) tools.register(c);
    const names = tools.modelTools(session).map((t) => t.name);
    for (const n of ["giving_pledges_behind", "giving_household_summary", "giving_bank_lines_unmatched", "giving_zelle_waiting", "giving_waiting_for_second_approver", "giving_draft_payment"]) {
      expect(names).toContain(n);
    }
    const off = fakeSession({ permissions: ALL, modulesOff: ["giving"] });
    // The QuickBooks mapping belongs to the Accounting module, so it follows that switch, not this one.
    expect(tools.list(off).map((c) => c.key).filter((k) => k.startsWith("giving.") && k !== "giving.fund_mapping_status")).toEqual([]);
    expect(tools.list(fakeSession({ permissions: ALL, modulesOff: ["accounting"] })).map((c) => c.key)).not.toContain("giving.fund_mapping_status");
    const volunteer = fakeSession({ permissions: ["giving.record_offline"] });
    expect(tools.list(volunteer).map((c) => c.key)).toEqual(expect.arrayContaining(["giving.draft_payment", "giving.bank_lines_unmatched"]));
    expect(tools.list(volunteer).map((c) => c.key)).not.toContain("giving.waiting_for_second_approver");
  });
});

describe("field helpers", () => {
  it("uuidList reads a list or comma text, drops repeats, refuses junk", () => {
    const f = uuidList("ids", { max: 2 });
    expect(f.parse([SHAH, PATEL.toUpperCase(), SHAH], "Ids")).toEqual({ ok: true, value: [SHAH, PATEL] });
    expect(f.parse(`${SHAH}, ${PATEL}`, "Ids")).toEqual({ ok: true, value: [SHAH, PATEL] });
    expect(f.parse(`${SHAH} ${PATEL} ${MEHTA}`, "Ids")).toEqual({ ok: false, error: "Ids can have at most 2 ids." });
    expect(f.parse(["nope"], "Ids")).toEqual({ ok: false, error: "Ids has something that is not a valid id." });
    expect(f.parse(5, "Ids")).toEqual({ ok: false, error: "Ids must be a list of ids." });
    expect(f.parse("", "Ids")).toEqual({ ok: false, error: "Ids needs at least one id." });
  });

  it("dollars accepts text or a plain number and leaves the arithmetic to the payment check", () => {
    const f = dollars("amount");
    expect(f.parse("$1,250.50", "Amount")).toEqual({ ok: true, value: "$1,250.50" });
    expect(f.parse(250, "Amount")).toEqual({ ok: true, value: "250" });
    expect(f.parse(Number.NaN, "Amount")).toMatchObject({ ok: false });
    expect(f.parse("  ", "Amount")).toEqual({ ok: false, error: "Amount is required." });
    expect(f.parse({}, "Amount")).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
describe("giving.pledges_behind (a database function, not a scan)", () => {
  const answer = {
    as_of: "2026-10-10",
    households_behind: 2,
    pledges_behind: 3,
    total_open_cents: 254500,
    by_age: [
      { bucket: "1 to 30 days", pledges: 1, open_cents: 4500 },
      { bucket: "Over 90 days", pledges: 2, open_cents: 250000 },
    ],
    rows: [
      { household_id: SHAH, pledges_behind: 2, open_cents: 250000, oldest_days_overdue: 102 },
      { household_id: MEHTA, pledges_behind: 1, open_cents: 4500, oldest_days_overdue: 21 },
    ],
  };

  it("asks the database for today in the community's time zone and shows cards, adults only, with dollars", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { giving_pledges_behind: spy(seen, answer) } });
    const r = await runCommand(ctx, "giving.pledges_behind", { min_days_overdue: 7, limit: 5 });
    expect(seen).toEqual([{ p_center: "center-1", p_today: "2026-10-10", p_min_days: 7, p_limit: 5, p_fund: null }]);
    const data = dataOf<{ total_open: string; by_age: { open: string }[]; showing: { household: Record<string, unknown>; open: string; open_cents: number }[] }>(r);
    expect(data.total_open).toBe("$2,545.00");
    expect(data.by_age.map((a) => a.open)).toEqual(["$45.00", "$2,500.00"]);
    expect(data.showing.map((s) => [s.household.household_number, s.open, s.open_cents])).toEqual([
      ["H-1001", "$2,500.00", 250000],
      ["H-1003", "$45.00", 4500],
    ]);
    expect(data.showing[0].household).toMatchObject({ adults: ["Priya Shah", "Rahul Shah"] });
    noChild(everything(r));
  });

  it("says when nobody is behind, and when only some are shown", async () => {
    const none = setup({ rpc: { giving_pledges_behind: { ...answer, households_behind: 0, pledges_behind: 0, total_open_cents: 0, by_age: [], rows: [] } } });
    expect(await runCommand(none.ctx, "giving.pledges_behind", {})).toMatchObject({ ok: true, message: "Nobody is behind on pledges." });
    const some = setup({ rpc: { giving_pledges_behind: { ...answer, households_behind: 9 } } });
    expect(await runCommand(some.ctx, "giving.pledges_behind", {})).toMatchObject({ ok: true, message: "Showing 2 of 9 households." });
  });

  it("limits to one fund by name, and asks which when the name is not clear", async () => {
    const funds = [
      { id: "fund-a", center_id: "center-1", name: "Building fund", key: "bld", active: true },
      { id: "fund-b", center_id: "center-1", name: "Building maintenance", key: "maint", active: true },
      { id: "fund-c", center_id: "center-1", name: "Food bank", key: "food", active: true },
    ];
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ tables: { funds }, rpc: { giving_pledges_behind: spy(seen, answer) } });
    const exact = await runCommand(ctx, "giving.pledges_behind", { fund: "building fund" });
    expect(seen[0].p_fund).toBe("fund-a");
    expect(dataOf<{ fund: string; basis: string }>(exact)).toMatchObject({ fund: "Building fund" });
    expect(await runCommand(ctx, "giving.pledges_behind", { fund: "Building" })).toMatchObject({ ok: false, error: 'More than one fund matches "Building": Building fund, Building maintenance. Which one?' });
    expect(await runCommand(ctx, "giving.pledges_behind", { fund: "Garden" })).toMatchObject({
      ok: false,
      error: 'There is no fund called "Garden". The funds are: Building fund, Building maintenance, Food bank.',
    });
  });

  it("explains a database problem, never a silently empty list", async () => {
    const { ctx } = setup({ failRpc: { giving_pledges_behind: { code: "42501", message: "permission denied" } } });
    expect(await runCommand(ctx, "giving.pledges_behind", {})).toMatchObject({ ok: false, error: "Could not read the pledges — you don't have permission to make this change." });
  });

  it("refuses a person without Giving access in plain words", async () => {
    const { ctx } = setup({ permissions: ["events.view"] });
    expect(await runCommand(ctx, "giving.pledges_behind", {})).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("giving.household_summary", () => {
  const summary = {
    household_id: SHAH,
    as_of: "2026-10-10",
    lifetime: { payments: 14, received_cents: 1250050, refunded_cents: 2500, first_gift_on: "2019-03-02", last_gift_on: "2026-09-14" },
    years: [
      { year: 2026, payments: 3, received_cents: 75000, refunded_cents: 0 },
      { year: 2025, payments: 5, received_cents: 400000, refunded_cents: 2500 },
    ],
    recent_payments: [{ id: "pay-1", receipt_number: "R-0042", received_on: "2026-09-14", method: "zelle", amount_cents: 25000, refunded_cents: 0, status: "captured" }],
    open_pledge_count: 1,
    open_cents: 250000,
    behind_cents: 250000,
    open_pledges: [
      { id: "pl-1", pledge_number: "P-101", source: "boli", fund: "General fund", campaign: "Paryushan 2026", amount_cents: 500000, paid_cents: 250000, open_cents: 250000, due_on: "2026-06-30", pledged_on: "2026-01-10", days_overdue: 102 },
    ],
    recurring_active: 1,
  };

  it("shows the card first, then the giving, in dollars", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { giving_household_summary: spy(seen, summary) } });
    const r = await runCommand(ctx, "giving.household_summary", { household_id: SHAH });
    expect(seen).toEqual([{ p_household: SHAH, p_today: "2026-10-10" }]);
    const d = dataOf<{
      household: { household_number: string; adults: string[] };
      lifetime: { received: string; refunded: string };
      years: { year: number; received: string }[];
      recent_payments: { method: string; amount: string }[];
      open_pledges: { kind: string; open: string; days_overdue: number }[];
      open: string;
      behind: string;
    }>(r);
    expect(d.household).toMatchObject({ household_number: "H-1001", adults: ["Priya Shah", "Rahul Shah"] });
    expect(d.lifetime).toMatchObject({ received: "$12,500.50", refunded: "$25.00" });
    expect(d.years.map((y) => [y.year, y.received])).toEqual([
      [2026, "$750.00"],
      [2025, "$4,000.00"],
    ]);
    expect(d.recent_payments[0]).toMatchObject({ method: "Zelle", amount: "$250.00" });
    // A boli is a pledge; no screen or sentence calls it a bid.
    expect(d.open_pledges[0]).toMatchObject({ kind: "Boli pledge", open: "$2,500.00", days_overdue: 102 });
    expect(d.open).toBe("$2,500.00");
    expect(d.behind).toBe("$2,500.00");
    noChild(everything(r));
  });

  it("tells a finance volunteer they see only the payments they recorded, so the totals may be low", async () => {
    const { ctx } = setup({ permissions: ["giving.record_offline"], rpc: { giving_household_summary: summary } });
    const r = await runCommand(ctx, "giving.household_summary", { household_id: SHAH });
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("only the payments you recorded yourself") });
    expect(dataOf<{ limited_view: string }>(r).limited_view).toContain("Open pledges are complete");
    const full = dataOf<{ limited_view: string | null }>(await runCommand(setup({ rpc: { giving_household_summary: summary } }).ctx, "giving.household_summary", { household_id: SHAH }));
    expect(full.limited_view).toBeNull();
  });

  it("says plainly when the household is not found or cannot be seen", async () => {
    const { ctx } = setup({ rpc: { giving_household_summary: null } });
    expect(await runCommand(ctx, "giving.household_summary", { household_id: SHAH })).toMatchObject({ ok: false, error: "That household was not found, or you can't see its giving." });
    expect(await runCommand(ctx, "giving.household_summary", { household_id: "Shah" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("keeps a child out of the answer Niva sees, even when the database let one through", async () => {
    const leaky = { ...summary, recent_payments: [{ ...summary.recent_payments[0], receipt_number: "Gift for Zoya Shah" }] };
    const { ctx } = setup({ via: "assistant", rpc: { giving_household_summary: leaky } });
    const r = await runCommand(ctx, "giving.household_summary", { household_id: SHAH });
    noChild(everything(r));
  });
});

// ---------------------------------------------------------------------------
describe("giving.household_summary with a year", () => {
  const summary = { household_id: SHAH, as_of: "2026-10-10", lifetime: { payments: 0, received_cents: 0, refunded_cents: 0, first_gift_on: null, last_gift_on: null }, years: [], recent_payments: [], open_pledge_count: 0, open_cents: 0, behind_cents: 0, open_pledges: [], recurring_active: 0 };
  const pay = (id: string, received_on: string, amount_cents: number, extra: Record<string, unknown> = {}) => ({ id, household_id: SHAH, payer_person_id: null, amount_cents, refunded_cents: 0, status: "settled", received_on, is_opening_balance: false, ...extra });
  const tables = {
    // The community's year starts in July, so 2025 means 1 July 2025 to 30 June 2026.
    org_profiles: [{ center_id: "center-1", fiscal_year_start_month: 7 }],
    funds: [{ id: "f1", center_id: "center-1", name: "General fund" }],
    campaigns: [{ id: "c1", center_id: "center-1", name: "Hall roof" }],
    pledges: [
      { id: "pl1", household_id: SHAH, pledged_by_person_id: null, campaign_id: "c1", fund_id: null, amount_cents: 100000, paid_cents: 40000, status: "partially_paid", pledged_at: "2025-09-01T12:00:00Z", due_on: null },
      { id: "pl0", household_id: SHAH, pledged_by_person_id: null, campaign_id: null, fund_id: "f1", amount_cents: 50000, paid_cents: 50000, status: "paid", pledged_at: "2024-09-01T12:00:00Z", due_on: null },
    ],
    payments: [pay("a", "2025-10-05", 30000), pay("b", "2026-02-01", 20000, { refunded_cents: 5000 }), pay("c", "2026-07-02", 99900), pay("d", "2025-03-01", 12500), pay("e", "2025-11-01", 7700, { status: "failed" })],
    payment_allocations: [{ payment_id: "a", pledge_id: "pl1", amount_cents: 30000 }],
  };

  it("adds up the community's own year, not the calendar year", async () => {
    const { ctx } = setup({ rpc: { giving_household_summary: summary }, tables });
    const r = await runCommand(ctx, "giving.household_summary", { household_id: SHAH, year: 2025 });
    const y = dataOf<{ year_summary: { label: string; from: string; to: string; paid_cents: number; paid: string; refunded: string; gifts: number; pledged: string; pledge_count: number; fulfilment_percent: number; average_gift: string; by_cause: { label: string; amount: string }[]; previous: { label: string; paid: string; pledged: string } } }>(r).year_summary;
    expect(y).toMatchObject({ label: "2025-26", from: "2025-07-01", to: "2026-06-30", paid_cents: 45000, paid: "$450.00", refunded: "$50.00", gifts: 2, average_gift: "$225.00", pledged: "$1,000.00", pledge_count: 1, fulfilment_percent: 40 });
    expect(y.by_cause.map((c) => [c.label, c.amount])).toEqual([["Hall roof", "$300.00"], ["General giving", "$150.00"]]);
    // The year before, to compare with: July 2024 to June 2025.
    expect(y.previous).toMatchObject({ label: "2024-25", paid: "$125.00", pledged: "$500.00" });
    noChild(everything(r));
  });

  it("leaves year_summary out when no year is asked for, and asks the database the same thing as before", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { giving_household_summary: spy(seen, summary) }, tables });
    const d = dataOf<{ year_summary?: unknown }>(await runCommand(ctx, "giving.household_summary", { household_id: SHAH }));
    expect(d.year_summary).toBeUndefined();
    expect(seen).toEqual([{ p_household: SHAH, p_today: "2026-10-10" }]);
  });

  it("says plainly when the year has nothing, and when it has not started", async () => {
    const { ctx } = setup({ rpc: { giving_household_summary: summary }, tables });
    expect(await runCommand(ctx, "giving.household_summary", { household_id: SHAH, year: 2019 })).toMatchObject({ ok: true, message: "This household has no pledges or payments in 2019-20." });
    expect(await runCommand(ctx, "giving.household_summary", { household_id: SHAH, year: 2027 })).toMatchObject({ ok: false, error: "2027 has not started yet, so there is no giving to show for it." });
    expect(await runCommand(ctx, "giving.household_summary", { household_id: SHAH, year: 1800 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await runCommand(ctx, "giving.household_summary", { household_id: SHAH, year: "last year" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("is the calendar year when the community has not said when its year starts, and still tells a finance volunteer the totals may be low", async () => {
    const { ctx } = setup({ permissions: ["giving.record_offline"], rpc: { giving_household_summary: summary }, tables: { ...tables, org_profiles: [] } });
    const r = await runCommand(ctx, "giving.household_summary", { household_id: SHAH, year: 2026 });
    const d = dataOf<{ limited_view: string; year_summary: { label: string; from: string; paid_cents: number } }>(r);
    expect(d.year_summary).toMatchObject({ label: "2026", from: "2026-01-01", paid_cents: 15000 + 99900 });
    expect(d.limited_view).toContain("only the payments you recorded yourself");
  });

  it("takes the year as an optional whole number in the tool list", () => {
    const schema = CATALOG.find((c) => c.key === "giving.household_summary")!.input.json();
    expect(schema.required).toEqual(["household_id"]);
    expect(schema.properties.year).toMatchObject({ type: "integer", minimum: 1991 });
  });
});

// ---------------------------------------------------------------------------
describe("giving.bank_lines_unmatched and giving.zelle_waiting", () => {
  it("lists the bank lines nobody has matched, oldest first, in dollars", async () => {
    const seen: Record<string, unknown>[] = [];
    const answer = {
      as_of: "2026-10-10",
      gifts: 2,
      gifts_cents: 30000,
      deposits: 1,
      deposits_cents: 51000,
      debits: 4,
      payouts: 1,
      oldest_posted_on: "2026-09-20",
      oldest_days: 20,
      lines: [
        { id: "b1", kind: "gift", posted_on: "2026-09-20", days_waiting: 20, amount_cents: 25000, channel: "zelle", payer_name: "Rahul Shah", reference: "WFCT0H7K2M1Q", description: "Zelle Payment From Rahul Shah", status: "suggested", account: "Chase operating" },
        { id: "b2", kind: "deposit", posted_on: "2026-10-01", days_waiting: 9, amount_cents: 51000, channel: "check", payer_name: null, reference: null, description: "Deposit", status: "unmatched", account: "Chase operating" },
      ],
    };
    const { ctx } = setup({ rpc: { giving_unmatched_bank_lines: spy(seen, answer) } });
    const r = await runCommand(ctx, "giving.bank_lines_unmatched", { limit: 5 });
    expect(seen).toEqual([{ p_center: "center-1", p_limit: 5, p_today: "2026-10-10" }]);
    const d = dataOf<{ gifts_total: string; deposits_total: string; oldest_days: number; lines: { kind: string; amount: string; suggested: boolean }[]; where_to_match: string }>(r);
    expect(d).toMatchObject({ gifts_total: "$300.00", deposits_total: "$510.00", oldest_days: 20, where_to_match: "/giving/payments/bank" });
    expect(d.lines.map((l) => [l.kind, l.amount, l.suggested])).toEqual([
      ["gift", "$250.00", true],
      ["deposit", "$510.00", false],
    ]);
  });

  it("says when everything is matched", async () => {
    const { ctx } = setup({ rpc: { giving_unmatched_bank_lines: { gifts: 0, deposits: 0, debits: 0, payouts: 0, lines: [], oldest_posted_on: null } } });
    expect(await runCommand(ctx, "giving.bank_lines_unmatched", {})).toMatchObject({ ok: true, message: "Every bank line is matched or set aside." });
  });

  it("lists Zelle reports with cards, marks the ones with an exact bank line, and never reads the member names the database sends", async () => {
    const waiting = {
      as_of: "2026-10-10",
      reported: 2,
      unmatched: 1,
      past_window: 1,
      total_cents: 60000,
      reports: [
        { id: "r1", household_id: SHAH, status: "reported", amount_cents: 25000, sent_on: "2026-10-08", days_waiting: 2, due_on: "2026-10-18", past_window: false, sender_name: "Rahul Shah", has_confirmation: true, pledges_named: 0, is_test: false },
        { id: "r2", household_id: MEHTA, status: "unmatched", amount_cents: 35000, sent_on: "2026-09-20", days_waiting: 20, due_on: "2026-09-30", past_window: true, sender_name: null, has_confirmation: false, pledges_named: 1, is_test: false },
      ],
    };
    // The database's exact-match answer lists every member by first name, children included. Only the report id is used.
    const exact = [{ report_id: "r1", bank_transaction_id: "b1", amount_cents: 25000, sent_on: "2026-10-08", posted_on: "2026-10-09", confirmation: "X", payer_name: "Rahul Shah", household: { household_id: SHAH, members: "Priya, Rahul, Zoya" } }];
    const { ctx } = setup({ via: "assistant", rpc: { giving_zelle_waiting: waiting, zelle_exact_matches: exact } });
    const r = await runCommand(ctx, "giving.zelle_waiting", {});
    const d = dataOf<{ waiting: number; total: string; exact_matches: number; reports: { id: string; household: { household_number: string } | null; exact_bank_match: boolean; status: string; past_window: boolean; amount: string }[] }>(r);
    expect(d).toMatchObject({ waiting: 3, total: "$600.00", exact_matches: 1 });
    expect(d.reports.map((x) => [x.id, x.household?.household_number, x.exact_bank_match, x.status, x.past_window, x.amount])).toEqual([
      ["r1", "H-1001", true, "Waiting for the bank", false, "$250.00"],
      ["r2", "H-1003", false, "Not seen at the bank", true, "$350.00"],
    ]);
    noChild(everything(r));
  });

  it("explains a failure of the exact-match look-up instead of hiding it", async () => {
    const { ctx } = setup({ rpc: { giving_zelle_waiting: { reported: 0, unmatched: 0, reports: [] } }, failRpc: { zelle_exact_matches: { code: "PGRST202", message: "x" } } });
    expect(await runCommand(ctx, "giving.zelle_waiting", {})).toMatchObject({ ok: false, error: expect.stringContaining("Could not look for exact Zelle matches") });
  });
});

// ---------------------------------------------------------------------------
describe("giving.waiting_for_second_approver", () => {
  const queue = {
    refund_count: 1,
    refunds: [
      { payment_id: "pay-9", receipt_number: "R-0042", household_id: SHAH, method: "check", provider: "offline", status: "captured", received_on: "2026-09-01", payment_amount_cents: 25000, refunded_cents: 0, requested_cents: 10000, reason: "Duplicate check", requested_by: "user-1", last_changed_at: "2026-10-08T12:00:00Z", matched_to_deposit: true },
    ],
    write_off_count: 1,
    write_offs: [
      { pledge_id: "pl-7", pledge_number: "P-77", household_id: MEHTA, source: "general", fund: "General fund", amount_cents: 4500, paid_cents: 1500, open_cents: 3000, due_on: "2026-06-30", reason: null, requested_by: "user-2", last_changed_at: "2026-10-07T12:00:00Z" },
    ],
    provider_refund_count: 1,
    provider_refunds: [
      { id: "fl-1", payment_id: "pay-3", provider: "stripe", amount_cents: 5000, refunded_on: "2026-10-05", provider_ref: "re_1", detail: "Customer dispute", reason: null, first_approver: null, first_approver_name: null, receipt_number: "R-0030", household_id: PATEL, payment_amount_cents: 5000, refunded_cents: 0, received_on: "2026-09-30" },
    ],
  };

  it("gives each request with the household card and what a second approver needs, and says which one the viewer asked for", async () => {
    const { ctx } = setup({ rpc: { giving_second_approver_queue: queue } });
    const r = await runCommand(ctx, "giving.waiting_for_second_approver", {});
    const d = dataOf<{
      total: number;
      items: { kind: string; household: { household_number: string } | null; amount: string; asked_by_you: boolean; you_can_approve: boolean; waiting_for: string; evidence: string[]; look_at: string[] }[];
    }>(r);
    expect(d.total).toBe(3);
    const [refund, writeOff, provider] = d.items;
    expect(refund).toMatchObject({ kind: "refund", amount: "$100.00", asked_by_you: true, you_can_approve: false });
    expect(refund.household?.household_number).toBe("H-1001");
    expect(refund.evidence[0]).toBe("Refund of $100.00 from a $250.00 Check payment received 2026-09-01 (part of it).");
    expect(refund.look_at).toEqual(
      expect.arrayContaining([expect.stringContaining("matched to a bank deposit"), expect.stringContaining("You asked for this refund yourself")]),
    );
    expect(writeOff).toMatchObject({ kind: "write_off", amount: "$30.00", asked_by_you: false, you_can_approve: true });
    expect(writeOff.look_at).toEqual(expect.arrayContaining([expect.stringContaining("No reason is written down"), expect.stringContaining("part of this pledge already")]));
    expect(provider).toMatchObject({ kind: "provider_refund", waiting_for: "a first approver", amount: "$50.00" });
    expect(provider.evidence.join(" ")).toContain("Stripe refunded $50.00");
    noChild(everything(r));
  });

  it("filters by kind", async () => {
    const { ctx } = setup({ rpc: { giving_second_approver_queue: queue } });
    const r = await runCommand(ctx, "giving.waiting_for_second_approver", { kind: "write_offs" });
    expect(dataOf<{ total: number; items: { kind: string }[] }>(r)).toMatchObject({ total: 1, items: [{ kind: "write_off" }] });
  });

  it("tells a person who can approve people but not money that they don't have access to this area", async () => {
    const { ctx } = setup({ permissions: ["people.approve"], rpc: { giving_second_approver_queue: queue } });
    const r = await runCommand(ctx, "giving.waiting_for_second_approver", {});
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("You don't have access to this area") });
  });

  it("says when nothing is waiting", async () => {
    const { ctx } = setup({ rpc: { giving_second_approver_queue: { refund_count: 0, refunds: [], write_off_count: 0, write_offs: [], provider_refund_count: 0, provider_refunds: [] } } });
    expect(await runCommand(ctx, "giving.waiting_for_second_approver", {})).toMatchObject({ ok: true, message: "Nothing is waiting for a second approver." });
  });
});

// ---------------------------------------------------------------------------
describe("giving.fund_mapping_status", () => {
  it("says what is missing and what to do next", async () => {
    const { ctx } = setup({
      rpc: {
        giving_fund_mapping_status: {
          required_purposes: ["income.general", "bank", "merchant_fees"],
          missing_purposes: ["merchant_fees"],
          mapped_count: 2,
          approved_count: 0,
          mappings: [
            { purpose: "bank", account: "Chase checking", approved: false },
            { purpose: "income.general", account: "Donations", approved: false },
          ],
          funds_count: 3,
          funds_without_class: [{ id: "f1", key: "building", name: "Building fund", restricted: true }],
        },
      },
    });
    const d = dataOf<{ ready: boolean; required: number; missing: { label: string }[]; next_step: string; mappings: { label: string }[]; funds_without_class: { name: string }[] }>(
      await runCommand(ctx, "giving.fund_mapping_status", {}),
    );
    expect(d).toMatchObject({ ready: false, required: 3 });
    expect(d.missing).toEqual([{ purpose: "merchant_fees", label: expect.any(String) }]);
    expect(d.next_step).toMatch(/^Choose a QuickBooks account for /);
    expect(d.funds_without_class).toEqual([{ name: "Building fund", restricted: true }]);
  });

  it("is ready only when everything required is mapped and approved", async () => {
    const { ctx } = setup({
      rpc: { giving_fund_mapping_status: { required_purposes: ["bank"], missing_purposes: [], mapped_count: 1, approved_count: 1, mappings: [{ purpose: "bank", account: "Chase", approved: true }], funds_count: 1, funds_without_class: [] } },
    });
    expect(await runCommand(ctx, "giving.fund_mapping_status", {})).toMatchObject({ ok: true, data: { ready: true, next_step: "The mapping is complete and approved." } });
  });
});

// ---------------------------------------------------------------------------
describe("giving.draft_payment: record a payment, prepared and not recorded", () => {
  const P1 = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3001";
  const P2 = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3002";
  const draftContext = {
    household_id: SHAH,
    open_pledges: [
      { id: P1, pledge_number: "P-101", source: "general", amount_cents: 50000, paid_cents: 25000, status: "partially_paid", pledged_at: "2026-01-10T12:00:00Z", due_on: "2026-06-30", fund: "General fund", campaign: "Paryushan 2026" },
      { id: P2, pledge_number: "P-102", source: "general", amount_cents: 100000, paid_cents: 0, status: "open", pledged_at: "2026-03-01T12:00:00Z", due_on: null, fund: "Building fund", campaign: "Building fund" },
    ],
    month_closed: false,
    duplicates: [],
    check_number_elsewhere: 0,
  };
  const ask = { household_id: SHAH, amount: "250", method: "check", reference: "#1043", received_on: "2026-10-04" };

  type Draft = {
    nothing_saved: boolean;
    household: { household_number: string; adults: string[] };
    payment: { amount: string; amount_cents: number; method: string; check_number: string | null };
    allocation: { lines: { pledge_number: string; applied: string; closes: boolean }[]; unallocated_cents: number };
    questions: { kind: string; question: string }[];
    checks: { key: string; status: string; detail: string }[];
    needs_a_look: number;
    record_it_at: string;
  };

  it("prepares the form: card, dollars and cents, the pledge it would close, a clear check list, and saves nothing", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ readOnly: true, rpc: { giving_draft_context: spy(seen, draftContext) } });
    const r = await runCommand(ctx, "giving.draft_payment", ask);
    expect(seen).toEqual([{ p_household: SHAH, p_amount_cents: 25000, p_method: "check", p_check_number: "1043", p_received_on: "2026-10-04" }]);
    const d = dataOf<Draft>(r);
    expect(r).toMatchObject({ ok: true, message: "Nothing has been saved yet." });
    expect(d.nothing_saved).toBe(true);
    expect(d.household).toMatchObject({ household_number: "H-1001", adults: ["Priya Shah", "Rahul Shah"] });
    expect(d.payment).toMatchObject({ amount: "$250.00", amount_cents: 25000, method: "Check", check_number: "1043" });
    expect(d.allocation.lines).toEqual([expect.objectContaining({ pledge_number: "P-101", applied: "$250.00", closes: true })]);
    expect(d.questions).toEqual([]);
    expect(d.checks.every((c) => c.status === "ok")).toBe(true);
    expect(d.needs_a_look).toBe(0);
    expect(d.record_it_at).toBe(`/giving/payments?household=${SHAH}`);
    noChild(everything(r));
  });

  it("turns a partial payment and an overpayment into questions, not decisions", async () => {
    const { ctx } = setup({ rpc: { giving_draft_context: draftContext } });
    const part = dataOf<Draft>(await runCommand(ctx, "giving.draft_payment", { ...ask, amount: "100" }));
    expect(part.questions.map((q) => q.kind)).toEqual(["partial"]);
    expect(part.questions[0].question).toBe("This pays $100.00 of the $250.00 still open on Paryushan 2026 (P-101). The pledge would stay open with $150.00 left. Is that what the donor meant?");
    const over = dataOf<Draft>(await runCommand(ctx, "giving.draft_payment", { ...ask, amount: "1500" }));
    expect(over.allocation.unallocated_cents).toBe(25000);
    expect(over.questions.map((q) => q.kind)).toEqual(["overpayment"]);
    expect(over.needs_a_look).toBeGreaterThanOrEqual(2);
  });

  it("applies only the pledges named when asked to choose", async () => {
    const { ctx } = setup({ rpc: { giving_draft_context: draftContext } });
    const d = dataOf<Draft>(await runCommand(ctx, "giving.draft_payment", { ...ask, amount: "300", allocation: "choose", pledge_ids: `${P2}` }));
    expect(d.allocation.lines.map((l) => [l.pledge_number, l.applied])).toEqual([["P-102", "$300.00"]]);
  });

  it("accepts a plain number for the amount, as a model may send it", async () => {
    const { ctx } = setup({ rpc: { giving_draft_context: draftContext } });
    expect(dataOf<Draft>(await runCommand(ctx, "giving.draft_payment", { ...ask, amount: 250.5 })).payment.amount).toBe("$250.50");
  });

  it("refuses in the Record payment screen's own words, saying 'prepare'", async () => {
    const { ctx } = setup({ rpc: { giving_draft_context: draftContext } });
    expect(await runCommand(ctx, "giving.draft_payment", { ...ask, amount: "0" })).toMatchObject({ ok: false, error: "Could not prepare the payment — enter an amount greater than zero, like 251.00." });
    expect(await runCommand(ctx, "giving.draft_payment", { ...ask, received_on: "2026-10-12" })).toMatchObject({
      ok: false,
      error: "Could not prepare the payment — the received date must be a real date, not in the future.",
    });
    expect(await runCommand(ctx, "giving.draft_payment", { ...ask, method: "stock", reference: undefined })).toMatchObject({
      ok: false,
      error: "Could not prepare the payment — for a stock gift, enter the shares and their value on the date received.",
    });
    expect(await runCommand(ctx, "giving.draft_payment", { ...ask, allocation: "choose" })).toMatchObject({
      ok: false,
      error: "Could not prepare the payment — tick the pledges to apply it to, or switch to earliest-first.",
    });
    expect(await runCommand(ctx, "giving.draft_payment", { ...ask, method: "card" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await runCommand(ctx, "giving.draft_payment", { ...ask, household_id: "Shah" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("says when the household is not found, and never picks one by name", async () => {
    const { ctx } = setup({ rpc: { giving_draft_context: null } });
    expect(await runCommand(ctx, "giving.draft_payment", ask)).toMatchObject({ ok: false, error: "That household was not found, or you can't record payments for it." });
  });

  it("points at a locked month, a likely duplicate and a Zelle already recorded", async () => {
    const { ctx } = setup({
      rpc: {
        giving_draft_context: { ...draftContext, month_closed: true, duplicates: [{ payment_id: "x", receipt_number: "R-0042", received_on: "2026-10-03", amount_cents: 25000, method: "zelle", check_number: null, same_check_number: false }] },
        possible_duplicate_zelle: [{ kind: "hand_recorded", id: "x", receipt_number: "R-0042", date: "2026-10-03", amount_cents: 25000 }],
      },
    });
    const d = dataOf<Draft>(await runCommand(ctx, "giving.draft_payment", { ...ask, method: "zelle", reference: "WFCT0H7K2M1Q" }));
    const by = (k: string) => d.checks.find((c) => c.key === k)!;
    expect(by("month")).toMatchObject({ status: "look" });
    expect(by("duplicates").status).toBe("look");
    expect(by("duplicates").detail).toContain("R-0042 on 2026-10-03 for $250.00");
    expect(by("duplicates").detail).toContain("Recording it again counts the gift twice");
  });

  it("does not claim the month is open when this person cannot see month-end close", async () => {
    const { ctx } = setup({ rpc: { giving_draft_context: { ...draftContext, month_closed: null } } });
    const d = dataOf<Draft>(await runCommand(ctx, "giving.draft_payment", ask));
    expect(d.checks.find((c) => c.key === "month")!.status).toBe("unknown");
  });

  it("does not say 'not recorded twice' when the person sees only their own payments", async () => {
    const { ctx } = setup({ permissions: ["giving.record_offline"], rpc: { giving_draft_context: draftContext } });
    const d = dataOf<Draft>(await runCommand(ctx, "giving.draft_payment", ask));
    expect(d.checks.find((c) => c.key === "duplicates")).toMatchObject({ status: "unknown", detail: expect.stringContaining("only the payments you recorded yourself") });
  });

  it("tells a recorder who cannot apply payments that it would stay a general gift", async () => {
    const { ctx } = setup({ permissions: ["giving.record_offline"], rpc: { giving_draft_context: draftContext } });
    const d = dataOf<Draft>(await runCommand(ctx, "giving.draft_payment", ask));
    expect(d.allocation.lines).toEqual([]);
    expect(d.questions.map((q) => q.kind)).toEqual(["cannot_apply"]);
  });

  it("is refused for a person who may not record payments", async () => {
    const { ctx } = setup({ permissions: ["giving.view"], rpc: { giving_draft_context: draftContext } });
    expect(await runCommand(ctx, "giving.draft_payment", ask)).toMatchObject({ ok: false, code: "no_access" });
  });

  it("is an ordinary draft for Niva: it runs at once, saves nothing, and shows adults only", async () => {
    const { ctx } = setup({ via: "assistant", readOnly: true, rpc: { giving_draft_context: draftContext } });
    const r = await runCommand(ctx, "giving.draft_payment", ask);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.needsConfirmation).toBeFalsy();
    noChild(everything(r));
  });

  it("explains a database problem next to what was being done", async () => {
    const { ctx } = setup({ failRpc: { giving_draft_context: { code: "42501", message: "permission denied" } } });
    expect(await runCommand(ctx, "giving.draft_payment", ask)).toMatchObject({ ok: false, error: "Could not look up the household's pledges — you don't have permission to make this change." });
  });
});
