import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadRoutineFacts } from "@/lib/data/today";
import { LEGACY_KIND } from "@/lib/kind";
import type { CrmSession } from "@/lib/session";
import type { HomeTasks } from "@/lib/tasks";

import { ROLE_PERMISSIONS } from "./fixtures";

// A stand-in for the database client: every query is recorded, and a test says what each table answers.
type Call = { table: string; ops: [string, ...unknown[]][] };
type Answer = { data?: unknown[]; count?: number; error?: { code?: string; message: string } };
type Answers = Record<string, Answer | ((call: Call) => Answer)>;

function fakeDb(answers: Answers, rpc: Record<string, { data?: unknown; error?: { code?: string; message: string } }> = {}) {
  const calls: Call[] = [];
  const rpcCalls: string[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "gt", "gte", "lt", "lte", "order", "limit", "is", "not"]) {
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        const a = answers[table];
        const answer = typeof a === "function" ? a(call) : (a ?? {});
        return Promise.resolve(resolve({ data: answer.data ?? null, count: answer.count ?? null, error: answer.error ?? null }));
      };
      return chain;
    },
    rpc(name: string) {
      rpcCalls.push(name);
      const r = rpc[name] ?? { data: null, error: { code: "PGRST202", message: "not found" } };
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };
  return { db, calls, rpcCalls, tables: () => calls.map((c) => c.table) };
}

function session(roles: string[], db: unknown, over: Partial<CrmSession> = {}): CrmSession {
  return {
    db,
    userId: "u1",
    email: null,
    center: { id: "c1", time_zone: "America/New_York", currency: "USD", rules: {}, environment: "production" },
    person: { id: "p1", name: "Priya Mehta", memberNumber: "1" },
    roles: [],
    grants: roles.map((r) => ({ role_key: r, scope_kind: "center", scope_id: null })),
    permissions: [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))].sort(),
    isPlatformAdmin: false,
    isOwner: false,
    modulesOff: [],
    modulesStatus: "ok",
    kind: LEGACY_KIND,
    kindStatus: "ok",
    ...over,
  } as unknown as CrmSession;
}

