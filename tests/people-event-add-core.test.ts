import { describe, expect, it } from "vitest";

import {
  ADDABLE_STATUSES,
  CHILD_FLAG_AGE,
  SENIOR_FLAG_AGE,
  addableEvents,
  attendeeFlags,
  attendeeStatusFor,
  audienceNote,
  confirmQuestion,
  defaultChosen,
  doneSentences,
  isUpcoming,
  joinNames,
  mayAddToAnyEvent,
  mayAddToEvent,
  personChoices,
  planAdd,
  sayNames,
  seatCheck,
  windowNote,
  type Candidate,
  type EventRow,
  type FamilyMember,
  type PlanInput,
} from "@/lib/people-v2/event-add";
import type { EventAccess } from "@/lib/events/access";

// The pure core of "Add to an event". Names are in more than one script on purpose: the rules never look at what a name is made of.

const NOW = new Date("2026-10-12T15:00:00Z");

const ev = (over: Partial<EventRow> = {}): EventRow => ({
  id: "e1",
  name: "Spring Picnic",
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

const member = (id: string, name: string, over: Partial<FamilyMember> = {}): FamilyMember => ({ id, name, firstName: name.split(" ")[0], isChild: false, age: 40, deceased: false, ...over });
const SAMIRA = member("p-samira", "Samira Hassan");
const LAYLA = member("p-layla", "Layla Hassan", { isChild: true, age: 9 });
const OMAR = member("p-omar", "Omar Hassan", { isChild: true, age: 6 });
const KARIM = member("p-karim", "Karim Hassan", { deceased: true });
const cand = (m: FamilyMember): Candidate => ({ id: m.id, name: m.name, firstName: m.firstName, isChild: m.isChild });

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  eventName: "Spring Picnic",
  capacity: null,
  waitlist: false,
  seatsTaken: null,
  existingStatus: null,
  onIt: [],
  chosen: [cand(SAMIRA), cand(LAYLA)],
  confirmed: false,
  ...over,
});

describe("the two attendee flags", () => {
  it("means under 12 and 65 or over, on the day of the event", () => {
    expect([CHILD_FLAG_AGE, SENIOR_FLAG_AGE]).toEqual([12, 65]);
    expect(attendeeFlags("2014-10-19", "2026-10-18")).toEqual({ is_child_under_12: true, is_senior: false });
    // Turns 12 on the day of the event: not under 12 any more.
    expect(attendeeFlags("2014-10-18", "2026-10-18")).toEqual({ is_child_under_12: false, is_senior: false });
    expect(attendeeFlags("1961-10-18", "2026-10-18")).toEqual({ is_child_under_12: false, is_senior: true });
    expect(attendeeFlags("1961-10-19", "2026-10-18")).toEqual({ is_child_under_12: false, is_senior: false });
  });
  it("never guesses: no birth date, or no event date, means neither flag", () => {
    expect(attendeeFlags(null, "2026-10-18")).toEqual({ is_child_under_12: false, is_senior: false });
    expect(attendeeFlags(undefined, "2026-10-18")).toEqual({ is_child_under_12: false, is_senior: false });
    expect(attendeeFlags("2020-01-01", null)).toEqual({ is_child_under_12: false, is_senior: false });
    expect(attendeeFlags("not a date", "2026-10-18")).toEqual({ is_child_under_12: false, is_senior: false });
  });
  it("counts a baby born after the event as no one (a future date is not an age)", () => {
    expect(attendeeFlags("2027-01-01", "2026-10-18")).toEqual({ is_child_under_12: false, is_senior: false });
  });
});

