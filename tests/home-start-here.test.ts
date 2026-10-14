import { describe, expect, it } from "vitest";

import { buildStartHere, countShiftsWithFreePlaces, startScreenFor, wantsStartHere, type StartScreen } from "@/lib/home/start-here";
import { readFailed, readOk } from "@/lib/home/read";
import type { ScopedContext } from "@/lib/permissions";

import { CHURCH, JAIN } from "./fixtures/kinds";

// "Start here" (docs/DEMO_ROLE_WORK.md): for a person who holds a screen but no queue and no other Home card. The screen comes from the
// permissions the person holds and the navigation they can open, never from a role key.

/** A person holding these permissions center-wide, whatever their role is called. */
function holding(permissions: string[], over: Partial<ScopedContext> = {}): ScopedContext {
  return { permissions, isPlatformAdmin: false, isOwner: false, modulesOff: [], grants: [], ...over };
}

// The permissions of the six roles, as supabase/seed.sql gives them. They are written out here on purpose: the point is that the card follows the
// permissions, so a role the community cloned, renamed or built itself with the same permissions gets the same card.
const EXECUTIVE_VIEWER = ["reports.view", "events.view", "bolis.view", "store.view", "content.view", "comms.view", "governance.view"];
const CONTENT_EDITOR = ["content.view", "content.draft"];
const VOLUNTEER_COORDINATOR = ["volunteers.view", "volunteers.manage", "safety.view", "safety.manage", "events.view"];
const STORE_PICKUP = ["store.pickup"];
const KITCHEN_LEAD = ["kitchen.view"];
const PATHSHALA_COMMITTEE = ["pathshala.view", "events.view", "events.manage", "governance.view", "governance.vote"];

const start = (permissions: string[], over: Partial<ScopedContext> = {}) => startScreenFor(holding(permissions, over));

describe("the screen each of the six starts from", () => {
  it("the executive viewer: Reports", () => {
    expect(start(EXECUTIVE_VIEWER)).toEqual({ key: "reports", screen: "Reports › Center health", href: "/reports", sentence: "Reports › Center health shows how your community is doing." });
  });
  it("the content editor: Content › Library", () => {
    expect(start(CONTENT_EDITOR)).toEqual({
      key: "content",
      screen: "Content › Library",
      href: "/content/library",
      sentence: "Your work is in Content › Library: the drafts you write and send for approval.",
    });
  });
  it("the volunteer coordinator: Events › Volunteers", () => {
    expect(start(VOLUNTEER_COORDINATOR)).toEqual({
      key: "volunteers",
      screen: "Events › Volunteers",
      href: "/events/volunteers",
      sentence: "Your work is in Events › Volunteers: the volunteer groups, who has signed up, and the shifts.",
    });
  });
  it("the store pickup volunteer and the kitchen lead: My Store › Orders by pickup", () => {
    for (const perms of [STORE_PICKUP, KITCHEN_LEAD]) {
      expect(start(perms)).toEqual({
        key: "store",
        screen: "My Store › Orders by pickup",
        href: "/store/orders",
        sentence: "Your work is in My Store › Orders by pickup: the orders to prepare and hand out, by pickup slot.",
      });
    }
  });
  it("the Pathshala committee: Pathshala › Committee", () => {
    expect(start(PATHSHALA_COMMITTEE)).toEqual({
      key: "committee",
      screen: "Pathshala › Committee",
      href: "/pathshala/committee",
      sentence: "Your work is in Pathshala › Committee: the actions and events of the next two weeks.",
    });
  });
});

