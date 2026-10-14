import { describe, expect, it } from "vitest";

import { buildAssignments, canSeeEventNumbers, eventsToCount, scopedAssignments, type AssignmentFacts, type EventFact } from "@/lib/home/assignments";
import { hasHomeCards, showsTasksCard, type HomeCards } from "@/lib/home/cards";
import {
  buildMemberWork,
  holdsNoStaffWork,
  memberAppLink,
  memberReads,
  summarizeEvents,
  summarizePledges,
  type MemberWorkData,
} from "@/lib/home/member-work";
import { problemSentence, readFailed, readOk } from "@/lib/home/read";
import { type ScopedContext } from "@/lib/permissions";

import { viewer } from "./routines/fixtures";

// The two Home cards for a person whose work is not in a staff queue (docs/DEMO_ROLE_WORK.md): the models, in each role state.

const EV = "11111111-1111-4111-8111-111111111111";
const EV2 = "22222222-2222-4222-8222-222222222222";
const CLS = "33333333-3333-4333-8333-333333333333";
const ZONE = "44444444-4444-4444-8444-444444444444";
const TZ = "America/Chicago";
const NOW = new Date("2026-10-14T15:00:00Z");

const URL = "https://app.example.org";
const opts: { currency: string; memberAppUrl: string | null | undefined; locale?: string } = { currency: "USD", memberAppUrl: URL };

/** Everything a signed-in adult family member's reads came back with: nothing waiting. */
function data(over: Partial<MemberWorkData> = {}): MemberWorkData {
  return {
    linked: true,
    adult: readOk(true),
    application: readOk(null),
    vouch: readOk(0),
    pledges: readOk({ count: 0, leftCents: 0, paidCents: 0 }),
    events: readOk({ upcoming: 0, going: 0, open: 0 }),
    notices: readOk(0),
    ...over,
  };
}

const lines = (d: MemberWorkData, o = opts) => buildMemberWork(d, o).lines.map((l) => l.text);

describe("who gets the member-app card", () => {
  it("a family role holds nothing, so it does", () => {
    expect(holdsNoStaffWork(viewer(["community_member"]))).toBe(true);
    expect(holdsNoStaffWork(viewer(["child"]))).toBe(true);
  });
  it("so does a person whose roles are all held for one event or one zone", () => {
    expect(holdsNoStaffWork(viewer([{ key: "event_lead", scope: { kind: "event", id: EV } }]))).toBe(true);
    expect(holdsNoStaffWork(viewer([{ key: "zone_lead", scope: { kind: "zone", id: ZONE } }]))).toBe(true);
  });
  it("a person with a staff queue does not", () => {
    expect(holdsNoStaffWork(viewer(["treasurer"]))).toBe(false);
    expect(holdsNoStaffWork(viewer(["membership_coordinator"]))).toBe(false);
  });
  it("neither does a person with a screen but no queue (the kitchen lead's Orders, a teacher's classes)", () => {
    expect(holdsNoStaffWork({ ...viewer([]), permissions: ["kitchen.view"] })).toBe(false);
    expect(holdsNoStaffWork(viewer([{ key: "teacher", scope: { kind: "class", id: CLS } }]))).toBe(false);
  });
  it("nor a platform admin", () => {
    expect(holdsNoStaffWork({ ...viewer([]), isPlatformAdmin: true })).toBe(false);
  });
});