describe("which events are offered", () => {
  it("offers published, closed-for-RSVPs and live events that have not finished, soonest first", () => {
    const rows = [
      ev({ id: "later", name: "Later", starts_at: "2026-11-01T17:00:00Z", ends_at: null }),
      ev({ id: "soon", name: "Soon" }),
      ev({ id: "closed", name: "Closed", status: "rsvp_closed", starts_at: "2026-10-15T17:00:00Z" }),
      ev({ id: "now", name: "Under way", status: "live", starts_at: "2026-10-12T13:00:00Z", ends_at: "2026-10-12T18:00:00Z" }),
    ];
    expect(addableEvents(rows, NOW).map((e) => e.id)).toEqual(["now", "closed", "soon", "later"]);
    expect(ADDABLE_STATUSES).toEqual(["published", "rsvp_closed", "live"]);
  });
  it("leaves out a draft, a cancelled or finished event, one that is over, and one with no date", () => {
    const rows = [
      ev({ id: "draft", status: "draft" }),
      ev({ id: "cancelled", status: "cancelled" }),
      ev({ id: "completed", status: "completed" }),
      ev({ id: "over", starts_at: "2026-10-12T09:00:00Z", ends_at: "2026-10-12T12:00:00Z" }),
      ev({ id: "undated", starts_at: null, ends_at: null }),
    ];
    expect(addableEvents(rows, NOW)).toEqual([]);
  });
  it("reads an event with no end time as six hours long, as the member app does", () => {
    expect(isUpcoming({ starts_at: "2026-10-12T09:30:00Z", ends_at: null }, NOW)).toBe(true);
    expect(isUpcoming({ starts_at: "2026-10-12T08:30:00Z", ends_at: null }, NOW)).toBe(false);
  });
  it("explains in a note when members cannot RSVP yet or any more, and says staff still can", () => {
    expect(windowNote({ status: "published", rsvp_opens_at: null, rsvp_closes_at: null }, NOW)).toBeNull();
    expect(windowNote({ status: "rsvp_closed", rsvp_opens_at: null, rsvp_closes_at: null }, NOW)).toMatch(/closed.*by hand/);
    expect(windowNote({ status: "published", rsvp_opens_at: null, rsvp_closes_at: "2026-10-11T00:00:00Z" }, NOW)).toMatch(/closed/);
    expect(windowNote({ status: "published", rsvp_opens_at: "2026-10-13T00:00:00Z", rsvp_closes_at: null }, NOW)).toMatch(/not opened yet.*by hand/);
  });
  it("names who an event is for only when it is not open to everyone, without a tradition's words", () => {
    expect(audienceNote("members_only")).toBe("For members");
    expect(audienceNote("pathshala_families")).toBe("For families enrolled in classes");
    expect(audienceNote("public")).toBeNull();
    expect(audienceNote("members_and_guests")).toBeNull();
    expect(audienceNote(null)).toBeNull();
  });
});

describe("who may add", () => {
  const access = (over: Partial<EventAccess>): EventAccess => ({ permissions: [], isPlatformAdmin: false, isOwner: false, grants: [], ...over });
  const grant = (role_key: string, scope_id: string | null, scope_kind = "event") => ({ role_key, scope_kind, scope_id, starts_at: "2026-01-01T00:00:00Z", ends_at: null });

  it("is the gate that edits an event: event managers, and an event's lead for that event", () => {
    expect(mayAddToAnyEvent(access({ permissions: ["events.manage"] }))).toBe(true);
    expect(mayAddToEvent(access({ permissions: ["events.manage"] }), "e1")).toBe(true);
    const lead = access({ grants: [grant("event_lead", "e1")] });
    expect(mayAddToAnyEvent(lead)).toBe(true);
    expect(mayAddToEvent(lead, "e1")).toBe(true);
    expect(mayAddToEvent(lead, "e2")).toBe(false);
  });
  it("is not given to someone who only looks at events, or only checks people in", () => {
    expect(mayAddToAnyEvent(access({ permissions: ["events.view"] }))).toBe(false);
    expect(mayAddToAnyEvent(access({ grants: [grant("checkin_volunteer", "e1")] }))).toBe(false);
    expect(mayAddToEvent(access({ grants: [grant("checkin_volunteer", "e1")] }), "e1")).toBe(false);
  });
});

