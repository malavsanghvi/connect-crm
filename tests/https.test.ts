import { describe, expect, it } from "vitest";

import { parseHttpsStatus, requestIsHttps, summarizeHttps, type HttpsStatus } from "@/lib/https";

const now = Date.parse("2026-09-24T12:00:00Z");
const base = (over: Partial<HttpsStatus> = {}): HttpsStatus => ({
  version: 1, checked_at: "2026-09-24T11:59:30Z", public_ip: "134.122.25.56",
  ip_certificate: { enabled: true, note: null }, caddy_version: "v2.11.4", portal_names_error: null, names: [], ...over,
});
const name = (n: string, confirmed: boolean, state = confirmed ? "https_ok" : "https_failed", source = "platform_setting") =>
  ({ name: n, source, state, confirmed, reason: `${n}: ${state}`, valid_to: null });

describe("parseHttpsStatus", () => {
  it("reads the confirmer's file and drops malformed rows", () => {
    const s = parseHttpsStatus({ ...base(), names: [name("a.org", true), { nope: 1 }, null] });
    expect(s?.names.map((n) => n.name)).toEqual(["a.org"]);
  });
  it("refuses other shapes", () => {
    expect(parseHttpsStatus(null)).toBeNull();
    expect(parseHttpsStatus({ version: 2, checked_at: "x", names: [] })).toBeNull();
  });
});

describe("summarizeHttps", () => {
  it("no status file yet: the next deploy installs the check", () => {
    const s = summarizeHttps({ ok: false, reason: "missing" }, null, now);
    expect(s.tone).toBe("warn");
    expect(s.next).toMatch(/Deploy the portal once/);
  });
  it("portal domain confirmed", () => {
    const s = summarizeHttps({ ok: true, status: base({ names: [name("crm.org", true)] }) }, "crm.org", now);
    expect(s).toMatchObject({ tone: "ok", headline: "HTTPS works on crm.org", next: null });
  });
  it("portal domain whose DNS points elsewhere: says exactly why", () => {
    const n = { ...name("crm.org", false, "dns_elsewhere"), reason: "crm.org points at 1.2.3.4, not at this server (134.122.25.56)." };
    const s = summarizeHttps({ ok: true, status: base({ names: [n] }) }, "crm.org", now);
    expect(s.tone).toBe("warn");
    expect(s.headline).toBe("crm.org is not on HTTPS yet");
    expect(s.next).toContain("points at 1.2.3.4");
  });
  it("portal domain saved but not checked yet", () => {
    const s = summarizeHttps({ ok: true, status: base() }, "crm.org", now);
    expect(s.lines[0]).toMatchObject({ name: "crm.org", tone: "warn" });
  });
  it("no domain, the IP has HTTPS", () => {
    const s = summarizeHttps({ ok: true, status: base({ names: [name("134.122.25.56", true, "https_ok", "droplet_ip")] }) }, null, now);
    expect(s.tone).toBe("ok");
    expect(s.headline).toBe("HTTPS works on 134.122.25.56");
    expect(s.next).toMatch(/Save the portal's domain name/);
  });
  it("no IP certificate: the reason from the deploy is shown", () => {
    const s = summarizeHttps({ ok: true, status: base({ ip_certificate: { enabled: false, note: "Caddy v2.9.1 refused the IP-certificate site" } }) }, null, now);
    expect(s.headline).toBe("The portal is on http:// only");
    expect(s.lines.some((l) => l.text.includes("Caddy v2.9.1 refused"))).toBe(true);
  });
  it("a stopped check is flagged and never reads as all-good", () => {
    const s = summarizeHttps({ ok: true, status: base({ checked_at: "2026-09-24T10:00:00Z", names: [name("crm.org", true)] }) }, "crm.org", now);
    expect(s.tone).toBe("warn");
    expect(s.lines.some((l) => l.name === "HTTPS check" && l.text.includes("120 minutes ago"))).toBe(true);
  });
  it("organizations' certificates are not listed one by one", () => {
    const s = summarizeHttps({ ok: true, status: base({ names: [name("jsh.orgs.test", true, "https_ok", "certificate")] }) }, null, now);
    expect(s.lines.map((l) => l.name)).not.toContain("jsh.orgs.test");
  });
});

describe("requestIsHttps", () => {
  it("reads the first X-Forwarded-Proto", () => {
    expect(requestIsHttps("https")).toBe(true);
    expect(requestIsHttps("HTTPS, http")).toBe(true);
    expect(requestIsHttps("http")).toBe(false);
    expect(requestIsHttps(null)).toBe(false);
  });
});