describe("the member app's link", () => {
  it("is the configured address, without a trailing slash", () => {
    expect(memberAppLink("https://app.weaverams.org")).toBe("https://app.weaverams.org");
    expect(memberAppLink("  https://app.weaverams.org/// ")).toBe("https://app.weaverams.org");
    expect(memberAppLink("http://localhost:8081")).toBe("http://localhost:8081");
  });
  it("is null when nothing usable is set, so no dead link is drawn", () => {
    for (const bad of [undefined, null, "", "   ", "app.weaverams.org", "javascript:alert(1)", "ftp://example.org", "https://", "https://exa mple.org", "https://example.org?x=1"]) {
      expect(memberAppLink(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});

describe("what is counted, shaped", () => {
  it("open pledges: what is left to pay, never a negative", () => {
    expect(summarizePledges([])).toEqual({ count: 0, leftCents: 0, paidCents: 0 });
    expect(summarizePledges([{ amount_cents: 5100, paid_cents: 0 }])).toEqual({ count: 1, leftCents: 5100, paidCents: 0 });
    expect(summarizePledges([{ amount_cents: 5100, paid_cents: 2000 }])).toEqual({ count: 1, leftCents: 3100, paidCents: 2000 });
    expect(summarizePledges([{ amount_cents: 5100, paid_cents: 6000 }, { amount_cents: 2500, paid_cents: 0 }])).toEqual({ count: 2, leftCents: 2500, paidCents: 0 });
  });
  it("events: the ones the household RSVPd to, and the published ones it has not answered yet", () => {
    const events = [
      { id: "a", status: "published" },
      { id: "b", status: "published" },
      { id: "c", status: "rsvp_closed" },
      { id: "d", status: "published" },
    ];
    const rsvps = [
      { event_id: "a", status: "confirmed" },
      { event_id: "b", status: "cancelled" },
      { event_id: "d", status: "waitlisted" },
      { event_id: "gone", status: "rsvpd" },
    ];
    // a is going; b was cancelled (open again); c is closed to RSVPs; d is on a waiting list (answered, not going).
    expect(summarizeEvents(events, rsvps)).toEqual({ upcoming: 4, going: 1, open: 1 });
    expect(summarizeEvents(events, [])).toEqual({ upcoming: 4, going: 0, open: 3 });
  });
});

describe("what is read for whom", () => {
  it("an adult: everything the community has on; a child, or an age that could not be checked: events and notices only", () => {
    const on = { modulesOff: [] as string[] };
    expect(memberReads(true, on)).toEqual({ application: true, vouch: true, pledges: true, events: true, rsvps: true, notices: true });
    for (const adult of [false, null]) {
      expect(memberReads(adult, on)).toEqual({ application: false, vouch: false, pledges: false, events: true, rsvps: false, notices: true });
    }
  });
  it("nothing is read for a module the community switched off", () => {
    expect(memberReads(true, { modulesOff: ["giving", "membership"] })).toMatchObject({ application: false, vouch: false, pledges: false, events: true });
    expect(memberReads(true, { modulesOff: ["events", "comms"] })).toMatchObject({ events: false, rsvps: false, notices: false, pledges: true });
  });
});

describe("the card for an adult", () => {
  it("a member whose application waits for her reference, with an open pledge and events to RSVP to", () => {
    const d = data({
      application: readOk({ status: "awaiting_reference" }),
      pledges: readOk({ count: 1, leftCents: 5100, paidCents: 0 }),
      events: readOk({ upcoming: 2, going: 0, open: 2 }),
      notices: readOk(1),
    });
    expect(lines(d)).toEqual([
      "Your family's membership application is waiting for your reference to answer.",
      "A pledge of $51.00 is open.",
      "2 upcoming events are open for your family to RSVP to.",
      "Your community has posted 1 notice.",
    ]);
    expect(buildMemberWork(d, opts).state).toBe("work");
  });

  it("a reference with a request to vouch for an applicant: counted, no one named", () => {
    expect(lines(data({ vouch: readOk(1) }))).toEqual(["1 person has asked you to vouch for their membership application."]);
    expect(lines(data({ vouch: readOk(3) }))).toEqual(["3 people have asked you to vouch for their membership applications."]);
  });

  it("the family adults: the application with the team, a pledge part paid, several pledges, an RSVP", () => {
    expect(lines(data({ application: readOk({ status: "awaiting_center" }) }))).toEqual(["Your family's membership application is waiting for the membership team."]);
    expect(lines(data({ application: readOk({ status: "awaiting_ec" }) }))).toEqual(["Your family's membership application is waiting for its final approval."]);
    expect(lines(data({ application: readOk({ status: "reference_declined" }) }))).toEqual(["Your reference declined your family's membership application."]);
    expect(lines(data({ application: readOk({ status: "draft" }) }))).toEqual(["Your family's membership application is saved as a draft and has not been sent yet."]);
    expect(lines(data({ pledges: readOk({ count: 1, leftCents: 3100, paidCents: 2000 }) }))).toEqual(["A pledge with $31.00 left to pay is open."]);
    expect(lines(data({ pledges: readOk({ count: 3, leftCents: 120000, paidCents: 0 }) }))).toEqual(["3 pledges are open, with $1,200.00 left to pay in all."]);
    expect(lines(data({ events: readOk({ upcoming: 3, going: 1, open: 1 }) }))).toEqual([
      "Your family has RSVPd to 1 upcoming event.",
      "1 upcoming event is open for your family to RSVP to.",
    ]);
  });

  it("an application that is approved, rejected or withdrawn is not work", () => {
    for (const status of ["approved", "rejected", "expired", "withdrawn"]) expect(lines(data({ application: readOk({ status }) }))).toEqual([]);
  });

  it("writes money the way the community does, and never names a household or a person", () => {
    const d = data({ pledges: readOk({ count: 1, leftCents: 125000, paidCents: 0 }), vouch: readOk(1), application: readOk({ status: "awaiting_center" }) });
    expect(lines(d, { ...opts, currency: "INR", locale: "en-IN" })[2]).toBe("A pledge of ₹1,250.00 is open.");
    const text = lines(d).join(" ");
    expect(text).not.toMatch(/household|family name|Mr\.|Mrs\./i);
  });

  it("nothing waiting is said so, in its own state", () => {
    const w = buildMemberWork(data(), opts);
    expect(w.state).toBe("clear");
    expect(w.lines).toEqual([]);
    expect(w.problems).toEqual([]);
  });
});

describe("the card for a child", () => {
  const child = data({ adult: readOk(false), application: null, vouch: null, pledges: null, events: readOk({ upcoming: 2, going: 0, open: 0 }), notices: readOk(1) });

  it("shows events and notices only", () => {
    expect(lines(child)).toEqual(["2 upcoming events to see.", "Your community has posted 1 notice."]);
  });

  it("never a pledge, a payment, a membership application, a vouch request or an RSVP, in any wording", () => {
    const text = JSON.stringify(buildMemberWork(child, opts));
    expect(text).not.toMatch(/pledge|payment|gift|boli|\$|membership application|vouch|rsvp/i);
  });

  it("not even when a caller hands the model adult data for a child", () => {
    const leaky = data({
      adult: readOk(false),
      application: readOk({ status: "awaiting_center" }),
      vouch: readOk(2),
      pledges: readOk({ count: 2, leftCents: 9900, paidCents: 0 }),
      events: readOk({ upcoming: 4, going: 3, open: 1 }),
    });
    const text = JSON.stringify(buildMemberWork(leaky, opts).lines);
    expect(text).not.toMatch(/pledge|\$|membership application|vouch|rsvp/i);
    expect(lines(leaky)).toContain("4 upcoming events to see.");
  });

  it("the intro says events and notices, not pledges", () => {
    // memberWorkIntro is exercised through the render test; here the child's state is just not an adult's.
    expect(buildMemberWork(child, opts).adult).toBe(false);
  });
});

describe("a read that failed is a line that says so, never a zero", () => {
  it("a failed pledges read: a plain sentence with the reason, and the other counts still show", () => {
    const w = buildMemberWork(
      data({ pledges: readFailed("the database could not be reached — check the connection and try again"), events: readOk({ upcoming: 1, going: 1, open: 0 }) }),
      opts,
    );
    expect(w.problems).toEqual([
      { key: "pledges", text: "Could not load your family's open pledges — the database could not be reached — check the connection and try again." },
    ]);
    expect(w.lines.map((l) => l.text)).toEqual(["Your family has RSVPd to 1 upcoming event."]);
    expect(w.state).toBe("work");
    expect(JSON.stringify(w.lines)).not.toMatch(/pledge/i);
  });

  it("each read has its own sentence", () => {
    const w = buildMemberWork(
      data({
        application: readFailed("a"),
        vouch: readFailed("b"),
        pledges: readFailed("c"),
        events: readFailed("d"),
        notices: readFailed("e"),
      }),
      opts,
    );
    expect(w.problems.map((p) => p.text)).toEqual([
      "Could not load your family's membership application — a.",
      "Could not load the requests to vouch for an applicant — b.",
      "Could not load your family's open pledges — c.",
      "Could not load your family's RSVPs and the upcoming events — d.",
      "Could not load the notices — e.",
    ]);
    expect(w.lines).toEqual([]);
    expect(w.state).toBe("work");
  });

  it("if the age cannot be checked, say so, show no money, and keep the events and notices", () => {
    const w = buildMemberWork(
      data({
        adult: readFailed("the database could not be reached — check the connection and try again"),
        application: null,
        vouch: null,
        pledges: null,
        events: readOk({ upcoming: 3, going: 0, open: 3 }),
        notices: readOk(0),
      }),
      opts,
    );
    expect(w.adult).toBeNull();
    expect(w.problems).toHaveLength(1);
    expect(w.problems[0].text).toMatch(/^Could not check which parts of your family's work you can see — /);
    expect(w.lines.map((l) => l.text)).toEqual(["3 upcoming events to see."]);
  });

  it("problemSentence trims the reason's own full stop", () => {
    expect(problemSentence("load the notices", "it failed.")).toBe("Could not load the notices — it failed.");
    expect(problemSentence("load the notices", "")).toBe("Could not load the notices — an unknown error occurred.");
  });
});

describe("the link and the sign-in that is not linked", () => {
  it("the link is on the card when the address is known, and null when it is not", () => {
    expect(buildMemberWork(data(), opts).link).toBe(URL);
    expect(buildMemberWork(data(), { ...opts, memberAppUrl: undefined }).link).toBeNull();
    expect(buildMemberWork(data(), { ...opts, memberAppUrl: "not a url" }).link).toBeNull();
  });
  it("a sign-in with no person has its own state, with no counts", () => {
    const w = buildMemberWork(data({ linked: false }), opts);
    expect(w).toMatchObject({ state: "unlinked", lines: [], problems: [], link: URL });
  });
});

// ---------------------------------------------------------------------------
// My assignments
// ---------------------------------------------------------------------------
const grant = (role_key: string, scope_kind: string, scope_id: string | null) => ({ role_key, scope_kind, scope_id });

describe("which grants are assignments", () => {
  it("one entry per event, class or zone, with every role held for it; whole-community and older scopes are not assignments", () => {
    const got = scopedAssignments([
      grant("event_lead", "event", EV),
      grant("checkin_volunteer", "event", EV),
      grant("event_lead", "event", EV),
      grant("teacher", "class", CLS),
      grant("zone_lead", "zone", ZONE),
      grant("treasurer", "center", null),
      grant("center_admin", "platform", null),
      grant("store_lead", "store", EV2),
      grant("pathshala_principal", "pathshala", EV2),
      grant("event_lead", "event", null),
    ]);
    expect(got).toEqual([
      { kind: "event", scopeId: EV, roleKeys: ["event_lead", "checkin_volunteer"] },
      { kind: "class", scopeId: CLS, roleKeys: ["teacher"] },
      { kind: "zone", scopeId: ZONE, roleKeys: ["zone_lead"] },
    ]);
  });
  it("a kind whose module the community switched off is not listed", () => {
    const grants = [grant("event_lead", "event", EV), grant("teacher", "class", CLS), grant("zone_lead", "zone", ZONE)];
    expect(scopedAssignments(grants, { modulesOff: ["pathshala"] }).map((a) => a.kind)).toEqual(["event", "zone"]);
    expect(scopedAssignments(grants, { modulesOff: ["events", "comms"] }).map((a) => a.kind)).toEqual(["class"]);
  });
  it("a person with none holds no assignment", () => {
    expect(scopedAssignments([grant("treasurer", "center", null)])).toEqual([]);
    expect(scopedAssignments([])).toEqual([]);
  });
});

const TAPASVI: EventFact = { name: "Tapasvi Dinner", status: "published", starts_at: "2026-10-19T23:00:00Z", ends_at: "2026-10-20T01:30:00Z", venue: "Main hall" };
const roleNames = new Map([
  ["event_lead", "Event lead"],
  ["checkin_volunteer", "Check-in volunteer"],
  ["boli_recorder", "Boli caller and recorder"],
  ["kitchen_lead", "Kitchen lead"],
  ["zone_lead", "Zone lead"],
  ["teacher", "Teacher"],
]);

function facts(over: Partial<AssignmentFacts> = {}): AssignmentFacts {
  return {
    events: readOk(new Map([[EV, TAPASVI]])),
    classes: readOk(new Map([[CLS, { name: "Class 2", meets_on: "sunday", starts_time: "10:00:00", room: "Room 4" }]])),
    zones: readOk(new Map([[ZONE, { name: "North" }]])),
    numbers: new Map(),
    zoneOpen: null,
    ...over,
  };
}

const card = (ctx: ScopedContext, facts_: AssignmentFacts, limit?: number) =>
  buildAssignments(ctx, scopedAssignments(ctx.grants ?? []), facts_, { timeZone: TZ, roleNames, now: NOW, limit });

describe("an event lead's assignment", () => {
  const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: EV } }]);

  it("the event, when it is, where, and the pages the lead can open", () => {
    const n = new Map([[EV, readOk({ rsvpPeople: 24, confirmed: 12, checkedIn: 3 })]]);
    const { lines, more } = card(lead, facts({ numbers: n }));
    expect(more).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "event",
      title: "Tapasvi Dinner",
      roles: ["Event lead"],
      detail: "Mon, Oct 19, 6:00 PM · Main hall",
      status: null,
      numbers: "24 people on RSVPs · 12 confirmed · 3 checked in",
      note: null,
      problem: null,
    });
    expect(lines[0].links).toEqual([
      { label: "Open the event", href: `/events/${EV}` },
      { label: "Check-in screen", href: `/ops/${EV}/checkin` },
      { label: "Kitchen display", href: `/ops/${EV}/kitchen` },
    ]);
  });

  it("the live dashboard only for someone who also holds events.view or events.manage", () => {
    const staff = viewer([{ key: "event_lead", scope: { kind: "event", id: EV } }, "event_lead"]);
    // A center-wide event lead holds events.view (seed): the live dashboard opens too.
    const { lines } = card(staff, facts());
    expect(lines[0].links.map((l) => l.href)).toContain(`/events/live?event=${EV}`);
    expect(card(lead, facts()).lines[0].links.map((l) => l.href)).not.toContain(`/events/live?event=${EV}`);
  });

  it("a draft or cancelled event says so", () => {
    const draft = card(lead, facts({ events: readOk(new Map([[EV, { ...TAPASVI, status: "draft" }]])) })).lines[0];
    expect(draft.status).toBe("Draft");
    const cancelled = card(lead, facts({ events: readOk(new Map([[EV, { ...TAPASVI, status: "cancelled", starts_at: null }]])) })).lines[0];
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.detail).toBe("No date yet · Main hall");
  });
});

