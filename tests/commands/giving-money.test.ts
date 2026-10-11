import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";

import { CATALOG } from "@/lib/commands/catalog";
import { CommandRegistry } from "@/lib/commands/registry";
import { commandAvailability } from "@/lib/commands/enabled";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { CommandNeedsConfirmation, CommandRunResult, CommandVia } from "@/lib/commands/types";
import { depositMatchedMessage, depositTotalProblem, exactConfirmSummary } from "@/lib/payments/bank-match";

import { GIVING_ANSWERS, MEHTA, SHAH, givingWorld, type Rpc } from "./giving-world";
import { CHILDREN, fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

const ALL = ["people.view", "giving.view", "giving.manage", "giving.record_offline", "giving.approve", "accounting.manage", "accounting.close"];
const MONEY = ["giving.record_payment", "giving.confirm_exact_zelle_matches", "giving.match_deposit"] as const;
const SWITCH_ON = { assistant: { tools: { "giving.record_payment": true, "giving.confirm_exact_zelle_matches": true, "giving.match_deposit": true } } };

const P1 = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3001";
const P2 = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3002";
const REPORT = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4001";
const REPORT_2 = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4002";
const BANK = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4101";
const LINE = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4201";
const PAY_A = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4301";
const PAY_B = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4302";

function setup(
  opts: {
    via?: CommandVia;
    permissions?: string[];
    rules?: unknown;
    rpc?: Rpc;
    failRpc?: FakeDbOptions["failRpc"];
    tables?: FakeDbOptions["tables"];
    isPlatformAdmin?: boolean;
    now?: () => Date;
  } = {},
) {
  const db = fakeDb(givingWorld({ ...GIVING_ANSWERS, ...opts.rpc }, opts.failRpc, opts.tables));
  const session = fakeSession({ db, permissions: opts.permissions ?? ALL, isPlatformAdmin: opts.isPlatformAdmin ?? false, center: { ...fakeSession().center, rules: opts.rules ?? SWITCH_ON } });
  const registry = new CommandRegistry();
  for (const c of CATALOG) registry.register(c);
  const ctx = testContext({ session, registry, via: opts.via ?? "screen", minorNames: CHILDREN.full, now: opts.now });
  return { ctx, db, session, registry };
}

const spy = <T,>(seen: Record<string, unknown>[], answer: T) => (args: Record<string, unknown>) => (seen.push(args), answer);
const asked = (r: CommandRunResult): CommandNeedsConfirmation => {
  if (!r.ok || !r.needsConfirmation) throw new Error(`expected a confirmation card, got ${JSON.stringify(r)}`);
  return r;
};
const noChild = (text: string) => {
  for (const word of [...CHILDREN.first, ...CHILDREN.full]) expect(text).not.toContain(word);
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
});

const paid = { payment_id: "pay-new", receipt_number: "R-0042", amount_cents: 25000, replayed: false, applied: [{ pledge_id: P1, pledge_number: "P-101", amount_cents: 25000, closed: true }], unallocated_cents: 0, allocation_skipped: null };
const ask = { household_id: SHAH, amount: "250", method: "check", reference: "#1043", received_on: "2026-10-04" };

