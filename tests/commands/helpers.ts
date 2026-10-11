// Shared test pieces for the command layer: a fake signed-in session, a fake database that answers like the Supabase client for the
// few calls the commands make, and a small community with children in it (the child check runs against it).

import { InMemoryProposalStore } from "@/lib/commands/proposals";
import { CommandRegistry } from "@/lib/commands/registry";
import type { CommandContext, CommandVia } from "@/lib/commands/types";
import type { CrmSession } from "@/lib/session";

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };

export type FakeDbOptions = {
  tables?: Record<string, Row[]>;
  /** rpc name → answer (the data, or a function of the arguments). */
  rpc?: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>;
  /** table name → the error every query on it returns. */
  failTables?: Record<string, DbError>;
  /** table name → the error an update on it returns (reads still work). */
  failUpdates?: Record<string, DbError>;
  failRpc?: Record<string, DbError>;
};

export type FakeCall = { table: string; op: "select" | "update"; patch?: Row; ids: unknown[] };

/** A chainable stand-in for the Supabase query builder: it filters on eq/in/is/neq/gte/lte/gt and ignores the rest. */
export function fakeDb(opts: FakeDbOptions = {}) {
  const calls: FakeCall[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  function from(table: string) {
    const state = { rows: [...(opts.tables?.[table] ?? [])], op: "select" as "select" | "update", patch: undefined as Row | undefined, single: false, head: false, count: false };
    const filter = (fn: (r: Row) => boolean) => {
      state.rows = state.rows.filter(fn);
      return builder;
    };
    const finish = () => {
      const failure = opts.failTables?.[table];
      if (failure) return { data: null, error: failure, count: null };
      if (state.op === "update") {
        const refused = opts.failUpdates?.[table];
        if (refused) return { data: null, error: refused, count: null };
        for (const r of state.rows) Object.assign(r, state.patch);
        calls.push({ table, op: "update", patch: state.patch, ids: state.rows.map((r) => r.id) });
        return { data: state.rows.map((r) => ({ id: r.id })), error: null, count: state.rows.length };
      }
      calls.push({ table, op: "select", ids: state.rows.map((r) => r.id) });
      return { data: state.head ? null : state.single ? (state.rows[0] ?? null) : state.rows, error: null, count: state.count ? state.rows.length : null };
    };
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(finish()).then(resolve, reject);
          switch (prop) {
            case "select":
              return (_cols?: string, o?: { count?: string; head?: boolean }) => {
                if (o?.count) state.count = true;
                if (o?.head) state.head = true;
                return builder;
              };
            case "update":
              return (patch: Row) => {
                state.op = "update";
                state.patch = patch;
                return builder;
              };
            case "maybeSingle":
            case "single":
              return () => {
                state.single = true;
                return builder;
              };
            case "eq":
              return (col: string, val: unknown) => filter((r) => r[col] === val);
            case "neq":
              return (col: string, val: unknown) => filter((r) => r[col] !== val);
            case "in":
              return (col: string, vals: unknown[]) => filter((r) => vals.includes(r[col]));
            case "is":
              return (col: string, val: unknown) => filter((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
            case "gt":
              return (col: string, val: string) => filter((r) => r[col] !== null && r[col] !== undefined && String(r[col]) > val);
            case "gte":
              return (col: string, val: string) => filter((r) => r[col] !== null && r[col] !== undefined && String(r[col]) >= val);
            case "lte":
              return (col: string, val: string) => filter((r) => r[col] !== null && r[col] !== undefined && String(r[col]) <= val);
            default:
              // order, limit, range, or, ilike, not …
              return () => builder;
          }
        },
      },
    );
    return builder;
  }

  function rpc(fn: string, args: Record<string, unknown> = {}) {
    rpcCalls.push({ fn, args });
    const failure = opts.failRpc?.[fn];
    if (failure) return Promise.resolve({ data: null, error: failure });
    const answer = opts.rpc?.[fn];
    const data = typeof answer === "function" ? (answer as (a: Record<string, unknown>) => unknown)(args) : (answer ?? []);
    return Promise.resolve({ data, error: null });
  }

  return { from, rpc, calls, rpcCalls, auth: {} } as unknown as CrmSession["db"] & { calls: FakeCall[]; rpcCalls: { fn: string; args: Record<string, unknown> }[] };
}

