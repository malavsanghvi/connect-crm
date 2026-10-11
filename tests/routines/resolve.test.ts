import { describe, expect, it } from "vitest";

import { dateParts, ordinal, todayLabel } from "@/lib/routines/clock";
import { countersNeeded } from "@/lib/routines/needs";
import { RECIPES, ROUTINE_ROLE_TITLES } from "@/lib/routines/recipes";
import {
  isHandTickable,
  nextStep,
  resolveRoutine,
  routineProgress,
  routineRolesFor,
  type ResolvedRoutine,
} from "@/lib/routines/resolve";
import { counterFromTasks } from "@/lib/routines/signals";

import { FRIDAY, MONDAY, TUESDAY, event, facts, viewer } from "./fixtures";

const steps = (r: ResolvedRoutine) => r.groups.flatMap((g) => g.steps);
const find = (r: ResolvedRoutine, key: string) => steps(r).find((s) => s.key === key);
const keys = (r: ResolvedRoutine) => steps(r).map((s) => s.key);

describe("who gets which routine", () => {
  it("gives a person the routine of each role they hold", () => {
    expect(routineRolesFor(viewer(["treasurer"]))).toEqual(["treasurer"]);
    expect(routineRolesFor(viewer(["membership_coordinator", "treasurer"]))).toEqual(["treasurer", "membership_coordinator"]);
  });

  it("counts a role granted for one event or class (an event lead is scoped)", () => {
    expect(routineRolesFor(viewer([{ key: "event_lead", scope: { kind: "event", id: "e1" } }]))).toEqual(["event_lead"]);
  });

  it("gives the organization's owner the administrator routine, once", () => {
    expect(routineRolesFor({ ...viewer([]), isOwner: true })).toEqual(["center_admin"]);
    expect(routineRolesFor({ ...viewer(["center_admin"]), isOwner: true })).toEqual(["center_admin"]);
  });

  it("gives nothing to a role that has no routine yet, or to a person with no role", () => {
    expect(routineRolesFor(viewer(["teacher", "store_lead"]))).toEqual([]);
    const r = resolveRoutine(viewer([]), facts());
    expect(r.roles).toEqual([]);
    expect(r.groups).toEqual([]);
    expect(r.total).toBe(0);
  });
});

describe("only steps the person may do", () => {
  it("skips a step whose area the person cannot open", () => {
    const noApprove = viewer(["treasurer"], { permissions: viewer(["treasurer"]).permissions.filter((p) => p !== "giving.approve") });
    expect(keys(resolveRoutine(viewer(["treasurer"]), facts()))).toContain("treasurer.approvals");
    expect(keys(resolveRoutine(noApprove, facts()))).not.toContain("treasurer.approvals");
    expect(keys(resolveRoutine(noApprove, facts()))).toContain("treasurer.deposits");
  });

  it("lets an event lead scoped to one event do the event steps without any center-wide permission", () => {
    const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: "e1" } }]);
    expect(lead.permissions).toEqual([]);
    const r = resolveRoutine(lead, facts({ events: [event(1, "Diwali Dinner", "e1")] }));
    expect(keys(r)).toContain("events.meal-counts");
  });
});

describe("modules a community has switched off", () => {
  it("hide the steps that belong to them", () => {
    const base = keys(resolveRoutine(viewer(["treasurer"]), facts({ today: "2026-10-26" })));
    expect(base).toContain("treasurer.quickbooks");
    expect(base).toContain("treasurer.close-month");

    const noAccounting = keys(resolveRoutine(viewer(["treasurer"], { modulesOff: ["accounting"] }), facts({ today: "2026-10-26" })));
    expect(noAccounting).not.toContain("treasurer.quickbooks");
    expect(noAccounting).not.toContain("treasurer.close-month");
    expect(noAccounting).toContain("treasurer.deposits");

    const noGiving = keys(resolveRoutine(viewer(["treasurer"], { modulesOff: ["giving"] }), facts({ today: "2026-10-26" })));
    expect(noGiving).not.toContain("treasurer.deposits");
    expect(noGiving).not.toContain("treasurer.approvals");
  });

  it("hide Pathshala steps when Pathshala is off, and sign-offs when Gyan Path is off", () => {
    const principal = viewer(["pathshala_principal"]);
    expect(keys(resolveRoutine(principal, facts()))).toContain("pathshala.placements");
    expect(keys(resolveRoutine({ ...principal, modulesOff: ["pathshala"] }, facts()))).toEqual([]);
    const noGyan = keys(resolveRoutine({ ...principal, modulesOff: ["gyan_path"] }, facts()));
    expect(noGyan).toContain("pathshala.placements");
    expect(noGyan).not.toContain("pathshala.signoffs");
  });
});

