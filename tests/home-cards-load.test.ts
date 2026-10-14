import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadAssignments, loadHomeCards, loadMemberWork } from "@/lib/data/home-cards";
import type { CrmSession } from "@/lib/session";

// The reads behind the two Home cards (docs/DEMO_ROLE_WORK.md), against a fake database that records what was asked. Everything runs as
// the signed-in person, so what is asked is what the member app asks; a read that fails must reach the card as a plain sentence.

const CENTER = "c0000000-0000-4000-8000-000000000001";
const PERSON = "p0000000-0000-4000-8000-000000000001";
const HOUSEHOLD = "h0000000-0000-4000-8000-000000000001";
const EV = "e0000000-0000-4000-8000-000000000001";
const ZONE = "20000000-0000-4000-8000-000000000001";
const CLS = "c1000000-0000-4000-8000-000000000001";

type Reply = { data?: unknown; error?: unknown; count?: number };
type Call = { kind: "from" | "rpc"; name: string; steps: string[] };

function fakeDb(tables: Record<string, Reply> = {}, rpcs: Record<string, Reply> = {}) {
  const calls: Call[] = [];
  const answer = (r: Reply | undefined, def: unknown) => ({ data: r?.data ?? def, error: r?.error ?? null, count: r?.count ?? null });
  const db = {
    from(name: string) {
      const call: Call = { kind: "from", name, steps: [] };
      calls.push(call);
      const chain: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(answer(tables[name], [])).then(ok, bad);
            return (...args: unknown[]) => {
              call.steps.push(`${String(prop)}(${args.map((a) => JSON.stringify(a)).join(",")})`);
              return chain;
            };
          },
        },
      );
      return chain;
    },
    rpc(name: string, args?: unknown) {
      calls.push({ kind: "rpc", name, steps: [JSON.stringify(args ?? {})] });
      return Promise.resolve(answer(rpcs[name], null));
    },
  };
  const asked = (name: string) => calls.filter((c) => c.name === name);
  return { db, calls, asked };
}

type Fake = ReturnType<typeof fakeDb>;

function session(fake: Fake, over: Partial<CrmSession> = {}): CrmSession {
  return {
    db: fake.db,
    userId: "u1",
    email: null,
    center: { id: CENTER, slug: "demo", name: "Demo", short_name: null, time_zone: "America/Chicago", country: "US", currency: "USD", branding: {}, feature_flags: {}, rules: {}, status: "active", environment: "sandbox" },
    person: { id: PERSON, name: "Priya Wadhwa", memberNumber: null },
    roles: [],
    grants: [],
    permissions: [],
    isPlatformAdmin: false,
    isOwner: false,
    modulesOff: [],
    ...over,
  } as unknown as CrmSession;
}

