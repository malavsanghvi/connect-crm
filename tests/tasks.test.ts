import { describe, expect, it } from "vitest";

import {
  TASK_SOURCES,
  badgeText,
  canSeeTask,
  compactMoney,
  greetingFor,
  hourInTz,
  lowStock,
  makeTask,
  orderTasks,
  percent,
  plural,
  tasksHint,
  visibleTaskSources,
} from "@/lib/tasks";

const ctx = (permissions: string[], isPlatformAdmin = false) => ({ permissions, isPlatformAdmin });

describe("task sources", () => {
  it("keeps the prototype order and unique keys", () => {
    const keys = TASK_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.indexOf("refund")).toBeLessThan(keys.indexOf("deposits"));
    expect(keys.indexOf("deposits")).toBeLessThan(keys.indexOf("membership"));
    expect(keys.indexOf("quickbooks")).toBeLessThan(keys.indexOf("inventory"));
    expect(keys[keys.length - 1]).toBe("privacy");
  });

  it("shows a membership coordinator only the people tasks", () => {
    const keys = visibleTaskSources(ctx(["people.view", "people.manage", "people.approve", "events.view"])).map((s) => s.key);
    expect(keys).toEqual(["membership", "override"]);
  });

  it("shows role-grant approvals only to roles managers", () => {
    expect(visibleTaskSources(ctx(["roles.manage"])).map((s) => s.key)).toEqual(["roles"]);
    expect(visibleTaskSources(ctx(["people.approve"])).map((s) => s.key)).not.toContain("roles");
  });

  it("shows a treasurer giving and accounting tasks", () => {
    const keys = visibleTaskSources(ctx(["giving.view", "giving.manage", "giving.approve", "accounting.manage"])).map((s) => s.key);
    expect(keys).toEqual(["refund", "writeoff", "deposits", "quickbooks"]);
  });

  it("needs read access too (content.approve without content.manage or content.draft sees nothing)", () => {
    expect(canSeeTask(ctx(["content.approve"]), "content")).toBe(false);
    expect(canSeeTask(ctx(["content.approve", "content.manage"]), "content")).toBe(true);
    expect(canSeeTask(ctx(["events.manage"]), "waivers")).toBe(false);
    expect(canSeeTask(ctx(["events.manage", "volunteers.view"]), "waivers")).toBe(true);
  });

  it("gives platform admins every source and people with no role none", () => {
    expect(visibleTaskSources(ctx([], true))).toHaveLength(TASK_SOURCES.length);
    expect(visibleTaskSources(ctx([]))).toHaveLength(0);
  });
});

describe("task rows", () => {
  it("orders by source, keeping build order inside a source", () => {
    const rows = [
      makeTask("privacy", "a", "p", "", []),
      makeTask("membership", "1", "m1", "", []),
      makeTask("refund", "r", "r", "", []),
      makeTask("membership", "2", "m2", "", []),
    ];
    expect(orderTasks(rows).map((t) => t.title)).toEqual(["r", "m1", "m2", "p"]);
    expect(rows[0].tag).toBe("Privacy");
    expect(rows[2].color).toBe("danger");
  });

  it("writes counts and hints in plain English", () => {
    expect(plural(1, "request")).toBe("1 request");
    expect(plural(1200, "request")).toBe("1,200 requests");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
    expect(tasksHint(17)).toBe("17 waiting · filtered by your permissions");
  });

  it("badges the Home nav item", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(17)).toBe("17");
    expect(badgeText(140)).toBe("99+");
  });

  it("greets by the center's hour", () => {
    expect(greetingFor(8)).toBe("Good morning");
    expect(greetingFor(13)).toBe("Good afternoon");
    expect(greetingFor(19)).toBe("Good evening");
    expect(hourInTz("America/Chicago", new Date("2026-09-24T14:30:00Z"))).toBe(9);
  });

  it("finds items at or below reorder level", () => {
    const items = [
      { name: "Kaju katli", track_inventory: true, stock_on_hand: 3, low_stock_threshold: 5 },
      { name: "Ghughra", track_inventory: true, stock_on_hand: 5, low_stock_threshold: 5 },
      { name: "Khakhra", track_inventory: true, stock_on_hand: 9, low_stock_threshold: 5 },
      { name: "Books", track_inventory: false, stock_on_hand: 0, low_stock_threshold: 5 },
      { name: "Diya", track_inventory: true, stock_on_hand: 0, low_stock_threshold: null },
    ];
    expect(lowStock(items).map((i) => i.name)).toEqual(["Kaju katli", "Ghughra"]);
  });

  it("formats KPI money and percentages", () => {
    expect(compactMoney(184_000_000)).toBe("$1.84M");
    expect(compactMoney(61_200_000)).toBe("$612K");
    expect(compactMoney(95_000)).toBe("$950");
    expect(compactMoney(100_000_000)).toBe("$1M");
    expect(percent(71, 100)).toBe(71);
    expect(percent(1, 0)).toBeNull();
  });
});