export function fakeSession(over: Partial<Record<keyof CrmSession, unknown>> = {}): CrmSession {
  return {
    db: fakeDb(),
    userId: "user-1",
    email: "staff@example.org",
    center: {
      id: "center-1",
      slug: "jsh",
      name: "Jain Society",
      short_name: "JSH",
      time_zone: "America/Chicago",
      currency: "USD",
      branding: {},
      feature_flags: {},
      rules: {},
      status: "active",
      environment: "production",
    },
    person: { id: "person-1", name: "Staff Person", memberNumber: "1" },
    permissions: [],
    isPlatformAdmin: false,
    isOwner: false,
    roles: [{ key: "event_manager", name: "Event manager", scopeKind: "center" }],
    grants: [],
    requestId: "req-1",
    modulesOff: [],
    modulesStatus: "ok",
    aal: "aal1",
    amr: null,
    centerSource: "default",
    switchable: [],
    ...over,
  } as unknown as CrmSession;
}

export type TestContext = CommandContext & { proposals: InMemoryProposalStore; registry: CommandRegistry };

export function testContext(opts: {
  session?: CrmSession;
  via?: CommandVia;
  registry?: CommandRegistry;
  minorNames?: string[];
  now?: () => Date;
  proposals?: InMemoryProposalStore;
} = {}): TestContext {
  const now = opts.now ?? (() => new Date("2026-10-10T15:00:00Z"));
  return {
    session: opts.session ?? fakeSession(),
    via: opts.via ?? "screen",
    registry: opts.registry ?? new CommandRegistry(),
    proposals: opts.proposals ?? new InMemoryProposalStore({ now }),
    minors: { namesOfMinors: async () => opts.minorNames ?? [] },
    now,
  };
}

// ---------------------------------------------------------------------------
// A community with children in it
// ---------------------------------------------------------------------------
export const CHILDREN = {
  full: ["Zoya Shah", "Aarav Patel", "Tia Mehta"],
  first: ["Zoya", "Aarav", "Tia"],
};