const ROWS = {
  household_members: { data: [{ household_id: HOUSEHOLD, is_primary: true }] },
  pledges: { data: [{ amount_cents: 5100, paid_cents: 0 }] },
  events: { data: [{ id: "ev-1", status: "published" }, { id: "ev-2", status: "published" }] },
  rsvps: { data: [] },
  alerts: { data: null, count: 1 },
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the member app card's reads", () => {
  it("an adult: the database's own adult rule, the household's open pledges, RSVPs, application, requests to vouch, notices", async () => {
    const fake = fakeDb(ROWS, {
      i_am_adult: { data: true },
      my_membership_application: { data: [{ application_id: "a1", status: "awaiting_reference" }] },
      my_reference_requests: { data: [] },
    });
    const d = await loadMemberWork(session(fake));
    expect(d.linked).toBe(true);
    expect(d.adult).toEqual({ ok: true, value: true });
    expect(d.application).toEqual({ ok: true, value: { status: "awaiting_reference" } });
    expect(d.vouch).toEqual({ ok: true, value: 0 });
    expect(d.pledges).toEqual({ ok: true, value: { count: 1, leftCents: 5100, paidCents: 0 } });
    expect(d.events).toEqual({ ok: true, value: { upcoming: 2, going: 0, open: 2 } });
    expect(d.notices).toEqual({ ok: true, value: 1 });
    // The same questions the member app asks, of the signed-in person's own rows.
    expect(fake.asked("i_am_adult")[0].steps[0]).toBe(JSON.stringify({ p_center: CENTER }));
    expect(fake.asked("pledges")[0].steps).toContain(`eq("household_id",${JSON.stringify(HOUSEHOLD)})`);
    expect(fake.asked("pledges")[0].steps).toContain(`in("status",["open","partially_paid"])`);
    expect(fake.asked("my_membership_application")[0].steps[0]).toBe(JSON.stringify({ p_center: CENTER }));
    expect(fake.asked("rsvps")).toHaveLength(1);
  });

  it("a child: the events and the notices; never the pledges, the RSVPs, the application or the requests to vouch", async () => {
    const fake = fakeDb(ROWS, { i_am_adult: { data: false }, my_membership_application: { data: [{ status: "awaiting_center" }] }, my_reference_requests: { data: [{}] } });
    const d = await loadMemberWork(session(fake));
    expect(d.adult).toEqual({ ok: true, value: false });
    expect(d.pledges).toBeNull();
    expect(d.application).toBeNull();
    expect(d.vouch).toBeNull();
    expect(d.events).toEqual({ ok: true, value: { upcoming: 2, going: 0, open: 0 } });
    for (const name of ["pledges", "payments", "rsvps", "household_members", "my_membership_application", "my_reference_requests"]) {
      expect(fake.asked(name), `${name} must not be asked for a child`).toHaveLength(0);
    }
  });

  it("when the age cannot be checked: treated like a child (no money asked), and the failure is a reason, not a guess", async () => {
    const fake = fakeDb(ROWS, { i_am_adult: { error: { code: "PGRST202", message: "x" } } });
    const d = await loadMemberWork(session(fake));
    expect(d.adult).toEqual({ ok: false, error: "the database function is not available (has the latest migration been applied?)" });
    expect(d.pledges).toBeNull();
    expect(fake.asked("pledges")).toHaveLength(0);
  });

  it("an RPC that fails is a failure with a plain reason, logged on the server, never a zero", async () => {
    const fake = fakeDb(ROWS, {
      i_am_adult: { data: true },
      my_membership_application: { error: { code: "XX000", message: "connection to server was lost; fetch failed" } },
      my_reference_requests: { error: { code: "42501", message: "permission denied for function my_reference_requests" } },
    });
    const d = await loadMemberWork(session(fake));
    expect(d.application).toEqual({ ok: false, error: "the database could not be reached — check the connection and try again" });
    expect(d.vouch).toEqual({ ok: false, error: "you don't have permission to make this change" });
    expect(d.pledges?.ok).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("a failed pledges read, and a household that cannot be found", async () => {
    const failing = fakeDb({ ...ROWS, pledges: { error: { message: "fetch failed" } } }, { i_am_adult: { data: true } });
    expect((await loadMemberWork(session(failing))).pledges).toEqual({ ok: false, error: "the database could not be reached — check the connection and try again" });
    const noHousehold = fakeDb({ ...ROWS, household_members: { error: { code: "42P01", message: "x" } } }, { i_am_adult: { data: true } });
    const d = await loadMemberWork(session(noHousehold));
    expect(d.pledges?.ok).toBe(false);
    expect(d.events?.ok).toBe(false);
    expect(noHousehold.asked("pledges")).toHaveLength(0);
  });

  it("an adult who is in no household has no pledges and no RSVPs, not an error", async () => {
    const fake = fakeDb({ ...ROWS, household_members: { data: [] } }, { i_am_adult: { data: true } });
    const d = await loadMemberWork(session(fake));
    expect(d.pledges).toEqual({ ok: true, value: { count: 0, leftCents: 0, paidCents: 0 } });
    expect(d.events).toEqual({ ok: true, value: { upcoming: 2, going: 0, open: 2 } });
    expect(fake.asked("pledges")).toHaveLength(0);
    expect(fake.asked("rsvps")).toHaveLength(0);
  });

  it("a module the community switched off is not read", async () => {
    const fake = fakeDb(ROWS, { i_am_adult: { data: true } });
    const d = await loadMemberWork(session(fake, { modulesOff: ["giving", "membership", "comms"] }));
    expect(d.pledges).toBeNull();
    expect(d.application).toBeNull();
    expect(d.notices).toBeNull();
    expect(fake.asked("alerts")).toHaveLength(0);
    expect(fake.asked("my_membership_application")).toHaveLength(0);
  });

  it("a sign-in with no person asks nothing", async () => {
    const fake = fakeDb(ROWS);
    const d = await loadMemberWork(session(fake, { person: null }));
    expect(d.linked).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("the assignments' reads", () => {
  const lead = { role_key: "event_lead", scope_kind: "event", scope_id: EV };

  it("a person with no scoped grant reads nothing and has no card", async () => {
    const fake = fakeDb();
    expect(await loadAssignments(session(fake, { grants: [{ role_key: "treasurer", scope_kind: "center", scope_id: null }] }))).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("an event lead: the event row, and the live numbers from the database's own function", async () => {
    const fake = fakeDb(
      { events: { data: [{ id: EV, name: "Tapasvi Dinner", status: "published", starts_at: "2026-10-19T23:00:00Z", ends_at: null, venue: "Main hall" }] } },
      { event_live_stats: { data: [{ checked_in: 3, confirmed: 12, rsvp_people: 24, walk_ins: 0, waitlist: 0, median_checkin_seconds: null }] } },
    );
    const card = await loadAssignments(session(fake, { grants: [lead], roles: [{ key: "event_lead", name: "Event lead", scopeKind: "event" }] }));
    expect(card?.lines).toHaveLength(1);
    expect(card?.lines[0]).toMatchObject({ title: "Tapasvi Dinner", roles: ["Event lead"], numbers: "24 people on RSVPs · 12 confirmed · 3 checked in", problem: null });
    expect(fake.asked("event_live_stats")[0].steps[0]).toBe(JSON.stringify({ p_event: EV }));
  });

  it("the numbers are not asked for an event the person may not count (a boli recorder)", async () => {
    const fake = fakeDb({ events: { data: [{ id: EV, name: "Tapasvi Dinner", status: "published", starts_at: null, ends_at: null, venue: null }] } });
    const card = await loadAssignments(session(fake, { grants: [{ role_key: "boli_recorder", scope_kind: "event", scope_id: EV }] }));
    expect(fake.asked("event_live_stats")).toHaveLength(0);
    expect(card?.lines[0].links).toEqual([]);
    expect(card?.lines[0].numbers).toBeNull();
  });

  it("a failed count shows no number, and says why", async () => {
    const fake = fakeDb(
      { events: { data: [{ id: EV, name: "Tapasvi Dinner", status: "live", starts_at: "2026-10-14T20:00:00Z", ends_at: null, venue: null }] } },
      { event_live_stats: { error: { code: "P0001", message: "not allowed to see this event's live numbers" } } },
    );
    const card = await loadAssignments(session(fake, { grants: [lead] }));
    expect(card?.lines[0].numbers).toBeNull();
    expect(card?.lines[0].problem).toBe("Could not count the people for this event — not allowed to see this event's live numbers.");
  });

  it("a failed event read: the line says so and keeps the role's links", async () => {
    const fake = fakeDb({ events: { error: { message: "fetch failed" } } });
    const card = await loadAssignments(session(fake, { grants: [lead] }));
    expect(card?.lines[0].problem).toBe("Could not load this event — the database could not be reached — check the connection and try again.");
    expect(card?.lines[0].links[0].href).toBe(`/events/${EV}`);
  });

  it("a zone lead and a teacher: the zone's open conversations, the class", async () => {
    const fake = fakeDb({
      zones: { data: [{ id: ZONE, name: "North" }] },
      pathshala_classes: { data: [{ id: CLS, name: "Class 2", meets_on: "sunday", starts_time: "10:00:00", room: "Room 4" }] },
      inboxes: { data: [{ id: "ib1", zone_id: ZONE }] },
      threads: { data: [{ inbox_id: "ib1" }, { inbox_id: "ib1" }] },
    });
    const card = await loadAssignments(
      session(fake, {
        grants: [
          { role_key: "zone_lead", scope_kind: "zone", scope_id: ZONE },
          { role_key: "teacher", scope_kind: "class", scope_id: CLS },
        ],
      }),
    );
    expect(card?.lines.map((l) => [l.title, l.numbers])).toEqual([
      ["Class 2", null],
      ["North zone", "2 open conversations in the zone's inbox"],
    ]);
    expect(fake.asked("threads")[0].steps).toContain(`neq("status","closed")`);
  });

  it("a failed inbox count says so", async () => {
    const fake = fakeDb({ zones: { data: [{ id: ZONE, name: "North" }] }, inboxes: { error: { code: "42501", message: "permission denied" } } });
    const card = await loadAssignments(session(fake, { grants: [{ role_key: "zone_lead", scope_kind: "zone", scope_id: ZONE }] }));
    expect(card?.lines[0].problem).toBe("Could not count the open conversations in this zone's inbox — you don't have permission to make this change.");
    expect(card?.lines[0].numbers).toBeNull();
  });
});

describe("Start here's reads", () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const FUTURE = new Date(Date.now() + 5 * 86_400_000).toISOString();

  const EXEC = ["reports.view", "events.view", "bolis.view", "store.view", "content.view", "comms.view", "governance.view"];
  const EDITOR = ["content.view", "content.draft"];
  const COORDINATOR = ["volunteers.view", "volunteers.manage", "safety.view", "safety.manage", "events.view"];
  const COMMITTEE = ["pathshala.view", "events.view", "events.manage", "governance.view", "governance.vote"];

  it("the content editor: the drafts, counted as themselves", async () => {
    const fake = fakeDb({ content_items: { data: null, count: 2 } });
    const cards = await loadHomeCards(session(fake, { permissions: EDITOR }));
    expect(cards.memberWork).toBeNull();
    expect(cards.assignments).toBeNull();
    expect(cards.startHere).toMatchObject({ key: "content", screen: "Content › Library", href: "/content/library", lines: ["2 drafts to finish."], problems: [] });
    expect(fake.asked("content_items")[0].steps).toContain(`eq("status","draft")`);
  });

  it("a failed count is a plain failure line, never a silent zero", async () => {
    const fake = fakeDb({ content_items: { error: { message: "fetch failed" } } });
    const cards = await loadHomeCards(session(fake, { permissions: EDITOR }));
    expect(cards.startHere?.lines).toEqual([]);
    expect(cards.startHere?.problems).toEqual(["Could not count the drafts — the database could not be reached — check the connection and try again."]);
    expect(console.error).toHaveBeenCalled();
  });

  it("the volunteer coordinator: people who asked, and the shifts that still have places", async () => {
    const fake = fakeDb({
      volunteer_interests: { data: null, count: 3 },
      volunteer_shifts: {
        data: [
          { id: "s1", capacity: 3, starts_at: FUTURE, ends_at: null },
          { id: "s2", capacity: 1, starts_at: FUTURE, ends_at: null },
          { id: "s3", capacity: 2, starts_at: FUTURE, ends_at: null },
        ],
      },
      volunteer_assignments: { data: [{ shift_id: "s1", status: "assigned" }, { shift_id: "s2", status: "confirmed" }] },
    });
    const cards = await loadHomeCards(session(fake, { permissions: COORDINATOR }));
    expect(cards.startHere).toMatchObject({ key: "volunteers", screen: "Events › Volunteers", lines: ["3 people asked to volunteer.", "2 shifts with free places."], problems: [] });
  });

  it("a safety-only reader cannot read the sign-ups, so nothing is counted (no wrong number)", async () => {
    const fake = fakeDb();
    const cards = await loadHomeCards(session(fake, { permissions: ["safety.view", "events.view"] }));
    expect(cards.startHere?.key).toBe("volunteers");
    expect(cards.startHere?.lines).toEqual([]);
    expect(fake.asked("volunteer_interests")).toHaveLength(0);
    expect(fake.asked("volunteer_assignments")).toHaveLength(0);
  });

  it("store pickup and the kitchen lead: the orders waiting", async () => {
    for (const permissions of [["store.pickup"], ["kitchen.view"]]) {
      const fake = fakeDb({ store_orders: { data: null, count: 2 } });
      const cards = await loadHomeCards(session(fake, { permissions }));
      expect(cards.startHere).toMatchObject({ key: "store", screen: "My Store › Orders by pickup", lines: ["2 orders waiting for pickup."] });
      expect(fake.asked("store_orders")[0].steps).toContain(`in("status",["placed","preparing","ready"])`);
    }
  });

  it("the Pathshala committee: the dashboard's own rule over the open actions", async () => {
    const fake = fakeDb({
      actions: {
        data: [
          { id: "a1", state: "open", due_on: "2000-01-01", owner_person_id: "p1" },
          { id: "a2", state: "open", due_on: day(1), owner_person_id: null },
          { id: "a3", state: "open", due_on: day(9), owner_person_id: null },
          { id: "a4", state: "open", due_on: day(9), owner_person_id: "p1" },
          { id: "a5", state: "open", due_on: day(60), owner_person_id: null },
        ],
      },
    });
    const cards = await loadHomeCards(session(fake, { permissions: COMMITTEE }));
    // a1 is overdue and a2 due within 3 days; a2 and a3 are open in the next two weeks with no owner (a5 is later).
    expect(cards.startHere).toMatchObject({ key: "committee", lines: ["2 actions overdue or due within 3 days.", "2 actions in the next two weeks with no owner."] });
    expect(fake.asked("actions")[0].steps).toContain(`eq("is_idea",false)`);
  });

  it("Reports has nothing to count, so nothing is asked", async () => {
    const fake = fakeDb();
    const cards = await loadHomeCards(session(fake, { permissions: EXEC }));
    expect(cards.startHere).toMatchObject({ key: "reports", lines: [], problems: [] });
    expect(fake.calls).toHaveLength(0);
  });

  it("never for a person who already has a queue, assignments or the member-app card", async () => {
    const fake = fakeDb({ content_items: { data: null, count: 2 } });
    // A staff queue (the newsletter approver) plus a draft-writing permission.
    const withQueue = await loadHomeCards(session(fake, { permissions: [...EDITOR, "content.approve", "content.manage"] }));
    expect(withQueue.startHere).toBeNull();
    const assigned = await loadHomeCards(
      session(fake, {
        permissions: EDITOR,
        grants: [{ role_key: "zone_lead", scope_kind: "zone", scope_id: ZONE }],
      }),
    );
    expect(assigned.assignments).not.toBeNull();
    expect(assigned.startHere).toBeNull();
    const family = await loadHomeCards(session(fakeDb(ROWS, { i_am_adult: { data: true } })));
    expect(family.memberWork).not.toBeNull();
    expect(family.startHere).toBeNull();
  });
});

describe("what Home gets", () => {
  it("a family adult: the member-app card, no assignments", async () => {
    const fake = fakeDb(ROWS, { i_am_adult: { data: true } });
    const cards = await loadHomeCards(session(fake));
    expect(cards.assignments).toBeNull();
    expect(cards.memberWork?.state).toBe("work");
    expect(cards.memberWork?.lines.map((l) => l.text)).toContain("A pledge of $51.00 is open.");
  });

  it("an event lead with no permission: both cards", async () => {
    const fake = fakeDb({ ...ROWS, events: { data: [{ id: EV, name: "Tapasvi Dinner", status: "published", starts_at: null, ends_at: null, venue: null }] } }, { i_am_adult: { data: true }, event_live_stats: { data: [{ checked_in: 0, confirmed: 0, rsvp_people: 0 }] } });
    const cards = await loadHomeCards(session(fake, { grants: [{ role_key: "event_lead", scope_kind: "event", scope_id: EV }] }));
    expect(cards.assignments?.lines).toHaveLength(1);
    expect(cards.memberWork).not.toBeNull();
  });

  it("a person with a staff queue gets the member-app card never, assignments only if they hold one", async () => {
    const fake = fakeDb();
    const treasurer = session(fake, { permissions: ["giving.view", "giving.manage", "giving.approve", "giving.record_offline"], grants: [{ role_key: "treasurer", scope_kind: "center", scope_id: null }] });
    const cards = await loadHomeCards(treasurer);
    expect(cards).toEqual({ memberWork: null, assignments: null, startHere: null });
    expect(fake.calls).toHaveLength(0);
  });

  it("the member app link comes from the portal's configured address", async () => {
    const fake = fakeDb(ROWS, { i_am_adult: { data: true } });
    const was = process.env.NEXT_PUBLIC_MEMBER_APP_URL;
    try {
      process.env.NEXT_PUBLIC_MEMBER_APP_URL = "https://app.example.org/";
      expect((await loadHomeCards(session(fake))).memberWork?.link).toBe("https://app.example.org");
      delete process.env.NEXT_PUBLIC_MEMBER_APP_URL;
      expect((await loadHomeCards(session(fake))).memberWork?.link).toBeNull();
    } finally {
      if (was === undefined) delete process.env.NEXT_PUBLIC_MEMBER_APP_URL;
      else process.env.NEXT_PUBLIC_MEMBER_APP_URL = was;
    }
  });
});
