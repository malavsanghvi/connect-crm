import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { CATALOG } from "@/lib/commands/catalog";
import { CommandRegistry } from "@/lib/commands/registry";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { CommandNeedsConfirmation, CommandRunResult, CommandVia } from "@/lib/commands/types";

import { GIVING_ANSWERS, SHAH, givingWorld, type Rpc } from "./giving-world";
import { CHILDREN, fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

// giving.record_pledge (docs/GIVING_REDESIGN.md slice 7; 0745): a money record, off for every door until an owner switches it on;
// with the switch on it proposes first and records once, with the confirmation as the key. giving.manage only.

const KEY = "giving.record_pledge";
const ON = { assistant: { tools: { [KEY]: true } } };
const FUND = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c5001";
const ask = { household_id: SHAH, amount: "500", reason: "Pledged in person", fund_id: FUND };
const recorded = { pledge_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c5101", pledge_number: "PL-20456", household_id: SHAH, amount_cents: 50000, replayed: false };

function setup(opts: { via?: CommandVia; permissions?: string[]; rules?: unknown; rpc?: Rpc; tables?: FakeDbOptions["tables"] } = {}) {
  const tables = { funds: [{ id: FUND, center_id: "center-1", name: "Building fund", active: true }], ...opts.tables };
  const db = fakeDb(givingWorld({ ...GIVING_ANSWERS, ...opts.rpc }, {}, tables));
  const session = fakeSession({ db, permissions: opts.permissions ?? ["people.view", "giving.view", "giving.manage"], center: { ...fakeSession().center, rules: opts.rules ?? ON } });
  const registry = new CommandRegistry();
  for (const c of CATALOG) registry.register(c);
  const ctx = testContext({ session, registry, via: opts.via ?? "assistant", minorNames: CHILDREN.full });
  return { ctx, db, session, registry };
}

const asked = (r: CommandRunResult): CommandNeedsConfirmation => {
  if (!r.ok || !r.needsConfirmation) throw new Error(`expected a confirmation card, got ${JSON.stringify(r)}`);
  return r;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("giving.record_pledge", () => {
  it("is a confirm command for giving.manage in the Giving module, off for every door until an owner switches it on", async () => {
    const c = CATALOG.find((x) => x.key === KEY)!;
    expect(c).toMatchObject({ level: "confirm", permission: "recordPledge", module: "giving", enabledByDefault: false, requiresOwnerSwitch: true });
    for (const via of ["assistant", "palette", "screen"] as const) {
      const { ctx, session, registry } = setup({ via, rules: {} });
      expect(registry.list(session, via).map((x) => x.key)).not.toContain(KEY);
      expect(await runCommand(ctx, KEY, ask)).toMatchObject({ ok: false, code: "switched_off" });
    }
  });

  it("is not offered to someone who may only record payments or approve", () => {
    for (const permissions of [["giving.record_offline"], ["giving.view", "giving.approve"]]) {
      const { session, registry } = setup({ permissions });
      expect(registry.list(session, "assistant").map((x) => x.key)).not.toContain(KEY);
    }
  });

  it("proposes first: the card shows the household card, the amount, the fund and the reason, and nothing is recorded", async () => {
    const { ctx, db } = setup();
    const r = asked(await runCommand(ctx, KEY, ask));
    expect(r.preview.summary).toMatch(/^Record a \$500\.00 pledge for the .* H-1001\.$/);
    expect(r.preview.households?.[0]).toMatchObject({ household_number: "H-1001", adults: ["Priya Shah", "Rahul Shah"] });
    expect(r.preview.lines).toEqual(
      expect.arrayContaining([
        { label: "Amount", value: "$500.00" },
        { label: "For", value: "Building fund" },
        { label: "Pledged by", value: "The household" },
        { label: "Reason (shown in History)", value: "Pledged in person" },
      ]),
    );
    expect(r.preview.warnings?.[0]).toContain("No money moves");
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("record_manual_pledge");
    const text = JSON.stringify(r);
    for (const name of [...CHILDREN.first, ...CHILDREN.full]) expect(text).not.toContain(name);
  });

  it("records only after the person confirms, once, with the confirmation as the key", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { record_manual_pledge: (a: Record<string, unknown>) => (seen.push(a), recorded) } });
    const t = asked(await runCommand(ctx, KEY, ask));
    const done = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(done).toMatchObject({ ok: true, data: { pledgeNumber: "PL-20456", amountCents: 50000, replayed: false }, message: "Recorded a $500.00 pledge — PL-20456. No money moved." });
    expect(seen).toEqual([
      {
        p_idempotency_key: `proposal:${t.proposalId}`,
        p_center: "center-1",
        p_household: SHAH,
        p_amount_cents: 50000,
        p_reason: "Pledged in person",
        p_fund: FUND,
        p_campaign: null,
        p_opportunity: null,
        p_opportunity_option: null,
        p_due_on: null,
        p_pledged_by_person: null,
        p_dedication: null,
      },
    ]);
  });

  it("refuses a pledger who is not an adult of the household, and more than one of fund, campaign and opportunity", async () => {
    const { ctx } = setup();
    const child = await runCommand(ctx, KEY, { ...ask, pledged_by_person_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c5999" });
    expect(child).toMatchObject({ ok: false, error: expect.stringContaining("must be an adult of this household") });
    const two = await runCommand(ctx, KEY, { ...ask, campaign_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c5002" });
    expect(two).toMatchObject({ ok: false, error: expect.stringContaining("not more than one") });
  });

  it("refuses a short reason before anything is asked", async () => {
    const { ctx, db } = setup();
    expect(await runCommand(ctx, KEY, { ...ask, reason: "x" })).toMatchObject({ ok: false });
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("record_manual_pledge");
  });
});
