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

describe("visibleNav", () => {
  it("hides what the user cannot open and drops empty sections", () => {
    const nav = visibleNav({ permissions: ["giving.record_offline"], isPlatformAdmin: false });
    const hrefs = nav.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toEqual(["/", "/giving/pledges", "/giving/payments", "/giving/bank"]);
    expect(nav.map((s) => s.title)).toEqual(["Overview", "Giving"]);
  });
  it("shows settings to a center admin", () => {
    const hrefs = visibleNav({ permissions: ["roles.manage", "settings.manage"], isPlatformAdmin: false }).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/settings/roles");
    expect(hrefs).toContain("/settings/center");
    expect(hrefs).not.toContain("/households");
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
