import { describe, expect, it } from "vitest";

import { clearConfirmMessage, clearScope } from "@/lib/demo";
import { hasCenterRole, hasRole, hasScopedRole, passesRoleChecks } from "@/lib/permissions";
import { baseSlug, invitationEmailText, sandboxSlug, validateNewSandbox, type NewSandboxInput } from "@/lib/platform-sandbox";
import { acceptedPath } from "@/lib/security";
import { ENTITLEMENT_INFO, formatEntitlement, parseEntitlementInput } from "@/lib/tenancy";

// Stream f-sandbox (owner decisions 2026-09-25, second batch): JSH as a sandbox, sandboxes created
// by Community Connect, and the owner passing role-based checks.

const good: NewSandboxInput = {
  name: " Jain Center of Dallas ",
  slug: "Jain-Center-Dallas",
  orgType: "temple",
  city: "Dallas",
  state: "tx",
  ownerFirstName: "Asha",
  ownerLastName: "Mehta",
  ownerEmail: " Asha@Example.org ",
  reason: "Signed up at the convention",
};

describe("New sandbox form", () => {
  it("keeps the base web name and adds -sandbox once", () => {
    expect(baseSlug("Jain-Center-Dallas-sandbox ")).toBe("jain-center-dallas");
    expect(sandboxSlug("jcd")).toBe("jcd-sandbox");
    expect(sandboxSlug("jcd-sandbox")).toBe("jcd-sandbox");
    expect(sandboxSlug("  ")).toBe("");
  });

  it("normalizes a good form", () => {
    const r = validateNewSandbox(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ name: "Jain Center of Dallas", slug: "jain-center-dallas", state: "TX", ownerEmail: "asha@example.org" });
  });

  it("says plainly what is missing", () => {
    const bad = (patch: Partial<NewSandboxInput>) => {
      const r = validateNewSandbox({ ...good, ...patch });
      return r.ok ? null : r.error;
    };
    expect(bad({ name: "J" })).toMatch(/name/);
    expect(bad({ slug: "no spaces allowed" })).toMatch(/web name/);
    expect(bad({ orgType: "mosque" })).toMatch(/kind of organization/);
    expect(bad({ city: " " })).toMatch(/city/);
    expect(bad({ state: "Texas" })).toMatch(/two letters/);
    expect(bad({ ownerFirstName: "" })).toMatch(/first name/);
    expect(bad({ ownerEmail: "asha" })).toMatch(/email/);
    expect(bad({ reason: "" })).toMatch(/reason/);
    expect(bad({ reason: "x".repeat(501) })).toMatch(/500/);
  });

  it("always offers the link to send by hand, and says whether an email went", () => {
    expect(invitationEmailText("queued", "a@b.org")).toEqual({ tone: "ok", text: expect.stringContaining("queued to a@b.org") });
    expect(invitationEmailText("not_set_up", "a@b.org").text).toMatch(/isn't set up yet — send this link/);
    expect(invitationEmailText(null, "a@b.org").tone).toBe("warn");
    expect(invitationEmailText("failed: bounced", "a@b.org")).toEqual({ tone: "bad", text: expect.stringContaining("(bounced)") });
  });

  it("a new owner lands in Setup, through 2FA when required", () => {
    expect(acceptedPath({ owner: true, requires2fa: false })).toBe("/setup");
    expect(acceptedPath({ owner: true, requires2fa: true })).toBe("/account/security?welcome=1&next=%2Fsetup");
    expect(acceptedPath({ owner: false, requires2fa: true })).toBe("/account/security?welcome=1");
    expect(acceptedPath(null)).toBe("/account/security?welcome=1");
  });
});

describe("Sandbox limits for an organization in use (JSH)", () => {
  it("shows the expiry exemption and the in-place promotion flag", () => {
    expect(formatEntitlement("expiry_days_inactive", null)).toBe("Never expires");
    expect(formatEntitlement("max_people", null)).toBe("No limit");
    expect(ENTITLEMENT_INFO["promotion.in_place"]?.kind).toBe("flag");
    expect(formatEntitlement("promotion.in_place", true)).toBe("On");
    expect(parseEntitlementInput("promotion.in_place", "on")).toEqual({ ok: true, remove: false, value: true });
    expect(parseEntitlementInput("expiry_days_inactive", "No limit")).toEqual({ ok: true, remove: false, value: null });
  });

  it("Reset and Clear say they remove everything the organization entered", () => {
    const own = clearScope("JSH", { people: 1204, households: 1 }, true);
    expect(own.title).toMatch(/JSH's own records are not demo data/);
    expect(own.body).toMatch(/1,204 people and 1 household/);
    expect(own.body).toMatch(/not only the demo data/);
    expect(clearScope("Test", {}, false).body).toMatch(/not only the demo data/);
    expect(clearConfirmMessage("reset", "JSH")).toMatch(/^Reset JSH\?\nEvery record JSH entered .* then the demo pack is loaded again/);
    expect(clearConfirmMessage("clear", "JSH")).toMatch(/^Clear JSH\?\n.*not only the demo data.*cannot be undone\.$/);
  });
});

describe("The owner passes role-based checks", () => {
  const owner = { permissions: [], isPlatformAdmin: false, isOwner: true, grants: [] };
  const admin = { permissions: ["roles.manage"], isPlatformAdmin: false, grants: [{ role_key: "center_admin", scope_kind: "center", scope_id: null }] };
  it("as platform admins do", () => {
    expect(passesRoleChecks(owner)).toBe(true);
    expect(passesRoleChecks({ isPlatformAdmin: true })).toBe(true);
    expect(passesRoleChecks(admin)).toBe(false);
    expect(hasRole(owner, "executive_committee")).toBe(true);
    expect(hasScopedRole(owner, "zone-1", "zone_lead")).toBe(true);
    expect(hasCenterRole(owner, "teacher")).toBe(true);
    expect(hasRole(admin, "executive_committee")).toBe(false);
    expect(hasScopedRole(admin, "zone-1", "zone_lead")).toBe(false);
  });
});