describe("the other event roles open only what their role opens", () => {
  it("a check-in volunteer: the check-in screen, not the event page", () => {
    const v = viewer([{ key: "checkin_volunteer", scope: { kind: "event", id: EV } }]);
    const line = card(v, facts()).lines[0];
    expect(line.roles).toEqual(["Check-in volunteer"]);
    expect(line.links).toEqual([{ label: "Check-in screen", href: `/ops/${EV}/checkin` }]);
  });
  it("a kitchen lead for one event: the kitchen display", () => {
    const v = viewer([{ key: "kitchen_lead", scope: { kind: "event", id: EV } }]);
    expect(card(v, facts()).lines[0].links).toEqual([{ label: "Kitchen display", href: `/ops/${EV}/kitchen` }]);
  });
  it("a boli recorder has no page in the portal: said plainly, no link", () => {
    const v = viewer([{ key: "boli_recorder", scope: { kind: "event", id: EV } }]);
    const line = card(v, facts()).lines[0];
    expect(line.links).toEqual([]);
    expect(line.note).toBe("Your part of this event is done in the event-day app, not in this portal.");
    expect(line.title).toBe("Tapasvi Dinner");
  });
  it("one line for an event, whatever number of roles are held for it", () => {
    const v = viewer([
      { key: "event_lead", scope: { kind: "event", id: EV } },
      { key: "checkin_volunteer", scope: { kind: "event", id: EV } },
    ]);
    const { lines } = card(v, facts());
    expect(lines).toHaveLength(1);
    expect(lines[0].roles).toEqual(["Event lead", "Check-in volunteer"]);
  });
});