describe("who can be chosen", () => {
  it("marks people already on the event's RSVP and the deceased, and leaves everyone else free", () => {
    const rows = personChoices([SAMIRA, LAYLA, KARIM], new Set(["p-layla"]));
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      ["Samira Hassan", "free"],
      ["Layla Hassan", "on_it"],
      ["Karim Hassan", "deceased"],
    ]);
  });
  it("lists children too: this is the staff screen", () => {
    expect(personChoices([SAMIRA, LAYLA, OMAR], []).filter((r) => r.isChild && r.state === "free")).toHaveLength(2);
  });
  it("ticks the person it was opened from, if they can be added; otherwise nobody", () => {
    expect(defaultChosen(personChoices([SAMIRA, LAYLA], []), "p-layla")).toEqual(["p-layla"]);
    expect(defaultChosen(personChoices([SAMIRA, LAYLA], ["p-layla"]), "p-layla")).toEqual([]);
    expect(defaultChosen(personChoices([SAMIRA, LAYLA], []), null)).toEqual([]);
    expect(defaultChosen(personChoices([KARIM], []), "p-karim")).toEqual([]);
  });
});

describe("words", () => {
  it("joins names the way a person says them", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Samira"])).toBe("Samira");
    expect(joinNames(["Samira", "Layla"])).toBe("Samira and Layla");
    expect(joinNames(["Samira", "Layla", "Omar"])).toBe("Samira, Layla and Omar");
  });
  it("says first names, and full names when two people share a first name", () => {
    expect(sayNames([SAMIRA, LAYLA])).toBe("Samira and Layla");
    const twins = [member("a", "Ali Khan"), member("b", "Ali Hassan")];
    expect(sayNames(twins)).toBe("Ali Khan and Ali Hassan");
  });
  it("works in any script", () => {
    const japanese = member("p-1", "田中 美咲", { firstName: "美咲" });
    const arabic = member("p-2", "ليلى حسن", { firstName: "ليلى" });
    expect(sayNames([japanese, arabic])).toBe("美咲 and ليلى");
    expect(confirmQuestion([cand(japanese), cand(arabic)], "春の清掃")).toBe("Add 美咲 and ليلى to 春の清掃?");
  });
  it("asks the one question the owner asked for", () => {
    expect(confirmQuestion([cand(SAMIRA), cand(LAYLA)], "Spring Picnic")).toBe("Add Samira and Layla to Spring Picnic?");
  });
});

describe("the places left (the member app's rule)", () => {
  const base = { capacity: 10, waitlist: false, seatsTaken: 6, adding: 2, existing: "none" as const };
  it("is open when there is no limit, or the people fit", () => {
    expect(seatCheck({ ...base, capacity: null })).toEqual({ kind: "open", left: null });
    expect(seatCheck(base)).toEqual({ kind: "open", left: 4 });
    expect(seatCheck({ ...base, adding: 4 })).toEqual({ kind: "open", left: 4 });
  });
  it("puts a new RSVP that does not fit on the waitlist when the event has one, and refuses it when not", () => {
    expect(seatCheck({ ...base, adding: 5, waitlist: true })).toEqual({ kind: "waitlist", left: 4 });
    expect(seatCheck({ ...base, adding: 5 })).toEqual({ kind: "full", left: 4 });
    expect(seatCheck({ ...base, seatsTaken: 10, waitlist: true })).toEqual({ kind: "waitlist", left: 0 });
  });
  it("takes no seat when the family's RSVP is already on the waitlist", () => {
    expect(seatCheck({ ...base, seatsTaken: 10, adding: 3, existing: "waitlisted" })).toEqual({ kind: "waitlist", left: 0 });
  });
  it("refuses, even with a waitlist, to add too many to a live RSVP (one RSVP cannot be partly waitlisted)", () => {
    expect(seatCheck({ ...base, adding: 5, waitlist: true, existing: "live" })).toEqual({ kind: "full", left: 4 });
  });
  it("says it does not know when there is a limit and no count", () => {
    expect(seatCheck({ ...base, seatsTaken: null })).toEqual({ kind: "unknown" });
    expect(seatCheck({ ...base, capacity: null, seatsTaken: null })).toEqual({ kind: "open", left: null });
  });
  it("never reports less than zero left", () => {
    expect(seatCheck({ ...base, seatsTaken: 14, adding: 1 })).toEqual({ kind: "full", left: 0 });
  });
});

