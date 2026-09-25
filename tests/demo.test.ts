import { describe, expect, it } from "vitest";

import {
  confirmMatches,
  countsOf,
  DEMO_ONLY_SANDBOX,
  demoConfirmWord,
  demoProgress,
  demoStatus,
  demoTableLabel,
  isDemoBusy,
  moduleCount,
  moduleSummary,
  packModules,
} from "@/lib/demo";
import { canOpenTab, visibleNav } from "@/lib/permissions";
import { jobKindLabel } from "@/lib/vault";

describe("demo status", () => {
  it("reads the database's statuses and treats anything else as empty", () => {
    expect(demoStatus("loaded")).toBe("loaded");
    expect(demoStatus("clearing")).toBe("clearing");
    expect(demoStatus(null)).toBe("empty");
    expect(demoStatus("weird")).toBe("empty");
    expect(isDemoBusy("loading")).toBe(true);
    expect(isDemoBusy("clearing")).toBe(true);
    expect(isDemoBusy("failed")).toBe(false);
  });

  it("words progress as steps and a percentage", () => {
    expect(demoProgress({ status: "loading", steps_done: 4, steps_total: 10 })).toEqual({ pct: 40, text: "4 of 10 steps" });
    expect(demoProgress({ status: "loading", steps_done: 0, steps_total: 0 })).toEqual({ pct: 0, text: "0 of 0 steps" });
    expect(demoProgress({ status: "loaded", steps_done: 10, steps_total: 10 }).pct).toBe(100);
    expect(demoProgress({ status: "clearing", steps_done: 0, steps_total: 0 }).text).toMatch(/Removing/);
    expect(demoProgress(null)).toEqual({ pct: 0, text: "" });
    expect(demoProgress({ status: "loading", steps_done: 12, steps_total: 10 }).pct).toBe(100);
  });

  it("says the same refusal as the database", () => {
    expect(DEMO_ONLY_SANDBOX).toBe("Demo data is only for sandboxes.");
  });
});

describe("confirming a reset or clear", () => {
  it("is the short name, else the web name", () => {
    expect(demoConfirmWord({ short_name: "JSH", slug: "jsh" })).toBe("JSH");
    expect(demoConfirmWord({ short_name: "  ", slug: "temple-sandbox" })).toBe("temple-sandbox");
    expect(demoConfirmWord({ short_name: null, slug: "temple-sandbox" })).toBe("temple-sandbox");
  });
  it("matches ignoring case and surrounding spaces, never an empty word", () => {
    expect(confirmMatches(" jsh ", "JSH")).toBe(true);
    expect(confirmMatches("JS", "JSH")).toBe(false);
    expect(confirmMatches(null, "JSH")).toBe(false);
    expect(confirmMatches("", " ")).toBe(false);
  });
});

describe("what the pack contains", () => {
  const contents = [
    { module: "people", label: "Members & families", rows: { households: 25, people: 76, zones: 4 } },
    { module: "giving", label: "Pledges & donations", rows: { pledges: 56, payments: 43, weird_table: 2, bad: "x", zero: 0 } },
    { nope: true },
    "junk",
  ];
  it("groups rows per module, biggest first, skipping what is not a count", () => {
    const m = packModules(contents);
    expect(m.map((x) => x.module)).toEqual(["people", "giving"]);
    expect(m[0].rows.map((r) => r.table)).toEqual(["people", "households", "zones"]);
    expect(m[0].total).toBe(105);
    expect(m[1].rows.map((r) => r.label)).toEqual(["Pledges", "Payments (history)", "Weird table"]);
    expect(packModules(null)).toEqual([]);
    expect(packModules({})).toEqual([]);
  });
  it("summarizes a module in one line and counts what is in the sandbox now", () => {
    const [people] = packModules(contents);
    expect(moduleSummary(people, 2)).toBe("76 people · 25 households");
    expect(moduleCount(people, countsOf({ people: 78, households: 27, center_users: 2, junk: "x" }))).toBe(105);
    expect(countsOf(["x"])).toEqual({});
  });
  it("has plain names for tables", () => {
    expect(demoTableLabel("scan_log")).toBe("Check-ins");
    expect(demoTableLabel("new_table")).toBe("New table");
  });
  it("names the demo jobs", () => {
    expect(jobKindLabel("demo.load")).toBe("Load demo data");
    expect(jobKindLabel("demo.clear")).toBe("Clear the sandbox");
  });
});

describe("the Demo data tab", () => {
  const admin = { permissions: ["settings.manage"], isPlatformAdmin: false };
  it("shows only in a sandbox", () => {
    const tab = { href: "/setup/demo", access: "setup" as const, sandboxOnly: true };
    expect(canOpenTab({ ...admin, center: { environment: "sandbox" } }, tab)).toBe(true);
    expect(canOpenTab({ ...admin, center: { environment: "production" } }, tab)).toBe(false);
    expect(canOpenTab(admin, tab)).toBe(false);
    const setup = (env: string) => visibleNav({ ...admin, center: { environment: env } }).find((m) => m.key === "setup")?.tabs.map((t) => t.href) ?? [];
    expect(setup("sandbox")).toContain("/setup/demo");
    expect(setup("production")).not.toContain("/setup/demo");
    expect(setup("production")).toContain("/setup");
  });
});
