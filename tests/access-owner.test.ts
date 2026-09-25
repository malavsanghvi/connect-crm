// Wave E (e-access): the owner can do every task (0400) and Community Connect's approval of the
// first second administrator (owner decisions 2026-09-25, items 1 and 2).
import { describe, expect, it } from "vitest";

import { allPermissionKeys, canAccess, sessionPermissions, visibleNav, type GrantLike } from "@/lib/permissions";
import { CC_FIRST_ADMIN_REASON, isFirstSecondAdminGrant, securityRedirect } from "@/lib/security";
import { navFooter } from "@/lib/shell";

const roles = [
  { key: "platform_owner", permissions: ["*"] },
  { key: "center_admin", permissions: ["people.view", "people.manage", "settings.manage", "roles.manage", "giving.view", "integrations.view"] },
  { key: "treasurer", permissions: ["giving.view", "giving.manage", "giving.approve", "accounting.manage", "accounting.close"] },
  { key: "privacy_officer", permissions: ["privacy.manage", "people.view"] },
];
const adminGrant: GrantLike = { role_key: "center_admin", scope_kind: "center", starts_at: "2020-01-01T00:00:00Z", ends_at: null };

describe("the owner holds every permission", () => {
  it("lists every key the roles define, never the '*' wildcard", () => {
    const all = allPermissionKeys(roles);
    expect(all).toContain("giving.manage");
    expect(all).toContain("accounting.close");
    expect(all).toContain("privacy.manage");
    expect(all).not.toContain("*");
    expect(all).toEqual([...all].sort());
  });

  it("an owner without any grant gets all of them; a center admin only their role's", () => {
    const owner = sessionPermissions([], roles, true);
    const admin = sessionPermissions([adminGrant], roles, false);
    expect(owner).toEqual(allPermissionKeys(roles));
    expect(admin).not.toContain("giving.manage");
    expect(admin).not.toContain("privacy.manage");
    const ownerCtx = { permissions: owner, isPlatformAdmin: false };
    const adminCtx = { permissions: admin, isPlatformAdmin: false };
    for (const key of ["givingManage", "qboManage", "closeManage", "privacy", "givingApprove"] as const) {
      expect(canAccess(ownerCtx, key)).toBe(true);
      expect(canAccess(adminCtx, key)).toBe(false);
    }
  });

  it("the owner's NAV shows the Giving and Accounting modules and Settings › Privacy; the admin's has no Privacy", () => {
    const owner = visibleNav({ permissions: sessionPermissions([], roles, true), isPlatformAdmin: false });
    const admin = visibleNav({ permissions: sessionPermissions([adminGrant], roles, false), isPlatformAdmin: false });
    const tabs = (nav: ReturnType<typeof visibleNav>) => nav.flatMap((m) => m.tabs.map((t) => t.href));
    expect(owner.map((m) => m.key)).toEqual(expect.arrayContaining(["giving", "accounting", "settings"]));
    expect(tabs(owner)).toEqual(expect.arrayContaining(["/settings/privacy", "/accounting/close", "/giving/pledges"]));
    expect(tabs(admin)).not.toContain("/settings/privacy");
  });

  it("the sidebar footer says the owner holds all permissions", () => {
    expect(navFooter({ roles: [], isPlatformAdmin: false, isOwner: true, permissions: ["a", "b"] })).toBe(
      "Owner · all permissions (owner). Menus, data and buttons follow your role, and the server enforces the same rules.",
    );
  });

  it("an owner with no grant counts as staff for the 2FA redirect", () => {
    expect(securityRedirect({ requires: true, isStaff: true, aal: "aal1", pathname: "/giving/pledges" })).toContain("/account/security");
  });
});

describe("Community Connect approves the first second administrator", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const active = (user_id: string, role_key = "center_admin") => ({ role_key, user_id, status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: null });
  const pending = { role_key: "center_admin", user_id: "second" };

  it("is the first when only the owner (and the grantee's own pending grant) exist", () => {
    expect(isFirstSecondAdminGrant(pending, [active("owner"), { ...active("second"), status: "pending", starts_at: "infinity" }], "owner", now)).toBe(true);
  });
  it("is not once another administrator exists, and never for other roles", () => {
    expect(isFirstSecondAdminGrant(pending, [active("owner"), active("third")], "owner", now)).toBe(false);
    expect(isFirstSecondAdminGrant({ role_key: "treasurer", user_id: "second" }, [active("owner")], "owner", now)).toBe(false);
  });
  it("an ended administrator grant does not count", () => {
    expect(isFirstSecondAdminGrant(pending, [active("owner"), { ...active("third"), ends_at: "2026-02-01T00:00:00Z" }], "owner", now)).toBe(true);
  });
  it("names the reason exactly as the database records it", () => {
    expect(CC_FIRST_ADMIN_REASON).toBe("Community Connect approval (two-person rule, first second admin)");
  });
});