describe("steps that tick themselves", () => {
  it("are done when the counter is zero, and say so", () => {
    const r = resolveRoutine(viewer(["membership_coordinator"]), facts({ counts: { applications: 0 } }));
    const s = find(r, "members.applications")!;
    expect(s.state).toBe("done");
    expect(s.tag).toBe("Auto-checked");
    expect(s.detail).toBe("No applications are waiting");
  });

  it("are open, with the number, when work is left", () => {
    const r = resolveRoutine(viewer(["membership_coordinator"]), facts({ counts: { applications: 3 } }));
    const s = find(r, "members.applications")!;
    expect(s.state).toBe("open");
    expect(s.tag).toBe("Auto-checked");
    expect(s.detail).toBe("3 applications waiting");
    expect(find(resolveRoutine(viewer(["membership_coordinator"]), facts({ counts: { applications: 1 } })), "members.applications")!.detail).toBe("1 application waiting");
  });

  it("never claim 'nothing waiting' for a counter that could not be read", () => {
    const r = resolveRoutine(viewer(["membership_coordinator"]), facts({ failed: { applications: "the server did not respond" } }));
    const s = find(r, "members.applications")!;
    expect(s.state).toBe("unknown");
    expect(s.tag).toBe("You do this");
    expect(s.detail).toContain("Could not check this automatically (the server did not respond)");
    expect(isHandTickable(s)).toBe(true);
  });

  it("fall back to the person when no counter was read, and steps without a counter are by hand", () => {
    const r = resolveRoutine(viewer(["membership_coordinator"]), facts());
    expect(find(r, "members.applications")!.state).toBe("by_hand");
    const hand = find(r, "members.family-requests")!;
    expect(hand.state).toBe("by_hand");
    expect(hand.tag).toBe("You do this");
    expect(hand.detail).toBe("You tick this one yourself");
  });

  it("show attendance only on a day a class meets", () => {
    const principal = viewer(["pathshala_principal"]);
    expect(keys(resolveRoutine(principal, facts({ counts: { classes_today: 0, attendance_missing: 0 } })))).not.toContain("pathshala.attendance");
    const r = resolveRoutine(principal, facts({ counts: { classes_today: 3, attendance_missing: 2 } }));
    expect(find(r, "pathshala.attendance")!.detail).toBe("2 classes without attendance so far");
    // Unknown whether a class meets: the step stays, to be checked by hand.
    expect(keys(resolveRoutine(principal, facts()))).toContain("pathshala.attendance");
  });
});

describe("steps that appear on their day", () => {
  const treasurer = viewer(["treasurer"]);

  it("weekly steps come on their weekday and wait under 'coming up' on the others", () => {
    expect(keys(resolveRoutine(treasurer, facts({ today: FRIDAY })))).toContain("treasurer.pledge-aging");
    expect(keys(resolveRoutine(treasurer, facts({ today: MONDAY })))).not.toContain("treasurer.pledge-aging");
    expect(keys(resolveRoutine(treasurer, facts({ today: MONDAY })))).toContain("treasurer.offline");
    const tuesday = resolveRoutine(treasurer, facts({ today: TUESDAY }));
    expect(tuesday.later.find((l) => l.key === "treasurer.pledge-aging")?.dueText).toBe("Fridays");
  });

  it("month-end steps come from the 25th", () => {
    expect(keys(resolveRoutine(treasurer, facts({ today: "2026-10-24" })))).not.toContain("treasurer.close-month");
    expect(keys(resolveRoutine(treasurer, facts({ today: "2026-10-25" })))).toContain("treasurer.close-month");
    expect(keys(resolveRoutine(treasurer, facts({ today: "2026-10-31" })))).toContain("treasurer.close-month");
    expect(resolveRoutine(treasurer, facts({ today: "2026-10-12" })).later.find((l) => l.key === "treasurer.close-month")?.dueText).toBe("From the 25th");
  });

  it("before-event steps come when an event is that close, and link to that event", () => {
    const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: "e1" } }]);
    const none = resolveRoutine(lead, facts());
    expect(keys(none)).toEqual([]);

    const fiveDays = resolveRoutine(lead, facts({ events: [event(5, "Diwali Dinner", "e1")] }));
    expect(keys(fiveDays)).toEqual(["events.rsvps", "events.waivers"]);
    expect(find(fiveDays, "events.rsvps")!.href).toBe("/events/e1");
    expect(find(fiveDays, "events.rsvps")!.eventNote).toBe("Diwali Dinner, in 5 days");

    const tomorrow = resolveRoutine(lead, facts({ events: [event(1, "Diwali Dinner", "e1")] }));
    expect(keys(tomorrow)).toEqual(["events.rsvps", "events.waivers", "events.meal-counts"]);
    expect(find(tomorrow, "events.meal-counts")!.eventNote).toBe("Diwali Dinner, tomorrow");
  });

  it("event-day steps come on the day, and the before-event ones give way", () => {
    const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: "e1" } }]);
    const day = resolveRoutine(lead, facts({ events: [event(0, "Diwali Dinner", "e1")] }));
    expect(keys(day)).toEqual(["events.check-in"]);
    expect(find(day, "events.check-in")!.eventNote).toBe("Diwali Dinner, today");
  });
});

