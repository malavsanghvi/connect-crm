import { describe, expect, it } from "vitest";

import { buildStatus, candidateNames, cleanName, decide, markerPlan } from "../deploy/https-confirm.mjs";

const ip = "134.122.25.56";

describe("cleanName", () => {
  it("accepts host names and IPv4, nothing that could escape the marker directory", () => {
    expect(cleanName("Portal.JSH.org.")).toBe("portal.jsh.org");
    expect(cleanName(ip)).toBe(ip);
    for (const bad of ["..", "../etc", "a/b", "wildcard_.jsh.org", "localhost", "", null]) expect(cleanName(bad)).toBeNull();
  });
});

describe("candidateNames", () => {
  it("orders the droplet address, SITE_DOMAIN, the wizard's names, then stored certificates, without duplicates", () => {
    const names = candidateNames({
      publicIp: ip, ipCert: true, siteDomain: "crm.jsh.org",
      portalNames: ["portal.jsh.org", "crm.jsh.org", "junk name"],
      storedNames: ["jsh.communityconnect.app", "portal.jsh.org", "wildcard_.communityconnect.app", "10.0.0.1"],
    });
    expect(names).toEqual([
      { name: ip, source: "droplet_ip" },
      { name: "crm.jsh.org", source: "site_domain" },
      { name: "portal.jsh.org", source: "platform_setting" },
      { name: "jsh.communityconnect.app", source: "certificate" },
    ]);
  });
  it("leaves the IP out when it has no IP certificate site", () => {
    expect(candidateNames({ publicIp: ip, ipCert: false, siteDomain: null }).map((n) => n.name)).toEqual([]);
  });
});

describe("decide", () => {
  it("DNS pointing elsewhere: plain instructions, no TLS attempt needed", () => {
    const d = decide({ name: "portal.jsh.org", publicIp: ip, dns: { addresses: ["198.51.100.9"] }, probe: null });
    expect(d.state).toBe("dns_elsewhere");
    expect(d.confirmed).toBe(false);
    expect(d.reason).toContain("198.51.100.9");
    expect(d.reason).toContain(`A record to ${ip}`);
  });
  it("no DNS record", () => {
    const d = decide({ name: "portal.jsh.org", publicIp: ip, dns: { addresses: [], error: "ENOTFOUND" }, probe: null });
    expect(d.state).toBe("dns_missing");
    expect(d.reason).toContain("ENOTFOUND");
  });
  it("DNS right, certificate fails: stays on http and says why", () => {
    const d = decide({ name: "portal.jsh.org", publicIp: ip, dns: { addresses: [ip] }, probe: { ok: false, error: "CERT_HAS_EXPIRED" } });
    expect(d).toMatchObject({ state: "https_failed", confirmed: false });
    expect(d.reason).toContain("CERT_HAS_EXPIRED");
  });
  it("DNS right and a verified certificate: confirmed", () => {
    expect(decide({ name: "portal.jsh.org", publicIp: ip, dns: { addresses: [ip] }, probe: { ok: true, validTo: "2026-10-01T00:00:00.000Z" } }))
      .toMatchObject({ state: "https_ok", confirmed: true, validTo: "2026-10-01T00:00:00.000Z" });
  });
  it("the IP needs no DNS", () => {
    expect(decide({ name: ip, publicIp: ip, dns: null, probe: { ok: true } }).confirmed).toBe(true);
    expect(decide({ name: ip, publicIp: ip, dns: null, probe: null }).state).toBe("not_checked");
  });
});

describe("markerPlan", () => {
  const results = [
    { name: "a.org", confirmed: true },
    { name: "b.org", confirmed: false },
  ];
  it("writes new confirmations and removes failed or vanished ones", () => {
    expect(markerPlan(["b.org", "gone.org"], results)).toEqual({ write: ["a.org"], remove: ["b.org", "gone.org"] });
  });
  it("keeps markers of names it could not list when the portal did not answer", () => {
    expect(markerPlan(["a.org", "b.org", "gone.org"], results, { complete: false })).toEqual({ write: [], remove: ["b.org"] });
  });
});

describe("buildStatus", () => {
  it("is what the portal reads", () => {
    const s = buildStatus({
      now: "2026-09-24T00:00:00.000Z", publicIp: ip, ipCert: false, ipCertNote: "Caddy v2.9.1 cannot request IP certificates",
      caddyVersion: "v2.9.1", portalNamesError: null,
      results: [{ name: "portal.jsh.org", source: "platform_setting", state: "https_ok", confirmed: true, reason: "ok", validTo: null }],
    });
    expect(s).toEqual({
      version: 1, checked_at: "2026-09-24T00:00:00.000Z", public_ip: ip,
      ip_certificate: { enabled: false, note: "Caddy v2.9.1 cannot request IP certificates" },
      caddy_version: "v2.9.1", portal_names_error: null,
      names: [{ name: "portal.jsh.org", source: "platform_setting", state: "https_ok", confirmed: true, reason: "ok", valid_to: null }],
    });
  });
});
