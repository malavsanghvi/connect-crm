import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Change control and readiness for the ways to pay (docs/PAYMENTS_PLAN.md §2.5 and §2.6, migration 0597): the answers of
// the three RPCs read defensively, the rules the screens check before asking, the member notice, and the server actions with
// the database and the session replaced (what is checked is what the code sends and answers).
const sessionRpc = vi.fn();
let platformAdmin = true;
let sessionState: "ok" | "signed_out" = "ok";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: async () => ({ ok: true, session: { center: { id: "00000000-0000-4000-8000-000000000001" }, db: { rpc: sessionRpc } } }),
  dbWithReason: async (session: { db: unknown }) => session.db,
  loadSession: async () =>
    sessionState === "signed_out"
      ? { status: "signed_out" }
      : { status: "ok", session: { isPlatformAdmin: platformAdmin, center: { id: "00000000-0000-4000-8000-000000000001" }, db: { rpc: sessionRpc } } },
}));

import {
  approveZelleInstructionsAction, cancelPayeeChangeAction, confirmWalletAction, decidePayeeChangeAction, requestZelleChangeAction,
} from "@/app/(app)/settings/payments/change-actions";
import { liftPauseAction, suspendPluginAction } from "@/app/(app)/platform/payments/actions";
import {
  PAYEE_NOTICE_DAYS, PAYEE_REQUEST_DAYS, parsePauses, parsePayeeQueue, parsePaymentReadiness, pauseSummary, payeeStatusView, readinessSummary,
  reasonProblem, riderPauseNote, waitingNote, waitingRequests, walletConfirmable, zelleApprovalView, zelleChange,
  type PayeeRequest, type PaymentReadiness,
} from "@/lib/payments/change-control";
import { parseMemberMethods, UNEXPECTED_SHAPE } from "@/lib/payments/plugins/view";
import { TASK_SOURCES, visibleTaskSources } from "@/lib/tasks";

const migration = readFileSync(join(__dirname, "..", "supabase", "migrations", "0597_payment_change_control.sql"), "utf8");
const ID = "11111111-1111-4111-8111-111111111111";

const request = (over: Partial<PayeeRequest> = {}): PayeeRequest => ({
  id: ID, plugin_key: "zelle", status: "pending", requested_by: "u1", requested_by_name: "Tanu Treasurer", requested_at: "2026-10-08T10:00:00Z",
  request_reason: "New address", expires_at: "2026-10-22T10:00:00Z", expired: false, decided_by_name: null, decided_at: null, decision_reason: null,
  applied_at: null, mine: false, fields: [{ field: "recipient", label: "the Zelle address", from: "old@x.example", to: "new@x.example" }], ...over,
});
const queueJson = (requests: unknown[] = [request()], over: Record<string, unknown> = {}) => ({ can_request: true, can_approve: true, requests, ...over });

describe("the numbers the screens state match the migration", () => {
  it("a request lapses after 14 days and members see the notice for 30", () => {
    expect(PAYEE_REQUEST_DAYS).toBe(14);
    expect(PAYEE_NOTICE_DAYS).toBe(30);
    expect(migration).toContain("now() + interval '14 days'");
    expect(migration).toContain("pc.applied_at > now() - interval '30 days'");
    expect(migration).toContain("'days', 30");
  });
});

