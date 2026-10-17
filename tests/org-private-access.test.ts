import { describe, expect, it, vi } from "vitest";

// The organization's own data (migrations 0757-0759): DonorDelight and CatchTheMatch are seen only by the owner and the roles the
// organization grants, never by a platform admin as such. The portal's checks mirror the database's so the screens hide what it
// would refuse; the database decides (test 163).
vi.mock("server-only", () => ({}));

import { ENTITLEMENT_GROUPS, PRIVATE_GROUP_NOTE, entitlementGroupsFor, entitlementLabel, unknownPermissions } from "@/lib/entitlements";
import { LEGACY_KIND, NEUTRAL_KIND, type KindProfile } from "@/lib/kind";
import { loadMatchEmployer, matchEmployerSourceLine } from "@/lib/people-v2/match-employer";
import {
  ORG_PRIVATE_KEYS,
  can,
  canAccess,
  canGrantRole,
  canPrivate,
  careCan,
  computePermissions,
  matchingCan,
  orgPrivateProduct,
  rolePrivateProducts,
  sessionPermissions,
  type GrantLike,
} from "@/lib/permissions";
import { sectionPlan } from "@/lib/people-v2/slideover";

import { fakeDb, fakeSession } from "./commands/helpers";

const now = new Date("2026-10-13T12:00:00Z");
const grant = (role_key: string, extra: Partial<GrantLike> = {}): GrantLike => ({ role_key, scope_kind: "center", starts_at: "2026-01-01T00:00:00Z", ends_at: null, ...extra });
const roles = [
  { key: "care_lead", tier: "center", permissions: ["care.view", "care.manage"] },
  { key: "relationship_owner", tier: "center", permissions: ["care.own"] },
  { key: "matching_lead", tier: "center", permissions: ["matching.view", "matching.manage"] },
  { key: "treasurer", tier: "center", permissions: ["giving.view", "giving.manage"] },
  { key: "center_admin", tier: "center", permissions: ["roles.manage", "settings.manage", "audit.view"] },
  { key: "platform_owner", tier: "platform", permissions: ["*"] },
  { key: "odd_platform_role", tier: "platform", permissions: ["care.view"] },
];
const ctx = (permissions: string[], o: { isPlatformAdmin?: boolean; isOwner?: boolean; modulesOff?: string[] } = {}) => ({
  permissions,
  isPlatformAdmin: o.isPlatformAdmin ?? false,
  isOwner: o.isOwner ?? false,
  modulesOff: o.modulesOff ?? [],
});

describe("the private keys", () => {
  it("belong to DonorDelight and CatchTheMatch, and nothing else does", () => {
    expect(ORG_PRIVATE_KEYS).toEqual(["care.view", "care.own", "care.manage", "matching.view", "matching.manage"]);
    expect(orgPrivateProduct("care.view")).toBe("care");
    expect(orgPrivateProduct("matching.manage")).toBe("matching");
    expect(orgPrivateProduct("caretaker.view")).toBeNull();
    expect(orgPrivateProduct("giving.view")).toBeNull();
  });

  it("are opened by the new roles; a platform-tier role opens none, whatever it holds", () => {
    expect(rolePrivateProducts(roles[0])).toEqual(["care"]);
    expect(rolePrivateProducts(roles[2])).toEqual(["matching"]);
    expect(rolePrivateProducts(roles[3])).toEqual([]);
    expect(rolePrivateProducts(roles[5])).toEqual([]);
    expect(rolePrivateProducts(roles[6])).toEqual([]);
    expect(rolePrivateProducts({ tier: "center", permissions: ["*"] })).toEqual(["care", "matching"]);
  });
});

describe("can: a platform admin is not let through on the organization's own data", () => {
  it("keeps every other key for a platform admin, as before", () => {
    const admin = ctx([], { isPlatformAdmin: true });
    expect(can(admin, "people.view")).toBe(true);
    expect(can(admin, "giving.manage")).toBe(true);
    expect(canAccess(admin, "roles")).toBe(true);
  });

  it("refuses a platform admin every private key and area", () => {
    const admin = ctx([], { isPlatformAdmin: true });
    for (const k of ORG_PRIVATE_KEYS) expect(can(admin, k)).toBe(false);
    expect(canAccess(admin, "care")).toBe(false);
    expect(canAccess(admin, "matchingManage")).toBe(false);
    expect(careCan(admin, "own")).toBe(false);
    expect(matchingCan(admin, "view")).toBe(false);
  });

  it("counts a platform-admin account only as the community's owner, never through a role grant", () => {
    expect(canPrivate(ctx(["care.view"], { isPlatformAdmin: true }), "care.view")).toBe(false);
    expect(can(ctx(["care.view"], { isPlatformAdmin: true }), "care.view")).toBe(false);
    expect(canPrivate(ctx(["care.view"], { isPlatformAdmin: true, isOwner: true }), "care.view")).toBe(true);
    expect(canGrantRole(ctx(["care.manage"], { isPlatformAdmin: true }), roles[1])).toBe(false);
  });
});