// ---------------------------------------------------------------------------
describe("the three money commands are built but off, for every door", () => {
  it("are confirm commands that need the owner's switch, and cannot be on by default", () => {
    for (const key of MONEY) {
      const c = CATALOG.find((x) => x.key === key)!;
      expect(c.level).toBe("confirm");
      expect(c.enabledByDefault).not.toBe(true);
      expect(c.requiresOwnerSwitch).toBe(true);
    }
  });

  it("are refused for Niva, the palette and a screen until an owner switches each on, and say why", async () => {
    for (const via of ["assistant", "palette", "screen"] as const) {
      const { ctx } = setup({ via, rules: {} });
      for (const key of MONEY) {
        const r = await runCommand(ctx, key, key === "giving.record_payment" ? ask : { report_ids: REPORT });
        expect(r, `${key} via ${via}`).toMatchObject({ ok: false, code: "switched_off" });
        expect(!r.ok && r.error).toContain("it moves money, so an owner has to approve it first");
      }
    }
  });

  it("are not listed anywhere while off: not for Niva, not in the palette, not on screen", () => {
    const { session, registry } = setup({ rules: {} });
    for (const via of ["assistant", "palette", "screen"] as const) {
      expect(registry.list(session, via).map((c) => c.key)).not.toEqual(expect.arrayContaining([...MONEY]));
      for (const key of MONEY) expect(registry.list(session, via).map((c) => c.key)).not.toContain(key);
    }
    expect(registry.modelTools(session).map((t) => t.name)).not.toContain("giving_record_payment");
  });

  it("stay off when the community says no, and come on one at a time when it says yes", () => {
    const no = setup({ rules: { assistant: { tools: { "giving.record_payment": false } } } });
    expect(commandAvailability(CATALOG.find((c) => c.key === "giving.record_payment")!, no.session, "screen")).toMatchObject({ ok: false, code: "switched_off" });
    const one = setup({ rules: { assistant: { tools: { "giving.match_deposit": true } } } });
    const keys = one.registry.list(one.session, "palette").map((c) => c.key);
    expect(keys).toContain("giving.match_deposit");
    expect(keys).not.toContain("giving.record_payment");
    expect(keys).not.toContain("giving.confirm_exact_zelle_matches");
    expect(one.registry.modelTools(one.session).map((t) => t.name)).toContain("giving_match_deposit");
  });

  it("have no refund, write-off or approve command: those need a second person", () => {
    for (const c of CATALOG) expect(c.key).not.toMatch(/refund|write_?off|approve_|reject|void/);
  });

  it("only a confirm command may ask for the owner's switch", () => {
    const registry = new CommandRegistry();
    const read = { ...CATALOG.find((c) => c.key === "giving.household_summary")!, key: "giving.other", requiresOwnerSwitch: true };
    expect(() => registry.register(read)).toThrow("only a confirm command needs the owner's switch");
  });
});