describe("parsePayeeQueue", () => {
  it("reads the queue the database answers, with the names and the fields of each request", () => {
    const parsed = parsePayeeQueue(queueJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.can_approve).toBe(true);
    expect(parsed.value.requests[0]).toMatchObject({ id: ID, plugin_key: "zelle", status: "pending", mine: false });
    expect(parsed.value.requests[0].fields).toEqual([{ field: "recipient", label: "the Zelle address", from: "old@x.example", to: "new@x.example" }]);
  });

  it("is a plain error, never a guess, for a shape it does not know", () => {
    expect(parsePayeeQueue(null)).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePayeeQueue({ can_request: true, can_approve: "yes", requests: [] })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePayeeQueue(queueJson([{ ...request(), status: "approved" }]))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePayeeQueue(queueJson([{ ...request(), plugin_key: "stripe" }]))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePayeeQueue(queueJson([{ ...request(), fields: [{ field: "x" }] }]))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });

  it("lists only the requests that can still be confirmed, optionally for one plugin", () => {
    const q = parsePayeeQueue(queueJson([
      request({ id: "a" }), request({ id: "b", expired: true }), request({ id: "c", status: "applied" }), request({ id: "d", plugin_key: "paypal" }),
    ]));
    if (!q.ok) throw new Error("not parsed");
    expect(waitingRequests(q.value).map((r) => r.id)).toEqual(["a", "d"]);
    expect(waitingRequests(q.value, "paypal").map((r) => r.id)).toEqual(["d"]);
  });

  it("says in words where a request stands and who must act", () => {
    expect(payeeStatusView(request())).toEqual({ label: "Waiting for a second person", tone: "warning" });
    expect(payeeStatusView(request({ expired: true })).label).toBe("Lapsed");
    expect(payeeStatusView(request({ status: "applied" })).label).toBe("Confirmed");
    expect(payeeStatusView(request({ status: "rejected" })).label).toBe("Turned down");
    expect(payeeStatusView(request({ status: "cancelled" })).label).toBe("Withdrawn");
    expect(payeeStatusView(request({ status: "superseded" })).label).toBe("Replaced by a newer request");
    expect(waitingNote(request({ mine: true }), true)).toBe("You asked for this change, so a different person with giving.approve has to confirm it.");
    expect(waitingNote(request(), true)).toContain("You can confirm it (a fresh 2FA check and a reason) or turn it down.");
    expect(waitingNote(request(), false)).toBe("Tanu Treasurer asked for this change. A person with giving.approve confirms it.");
    expect(waitingNote(request({ expired: true }), true)).toBe("This request lapsed on 2026-10-22. Ask for the change again.");
  });
});

describe("zelleChange (mirrors app.request_payee_change)", () => {
  const current = { recipient: "give@temple.example", name: "Jain Society of Houston" };

  it("asks only for what differs, compared without regard to capital letters", () => {
    expect(zelleChange(current, { recipient: "new@temple.example", name: "Jain Society of Houston" })).toEqual({ ok: true, changes: { recipient: "new@temple.example" } });
    expect(zelleChange(current, { recipient: " GIVE@temple.example ", name: "JSH Temple" })).toEqual({ ok: true, changes: { name: "JSH Temple" } });
    expect(zelleChange(current, { recipient: "+1 713 555 0142", name: "JSH Temple" })).toEqual({ ok: true, changes: { recipient: "+1 713 555 0142", name: "JSH Temple" } });
  });

  it("leaves a name alone that is not saved yet, and says to save it in the form above when one is typed", () => {
    const noName = { recipient: "give@temple.example", name: "" };
    expect(zelleChange(noName, { recipient: "new@temple.example", name: "" })).toEqual({ ok: true, changes: { recipient: "new@temple.example" } });
    expect(zelleChange(noName, { recipient: "new@temple.example", name: "JSH Temple" })).toEqual({
      ok: false,
      error: "The name shown in Zelle is not saved yet. Save it in the form above; a second person is needed only to change one that is already saved.",
    });
    expect(zelleChange(noName, { recipient: "GIVE@temple.example", name: "" })).toEqual({ ok: false, error: "Change the address or the name first. Both are the same as what is saved." });
    expect(zelleChange(noName, { recipient: "", name: "" })).toEqual({ ok: false, error: "Enter the new Zelle email or phone, or put the current one back." });
  });

  it("refuses, in plain English, what the database would refuse", () => {
    expect(zelleChange(current, { recipient: "give@temple.example", name: "jain society of houston" })).toEqual({
      ok: false, error: "Change the address or the name first. Both are the same as what is saved.",
    });
    expect(zelleChange(current, { recipient: "", name: "x" })).toEqual({ ok: false, error: "Enter the new Zelle email or phone, or put the current one back." });
    expect(zelleChange(current, { recipient: "give@temple.example", name: " " })).toEqual({ ok: false, error: "Enter the new name shown in Zelle, or put the current one back." });
    expect(zelleChange(current, { recipient: "treasurer", name: "x" })).toEqual({ ok: false, error: "The Zelle recipient is an email address or a US phone number." });
    expect(zelleChange(current, { recipient: "new@temple.example", name: "x".repeat(601) })).toEqual({ ok: false, error: 'The "name" field can be at most 600 characters.' });
  });
});

