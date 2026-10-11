// A small community for the Settings commands: roles and who holds them (some pending, some for one event, one child with a login),
// connected services, the setup checklist and the module switches. Ids the commands check are real UUIDs.

import { CATALOG } from "@/lib/commands/catalog";
import { CommandRegistry } from "@/lib/commands/registry";
import { needsSecondApprover } from "@/lib/security";
import type { CommandVia } from "@/lib/commands/types";
import type { CrmSession } from "@/lib/session";

import { communityWithChildren, fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

type Row = Record<string, unknown>;

const center_id = "center-1";

export const U = {
  admin: "a1000000-0000-4000-8000-000000000001",
  priya: "a1000000-0000-4000-8000-000000000002",
  rahul: "a1000000-0000-4000-8000-000000000003",
  nikhil: "a1000000-0000-4000-8000-000000000004",
  aarav: "a1000000-0000-4000-8000-000000000005",
  owner: "a1000000-0000-4000-8000-000000000006",
  priya2: "a1000000-0000-4000-8000-000000000007",
  nobody: "a1000000-0000-4000-8000-0000000000ff",
};
export const G = {
  priya: "c1000000-0000-4000-8000-000000000001",
  rahulPending: "c1000000-0000-4000-8000-000000000002",
  nikhilEvent: "c1000000-0000-4000-8000-000000000003",
  aarav: "c1000000-0000-4000-8000-000000000004",
  admin: "c1000000-0000-4000-8000-000000000005",
  ended: "c1000000-0000-4000-8000-000000000006",
  owner: "c1000000-0000-4000-8000-000000000007",
  nobody: "c1000000-0000-4000-8000-0000000000ff",
};
export const EVENT = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001";
export const ZONE = "9a000000-0000-4000-8000-000000000001";

const FAR = "2099-01-01T00:00:00Z";

export const ROLES: Row[] = [
  { key: "center_admin", name: "Center admin", tier: "center", description: "Runs the community", permissions: ["settings.manage", "roles.manage", "giving.view", "people.view", "integrations.manage"] },
  { key: "treasurer", name: "Treasurer", tier: "center", description: "Looks after the money", permissions: ["giving.view", "giving.manage", "giving.record_offline", "accounting.close"] },
  { key: "finance_volunteer", name: "Finance volunteer", tier: "operational", description: "Counts and records", permissions: ["giving.record_offline"] },
  { key: "event_manager", name: "Event manager", tier: "operational", description: "Runs events", permissions: ["events.view", "events.manage"] },
  { key: "volunteer_coordinator", name: "Volunteer coordinator", tier: "operational", description: "Looks after volunteers", permissions: ["volunteers.view", "volunteers.manage"] },
  { key: "platform_admin", name: "Platform admin", tier: "platform", description: "Weaver staff", permissions: ["*"] },
  { key: "primary_adult", name: "Primary adult", tier: "family", description: "From the household", permissions: ["giving.view"] },
];

export function settingsTables(): Record<string, Row[]> {
  const base = communityWithChildren().tables;
  const people: Row[] = (base.people as Row[]).map((p) => ({ ...p, is_deceased: false, email: null, member_number: null }));
  people.find((p) => p.id === "p-priya")!.member_number = "1042";
  people.find((p) => p.id === "p-rahul")!.member_number = "1043";
  people.push(
    { id: "p-admin", center_id, first_name: "Meera", last_name: "Admin", preferred_name: null, date_of_birth: "1975-05-05", merged_into_id: null, is_deceased: false, email: "meera@example.org", member_number: "1001" },
    // A second Priya Shah in another household, so a name alone does not say which one.
    { id: "p-priya2", center_id, first_name: "Priya", last_name: "Shah", preferred_name: null, date_of_birth: "1990-02-02", merged_into_id: null, is_deceased: false, email: null, member_number: "2077" },
    // An adult who has never signed in.
    { id: "p-dev", center_id, first_name: "Dev", last_name: "Kapoor", preferred_name: null, date_of_birth: "1980-01-01", merged_into_id: null, is_deceased: false, email: null, member_number: "3001" },
  );
  const households = [
    ...(base.households as Row[]),
    { id: "hh-shah2", center_id, display_name: "Shah, Priya", household_number: "H-1004", merged_into_id: null },
  ];
  const household_members = [
    ...(base.household_members as Row[]),
    { household_id: "hh-shah2", person_id: "p-priya2", center_id, role: "primary", is_primary: true, left_at: null },
  ];
  return {
    ...base,
    people,
    households,
    household_members,
    center_users: [
      { center_id, user_id: U.admin, person_id: "p-admin" },
      { center_id, user_id: U.priya, person_id: "p-priya" },
      { center_id, user_id: U.rahul, person_id: "p-rahul" },
      { center_id, user_id: U.nikhil, person_id: "p-nikhil" },
      { center_id, user_id: U.aarav, person_id: "p-aarav" },
      { center_id, user_id: U.owner, person_id: "p-anita" },
      { center_id, user_id: U.priya2, person_id: "p-priya2" },
    ],
    center_owners: [{ center_id, user_id: U.owner }],
    roles: ROLES,
    role_grants: [
      // Priya: treasurer, active. Rahul: treasurer, waiting for a second person (starts "never" until approved).
      { id: G.priya, center_id, user_id: U.priya, role_key: "treasurer", scope_kind: "center", scope_id: null, starts_at: "2026-01-01T00:00:00Z", ends_at: null, status: "active" },
      { id: G.rahulPending, center_id, user_id: U.rahul, role_key: "treasurer", scope_kind: "center", scope_id: null, starts_at: "infinity", ends_at: null, status: "pending" },
      // Nikhil runs one event only: this gives no rights across the community.
      { id: G.nikhilEvent, center_id, user_id: U.nikhil, role_key: "event_manager", scope_kind: "event", scope_id: EVENT, starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-12-31T06:00:00Z", status: "active" },
      // A child with a login, no birth date on file, household relationship "child": never named.
      { id: G.aarav, center_id, user_id: U.aarav, role_key: "event_manager", scope_kind: "center", scope_id: null, starts_at: "2026-01-01T00:00:00Z", ends_at: null, status: "active" },
      { id: G.admin, center_id, user_id: U.admin, role_key: "center_admin", scope_kind: "center", scope_id: null, starts_at: "2026-01-01T00:00:00Z", ends_at: null, status: "active" },
      // Ended: not listed.
      { id: G.ended, center_id, user_id: U.priya2, role_key: "finance_volunteer", scope_kind: "center", scope_id: null, starts_at: "2025-01-01T00:00:00Z", ends_at: "2026-01-01T06:00:00Z", status: "active" },
      { id: G.owner, center_id, user_id: U.owner, role_key: "center_admin", scope_kind: "center", scope_id: null, starts_at: "2025-01-01T00:00:00Z", ends_at: FAR, status: "active" },
    ],
    events: [{ id: EVENT, center_id, name: "Diwali Dinner" }],
    pathshala_classes: [],
    zones: [{ id: ZONE, center_id, name: "North" }],
    integration_connections: [] as Row[],
    email_domains: [] as Row[],
    texting_registrations: [] as Row[],
    golive_requests: [] as Row[],
    center_attestations: [] as Row[],
  };
}

export const CHECKLIST = [
  { step_key: "org.legal", stage: 0, sort: 1, title: "Legal identity", description: "EIN and status", status: "done", required: true, route: "/setup/organization", detail: null, owner_name: null, owner_role: "Owner", due_on: null },
  { step_key: "svc.payments", stage: 1, sort: 2, title: "Connect payments", description: "Stripe or PayPal", status: "waiting_on_provider", required: true, route: "/settings/payments", detail: "Stripe is checking the account.", owner_name: "Meera Admin", owner_role: "Treasurer", due_on: "2026-10-01" },
  { step_key: "svc.texting", stage: 1, sort: 4, title: "Register texting", description: "10DLC", status: "not_started", required: true, route: "/settings/texting", detail: null, owner_name: null, owner_role: "Tech officer", due_on: null },
  { step_key: "tpl.later", stage: 2, sort: 1, title: "A screen that is not built yet", description: "later", status: "not_started", required: false, route: "/not/built", detail: null, owner_name: null, owner_role: null, due_on: null },
];
export const READINESS = [
  { key: "agreements_accepted", title: "Agreements accepted", ok: false, detail: "The terms of service have not been accepted yet." },
  { key: "payments_live", title: "Payments connected", ok: false, detail: "No payment account is connected, and offline-only was not chosen." },
  { key: "email_domain_verified", title: "Email domain verified", ok: true, detail: "jsh.org is verified." },
];
export const MODULE_STATES = [
  { key: "people", label: "Members & families", description: "People", core: true, depends_on: [], sort: 1, availability: "default_on", enabled: true, switchable: false, changed_by: null, changed_at: null, reason: null },
  { key: "giving", label: "Pledges & donations", description: "Giving", core: false, depends_on: ["people"], sort: 2, availability: "default_on", enabled: true, switchable: true, changed_by: null, changed_at: null, reason: null },
  { key: "bolis", label: "Bolis", description: "Bolis", core: false, depends_on: ["giving"], sort: 3, availability: "default_on", enabled: false, switchable: true, changed_by: U.admin, changed_at: "2026-10-03T15:00:00Z", reason: "We do not hold boli auctions." },
  { key: "store", label: "Satvik Store", description: "Store", core: false, depends_on: ["people"], sort: 4, availability: "default_on", enabled: true, switchable: true, changed_by: null, changed_at: null, reason: null },
  { key: "labh", label: "Labh", description: "Not for this kind", core: false, depends_on: [], sort: 5, availability: "not_available", enabled: false, switchable: false, changed_by: null, changed_at: null, reason: null },
];

const baseCard = communityWithChildren().rpc.household_card as (a: Record<string, unknown>) => unknown[];
/** The household card of the community, plus the second Priya Shah's household (a different city and number). */
function householdCard(a: Record<string, unknown>): unknown[] {
  if (a.p_household === "hh-shah2") {
    return [{ household_id: "hh-shah2", household_name: "Shah, Priya", household_number: "H-1004", org_household_id: "2077", members: "Priya", primary_member: "Priya Shah", primary_org_member_id: "9001", zone: "South", city: "Plainfield", last_gift_on: null, open_pledge_cents: 0 }];
  }
  return baseCard(a);
}

export function addSettingsWorld(over: Partial<FakeDbOptions> = {}): FakeDbOptions {
  return {
    tables: { ...settingsTables(), ...(over.tables ?? {}) },
    rpc: {
      household_card: householdCard,
      resolve_identifier: [],
      setup_checklist: CHECKLIST,
      readiness: READINESS,
      module_states: MODULE_STATES,
      ...(over.rpc ?? {}),
    },
    ...(over.failTables ? { failTables: over.failTables } : {}),
    ...(over.failRpc ? { failRpc: over.failRpc } : {}),
  };
}

/**
 * Make db.from("role_grants").insert(row).select("status").single() work in the fake: it records the row and answers like the database
 * (a role that needs a second person comes back pending). Everything else on the fake stays as it is.
 */
export function recordGrantInserts(fake: unknown, opts: { fail?: { code?: string; message: string }; status?: (row: Row) => string } = {}) {
  const db = fake as { from: (table: string) => object };
  const inserts: Row[] = [];
  const original = db.from.bind(db);
  db.from = (table: string) => {
    const builder = original(table);
    if (table !== "role_grants") return builder;
    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (prop !== "insert") return Reflect.get(target, prop, receiver);
        return (row: Row) => {
          if (!opts.fail) inserts.push(row);
          const status = (opts.status ?? ((r: Row) => (needsSecondApprover(String(r.role_key)) ? "pending" : "active")))(row);
          const answer = opts.fail ? { data: null, error: opts.fail } : { data: { status }, error: null };
          return { select: () => ({ single: () => Promise.resolve(answer) }) };
        };
      },
    });
  };
  return inserts;
}

