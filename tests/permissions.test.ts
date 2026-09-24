import { describe, expect, it } from "vitest";

import {
  ACCESS,
  can,
  canAccess,
  canManageIdentifierKind,
  canViewIdentifierKind,
  computePermissions,
  isGrantActive,
  manageableIdentifierKinds,
  visibleNav,
  activeModule,
  activeTabHref,
  pathUnder,
  type GrantLike,
} from "@/lib/permissions";

const roles = [
  { key: "treasurer", permissions: ["people.view", "people.manage", "giving.view", "giving.manage", "giving.approve", "accounting.manage", "audit.view"] },
  { key: "finance_volunteer", permissions: ["giving.record_offline", "bolis.view"] },
  { key: "membership_coordinator", permissions: ["people.view", "people.manage", "people.approve"] },
  { key: "event_lead", permissions: ["events.view", "reports.view"] },
  { key: "platform_owner", permissions: ["*"] },
];
const now = new Date("2026-09-23T12:00:00Z");
const grant = (role_key: string, extra: Partial<GrantLike> = {}): GrantLike => ({
  role_key,
  scope_kind: "center",
  starts_at: "2026-01-01T00:00:00Z",
  ends_at: null,
  ...extra,
});

describe("isGrantActive", () => {
  it("respects start and end", () => {
    expect(isGrantActive(grant("x"), now)).toBe(true);
    expect(isGrantActive(grant("x", { starts_at: "2026-10-01T00:00:00Z" }), now)).toBe(false);
    expect(isGrantActive(grant("x", { ends_at: "2026-09-23T11:59:59Z" }), now)).toBe(false);
    expect(isGrantActive(grant("x", { ends_at: "2026-09-23T12:00:01Z" }), now)).toBe(true);
  });
});

describe("computePermissions (mirrors app.has_permission)", () => {
  it("unions the permissions of active center-wide grants", () => {
    expect(computePermissions([grant("finance_volunteer"), grant("membership_coordinator")], roles, now)).toEqual([
      "bolis.view",
      "giving.record_offline",
      "people.approve",
      "people.manage",
      "people.view",
    ]);
  });

  it("ignores scoped grants — they never confer center-wide rights", () => {
    expect(computePermissions([grant("event_lead", { scope_kind: "event", scope_id: "e1" } as Partial<GrantLike>)], roles, now)).toEqual([]);
  });

  it("ignores expired grants and unknown roles", () => {
    expect(computePermissions([grant("treasurer", { ends_at: "2026-01-02T00:00:00Z" }), grant("nope")], roles, now)).toEqual([]);
  });

  it("does not expand '*' (the database checks the literal key)", () => {
    const perms = computePermissions([grant("platform_owner", { scope_kind: "platform" })], roles, now);
    expect(perms).toEqual(["*"]);
    expect(can({ permissions: perms, isPlatformAdmin: false }, "giving.view")).toBe(false);
  });
});

describe("can / canAccess", () => {
  const volunteer = { permissions: ["giving.record_offline"], isPlatformAdmin: false };
  it("needs any one of the listed permissions", () => {
    expect(can(volunteer, ["giving.view", "giving.record_offline"])).toBe(true);
    expect(canAccess(volunteer, "recordPayment")).toBe(true);
    expect(canAccess(volunteer, "allocatePayment")).toBe(false);
    expect(canAccess(volunteer, "households")).toBe(false);
  });
  it("lets platform admins through everything", () => {
    expect(canAccess({ permissions: [], isPlatformAdmin: true }, "roles")).toBe(true);
  });
  it("treats areas with no requirement as open", () => {
    expect(ACCESS.dashboard).toEqual([]);
    expect(canAccess({ permissions: [], isPlatformAdmin: false }, "dashboard")).toBe(true);
  });
});