describe("what a pause of Apple Pay, Google Pay or Bank debit does", () => {
  it("says plainly that it only hides them from members, because Stripe's own page chooses them", () => {
    for (const key of ["apple_pay", "google_pay", "bank_debit"]) {
      expect(riderPauseNote(key, "Apple Pay")).toContain("a pause cannot change");
      expect(riderPauseNote(key, "Apple Pay")).toContain("To stop payments through Stripe, pause Card.");
    }
    for (const key of ["card", "paypal", "zelle", "check"]) expect(riderPauseNote(key, "x")).toBeNull();
    expect(migration).toContain("pausing one of them hides it from members here");
  });
});

describe("the migration keeps what the screens promise", () => {
  it("re-checks the person who asked, withdraws a request when what it waits for goes away, and checks the bank account is still active", () => {
    expect(migration).toContain("no longer holds a role that may ask for this");
    expect(migration).toContain("create trigger payee_changes_cancel after update of status on app.center_payment_processors");
    expect(migration).toContain("create trigger payee_changes_cancel after update of accepted on app.center_payment_methods");
    expect(migration).toContain("is no longer an active account of this organization");
  });

  it("refreshes the stored plugin rows for rehearsal (test) reports only", () => {
    expect(migration).toContain("create trigger payment_plugins_sync_reports_ins after insert on app.payment_reports");
    expect(migration).toContain("for each row when (new.is_test) execute function app.payment_plugins_sync()");
    expect(migration).toContain("for each row when (old.is_test) execute function app.payment_plugins_sync()");
  });

  it("writes a generic audit reason when a pause is applied to an organization's rows (the pause reason is for platform admins)", () => {
    expect(migration.split("perform app.set_audit_context('Community Connect paused or resumed a way to pay');").length - 1).toBe(2);
  });
});

describe("reasonProblem", () => {
  it("needs a reason of at most 500 characters, and says what was being done", () => {
    expect(reasonProblem("  ", "confirm the change")).toBe("Could not confirm the change — say why. The reason is kept in the audit log.");
    expect(reasonProblem("x".repeat(501), "confirm the change")).toBe("Could not confirm the change — keep the reason under 500 characters.");
    expect(reasonProblem("Checked with the bank", "confirm the change")).toBeNull();
  });
});

const readinessJson = (over: Record<string, unknown> = {}) => ({
  ok: false, offline_only: false, environment: "production",
  plugins: [
    { key: "check", label: "Check", family: "instructions", ready: true, detail: "The instructions are filled in." },
    { key: "zelle", label: "Zelle", family: "reported_transfer", ready: false, detail: "The treasurer has not approved the Zelle instructions and matching process yet (Settings › Payments › Zelle)." },
  ],
  zelle_approval: { state: "none" }, is_treasurer: false, can_configure: true, ...over,
});