describe("computePermissions and the owner", () => {
  it("takes private keys only from a center-wide grant of a role that is not a platform-tier role", () => {
    expect(computePermissions([grant("care_lead")], roles, now)).toEqual(["care.manage", "care.view"]);
    expect(computePermissions([grant("odd_platform_role")], roles, now)).toEqual([]);
    expect(computePermissions([grant("care_lead", { scope_kind: "platform" })], roles, now)).toEqual([]);
    expect(computePermissions([grant("treasurer", { scope_kind: "platform" })], roles, now)).toEqual(["giving.manage", "giving.view"]);
    expect(computePermissions([grant("care_lead", { ends_at: "2026-10-01T00:00:00Z" })], roles, now)).toEqual([]);
  });

  it("gives the owner every private key", () => {
    const perms = sessionPermissions([], roles.filter((r) => !r.key.startsWith("care") && !r.key.startsWith("matching")), true, now);
    for (const k of ORG_PRIVATE_KEYS) expect(perms).toContain(k);
  });
});

describe("canPrivate, careCan and matchingCan", () => {
  it("need the key and the product on", () => {
    const lead = ctx(["care.view", "care.manage"]);
    expect(canPrivate(lead, "care.view")).toBe(true);
    expect(canPrivate(ctx(["care.view"], { modulesOff: ["care"] }), "care.view")).toBe(false);
    expect(canPrivate(ctx(["giving.view"]), "care.view")).toBe(false);
  });

  it("follow the database's levels", () => {
    expect(careCan(ctx(["care.own"]), "own")).toBe(true);
    expect(careCan(ctx(["care.own"]), "view")).toBe(false);
    expect(careCan(ctx(["care.manage"]), "view")).toBe(true);
    expect(careCan(ctx(["care.view"]), "manage")).toBe(false);
    expect(matchingCan(ctx(["matching.manage"]), "view")).toBe(true);
    expect(matchingCan(ctx(["matching.view"]), "manage")).toBe(false);
    expect(matchingCan(ctx(["matching.view"], { modulesOff: ["giving", "matching"] }), "view")).toBe(false);
  });
});

describe("canGrantRole", () => {
  it("lets only the owner or the product's manager give a DonorDelight or CatchTheMatch role", () => {
    const [careLead, relOwner, matchLead, treasurer] = roles;
    expect(canGrantRole(ctx([], { isOwner: true }), careLead)).toBe(true);
    expect(canGrantRole(ctx(["care.manage"]), relOwner)).toBe(true);
    expect(canGrantRole(ctx(["care.manage"]), matchLead)).toBe(false);
    expect(canGrantRole(ctx(["roles.manage", "settings.manage"]), careLead)).toBe(false);
    expect(canGrantRole(ctx(["roles.manage"], { isPlatformAdmin: true }), careLead)).toBe(false);
    expect(canGrantRole(ctx(["roles.manage"]), treasurer)).toBe(true);
  });
});

describe("the entitlement catalogue", () => {
  it("describes the five keys, with who can see the data", () => {
    for (const k of ORG_PRIVATE_KEYS) expect(entitlementLabel(k)).not.toBe(k);
    expect(unknownPermissions([...ORG_PRIVATE_KEYS])).toEqual([]);
    const groups = ENTITLEMENT_GROUPS.filter((g) => g.note);
    expect(groups.map((g) => g.name)).toEqual(["DonorDelight", "CatchTheMatch"]);
    expect(PRIVATE_GROUP_NOTE).toContain("Weaver's team cannot");
    expect(ENTITLEMENT_GROUPS.find((g) => g.name === "Platform")?.items[0].label).toContain("except each organization's DonorDelight and CatchTheMatch data");
  });

  it("names DonorDelight in the kind's words and hides each product while it is off", () => {
    const faith: KindProfile = { ...LEGACY_KIND, modules: { care: { availability: "default_off", label: "Member care" } } };
    expect(entitlementGroupsFor(faith).map((g) => g.name)).toContain("Member care");
    const civic: KindProfile = { ...NEUTRAL_KIND, modules: { ...NEUTRAL_KIND.modules, care: { availability: "default_off", label: "Donor care" } } };
    expect(entitlementGroupsFor(civic).map((g) => g.name)).toContain("Donor care");
    const off = entitlementGroupsFor(LEGACY_KIND, ["care", "matching"]).map((g) => g.name);
    expect(off).not.toContain("DonorDelight");
    expect(off).not.toContain("CatchTheMatch");
    expect(entitlementGroupsFor(LEGACY_KIND, ["matching"]).map((g) => g.name)).toContain("DonorDelight");
  });
});

