import { describe, expect, it } from "vitest";

import {
  MODULES,
  MODULE_KEYS,
  blockersToDisable,
  isModuleEnabled,
  isModuleKey,
  missingToEnable,
  moduleForPath,
  moduleLabelFor,
  type ModuleState,
} from "@/lib/modules";
import { isMissingObject, modulesOffFrom } from "@/lib/modules-db";
import { NAV, canOpenTab, visibleNav } from "@/lib/permissions";

const admin = { permissions: [] as string[], isPlatformAdmin: true };

describe("module registry", () => {
  it("lists the contract's 18 keys once each, with only people core", () => {
    expect(MODULES.map((m) => m.key)).toEqual([...MODULE_KEYS]);
    expect(new Set(MODULE_KEYS).size).toBe(18);
    expect(MODULES.filter((m) => m.core).map((m) => m.key)).toEqual(["people"]);
    for (const m of MODULES) for (const d of m.dependsOn) expect(isModuleKey(d)).toBe(true);
  });
  it("every NAV module key and tab module key is a registry key", () => {
    for (const m of NAV) {
      if (m.module) expect(isModuleKey(m.module)).toBe(true);
      for (const t of m.tabs) if (t.module) expect(isModuleKey(t.module)).toBe(true);
    }
  });
  it("labels", () => {
    expect(moduleLabelFor("giving")).toBe("Pledges & donations");
    expect(moduleLabelFor(null)).toBe("Core platform");
    expect(moduleLabelFor("mystery")).toBe("mystery");
  });
  it("isModuleEnabled treats missing data as on", () => {
    expect(isModuleEnabled({}, "giving")).toBe(true);
    expect(isModuleEnabled({ modulesOff: [] }, "giving")).toBe(true);
    expect(isModuleEnabled({ modulesOff: ["giving"] }, "giving")).toBe(false);
    expect(isModuleEnabled({ modulesOff: ["giving"] }, "bolis")).toBe(true);
  });
});

describe("moduleForPath", () => {
  it("maps module URLs, longest prefix first", () => {
    expect(moduleForPath("/giving/pledges")).toBe("giving");
    expect(moduleForPath("/giving")).toBe("giving");
    expect(moduleForPath("/bolis/upload")).toBe("bolis");
    expect(moduleForPath("/content/library")).toBe("content");
    expect(moduleForPath("/content/practices")).toBe("jain_way");
    expect(moduleForPath("/content/gyan-path")).toBe("gyan_path");
    expect(moduleForPath("/content/niva")).toBe("niva");
    expect(moduleForPath("/pathshala/signoffs")).toBe("gyan_path");
    expect(moduleForPath("/pathshala/classes/abc")).toBe("pathshala");
    expect(moduleForPath("/comms/surveys/123")).toBe("surveys");
    expect(moduleForPath("/events/volunteers")).toBe("volunteers");
    expect(moduleForPath("/events/abc")).toBe("events");
    expect(moduleForPath("/ops/abc/checkin")).toBe("events");
    expect(moduleForPath("/memberships/applications")).toBe("membership");
    expect(moduleForPath("/people/voting")).toBe("membership");
    expect(moduleForPath("/accounting/close")).toBe("accounting");
  });
  it("core platform pages have no module", () => {
    for (const p of ["/", "/settings/modules", "/settings/audit", "/platform", "/approvals", "/search", "/privacy/requests"]) {
      expect(moduleForPath(p)).toBeNull();
    }
    // People is a module too, but a core one (never switched off).
    expect(moduleForPath("/households/x")).toBe("people");
    expect(moduleForPath("/people/abc")).toBe("people");
  });
  it("does not match a prefix of a longer word", () => {
    expect(moduleForPath("/givingx")).toBeNull();
  });
});

