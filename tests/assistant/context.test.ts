import { describe, expect, it } from "vitest";

import { areaForPath, contextLine, routeContext, suggestionsFor } from "@/lib/assistant/context";

const EVENT = "3f2b8d3e-1c1a-4a53-9f55-7a1d2d9f0c11";
const HOUSEHOLD = "9b9a5f0e-4d6a-4e0b-8f6a-0c2c3b7a1d22";

describe("route context", () => {
  it("turns an event page into a pattern plus the id", () => {
    expect(routeContext(`/events/${EVENT}`, { id: EVENT })).toEqual({ path: "/events/[id]", entityKind: "event", entityId: EVENT });
  });

  it("never lets an id outside entityId", () => {
    const ctx = routeContext(`/events/${EVENT}`, { id: EVENT });
    expect(JSON.stringify({ ...ctx, entityId: undefined })).not.toContain(EVENT);
    // Even when Next gave no params, a raw UUID in the path is replaced.
    const bare = routeContext(`/households/${HOUSEHOLD}`);
    expect(bare).toEqual({ path: "/households/[id]", entityKind: "household", entityId: HOUSEHOLD });
    expect(bare.path).not.toContain(HOUSEHOLD);
  });

  it("drops the query string and hash, and a trailing slash", () => {
    expect(routeContext("/giving/payments?search=Rahul%20Shah&page=2#top", {})).toEqual({ path: "/giving/payments" });
    expect(routeContext(`/events/${EVENT}/?tab=rsvps`, { id: EVENT }).path).toBe("/events/[id]");
  });

  it("works for a list page and for the home page", () => {
    expect(routeContext("/events", {})).toEqual({ path: "/events" });
    expect(routeContext("/", null)).toEqual({ path: "/" });
    expect(routeContext("", undefined)).toEqual({ path: "/" });
  });

  it("names the kind of thing from the screen it is", () => {
    expect(routeContext("/people/abc", { id: "abc" })).toMatchObject({ path: "/people/[id]", entityKind: "person", entityId: "abc" });
    expect(routeContext("/pathshala/classes/c1", { id: "c1" })).toMatchObject({ entityKind: "class" });
    expect(routeContext("/events/feedback/s1", { surveyId: "s1" })).toEqual({ path: "/events/feedback/[surveyId]", entityKind: "event survey", entityId: "s1" });
    expect(routeContext("/comms/threads/t1", { id: "t1" })).toMatchObject({ entityKind: "message thread" });
  });

  it("a dynamic part that is not an id (a kind of import) stays in the pattern but is not an entity", () => {
    const ctx = routeContext("/settings/import/template/households", { entity: "households" });
    expect(ctx).toEqual({ path: "/settings/import/template/[entity]" });
  });

  it("decodes percent-encoded values when matching, and keeps the real id", () => {
    expect(routeContext("/people/a%20b", { id: "a b" })).toEqual({ path: "/people/[id]", entityKind: "person", entityId: "a b" });
  });

  it("a value that is also a word elsewhere in the path replaces only the matching segment once", () => {
    expect(routeContext("/events/events", { id: "events" })).toEqual({ path: "/events/[id]", entityKind: "event", entityId: "events" });
  });

  it("a catch-all part covers several segments", () => {
    expect(routeContext("/site/a/b", { missing: ["a", "b"] })).toEqual({ path: "/site/[...missing]" });
  });

  it("sends nothing but path, entityKind and entityId", () => {
    const ctx = routeContext(`/events/${EVENT}?name=Diwali`, { id: EVENT });
    expect(Object.keys(ctx).sort()).toEqual(["entityId", "entityKind", "path"]);
  });
});

describe("the area of a screen", () => {
  it("groups screens into the areas the suggestions know", () => {
    expect(areaForPath("/households/[id]")).toBe("people");
    expect(areaForPath("/giving/payments")).toBe("giving");
    expect(areaForPath("/bolis")).toBe("giving");
    expect(areaForPath("/accounting/qbo")).toBe("accounting");
    expect(areaForPath("/events/[id]")).toBe("events");
    expect(areaForPath("/comms/campaigns")).toBe("messages");
    expect(areaForPath("/")).toBe("general");
    expect(areaForPath("/settings/access")).toBe("general");
  });

  it("says what Niva is looking at, in words", () => {
    expect(contextLine({ path: "/events/[id]", entityKind: "event", entityId: "x" })).toBe("Looking at this event");
    expect(contextLine({ path: "/giving/payments" })).toBe("Looking at Giving");
    expect(contextLine({ path: "/" })).toBe("Looking at Home");
    expect(contextLine({ path: "/settings/access" })).toBe("Looking at this page");
  });
});

