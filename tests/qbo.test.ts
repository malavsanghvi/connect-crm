import { describe, expect, it } from "vitest";

import { authorizeUrl, intuitPortalConfig, redirectUri, signState, verifyState } from "@/lib/qbo/oauth";
import { accountChoices, connectionSummary, reasonProblem, setupSteps, type QboStatus } from "@/lib/qbo/setup";

const SECRET = "a-test-secret-that-is-at-least-32-characters";
const CENTER = "00000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000003";
const NONCE = "ab".repeat(32);

describe("QuickBooks OAuth state", () => {
  it("round-trips for the same person", () => {
    const s = signState(SECRET, CENTER, NONCE, USER);
    expect(verifyState(SECRET, s, USER)).toEqual({ center: CENTER, nonce: NONCE });
  });
  it("is refused for another person, another secret, or when tampered with", () => {
    const s = signState(SECRET, CENTER, NONCE, USER);
    expect(verifyState(SECRET, s, "10000000-0000-4000-8000-000000000011")).toBeNull();
    expect(verifyState(SECRET + "x", s, USER)).toBeNull();
    expect(verifyState(SECRET, s.replace(NONCE, "cd".repeat(32)), USER)).toBeNull();
    expect(verifyState(SECRET, "garbage", USER)).toBeNull();
    expect(verifyState(SECRET, null, USER)).toBeNull();
  });
  it("refuses to sign anything but a center id and a hex nonce", () => {
    expect(() => signState(SECRET, "jsh", NONCE, USER)).toThrow();
    expect(() => signState(SECRET, CENTER, "short", USER)).toThrow();
  });
});

describe("Intuit configuration on the portal", () => {
  it("names the missing variables, never values", () => {
    const c = intuitPortalConfig({}, "real");
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.missing).toEqual(["INTUIT_CLIENT_ID", "OAUTH_STATE_SECRET"]);
      expect(c.message).toMatch(/isn't configured on the Community Connect server yet/);
    }
    expect(intuitPortalConfig({ INTUIT_CLIENT_ID: "x", OAUTH_STATE_SECRET: "too-short" }, "real").ok).toBe(false);
  });
  it("uses the sandbox app for sandbox companies when there is one, and Intuit's host by default", () => {
    const env = { INTUIT_CLIENT_ID: "prod", INTUIT_SANDBOX_CLIENT_ID: "dev", OAUTH_STATE_SECRET: SECRET };
    expect(intuitPortalConfig(env, "sandbox")).toMatchObject({ ok: true, clientId: "dev", authorizeBase: "https://appcenter.intuit.com" });
    expect(intuitPortalConfig(env, "real")).toMatchObject({ ok: true, clientId: "prod" });
  });
  it("builds the authorization address with the accounting scope and the callback", () => {
    const url = new URL(authorizeUrl({ clientId: "prod", authorizeBase: "https://appcenter.intuit.com" }, redirectUri({}, "https://jsh.communityconnect.app"), "st"));
    expect(url.origin + url.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "prod",
      response_type: "code",
      scope: "com.intuit.quickbooks.accounting",
      redirect_uri: "https://jsh.communityconnect.app/api/oauth/intuit/callback",
      state: "st",
    });
    expect(redirectUri({ INTUIT_REDIRECT_URI: "https://fixed/api/oauth/intuit/callback" }, "http://x")).toBe("https://fixed/api/oauth/intuit/callback");
  });
});

describe("QuickBooks setup helpers", () => {
  const accounts = [
    { qbo_id: "1", name: "Donations", fully_qualified_name: "Donations", account_type: "Income", active: true },
    { qbo_id: "2", name: "Chase", fully_qualified_name: "Chase", account_type: "Bank", active: true },
    { qbo_id: "9", name: "Old", fully_qualified_name: "Old", account_type: "Income", active: false },
  ];
  it("offers only active accounts of the right type", () => {
    expect(accountChoices("income.general", accounts).map((a) => a.qbo_id)).toEqual(["1"]);
    expect(accountChoices("bank", accounts).map((a) => a.qbo_id)).toEqual(["2"]);
  });
  it("walks the five steps", () => {
    const base = { connection: null, last_pull: null, test_post: null,
      settings: { basis: null, posting: null, go_live_date: null, mapping_approved_at: null, mapping_approved_by: null, test_post_approved_at: null, test_post_approved_by: null } } as unknown as QboStatus;
    expect(setupSteps(base).map((s) => s.state)).toEqual(["current", "blocked", "blocked", "blocked", "blocked"]);
    const connected = { ...base, connection: { status: "connected" } as QboStatus["connection"], last_pull: { status: "succeeded", counts: { accounts: 3 } } as unknown as QboStatus["last_pull"] };
    expect(setupSteps(connected).map((s) => s.state)).toEqual(["done", "done", "current", "todo", "todo"]);
  });
  it("says what is connected and in which mode", () => {
    const c = { status: "connected", display_name: "JSH", realm_id: "1", read_only: true, provider: "quickbooks_online", mode: "test" } as NonNullable<QboStatus["connection"]>;
    expect(connectionSummary(c)).toBe("JSH · read-only (nothing is posted)");
    expect(connectionSummary({ ...c, read_only: false, provider: "intuit_sandbox" })).toBe("JSH · Intuit sandbox company, test mode");
    expect(connectionSummary({ ...c, read_only: false, mode: "live" })).toBe("JSH · live");
  });
  it("asks for a reason", () => {
    expect(reasonProblem(" ", "approve")).toMatch(/say why/);
    expect(reasonProblem("ok", "approve")).toBeNull();
  });
});