describe("it follows permissions, not role keys", () => {
  it("a grant of any role name makes no difference: only what is held counts", () => {
    const named = holding(CONTENT_EDITOR, { grants: [{ role_key: "our_custom_scribe", scope_kind: "center", scope_id: null }] });
    expect(startScreenFor(named)?.href).toBe("/content/library");
    expect(startScreenFor(holding(CONTENT_EDITOR, { grants: [{ role_key: "treasurer", scope_kind: "center", scope_id: null }] }))?.href).toBe("/content/library");
  });

  it("the community's own words for a module name the screen: a church's store is its Bookshop, its school the Sunday school", () => {
    expect(start(KITCHEN_LEAD, { kind: CHURCH })?.screen).toBe("Bookshop › Orders by pickup");
    expect(start(PATHSHALA_COMMITTEE, { kind: CHURCH })?.screen).toBe("Sunday school › Committee");
    expect(start(PATHSHALA_COMMITTEE, { kind: JAIN })?.screen).toBe("Pathshala › Committee");
  });

  it("the first screen that fits wins: a reader of reports who also writes drafts starts at Reports", () => {
    expect(start([...CONTENT_EDITOR, "reports.view"])?.key).toBe("reports");
    expect(start([...STORE_PICKUP, ...CONTENT_EDITOR])?.key).toBe("content");
  });

  it("the work screen is narrower than who may open it: the executive viewer may open Orders by pickup (store.view), but starts at Reports", () => {
    expect(start(["store.view"])?.key).toBe("nav");
    expect(start(["store.view"])?.screen).toBe("My Store › Inventory");
  });
});

describe("what hides a screen", () => {
  it("a module the community switched off: that screen is skipped, and the next that fits is named", () => {
    // With Content off the editor still opens the Calendar (content.draft is one of its permissions), so that is named.
    expect(start(CONTENT_EDITOR, { modulesOff: ["content"] })).toMatchObject({ key: "nav", href: "/calendar" });
    const off = start(VOLUNTEER_COORDINATOR, { modulesOff: ["volunteers"] });
    expect(off).toMatchObject({ key: "nav", href: "/events", screen: "Events › All events" });
    expect(start(STORE_PICKUP, { modulesOff: ["store"] })).toBeNull();
  });

  it("someone who holds a permission but not the screen's own work (a safety-only reader sees the volunteers page)", () => {
    expect(start(["safety.view"])?.key).toBe("volunteers");
    // Holding reports of people or giving opens Reports by the page's rule, but the card is for the one who reads the report.
    expect(start(["people.view"])?.key).toBe("nav");
  });

  it("a person with no screen at all has no card to name", () => {
    expect(start([])).toBeNull();
  });
});