describe("visibleNav (flat module list)", () => {
  it("hides what the user cannot open and drops modules with no tabs", () => {
    const nav = visibleNav({ permissions: ["giving.record_offline"], isPlatformAdmin: false });
    expect(nav.map((m) => m.label)).toEqual(["Home", "Giving"]);
    const giving = nav.find((m) => m.key === "giving")!;
    expect(giving.tabs.map((t) => t.href)).toEqual(["/giving/pledges", "/giving/payments"]);
    expect(giving.href).toBe("/giving/pledges");
  });
  it("keeps the prototype's module order", () => {
    const labels = visibleNav({ permissions: [], isPlatformAdmin: true }).map((m) => m.label);
    expect(labels).toEqual(["Home", "People", "Events", "Giving", "Bolis", "Satvik Store", "Pathshala", "Content", "Calendar", "Communications", "Accounting", "Reports", "Setup", "Settings", "Platform"]);
  });
  it("shows settings to a center admin and opens on the first tab they can use", () => {
    const nav = visibleNav({ permissions: ["roles.manage", "settings.manage"], isPlatformAdmin: false });
    const settings = nav.find((m) => m.key === "settings")!;
    expect(settings.tabs.map((t) => t.label)).toEqual(["Rules", "Roles & entitlements", "Onboarding fields", "Notifications", "Security", "Modules", "Team", "Agreements", "Member app", "Limits", "Numbering", "Storage", "Data import", "Custom fields", "Support access", "Email", "Texting", "WhatsApp"]);
    expect(nav.some((m) => m.key === "platform")).toBe(false);
    expect(nav.some((m) => m.key === "people")).toBe(false);
    const rolesOnly = visibleNav({ permissions: ["roles.manage"], isPlatformAdmin: false }).find((m) => m.key === "settings")!;
    expect(rolesOnly.href).toBe("/settings/roles");
  });
  it("lists the eight Settings tabs in the prototype's order (then Modules, Team, Agreements, Member app, Limits) for a platform admin, then Platform", () => {
    const nav = visibleNav({ permissions: [], isPlatformAdmin: true });
    expect(nav.find((m) => m.key === "settings")!.tabs.map((t) => t.label)).toEqual([
      "Rules",
      "Roles & entitlements",
      "Integrations",
      "Payments",
      "Privacy",
      "Onboarding fields",
      "Notifications",
      "Security",
      "Audit log",
      "Modules",
      "Team",
      "Agreements",
      "Member app",
      "Limits",
      "Numbering",
      "Storage",
      "Data import",
      "Custom fields",
      "Data quality",
      "Support access",
      "Email",
      "Texting",
      "WhatsApp",
    ]);
    expect(nav.find((m) => m.key === "platform")!.tabs.map((t) => t.label)).toEqual(["Centers", "New center wizard", "Verification", "Requests", "Sandbox codes", "Onboarding", "Go-live approvals", "Support access"]);
  });
  it("shows Setup above Settings to settings.manage holders only", () => {
    const admin = visibleNav({ permissions: ["settings.manage"], isPlatformAdmin: false });
    const keys = admin.map((m) => m.key);
    expect(keys.indexOf("setup")).toBe(keys.indexOf("settings") - 1);
    expect(admin.find((m) => m.key === "setup")!.tabs.map((t) => t.href)).toEqual(["/setup", "/setup/organization", "/setup/profile", "/setup/leaders", "/setup/lists", "/setup/readiness", "/setup/go-live"]);
    expect(visibleNav({ permissions: ["roles.manage", "people.view"], isPlatformAdmin: false }).some((m) => m.key === "setup")).toBe(false);
  });
  it("never shows Platform to a center admin, whatever they hold", () => {
    const every = ["people.view", "settings.manage", "roles.manage", "audit.view", "integrations.manage", "privacy.manage"];
    expect(visibleNav({ permissions: every, isPlatformAdmin: false }).some((m) => m.key === "platform")).toBe(false);
  });
  it("puts every page of the old grouped menu under exactly one module", () => {
    const all = visibleNav({ permissions: [], isPlatformAdmin: true }).flatMap((m) => m.tabs.map((t) => t.href));
    for (const href of [
      "/",
      "/households",
      "/memberships/applications",
      "/giving/pledges",
      "/giving/payments",
      "/giving/opportunities",
      "/giving/recurring",
      "/giving/labh",
      "/giving/statements",
      "/bolis",
      "/bolis/upload",
      "/store",
      "/store/menu",
      "/store/orders",
      "/calendar",
      "/accounting/qbo",
      "/accounting/close",
      "/reports",
      "/reports/community",
      "/settings/rules",
      "/settings/roles",
      "/settings/integrations",
      "/settings/privacy",
      "/settings/onboarding",
      "/settings/notifications",
      "/settings/security",
      "/settings/audit",
      "/platform",
      "/platform/new",
    ]) {
      expect(all.filter((h) => h === href)).toHaveLength(1);
    }
  });
});

