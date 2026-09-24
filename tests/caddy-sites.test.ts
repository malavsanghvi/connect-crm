import { describe, expect, it } from "vitest";

import { buildCaddySites, isPublicIPv4, normalizeDomain, parseSite } from "../deploy/caddy-sites.mjs";

const base = { app: "crm", port: 3000 };

describe("parseSite", () => {
  it("keeps :80 (and other ports) as plain HTTP", () => {
    expect(parseSite(":80")).toEqual({ httpPort: 80, domain: null });
    expect(parseSite(":8080")).toEqual({ httpPort: 8080, domain: null });
    expect(parseSite("")).toEqual({ httpPort: 80, domain: null });
  });
  it("normalizes a domain", () => {
    expect(parseSite("https://CRM.jsh.org/")).toEqual({ httpPort: 80, domain: "crm.jsh.org" });
  });
  it("refuses anything that could inject Caddyfile syntax", () => {
    expect(() => parseSite("crm.jsh.org {\n}")).toThrow();
    expect(() => parseSite("a b")).toThrow();
  });
});

describe("addresses", () => {
  it("normalizeDomain rejects IPs and junk", () => {
    expect(normalizeDomain("203.0.113.7")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("portal.jsh.org.")).toBe("portal.jsh.org");
  });
  it("isPublicIPv4 only accepts addresses Let's Encrypt can issue for", () => {
    expect(isPublicIPv4("134.122.25.56")).toBe(true);
    for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.1.1", "172.20.0.1", "100.64.0.1", "169.254.169.254", "203.0.113.7", "0.0.0.0", "256.1.1.1"]) {
      expect(isPublicIPv4(ip)).toBe(false);
    }
  });
});

describe("buildCaddySites", () => {
  it("with no domain and no IP certificate: port 80 serves as before, HTTPS only on demand", () => {
    const { files } = buildCaddySites({ ...base, site: ":80" });
    expect(Object.keys(files).sort()).toEqual(["00-on-demand-crm.caddy", "crm-wildcard.caddy", "crm.caddy"]);
    expect(files["00-on-demand-crm.caddy"]).toContain("ask http://127.0.0.1:3000/api/tenancy/tls-ask");
    expect(files["00-on-demand-crm.caddy"].trimStart().startsWith("{")).toBe(true);
    const main = files["crm.caddy"];
    expect(main).toContain(":80 {");
    expect(main).toContain("reverse_proxy 127.0.0.1:3000");
    // The redirect is conditional on the confirmation marker, never unconditional.
    expect(main).toMatch(/@https_ready file \{\n\t\troot \/var\/lib\/connect-https\/confirmed\n\t\ttry_files \/\{host\}\n\t\}\n\tredir @https_ready https:\/\/\{host\}\{uri\} 308/);
    expect(main).not.toMatch(/^https:\/\//m);
    expect(main.match(/redir /g)).toHaveLength(1);
    const wild = files["crm-wildcard.caddy"];
    expect(wild).toContain("https:// {\n\ttls {\n\t\ton_demand\n\t}");
    expect(wild).toContain("https://:8443 {");
    expect(wild).toContain("root * /srv/connect/mobile/current");
    expect(wild).not.toContain("profile shortlived");
  });

  it("the bare droplet address gets a short-lived Let's Encrypt IP certificate, and its own http:// block", () => {
    const { files, summary } = buildCaddySites({ ...base, site: ":80", publicIp: "134.122.25.56", ipCert: true });
    const main = files["crm.caddy"];
    expect(main).toContain("http://134.122.25.56 {");
    expect(main).toContain("https://134.122.25.56 {");
    expect(main).toContain("\t\tissuer acme {\n\t\t\tdir https://acme-v02.api.letsencrypt.org/directory\n\t\t\tprofile shortlived\n\t\t}");
    // Separate from the :80 catch-all (Caddy would otherwise add its own unconditional redirect).
    expect(main).not.toMatch(/:80, http/);
    expect(files["crm-wildcard.caddy"]).toContain("https://134.122.25.56:8443 {");
    expect(summary.join("\n")).toContain("short-lived IP certificate");
  });

  it("an IP certificate is not configured when it is switched off or the address is unknown", () => {
    expect(buildCaddySites({ ...base, site: ":80", publicIp: "134.122.25.56", ipCert: false }).files["crm.caddy"]).not.toContain("134.122.25.56");
    expect(buildCaddySites({ ...base, site: ":80", publicIp: null, ipCert: true }).files["crm.caddy"]).not.toContain("profile");
    expect(buildCaddySites({ ...base, site: ":80", publicIp: "not-an-ip", ipCert: true }).files["crm.caddy"]).not.toContain("profile");
  });

  it("SITE_DOMAIN gets a managed HTTPS site and an explicit http:// site (no automatic redirect)", () => {
    const { files } = buildCaddySites({ ...base, site: "crm.jsh.org", publicIp: "134.122.25.56", ipCert: true });
    const main = files["crm.caddy"];
    expect(main).toContain("http://crm.jsh.org, http://134.122.25.56 {");
    expect(main).toContain("https://crm.jsh.org {");
    expect(main).toContain(":80 {");
  });

  it("HSTS only for confirmed hosts, on every HTTPS site", () => {
    const { files } = buildCaddySites({ ...base, site: "crm.jsh.org", publicIp: "134.122.25.56", ipCert: true, hstsMaxAge: 600 });
    const all = Object.values(files).join("\n");
    const hsts = all.match(/header @hsts Strict-Transport-Security "max-age=600"/g) ?? [];
    const httpsSites = all.match(/^https:\/\/[^\n]*\{$/gm) ?? [];
    expect(httpsSites.length).toBe(5);
    expect(hsts.length).toBe(httpsSites.length);
    expect(all).not.toMatch(/Strict-Transport-Security[^\n]*includeSubDomains/);
  });

  it("no member site when there is no member app directory", () => {
    expect(buildCaddySites({ ...base, site: ":80", memberRoot: null }).files["crm-wildcard.caddy"]).not.toContain("8443");
  });

  it("validates its inputs", () => {
    expect(() => buildCaddySites({ ...base, app: "Crm;", site: ":80" })).toThrow(/app/);
    expect(() => buildCaddySites({ ...base, port: 0, site: ":80" })).toThrow(/port/);
    expect(() => buildCaddySites({ ...base, site: ":80", confirmedDir: "relative" })).toThrow(/confirmed/);
    expect(() => buildCaddySites({ ...base, site: ":80", memberRoot: "/srv/x y" })).toThrow(/member/);
  });

  it("is deterministic", () => {
    const a = buildCaddySites({ ...base, site: "crm.jsh.org", publicIp: "134.122.25.56", ipCert: true });
    const b = buildCaddySites({ ...base, site: "crm.jsh.org", publicIp: "134.122.25.56", ipCert: true });
    expect(a).toEqual(b);
  });

  it("test mode moves every port and uses Caddy's local CA", () => {
    const { files } = buildCaddySites({
      ...base, site: ":80", publicIp: "127.0.0.1", ipCert: true, memberHttpsPort: 18444,
      testing: { httpPort: 18480, httpsPort: 18443, localCerts: true, admin: "localhost:12419" },
    });
    expect(files["00-on-demand-crm.caddy"]).toContain("http_port 18480");
    expect(files["00-on-demand-crm.caddy"]).toContain("local_certs");
    expect(files["crm.caddy"]).toContain("redir @https_ready https://{host}:18443{uri} 308");
    expect(files["crm.caddy"]).not.toContain("profile shortlived");
  });
});
