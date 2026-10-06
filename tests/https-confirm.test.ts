import { describe, expect, it } from "vitest";

import { buildStatus, candidateNames, cleanName, decide, markerPlan, RELOAD_MIN_INTERVAL_MS, shouldReloadCaddy } from "../deploy/https-confirm.mjs";

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

describe("shouldReloadCaddy", () => {
  const now = Date.parse("2026-10-06T13:00:00Z");
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
  const alert80 = "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR: tlsv1 alert internal error";
  const ipFailed = { name: ip, source: "droplet_ip", state: "https_failed", error: alert80 };
  const ipOk = { name: ip, source: "droplet_ip", state: "https_ok", error: null };
  const domainElsewhere = { name: "portal.jsh.org", source: "platform_setting", state: "dns_elsewhere", error: null };
  const domainFailed = { name: "portal.jsh.org", source: "platform_setting", state: "https_failed", error: "CERT_HAS_EXPIRED" };

  it("the droplet address fails and Caddy was never reloaded: reload, saying why", () => {
    expect(shouldReloadCaddy({ ipCert: true, results: [ipFailed, domainElsewhere], lastReloadAt: null, now }))
      .toEqual({ reload: true, reason: `https://${ip} failed: ${alert80}` });
  });
  it("any probe failure of the address counts, not only alert 80", () => {
    const reset = { ...ipFailed, error: "ECONNRESET: socket hang up" };
    expect(shouldReloadCaddy({ ipCert: true, results: [reset], lastReloadAt: undefined, now }))
      .toEqual({ reload: true, reason: `https://${ip} failed: ECONNRESET: socket hang up` });
  });
  it("reloaded 2 minutes ago: not again yet, and says so", () => {
    const v = shouldReloadCaddy({ ipCert: true, results: [ipFailed], lastReloadAt: minutesAgo(2), now });
    expect(v.reload).toBe(false);
    expect(v.reason).toContain("already reloaded 2 min ago");
  });
  it("reloaded 11 minutes ago: reload again", () => {
    expect(shouldReloadCaddy({ ipCert: true, results: [ipFailed], lastReloadAt: minutesAgo(11), now }).reload).toBe(true);
  });
  it("the interval is 10 minutes unless given", () => {
    expect(RELOAD_MIN_INTERVAL_MS).toBe(10 * 60_000);
    expect(shouldReloadCaddy({ ipCert: true, results: [ipFailed], lastReloadAt: minutesAgo(9), now }).reload).toBe(false);
    expect(shouldReloadCaddy({ ipCert: true, results: [ipFailed], lastReloadAt: minutesAgo(9), now, minIntervalMs: 5 * 60_000 }).reload).toBe(true);
  });
  it("a domain's trouble never reloads Caddy (its DNS may be the cause)", () => {
    expect(shouldReloadCaddy({ ipCert: true, results: [ipOk, domainElsewhere, domainFailed], lastReloadAt: null, now })).toEqual({ reload: false, reason: null });
    expect(shouldReloadCaddy({ ipCert: true, results: [domainElsewhere], lastReloadAt: null, now })).toEqual({ reload: false, reason: null });
  });
  it("no IP certificate: never", () => {
    expect(shouldReloadCaddy({ ipCert: false, results: [ipFailed], lastReloadAt: null, now })).toEqual({ reload: false, reason: null });
  });
  it("the droplet address works: nothing to do", () => {
    expect(shouldReloadCaddy({ ipCert: true, results: [ipOk], lastReloadAt: minutesAgo(60), now })).toEqual({ reload: false, reason: null });
  });
  it("an unreadable last-reload time counts as never", () => {
    expect(shouldReloadCaddy({ ipCert: true, results: [ipFailed], lastReloadAt: "not a date", now }).reload).toBe(true);
  });
});

describe("buildStatus", () => {
  const results = [{ name: "portal.jsh.org", source: "platform_setting", state: "https_ok", confirmed: true, reason: "ok", validTo: null }];
  it("is what the portal reads", () => {
    const s = buildStatus({
      now: "2026-09-24T00:00:00.000Z", publicIp: ip, ipCert: false, ipCertNote: "Caddy v2.9.1 cannot request IP certificates",
      caddyVersion: "v2.9.1", portalNamesError: null, results,
    });
    expect(s).toEqual({
      version: 1, checked_at: "2026-09-24T00:00:00.000Z", public_ip: ip,
      ip_certificate: { enabled: false, note: "Caddy v2.9.1 cannot request IP certificates" },
      caddy_version: "v2.9.1", portal_names_error: null, caddy_reload: null,
      names: [{ name: "portal.jsh.org", source: "platform_setting", state: "https_ok", confirmed: true, reason: "ok", valid_to: null }],
    });
  });
  it("carries the last Caddy reload, same version", () => {
    const reload = { at: "2026-10-06T12:57:00.000Z", reason: `https://${ip} failed: alert 80`, ok: true, error: null };
    const s = buildStatus({ now: "2026-10-06T13:00:00.000Z", publicIp: ip, ipCert: true, ipCertNote: null, caddyVersion: "v2.11.4", portalNamesError: null, results, caddyReload: reload });
    expect(s.version).toBe(1);
    expect(s.caddy_reload).toEqual(reload);
    const failed = buildStatus({ now: "2026-10-06T13:00:00.000Z", publicIp: ip, ipCert: true, ipCertNote: null, caddyVersion: "v2.11.4", portalNamesError: null, results, caddyReload: { at: "2026-10-06T12:57:00.000Z", reason: "x", ok: false, error: "systemctl reload caddy: exit status 1" } });
    expect(failed.caddy_reload).toEqual({ at: "2026-10-06T12:57:00.000Z", reason: "x", ok: false, error: "systemctl reload caddy: exit status 1" });
  });
});