describe("a zone lead's and a teacher's assignments", () => {
  it("the zone: its name, the inbox link, the open conversations in its inbox", () => {
    const v = viewer([{ key: "zone_lead", scope: { kind: "zone", id: ZONE } }]);
    const { lines } = card(v, facts({ zoneOpen: readOk(new Map([[ZONE, 2]])) }));
    expect(lines[0]).toMatchObject({ kind: "zone", title: "North zone", roles: ["Zone lead"], numbers: "2 open conversations in the zone's inbox", problem: null });
    expect(lines[0].links).toEqual([{ label: "Open the zone inbox", href: "/comms/inbox" }]);
    expect(card(v, facts({ zones: readOk(new Map([[ZONE, { name: "North Zone" }]])) })).lines[0].title).toBe("North Zone");
  });
  it("a zone with no inbox says nothing about conversations, and a single one is singular", () => {
    const v = viewer([{ key: "zone_lead", scope: { kind: "zone", id: ZONE } }]);
    expect(card(v, facts({ zoneOpen: readOk(new Map()) })).lines[0].numbers).toBeNull();
    expect(card(v, facts({ zoneOpen: readOk(new Map([[ZONE, 1]])) })).lines[0].numbers).toBe("1 open conversation in the zone's inbox");
  });
  it("a role other than the zone lead has no inbox to open", () => {
    const v = viewer([{ key: "teacher", scope: { kind: "zone", id: ZONE } }]);
    const line = card(v, facts()).lines[0];
    expect(line.links).toEqual([]);
    expect(line.note).toBe("Nothing to open in the portal for this role.");
  });
  it("the class: when it meets, the room, the class page and its attendance", () => {
    const v = viewer([{ key: "teacher", scope: { kind: "class", id: CLS } }]);
    const line = card(v, facts()).lines[0];
    expect(line).toMatchObject({ kind: "class", title: "Class 2", roles: ["Teacher"], detail: "Sun 10 AM · Room 4" });
    expect(line.links).toEqual([
      { label: "Open the class", href: `/pathshala/classes/${CLS}` },
      { label: "Take attendance", href: `/pathshala/classes/${CLS}/attendance` },
    ]);
  });
});

