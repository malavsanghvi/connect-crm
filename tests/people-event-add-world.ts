// A small community for the tests of "Add to an event": one family (Hassan) with an adult, a child and a baby, one with a person in
// memory, a few events (open, with a limit and a waitlist, with a limit and none, a draft, a finished one), and a database that keeps what
// is written to it, so a test can look at the rows afterwards. Built on fakeDb (tests/commands/helpers.ts); inserts and the places-taken
// count (app.event_summary) are added here.

import type { EventAccess } from "@/lib/events/access";

import { fakeDb, fakeSession, type FakeDbOptions } from "./commands/helpers";

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };

const id = (n: number) => `9b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const W = {
  center: "center-1",
  hh: id(1),
  hhOther: id(2),
  hhMerged: id(3),
  samira: id(11),
  layla: id(12),
  omar: id(13),
  grandpa: id(14),
  karim: id(15),
  stranger: id(16),
  tanaka: id(17),
  picnic: id(21),
  gala: id(22),
  tiny: id(23),
  draft: id(24),
  past: id(25),
  cancelled: id(26),
  camp: id(27),
  rsvpExisting: id(31),
} as const;

export const NOW = new Date("2026-10-12T15:00:00Z");

const ev = (over: Row): Row => ({
  center_id: W.center,
  starts_at: "2026-10-18T17:00:00Z",
  ends_at: "2026-10-18T20:00:00Z",
  status: "published",
  capacity: null,
  waitlist_enabled: false,
  audience: "members_and_guests",
  rsvp_opens_at: null,
  rsvp_closes_at: null,
  ...over,
});

const person = (p: string, first: string, last: string, dob: string | null, over: Row = {}): Row => ({
  id: p,
  center_id: W.center,
  first_name: first,
  last_name: last,
  preferred_name: null,
  date_of_birth: dob,
  is_deceased: false,
  merged_into_id: null,
  ...over,
});

export function world(): FakeDbOptions & { tables: Record<string, Row[]> } {
  return {
    tables: {
      households: [
        { id: W.hh, center_id: W.center, merged_into_id: null },
        { id: W.hhOther, center_id: W.center, merged_into_id: null },
        { id: W.hhMerged, center_id: W.center, merged_into_id: W.hh },
      ],
      people: [
        person(W.samira, "Samira", "Hassan", "1984-03-02"),
        // Nine on the day of the picnic.
        person(W.layla, "Layla", "Hassan", "2017-10-19"),
        // No birth date on file.
        person(W.omar, "Omar", "Hassan", null),
        // 65 on the day of the picnic.
        person(W.grandpa, "Yusuf", "Hassan", "1961-10-18"),
        person(W.karim, "Karim", "Hassan", "1980-01-01", { is_deceased: true }),
        person(W.stranger, "Nadia", "Khalil", "1990-05-05"),
        person(W.tanaka, "美咲", "田中", "1990-02-02", { preferred_name: "美咲" }),
      ],
      household_members: [W.samira, W.layla, W.omar, W.grandpa, W.karim, W.tanaka].map((p) => ({ center_id: W.center, household_id: W.hh, person_id: p, left_at: null })).concat([
        { center_id: W.center, household_id: W.hhOther, person_id: W.stranger, left_at: null },
      ]),
      events: [
        ev({ id: W.picnic, name: "Spring Picnic" }),
        ev({ id: W.gala, name: "Годовой вечер", starts_at: "2026-11-02T23:00:00Z", ends_at: null, capacity: 5, waitlist_enabled: true }),
        ev({ id: W.tiny, name: "Cleanup 春の清掃", starts_at: "2026-10-25T15:00:00Z", ends_at: null, capacity: 3, waitlist_enabled: false }),
        ev({ id: W.draft, name: "Not announced", status: "draft" }),
        ev({ id: W.past, name: "Last week", starts_at: "2026-10-05T17:00:00Z", ends_at: "2026-10-05T20:00:00Z" }),
        ev({ id: W.cancelled, name: "Called off", status: "cancelled" }),
        // Still going (it started, and it ends far in the future): a fixed end date of 2026-10-14 made this fixture, and the tests that list it, fail once that day passed.
        ev({ id: W.camp, name: "Weekend camp", status: "rsvp_closed", starts_at: "2026-10-10T17:00:00Z", ends_at: "2036-10-14T17:00:00Z" }),
      ],
      rsvps: [],
      attendees: [],
    },
  };
}

/** A person who may add to every event. */
export const MANAGER: EventAccess = { permissions: ["events.view", "events.manage"], isPlatformAdmin: false, isOwner: false, grants: [] };
export const VIEWER: EventAccess = { permissions: ["events.view"], isPlatformAdmin: false, isOwner: false, grants: [] };
export const leadOf = (eventId: string): EventAccess => ({
  permissions: ["events.view"],
  isPlatformAdmin: false,
  isOwner: false,
  grants: [{ role_key: "event_lead", scope_kind: "event", scope_id: eventId, starts_at: "2026-01-01T00:00:00Z", ends_at: null }],
});

export type Write = { op: "insert" | "update"; table: string; rows?: Row[]; patch?: Row };

export type Hooks = {
  /** Called after rows were inserted (a test can make another RSVP appear "at the same time"). */
  afterInsert?: (table: string, rows: Row[]) => void;
  failInsert?: Record<string, DbError>;
  failUpdate?: Record<string, DbError>;
  /** Make the places-taken count fail. */
  failSummary?: boolean;
};

/** The world as a database that keeps inserts and answers event_summary from what is in it. */
export function database(w: FakeDbOptions & { tables: Record<string, Row[]> }, hooks: Hooks = {}) {
  const counted = (eventId: string, walkIn: boolean) => {
    const rsvps = w.tables.rsvps.filter((r) => r.event_id === eventId && r.status !== "cancelled" && r.status !== "waitlisted" && (r.source === "walk_in") === walkIn);
    const ids = new Set(rsvps.map((r) => r.id));
    return w.tables.attendees.filter((a) => ids.has(a.rsvp_id) && a.status !== "cancelled").length;
  };
  const base = fakeDb({
    ...w,
    failUpdates: hooks.failUpdate,
    rpc: {
      ...w.rpc,
      event_summary: (a: Record<string, unknown>) => {
        if (hooks.failSummary) return null;
        return { people: { people_rsvpd: counted(String(a.p_event), false), walk_in_people: counted(String(a.p_event), true) } };
      },
    },
    failRpc: hooks.failSummary ? { event_summary: { message: "boom" } } : undefined,
  });
  const writes: Write[] = [];
  let seq = 0;
  const original = base.from.bind(base) as unknown as (table: string) => object;
  (base as unknown as { from: (table: string) => object }).from = (table: string) => {
    const builder = original(table);
    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (prop === "update") {
          return (patch: Row) => {
            writes.push({ op: "update", table, patch });
            return (Reflect.get(target, "update", receiver) as (p: Row) => unknown)(patch);
          };
        }
        if (prop !== "insert") return Reflect.get(target, prop, receiver);
        return (input: Row | Row[]) => {
          const list = Array.isArray(input) ? input : [input];
          const failure = hooks.failInsert?.[table];
          const settle = <T,>(data: T) => Promise.resolve(failure ? { data: null, error: failure } : { data, error: null });
          let stored: Row[] = [];
          if (!failure) {
            seq += 1;
            stored = list.map((r, i) => ({
              id: id(900 + seq * 10 + i),
              created_at: new Date(Date.UTC(2026, 9, 12, 15, 0, 0, seq * 10 + i)).toISOString(),
              ...(table === "attendees" ? { checked_in_at: null, ticket_revoked: false } : {}),
              ...r,
            }));
            w.tables[table] = [...(w.tables[table] ?? []), ...stored];
            writes.push({ op: "insert", table, rows: stored });
            hooks.afterInsert?.(table, stored);
          }
          return {
            select: () => ({ single: () => settle(stored[0] ? { id: stored[0].id } : null), then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle(stored.map((r) => ({ id: r.id }))).then(res, rej) }),
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle(null).then(res, rej),
          };
        };
      },
    });
  };
  return { db: base, writes, world: w };
}

export function context(w = world(), hooks: Hooks = {}, access: EventAccess = MANAGER) {
  const d = database(w, hooks);
  const session = fakeSession({ db: d.db, permissions: access.permissions });
  return { ...d, ctx: { session, access, now: () => NOW } };
}