describe("two roles at once", () => {
  it("joins the routines, groups them by when, and shows a step both roles share once", () => {
    const both = viewer(["center_admin", "membership_coordinator"]);
    const r = resolveRoutine(both, facts({ today: MONDAY }));
    expect(r.roles.map((x) => x.title)).toEqual([ROUTINE_ROLE_TITLES.center_admin, ROUTINE_ROLE_TITLES.membership_coordinator]);
    expect(r.groups.map((g) => g.when)).toEqual(["every_sign_in", "weekly"]);
    const shared = steps(r).filter((s) => s.key === "people.data-quality");
    expect(shared).toHaveLength(1);
    expect(shared[0].roleTitles).toEqual(["Administrator", "Membership coordinator"]);
  });

  it("keeps the groups in a fixed order", () => {
    const r = resolveRoutine(viewer(["treasurer"]), facts({ today: "2026-10-27" }));
    expect(r.groups.map((g) => g.when)).toEqual(["every_sign_in", "month_end"]);
  });
});

describe("progress and the next step", () => {
  const coordinator = viewer(["membership_coordinator"]);
  const r = resolveRoutine(coordinator, facts({ counts: { applications: 0, voting_overrides: 2 } }));

  it("counts the steps done by the data, and leaves the rest as left", () => {
    expect(r.total).toBe(3);
    expect(r.done).toBe(1);
    expect(r.left).toBe(2);
  });

  it("points at the first step not yet done", () => {
    expect(nextStep(r)!.key).toBe("members.voting-overrides");
  });

  it("counts a step the person ticks by hand, but never one the data owns", () => {
    expect(routineProgress(r, ["members.family-requests"])).toEqual({ total: 3, done: 2, left: 1 });
    // The overrides counter says work is left: a tick cannot change that.
    expect(routineProgress(r, ["members.voting-overrides"])).toEqual({ total: 3, done: 1, left: 2 });
    expect(nextStep(r, ["members.family-requests"])!.key).toBe("members.voting-overrides");
    expect(nextStep(r, ["members.family-requests"])).not.toBeNull();
  });

  it("has no next step when everything is done", () => {
    const allDone = resolveRoutine(coordinator, facts({ counts: { applications: 0, voting_overrides: 0 } }));
    expect(nextStep(allDone, ["members.family-requests"])).toBeNull();
    expect(routineProgress(allDone, ["members.family-requests"]).left).toBe(0);
  });
});

describe("counters taken from the Home task list", () => {
  const task = (source: string) => ({ source }) as never;

  it("count the tasks of the sources that make up each counter", () => {
    const { counts, failed } = counterFromTasks(
      [task("refund"), task("writeoff"), task("payee"), task("deposits"), task("membership")],
      [],
      ["refund", "writeoff", "payee", "deposits"],
    );
    expect(counts.giving_approvals).toBe(3);
    expect(counts.deposits).toBe(1);
    expect(counts.credits).toBeUndefined();
    expect(failed).toEqual({});
  });

  it("report zero when a visible source has nothing", () => {
    expect(counterFromTasks([], [], ["credit"]).counts.credits).toBe(0);
  });

  it("leave out a counter the person cannot see at all, instead of saying 'nothing waiting'", () => {
    expect(counterFromTasks([], [], ["deposits"]).counts.credits).toBeUndefined();
    expect(counterFromTasks([], [], []).counts).toEqual({});
  });

  it("never report a source that failed to load as zero", () => {
    const { counts, failed } = counterFromTasks([], [{ source: "deposits", message: "the server did not respond" }], ["deposits", "credit"]);
    expect(counts.deposits).toBeUndefined();
    expect(failed.deposits).toBe("the server did not respond");
    expect(counts.credits).toBe(0);
  });

  it("still show work that did load when another part of the same counter failed", () => {
    const { counts, failed } = counterFromTasks([task("refund")], [{ source: "writeoff", message: "x" }], ["refund", "writeoff"]);
    expect(counts.giving_approvals).toBe(1);
    expect(failed.giving_approvals).toBeUndefined();
  });
});

describe("what a person's page needs to count", () => {
  it("asks only for the counters their routine and the briefing use", () => {
    const needed = countersNeeded(viewer(["treasurer"]));
    expect(needed.has("deposits")).toBe(true);
    expect(needed.has("bank_lines")).toBe(true);
    expect(needed.has("attendance_missing")).toBe(false);
    expect(needed.has("gyan_signoffs")).toBe(false);
    expect(countersNeeded(viewer(["pathshala_principal"])).has("attendance_missing")).toBe(true);
  });
});

describe("dates", () => {
  it("work out the weekday and day of the month of a plain date", () => {
    expect(dateParts("2026-10-10")).toEqual({ weekday: 6, dayOfMonth: 10 });
    expect(dateParts(MONDAY).weekday).toBe(1);
    expect(dateParts(FRIDAY).weekday).toBe(5);
    expect(() => dateParts("tomorrow")).toThrow();
  });

  it("write ordinals and today's date", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 25].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "25th"]);
    expect(todayLabel("America/New_York", new Date("2026-10-10T15:00:00Z"))).toBe("Saturday, October 10");
    // Late in the evening in New York it is already tomorrow in UTC: the organization's own zone decides.
    expect(todayLabel("America/New_York", new Date("2026-10-11T02:00:00Z"))).toBe("Saturday, October 10");
  });
});