describe("a read that failed, or found nothing, is said", () => {
  const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: EV } }]);

  it("the event could not be read: a plain sentence, the links the role has still there, no made-up name or date", () => {
    const line = card(lead, facts({ events: readFailed("the database could not be reached — check the connection and try again") })).lines[0];
    expect(line.title).toBe("An event");
    expect(line.detail).toBeNull();
    expect(line.problem).toBe("Could not load this event — the database could not be reached — check the connection and try again.");
    expect(line.links.map((l) => l.href)).toContain(`/events/${EV}`);
  });
  it("the numbers could not be counted: that line says so and shows no number", () => {
    const n = new Map([[EV, readFailed("you don't have permission to make this change")]]);
    const line = card(lead, facts({ numbers: n })).lines[0];
    expect(line.numbers).toBeNull();
    expect(line.problem).toBe("Could not count the people for this event — you don't have permission to make this change.");
    expect(line.title).toBe("Tapasvi Dinner");
  });
  it("the inbox could not be counted", () => {
    const v = viewer([{ key: "zone_lead", scope: { kind: "zone", id: ZONE } }]);
    const line = card(v, facts({ zoneOpen: readFailed("it failed") })).lines[0];
    expect(line.numbers).toBeNull();
    expect(line.problem).toBe("Could not count the open conversations in this zone's inbox — it failed.");
  });
  it("an event, class or zone that is not there: said, with no link", () => {
    const v = viewer([
      { key: "event_lead", scope: { kind: "event", id: EV } },
      { key: "teacher", scope: { kind: "class", id: CLS } },
      { key: "zone_lead", scope: { kind: "zone", id: ZONE } },
    ]);
    const { lines } = card(v, facts({ events: readOk(new Map()), classes: readOk(new Map()), zones: readOk(new Map()) }));
    expect(lines.map((l) => l.note)).toEqual([
      "This event could not be found. It may have been removed, or your role may not let you see it.",
      "This class could not be found. It may have been removed, or your role may not let you see it.",
      "This zone could not be found. It may have been removed, or your role may not let you see it.",
    ]);
    expect(lines.flatMap((l) => l.links)).toEqual([]);
  });
});

