import { describe, expect, it } from "vitest";

import {
  checkCodeMessage,
  clientIpFrom,
  codeState,
  daysSince,
  emailStatusText,
  goliveProgress,
  isHoneypotHit,
  normalizeSandboxCode,
  slugProblem,
  startStep,
  startStepIndex,
  suggestSlug,
  supportState,
} from "@/lib/platform-onboarding";

describe("sandbox codes", () => {
  it("normalizes what people type, like the database", () => {
    expect(normalizeSandboxCode(" cc-sbx 7k4m q2pd ")).toBe("CC-SBX-7K4M-Q2PD");
    expect(normalizeSandboxCode("7K4MQ2PD")).toBe("CC-SBX-7K4M-Q2PD");
    expect(normalizeSandboxCode("CC-SBX-7K4M-Q2P0")).toBeNull(); // 0 is a look-alike, never issued
    expect(normalizeSandboxCode("CC-SBX-7K4M")).toBeNull();
    expect(normalizeSandboxCode(null)).toBeNull();
  });
  it("reads a code's state", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(codeState({ redeemed_at: null, revoked_at: null, expires_at: "2026-10-01T00:00:00Z" }, now)).toBe("valid");
    expect(codeState({ redeemed_at: "2026-09-20T00:00:00Z", revoked_at: null, expires_at: "2026-09-21T00:00:00Z" }, now)).toBe("used");
    expect(codeState({ redeemed_at: null, revoked_at: "2026-09-20T00:00:00Z", expires_at: "2026-10-01T00:00:00Z" }, now)).toBe("revoked");
    expect(codeState({ redeemed_at: null, revoked_at: null, expires_at: "2026-09-24T12:00:00Z" }, now)).toBe("expired");
  });
  it("explains a code check in plain words, revealing nothing", () => {
    expect(checkCodeMessage("valid")).toBeNull();
    expect(checkCodeMessage("used")).toMatch(/already been used/);
    expect(checkCodeMessage("expired")).toMatch(/expired/);
    expect(checkCodeMessage("invalid")).toMatch(/not valid/);
  });
  it("says honestly when email is not set up", () => {
    expect(emailStatusText("queued")).toEqual({ tone: "ok", text: "Email queued" });
    expect(emailStatusText("not_set_up").text).toBe(
      "Email sending isn't set up yet — the code is shown here for the Community Connect team to send by hand",
    );
    expect(emailStatusText("failed: Sandboxes can send only to verified test recipients.")).toEqual({
      tone: "bad",
      text: "Email not sent — Sandboxes can send only to verified test recipients.",
    });
  });
});

describe("request form", () => {
  it("treats any value in the hidden field as a bot", () => {
    expect(isHoneypotHit(null)).toBe(false);
    expect(isHoneypotHit("")).toBe(false);
    expect(isHoneypotHit("  ")).toBe(false);
    expect(isHoneypotHit("555-1234")).toBe(true);
  });
  it("takes the browser's address from the forwarding headers only when it is an address", () => {
    expect(clientIpFrom("198.51.100.7, 10.0.0.1", null)).toBe("198.51.100.7");
    expect(clientIpFrom(null, "203.0.113.9")).toBe("203.0.113.9");
    expect(clientIpFrom("198.51.100.7:51234", null)).toBe("198.51.100.7");
    expect(clientIpFrom("[2001:db8::1]:443", null)).toBe("2001:db8::1");
    expect(clientIpFrom("<script>", null)).toBeNull();
    expect(clientIpFrom(null, null)).toBeNull();
  });
});

describe("web names", () => {
  it("mirrors the database's rule", () => {
    expect(slugProblem("jain-center-dallas")).toBeNull();
    expect(slugProblem("Bad Name")).toMatch(/lowercase/);
    expect(slugProblem("a")).toMatch(/lowercase/);
    expect(slugProblem("two--dashes")).toMatch(/lowercase/);
    expect(slugProblem("jcd-sandbox")).toMatch(/sandbox/);
  });
  it("suggests one from the organization's name", () => {
    expect(suggestSlug("Jain Temple of Example, Inc.")).toBe("jain-temple-of-example-inc");
    expect(suggestSlug("Śrī Pārśvanātha Mandir")).toBe("sri-parsvanatha-mandir");
  });
});

describe("/start", () => {
  const base = { code_status: "valid" as const, email_matches: true, phone_verified: true, has_totp: true, aal: "aal2", terms_accepted: true };
  it("walks code → sign in → phone → authenticator → terms → create", () => {
    expect(startStep(false, false, null)).toBe("code");
    expect(startStep(true, false, null)).toBe("signin");
    expect(startStep(true, true, { ...base, email_matches: false })).toBe("wrong_email");
    expect(startStep(true, true, { ...base, phone_verified: false })).toBe("phone");
    expect(startStep(true, true, { ...base, has_totp: false, aal: "aal1" })).toBe("authenticator");
    expect(startStep(true, true, { ...base, aal: "aal1" })).toBe("totp_check");
    expect(startStep(true, true, { ...base, terms_accepted: false })).toBe("terms");
    expect(startStep(true, true, base)).toBe("create");
  });
  it("closes on a used or expired code, except for the person who used it", () => {
    expect(startStep(true, true, { code_status: "expired" })).toBe("closed");
    expect(startStep(true, true, { code_status: "used", email_matches: true, center_slug: "jcd-sandbox" })).toBe("done");
    expect(startStep(true, true, { code_status: "used", email_matches: false })).toBe("closed");
  });
  it("numbers the steps for the progress strip", () => {
    expect(startStepIndex("code")).toBe(1);
    expect(startStepIndex("wrong_email")).toBe(2);
    expect(startStepIndex("totp_check")).toBe(4);
    expect(startStepIndex("create")).toBe(5);
  });
});

describe("pipeline and go-live", () => {
  it("counts whole days", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(daysSince("2026-09-20T13:00:00Z", now)).toBe(3);
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("garbage", now)).toBeNull();
  });
  it("says how far a go-live request has got", () => {
    expect(goliveProgress({ status: "requested", first_approver: null, second_approver: null })).toBe("0 of 2 approvals");
    expect(goliveProgress({ status: "requested", first_approver: "a", second_approver: null })).toBe("1 of 2 approvals");
    expect(goliveProgress({ status: "approved", first_approver: "a", second_approver: "b" })).toMatch(/^2 of 2/);
    expect(goliveProgress({ status: "rejected", first_approver: null, second_approver: null })).toMatch(/Sent back/);
  });
  it("reads a support grant", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(supportState({ revoked_at: null, expires_at: "2026-09-24T13:00:00Z" }, now)).toBe("live");
    expect(supportState({ revoked_at: null, expires_at: "2026-09-24T11:00:00Z" }, now)).toBe("expired");
    expect(supportState({ revoked_at: "2026-09-24T10:00:00Z", expires_at: "2026-09-24T13:00:00Z" }, now)).toBe("ended");
  });
});