describe("the plan", () => {
  it("makes a new RSVP, RSVP'd, when the family has none", () => {
    const plan = planAdd(input());
    expect(plan).toMatchObject({ kind: "add", mode: "create", rsvpStatus: "rsvpd", attendeeStatus: "rsvpd", waitlisted: false, already: [] });
    expect(plan.kind === "add" && plan.toAdd.map((c) => c.id)).toEqual(["p-samira", "p-layla"]);
    expect(plan.kind === "add" && plan.notes).toEqual([]);
  });
  it("makes it confirmed when staff say the family already said yes", () => {
    expect(planAdd(input({ confirmed: true }))).toMatchObject({ kind: "add", rsvpStatus: "confirmed", attendeeStatus: "confirmed" });
  });
  it("adds to the family's live RSVP instead of making a second one, keeping its status", () => {
    const plan = planAdd(input({ existingStatus: "confirmed", onIt: ["p-samira"], chosen: [cand(SAMIRA), cand(LAYLA)], confirmed: true }));
    expect(plan).toMatchObject({ kind: "add", mode: "extend", rsvpStatus: "confirmed", attendeeStatus: "confirmed" });
    expect(plan.kind === "add" && plan.toAdd.map((c) => c.id)).toEqual(["p-layla"]);
    expect(plan.kind === "add" && plan.already.map((c) => c.id)).toEqual(["p-samira"]);
    expect(plan.kind === "add" && plan.notes.join(" ")).toMatch(/already has an RSVP.*Layla/);
    expect(plan.kind === "add" && plan.notes.join(" ")).toMatch(/Samira is already on it/);
  });
  it("says plainly when everyone chosen is already on it, and writes nothing", () => {
    const plan = planAdd(input({ existingStatus: "rsvpd", onIt: ["p-samira", "p-layla"] }));
    expect(plan).toEqual({ kind: "unchanged", already: [cand(SAMIRA), cand(LAYLA)], text: "Samira and Layla are already on Spring Picnic. Nothing was changed." });
    expect(planAdd(input({ existingStatus: "rsvpd", onIt: ["p-samira"], chosen: [cand(SAMIRA)] }))).toMatchObject({ text: "Samira is already on Spring Picnic. Nothing was changed." });
  });
  it("asks for at least one person", () => {
    expect(planAdd(input({ chosen: [] }))).toEqual({ kind: "refuse", why: "nobody", text: "Choose at least one person." });
  });
  it("goes on the waitlist when the event is full and has one", () => {
    const plan = planAdd(input({ capacity: 10, waitlist: true, seatsTaken: 9 }));
    expect(plan).toMatchObject({ kind: "add", mode: "create", rsvpStatus: "waitlisted", attendeeStatus: "waitlisted", waitlisted: true });
    expect(plan.kind === "add" && plan.notes[0]).toBe("Spring Picnic is full, so Samira and Layla will go on the waitlist (there is room for 1, and 2 were chosen).");
    // Full to the last place: no "room for" aside.
    const full = planAdd(input({ capacity: 10, waitlist: true, seatsTaken: 10 }));
    expect(full.kind === "add" && full.notes[0]).toBe("Spring Picnic is full, so Samira and Layla will go on the waitlist.");
  });
  it("ignores 'already confirmed' for a family that has to wait", () => {
    expect(planAdd(input({ capacity: 10, waitlist: true, seatsTaken: 10, confirmed: true }))).toMatchObject({ rsvpStatus: "waitlisted" });
  });
  it("refuses with the reason when the event is full and cannot wait", () => {
    expect(planAdd(input({ capacity: 10, seatsTaken: 10 }))).toEqual({
      kind: "refuse",
      why: "full",
      text: "Spring Picnic is full: all 10 places are taken. Choose fewer people, or ask an event manager to raise the limit or turn on the waitlist.",
    });
    expect(planAdd(input({ capacity: 10, seatsTaken: 9 }))).toMatchObject({
      kind: "refuse",
      why: "full",
      text: "Spring Picnic has room for 1 more person, and 2 were chosen. Choose fewer people, or ask an event manager to raise the limit or turn on the waitlist.",
    });
  });
  it("explains that a live RSVP cannot be partly waitlisted", () => {
    const plan = planAdd(input({ capacity: 10, waitlist: true, seatsTaken: 9, existingStatus: "rsvpd", onIt: ["p-samira"], chosen: [cand(LAYLA), cand(member("p-omar", "Omar Hassan"))] }));
    expect(plan).toMatchObject({ kind: "refuse", why: "full" });
    expect(plan.kind === "refuse" && plan.text).toMatch(/already has an RSVP, so the extra people cannot go on the waitlist/);
  });
  it("lets people join a waitlisted RSVP, which takes no seat", () => {
    const plan = planAdd(input({ capacity: 10, waitlist: true, seatsTaken: 10, existingStatus: "waitlisted", onIt: [], chosen: [cand(LAYLA)] }));
    expect(plan).toMatchObject({ kind: "add", mode: "extend", rsvpStatus: "waitlisted", attendeeStatus: "waitlisted", waitlisted: true });
  });
  it("refuses when the places taken could not be counted, rather than adding blind", () => {
    const plan = planAdd(input({ capacity: 10, seatsTaken: null }));
    expect(plan).toMatchObject({ kind: "refuse", why: "unknown" });
    expect(plan.kind === "refuse" && plan.text).toBe("Could not check how many places are left on Spring Picnic, so nobody was added. Try again.");
  });
  it("gives an attendee the status of the RSVP they are on", () => {
    expect(attendeeStatusFor("confirmed")).toBe("confirmed");
    expect(attendeeStatusFor("waitlisted")).toBe("waitlisted");
    for (const s of ["rsvpd", "invited", "attended", "no_show"]) expect(attendeeStatusFor(s)).toBe("rsvpd");
  });
});