describe("the Gift matching section", () => {
  it("is there for an adult only while CatchTheMatch is on (D2)", () => {
    const keys = (o: { isChild: boolean; matchingOn?: boolean }) =>
      sectionPlan({ isChild: o.isChild, givingByPerson: false, givingOn: false, hasHistory: true, matchingOn: o.matchingOn }).map((s) => s.key);
    expect(keys({ isChild: false, matchingOn: true })).toContain("matching");
    expect(keys({ isChild: true, matchingOn: true })).not.toContain("matching");
    expect(keys({ isChild: false })).not.toContain("matching");
  });

  it("says where the employer came from", () => {
    expect(matchEmployerSourceLine({ source: "member", recordedBy: null }, "Mia", "Oct 13, 2026")).toBe("Added by Mia in the member app, Oct 13, 2026. Only Mia can change it.");
    expect(matchEmployerSourceLine({ source: "paper_form", recordedBy: "Asha Rao", personCanManage: true }, "Mia", "Oct 13, 2026")).toBe(
      "From a signed paper form, recorded by Asha Rao, Oct 13, 2026. Mia can see and remove it in the member app.",
    );
    expect(matchEmployerSourceLine({ source: "paper_form", recordedBy: "Asha Rao", personCanManage: false, waitsForFirstSignIn: true }, "Mia", null)).toBe(
      "From a signed paper form, recorded by Asha Rao. Mia can see and remove it in the member app once they first sign in with the email on file; until then only the office changes or withdraws it.",
    );
    expect(matchEmployerSourceLine({ source: "paper_form", recordedBy: "Asha Rao", personCanManage: false, waitsForFirstSignIn: false }, "Mia", null)).toContain(
      "Only the office changes or withdraws it",
    );
  });

  it("tells a role without CatchTheMatch it has no access, without reading anything", async () => {
    const db = fakeDb({ tables: { person_match_employers: [{ person_id: "p-1", center_id: "center-1", employer_name: "Acme", source: "member", recorded_by: "u-1", consented_at: "2026-10-13T12:00:00Z" }] } });
    const res = await loadMatchEmployer(fakeSession({ db, permissions: ["people.view", "people.manage"], isPlatformAdmin: true }), { id: "p-1", profileEmployer: null });
    expect(res).toEqual({ state: "no-access" });
  });

  it("reads what is on file for a CatchTheMatch reader, and offers the profile's employer only when nothing is", async () => {
    const row = { person_id: "p-1", center_id: "center-1", employer_name: "Acme", source: "member", recorded_by: "u-1", consented_at: "2026-10-13T12:00:00Z", consented_by_user: "u-1" };
    const on = await loadMatchEmployer(fakeSession({ db: fakeDb({ tables: { person_match_employers: [row] } }), permissions: ["matching.view"] }), { id: "p-1", profileEmployer: "Globex" });
    expect(on).toEqual({ state: "ok", data: { employer: "Acme", source: "member", recordedAt: row.consented_at, recordedBy: null, suggestion: null, canRecord: false, personCanManage: true, waitsForFirstSignIn: false } });
    const none = await loadMatchEmployer(fakeSession({ db: fakeDb({ tables: { person_match_employers: [] } }), permissions: ["matching.manage"] }), { id: "p-1", profileEmployer: " Globex " });
    expect(none).toEqual({ state: "ok", data: { employer: null, source: null, recordedAt: null, recordedBy: null, suggestion: "Globex", canRecord: true, personCanManage: false, waitsForFirstSignIn: false } });
  });

  it("says so in words when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ failTables: { person_match_employers: { message: "connection reset" } } });
    const res = await loadMatchEmployer(fakeSession({ db, permissions: ["matching.view"] }), { id: "p-1", profileEmployer: null });
    expect(res.state).toBe("error");
    expect(res.state === "error" ? res.message : "").toContain("Could not load the employer for gift matching");
  });
});