describe("whether Home carries it", () => {
  const ctxWithQueue = holding(["giving.view", "giving.manage", "giving.approve", "giving.record_offline"]);
  const ctxNoQueue = holding(CONTENT_EDITOR);
  const none = { memberWork: false, assignments: false };

  it("a person with no queue and no other card does", () => {
    expect(wantsStartHere(ctxNoQueue, none)).toBe(true);
  });
  it("never for a person who already has a queue, My assignments or the member-app card", () => {
    expect(wantsStartHere(ctxWithQueue, none)).toBe(false);
    expect(wantsStartHere(ctxNoQueue, { memberWork: false, assignments: true })).toBe(false);
    expect(wantsStartHere(ctxNoQueue, { memberWork: true, assignments: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What waits there
// ---------------------------------------------------------------------------
const SCREEN: StartScreen = { key: "content", screen: "Content › Library", href: "/content/library", sentence: "Your work is in Content › Library: the drafts you write and send for approval." };

describe("what waits on the screen", () => {
  it("drafts to finish", () => {
    expect(buildStartHere(SCREEN, { drafts: readOk(2) })).toMatchObject({ lines: ["2 drafts to finish."], problems: [] });
    expect(buildStartHere(SCREEN, { drafts: readOk(1) }).lines).toEqual(["1 draft to finish."]);
  });
  it("the volunteer coordinator's counts", () => {
    const s: StartScreen = { key: "volunteers", screen: "Events › Volunteers", href: "/events/volunteers", sentence: "x" };
    expect(buildStartHere(s, { askedToVolunteer: readOk(3), shiftsWithFreePlaces: readOk(3) }).lines).toEqual(["3 people asked to volunteer.", "3 shifts with free places."]);
    expect(buildStartHere(s, { askedToVolunteer: readOk(1), shiftsWithFreePlaces: readOk(1) }).lines).toEqual(["1 person asked to volunteer.", "1 shift with free places."]);
  });
  it("orders waiting for pickup", () => {
    const s: StartScreen = { key: "store", screen: "My Store › Orders by pickup", href: "/store/orders", sentence: "x" };
    expect(buildStartHere(s, { ordersWaiting: readOk(2) }).lines).toEqual(["2 orders waiting for pickup."]);
  });
  it("the committee's actions", () => {
    const s: StartScreen = { key: "committee", screen: "Pathshala › Committee", href: "/pathshala/committee", sentence: "x" };
    expect(buildStartHere(s, { committee: readOk({ atRisk: 2, unassigned: 3 }) }).lines).toEqual([
      "2 actions overdue or due within 3 days.",
      "3 actions in the next two weeks with no owner.",
    ]);
    expect(buildStartHere(s, { committee: readOk({ atRisk: 1, unassigned: 0 }) }).lines).toEqual(["1 action overdue or due within 3 days."]);
  });
  it("nothing waiting is said so, so a blank card is never read as a broken one", () => {
    expect(buildStartHere(SCREEN, { drafts: readOk(0) })).toMatchObject({ lines: ["Nothing is waiting right now."], problems: [] });
  });
  it("a screen with nothing to count (Reports) has just its sentence", () => {
    const s: StartScreen = { key: "reports", screen: "Reports › Center health", href: "/reports", sentence: "Reports › Center health shows how your community is doing." };
    expect(buildStartHere(s, {})).toEqual({ ...s, lines: [], problems: [] });
  });
});

describe("a count that failed is a line that says so, never a zero", () => {
  it("a failed read: a plain sentence with the reason, and no 'nothing is waiting'", () => {
    const out = buildStartHere(SCREEN, { drafts: readFailed("the database could not be reached — check the connection and try again") });
    expect(out.problems).toEqual(["Could not count the drafts — the database could not be reached — check the connection and try again."]);
    expect(out.lines).toEqual([]);
  });
  it("one count failing does not hide the other", () => {
    const s: StartScreen = { key: "volunteers", screen: "Events › Volunteers", href: "/events/volunteers", sentence: "x" };
    const out = buildStartHere(s, { askedToVolunteer: readFailed("it failed"), shiftsWithFreePlaces: readOk(3) });
    expect(out.problems).toEqual(["Could not count the people who asked to volunteer — it failed."]);
    expect(out.lines).toEqual(["3 shifts with free places."]);
  });
  it("a failed committee count", () => {
    const s: StartScreen = { key: "committee", screen: "Pathshala › Committee", href: "/pathshala/committee", sentence: "x" };
    expect(buildStartHere(s, { committee: readFailed("nope") }).problems).toEqual(["Could not count the committee's actions — nope."]);
  });
});

describe("shifts with free places", () => {
  const NOW = new Date("2026-10-14T15:00:00Z");
  const shift = (id: string, capacity: number | null, starts_at: string | null, ends_at: string | null = null) => ({ id, capacity, starts_at, ends_at });

  it("counts a shift whose capacity is above the people assigned or confirmed on it", () => {
    const shifts = [shift("a", 3, "2026-10-19T14:00:00Z"), shift("b", 2, "2026-10-19T14:00:00Z"), shift("c", 1, "2026-10-19T14:00:00Z")];
    const assignments = [
      { shift_id: "a", status: "assigned" },
      { shift_id: "b", status: "confirmed" },
      { shift_id: "b", status: "assigned" },
      { shift_id: "c", status: "declined" },
    ];
    // a has 1 of 3, b is full, c's only person declined.
    expect(countShiftsWithFreePlaces(shifts, assignments, NOW)).toBe(2);
  });
  it("leaves out shifts with no capacity and shifts already over; keeps an undated one", () => {
    const shifts = [shift("a", null, "2026-10-19T14:00:00Z"), shift("b", 2, "2026-10-01T14:00:00Z", "2026-10-01T18:00:00Z"), shift("c", 2, null), shift("d", 0, "2026-10-19T14:00:00Z")];
    expect(countShiftsWithFreePlaces(shifts, [], NOW)).toBe(1);
  });
});