describe("the order and the limit", () => {
  const roles = (ids: string[]) => viewer(ids.map((id) => ({ key: "event_lead", scope: { kind: "event", id } })));
  const ev = (name: string, startsAt: string | null, status = "published"): EventFact => ({ name, status, starts_at: startsAt, ends_at: null, venue: null });

  it("events ahead come first, soonest first; undated ones next; past ones last, latest first; then classes and zones", () => {
    const ids = ["e1", "e2", "e3", "e4", "e5"];
    const map = new Map([
      ["e1", ev("Past old", "2026-09-01T18:00:00Z")],
      ["e2", ev("Later", "2026-11-01T18:00:00Z")],
      ["e3", ev("Soon", "2026-10-15T18:00:00Z")],
      ["e4", ev("Undated", null, "draft")],
      ["e5", ev("Past recent", "2026-10-10T18:00:00Z")],
    ]);
    const ctx = viewer([
      ...ids.map((id) => ({ key: "event_lead", scope: { kind: "event", id } })),
      { key: "zone_lead", scope: { kind: "zone", id: ZONE } },
      { key: "teacher", scope: { kind: "class", id: CLS } },
    ]);
    const { lines } = card(ctx, facts({ events: readOk(map) }));
    expect(lines.map((l) => l.title)).toEqual(["Soon", "Later", "Undated", "Past recent", "Past old", "Class 2", "North zone"]);
  });

  it("past the limit the rest are counted, not dropped silently", () => {
    const ids = Array.from({ length: 5 }, (_, i) => `e${i}`);
    const map = new Map(ids.map((id, i) => [id, ev(`Event ${i}`, `2026-11-0${i + 1}T18:00:00Z`)] as const));
    const { lines, more } = card(roles(ids), facts({ events: readOk(map) }), 3);
    expect(lines).toHaveLength(3);
    expect(more).toBe(2);
  });
});

