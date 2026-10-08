import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Accounting › Account mapping (migration 0606, docs/FUND_ACCOUNT_MAPPING_GAPS.md): the answers of the overview and
// waiting RPCs read defensively, the words the screens use, the checks before asking, the exception queue's hint, the
// Home task, the lists that mirror the database's catalog, and the server actions with the database and the session
// replaced (what is checked is what the code sends and answers).
const sessionRpc = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// The QuickBooks setup actions also connect to Intuit; nothing here does.
vi.mock("@/lib/platform-setup/server-config", () => ({ platformEnv: async () => ({}) }));
vi.mock("@/lib/qbo/oauth", () => ({ authorizeUrl: vi.fn(), intuitPortalConfig: vi.fn(), redirectUri: vi.fn(), signState: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: async () => ({ ok: true, session: { center: { id: "00000000-0000-4000-8000-000000000001" }, db: { rpc: sessionRpc } } }),
  authorizeActionWhere: async () => ({ ok: true, session: { center: { id: "00000000-0000-4000-8000-000000000001" }, db: { rpc: sessionRpc } } }),
  dbWithReason: async (session: { db: unknown }) => session.db,
}));

import { cancelMappingChangeAction, decideMappingChangeAction, requestMappingChangeAction } from "@/app/(app)/accounting/qbo/mapping/actions";
import { saveFundClassAction, saveQboMappingAction } from "@/app/(app)/accounting/qbo/setup/actions";
import { classifyQboException } from "@/lib/giving";
import { QBO_PURPOSES } from "@/lib/labels";
import { UNEXPECTED_SHAPE } from "@/lib/payments/plugins/view";
import { ACCESS, NAV } from "@/lib/permissions";
import {
  changeInputProblem, changeLine, choicesFor, decisionReasonProblem, MAPPING_REQUEST_DAYS, mappingStatusView, needsMappingView,
  parseMappingOverview, parseMappingWaiting, roleStateView, waitingFor, waitingNote, waitingRequests, type MappingRequest, type MappingRole,
} from "@/lib/qbo/mapping";
import { PURPOSE_TYPES } from "@/lib/qbo/setup";
import { TASK_SOURCES, visibleTaskSources } from "@/lib/tasks";

const migration = readFileSync(join(__dirname, "..", "supabase", "migrations", "0606_account_mapping_change_control.sql"), "utf8");
const CENTER = "00000000-0000-4000-8000-000000000001";
const ID = "11111111-1111-4111-8111-111111111111";
const FUND = "22222222-2222-4222-8222-222222222222";