describe("active module and tab", () => {
  const mods = visibleNav({ permissions: [], isPlatformAdmin: true });
  it("matches detail pages to their module", () => {
    expect(activeModule(mods, "/")?.key).toBe("home");
    expect(activeModule(mods, "/households/abc")?.key).toBe("people");
    expect(activeModule(mods, "/people/abc")?.key).toBe("people");
    expect(activeModule(mods, "/memberships/applications")?.key).toBe("people");
    expect(activeModule(mods, "/giving/payments/bank")?.key).toBe("giving");
    expect(activeModule(mods, "/giving/opportunities/campaigns")?.key).toBe("giving");
    expect(activeModule(mods, "/audit")?.key).toBe("settings");
    expect(activeModule(mods, "/privacy/requests")?.key).toBe("settings");
    expect(activeModule(mods, "/settings/center")?.key).toBe("settings");
    expect(activeModule(mods, "/platform/new")?.key).toBe("platform");
    expect(activeModule(mods, "/nowhere")).toBeUndefined();
  });
  it("never treats a prefix of a word as a match", () => {
    expect(pathUnder("/giving-old", "/giving")).toBe(false);
    expect(pathUnder("/giving", "/giving")).toBe(true);
    expect(pathUnder("/anything", "/")).toBe(false);
  });
  it("finds the tab a URL is on", () => {
    const giving = mods.find((m) => m.key === "giving")!;
    expect(activeTabHref(giving.tabs, "/giving/payments")).toBe("/giving/payments");
    expect(activeTabHref(giving.tabs, "/giving/payments/bank")).toBe("/giving/payments");
    expect(activeTabHref(giving.tabs, "/giving/opportunities/campaigns")).toBe("/giving/opportunities");
    expect(giving.tabs.map((t) => t.label)).toEqual([
      "Pledges",
      "Payments & deposits",
      "Opportunities",
      "Recurring",
      "Labh fulfillment",
      "Receipts & statements",
    ]);
    const reports = mods.find((m) => m.key === "reports")!;
    expect(activeTabHref(reports.tabs, "/reports/community")).toBe("/reports/community");
    expect(activeTabHref(reports.tabs, "/reports")).toBe("/reports");
    const people = mods.find((m) => m.key === "people")!;
    expect(activeTabHref(people.tabs, "/people/123")).toBe("/people");
    expect(activeTabHref(people.tabs, "/people/directory")).toBe("/people/directory");
  });
});

describe("identifier kind permissions (external_ids policies)", () => {
  const people = { permissions: ["people.view", "people.manage"], isPlatformAdmin: false };
  const finance = { permissions: ["giving.view", "giving.manage"], isPlatformAdmin: false };
  it("people.manage edits org person/household ids, crm and other", () => {
    expect(manageableIdentifierKinds(people)).toEqual(["org_member", "org_household", "crm", "other"]);
    expect(canManageIdentifierKind(people, "bank_payer")).toBe(false);
  });
  it("giving.manage edits accounting, bank payer and payment provider ids", () => {
    expect(manageableIdentifierKinds(finance)).toEqual(["accounting", "bank_payer", "payment_provider"]);
  });
  it("finance readers see every kind; people readers only people kinds", () => {
    expect(canViewIdentifierKind(finance, "org_member")).toBe(true);
    expect(canViewIdentifierKind(people, "accounting")).toBe(false);
    expect(canViewIdentifierKind(people, "org_household")).toBe(true);
  });
});
