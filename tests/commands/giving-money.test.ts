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

function setup(opts: { via?: CommandVia; permissions?: string[]; rules?: unknown; rpc?: Rpc; failRpc?: FakeDbOptions["failRpc"] } = {}) {
  const db = fakeDb(givingWorld({ ...GIVING_ANSWERS, ...opts.rpc }, opts.failRpc));
  const session = fakeSession({ db, permissions: opts.permissions ?? ALL, center: { ...fakeSession().center, rules: opts.rules ?? SWITCH_ON } });
  const registry = new CommandRegistry();
  for (const c of CATALOG) registry.register(c);
  const ctx = testContext({ session, registry, via: opts.via ?? "screen", minorNames: CHILDREN.full });
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

  it("records only after the person confirms, in one database call with a key made from that confirmation", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    const done = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(seen).toEqual([
      {
        p_idempotency_key: `proposal:${t.proposalId}`,
        p_household: SHAH,
        p_amount_cents: 25000,
        p_method: "check",
        p_received_on: "2026-10-04",
        p_pledge_ids: null,
        p_apply: true,
        p_check_number: "1043",
        p_envelope_number: null,
        p_memo: null,
      },
    ]);
    expect(done).toMatchObject({ ok: true, message: "Recorded $250.00 — receipt R-0042.", data: { payment_id: "pay-new", amount: "$250.00", replayed: false, unallocated_cents: 0 } });
    expect(done.ok && (done.data as { applied: unknown[] }).applied).toEqual([{ pledge_id: P1, pledge_number: "P-101", amount_cents: 25000, amount: "$250.00", closed: true }]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/giving/payments", "layout");
  });

  it("cannot record twice from one confirmation: the second press is refused before anything runs", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true });
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: false, code: "proposal_failed" });
    expect(seen).toHaveLength(1);
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

  it("says a repeat added nothing, and says when the payment was recorded but not applied", async () => {
    const again = setup({ rpc: { record_offline_payment_once: { ...paid, replayed: true } } });
    const t = asked(await runCommand(again.ctx, "giving.record_payment", ask));
    expect(await confirmProposal(again.ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true, message: "This payment was already recorded (receipt R-0042). Nothing was added." });

    const note = "The payment was recorded but not applied to pledges: applying needs the giving.manage permission, so a treasurer can apply it.";
    const volunteer = setup({ permissions: ["giving.record_offline"], rpc: { record_offline_payment_once: { ...paid, applied: [], unallocated_cents: 25000, allocation_skipped: note } } });
    const v = asked(await runCommand(volunteer.ctx, "giving.record_payment", ask));
    expect(v.preview.warnings?.join(" ")).toContain("giving.manage");
    expect(await confirmProposal(volunteer.ctx, v.proposalId, v.inputHash)).toMatchObject({ ok: true, message: `Recorded $250.00 — receipt R-0042. ${note}`, data: { unallocated: "$250.00" } });
  });

  it("passes the pledges named, or 'leave unapplied', to the database as chosen", async () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup({ rpc: { record_offline_payment_once: spy(seen, paid) } });
    const chosen = asked(await runCommand(ctx, "giving.record_payment", { ...ask, allocation: "choose", pledge_ids: `${P1}, ${P2}` }));
    await confirmProposal(ctx, chosen.proposalId, chosen.inputHash);
    const none = asked(await runCommand(ctx, "giving.record_payment", { ...ask, allocation: "none" }));
    await confirmProposal(ctx, none.proposalId, none.inputHash);
    expect(seen.map((s) => [s.p_pledge_ids, s.p_apply])).toEqual([
      [[P1, P2], true],
      [null, false],
    ]);
  });

  it("refuses what the Record payment screen refuses, before any card is shown", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "giving.record_payment", { ...ask, amount: "0" })).toMatchObject({ ok: false, error: "Could not record the payment — enter an amount greater than zero, like 251.00." });
    expect(await runCommand(ctx, "giving.record_payment", { ...ask, received_on: "2026-10-12" })).toMatchObject({
      ok: false,
      error: "Could not record the payment — the received date must be a real date, not in the future.",
    });
  });

  it("explains a database refusal next to what was being done, and never says it recorded", async () => {
    const used = "This confirmation was already used for a different payment (receipt R-0007). Nothing was recorded.";
    const { ctx } = setup({ failRpc: { record_offline_payment_once: { code: "23505", message: used } } });
    const t = asked(await runCommand(ctx, "giving.record_payment", ask));
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, error: `Could not record the payment — ${used}` });
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