describe("what is said afterwards", () => {
  const add = (over: Partial<PlanInput> = {}) => {
    const p = planAdd(input(over));
    if (p.kind !== "add") throw new Error("expected a plan to add");
    return p;
  };
  it("says who is on the event, and keeps the toast short", () => {
    expect(doneSentences(add(), "Spring Picnic")).toEqual({ message: "Samira and Layla are on Spring Picnic.", toast: "Added Samira and Layla to Spring Picnic." });
    expect(doneSentences(add({ chosen: [cand(SAMIRA)] }), "Spring Picnic").message).toBe("Samira is on Spring Picnic.");
    expect(doneSentences(add({ confirmed: true }), "Spring Picnic").message).toBe("Samira and Layla are on Spring Picnic, confirmed.");
  });
  it("says it when they went on the waitlist", () => {
    expect(doneSentences(add({ capacity: 5, waitlist: true, seatsTaken: 5 }), "Spring Picnic").message).toBe("Samira and Layla are on the waitlist for Spring Picnic.");
  });
  it("says it when the family's own RSVP was used, and who was there already", () => {
    const said = doneSentences(add({ existingStatus: "rsvpd", onIt: ["p-samira"] }), "Spring Picnic");
    expect(said.message).toBe("Added Layla to Spring Picnic, on the family's RSVP. Samira is already on it.");
    expect(said.toast).toBe("Added Layla to Spring Picnic.");
  });
});
