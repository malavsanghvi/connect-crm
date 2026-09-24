import { describe, expect, it } from "vitest";

import {
  formatEntitlement,
  formatJoinCode,
  hostName,
  joinAppLink,
  joinWebLink,
  normalizeBaseDomain,
  parseEntitlementInput,
  resolveHost,
  sharedCookieDomain,
  switchUrl,
} from "@/lib/tenancy";

const BASE = "communityconnect.app";

describe("hostName", () => {
  it("drops the port and trailing dot and lower-cases", () => {
    expect(hostName("JSH.CommunityConnect.app:443")).toBe("jsh.communityconnect.app");
    expect(hostName("jsh.communityconnect.app.")).toBe("jsh.communityconnect.app");
    expect(hostName("[::1]:3000")).toBe("[::1]");
    expect(hostName("  ")).toBeNull();
    expect(hostName(null)).toBeNull();
  });
});

describe("normalizeBaseDomain", () => {
  it("accepts a bare domain or a URL", () => {
    expect(normalizeBaseDomain("CommunityConnect.app")).toBe(BASE);
    expect(normalizeBaseDomain("https://communityconnect.app/")).toBe(BASE);
    expect(normalizeBaseDomain(".communityconnect.app")).toBe(BASE);
  });
  it("is null when unset or not a domain", () => {
    expect(normalizeBaseDomain(undefined)).toBeNull();
    expect(normalizeBaseDomain("")).toBeNull();
    expect(normalizeBaseDomain("localhost")).toBeNull();
  });
});

describe("resolveHost", () => {
  it("reads the organization from <slug>.<base>", () => {
    expect(resolveHost("jsh.communityconnect.app", BASE)).toEqual({ kind: "subdomain", slug: "jsh" });
    expect(resolveHost("jsh-sandbox.communityconnect.app:8443", BASE)).toEqual({ kind: "subdomain", slug: "jsh-sandbox" });
  });
  it("uses the fallback for IPs, localhost, the base domain itself and nested names", () => {
    expect(resolveHost("134.122.25.56", BASE)).toEqual({ kind: "none" });
    expect(resolveHost("localhost:3000", BASE)).toEqual({ kind: "none" });
    expect(resolveHost("[::1]:3000", BASE)).toEqual({ kind: "none" });
    expect(resolveHost("communityconnect.app", BASE)).toEqual({ kind: "none" });
    expect(resolveHost("www.communityconnect.app", BASE)).toEqual({ kind: "none" });
    expect(resolveHost("a.b.communityconnect.app", BASE)).toEqual({ kind: "none" });
    expect(resolveHost("-bad.communityconnect.app", BASE)).toEqual({ kind: "none" });
  });
  it("treats any other name as a possible own domain", () => {
    expect(resolveHost("portal.jsh.org", BASE)).toEqual({ kind: "custom", host: "portal.jsh.org" });
    expect(resolveHost("crm.jsh.org", null)).toEqual({ kind: "custom", host: "crm.jsh.org" });
    expect(resolveHost("jsh.communityconnect.app", null)).toEqual({ kind: "custom", host: "jsh.communityconnect.app" });
  });
});

describe("sharedCookieDomain", () => {
  it("shares the sign-in across <slug>.<base> only", () => {
    expect(sharedCookieDomain("jsh.communityconnect.app", BASE)).toBe(BASE);
    expect(sharedCookieDomain("communityconnect.app", BASE)).toBe(BASE);
    expect(sharedCookieDomain("portal.jsh.org", BASE)).toBeUndefined();
    expect(sharedCookieDomain("localhost:3000", BASE)).toBeUndefined();
    expect(sharedCookieDomain("jsh.communityconnect.app", null)).toBeUndefined();
  });
});

describe("switchUrl", () => {
  const on = (host: string) => ({ protocol: "https", host });
  it("prefers the organization's own domain", () => {
    expect(switchUrl({ slug: "jsh", portal_domain: "portal.jsh.org" }, on("x.communityconnect.app"), BASE)).toBe("https://portal.jsh.org/");
  });
  it("uses <slug>.<base> (keeping the port) from a base-domain portal", () => {
    expect(switchUrl({ slug: "jcnj", portal_domain: null }, on("jsh.communityconnect.app"), BASE)).toBe("https://jcnj.communityconnect.app/");
    expect(switchUrl({ slug: "jcnj", portal_domain: null }, { protocol: "http:", host: "jsh.cc.test:3300" }, "cc.test")).toBe("http://jcnj.cc.test:3300/");
  });
  it("is null (use the cookie) on a bare IP, localhost or a single-site address", () => {
    expect(switchUrl({ slug: "jcnj", portal_domain: null }, on("134.122.25.56"), BASE)).toBeNull();
    expect(switchUrl({ slug: "jcnj", portal_domain: null }, on("crm.jsh.org"), BASE)).toBeNull();
    expect(switchUrl({ slug: "jcnj", portal_domain: null }, on("jsh.communityconnect.app"), null)).toBeNull();
  });
});

describe("entitlements", () => {
  it("formats values in plain English", () => {
    expect(formatEntitlement("max_people", 2000)).toBe("2,000");
    expect(formatEntitlement("storage.bytes", 2147483648)).toBe("2 GB");
    expect(formatEntitlement("public_dashboard", false)).toBe("Off");
    expect(formatEntitlement("messaging.recipients", "test_only")).toBe("Verified test recipients only");
    expect(formatEntitlement("max_people", null)).toBe("No limit");
  });
  it("parses what a platform admin types", () => {
    expect(parseEntitlementInput("max_people", "")).toEqual({ ok: true, remove: true });
    expect(parseEntitlementInput("max_people", "5,000")).toEqual({ ok: true, remove: false, value: 5000 });
    expect(parseEntitlementInput("max_people", "No limit")).toEqual({ ok: true, remove: false, value: null });
    expect(parseEntitlementInput("storage.bytes", "5 GB")).toEqual({ ok: true, remove: false, value: 5 * 1024 ** 3 });
    expect(parseEntitlementInput("public_dashboard", "on")).toEqual({ ok: true, remove: false, value: true });
    expect(parseEntitlementInput("payments.mode", "Live")).toEqual({ ok: true, remove: false, value: "live" });
    expect(parseEntitlementInput("payments.mode", "test")).toEqual({ ok: true, remove: false, value: "test" });
  });
  it("refuses values that do not fit", () => {
    expect(parseEntitlementInput("max_people", "-3").ok).toBe(false);
    expect(parseEntitlementInput("max_people", "12.5").ok).toBe(false);
    expect(parseEntitlementInput("public_dashboard", "maybe").ok).toBe(false);
    expect(parseEntitlementInput("public_dashboard", "unlimited").ok).toBe(false);
    expect(parseEntitlementInput("payments.mode", "crypto").ok).toBe(false);
    expect(parseEntitlementInput("max_bananas", "1").ok).toBe(false);
  });
});

describe("join codes", () => {
  it("prints codes in two groups and builds the links", () => {
    expect(formatJoinCode("7k4mq2pd")).toBe("7K4M-Q2PD");
    expect(joinAppLink("7K4M-Q2PD")).toBe("communityconnect://join/7K4MQ2PD");
    expect(joinWebLink("7K4MQ2PD", "https://app.communityconnect.app/")).toBe("https://app.communityconnect.app/join/7K4MQ2PD");
    expect(joinWebLink("7K4MQ2PD", "")).toBeNull();
    expect(joinWebLink("7K4MQ2PD", "not a url")).toBeNull();
  });
});
