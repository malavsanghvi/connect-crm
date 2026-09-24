import { describe, expect, it } from "vitest";

import { explainError, failure, isStepUpError } from "@/lib/errors";
import {
  agreementState,
  explainAuthError,
  formatPhone,
  invitableRoles,
  invitationLink,
  invitationStatus,
  lastTotpAt,
  needsSecondApprover,
  normalizePhone,
  requires2faForStaff,
  safeNext,
  securityRedirect,
  stepUpFresh,
} from "@/lib/security";

describe("step-up errors (SQLSTATE CCSTP)", () => {
  const db = { code: "CCSTP", message: "This needs a fresh 2FA check.", hint: "Enter the 6-digit code…" };
  it("recognises the database's step-up refusal by code or sentence", () => {
    expect(isStepUpError(db)).toBe(true);
    expect(isStepUpError({ code: "P0001", message: "This needs a fresh 2FA check." })).toBe(true);
    expect(isStepUpError("Could not lock the month — this needs a fresh 2FA check.")).toBe(true);
    expect(isStepUpError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isStepUpError(null)).toBe(false);
  });
  it("explains it in plain English and flags the result for the step-up modal", () => {
    expect(explainError(db)).toBe("this needs a fresh 2FA check");
    const r = failure("Could not lock the month", db);
    expect(r).toEqual({ ok: false, error: "Could not lock the month — this needs a fresh 2FA check.", stepUp: true });
    expect(failure("Could not save", { code: "23505", message: "dup" }).stepUp).toBeUndefined();
  });
});

describe("the staff 2FA rule", () => {
  it("defaults to required, like the database", () => {
    expect(requires2faForStaff({})).toBe(true);
    expect(requires2faForStaff(null)).toBe(true);
    expect(requires2faForStaff({ security: { require_2fa_for_staff: false } })).toBe(false);
    expect(requires2faForStaff({ security: { require_2fa_for_staff: "no" } })).toBe(true);
  });
});

describe("amr and freshness", () => {
  const now = 1_790_262_000;
  const amr = [
    { method: "otp", timestamp: now - 3600 },
    { method: "totp", timestamp: now - 120 },
    { method: "totp", timestamp: now - 900 },
  ];
  it("finds the latest authenticator check", () => {
    expect(lastTotpAt(amr)).toBe(now - 120);
    expect(lastTotpAt([{ method: "otp", timestamp: now }])).toBeNull();
    expect(lastTotpAt("garbage")).toBeNull();
  });
  it("is fresh only for aal2 within the window", () => {
    expect(stepUpFresh("aal2", amr, now)).toBe(true);
    expect(stepUpFresh("aal1", amr, now)).toBe(false);
    expect(stepUpFresh("aal2", amr, now + 300)).toBe(false);
    expect(stepUpFresh("aal2", [{ method: "totp", timestamp: now + 3600 }], now)).toBe(false);
  });
});

describe("securityRedirect", () => {
  const base = { requires: true, isStaff: true, aal: "aal1", pathname: "/giving/pledges" };
  it("sends a staff session without 2FA to Account › Security, remembering where it was going", () => {
    expect(securityRedirect(base)).toBe("/account/security?required=1&next=%2Fgiving%2Fpledges");
    expect(securityRedirect({ ...base, pathname: "/" })).toBe("/account/security?required=1");
  });
  it("lets everyone else through", () => {
    expect(securityRedirect({ ...base, aal: "aal2" })).toBeNull();
    expect(securityRedirect({ ...base, requires: false })).toBeNull();
    expect(securityRedirect({ ...base, isStaff: false })).toBeNull();
    expect(securityRedirect({ ...base, pathname: "/account/security" })).toBeNull();
  });
  it("never redirects off the portal", () => {
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/people?x=1")).toBe("/people?x=1");
    expect(safeNext(null)).toBe("/");
  });
});

describe("phones", () => {
  it("normalises to E.164", () => {
    expect(normalizePhone("(713) 555-0142")).toBe("+17135550142");
    expect(normalizePhone("1 713 555 0142")).toBe("+17135550142");
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("555-0142")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("formats for display", () => {
    expect(formatPhone("+17135550142")).toBe("+1 (713) 555-0142");
    expect(formatPhone("+447700900123")).toBe("+447700900123");
    expect(formatPhone(null)).toBe("");
  });
});

describe("sign-in service errors", () => {
  it("are plain English", () => {
    expect(explainAuthError({ code: "mfa_verification_failed", message: "Invalid TOTP code entered" }, "verify the code")).toMatch(
      /^Could not verify the code — that code is wrong or has expired/,
    );
    expect(explainAuthError({ message: "Unable to get SMS provider" }, "send a code")).toMatch(/SMS provider/);
    expect(explainAuthError({ code: "insufficient_aal", message: "AAL2 required" }, "remove the authenticator")).toMatch(/fresh 2FA check/);
    expect(explainAuthError(null, "do it")).toBe("Could not do it — the sign-in service gave no reason.");
  });
});

describe("invitations", () => {
  it("builds the link", () => {
    expect(invitationLink("https://jsh.example.app/", "abc_-1")).toBe("https://jsh.example.app/invite/abc_-1");
  });
  it("offers only community staff roles and knows which need a second approver", () => {
    const roles = [
      { key: "center_admin", tier: "center" },
      { key: "teacher", tier: "operational" },
      { key: "platform_owner", tier: "platform" },
      { key: "child", tier: "family" },
    ];
    expect(invitableRoles(roles).map((r) => r.key)).toEqual(["center_admin", "teacher"]);
    expect(needsSecondApprover("treasurer")).toBe(true);
    expect(needsSecondApprover("content_editor")).toBe(false);
  });
  it("status", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(invitationStatus({ expires_at: "2026-09-30T00:00:00Z", accepted_at: null, revoked_at: null }, now)).toBe("pending");
    expect(invitationStatus({ expires_at: "2026-09-20T00:00:00Z", accepted_at: null, revoked_at: null }, now)).toBe("expired");
    expect(invitationStatus({ expires_at: "2026-09-30T00:00:00Z", accepted_at: null, revoked_at: "2026-09-21T00:00:00Z" }, now)).toBe("revoked");
    expect(invitationStatus({ expires_at: "2026-09-20T00:00:00Z", accepted_at: "2026-09-19T00:00:00Z", revoked_at: null }, now)).toBe("accepted");
  });
});

describe("agreementState", () => {
  const row = { kind: "dpa", required: true, published: true, accepted: false, accepted_version: null, version: "v2" };
  it("says what the owner has to do", () => {
    expect(agreementState(row)).toBe("needs_acceptance");
    expect(agreementState({ ...row, accepted: true })).toBe("accepted");
    expect(agreementState({ ...row, accepted_version: "v1" })).toBe("new_version");
    expect(agreementState({ ...row, published: false })).toBe("not_published");
    expect(agreementState({ ...row, required: false })).toBe("not_required");
  });
});
