import { describe, expect, it } from "vitest";

import { describeCaddyReload, parseHttpsStatus, requestIsHttps, summarizeHttps, type HttpsStatus } from "@/lib/https";

const now = Date.parse("2026-09-24T12:00:00Z");
const base = (over: Partial<HttpsStatus> = {}): HttpsStatus => ({
  version: 1, checked_at: "2026-09-24T11:59:30Z", public_ip: "134.122.25.56",
  ip_certificate: { enabled: true, note: null }, caddy_version: "v2.11.4", portal_names_error: null, caddy_reload: null, names: [], ...over,
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
  it("reads the last Caddy reload; a file from before the safety net has none", () => {
    const reload = { at: "2026-10-06T12:57:00.000Z", reason: "https://134.122.25.56 failed: alert 80", ok: true, error: null };
    expect(parseHttpsStatus({ ...base(), caddy_reload: reload })?.caddy_reload).toEqual(reload);
    expect(parseHttpsStatus({ ...base(), caddy_reload: { at: "2026-10-06T12:57:00.000Z", ok: false, error: "exit status 1" } })?.caddy_reload)
      .toEqual({ at: "2026-10-06T12:57:00.000Z", reason: null, ok: false, error: "exit status 1" });
    const old = { ...base() } as Record<string, unknown>;
    delete old.caddy_reload;
    expect(parseHttpsStatus(old)?.caddy_reload).toBeNull();
    expect(parseHttpsStatus({ ...base(), caddy_reload: { ok: true } })?.caddy_reload).toBeNull();
  });
});

describe("describeCaddyReload", () => {
  const ip = "134.122.25.56";
  const reload = (over: Partial<NonNullable<HttpsStatus["caddy_reload"]>> = {}) => ({
    at: "2026-09-24T11:57:00Z", reason: `https://${ip} failed: ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR: tlsv1 alert internal error`, ok: true, error: null, ...over,
  });
  it("nothing to say when the check never reloaded the web server", () => {
    expect(describeCaddyReload(base(), now)).toBeNull();
  });
  it("reloaded and the address works again", () => {
    const s = base({ caddy_reload: reload(), names: [name(ip, true, "https_ok", "droplet_ip")] });
    expect(describeCaddyReload(s, now)).toBe(
      `The web server (Caddy) was reloaded 3 minutes ago because https://${ip} failed: ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR: tlsv1 alert internal error; it works now.`,
    );
  });
  it("reloaded but the address still fails", () => {
    const s = base({ caddy_reload: reload({ at: "2026-09-24T09:00:00Z" }), names: [name(ip, false, "https_failed", "droplet_ip")] });
    expect(describeCaddyReload(s, now)).toBe(
      `The web server (Caddy) was reloaded 3 hours ago because https://${ip} failed: ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR: tlsv1 alert internal error; https://${ip} still fails.`,
    );
  });
  it("the reload itself failed: says so, and that http:// keeps working", () => {
    const s = base({ caddy_reload: reload({ ok: false, error: "systemctl reload caddy: exit status 1 (Job for caddy.service failed)" }) });
    const line = describeCaddyReload(s, now);
    expect(line).toContain("could not be reloaded 3 minutes ago — systemctl reload caddy: exit status 1 (Job for caddy.service failed) — although https://");
    expect(line).toContain("keeps working on http://");
  });
  it("an unreadable time stamp never throws", () => {
    expect(describeCaddyReload(base({ caddy_reload: reload({ at: "garbage" }) }), now)).toContain("reloaded at an unknown time");
    expect(describeCaddyReload(base({ caddy_reload: reload({ at: "2026-09-21T11:00:00Z" }) }), now)).toContain("reloaded 3 days ago");
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