/** A database that answers reads and refuses every write: a command that must not change anything is run against it. */
export function readOnly(fake: unknown) {
  const db = fake as { from: (table: string) => object; rpc: (fn: string, args?: Record<string, unknown>) => unknown };
  const writes: string[] = [];
  const original = db.from.bind(db);
  db.from = (table: string) => {
    const builder = original(table);
    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert") {
          return () => {
            writes.push(`${String(prop)} ${table}`);
            throw new Error(`a command that must not write tried to ${String(prop)} ${table}`);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };
  const rpc = db.rpc.bind(db);
  const READS = new Set(["setup_checklist", "readiness", "module_states", "household_card", "resolve_identifier"]);
  db.rpc = (fn: string, args?: Record<string, unknown>) => {
    if (!READS.has(fn)) {
      writes.push(`rpc ${fn}`);
      throw new Error(`a command that must not write called ${fn}`);
    }
    return rpc(fn, args);
  };
  return writes;
}

export const ADMIN_PERMISSIONS = ["settings.manage", "roles.manage", "integrations.manage", "integrations.view", "people.view"];

export function catalogRegistry() {
  const r = new CommandRegistry();
  for (const c of CATALOG) r.register(c);
  return r;
}

export function asAdmin(opts: { via?: CommandVia; world?: FakeDbOptions; permissions?: string[]; session?: Partial<Record<keyof CrmSession, unknown>>; minors?: string[] } = {}) {
  const db = fakeDb(opts.world ?? addSettingsWorld());
  const writes = readOnly(db);
  const session = fakeSession({
    db,
    userId: U.admin,
    permissions: opts.permissions ?? ADMIN_PERMISSIONS,
    center: { ...fakeSession().center, environment: "sandbox", rules: { assistant: { enabled: true } } },
    ...opts.session,
  });
  const ctx = testContext({ session, registry: catalogRegistry(), via: opts.via ?? "screen", minorNames: opts.minors ?? ["Zoya Shah", "Aarav Patel", "Tia Mehta"] });
  return { ctx, db, session, writes };
}

/** The community's owner has ticked the three Settings changes for Niva. */
export const TICKED = { assistant: { enabled: true, tools: { "settings.grant_role": true, "settings.revoke_role": true, "settings.set_module": true } } };

/** The same community, with a database that takes a role grant and the module switch. `rules` decides what Niva may do. */
export function asWriter(opts: { via?: CommandVia; world?: FakeDbOptions; permissions?: string[]; rules?: unknown; insert?: Parameters<typeof recordGrantInserts>[1]; session?: Partial<Record<keyof CrmSession, unknown>> } = {}) {
  const db = fakeDb(opts.world ?? addSettingsWorld());
  const inserts = recordGrantInserts(db, opts.insert);
  const session = fakeSession({
    db,
    userId: U.admin,
    permissions: opts.permissions ?? ADMIN_PERMISSIONS,
    center: { ...fakeSession().center, environment: "sandbox", rules: opts.rules ?? TICKED },
    ...opts.session,
  });
  const ctx = testContext({ session, registry: catalogRegistry(), via: opts.via ?? "assistant", minorNames: ["Zoya Shah", "Aarav Patel", "Tia Mehta"] });
  return { ctx, db, inserts, session };
}