// ---------------------------------------------------------------------------
describe("giving.record_payment", () => {
  /** What the database is asked to apply: exactly the pledge, amount and state the card showed. */
  const PLAN_P1 = [{ pledge_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3001", amount_cents: 25000, pledge_amount_cents: 50000, pledge_paid_cents: 0 }];

  it("proposes first: the card shows the household, the dollars and the pledge it would close, and nothing is recorded", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx, db } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const r = asked(await runCommand(ctx, "giving.record_payment", ask));
    expect(r.preview.summary).toBe("Record $250.00 by check for household H-1001.");
    expect(r.confirmText).toBe("Yes, record $250.00 by check for household H-1001");
    expect(r.preview.households?.[0]).toMatchObject({ household_number: "H-1001", adults: ["Priya Shah", "Rahul Shah"] });
    expect(r.preview.lines.map((l) => l.label)).toEqual(expect.arrayContaining(["Amount", "Method", "Received", "Applied to General pledge (P-1)"]));
    expect(seen).toEqual([]);
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("record_offline_payment_once");
    noChild(JSON.stringify(r));
  });

  it("fixes the date, the amount and the pledges when the card is made, and stores them in the proposal", async () => {
    const { ctx } = setup({ rpc: { record_offline_payment_once: paid } });
    // No date given: today in the community's time zone (Chicago), 10 October.
    const t = asked(await runCommand(ctx, "giving.record_payment", { ...ask, received_on: undefined }));
    const stored = await ctx.proposals.confirm({ proposalId: t.proposalId, inputHash: t.inputHash, userId: ctx.session.userId });
    expect(stored.input).toMatchObject({ received_on: "2026-10-10", amount_cents: 25000, plan: PLAN_P1 });
  });

  it("records only after the person confirms, in one database call with a key made from that confirmation, applying exactly the card's pledges", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx, db } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    const before = db.rpcCalls.length;
    const done = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(seen).toEqual([
      {
        p_idempotency_key: `proposal:${t.proposalId}`,
        p_center: "center-1",
        p_household: SHAH,
        p_amount_cents: 25000,
        p_method: "check",
        p_received_on: "2026-10-04",
        p_allocations: PLAN_P1,
        p_chosen: false,
        p_check_number: "1043",
        p_envelope_number: null,
        p_memo: null,
      },
    ]);
    // The pledges and the date are not worked out again now: nothing but the one write is asked of the database.
    expect(db.rpcCalls.slice(before).map((c) => c.fn)).toEqual(["record_offline_payment_once"]);
    expect(done).toMatchObject({ ok: true, message: "Recorded $250.00 — receipt R-0042.", data: { payment_id: "pay-new", amount: "$250.00", replayed: false, unallocated_cents: 0 } });
    expect(done.ok && !done.needsConfirmation && (done.data as { applied: unknown[] }).applied).toEqual([{ pledge_id: P1, pledge_number: "P-101", amount_cents: 25000, amount: "$250.00", closed: true }]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/giving/payments", "layout");
  });

  it("records the day that was on the card even when it is confirmed after midnight, and a retry keeps that day", async () => {
    const seen: Record<string, unknown>[] = [];
    // 23:55 on 10 October in Chicago is 04:55 UTC on the 11th; the confirmation comes ten minutes later, on the 11th.
    let clock = new Date("2026-10-11T04:55:00Z");
    const world = setup({ now: () => clock, rpc: { record_offline_payment_once: spy(seen, paid) } });
    const t = asked(await runCommand(world.ctx, "giving.record_payment", { ...ask, received_on: undefined }));
    clock = new Date("2026-10-11T05:05:00Z");
    expect(await confirmProposal(world.ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true });
    expect(seen[0].p_received_on).toBe("2026-10-10");

    // A security code asked for after midnight: the new proposal made for the retry carries the same stored day.
    clock = new Date("2026-10-11T04:55:00Z");
    const stepUp = setup({ now: () => clock, failRpc: { record_offline_payment_once: { code: "CCSTP", message: "This needs a fresh 2FA check." } } });
    const t2 = asked(await runCommand(stepUp.ctx, "giving.record_payment", { ...ask, received_on: undefined }));
    clock = new Date("2026-10-11T05:05:00Z");
    const failed = await confirmProposal(stepUp.ctx, t2.proposalId, t2.inputHash);
    expect(failed).toMatchObject({ ok: false, needsStepUp: true });
    const retry = !failed.ok && failed.retry;
    if (!retry) throw new Error("expected a fresh proposal to confirm again");
    const stored = await stepUp.ctx.proposals.confirm({ proposalId: retry.proposalId, inputHash: retry.inputHash, userId: stepUp.ctx.session.userId });
    expect(stored.input).toMatchObject({ received_on: "2026-10-10" });
  });

  it("cannot record twice from one confirmation: the second press is refused before anything runs", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true });
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: false, code: "proposal_failed" });
    expect(seen).toHaveLength(1);
  });

  it("refuses to prepare a payment like one confirmed a few minutes ago (the answer may have been lost after it was recorded)", async () => {
    const seen: Record<string, unknown>[] = [];
    const sentence =
      "A payment like this for this household was confirmed a few minutes ago and may already be recorded. Check the household's payments first. If it really is a second payment, record it on the Record payment screen.";
    for (const guard of [{ unfinished: 1, recorded: 0 }, { unfinished: 0, recorded: 1 }]) {
      const { ctx } = setup({ rpc: { giving_payment_confirm_guard: spy(seen, guard) } });
      expect(await runCommand(ctx, "giving.record_payment", ask)).toMatchObject({ ok: false, error: sentence });
    }
    // It asks about this household and this amount, over the last 30 minutes.
    expect(seen[0]).toEqual({ p_household: SHAH, p_amount_cents: 25000, p_minutes: 30 });
    // Nothing recent: the card is made as usual.
    const clear = setup({ rpc: { giving_payment_confirm_guard: { unfinished: 0, recorded: 0 } } });
    expect(asked(await runCommand(clear.ctx, "giving.record_payment", ask)).proposalId).toBeTruthy();
    // The guard is only asked when a card is being made: a draft does not need it.
    expect(await runCommand(setup({ rpc: { giving_payment_confirm_guard: { unfinished: 1, recorded: 1 } } }).ctx, "giving.draft_payment", ask)).toMatchObject({ ok: true });
  });

  it("applies the pledges in the order the card showed, even when two were made at the same moment (the lower id first)", async () => {
    const A = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3010";
    const B = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3011";
    const pledge = (id: string, number: string) => ({ id, pledge_number: number, source: "general", amount_cents: 30000, paid_cents: 0, status: "open", pledged_at: "2026-02-01T12:00:00Z", due_on: null, fund: null, campaign: null });
    const context = { household_id: SHAH, open_pledges: [pledge(B, "P-11"), pledge(A, "P-10")], month_closed: false, duplicates: [], check_number_elsewhere: 0 };
    const { ctx } = setup({ rpc: { giving_draft_context: context, record_offline_payment_once: paid } });
    const t = asked(await runCommand(ctx, "giving.record_payment", { ...ask, amount: "100" }));
    expect(t.preview.lines.map((l) => l.label)).toContain("Applied to General pledge (P-10)");
    const stored = await ctx.proposals.confirm({ proposalId: t.proposalId, inputHash: t.inputHash, userId: ctx.session.userId });
    expect((stored.input as { plan: { pledge_id: string }[] }).plan.map((l) => l.pledge_id)).toEqual([A]);
  });

  it("refuses to show a card for a pledge that changed since the plan was made, in plain words", async () => {
    const { ctx } = setup({ rpc: { record_offline_payment_once: paid } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    const stored = (await ctx.proposals.confirm({ proposalId: t.proposalId, inputHash: t.inputHash, userId: ctx.session.userId })).input as never;
    const changed = setup({
      rpc: {
        giving_draft_context: {
          ...(GIVING_ANSWERS.giving_draft_context as Record<string, unknown>),
          open_pledges: [{ id: P1, pledge_number: "P-1", source: "general", amount_cents: 50000, paid_cents: 10000, status: "partially_paid", pledged_at: "2026-01-10T12:00:00Z", due_on: null, fund: null, campaign: null }],
        },
      },
    });
    const card = CATALOG.find((c) => c.key === "giving.record_payment")!;
    await expect(card.preview!(changed.ctx, stored)).rejects.toThrow("changed since this card was made (it is now $100.00 paid of $500.00), so nothing was changed. Look at the household again.");
  });

  it("says a repeat added nothing, and says when the payment was recorded but not applied", async () => {
    const again = setup({ rpc: { record_offline_payment_once: { ...paid, replayed: true } } });
    const t = asked(await runCommand(again.ctx, "giving.record_payment", ask));
    expect(await confirmProposal(again.ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true, message: "This payment was already recorded (receipt R-0042). Nothing was added." });

    const note = "The payment was recorded but not applied to pledges: applying needs the giving.manage permission, so a treasurer can apply it.";
    const volunteer = setup({ permissions: ["giving.record_offline"], rpc: { record_offline_payment_once: { ...paid, applied: [], unallocated_cents: 25000 } } });
    const v = asked(await runCommand(volunteer.ctx, "giving.record_payment", ask));
    expect(v.preview.warnings?.join(" ")).toContain("giving.manage");
    expect(await confirmProposal(volunteer.ctx, v.proposalId, v.inputHash)).toMatchObject({ ok: true, message: `Recorded $250.00 — receipt R-0042. ${note}`, data: { unallocated: "$250.00", allocation_skipped: note } });
  });

  it("passes the pledges named as the plan, marked as chosen, and 'leave unapplied' as an empty plan", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const chosen = asked(await runCommand(ctx, "giving.record_payment", { ...ask, allocation: "choose", pledge_ids: P1 }));
    await confirmProposal(ctx, chosen.proposalId, chosen.inputHash);
    const none = asked(await runCommand(ctx, "giving.record_payment", { ...ask, allocation: "none" }));
    await confirmProposal(ctx, none.proposalId, none.inputHash);
    expect(seen.map((s) => [s.p_allocations, s.p_chosen])).toEqual([
      [PLAN_P1, true],
      [[], false],
    ]);
  });

  it("does not let a model supply the date, the amount in cents or the plan: they are worked out and replaced", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const fake = [{ pledge_id: P2, amount_cents: 99, pledge_amount_cents: 99, pledge_paid_cents: 0 }];
    const t = asked(await runCommand(ctx, "giving.record_payment", { ...ask, amount_cents: 1, plan: fake }));
    await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(seen[0]).toMatchObject({ p_amount_cents: 25000, p_allocations: PLAN_P1 });
    // and the tool list the model sees does not mention them
    const tool = setup().registry.modelTools(setup().session).find((x) => x.name === "giving_record_payment")!;
    expect(Object.keys(tool.input_schema.properties)).not.toEqual(expect.arrayContaining(["plan"]));
    expect(Object.keys(tool.input_schema.properties)).not.toContain("amount_cents");
  });

  it("refuses a household of another community, even for a platform admin, when the card is made and when it runs", async () => {
    const other = { tables: { households: [{ id: SHAH, center_id: "center-2", display_name: "Shah", household_number: "H-1001", merged_into_id: null }] } };
    for (const isPlatformAdmin of [false, true]) {
      const { ctx } = setup({ ...other, isPlatformAdmin });
      expect(await runCommand(ctx, "giving.record_payment", ask)).toMatchObject({
        ok: false,
        error: "That household belongs to a different community than the one you are working in, so nothing can be recorded for it from here.",
      });
    }
    // The draft of the same payment says the same, so nothing is shown for a household that cannot be recorded here.
    expect(await runCommand(setup({ ...other }).ctx, "giving.draft_payment", ask)).toMatchObject({ ok: false });
    // If the household belongs to another community when it runs, running it refuses and asks the database nothing.
    const seen: Record<string, unknown>[] = [];
    const elsewhere = setup({ ...other, rpc: { record_offline_payment_once: spy(seen, paid) } });
    const record = CATALOG.find((c) => c.key === "giving.record_payment")!;
    const resolved = { ...ask, allocation: "auto", amount_cents: 25000, plan: PLAN_P1 };
    await expect(record.execute!({ ...elsewhere.ctx, proposalId: "11111111-1111-4111-8111-111111111111" }, resolved)).rejects.toThrow("different community");
    expect(seen).toEqual([]);
  });

  it("refuses to run without a confirmed proposal, and when the owner's switch is off", async () => {
    const record = CATALOG.find((c) => c.key === "giving.record_payment")!;
    const resolved = { ...ask, allocation: "auto", amount_cents: 25000, plan: PLAN_P1 };
    const { ctx } = setup();
    await expect(record.execute!(ctx, resolved)).rejects.toThrow("only runs after it is confirmed on its card");
    const off = setup({ rules: {} });
    await expect(record.execute!({ ...off.ctx, proposalId: "11111111-1111-4111-8111-111111111111" }, resolved)).rejects.toThrow("an owner has not switched it on");
  });

  it("refuses what the Record payment screen refuses, before any card is shown", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "giving.record_payment", { ...ask, amount: "0" })).toMatchObject({ ok: false, error: "Could not record the payment — enter an amount greater than zero, like 251.00." });
    expect(await runCommand(ctx, "giving.record_payment", { ...ask, received_on: "2026-10-12" })).toMatchObject({
      ok: false,
      error: "Could not record the payment — the received date must be a real date, not in the future.",
    });
  });

  it("a changed request cannot ride on an old confirmation", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    const t2 = asked(await runCommand(ctx, "giving.record_payment", { ...ask, amount: "2500" }));
    expect(t2.inputHash).not.toBe(t.inputHash);
    expect(await confirmProposal(ctx, t.proposalId, t2.inputHash)).toMatchObject({ ok: false, code: "proposal_failed" });
    expect(seen).toEqual([]);
  });

  it("explains a database refusal next to what was being done, and never says it recorded", async () => {
    const changed = "Pledge P-1 changed since you saw the card, so nothing was recorded. Look at the household again.";
    const { ctx } = setup({ failRpc: { record_offline_payment_once: { code: "23514", message: changed } } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, error: `Could not record the payment — ${changed}` });
    expect(JSON.stringify(r)).not.toMatch(/Recorded \$/);
  });

  it("returns the security code request for the separate window, with a fresh proposal to confirm again", async () => {
    const { ctx } = setup({ failRpc: { record_offline_payment_once: { code: "CCSTP", message: "This needs a fresh 2FA check." } } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, code: "needs_step_up", needsStepUp: true, stepUp: true });
    expect(!r.ok && r.retry?.proposalId).toBeTruthy();
    expect(!r.ok && r.retry?.proposalId).not.toBe(t.proposalId);
  });

  it("is not available to a person who may not record payments", async () => {
    const { ctx } = setup({ permissions: ["giving.view"] });
    expect(await runCommand(ctx, "giving.record_payment", ask)).toMatchObject({ ok: false, code: "no_access" });
  });

  it("shows Niva no child on the card, even from a note that names one", async () => {
    const { ctx } = setup({ via: "assistant", rpc: { record_offline_payment_once: paid } });
    const r = await runCommand(ctx, "giving.record_payment", { ...ask, memo: "From Zoya Shah's family" });
    expect(r.ok).toBe(true);
    noChild(JSON.stringify(r));
  });
});

