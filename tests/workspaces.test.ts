import { describe, expect, it } from "vitest";

import { NAV, visibleNav, type ScopedContext } from "@/lib/permissions";
import {
  PHONE_BAR_KEYS,
  WORKSPACES,
  activeWorkspace,
  modulesInWorkspace,
  phoneBar,
  visibleWorkspaces,
  workspaceCoverageProblems,
  workspaceOfModule,
  workspacesFor,
} from "@/lib/workspaces";

const ctx = (c: Partial<ScopedContext> = {}): ScopedContext => ({ permissions: [], isPlatformAdmin: false, ...c });
const labels = (c: ScopedContext) => visibleWorkspaces(c).map((w) => w.label);

describe("the eleven workspaces cover every NAV tab exactly once", () => {
  it("has no problems with the map as it is", () => {
    expect(workspaceCoverageProblems()).toEqual([]);
  });

  it("names the eleven workspaces of the redesign, in the rail's order", () => {
    expect(WORKSPACES.map((w) => w.label)).toEqual(["Today", "People", "Giving", "Events", "Messages", "Learning", "Store", "Content", "Reports", "Settings", "Platform"]);
  });

  it("puts every NAV module and tab in one workspace (checked tab by tab)", () => {
    for (const m of NAV) {
      const owners = WORKSPACES.filter((w) => w.modules.includes(m.key));
      expect(owners, `module ${m.key}`).toHaveLength(1);
      expect(workspaceOfModule(m.key)).toBe(owners[0].key);
      for (const t of m.tabs) expect(owners.length, `tab ${t.href}`).toBe(1);
    }
  });

  it("maps the modules as the redesign says", () => {
    const by = (key: string) => WORKSPACES.find((w) => w.key === key)!.modules;
    expect(by("today")).toEqual(["home"]);
    expect(by("giving")).toEqual(["giving", "bolis", "accounting"]);
    expect(by("events")).toEqual(["events", "calendar"]);
    expect(by("messages")).toEqual(["comms"]);
    expect(by("learning")).toEqual(["pathshala"]);
    expect(by("settings")).toEqual(["setup", "settings"]);
    expect(by("platform")).toEqual(["platform"]);
  });

  it("every workspace has a label that fits a rail, and an icon", () => {
    for (const w of WORKSPACES) {
      expect(w.label.length, w.key).toBeLessThanOrEqual(10);
      expect(w.icon.length, w.key).toBeGreaterThan(10);
    }
  });

  it("the check would fail for a tab that is left out (a module in no workspace) or doubled", () => {
    // The map is plain data; the test bends it on purpose and puts it back.
    const defs = WORKSPACES as unknown as { key: string; modules: string[] }[];
    const reports = defs.find((w) => w.key === "reports")!;
    const original = reports.modules;
    try {
      reports.modules = [];
      expect(workspaceCoverageProblems().join(" | ")).toMatch(/of the module "reports" is in no workspace/);
      reports.modules = ["reports", "store"];
      expect(workspaceCoverageProblems().join(" | ")).toMatch(/of the module "store" is in 2 workspaces: Store, Reports/);
      reports.modules = ["reports", "no_such_module"];
      expect(workspaceCoverageProblems().join(" | ")).toMatch(/names the module "no_such_module"/);
    } finally {
      reports.modules = original;
    }
    expect(workspaceCoverageProblems()).toEqual([]);
  });
});