export function communityWithChildren(): Required<Pick<FakeDbOptions, "tables" | "rpc">> & FakeDbOptions {
  const center_id = "center-1";
  const households = [
    { id: "hh-shah", center_id, display_name: "Shah, Priya, Rahul & Zoya", household_number: "H-1001", merged_into_id: null },
    { id: "hh-patel", center_id, display_name: "Patel family", household_number: "H-1002", merged_into_id: null },
    { id: "hh-mehta", center_id, display_name: "Mehta, Anita", household_number: "H-1003", merged_into_id: null },
  ];
  const people = [
    { id: "p-priya", center_id, first_name: "Priya", last_name: "Shah", preferred_name: null, date_of_birth: "1984-03-02", merged_into_id: null },
    { id: "p-rahul", center_id, first_name: "Rahul", last_name: "Shah", preferred_name: null, date_of_birth: "1982-07-19", merged_into_id: null },
    { id: "p-zoya", center_id, first_name: "Zoya", last_name: "Shah", preferred_name: null, date_of_birth: "2018-05-05", merged_into_id: null },
    { id: "p-nikhil", center_id, first_name: "Nikhil", last_name: "Patel", preferred_name: null, date_of_birth: "1979-01-30", merged_into_id: null },
    // A child with no birth date on file: the household role says child.
    { id: "p-aarav", center_id, first_name: "Aarav", last_name: "Patel", preferred_name: null, date_of_birth: null, merged_into_id: null },
    { id: "p-anita", center_id, first_name: "Anita", last_name: "Mehta", preferred_name: null, date_of_birth: "1990-11-11", merged_into_id: null },
    // A teenager who is 17 today.
    { id: "p-tia", center_id, first_name: "Tia", last_name: "Mehta", preferred_name: null, date_of_birth: "2009-10-11", merged_into_id: null },
  ];
  const household_members = [
    { household_id: "hh-shah", person_id: "p-priya", center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: "hh-shah", person_id: "p-rahul", center_id, role: "spouse", is_primary: false, left_at: null },
    { household_id: "hh-shah", person_id: "p-zoya", center_id, role: "child", is_primary: false, left_at: null },
    { household_id: "hh-patel", person_id: "p-nikhil", center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: "hh-patel", person_id: "p-aarav", center_id, role: "child", is_primary: false, left_at: null },
    { household_id: "hh-mehta", person_id: "p-anita", center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: "hh-mehta", person_id: "p-tia", center_id, role: "child", is_primary: false, left_at: null },
  ];
  // What app.household_card returns: every member's first name in `members`, children included.
  const cards: Record<string, Row> = {
    "hh-shah": { household_id: "hh-shah", household_name: "Shah, Priya, Rahul & Zoya", household_number: "H-1001", org_household_id: "2041", members: "Priya, Rahul, Zoya", primary_member: "Priya Shah", primary_org_member_id: "0417", zone: "North", city: "Naperville", last_gift_on: "2026-09-14", open_pledge_cents: 250000 },
    "hh-patel": { household_id: "hh-patel", household_name: "Patel family", household_number: "H-1002", org_household_id: "2042", members: "Nikhil, Aarav", primary_member: "Nikhil Patel", primary_org_member_id: "0418", zone: "South", city: "Lisle", last_gift_on: null, open_pledge_cents: 0 },
    "hh-mehta": { household_id: "hh-mehta", household_name: "Mehta, Anita", household_number: "H-1003", org_household_id: "2043", members: "Anita, Tia", primary_member: "Anita Mehta", primary_org_member_id: "0419", zone: "West", city: "Wheaton", last_gift_on: "2026-08-01", open_pledge_cents: 4500 },
  };
  const pledges = [
    { id: "pl-1", center_id, household_id: "hh-shah", amount_cents: 500000, paid_cents: 250000, pledged_at: "2026-01-10T12:00:00Z", due_on: "2026-06-30", status: "partially_paid" },
    { id: "pl-2", center_id, household_id: "hh-mehta", amount_cents: 4500, paid_cents: 0, pledged_at: "2026-08-20T12:00:00Z", due_on: null, status: "open" },
    { id: "pl-3", center_id, household_id: "hh-patel", amount_cents: 10000, paid_cents: 0, pledged_at: "2026-10-01T12:00:00Z", due_on: "2026-12-01", status: "open" },
  ];
  const events = [
    { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001", center_id, event_number: "EV-12", name: "Diwali Dinner", status: "published", starts_at: "2026-10-24T23:30:00Z", ends_at: "2026-10-25T02:00:00Z", venue: "Main Hall", description: "Dinner and aarti", audience: "members_and_guests", capacity: 300, rsvp_opens_at: null, rsvp_closes_at: null, confirmation_hours_before: 24, waitlist_enabled: true },
    { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1002", center_id, event_number: "EV-13", name: "Garba Night", status: "published", starts_at: "2026-10-17T00:00:00Z", ends_at: null, venue: null, description: null, audience: "public", capacity: null, rsvp_opens_at: null, rsvp_closes_at: null, confirmation_hours_before: 24, waitlist_enabled: false },
    { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1003", center_id, event_number: "EV-14", name: "Old Picnic", status: "completed", starts_at: "2026-06-01T17:00:00Z", ends_at: null, venue: "Park", description: null, audience: "members_only", capacity: 50, rsvp_opens_at: null, rsvp_closes_at: null, confirmation_hours_before: 24, waitlist_enabled: false },
    { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1004", center_id, event_number: "EV-15", name: "Cancelled Quiz", status: "cancelled", starts_at: "2026-10-20T17:00:00Z", ends_at: null, venue: null, description: null, audience: "members_only", capacity: 50, rsvp_opens_at: null, rsvp_closes_at: null, confirmation_hours_before: 24, waitlist_enabled: false },
  ];
  return {
    tables: { households, people, household_members, pledges, events, message_templates: [] as Row[], accounting_periods: [] as Row[], ledger_postings: [] as Row[] },
    rpc: {
      household_card: (a: Record<string, unknown>) => (cards[String(a.p_household)] ? [cards[String(a.p_household)]] : []),
      resolve_identifier: [],
      flagged_refund_count: 0,
    },
  };
}