describe("parsePaymentReadiness", () => {
  it("reads every enabled way to pay with whether it is ready and what to do", () => {
    const parsed = parsePaymentReadiness(readinessJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.plugins.map((p) => [p.key, p.ready])).toEqual([["check", true], ["zelle", false]]);
    expect(parsed.value.zelle_approval).toEqual({ state: "none", approved_by_name: null, approved_at: null, note: null });
    expect(readinessSummary(parsed.value)).toBe("1 of 2 ways to pay is not ready: Zelle.");
  });

  it("is a plain error for a shape it does not know", () => {
    expect(parsePaymentReadiness(readinessJson({ environment: "moon" }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePaymentReadiness(readinessJson({ zelle_approval: { state: "maybe" } }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePaymentReadiness(readinessJson({ plugins: [{ key: "check" }] }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });

  it("summarises none, all and some", () => {
    const base = parsePaymentReadiness(readinessJson());
    if (!base.ok) throw new Error("not parsed");
    const none: PaymentReadiness = { ...base.value, plugins: [], ok: true };
    expect(readinessSummary(none)).toBe("No way to pay is switched on yet, so there is nothing to check.");
    const all: PaymentReadiness = { ...base.value, plugins: base.value.plugins.map((p) => ({ ...p, ready: true })), ok: true };
    expect(readinessSummary(all)).toBe("Every way to pay that is switched on is ready (Check, Zelle).");
    expect(readinessSummary({ ...base.value, plugins: base.value.plugins.map((p) => ({ ...p, ready: false })) })).toBe("2 of 2 ways to pay are not ready: Check, Zelle.");
  });

  it("names the Zelle approval and when a wallet only needs the owner's statement", () => {
    expect(zelleApprovalView({ state: "current", approved_by_name: "Tara", approved_at: null, note: null })).toEqual({ label: "Approved by the treasurer", tone: "success" });
    expect(zelleApprovalView({ state: "changed", approved_by_name: "Tara", approved_at: null, note: null }).label).toBe("Changed since it was approved");
    expect(zelleApprovalView({ state: "none", approved_by_name: null, approved_at: null, note: null }).label).toBe("Not approved yet");
    const wallet = { key: "apple_pay", label: "Apple Pay", family: "provider_checkout", ready: false, detail: "Turn Apple Pay on in your Stripe payment settings, then say so." };
    expect(walletConfirmable(wallet)).toBe(true);
    expect(walletConfirmable({ ...wallet, ready: true })).toBe(false);
    expect(walletConfirmable({ ...wallet, detail: "Card is not ready yet. Run the $1 live test (Card › Run the $1 test)." })).toBe(false);
    expect(walletConfirmable({ ...wallet, detail: "Community Connect has paused Apple Pay for now." })).toBe(false);
  });
});

describe("parsePauses", () => {
  const pauses = {
    plugins: [
      { key: "card", label: "Card", family: "provider_checkout", status: "suspended",
        platform_pause: { id: "p1", reason: "Stripe outage", at: "2026-10-08T10:00:00Z", by: "pat@cc.example" }, centers: [] },
      { key: "zelle", label: "Zelle", family: "reported_transfer", status: "available", platform_pause: null,
        centers: [{ id: "p2", center_id: "c1", center_name: "Houston", slug: "jsh", reason: "Bank problem", at: "2026-10-08T10:00:00Z", by: null }] },
      { key: "check", label: "Check", family: "instructions", status: "available", platform_pause: null, centers: [] },
    ],
    history: [{ id: "p1", plugin_key: "card", platform_wide: true, center_name: null, reason: "Stripe outage", suspended_at: "2026-10-08T10:00:00Z",
                suspended_by: "pat@cc.example", lifted_at: null, lift_reason: null, lifted_by: null }],
    centers: [{ id: "c1", name: "Houston", slug: "jsh", environment: "production" }],
  };

  it("reads the pauses, the history and the communities, and says what is paused", () => {
    const parsed = parsePauses(pauses);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.plugins.map(pauseSummary)).toEqual(["Paused for every community", "Paused for Houston", "Running"]);
    expect(parsed.value.history[0]).toMatchObject({ platform_wide: true, lifted_at: null });
    expect(parsed.value.centers).toHaveLength(1);
  });

  it("is a plain error for a shape it does not know", () => {
    expect(parsePauses({ plugins: [], history: [] })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePauses({ ...pauses, plugins: [{ ...pauses.plugins[0], status: "gone" }] })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePauses({ ...pauses, history: [{ id: "x" }] })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });
});

describe("the member answer carries the dated notice", () => {
  const notice = { changed_on: "2026-10-08", days: 30, text: "The Zelle details changed on October 8, 2026. Check it before you pay." };
  const answer = (zelle: Record<string, unknown>, extra: unknown[] = []) => ({
    environment: "production", currency: "usd", online_unavailable: null,
    methods: [
      { key: "zelle", family: "reported_transfer", label: "Zelle", mode: "live", instructions: { recipient: "new@x.example", name: "JSH" },
        report: { available: true, confirmation: "ask", window_days: 10 }, sort: 30, ...zelle },
      ...extra,
    ],
  });

  it("passes it for Zelle and PayPal, and drops it from a rehearsal", () => {
    const parsed = parseMemberMethods(answer({ payee_notice: notice }, [
      { key: "paypal", family: "provider_checkout", label: "PayPal", provider: "paypal", mode: "live", wallets: [], also: [], sort: 20, payee_notice: notice },
    ]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.methods.map((m) => [m.key, "payee_notice" in m ? m.payee_notice?.days : undefined])).toEqual([["paypal", 30], ["zelle", 30]]);
    const rehearsal = parseMemberMethods(answer({ mode: "rehearsal", instructions: { name: "Sandbox: no real money moves" }, payee_notice: notice }));
    expect(rehearsal.ok && rehearsal.value.methods[0]).not.toHaveProperty("payee_notice");
  });

  it("is absent when there was no change, and an answer with a notice it cannot read is not understood", () => {
    const none = parseMemberMethods(answer({}));
    expect(none.ok && none.value.methods[0]).not.toHaveProperty("payee_notice");
    expect(parseMemberMethods(answer({ payee_notice: { changed_on: "2026-10-08" } }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });
});

describe("the Home task for the second person", () => {
  it("is shown to people who can confirm (giving.approve) and to nobody else", () => {
    const ctx = (permissions: string[]) => ({ permissions, isPlatformAdmin: false });
    expect(TASK_SOURCES.find((s) => s.key === "payee")).toMatchObject({ tag: "Payee", anyOf: ["giving.approve"], module: "giving" });
    expect(visibleTaskSources(ctx(["giving.approve"])).map((s) => s.key)).toContain("payee");
    expect(visibleTaskSources(ctx(["giving.manage", "integrations.manage"])).map((s) => s.key)).not.toContain("payee");
  });
});

beforeEach(() => {
  sessionRpc.mockReset();
  platformAdmin = true;
  sessionState = "ok";
});

describe("requestZelleChangeAction", () => {
  const current = { recipient: "give@temple.example", name: "Jain Society of Houston" };

  it("sends only what differs, with the reason", async () => {
    sessionRpc.mockResolvedValue({ data: { id: ID, status: "pending" }, error: null });
    const res = await requestZelleChangeAction(current, { recipient: "new@temple.example", name: "Jain Society of Houston" }, "  Moved to a new account ");
    expect(res.ok).toBe(true);
    expect(res.message).toContain("A different person with giving.approve has to confirm it");
    expect(sessionRpc).toHaveBeenCalledWith("request_payee_change", {
      p_center: "00000000-0000-4000-8000-000000000001", p_plugin: "zelle", p_changes: { recipient: "new@temple.example" }, p_reason: "Moved to a new account",
    });
  });

  it("refuses what the database would refuse before asking it, in plain English", async () => {
    expect((await requestZelleChangeAction(current, current, "x")).error).toBe("Could not ask for the Zelle change — Change the address or the name first. Both are the same as what is saved.");
    expect((await requestZelleChangeAction(current, { recipient: "new@temple.example", name: current.name }, " ")).error)
      .toBe("Could not ask for the Zelle change — say why. The reason is kept in the audit log.");
    expect(sessionRpc).not.toHaveBeenCalled();
  });

  it("shows the database's refusal next to what was done, logs the detail, and asks for a fresh 2FA check when the database does", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Asking to change where gifts go needs the organization owner, integrations.manage or giving.manage." } });
    expect((await requestZelleChangeAction(current, { recipient: "new@temple.example", name: current.name }, "Moved")).error)
      .toBe("Could not ask for the Zelle change — you don't have permission to make this change.");
    expect(log).toHaveBeenCalled();
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "CCSTP", message: "This needs a fresh 2FA check." } });
    expect(await requestZelleChangeAction(current, { recipient: "new@temple.example", name: current.name }, "Moved")).toMatchObject({ ok: false, stepUp: true });
    log.mockRestore();
  });
});

describe("decidePayeeChangeAction", () => {
  it("confirms or turns down with the reason, and says what happened", async () => {
    sessionRpc.mockResolvedValue({ data: { status: "applied" }, error: null });
    const yes = await decidePayeeChangeAction(ID, true, "Checked with the bank");
    expect(yes).toEqual({ ok: true, message: "Confirmed. The change took effect, and members see a dated notice for 30 days." });
    expect(sessionRpc).toHaveBeenLastCalledWith("decide_payee_change", { p_request: ID, p_approve: true, p_reason: "Checked with the bank" });
    const no = await decidePayeeChangeAction(ID, false, "Not our account");
    expect(no.message).toBe("Turned down. Nothing was changed, and the person who asked can see why.");
    expect(sessionRpc).toHaveBeenLastCalledWith("decide_payee_change", { p_request: ID, p_approve: false, p_reason: "Not our account" });
  });

  it("checks the request and the reason first, and shows the two-person refusal in plain English", async () => {
    expect((await decidePayeeChangeAction("nope", true, "x")).error).toBe("Could not confirm the change — that request was not found. Reload the page.");
    expect((await decidePayeeChangeAction(ID, false, "")).error).toBe("Could not turn the change down — say why. The reason is kept in the audit log.");
    expect(sessionRpc).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "The second approver must be a different person from the first (tanu@temple.example)." } });
    expect((await decidePayeeChangeAction(ID, true, "ok")).error)
      .toBe("Could not confirm the change — you made the first request, so the two-person rule needs a different person to approve it.");
    log.mockRestore();
  });
});

describe("cancelPayeeChangeAction, approveZelleInstructionsAction, confirmWalletAction", () => {
  it("withdraws a request with a reason", async () => {
    sessionRpc.mockResolvedValue({ data: null, error: null });
    expect(await cancelPayeeChangeAction(ID, "Asked too early")).toEqual({ ok: true, message: "Withdrawn. Nothing was changed." });
    expect(sessionRpc).toHaveBeenLastCalledWith("cancel_payee_change", { p_request: ID, p_reason: "Asked too early" });
    expect((await cancelPayeeChangeAction("x", "y")).error).toMatch(/not found/);
  });

  it("approves the Zelle instructions with an optional note, and refuses a note that is too long", async () => {
    sessionRpc.mockResolvedValue({ data: { state: "current" }, error: null });
    expect((await approveZelleInstructionsAction("  Checked against the bank letter ")).ok).toBe(true);
    expect(sessionRpc).toHaveBeenLastCalledWith("approve_zelle_instructions", { p_center: "00000000-0000-4000-8000-000000000001", p_note: "Checked against the bank letter" });
    await approveZelleInstructionsAction("");
    expect(sessionRpc).toHaveBeenLastCalledWith("approve_zelle_instructions", { p_center: "00000000-0000-4000-8000-000000000001", p_note: null });
    expect((await approveZelleInstructionsAction("x".repeat(1001))).error).toBe("Could not approve the Zelle instructions — keep the note under 1,000 characters.");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Only the treasurer approves the Zelle instructions." } });
    expect((await approveZelleInstructionsAction("")).error).toBe("Could not approve the Zelle instructions — you don't have permission to make this change.");
    log.mockRestore();
  });

  it("confirms only the two wallets, with a reason", async () => {
    sessionRpc.mockResolvedValue({ data: null, error: null });
    expect((await confirmWalletAction("apple_pay", "Turned on in the Stripe dashboard")).message).toBe(
      "Recorded: Apple Pay is turned on in your Stripe account. Community Connect cannot check that setting yet.",
    );
    expect(sessionRpc).toHaveBeenLastCalledWith("confirm_wallet_in_stripe", {
      p_center: "00000000-0000-4000-8000-000000000001", p_key: "apple_pay", p_reason: "Turned on in the Stripe dashboard",
    });
    expect((await confirmWalletAction("card", "x")).error).toBe("Could not say that Card is turned on in Stripe — only Apple Pay and Google Pay are confirmed this way.");
    expect((await confirmWalletAction("google_pay", " ")).error).toBe("Could not say that Google Pay is turned on in Stripe — say why. The reason is kept in the audit log.");
  });
});

describe("the platform pause actions", () => {
  it("pause for every community or one, with the reason, and say what a pause does", async () => {
    sessionRpc.mockResolvedValue({ data: { id: "p1" }, error: null });
    const all = await suspendPluginAction("card", null, " Stripe outage ");
    expect(all.ok).toBe(true);
    expect(all.message).toContain("Card is paused for every community.");
    expect(sessionRpc).toHaveBeenLastCalledWith("suspend_payment_plugin", { p_key: "card", p_center: null, p_reason: "Stripe outage" });
    await suspendPluginAction("zelle", ID, "Bank problem");
    expect(sessionRpc).toHaveBeenLastCalledWith("suspend_payment_plugin", { p_key: "zelle", p_center: ID, p_reason: "Bank problem" });
    const back = await liftPauseAction("card", null, "Stripe is back");
    expect(back).toEqual({ ok: true, message: "Card is resumed for every community." });
    expect(sessionRpc).toHaveBeenLastCalledWith("lift_payment_plugin_suspension", { p_key: "card", p_center: null, p_reason: "Stripe is back" });
  });

  it("is for platform admins only, before the database is asked", async () => {
    platformAdmin = false;
    expect((await suspendPluginAction("card", null, "x")).error).toBe("Could not pause Card — only Community Connect platform admins can do this.");
    expect((await liftPauseAction("card", null, "x")).error).toBe("Could not resume Card — only Community Connect platform admins can do this.");
    platformAdmin = true;
    sessionState = "signed_out";
    expect((await suspendPluginAction("card", null, "x")).error).toBe("Could not pause Card — your session has expired. Sign in again.");
    expect(sessionRpc).not.toHaveBeenCalled();
  });

  it("checks the plugin, the community and the reason first, and shows the database's refusal in plain English", async () => {
    expect((await suspendPluginAction("venmo_direct", null, "x")).error).toBe("Could not pause venmo direct — that is not a payment method Community Connect offers.");
    expect((await suspendPluginAction("card", "not-a-uuid", "x")).error).toBe("Could not pause Card — choose a community from the list, or every community.");
    expect((await suspendPluginAction("card", null, "")).error).toBe("Could not pause Card — say why. The reason is kept in the audit log.");
    expect(sessionRpc).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Card is already paused for every community." } });
    expect((await suspendPluginAction("card", null, "again")).error).toBe("Could not pause Card — Card is already paused for every community.");
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "CCSTP", message: "This needs a fresh 2FA check." } });
    expect(await suspendPluginAction("card", null, "again")).toMatchObject({ ok: false, stepUp: true });
    log.mockRestore();
  });
});