describe("Ask Niva suggestions", () => {
  const all = new Set(["people.search", "tasks.mine", "giving.pledges_behind", "accounting.month_close_blockers", "events.upcoming", "events.set_field", "messages.draft_reminder"]);

  it("gives up to three plain sentences for each area", () => {
    for (const path of ["/households", "/giving/payments", "/events", "/comms/campaigns", "/"]) {
      const list = suggestionsFor(path, undefined, all);
      expect(list.length).toBeGreaterThan(0);
      expect(list.length).toBeLessThanOrEqual(3);
      for (const s of list) expect(s).toMatch(/[a-z]/);
    }
    expect(suggestionsFor("/giving/payments", undefined, all)).toContain("Who is behind on pledges?");
  });

  it("offers the Giving sentences a role can use, the three most useful first", () => {
    const giving = new Set([
      "giving.pledges_behind",
      "giving.draft_payment",
      "giving.zelle_waiting",
      "giving.bank_lines_unmatched",
      "giving.waiting_for_second_approver",
      "giving.household_summary",
      "accounting.month_close_blockers",
    ]);
    expect(suggestionsFor("/giving/payments", undefined, giving)).toEqual([
      "Who is behind on pledges?",
      "Record a $250 check from member number 1042",
      "Which Zelle reports are waiting for the bank?",
    ]);
    // A volunteer who can only record payments is offered the recording sentence and the bank lines, not the approvals.
    const volunteer = new Set(["giving.draft_payment", "giving.bank_lines_unmatched", "tasks.mine"]);
    expect(suggestionsFor("/giving/payments/bank", undefined, volunteer)).toEqual(["Record a $250 check from member number 1042", "Which bank lines are still unmatched?"]);
    // A person is never offered a sentence that names a child: the examples describe a member number, not a person.
    for (const s of suggestionsFor("/giving/pledges", undefined, giving)) expect(s).not.toMatch(/bid/i);
  });

  it("offers 'this event' only on an event page", () => {
    const onEvent = suggestionsFor("/events/[id]", "event", all);
    expect(onEvent.some((s) => s.includes("this event"))).toBe(true);
    const onList = suggestionsFor("/events", undefined, all);
    expect(onList.some((s) => s.includes("this event"))).toBe(false);
  });

  it("never offers what the person's role cannot do", () => {
    const noGiving = new Set(["tasks.mine", "events.upcoming"]);
    const list = suggestionsFor("/giving/payments", undefined, noGiving);
    expect(list).not.toContain("Who is behind on pledges?");
    // Nothing of its own left: falls back to the general examples that are allowed.
    expect(list).toEqual(["What is waiting for me?", "What events are coming up?"]);
  });

  it("offers the Events examples a role can use, first the ones about this event", () => {
    const events = new Set(["events.upcoming", "events.summary", "events.readiness", "events.audience_preview", "events.clone_draft", "messages.draft_reminder", "events.set_field"]);
    expect(suggestionsFor("/events/[id]", "event", events)).toEqual([
      "What is blocking this event from going live?",
      "How is this event doing: RSVPs, lunch and volunteers?",
      "How many people would a reminder for this event reach, and when would it go out?",
    ]);
    // Without those, the next ones the role may use.
    expect(suggestionsFor("/events/[id]", "event", new Set(["messages.draft_reminder", "events.set_field", "events.upcoming"]))).toEqual([
      "Draft a reminder for this event in English, Gujarati and Hindi",
      "Move this event to the second Saturday of November",
      "Change the venue of this event to the main hall",
    ]);
    expect(suggestionsFor("/events", undefined, events)).toEqual(["What events are coming up?", "Copy last year's Diwali Dinner to November 8 as a draft", "Draft a reminder for the next event"]);
    // The examples never name a child.
    for (const s of suggestionsFor("/events/[id]", "event", events)) expect(s).not.toMatch(/\b(child|kid|minor)\b/i);
  });

  it("offers People examples for the commands the person may use, and 'this household' only on a household", () => {
    const people = new Set(["people.search", "people.find_household", "people.pending_reviews", "people.suggest_duplicates", "people.household_summary", "people.add_person", "people.update_person"]);
    expect(suggestionsFor("/people", undefined, people)).toEqual([
      "Find the household with member number 1042",
      "Which applications and family requests are waiting?",
      "Find the household with QuickBooks customer 2217",
    ]);
    expect(suggestionsFor("/households/[id]", "household", people)).toEqual([
      "Show everything we have on this household, including its IDs",
      "Add a spouse to this household",
      "Find the household with member number 1042",
    ]);
    expect(suggestionsFor("/people/[id]", "person", people)[0]).toBe("Change this person's mobile number");
    // A role that cannot change people is not offered a change.
    const lookOnly = new Set(["people.search", "people.pending_reviews"]);
    expect(suggestionsFor("/households/[id]", "household", lookOnly).some((s) => s.startsWith("Add a spouse"))).toBe(false);
  });

  it("offers nothing when the person can use nothing", () => {
    expect(suggestionsFor("/giving/payments", undefined, new Set())).toEqual([]);
  });
});
