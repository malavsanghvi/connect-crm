import { describe, expect, it } from "vitest";

import { dueLine, draftFor, parseWeek, parseWeekCounts, parseWeekSettings, weekLine, weekTaskCopy } from "@/lib/care/week";

// DonorDelight slice 5 (0892-0893): the week in words.

const household = { id: "h1", name: "Mensah, Ama", number: "GC-H-0041", org_household_id: null, city: "Austin", zone: null, primary_member: "Ama Mensah", adults: [], merged: false };
const ANSWER = {
  state: "ok", today: "2026-10-17", total: 7, overdue: 2, needs_owner: 1, me: "Ravi", org: "Grace Church", label: "Member care", playbooks: 10,
  tasks: [
    { kind: "step", run_id: "r1", step_id: "s1", thank_id: null, household, contact: "Ama", due_on: "2026-10-14", overdue: true, title: "Welcome them", why: "First contact.", touch_kind: "welcome", channel: "phone", draft: "Hello {{name}}, it is {{me}} from {{org}}.", personal: false },
    { kind: "thank", run_id: null, step_id: null, thank_id: "t1", household, contact: null, due_on: "2026-10-19", overdue: false, title: "Thank them for their gift", why: "Their gift of October 10 has not been thanked yet.", touch_kind: "thank_you", channel: "post", draft: null, personal: true },
    { kind: "step", run_id: "r2", step_id: "s2", household: { name: "no id" }, title: "x" },
    { kind: "weird", household },
  ],
};

describe("parseWeek", () => {
  const w = parseWeek(ANSWER);
  it("reads the tasks (one with no household, and one of an unknown kind, are dropped) and the true total", () => {
    expect(w.tasks.map((t) => [t.kind, t.title, t.touchKind, t.channel, t.personal])).toEqual([
      ["step", "Welcome them", "welcome", "phone", false],
      ["thank", "Thank them for their gift", "thank_you", "post", true],
    ]);
    expect(w.total).toBe(7);
    expect(w.overdue).toBe(2);
    expect(w.needsOwner).toBe(1);
    expect(w.me).toBe("Ravi");
    expect(w.label).toBe("Member care");
    expect(w.tasks[0].household.name).toBe("Mensah, Ama");
    expect(w.tasks[1].stepId).toBeNull();
    expect(w.tasks[1].thankId).toBe("t1");
  });
  it("nonsense is safe", () => {
    expect(parseWeek(null)).toMatchObject({ total: 0, overdue: 0, tasks: [], needsOwner: 0, label: "DonorDelight" });
    expect(parseWeek({ tasks: [{ kind: "step", household, touch_kind: "ask", channel: "pigeon" }] }).tasks[0]).toMatchObject({ touchKind: "other", channel: "phone" });
  });
});

describe("words", () => {
  it("dueLine", () => {
    expect(dueLine("2026-10-14", "2026-10-17")).toBe("Overdue by 3 days");
    expect(dueLine("2026-10-16", "2026-10-17")).toBe("Overdue by 1 day");
    expect(dueLine("2026-10-17", "2026-10-17")).toBe("Due today");
    expect(dueLine("2026-10-18", "2026-10-17")).toBe("Due tomorrow");
    expect(dueLine("2026-10-21", "2026-10-17")).toBe("Due in 4 days");
    expect(dueLine("", "2026-10-17")).toBe("");
  });
  it("weekLine and the row for Today and Home", () => {
    expect(weekLine({ total: 0, overdue: 0 })).toBe("Nothing waits for you this week.");
    expect(weekLine({ total: 1, overdue: 0 })).toBe("1 task this week");
    expect(weekLine({ total: 7, overdue: 2 })).toBe("7 tasks this week, 2 overdue");
    expect(weekTaskCopy(null)).toBeNull();
    expect(weekTaskCopy({ tasks: 0, overdue: 0 })).toBeNull();
    expect(weekTaskCopy({ tasks: 4, overdue: 1 })).toEqual({ title: "Your week: 4 care tasks", meta: "1 overdue" });
    expect(weekTaskCopy({ tasks: 1, overdue: 0 })).toEqual({ title: "Your week: 1 care task", meta: "Each with why and a ready draft" });
  });
  it("the counts hold two numbers and no names", () => {
    expect(parseWeekCounts({ state: "ok", tasks: 4, overdue: 1 })).toEqual({ tasks: 4, overdue: 1 });
    expect(parseWeekCounts({ state: "no" })).toBeNull();
    expect(parseWeekCounts(null)).toBeNull();
  });
  it("a draft is filled with the person to reach, the sender and the organization", () => {
    const w = parseWeek(ANSWER);
    expect(draftFor(w.tasks[0], w)).toBe("Hello Ama, it is Ravi from Grace Church.");
    expect(draftFor(w.tasks[1], w)).toBe("");
    expect(draftFor({ draft: "Hello {{name}}, {{me}}", contact: null }, { me: null, org: null })).toBe("Hello there, [your name]");
  });
});

describe("the weekly reminder's setting", () => {
  it("reads on or off and the weekday; a bad weekday is Monday", () => {
    expect(parseWeekSettings({ notify: true, notify_dow: 4, can_manage: true })).toEqual({ notify: true, dow: 4, canManage: true });
    expect(parseWeekSettings({ notify: false, notify_dow: 9 })).toEqual({ notify: false, dow: 1, canManage: false });
    expect(parseWeekSettings(null)).toEqual({ notify: false, dow: 1, canManage: false });
  });
});