const NO_TASKS: HomeTasks = { tasks: [], failures: [] };
const FRIDAY_NOON = new Date("2026-10-16T16:00:00Z");
const opsOf = (call: Call, op: string) => call.ops.filter((o) => o[0] === op);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FRIDAY_NOON);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("what Today counts for a treasurer", () => {
  it("reads only the counters the treasurer's routine and briefing use", async () => {
    const fake = fakeDb({
      bank_transactions: { count: 7 },
      pledges: (call) => ({ count: call.ops.some((o) => o[0] === "lt") ? 2 : 3 }),
      membership_applications: { count: 4 },
      events: { data: [{ id: "e9", name: "Diwali Dinner", starts_at: "2026-10-20T22:00:00Z" }] },
    });
    const facts = await loadRoutineFacts(
      session(["treasurer"], fake.db),
      { tasks: [{ source: "deposits" } as never], failures: [] },
    );
    expect(facts.today).toBe("2026-10-16");
    expect(facts.counts).toMatchObject({ bank_lines: 7, pledges_overdue: 2, pledges_due_week: 3, applications: 4, events_week: 1, deposits: 1, giving_approvals: 0 });
    expect(facts.events).toEqual([{ id: "e9", name: "Diwali Dinner", days: 4 }]);
    // Nothing about Pathshala is touched for a treasurer.
    expect(fake.tables().filter((t) => t.startsWith("pathshala") || t === "gyan_signoffs")).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
    expect(facts.failed).toEqual({});
  });

  it("asks for pledges that are past due before today, and those due in the next seven days", async () => {
    const fake = fakeDb({ pledges: { count: 1 } });
    await loadRoutineFacts(session(["treasurer"], fake.db), NO_TASKS);
    const pledges = fake.calls.filter((c) => c.table === "pledges");
    expect(pledges).toHaveLength(2);
    const overdue = pledges.find((c) => opsOf(c, "lt").length > 0)!;
    expect(opsOf(overdue, "lt")[0]).toEqual(["lt", "due_on", "2026-10-16"]);
    const soon = pledges.find((c) => opsOf(c, "gte").length > 0)!;
    expect(opsOf(soon, "gte")[0]).toEqual(["gte", "due_on", "2026-10-16"]);
    expect(opsOf(soon, "lte")[0]).toEqual(["lte", "due_on", "2026-10-22"]);
  });

  it("reports a counter that failed as failed, never as zero, and still counts the rest", async () => {
    const fake = fakeDb({
      bank_transactions: { error: { code: "XX000", message: "boom" } },
      pledges: { count: 0 },
    });
    const facts = await loadRoutineFacts(session(["treasurer"], fake.db), NO_TASKS);
    expect(facts.counts.bank_lines).toBeUndefined();
    expect(facts.failed.bank_lines).toMatch(/\w/);
    expect(facts.counts.pledges_overdue).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("calls a refused read 'no access' in plain English", async () => {
    const fake = fakeDb({ bank_transactions: { error: { code: "42501", message: "permission denied for table bank_transactions" } } });
    const facts = await loadRoutineFacts(session(["treasurer"], fake.db), NO_TASKS);
    expect(facts.failed.bank_lines).toBe("you don't have access to this area");
  });

  it("takes the task-list counters from the tasks already loaded, with their failures", async () => {
    const fake = fakeDb({});
    const facts = await loadRoutineFacts(session(["treasurer"], fake.db), {
      tasks: [{ source: "refund" } as never, { source: "writeoff" } as never],
      failures: [{ source: "quickbooks", tag: "QuickBooks", message: "the server did not respond" }],
    });
    expect(facts.counts.giving_approvals).toBe(2);
    expect(facts.counts.quickbooks_problems).toBeUndefined();
    expect(facts.failed.quickbooks_problems).toBe("the server did not respond");
  });

  it("leaves out counters of a module the community switched off", async () => {
    const fake = fakeDb({ bank_transactions: { count: 1 }, pledges: { count: 1 }, events: { data: [] } });
    const facts = await loadRoutineFacts(session(["treasurer"], fake.db, { modulesOff: ["giving"] }), NO_TASKS);
    expect(facts.counts.bank_lines).toBeUndefined();
    expect(facts.counts.pledges_overdue).toBeUndefined();
    expect(fake.tables()).not.toContain("bank_transactions");
    expect(fake.tables()).not.toContain("pledges");
  });
});

describe("what Today counts for a Pathshala principal", () => {
  function principalDb() {
    return fakeDb(
      {
        pathshala_terms: { data: [{ id: "t1", no_class_dates: [] }] },
        pathshala_classes: { data: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] },
        pathshala_sessions: { data: [{ id: "s1", class_id: "c1" }, { id: "s2", class_id: "c2" }] },
        pathshala_attendance: { data: [{ session_id: "s1" }, { session_id: "s1" }] },
        gyan_signoffs: { count: 3 },
      },
      { pathshala_task_counts: { data: { to_place: 4, assistance_to_decide: 1, held_for_payment: 9 } } },
    );
  }

  it("counts classes meeting today and the ones with no attendance yet, plus the queues, as numbers", async () => {
    const fake = principalDb();
    const facts = await loadRoutineFacts(session(["pathshala_principal"], fake.db), NO_TASKS);
    expect(facts.counts).toMatchObject({ classes_today: 3, attendance_missing: 2, pathshala_to_place: 4, pathshala_assistance: 1, gyan_signoffs: 3 });
    expect(fake.rpcCalls).toEqual(["pathshala_task_counts"]);
    // Friday: the class day is looked up by weekday name.
    const classes = fake.calls.find((c) => c.table === "pathshala_classes")!;
    expect(opsOf(classes, "eq")).toContainEqual(["eq", "meets_on", "friday"]);
  });

  it("counts every class as missing attendance when no class sheet is open yet", async () => {
    const fake = fakeDb({
      pathshala_terms: { data: [{ id: "t1", no_class_dates: [] }] },
      pathshala_classes: { data: [{ id: "c1" }, { id: "c2" }] },
      pathshala_sessions: { data: [] },
      gyan_signoffs: { count: 0 },
    });
    const facts = await loadRoutineFacts(session(["pathshala_principal"], fake.db), NO_TASKS);
    expect(facts.counts).toMatchObject({ classes_today: 2, attendance_missing: 2 });
    expect(fake.tables()).not.toContain("pathshala_attendance");
  });

  it("counts no classes on a day the term has no class", async () => {
    const fake = fakeDb({ pathshala_terms: { data: [{ id: "t1", no_class_dates: ["2026-10-16"] }] }, gyan_signoffs: { count: 0 } });
    const facts = await loadRoutineFacts(session(["pathshala_principal"], fake.db), NO_TASKS);
    expect(facts.counts).toMatchObject({ classes_today: 0, attendance_missing: 0 });
    expect(fake.tables()).not.toContain("pathshala_classes");
  });

  it("skips the queue counters quietly on a database that does not have the function yet", async () => {
    const fake = fakeDb({ pathshala_terms: { data: [] }, gyan_signoffs: { count: 0 } });
    const facts = await loadRoutineFacts(session(["pathshala_principal"], fake.db), NO_TASKS);
    expect(facts.counts.pathshala_to_place).toBeUndefined();
    expect(facts.failed.pathshala_to_place).toBeUndefined();
  });

  it("does not read Pathshala at all when the module is off", async () => {
    const fake = principalDb();
    await loadRoutineFacts(session(["pathshala_principal"], fake.db, { modulesOff: ["pathshala"] }), NO_TASKS);
    expect(fake.tables().filter((t) => t.startsWith("pathshala"))).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("never reads a person: no learner table, no name column, and attendance only by class day", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/data/today.ts"), "utf8");
    const tables = [...source.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(
      new Set(["membership_applications", "bank_transactions", "pledges", "gyan_signoffs", "pathshala_terms", "pathshala_classes", "pathshala_sessions", "pathshala_attendance", "events"]),
    );
    const selects = [...source.matchAll(/\.select\("([^"]*)"/g)].map((m) => m[1]);
    for (const s of selects) expect(s, s).not.toMatch(/person|student|learner|first_name|last_name|birth|enrollment|email/);
    // The only names read are event names (an event is not a person).
    expect(selects.filter((s) => /\bname\b/.test(s))).toEqual(["id, name, starts_at"]);
    expect(source).toContain('.from("pathshala_attendance").select("session_id")');
  });
});

describe("what Today counts for an event lead", () => {
  it("reads only the events they lead, and works out how many days away each is", async () => {
    const fake = fakeDb({
      events: { data: [{ id: "e1", name: "Diwali Dinner", starts_at: "2026-10-17T22:00:00Z" }, { id: "e1b", name: "Garba", starts_at: "2026-10-16T23:00:00Z" }] },
    });
    const lead = session([], fake.db, { grants: [{ role_key: "event_lead", scope_kind: "event", scope_id: "e1" }], permissions: [] });
    const facts = await loadRoutineFacts(lead, NO_TASKS);
    const call = fake.calls.find((c) => c.table === "events")!;
    expect(opsOf(call, "in")).toContainEqual(["in", "id", ["e1"]]);
    expect(facts.events).toEqual([
      { id: "e1", name: "Diwali Dinner", days: 1 },
      { id: "e1b", name: "Garba", days: 0 },
    ]);
    expect(facts.counts.events_week).toBe(2);
  });

  it("reads all upcoming events for someone who can see events centre-wide", async () => {
    const fake = fakeDb({ events: { data: [] } });
    await loadRoutineFacts(session(["treasurer"], fake.db), NO_TASKS);
    const call = fake.calls.find((c) => c.table === "events")!;
    expect(opsOf(call, "in").map((o) => o[1])).toEqual(["status"]);
  });
});