describe("NAV with modules switched off", () => {
  it("hides a switched-off module and leaves everything else", () => {
    const all = visibleNav(admin).map((m) => m.key);
    const off = visibleNav({ ...admin, modulesOff: ["giving"] }).map((m) => m.key);
    expect(all).toContain("giving");
    expect(off).not.toContain("giving");
    expect(off.length).toBe(all.length - 1);
  });
  it("hides tabs that belong to another switched-off module", () => {
    const content = visibleNav({ ...admin, modulesOff: ["jain_way", "niva"] }).find((m) => m.key === "content")!;
    const hrefs = content.tabs.map((t) => t.href);
    expect(hrefs).not.toContain("/content/practices");
    expect(hrefs).not.toContain("/content/niva");
    expect(hrefs).toContain("/content/library");
    const people = visibleNav({ ...admin, modulesOff: ["membership"] }).find((m) => m.key === "people")!;
    expect(people.tabs.map((t) => t.href)).toEqual(["/households", "/people", "/people/requests", "/people/directory"]);
  });
  it("canOpenTab refuses a tab of a switched-off module", () => {
    expect(canOpenTab({ ...admin, modulesOff: ["surveys"] }, { access: "comms", module: "surveys" })).toBe(false);
    expect(canOpenTab(admin, { access: "comms", module: "surveys" })).toBe(true);
  });
  it("never hides core areas (Home, Setup, Settings, Platform)", () => {
    const keys = visibleNav({ ...admin, modulesOff: MODULE_KEYS.filter((k) => k !== "people") }).map((m) => m.key);
    expect(keys).toEqual(["home", "people", "setup", "settings", "platform"]);
  });
  it("Settings has a Modules tab for settings.manage only", () => {
    const s = visibleNav({ permissions: ["settings.manage"], isPlatformAdmin: false }).find((m) => m.key === "settings")!;
    expect(s.tabs.map((t) => t.href)).toContain("/settings/modules");
    const a = visibleNav({ permissions: ["audit.view"], isPlatformAdmin: false }).find((m) => m.key === "settings")!;
    expect(a.tabs.map((t) => t.href)).toEqual(["/settings/audit"]);
  });
});

describe("dependency rules", () => {
  const states: ModuleState[] = [
    { key: "people", enabled: true, core: true, dependsOn: [] },
    { key: "giving", enabled: true, core: false, dependsOn: ["people"] },
    { key: "bolis", enabled: true, core: false, dependsOn: ["giving"] },
    { key: "accounting", enabled: false, core: false, dependsOn: ["giving"] },
    { key: "content", enabled: false, core: false, dependsOn: [] },
    { key: "niva", enabled: false, core: false, dependsOn: ["content"] },
  ];
  it("switching off: core, and enabled dependents block", () => {
    expect(blockersToDisable("people", states)).toEqual({ core: true, dependents: ["giving"] });
    expect(blockersToDisable("giving", states)).toEqual({ core: false, dependents: ["bolis"] });
    expect(blockersToDisable("bolis", states)).toEqual({ core: false, dependents: [] });
  });
  it("switching on: a switched-off dependency blocks", () => {
    expect(missingToEnable("niva", states)).toEqual(["content"]);
    expect(missingToEnable("accounting", states)).toEqual([]);
    expect(missingToEnable("unknown", states)).toEqual([]);
  });
});