describe("which events are counted", () => {
  const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: EV } }, { key: "boli_recorder", scope: { kind: "event", id: EV2 } }]);
  const map = new Map<string, EventFact>([
    [EV, TAPASVI],
    [EV2, TAPASVI],
  ]);

  it("the database lets only the event's lead, check-in or kitchen role (or events staff) see the numbers", () => {
    expect(canSeeEventNumbers(lead, EV)).toBe(true);
    expect(canSeeEventNumbers(lead, EV2)).toBe(false);
    expect(canSeeEventNumbers({ ...viewer([]), permissions: ["giving.view", "giving.manage"] }, EV)).toBe(false);
    expect(canSeeEventNumbers({ ...viewer([]), permissions: ["events.view"] }, EV)).toBe(true);
  });
  it("so the boli recorder's event is not asked", () => {
    expect(eventsToCount(lead, scopedAssignments(lead.grants ?? []), map)).toEqual([EV]);
  });
  it("drafts, cancelled and finished events are not counted", () => {
    for (const status of ["draft", "cancelled", "completed"]) {
      expect(eventsToCount(lead, scopedAssignments(lead.grants ?? []), new Map([[EV, { ...TAPASVI, status }]]))).toEqual([]);
    }
    for (const status of ["published", "rsvp_closed", "live"]) {
      expect(eventsToCount(lead, scopedAssignments(lead.grants ?? []), new Map([[EV, { ...TAPASVI, status }]]))).toEqual([EV]);
    }
  });
  it("at most the limit", () => {
    const ctx = viewer(["a", "b", "c"].map((id) => ({ key: "event_lead", scope: { kind: "event", id } })));
    const m = new Map<string, EventFact>(["a", "b", "c"].map((id) => [id, TAPASVI]));
    expect(eventsToCount(ctx, scopedAssignments(ctx.grants ?? []), m, 2)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Which cards Home shows
// ---------------------------------------------------------------------------
describe("which cards Home shows", () => {
  const none: HomeCards = { memberWork: null, assignments: null, startHere: null };
  const member: HomeCards = { memberWork: buildMemberWork(data(), opts), assignments: null, startHere: null };
  const assigned: HomeCards = { memberWork: null, assignments: { lines: [], more: 0 }, startHere: null };

  it("My tasks is shown to anyone with a staff queue, whatever else they have", () => {
    expect(showsTasksCard(true, none)).toBe(true);
    expect(showsTasksCard(true, member)).toBe(true);
    expect(showsTasksCard(true, assigned)).toBe(true);
  });
  it("a person with no queue and a card is not told there is nothing for their role", () => {
    expect(showsTasksCard(false, member)).toBe(false);
    expect(showsTasksCard(false, assigned)).toBe(false);
  });
  it("a person with neither keeps the empty My tasks card", () => {
    expect(showsTasksCard(false, none)).toBe(true);
    expect(hasHomeCards(none)).toBe(false);
    expect(hasHomeCards(member)).toBe(true);
  });
});
