import { describe, expect, it } from "vitest";

import { APP_HTTPS_PORTS, buildAppSites, buildCaddySites, isPublicIPv4, normalizeDomain, parseSite } from "../deploy/caddy-sites.mjs";

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

// e-https-admin: connect-admin (the event-day app) on its own HTTPS port, next to the portal.
describe("buildAppSites", () => {
  const admin = { app: "admin", port: 3001 };

  it("writes only the app's own file; the portal's shared pieces are never touched", () => {
    const { files } = buildAppSites({ ...admin, site: ":8081" });
    expect(Object.keys(files)).toEqual(["admin.caddy"]);
    expect(files["admin.caddy"]).not.toMatch(/^\{/m); // no global options block: those are the portal's
    expect(files["admin.caddy"]).not.toContain("on_demand_tls");
  });

  it("keeps http://…:8081 serving, and redirects to its own HTTPS port only for confirmed hosts", () => {
    const main = buildAppSites({ ...admin, site: ":8081" }).files["admin.caddy"];
    expect(APP_HTTPS_PORTS.admin).toBe(8444);
    expect(main).toMatch(/^:8081 \{\n\t@https_ready \{\n\t\tfile \{\n\t\t\troot \/var\/lib\/connect-https\/confirmed\n\t\t\ttry_files \/\{host\}\n\t\t\}\n\t\tnot header_regexp Host \^\[0-9\.\]\+\(:\[0-9\]\+\)\?\$\n\t\}\n\tredir @https_ready https:\/\/\{host\}:8444\{uri\} 308\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:3001\n\}/m);
    expect(main.match(/redir /g)).toHaveLength(1);
    // Never onto the portal's :443 (HSTS would then pin the admin to the portal) nor :8081 itself.
    expect(main).not.toContain("https://{host}{uri}");
    expect(main).toContain("https://:8444 {\n\ttls {\n\t\ton_demand\n\t}");
    expect(main).not.toContain("profile shortlived");
  });

  it("the droplet address gets the same short-lived IP certificate on 8444 when the portal has one", () => {
    const main = buildAppSites({ ...admin, site: ":8081", publicIp: "134.122.25.56", ipCert: true }).files["admin.caddy"];
    expect(main).toContain("https://134.122.25.56:8444 {\n\ttls {\n\t\tissuer acme {");
    expect(main).toContain("profile shortlived");
    // No http:// block for the IP on port 80: that is the portal's.
    expect(main).not.toMatch(/^http:\/\//m);
    const noIp = buildAppSites({ ...admin, site: ":8081", publicIp: "134.122.25.56", ipCert: false }).files["admin.caddy"];
    expect(noIp).not.toContain("https://134.122.25.56");
    // …and a confirmed droplet address is then never sent to an https:// that has no certificate here.
    expect(noIp).toContain("\t\tnot header_regexp Host ^[0-9.]+(:[0-9]+)?$\n\t}\n\tredir @https_ready");
    // With its own IP site, a confirmed address is redirected like any name.
    const withIp = buildAppSites({ ...admin, site: ":8081", publicIp: "134.122.25.56", ipCert: true }).files["admin.caddy"];
    expect(withIp).not.toContain("not header_regexp");
    expect(withIp).toContain("\t@https_ready file {");
  });

  it("HSTS only for confirmed hosts, on every HTTPS site of the app", () => {
    for (const site of [":8081", "admin.jsh.org"]) {
      const main = buildAppSites({ ...admin, site, publicIp: "134.122.25.56", ipCert: true, hstsMaxAge: 600 }).files["admin.caddy"];
      const httpsSites = main.match(/^https:\/\/[^\n]*\{$/gm) ?? [];
      expect(httpsSites.length).toBe(site === ":8081" ? 2 : 3);
      expect((main.match(/header @hsts Strict-Transport-Security "max-age=600"/g) ?? []).length).toBe(httpsSites.length);
      expect(main).not.toContain("includeSubDomains");
    }
  });

  it("an app SITE_DOMAIN gets its own http:// (conditional redirect) and https:// sites, plus 8444", () => {
    const main = buildAppSites({ ...admin, site: "Admin.JSH.org" }).files["admin.caddy"];
    expect(main).toContain("http://admin.jsh.org {");
    expect(main).toContain("redir @https_ready https://{host}{uri} 308");
    expect(main).toContain("https://admin.jsh.org {");
    expect(main).toContain("https://:8444 {");
    expect(main).not.toContain(":8081");
  });

  it("refuses ports that belong to the portal, and the portal's own name", () => {
    expect(() => buildAppSites({ ...admin, site: ":80" })).toThrow(/portal/);
    expect(() => buildAppSites({ ...admin, site: ":443" })).toThrow(/portal/);
    expect(() => buildAppSites({ ...admin, site: ":8081", httpsPort: 443 })).toThrow(/already used/);
    expect(() => buildAppSites({ ...admin, site: ":8081", httpsPort: 8443 })).toThrow(/already used/);
    expect(() => buildAppSites({ ...admin, site: ":8081", httpsPort: 8081 })).toThrow(/already used/);
    expect(() => buildAppSites({ app: "crm", port: 3000, site: ":80" })).toThrow(/buildCaddySites/);
    expect(() => buildAppSites({ app: "mobile", port: 3002, site: ":8082" })).toThrow(/HTTPS port/);
    expect(() => buildAppSites({ ...admin, site: "admin.jsh.org {\n}" })).toThrow();
    expect(() => buildAppSites({ ...admin, site: ":8081", confirmedDir: "../x" })).toThrow(/confirmed/);
  });

  it("validates together with the portal's files: no port or name is defined twice", () => {
    const portal = buildCaddySites({ ...base, site: ":80", publicIp: "134.122.25.56", ipCert: true }).files;
    const app = buildAppSites({ ...admin, site: ":8081", publicIp: "134.122.25.56", ipCert: true }).files;
    const addr = (text: string) => (text.match(/^[^\s#{}][^\n]*\{$/gm) ?? []).flatMap((l) => l.replace(/ \{$/, "").split(", "));
    const portalAddrs = Object.values(portal).flatMap(addr);
    for (const a of Object.values(app).flatMap(addr)) expect(portalAddrs).not.toContain(a);
  });

  it("test mode moves 80/443 and uses Caddy's local CA", () => {
    const main = buildAppSites({
      ...admin, site: "admin.cc-https.test", httpsPort: 18545, publicIp: "127.0.0.1", ipCert: true,
      testing: { httpPort: 18580, httpsPort: 18543, localCerts: true },
    }).files["admin.caddy"];
    expect(main).toContain("http://admin.cc-https.test:18580 {");
    expect(main).toContain("redir @https_ready https://{host}:18543{uri} 308");
    expect(main).toContain("https://127.0.0.1:18545 {");
    expect(main).not.toContain("profile shortlived");
  });
});
