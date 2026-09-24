import { describe, expect, it } from "vitest";
import {
  classifyAction,
  committeeDashboard,
  daysUntil,
  dueBadge,
  dueFromOffset,
  mergeLessons,
  pathshalaYearFor,
} from "@/lib/logic/eams";

const TODAY = "2026-09-23";

const action = (id: string, due_on: string | null, extra: Partial<{ state: string; owner_person_id: string | null }> = {}) => ({
  id,
  due_on,
  state: extra.state ?? "not_started",
  owner_person_id: extra.owner_person_id === undefined ? "p1" : extra.owner_person_id,
});

describe("classifyAction", () => {
  it("classifies by days until due", () => {
    expect(classifyAction(action("a", "2026-09-22"), TODAY)).toBe("overdue");
    expect(classifyAction(action("a", "2026-09-23"), TODAY)).toBe("due_soon");
    expect(classifyAction(action("a", "2026-09-26"), TODAY)).toBe("due_soon"); // 3 days
    expect(classifyAction(action("a", "2026-09-27"), TODAY)).toBe("upcoming"); // 4 days
    expect(classifyAction(action("a", "2026-10-07"), TODAY)).toBe("upcoming"); // 14 days
    expect(classifyAction(action("a", "2026-10-08"), TODAY)).toBe("later"); // 15 days
    expect(classifyAction(action("a", null), TODAY)).toBe("no_date");
  });

  it("never flags completed or removed actions", () => {
    expect(classifyAction(action("a", "2026-01-01", { state: "completed" }), TODAY)).toBe("done");
    expect(classifyAction(action("a", "2026-01-01", { state: "removed" }), TODAY)).toBe("removed");
  });

  it("computes days across month boundaries", () => {
    expect(daysUntil("2026-10-01", TODAY)).toBe(8);
    expect(daysUntil("2026-09-01", TODAY)).toBe(-22);
  });
});

describe("dueBadge", () => {
  it("labels risk in words, not only colour", () => {
    expect(dueBadge(action("a", "2026-09-20"), TODAY)).toEqual({ label: "Overdue 3d", tone: "danger" });
    expect(dueBadge(action("a", "2026-09-23"), TODAY)).toEqual({ label: "Due today", tone: "danger" });
    expect(dueBadge(action("a", "2026-09-29"), TODAY).tone).toBe("warning");
    expect(dueBadge(action("a", "2026-10-05"), TODAY).tone).toBe("caution");
    expect(dueBadge(action("a", "2026-12-01"), TODAY).tone).toBe("ok");
    expect(dueBadge(action("a", null), TODAY).label).toBe("No date");
  });
});

describe("committeeDashboard", () => {
  it("partitions actions and finds unassigned items in the horizon", () => {
    const actions = [
      action("late", "2026-09-10", { owner_person_id: null }),
      action("soon", "2026-09-24"),
      action("soon-unowned", "2026-09-25", { owner_person_id: null }),
      action("later", "2026-11-01", { owner_person_id: null }), // outside horizon: not "unassigned"
      action("done", "2026-09-01", { state: "completed", owner_person_id: null }),
      action("up", "2026-10-01"),
    ];
    const events = [
      { id: "yesterday", starts_on: "2026-09-22" },
      { id: "in2weeks", starts_on: "2026-10-07" },
      { id: "past", starts_on: "2026-09-01" },
      { id: "far", starts_on: "2026-12-01" },
    ];
    const d = committeeDashboard(actions, events, TODAY);
    expect(d.overdue.map((a) => a.id)).toEqual(["late"]);
    expect(d.dueSoon.map((a) => a.id)).toEqual(["soon", "soon-unowned"]);
    expect(d.upcoming.map((a) => a.id)).toEqual(["up"]);
    expect(d.unassigned.map((a) => a.id)).toEqual(["late", "soon-unowned"]);
    expect(d.eventsSoon.map((e) => e.id)).toEqual(["yesterday", "in2weeks"]);
    expect(d.allClear).toBe(false);
  });

  it("is all clear when nothing is at risk", () => {
    expect(committeeDashboard([action("x", "2027-01-01")], [], TODAY).allClear).toBe(true);
  });
});

describe("Pathshala year and template helpers", () => {
  it("starts the Pathshala year in July", () => {
    expect(pathshalaYearFor("2026-09-23")).toBe("2026-2027");
    expect(pathshalaYearFor("2027-03-01")).toBe("2026-2027");
    expect(pathshalaYearFor("2027-07-01")).toBe("2027-2028");
  });

  it("offsets due dates from the event date", () => {
    expect(dueFromOffset("2026-11-08T16:00:00Z", -14)).toBe("2026-10-25");
    expect(dueFromOffset("2026-11-08", 3)).toBe("2026-11-11");
    expect(dueFromOffset(null, 3)).toBeNull();
    expect(dueFromOffset("2026-11-08", null)).toBeNull();
  });

  it("merges lessons learned by id, appending new ones", () => {
    const merged = mergeLessons(
      [{ id: "l1", text: "old", author: "a", created_at: "x" }],
      [
        { id: "l1", text: "updated", author: "a", created_at: "x" },
        { id: "l2", text: "new", author: "b", created_at: "y" },
      ],
    );
    expect(merged.map((l) => [l.id, l.text])).toEqual([
      ["l1", "updated"],
      ["l2", "new"],
    ]);
  });
});