const request = (over: Partial<MappingRequest> = {}): MappingRequest => ({
  id: ID, subject: "role", target_key: "income.boli", target_label: "Boli income", from_ref: null, from_name: null, to_ref: "12",
  to_name: "Boli Income", to_type: "Income", mode: "request", status: "pending", expired: false, requested_by: "u1",
  requested_by_name: "Tanu Treasurer", requested_at: "2026-10-08T10:00:00Z", request_reason: "Bolis have their own account",
  expires_at: "2026-10-22T10:00:00Z", decided_by_name: null, cancelled_by_name: null, decided_at: null, decision_reason: null,
  applied_at: null, queued_postings: null, requeued_postings: null, mine: false, ...over,
});
const role = (over: Partial<MappingRole> = {}): MappingRole => ({
  key: "income.boli", label: "Boli income", kind: "fund", hint: "Boli pledges once paid", account_types: ["Income", "Other Income"],
  needs_item: true, required: false, used: 0, waiting_postings: 0, account_id: null, mapped_account_id: null, account_name: null,
  account_type: null, approved: false, problem: "Boli income has no QuickBooks account yet. Choose one in Accounting › Account mapping.", ...over,
});
// What app.account_mapping_overview answers (keys as jsonb_build_object writes them; nulls included).
const overviewJson = (over: Record<string, unknown> = {}) => ({
  in_use: true, can_request: true, can_approve: true,
  connection: { id: "c1", provider: "quickbooks_online", status: "connected", realm_id: "R83A", display_name: "Temple books", read_only: false, basis: "cash" },
  mapping_approved_at: "2026-10-01T10:00:00Z", mapping_approved_by_name: "Tanu Treasurer",
  roles: [
    role(),
    { ...role({ key: "income.general", label: "General donations income", required: true, account_id: "1", mapped_account_id: "1", account_name: "Donations",
      account_type: "Income", approved: true, problem: null }) },
    { ...role({ key: "payment_clearing", label: "Payment clearing", kind: "role", used: null, account_types: ["Bank", "Other Current Asset"], needs_item: false }) },
  ],
  funds: [{ found: true, id: FUND, key: "deva_dravya", name: "Deva Dravya", restricted: true, class_id: "33", mapped_class_id: "33", class_name: "Deva Dravya",
    problem: null, waiting_postings: 0 }],
  bank_accounts: [{ found: true, id: "33333333-3333-4333-8333-333333333333", name: "Chase savings", last4: "8302", account_id: null, mapped_account_id: null,
    account_name: null, uses_main_bank: false, problem: "The bank account \"Chase savings\" has no QuickBooks account of its own…", waiting_postings: 1 }],
  requests: [request(), request({ id: "s1", mode: "setup", status: "applied", target_key: "income.general", target_label: "General donations income",
    to_ref: "1", to_name: "Donations", applied_at: "2026-09-30T10:00:00Z", expires_at: null })],
  ...over,
});

describe("the numbers the screens state match the migration", () => {
  it("a request lapses after 14 days", () => {
    expect(MAPPING_REQUEST_DAYS).toBe(14);
    expect(migration).toContain("now() + interval '14 days'");
  });
});