// ---------------------------------------------------------------------------
describe("giving.confirm_exact_zelle_matches", () => {
  const pair = (report: string, bank: string, cents: number) => ({
    report_id: report,
    bank_transaction_id: bank,
    amount_cents: cents,
    sent_on: "2026-10-08",
    posted_on: "2026-10-09",
    confirmation: "WFCT0H7K2M1Q",
    payer_name: "Rahul Shah",
    household: { household_id: SHAH, household_number: "H-1001", members: "Priya, Rahul, Zoya" },
  });
  const exact = [pair(REPORT, BANK, 5000), pair(REPORT_2, "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4102", 7500)];

  it("proposes only the reports that are exact now, with the household cards and the total", async () => {
    const { ctx } = setup({ via: "assistant", rpc: { zelle_exact_matches: exact } });
    const r = asked(await runCommand(ctx, "giving.confirm_exact_zelle_matches", { report_ids: `${REPORT}, ${REPORT_2}, 7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4999` }));
    expect(r.preview.summary).toBe("Confirm 2 Zelles totalling $125.00.");
    expect(r.preview.households?.[0]).toMatchObject({ household_number: "H-1001", adults: ["Priya Shah", "Rahul Shah"] });
    expect(r.preview.warnings?.join(" ")).toContain("1 of the reports you named has no exact bank match and is left out");
    noChild(JSON.stringify(r));
  });

  it("says there is nothing to confirm when none is exact", async () => {
    const { ctx } = setup({ rpc: { zelle_exact_matches: [] } });
    expect(await runCommand(ctx, "giving.confirm_exact_zelle_matches", { report_ids: REPORT })).toMatchObject({
      ok: false,
      error: "None of these reports has a bank line that matches it exactly, so there is nothing to confirm. Match them by hand on the Bank screen.",
    });
  });

  it("confirms the pairs read now, only after the person presses the button, and says what happened", async () => {
    const seen: Record<string, unknown>[] = [];
    const outcome = { confirmed: [{ report_id: REPORT, payment_id: "pay-1", receipt_number: "R-1" }], skipped: [{ report_id: REPORT_2, reason: "no longer exact" }] };
    const { ctx } = setup({ rpc: { zelle_exact_matches: exact, confirm_exact_zelle_matches: spy(seen, outcome) } });
    const t = asked(await runCommand(ctx, "giving.confirm_exact_zelle_matches", { report_ids: `${REPORT}, ${REPORT_2}` }));
    expect(seen).toEqual([]);
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(seen).toEqual([{ p_center: "center-1", p_pairs: [{ report_id: REPORT, bank_transaction_id: BANK }, { report_id: REPORT_2, bank_transaction_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4102" }] }]);
    expect(r).toMatchObject({ ok: true, message: "Confirmed 1 Zelle; 1 skipped (no longer exact)." });
  });

  it("is an error, not a success, when nothing could be confirmed; and a strange answer is said, not hidden", async () => {
    const none = setup({ rpc: { zelle_exact_matches: exact, confirm_exact_zelle_matches: { confirmed: [], skipped: [{ report_id: REPORT, reason: "x" }, { report_id: REPORT_2, reason: "y" }] } } });
    const t = asked(await runCommand(none.ctx, "giving.confirm_exact_zelle_matches", { report_ids: `${REPORT}, ${REPORT_2}` }));
    expect(await confirmProposal(none.ctx, t.proposalId, t.inputHash)).toMatchObject({
      ok: false,
      error: "Could not confirm the exact matches — Nothing was confirmed: all 2 matches are no longer exact. Match them by hand.",
    });
    const odd = setup({ rpc: { zelle_exact_matches: exact, confirm_exact_zelle_matches: "nonsense" } });
    const o = asked(await runCommand(odd.ctx, "giving.confirm_exact_zelle_matches", { report_ids: REPORT }));
    expect(await confirmProposal(odd.ctx, o.proposalId, o.inputHash)).toMatchObject({ ok: false, error: expect.stringContaining("shape this screen does not understand") });
  });

  it("is not available without the bank-matching permission", async () => {
    const { ctx } = setup({ permissions: ["giving.view"] });
    expect(await runCommand(ctx, "giving.confirm_exact_zelle_matches", { report_ids: REPORT })).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("giving.match_deposit", () => {
  const context = (over: Record<string, unknown> = {}) => ({ ...GIVING_ANSWERS.giving_deposit_context as Record<string, unknown>, ...over });
  const args = { bank_line_id: LINE, payment_ids: `${PAY_A}, ${PAY_B}` };

  it("proposes with the deposit, each payment and the household cards, once the payments add up to the cent", async () => {
    const { ctx } = setup({ via: "assistant" });
    const r = asked(await runCommand(ctx, "giving.match_deposit", args));
    expect(r.preview.summary).toBe("Match the $300.00 deposit of 2026-10-01 to 2 recorded payments.");
    expect(r.preview.lines.map((l) => l.value ?? "")).toEqual(expect.arrayContaining(["$250.00", "$50.00", "$300.00 (matches the deposit)"]));
    expect(r.preview.households?.map((h) => h.household_number)).toEqual(["H-1001", "H-1003"]);
    noChild(JSON.stringify(r));
  });

  it("tells the person before confirming what the database would only say after", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ difference_cents: 5000, total_cents: 25000 }, "The chosen payments total $250.00 but the deposit is $300.00 ($50.00 short). They must add up exactly."],
      [{ difference_cents: -2000 }, "(" + "$20.00 over"],
      [{ missing_ids: [PAY_B] }, "1 of those payments was not found, or you can't see it."],
      [{ bank_line: { ...(GIVING_ANSWERS.giving_deposit_context as { bank_line: object }).bank_line, status: "matched" } }, "That bank line is already matched."],
    ];
    for (const [over, text] of cases) {
      const { ctx } = setup({ rpc: { giving_deposit_context: context(over) } });
      const r = await runCommand(ctx, "giving.match_deposit", args);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain(text);
    }
    const dep = context({ payments: [{ ...(context().payments as object[])[0], already_deposited: true, can_match: false, receipt_number: "R-9" }, (context().payments as object[])[1]] });
    expect(await runCommand(setup({ rpc: { giving_deposit_context: dep } }).ctx, "giving.match_deposit", args)).toMatchObject({ ok: false, error: "Already on a deposit: R-9. Take them out and try again." });
    expect(await runCommand(setup({ rpc: { giving_deposit_context: null } }).ctx, "giving.match_deposit", args)).toMatchObject({ ok: false, error: "That bank line was not found, or you can't see it." });
  });

  it("matches only after the person presses the button, then says so", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { match_deposit: spy(seen, 2) } });
    const t = asked(await runCommand(ctx, "giving.match_deposit", args));
    expect(seen).toEqual([]);
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(seen).toEqual([{ p_txn: LINE, p_payment_ids: [PAY_A, PAY_B] }]);
    expect(r).toMatchObject({ ok: true, message: "Deposit matched to 2 recorded payments and queued for QuickBooks as one deposit.", data: { count: 2 } });
  });

  it("uses the Bank screen's sentence if the totals stop adding up between the card and the button", async () => {
    const { ctx } = setup({ failRpc: { match_deposit: { code: "P0001", message: "the chosen payments total 25000 but the deposit is 30000" } } });
    const t = asked(await runCommand(ctx, "giving.match_deposit", args));
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({
      ok: false,
      error: "Could not match the deposit — the ticked payments total $250.00 but the deposit is $300.00. They must add up exactly.",
    });
  });

  it("refuses a bank line of another community, even for a platform admin, and refuses to run without a confirmed proposal", async () => {
    const line = { ...(GIVING_ANSWERS.giving_deposit_context as { bank_line: object }).bank_line, center_id: "center-2" };
    for (const isPlatformAdmin of [false, true]) {
      const { ctx } = setup({ isPlatformAdmin, rpc: { giving_deposit_context: context({ bank_line: line }) } });
      expect(await runCommand(ctx, "giving.match_deposit", args)).toMatchObject({
        ok: false,
        error: "That bank line belongs to a different community than the one you are working in, so nothing can be matched from here.",
      });
    }
    const deposit = CATALOG.find((c) => c.key === "giving.match_deposit")!;
    await expect(deposit.execute!(setup().ctx, { bank_line_id: LINE, payment_ids: [PAY_A, PAY_B] })).rejects.toThrow("only runs after it is confirmed on its card");
    const zelle = CATALOG.find((c) => c.key === "giving.confirm_exact_zelle_matches")!;
    await expect(zelle.execute!(setup().ctx, { report_ids: [REPORT] })).rejects.toThrow("only runs after it is confirmed on its card");
    await expect(zelle.execute!({ ...setup({ rules: {} }).ctx, proposalId: "11111111-1111-4111-8111-111111111111" }, { report_ids: [REPORT] })).rejects.toThrow("an owner has not switched it on");
  });

  it("explains any other database problem, and is not available without the permission", async () => {
    const { ctx } = setup({ failRpc: { match_deposit: { code: "42501", message: "not allowed to reconcile bank lines" } } });
    const t = asked(await runCommand(ctx, "giving.match_deposit", args));
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: false, error: "Could not match the deposit — you don't have permission to make this change." });
    expect(await runCommand(setup({ permissions: ["giving.view"] }).ctx, "giving.match_deposit", args)).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("the sentences the Bank screen and the commands share", () => {
  it("say the same thing in both places", () => {
    expect(depositTotalProblem("the chosen payments total 5000 but the deposit is 5100", "USD")).toBe(
      "Could not match the deposit — the ticked payments total $50.00 but the deposit is $51.00. They must add up exactly.",
    );
    expect(depositTotalProblem("something else", "USD")).toBeNull();
    expect(depositMatchedMessage(1)).toBe("Deposit matched to 1 recorded payment and queued for QuickBooks as one deposit.");
    expect(exactConfirmSummary({ confirmed: [], skipped: [{ report_id: "a", reason: "x" }] })).toEqual({ ok: false, message: "Nothing was confirmed: the match is no longer exact. Match it by hand." });
    expect(exactConfirmSummary({ confirmed: [{ report_id: "a", payment_id: "p", receipt_number: null }], skipped: [] })).toEqual({ ok: true, message: "Confirmed 1 Zelle." });
    expect(MEHTA).toBeTruthy();
  });
});
