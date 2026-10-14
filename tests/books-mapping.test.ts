import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Books › Account mapping (migration 0779, docs/FUND_ACCOUNT_MAPPING_GAPS.md; rebuilt from the parked crm #110): the answers
// of the overview and waiting RPCs read defensively, the words the screens use (no fresh 2FA code: owner rule 2026-10-13),
// the checks before asking, the exception queue's hint, the Home and Today task, the Books view, the fallback lists that
// mirror the database's catalog, and the server actions with the database and the session replaced.
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
import {
  changeInputProblem, changeLine, choicesFor, decisionReasonProblem, MAPPING_REQUEST_DAYS, mappingStatusView, mappingTaskTitle, needsMappingView,
  parseMappingOverview, parseMappingWaiting, roleStateView, waitingFor, waitingNote, waitingRequests, type MappingRequest, type MappingRole,
} from "@/lib/books/mapping";
import { booksViewOrder } from "@/lib/books/views";
import { classifyQboException } from "@/lib/giving";
import { buildQueue, type TodayCan, type TodayContext, type TodayInput } from "@/lib/giving-today/queue";
import { QBO_PURPOSES } from "@/lib/labels";
import { UNEXPECTED_SHAPE } from "@/lib/payments/plugins/view";
import { ACCESS, NAV } from "@/lib/permissions";
import { PURPOSE_TYPES } from "@/lib/qbo/setup";
import { GIVING_TASK_SOURCES, makeTask, TASK_SOURCES, visibleTaskSources } from "@/lib/tasks";

const migration = readFileSync(join(__dirname, "..", "supabase", "migrations", "0779_fund_account_mapping.sql"), "utf8").replace(/\r\n/g, "\n");
const CENTER = "00000000-0000-4000-8000-000000000001";
const ID = "11111111-1111-4111-8111-111111111111";
const FUND = "22222222-2222-4222-8222-222222222222";

const request = (over: Partial<MappingRequest> = {}): MappingRequest => ({
  id: ID, subject: "role", target_key: "income.membership", target_label: "Membership dues income", from_ref: null, from_name: null, to_ref: "13",
  to_name: "Dues Income", to_type: "Income", mode: "request", status: "pending", expired: false, requested_by: "u1",
  requested_by_name: "Tanu Treasurer", requested_at: "2026-10-08T10:00:00Z", request_reason: "Dues have their own account",
  expires_at: "2026-10-22T10:00:00Z", decided_by_name: null, cancelled_by_name: null, decided_at: null, decision_reason: null,
  applied_at: null, queued_postings: null, requeued_postings: null, mine: false, ...over,
});
const role = (over: Partial<MappingRole> = {}): MappingRole => ({
  key: "income.membership", label: "Membership dues income", kind: "fund", hint: "Membership fees (dues)", account_types: ["Income", "Other Income"],
  needs_item: true, required: false, used: 0, waiting_postings: 0, account_id: null, mapped_account_id: null, account_name: null,
  account_type: null, approved: false, problem: "Membership dues income has no QuickBooks account yet. Choose one in Account mapping.", ...over,
});
// What app.account_mapping_overview answers (keys as jsonb_build_object writes them; nulls included).
const overviewJson = (over: Record<string, unknown> = {}) => ({
  in_use: true, can_request: true, can_approve: true,
  connection: { id: "c1", provider: "quickbooks_online", status: "connected", realm_id: "R83A", display_name: "Club books", read_only: false, basis: "cash" },
  mapping_approved_at: "2026-10-01T10:00:00Z", mapping_approved_by_name: "Tanu Treasurer",
  roles: [
    role(),
    { ...role({ key: "income.general", label: "General donations income", required: true, account_id: "1", mapped_account_id: "1", account_name: "Donations",
      account_type: "Income", approved: true, problem: null }) },
    { ...role({ key: "payment_clearing", label: "Payment clearing", kind: "role", used: null, account_types: ["Bank", "Other Current Asset"], needs_item: false }) },
  ],
  funds: [{ found: true, id: FUND, key: "building", name: "Building fund", restricted: true, class_id: "33", mapped_class_id: "33", class_name: "Building",
    problem: null, waiting_postings: 0 }],
  bank_accounts: [{ found: true, id: "33333333-3333-4333-8333-333333333333", name: "Savings", last4: "8302", account_id: null, mapped_account_id: null,
    account_name: null, uses_main_bank: false, problem: "The bank account \"Savings\" has no QuickBooks account of its own…", waiting_postings: 1 }],
  requests: [request(), request({ id: "s1", mode: "setup", status: "applied", target_key: "income.general", target_label: "General donations income",
    to_ref: "1", to_name: "Donations", applied_at: "2026-09-30T10:00:00Z", expires_at: null })],
  ...over,
});

describe("the numbers and rules the screens state match the migration", () => {
  it("a request lapses after 14 days", () => {
    expect(MAPPING_REQUEST_DAYS).toBe(14);
    expect(migration).toContain("now() + interval '14 days'");
  });

  it("asks for no fresh 2FA code (owner rule 2026-10-13)", () => {
    expect(migration).not.toMatch(/perform app\.assert_step_up/);
    expect(waitingNote(request(), true)).not.toMatch(/2FA/);
  });
});

describe("parseMappingOverview", () => {
  it("reads what the database answers: roles, funds, bank accounts, requests and who may do what", () => {
    const parsed = parseMappingOverview(overviewJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.in_use).toBe(true);
    expect(parsed.value.connection).toMatchObject({ realm_id: "R83A", read_only: false });
    expect(parsed.value.roles.map((r) => r.key)).toEqual(["income.membership", "income.general", "payment_clearing"]);
    expect(parsed.value.funds[0]).toMatchObject({ key: "building", class_id: "33", restricted: true });
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
    expect(waitingNote(request(), true)).toBe("Tanu Treasurer asked for this change. You can confirm it or turn it down, with a reason.");
    expect(waitingNote(request(), false)).toBe("Tanu Treasurer asked for this change. A person with giving.approve confirms it.");
    expect(waitingNote(request({ expired: true }), true)).toBe("This request lapsed on 2026-10-22. Ask for the change again.");
  });

  it("writes old → new with words for an empty side, and the second person's task", () => {
    expect(changeLine(request())).toBe("nothing → Dues Income");
    expect(changeLine(request({ from_name: "Donations", to_name: "Donations 2027" }))).toBe("Donations → Donations 2027");
    expect(changeLine(request({ subject: "fund_class", from_name: "General", to_ref: null, to_name: null }))).toBe("General → no class");
    expect(changeLine(request({ subject: "bank_account", to_ref: "22", to_name: null }))).toBe("the main bank account → id 22");
    expect(mappingTaskTitle(request())).toBe("Confirm a QuickBooks mapping change: Membership dues income, nothing → Dues Income");
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
      { qbo_id: "1", name: "Dues Income", fully_qualified_name: "Dues Income", account_type: "Income", active: true },
      { qbo_id: "3", name: "Old Income", account_type: "Income", active: false },
      { qbo_id: "4", name: "Checking", account_type: "Bank", active: true },
    ];
    expect(choicesFor(["Income", "Other Income"], accounts).map((a) => a.qbo_id)).toEqual(["2", "1"]);
    expect(choicesFor(["Bank"], accounts).map((a) => a.qbo_id)).toEqual(["4"]);
  });

  it("checks what was typed the way the database will, before asking it", () => {
    const ok = { subject: "role", target: "income.membership", to: "13", reason: "Dues have their own account", inUse: true };
    expect(changeInputProblem(ok, "ask to change Membership dues income")).toBeNull();
    expect(changeInputProblem({ ...ok, reason: " " }, "ask to change Membership dues income")).toBe(
      "Could not ask to change Membership dues income — say why. The reason is kept in the audit log and the second person sees it.");
    expect(changeInputProblem({ ...ok, reason: "", inUse: false }, "choose Membership dues income")).toBeNull();
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
    expect(needsMappingView("role:refunds")).toBe("Waits for a QuickBooks account. It goes back in the queue by itself once the account is confirmed.");
    expect(needsMappingView(`fund_class:${FUND}`)).toContain("fund's QuickBooks class");
    expect(needsMappingView("bank_account:x")).toContain("bank account's QuickBooks account");
    expect(needsMappingView(null)).toBeNull();
    expect(needsMappingView("nonsense")).toBeNull();
    const x = classifyQboException("Membership dues income has no QuickBooks account yet.", [
      { purpose: "income.membership", label: "Membership dues income", mapped: false, approved: false },
    ], "role:income.membership");
    expect(x.applyPurpose).toBeNull();
    expect(x.fix).toContain("goes back in the queue by itself");
    expect(x.fix).toContain("Books › Account mapping");
  });
});