describe("parseMappingOverview", () => {
  it("reads what the database answers: roles, funds, bank accounts, requests and who may do what", () => {
    const parsed = parseMappingOverview(overviewJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.in_use).toBe(true);
    expect(parsed.value.connection).toMatchObject({ realm_id: "R83A", read_only: false });
    expect(parsed.value.roles.map((r) => r.key)).toEqual(["income.boli", "income.general", "payment_clearing"]);
    expect(parsed.value.funds[0]).toMatchObject({ key: "deva_dravya", class_id: "33", restricted: true });
    expect(parsed.value.bank_accounts[0]).toMatchObject({ uses_main_bank: false, waiting_postings: 1 });
    expect(parsed.value.requests[1]).toMatchObject({ mode: "setup", status: "applied", expires_at: null });
  });

  it("accepts no connection and missing optional keys", () => {
    const parsed = parseMappingOverview(overviewJson({ connection: null, roles: [], funds: [], bank_accounts: [], requests: [] }));
    expect(parsed.ok && parsed.value.connection).toBeNull();
  });

  it("is a plain error, never a guess, for a shape it does not know", () => {
    expect(parseMappingOverview(null)).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseMappingOverview(overviewJson({ in_use: "yes" }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseMappingOverview(overviewJson({ roles: [{ ...role(), kind: "account" }] }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseMappingOverview(overviewJson({ requests: [{ ...request(), status: "approved" }] }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseMappingOverview(overviewJson({ requests: [{ ...request(), subject: "campaign" }] }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseMappingOverview(overviewJson({ funds: [{ id: FUND }] }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseMappingOverview(overviewJson({ connection: { id: "c1" } }))).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });
});

describe("parseMappingWaiting", () => {
  it("reads the Home list and refuses a shape it does not know", () => {
    const parsed = parseMappingWaiting({ can_approve: true, requests: [request()] });
    expect(parsed.ok && parsed.value.requests[0].id).toBe(ID);
    expect(parseMappingWaiting({ can_approve: true })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });
});

describe("what the screens say", () => {
  it("lists only what can still be confirmed, and finds the waiting request for one thing", () => {
    const list = [request({ id: "a" }), request({ id: "b", expired: true }), request({ id: "c", status: "applied" }),
      request({ id: "d", subject: "fund_class", target_key: FUND })];
    expect(waitingRequests(list).map((r) => r.id)).toEqual(["a", "d"]);
    expect(waitingFor(list, "fund_class", FUND)?.id).toBe("d");
    expect(waitingFor(list, "role", "income.general")).toBeNull();
  });

  it("says in words where a request stands and who must act", () => {
    expect(mappingStatusView(request())).toEqual({ label: "Waiting for a second person", tone: "warning" });
    expect(mappingStatusView(request({ expired: true })).label).toBe("Lapsed");
    expect(mappingStatusView(request({ status: "applied" }))).toEqual({ label: "Confirmed", tone: "success" });
    expect(mappingStatusView(request({ status: "applied", mode: "setup" })).label).toBe("Chosen during setup");
    expect(mappingStatusView(request({ status: "rejected" })).label).toBe("Turned down");
    expect(mappingStatusView(request({ status: "cancelled" })).label).toBe("Withdrawn");
    expect(mappingStatusView(request({ status: "superseded" })).label).toBe("Replaced by a newer request");
    expect(waitingNote(request({ mine: true }), true)).toBe("You asked for this change, so a different person with giving.approve has to confirm it.");
    expect(waitingNote(request(), true)).toContain("You can confirm it (a fresh 2FA check and a reason) or turn it down.");
    expect(waitingNote(request(), false)).toBe("Tanu Treasurer asked for this change. A person with giving.approve confirms it.");
    expect(waitingNote(request({ expired: true }), true)).toBe("This request lapsed on 2026-10-22. Ask for the change again.");
  });

  it("writes old → new with words for an empty side", () => {
    expect(changeLine(request())).toBe("nothing → Boli Income");
    expect(changeLine(request({ from_name: "Donations", to_name: "Donations 2027" }))).toBe("Donations → Donations 2027");
    expect(changeLine(request({ subject: "fund_class", from_name: "General", to_ref: null, to_name: null }))).toBe("General → no class");
    expect(changeLine(request({ subject: "bank_account", to_ref: "22", to_name: null }))).toBe("the main bank account → id 22");
  });

  it("names the state of a fund: in use, waiting for approval, needs a new account, or its money waits", () => {
    expect(roleStateView(role({ account_id: "12", mapped_account_id: "12", approved: true, problem: null })).label).toBe("In use");
    expect(roleStateView(role({ mapped_account_id: "12", approved: false, problem: "not approved yet" })).label).toBe("Not approved yet");
    expect(roleStateView(role({ mapped_account_id: "12", approved: true, problem: "inactive in QuickBooks" })).label).toBe("Needs a new account");
    expect(roleStateView(role({ mapped_account_id: "12", approved: false, problem: "was chosen in another QuickBooks company" })).label).toBe("Needs a new account");
    expect(roleStateView(role({ required: true }))).toEqual({ label: "Not mapped (required)", tone: "bad" });
    expect(roleStateView(role({ used: 3 }))).toEqual({ label: "Not mapped: its money waits", tone: "bad" });
    expect(roleStateView(role({ kind: "role", used: null }))).toEqual({ label: "Not mapped", tone: "muted" });
  });

  it("offers only active accounts of an accepted type, by full name", () => {
    const accounts = [
      { qbo_id: "2", name: "Zelle Income", fully_qualified_name: "Donations:Zelle Income", account_type: "Income", active: true },
      { qbo_id: "1", name: "Boli Income", fully_qualified_name: "Boli Income", account_type: "Income", active: true },
      { qbo_id: "3", name: "Old Income", account_type: "Income", active: false },
      { qbo_id: "4", name: "Chase", account_type: "Bank", active: true },
    ];
    expect(choicesFor(["Income", "Other Income"], accounts).map((a) => a.qbo_id)).toEqual(["1", "2"]);
    expect(choicesFor(["Bank"], accounts).map((a) => a.qbo_id)).toEqual(["4"]);
  });

  it("checks what was typed the way the database will, before asking it", () => {
    const ok = { subject: "role", target: "income.boli", to: "12", reason: "Bolis have their own account", inUse: true };
    expect(changeInputProblem(ok, "ask to change Boli income")).toBeNull();
    expect(changeInputProblem({ ...ok, reason: " " }, "ask to change Boli income")).toBe(
      "Could not ask to change Boli income — say why. The reason is kept in the audit log and the second person sees it.");
    expect(changeInputProblem({ ...ok, reason: "", inUse: false }, "choose Boli income")).toBeNull();
    expect(changeInputProblem({ ...ok, to: "" }, "x")).toBe("Could not x — choose an account from the list.");
    expect(changeInputProblem({ ...ok, subject: "fund_class", to: "" }, "x")).toBeNull();
    expect(changeInputProblem({ ...ok, subject: "campaign" }, "x")).toBe("Could not x — say what to change.");
    expect(changeInputProblem({ ...ok, reason: "y".repeat(501) }, "x")).toBe("Could not x — keep the reason under 500 characters.");
    expect(decisionReasonProblem("", "confirm the change")).toBe("Could not confirm the change — say why. The reason is kept in the audit log.");
    expect(decisionReasonProblem("ok", "confirm the change")).toBeNull();
  });
});

describe("the exception queue says what a posting waits for", () => {
  it("names the account and says it goes back in the queue by itself", () => {
    expect(needsMappingView("role:income.membership", { "income.membership": "Membership dues income" }))
      .toBe("Waits for the Membership dues income account. It goes back in the queue by itself once the account is confirmed.");
    expect(needsMappingView(`fund_class:${FUND}`)).toContain("fund's QuickBooks class");
    expect(needsMappingView("bank_account:x")).toContain("bank account's QuickBooks account");
    expect(needsMappingView(null)).toBeNull();
    expect(needsMappingView("nonsense")).toBeNull();
    const x = classifyQboException("Membership dues income has no QuickBooks account yet.", [
      { purpose: "income.membership", label: "Membership dues income", mapped: false, approved: false },
    ], "role:income.membership");
    expect(x.applyPurpose).toBeNull();
    expect(x.fix).toContain("goes back in the queue by itself");
    expect(x.fix).toContain("Accounting › Account mapping");
  });
});

describe("the lists that mirror the database's catalog (app.account_roles)", () => {
  // ('income.general', 'fund', 'General donations income', ... array['Income','Other Income'] ...
  const rows = [...migration.matchAll(/\('([a-z_.]+)',\s+'(fund|role)', '([^']+)', '[^']*', array\[([^\]]*)\]/g)]
    .map((m) => ({ key: m[1], label: m[3], types: m[4].split(",").map((t) => t.trim().replace(/^'|'$/g, "")) }));

  it("has every role of the catalog with the same label and account types", () => {
    expect(rows.length).toBe(22);
    for (const r of rows) {
      expect(QBO_PURPOSES.find((p) => p.purpose === r.key)?.label, r.key).toBe(r.label);
      expect(PURPOSE_TYPES[r.key], r.key).toEqual(r.types);
    }
    expect(QBO_PURPOSES).toHaveLength(rows.length);
  });
});

describe("where the screen lives and who sees the Home task", () => {
  it("is an Accounting tab readable by the QuickBooks readers and the second person", () => {
    expect(ACCESS.qboMapping).toEqual(["accounting.manage", "giving.approve", "giving.view", "integrations.view", "integrations.manage"]);
    const accounting = NAV.find((m) => m.key === "accounting");
    expect(accounting?.tabs.map((t) => t.href)).toContain("/accounting/qbo/mapping");
  });

  it("asks only holders of giving.approve, in the Accounting module", () => {
    expect(TASK_SOURCES.find((s) => s.key === "mapping")).toMatchObject({ tag: "Mapping", anyOf: ["giving.approve"], module: "accounting", href: "/accounting/qbo/mapping" });
    expect(visibleTaskSources({ permissions: ["giving.approve"], isPlatformAdmin: false }).map((s) => s.key)).toContain("mapping");
    expect(visibleTaskSources({ permissions: ["accounting.manage"], isPlatformAdmin: false }).map((s) => s.key)).not.toContain("mapping");
  });
});

beforeEach(() => {
  sessionRpc.mockReset();
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("requestMappingChangeAction", () => {
  it("asks for a change once the mapping is in use, with the reason, and says a second person confirms it", async () => {
    sessionRpc.mockResolvedValue({ data: { id: ID, status: "pending", mode: "request" }, error: null });
    const res = await requestMappingChangeAction(null, form({ subject: "role", target: "income.boli", to: "12", label: "Boli income", in_use: "1", reason: " Own account " }));
    expect(res).toEqual({ ok: true, message: "Asked. A different person with giving.approve has to confirm it; until then postings keep using the current account." });
    expect(sessionRpc).toHaveBeenCalledWith("request_account_mapping_change", {
      p_center: CENTER, p_subject: "role", p_target: "income.boli", p_to: "12", p_reason: "Own account",
    });
  });

  it("saves a setup choice at once, with a reason of its own when none is typed, and sends no class as null", async () => {
    sessionRpc.mockResolvedValue({ data: { id: ID, status: "applied", mode: "setup", to_name: null }, error: null });
    const res = await requestMappingChangeAction(null, form({ subject: "fund_class", target: FUND, to: "", label: 'the class of the fund "Deva Dravya"', in_use: "0", reason: "" }));
    expect(res.message).toBe('the class of the fund "Deva Dravya" → no class. Approve the mapping again before anything posts with it.');
    expect(sessionRpc).toHaveBeenCalledWith("request_account_mapping_change", {
      p_center: CENTER, p_subject: "fund_class", p_target: FUND, p_to: null, p_reason: 'Chose the class of the fund "Deva Dravya" during setup',
    });
  });

  it("refuses what the database would refuse before asking it, and shows its refusals in plain English", async () => {
    expect((await requestMappingChangeAction(null, form({ subject: "role", target: "income.boli", to: "12", label: "Boli income", in_use: "1", reason: "" }))).error)
      .toBe("Could not ask to change Boli income — say why. The reason is kept in the audit log and the second person sees it.");
    expect((await requestMappingChangeAction(null, form({ subject: "fund_class", target: "not-an-id", to: "", label: "x", in_use: "1", reason: "r" }))).error)
      .toBe("Could not ask to change x — it was not found. Reload the page.");
    expect(sessionRpc).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: '"Office Supplies" is a Expense account; the account for Boli income needs one of: Income, Other Income.' } });
    expect((await requestMappingChangeAction(null, form({ subject: "role", target: "income.boli", to: "9", label: "Boli income", in_use: "1", reason: "r" }))).error)
      .toBe('Could not ask to change Boli income — "Office Supplies" is a Expense account; the account for Boli income needs one of: Income, Other Income.');
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "CCSTP", message: "This needs a fresh 2FA check." } });
    expect(await requestMappingChangeAction(null, form({ subject: "role", target: "income.boli", to: "12", label: "Boli income", in_use: "1", reason: "r" })))
      .toMatchObject({ ok: false, stepUp: true });
    log.mockRestore();
  });
});

describe("decideMappingChangeAction and cancelMappingChangeAction", () => {
  it("confirms with the reason and says what happened to waiting postings", async () => {
    sessionRpc.mockResolvedValue({ data: { id: ID, status: "applied", requeued: 2, queued: 5 }, error: null });
    const yes = await decideMappingChangeAction(null, form({ request_id: ID, approve: "1", reason: "Checked with the accountant" }));
    expect(yes.message).toBe("Confirmed. Postings sent from now on use it; entries already posted keep their accounts. 2 postings that were waiting for it went back in the queue.");
    expect(sessionRpc).toHaveBeenLastCalledWith("decide_account_mapping_change", { p_request: ID, p_approve: true, p_reason: "Checked with the accountant" });
    sessionRpc.mockResolvedValue({ data: { id: ID, status: "rejected" }, error: null });
    const no = await decideMappingChangeAction(null, form({ request_id: ID, approve: "0", reason: "Wrong account" }));
    expect(no.message).toBe("Turned down. Nothing was changed, and the person who asked can see why.");
  });

  it("checks the request and the reason first, and shows the two-person refusal in plain English", async () => {
    expect((await decideMappingChangeAction(null, form({ request_id: "nope", approve: "1", reason: "x" }))).error)
      .toBe("Could not confirm the change — that request was not found. Reload the page.");
    expect((await decideMappingChangeAction(null, form({ request_id: ID, approve: "0", reason: "" }))).error)
      .toBe("Could not turn the change down — say why. The reason is kept in the audit log.");
    expect(sessionRpc).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "The second approver must be a different person from the first (Tanu Treasurer)." } });
    expect((await decideMappingChangeAction(null, form({ request_id: ID, approve: "1", reason: "x" }))).error)
      .toBe("Could not confirm the change — you made the first request, so the two-person rule needs a different person to approve it.");
    log.mockRestore();
  });

  it("withdraws with a reason", async () => {
    sessionRpc.mockResolvedValue({ data: { id: ID, status: "cancelled" }, error: null });
    expect(await cancelMappingChangeAction(null, form({ request_id: ID, reason: "Asked too early" }))).toEqual({ ok: true, message: "Withdrawn. Nothing was changed." });
    expect(sessionRpc).toHaveBeenLastCalledWith("cancel_account_mapping_change", { p_request: ID, p_reason: "Asked too early" });
    expect((await cancelMappingChangeAction(null, form({ request_id: ID, reason: " " }))).error)
      .toBe("Could not withdraw the request — say why. The reason is kept in the audit log.");
  });
});

describe("the setup step saves through the same function, and only during setup", () => {
  it("records a setup choice in the history and keeps the words of the setup screen", async () => {
    sessionRpc.mockImplementation(async (fn: string) =>
      fn === "account_mapping_in_use" ? { data: false, error: null } : { data: { status: "applied", mode: "setup", to_name: "Donations" }, error: null });
    const res = await saveQboMappingAction(null, form({ purpose: "income.general", qbo_account_id: "1" }));
    expect(res.message).toBe("General donations income → Donations. Approve the mapping again before anything posts with it.");
    expect(sessionRpc).toHaveBeenLastCalledWith("request_account_mapping_change", {
      p_center: CENTER, p_subject: "role", p_target: "income.general", p_to: "1", p_reason: "Chose the QuickBooks account for General donations income",
    });
    const cls = await saveFundClassAction(null, form({ fund_id: FUND, qbo_class_id: "" }));
    expect(cls.message).toBe("Class saved. Approve the mapping again before anything posts with it.");
    expect(sessionRpc).toHaveBeenLastCalledWith("request_account_mapping_change", {
      p_center: CENTER, p_subject: "fund_class", p_target: FUND, p_to: null, p_reason: "Cleared the fund's QuickBooks class",
    });
  });

  it("refuses once the mapping is in use and sends the person to Account mapping", async () => {
    sessionRpc.mockImplementation(async () => ({ data: true, error: null }));
    const res = await saveQboMappingAction(null, form({ purpose: "income.general", qbo_account_id: "15" }));
    expect(res.error).toBe("Could not map General donations income — the mapping is in use, so a change needs a second person. Ask for it in Accounting › Account mapping; a different person with giving.approve confirms it.");
    expect(sessionRpc).not.toHaveBeenCalledWith("request_account_mapping_change", expect.anything());
  });
});