describe("which workspaces a person sees (the same gating as the classic sidebar)", () => {
  it("shows only Today to someone with no permissions", () => {
    expect(labels(ctx())).toEqual(["Today"]);
  });

  it("shows no Giving to a role without any giving access", () => {
    const l = labels(ctx({ permissions: ["people.view", "events.view"] }));
    expect(l).not.toContain("Giving");
    // As in the classic sidebar: the committee page, Reports and Data quality are open to people.view as well.
    expect(l).toEqual(["Today", "People", "Events", "Learning", "Reports", "Settings"]);
  });

  it("shows Giving, and not People, to someone who may only record offline gifts", () => {
    const l = labels(ctx({ permissions: ["giving.record_offline"] }));
    expect(l).toEqual(["Today", "Giving"]);
    expect(l).not.toContain("People");
  });

  it("shows Giving to a bookkeeper who has Accounting but not Giving, and opens it on Accounting", () => {
    const w = visibleWorkspaces(ctx({ permissions: ["accounting.manage"] })).find((x) => x.key === "giving")!;
    expect(w).toBeTruthy();
    expect(w.modules.map((m) => m.key)).toEqual(["accounting"]);
    expect(w.href.startsWith("/accounting")).toBe(true);
  });

  it("shows every workspace to a platform admin, in order", () => {
    expect(labels(ctx({ isPlatformAdmin: true }))).toEqual(WORKSPACES.map((w) => w.label));
  });

  it("never shows the Platform console to anyone but a platform admin", () => {
    expect(labels(ctx({ permissions: ["settings.manage", "roles.manage", "giving.manage", "people.manage"] }))).not.toContain("Platform");
    expect(labels(ctx({ isOwner: true, permissions: [] }))).not.toContain("Platform");
  });

  it("drops a workspace when the community switched off all of its modules", () => {
    const l = labels(ctx({ isPlatformAdmin: true, modulesOff: ["giving", "bolis", "accounting"] }));
    expect(l).not.toContain("Giving");
    expect(l).toContain("People");
  });

  it("keeps a workspace while one of its modules is still on", () => {
    const w = visibleWorkspaces(ctx({ isPlatformAdmin: true, modulesOff: ["giving", "accounting"] })).find((x) => x.key === "giving")!;
    expect(w.modules.map((m) => m.key)).toEqual(["bolis"]);
    expect(w.href).toBe("/bolis");
  });

  it("shows the sandbox-only Demo data tab only in a sandbox", () => {
    const tabs = (environment: string) => visibleWorkspaces(ctx({ isPlatformAdmin: true, center: { environment } })).find((w) => w.key === "settings")!.tabs.map((t) => t.href);
    expect(tabs("sandbox")).toContain("/setup/demo");
    expect(tabs("production")).not.toContain("/setup/demo");
  });

  it("opens Learning on a teacher's own classes when the teacher lacks the principal's view", () => {
    const teacher = ctx({ grants: [{ role_key: "teacher", scope_kind: "class", scope_id: "class-1" }] });
    const w = visibleWorkspaces(teacher).find((x) => x.key === "learning")!;
    expect(w).toBeTruthy();
    expect(w.href).toBe("/pathshala/my-classes");
  });

  it("opens a workspace on its first page the person can open", () => {
    const w = visibleWorkspaces(ctx({ permissions: ["events.view"] })).find((x) => x.key === "events")!;
    expect(w.href).toBe("/events");
  });

  it("opens Giving on its own page when the person can open the giving module, and on the first page otherwise", () => {
    const w = visibleWorkspaces(ctx({ permissions: ["giving.record_offline"] })).find((x) => x.key === "giving")!;
    expect(w.href).toBe("/giving");
    expect(w.tabs.map((t) => t.href)).toEqual(["/giving/pledges", "/giving/payments"]);
    expect(activeWorkspace(visibleWorkspaces(ctx({ permissions: ["giving.record_offline"] })), "/giving")?.key).toBe("giving");
    const bolisOnly = visibleWorkspaces(ctx({ permissions: ["bolis.view"] })).find((x) => x.key === "giving")!;
    expect(bolisOnly.href).toBe("/bolis");
  });

  it("is exactly the modules and tabs visibleNav gives, regrouped (nothing added, nothing hidden)", () => {
    const contexts: ScopedContext[] = [
      ctx(),
      ctx({ isPlatformAdmin: true }),
      ctx({ isPlatformAdmin: true, modulesOff: ["events", "calendar", "comms"], center: { environment: "sandbox" } }),
      ctx({ permissions: ["people.view", "giving.view", "events.view", "comms.view", "reports.view"] }),
      ctx({ permissions: ["settings.manage", "roles.manage"] }),
      ctx({ permissions: ["accounting.manage", "giving.manage"] }),
      ctx({ grants: [{ role_key: "teacher", scope_kind: "class", scope_id: "class-1" }] }),
    ];
    for (const c of contexts) {
      const classic = visibleNav(c);
      const v2 = visibleWorkspaces(c);
      expect(v2.flatMap((w) => w.modules.map((m) => m.key)).sort()).toEqual(classic.map((m) => m.key).sort());
      expect(v2.flatMap((w) => w.tabs.map((t) => t.href)).sort()).toEqual(classic.flatMap((m) => m.tabs.map((t) => t.href)).sort());
      // The classic modules, regrouped without rebuilding them.
      expect(workspacesFor(classic)).toEqual(v2);
    }
  });
});

describe("finding the workspace a page belongs to", () => {
  const all = visibleWorkspaces(ctx({ isPlatformAdmin: true }));
  const at = (path: string) => activeWorkspace(all, path)?.key;

  it("matches pages and detail pages to their workspace", () => {
    expect(at("/")).toBe("today");
    expect(at("/households/123")).toBe("people");
    expect(at("/giving/payments")).toBe("giving");
    expect(at("/bolis/upload")).toBe("giving");
    expect(at("/accounting/close")).toBe("giving");
    expect(at("/calendar")).toBe("events");
    expect(at("/events/builder")).toBe("events");
    expect(at("/comms/inbox")).toBe("messages");
    expect(at("/pathshala/classes/abc/attendance")).toBe("learning");
    expect(at("/setup/organization")).toBe("settings");
    expect(at("/privacy")).toBe("settings");
    expect(at("/platform/https")).toBe("platform");
  });

  it("matches nothing for a page that is in no module", () => {
    expect(at("/search")).toBeUndefined();
  });

  it("lists a workspace's modules in the workspace's order, and only the ones given", () => {
    const nav = visibleNav(ctx({ isPlatformAdmin: true }));
    expect(modulesInWorkspace("giving", nav).map((m) => m.key)).toEqual(["giving", "bolis", "accounting"]);
    expect(modulesInWorkspace("giving", nav.filter((m) => m.key !== "bolis")).map((m) => m.key)).toEqual(["giving", "accounting"]);
    expect(modulesInWorkspace("today", [])).toEqual([]);
  });
});

describe("the phone's bottom bar", () => {
  it("has Today, People, Giving and Events, and everything else goes under More", () => {
    expect(PHONE_BAR_KEYS).toEqual(["today", "people", "giving", "events"]);
    const { bar, more } = phoneBar(visibleWorkspaces(ctx({ isPlatformAdmin: true })));
    expect(bar.map((w) => w.label)).toEqual(["Today", "People", "Giving", "Events"]);
    expect(more.map((w) => w.label)).toEqual(["Messages", "Learning", "Store", "Content", "Reports", "Settings", "Platform"]);
  });

  it("leaves out what the person cannot open, in the bar and under More", () => {
    const { bar, more } = phoneBar(visibleWorkspaces(ctx({ permissions: ["giving.record_offline", "comms.view"] })));
    expect(bar.map((w) => w.label)).toEqual(["Today", "Giving"]);
    expect(more.map((w) => w.label)).toEqual(["Messages", "Settings"]);
  });
});