describe("the lists that mirror the database's catalog (app.account_roles)", () => {
  // ('income.general', 'fund', 'General donations income', 'hint', array['Income','Other Income'], '{}', true, 'always', null, 'always', 10)
  const rows = [...migration.matchAll(/\('([a-z_.]+)',\s+'(fund|role)', '([^']+)', '[^']*', array\[([^\]]*)\], (?:'\{\}'|array\[[^\]]*\]), (?:true|false), '[a-z]+', (null|'[a-z_]+'), '(always|mapped)'/g)]
    .map((m) => ({ key: m[1], label: m[3], types: m[4].split(",").map((t) => t.trim().replace(/^'|'$/g, "")), module: m[5] === "null" ? null : m[5].replace(/'/g, ""), listed: m[6] }));

  it("has every role of the catalog with the same account types, and the same label where no module names it", () => {
    expect(rows.length).toBe(22);
    for (const r of rows) {
      expect(PURPOSE_TYPES[r.key], r.key).toEqual(r.types);
      const fallback = QBO_PURPOSES.find((p) => p.purpose === r.key);
      expect(fallback, r.key).toBeDefined();
      if (!r.label.includes("{module}")) expect(fallback?.label, r.key).toBe(r.label);
    }
    expect(QBO_PURPOSES).toHaveLength(rows.length);
  });

  it("names a module's roles with the module's name in the kind, and lists a role nothing posts to only where it was chosen", () => {
    expect(rows.filter((r) => r.label.includes("{module}")).map((r) => [r.key, r.module])).toEqual([
      ["income.boli", "bolis"], ["income.pathshala", "pathshala"], ["income.store", "store"], ["store.sales", "store"], ["store.gift_packing", "store"], ["store.cost", "store"],
    ]);
    expect(rows.filter((r) => r.listed === "mapped").map((r) => r.key)).toEqual(["income.jeevdaya"]);
    // Nothing a community sees without the module carries a tradition's word.
    const seen = rows.filter((r) => r.listed === "always" && !r.module);
    for (const r of seen) expect(r.label, r.key).not.toMatch(/boli|pathshala|jeevdaya|temple|pujan|labh|satvik/i);
    for (const p of QBO_PURPOSES) expect(p.hint, p.purpose).not.toMatch(/temple|pujan|labh|satvik/i);
  });
});

describe("where the screen lives and who sees the task", () => {
  it("is a Books view (an Accounting tab in the classic look) for the QuickBooks readers; the second person opens it from the task", () => {
    expect(ACCESS.qboMapping).toEqual(["accounting.manage", "giving.approve", "giving.view", "integrations.view", "integrations.manage"]);
    const accounting = NAV.find((m) => m.key === "accounting");
    // The tab follows QuickBooks setup's readers, so a second approver who holds only giving.approve keeps Today alone (owner,
    // 2026-10-12) and reaches the page from the task; the page itself lets them in (qboMapping).
    expect(accounting?.tabs.find((t) => t.href === "/accounting/qbo/mapping")?.access).toBe("qbo");
    expect(booksViewOrder(accounting?.tabs ?? []).map((t) => t.href)).toEqual([
      "/accounting/close", "/accounting/qbo", "/accounting/qbo/mapping", "/accounting/qbo/matching", "/accounting/qbo/setup",
    ]);
  });

  it("asks only holders of giving.approve, in the Accounting module, and belongs to Giving's Today", () => {
    expect(TASK_SOURCES.find((s) => s.key === "mapping")).toMatchObject({ tag: "Mapping", anyOf: ["giving.approve"], module: "accounting", href: "/accounting/qbo/mapping" });
    expect(visibleTaskSources({ permissions: ["giving.approve"], isPlatformAdmin: false }).map((s) => s.key)).toContain("mapping");
    expect(visibleTaskSources({ permissions: ["accounting.manage"], isPlatformAdmin: false }).map((s) => s.key)).not.toContain("mapping");
    expect(GIVING_TASK_SOURCES).toContain("mapping");
  });

  it("shows on Today under Books with its Review link", () => {
    const NONE: TodayCan = { approve: false, manage: false, bankConfirm: false, allocate: false, countRecord: false, closeManage: false };
    const ctx: TodayContext = {
      can: { ...NONE, approve: true },
      currency: "USD",
      locale: "en-US",
      timeZone: "America/Chicago",
      today: "2026-10-12",
      labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
      countsWord: "Cash counts",
      zelleWord: "Zelle",
      visible: { approvals: true, bank: false, pledges: false, counts: false, books: false },
    };
    const task = makeTask("mapping", ID, mappingTaskTitle(request()), "Asked by Tanu Treasurer · Dues have their own account", [
      { label: "Review", href: "/accounting/qbo/mapping#waiting" },
    ]);
    const input: TodayInput = { tasks: [task], taskFailures: [], families: {}, bank: null, behind: null, apply: null, counts: null, close: null };
    const q = buildQueue(input, ctx);
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0]).toMatchObject({ group: "books", title: mappingTaskTitle(request()), count: 1 });
    expect(q.rows[0].acts).toEqual([{ kind: "link", href: "/accounting/qbo/mapping#waiting", label: "Review", primary: true }]);
    expect(q.tiles.find((t) => t.key === "books")?.count).toBe(1);
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
    const res = await requestMappingChangeAction(null, form({ subject: "role", target: "income.membership", to: "13", label: "Membership dues income", in_use: "1", reason: " Own account " }));
    expect(res).toEqual({ ok: true, message: "Asked. A different person with giving.approve has to confirm it; until then postings keep using the current account." });
    expect(sessionRpc).toHaveBeenCalledWith("request_account_mapping_change", {
      p_center: CENTER, p_subject: "role", p_target: "income.membership", p_to: "13", p_reason: "Own account",
    });
  });

  it("saves a setup choice at once, with a reason of its own when none is typed, and sends no class as null", async () => {
    sessionRpc.mockResolvedValue({ data: { id: ID, status: "applied", mode: "setup", to_name: null }, error: null });
    const res = await requestMappingChangeAction(null, form({ subject: "fund_class", target: FUND, to: "", label: 'the class of the fund "Building fund"', in_use: "0", reason: "" }));
    expect(res.message).toBe('the class of the fund "Building fund" → no class. Approve the mapping again before anything posts with it.');
    expect(sessionRpc).toHaveBeenCalledWith("request_account_mapping_change", {
      p_center: CENTER, p_subject: "fund_class", p_target: FUND, p_to: null, p_reason: 'Chose the class of the fund "Building fund" during setup',
    });
  });

  it("refuses what the database would refuse before asking it, and shows its refusals in plain English", async () => {
    expect((await requestMappingChangeAction(null, form({ subject: "role", target: "income.membership", to: "13", label: "Membership dues income", in_use: "1", reason: "" }))).error)
      .toBe("Could not ask to change Membership dues income — say why. The reason is kept in the audit log and the second person sees it.");
    expect((await requestMappingChangeAction(null, form({ subject: "fund_class", target: "not-an-id", to: "", label: "x", in_use: "1", reason: "r" }))).error)
      .toBe("Could not ask to change x — it was not found. Reload the page.");
    expect(sessionRpc).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: '"Office Supplies" is a Expense account; the account for Membership dues income needs one of: Income, Other Income.' } });
    expect((await requestMappingChangeAction(null, form({ subject: "role", target: "income.membership", to: "9", label: "Membership dues income", in_use: "1", reason: "r" }))).error)
      .toBe('Could not ask to change Membership dues income — "Office Supplies" is a Expense account; the account for Membership dues income needs one of: Income, Other Income.');
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
  it("records a setup choice in the history, in the words the screen showed", async () => {
    sessionRpc.mockImplementation(async (fn: string) =>
      fn === "account_mapping_in_use" ? { data: false, error: null } : { data: { status: "applied", mode: "setup", to_name: "Donations" }, error: null });
    const res = await saveQboMappingAction(null, form({ purpose: "income.general", qbo_account_id: "1" }));
    expect(res.message).toBe("General donations income → Donations. Approve the mapping again before anything posts with it.");
    expect(sessionRpc).toHaveBeenLastCalledWith("request_account_mapping_change", {
      p_center: CENTER, p_subject: "role", p_target: "income.general", p_to: "1", p_reason: "Chose the QuickBooks account for General donations income",
    });
    const own = await saveQboMappingAction(null, form({ purpose: "store.sales", label: "Club shop sales", qbo_account_id: "7" }));
    expect(own.message).toBe("Club shop sales → Donations. Approve the mapping again before anything posts with it.");
    const cls = await saveFundClassAction(null, form({ fund_id: FUND, qbo_class_id: "" }));
    expect(cls.message).toBe("Class saved. Approve the mapping again before anything posts with it.");
    expect(sessionRpc).toHaveBeenLastCalledWith("request_account_mapping_change", {
      p_center: CENTER, p_subject: "fund_class", p_target: FUND, p_to: null, p_reason: "Cleared the fund's QuickBooks class",
    });
  });

  it("refuses once the mapping is in use and sends the person to Account mapping; a failed check is shown, not guessed", async () => {
    sessionRpc.mockImplementation(async () => ({ data: true, error: null }));
    const res = await saveQboMappingAction(null, form({ purpose: "income.general", qbo_account_id: "15" }));
    expect(res.error).toBe("Could not map General donations income — the mapping is in use, so a change needs a second person. Ask for it in Books › Account mapping; a different person with giving.approve confirms it.");
    expect(sessionRpc).not.toHaveBeenCalledWith("request_account_mapping_change", expect.anything());
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockImplementation(async () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));
    const failed = await saveQboMappingAction(null, form({ purpose: "income.general", qbo_account_id: "15" }));
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/^Could not map General donations income — /);
    log.mockRestore();
  });
});