describe("modules-db helpers", () => {
  it("recognises a missing function, table or column", () => {
    expect(isMissingObject({ code: "PGRST202", message: "Could not find the function app.my_modules" })).toBe(true);
    expect(isMissingObject({ code: "42883", message: "function app.record_history(text, text) does not exist" })).toBe(true);
    expect(isMissingObject({ code: "42703", message: 'column audit_log.module does not exist' })).toBe(true);
    expect(isMissingObject({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingObject(null)).toBe(false);
  });
  it("modulesOffFrom ignores core rows and sorts", () => {
    expect(
      modulesOffFrom([
        { key: "store", label: "Satvik Store", enabled: false, core: false },
        { key: "people", label: "Members", enabled: false, core: true },
        { key: "bolis", label: "Bolis", enabled: false, core: false },
        { key: "giving", label: "Giving", enabled: true, core: false },
      ]),
    ).toEqual(["bolis", "store"]);
  });
});

describe("moduleOffMessage", () => {
  it("uses the contract's wording", async () => {
    const { moduleOffMessage } = await import("@/lib/modules");
    expect(moduleOffMessage("store", "JSH")).toBe("The Satvik Store module is switched off for JSH. An administrator can switch it on in Settings › Modules.");
  });
});

describe("Settings › Modules rows", () => {
  it("falls back to the registry, all on, when the catalog is missing", async () => {
    const { buildModuleRows } = await import("@/lib/modules");
    const rows = buildModuleRows(null, []);
    expect(rows.map((r) => r.key)).toEqual([...MODULE_KEYS]);
    expect(rows.every((r) => r.enabled)).toBe(true);
    expect(rows.find((r) => r.key === "bolis")!.dependsOn).toEqual(["giving"]);
  });
  it("lays switches over the catalog; missing row = on, core always on", async () => {
    const { buildModuleRows } = await import("@/lib/modules");
    const rows = buildModuleRows(
      [
        { key: "giving", label: "Pledges & donations", description: null, core: false, depends_on: ["people"], sort: 20 },
        { key: "people", label: "Members & families", description: "Core", core: true, depends_on: null, sort: 10 },
        { key: "store", label: "Satvik Store", description: "Shop", core: false, depends_on: ["people"], sort: 30 },
      ],
      [
        { module_key: "store", enabled: false, changed_by: "u1", changed_at: "2026-09-24T10:00:00Z", reason: "Closed for renovation" },
        { module_key: "people", enabled: false, changed_by: null, changed_at: null, reason: null },
      ],
    );
    expect(rows.map((r) => [r.key, r.enabled])).toEqual([
      ["people", true],
      ["giving", true],
      ["store", false],
    ]);
    expect(rows[1].description).toBe(MODULES.find((m) => m.key === "giving")!.description);
    expect(rows[2].reason).toBe("Closed for renovation");
  });
  it("explains blocked switches in plain English", async () => {
    const { buildModuleRows, switchBlocker } = await import("@/lib/modules");
    const rows = buildModuleRows(null, [
      { module_key: "content", enabled: false, changed_by: null, changed_at: null, reason: null },
      { module_key: "niva", enabled: false, changed_by: null, changed_at: null, reason: null },
    ]);
    expect(switchBlocker("people", false, rows)).toBe("Members & families is a core module and is always on.");
    expect(switchBlocker("giving", false, rows)).toBe("Bolis and Accounting & QuickBooks depend on Pledges & donations — switch them off first.");
    expect(switchBlocker("bolis", false, rows)).toBeNull();
    expect(switchBlocker("niva", true, rows)).toBe("Niva assistant needs Content & library — switch that on first.");
    expect(switchBlocker("content", true, rows)).toBeNull();
  });
});

describe("Home tasks follow module switches", () => {
  it("drops task sources of switched-off modules", async () => {
    const { visibleTaskSources } = await import("@/lib/tasks");
    const all = visibleTaskSources(admin).map((s) => s.key);
    expect(all).toContain("refund");
    const off = visibleTaskSources({ ...admin, modulesOff: ["giving", "pathshala"] }).map((s) => s.key);
    expect(off).not.toContain("refund");
    expect(off).not.toContain("writeoff");
    expect(off).not.toContain("deposits");
    expect(off).not.toContain("pathshala");
    expect(off).toContain("bolis"); // its own module (the database keeps bolis off when giving is off)
    expect(off).toContain("privacy"); // core platform
    const noMembership = visibleTaskSources({ ...admin, modulesOff: ["membership"] }).map((s) => s.key);
    expect(noMembership).not.toContain("membership");
    expect(noMembership).not.toContain("override");
  });
});
