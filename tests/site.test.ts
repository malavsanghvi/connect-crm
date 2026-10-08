import { describe, expect, it } from "vitest";

import { PUBLIC_PATHS, isPublicPath } from "@/lib/supabase/proxy";
import { WEAVERS, WEAVER_NAMES } from "@/components/site/weavers";
import { DEFAULT_SITE_DOMAIN, SITE_NOT_FOUND_HTML, SITE_PAGES, TIP_YEARLY_CAP_CENTS, isPublicSiteHost, portalUrl, publicSiteDomain, siteOrigin, siteRoute, usd } from "@/lib/site";
import { normalizeSiteDomain, siteRewrites } from "@/lib/site-hosts";

import nextConfig from "../next.config";

const www = "www.weaverams.org";
const base = { domain: "weaverams.org", https: true } as const;

describe("the optional tip promise", () => {
  it("is $25 a year, held as integer cents", () => {
    expect(TIP_YEARLY_CAP_CENTS).toBe(2500);
    expect(Number.isInteger(TIP_YEARLY_CAP_CENTS)).toBe(true);
    expect(usd(TIP_YEARLY_CAP_CENTS)).toBe("$25");
  });
  it("usd shows whole dollars bare and cents with two digits", () => {
    expect(usd(15_000)).toBe("$150");
    expect(usd(750)).toBe("$7.50");
    expect(usd(705)).toBe("$7.05");
    expect(usd(0)).toBe("$0");
  });
});

describe("addresses", () => {
  it("uses weaverams.org unless told otherwise", () => {
    expect(publicSiteDomain(undefined)).toBe(DEFAULT_SITE_DOMAIN);
    expect(publicSiteDomain("")).toBe("weaverams.org");
    expect(publicSiteDomain("https://Example.org/")).toBe("example.org");
    expect(siteOrigin("example.org")).toBe("https://www.example.org");
  });
  it("the portal is admin.<domain> unless NEXT_PUBLIC_PORTAL_URL says otherwise", () => {
    expect(portalUrl("/request-access", undefined, "weaverams.org")).toBe("https://admin.weaverams.org/request-access");
    expect(portalUrl("", "https://portal.example.org/", "weaverams.org")).toBe("https://portal.example.org");
    expect(portalUrl("/login", "  ", "weaverams.org")).toBe("https://admin.weaverams.org/login");
  });
  it("the website's hosts are the bare domain and www, with or without a port", () => {
    for (const h of ["weaverams.org", "www.weaverams.org", "WWW.WeaverAMS.org:443", "weaverams.org."]) expect(isPublicSiteHost(h, "weaverams.org")).toBe(true);
    for (const h of ["admin.weaverams.org", "jsh.weaverams.org", "app.weaverams.org", "evilweaverams.org", "weaverams.org.evil.com", "146.190.72.109", "localhost:3000", "", null, undefined]) {
      expect(isPublicSiteHost(h, "weaverams.org")).toBe(false);
    }
  });
});

describe("siteRoute", () => {
  it("leaves every other host to the portal", () => {
    for (const host of ["admin.weaverams.org", "jsh.weaverams.org", "146.190.72.109:8081", "localhost:3000", null]) {
      expect(siteRoute({ ...base, host, pathname: "/" })).toEqual({ kind: "portal" });
    }
  });

  it("sends the bare domain to www, keeping path, query and protocol", () => {
    expect(siteRoute({ ...base, host: "weaverams.org", pathname: "/pricing", search: "?utm=x" })).toEqual({ kind: "redirect", location: "https://www.weaverams.org/pricing?utm=x" });
    expect(siteRoute({ ...base, https: false, host: "weaverams.org", pathname: "/" })).toEqual({ kind: "redirect", location: "http://www.weaverams.org/" });
  });

  it("serves the two pages of the website at / and /pricing (mapped to /site by the config rewrites, not by the proxy)", () => {
    expect(siteRoute({ ...base, host: www, pathname: "/" })).toEqual({ kind: "pass" });
    expect(siteRoute({ ...base, host: www, pathname: "/pricing" })).toEqual({ kind: "pass" });
    expect(siteRoute({ ...base, host: www, pathname: "/pricing/" })).toEqual({ kind: "pass" });
  });

  it("passes the files the website serves itself", () => {
    for (const pathname of ["/robots.txt", "/sitemap.xml", "/icon.svg", "/favicon.ico", "/site/opengraph-image", "/site/opengraph-image-1a2b3c"]) {
      expect(siteRoute({ ...base, host: www, pathname })).toEqual({ kind: "pass" });
    }
  });

  it("does not serve the preview address as a second copy", () => {
    expect(siteRoute({ ...base, host: www, pathname: "/site" })).toEqual({ kind: "redirect", location: "https://www.weaverams.org/" });
    expect(siteRoute({ ...base, host: www, pathname: "/site/pricing", search: "?a=1" })).toEqual({ kind: "redirect", location: "https://www.weaverams.org/pricing?a=1" });
  });

  it("sends portal addresses to the portal, never serving the portal on www", () => {
    const portal = "https://admin.weaverams.org";
    expect(siteRoute({ ...base, host: www, pathname: "/login", search: "?next=%2Fgiving" })).toEqual({ kind: "redirect", location: `${portal}/login?next=%2Fgiving` });
    expect(siteRoute({ ...base, host: www, pathname: "/request-access" })).toEqual({ kind: "redirect", location: `${portal}/request-access` });
    expect(siteRoute({ ...base, host: www, pathname: "/start" })).toEqual({ kind: "redirect", location: `${portal}/start` });
    expect(siteRoute({ ...base, host: www, pathname: "/c/jsh" })).toEqual({ kind: "redirect", location: `${portal}/c/jsh` });
    expect(siteRoute({ ...base, host: www, pathname: "/api/payments/return" })).toEqual({ kind: "redirect", location: `${portal}/api/payments/return` });
    expect(siteRoute({ ...base, host: www, pathname: "/login", portal: "https://portal.example.org/" })).toEqual({ kind: "redirect", location: "https://portal.example.org/login" });
  });

  it("answers anything else with the website's 404, not the sign-in page", () => {
    for (const pathname of ["/giving", "/people/123", "/settings", "/loginx", "/pricing/extra", "/cc"]) {
      expect(siteRoute({ ...base, host: www, pathname })).toEqual({ kind: "not-found" });
    }
  });
});

describe("the preview address", () => {
  it("/site is reachable without a session on every host", () => {
    expect(PUBLIC_PATHS).toContain("/site");
    expect(isPublicPath("/site")).toBe(true);
    expect(isPublicPath("/site/pricing")).toBe(true);
    // A longer name that merely starts with the same letters is still the portal.
    expect(isPublicPath("/sitemap")).toBe(false);
    expect(isPublicPath("/sites")).toBe(false);
  });
});

describe("the three Weavers (owner decision 2026-10-08)", () => {
  it("are Faith Weaver, Community Weaver and Org Weaver, each with an anchor made from its name", () => {
    expect(WEAVERS.map((w) => w.name)).toEqual(["Faith Weaver", "Community Weaver", "Org Weaver"]);
    for (const w of WEAVERS) expect(w.id).toBe(w.name.toLowerCase().replace(/\s+/g, "-"));
    expect(WEAVER_NAMES).toBe("Faith Weaver, Community Weaver and Org Weaver");
  });
  it("each has an audience and points to show", () => {
    for (const w of WEAVERS) {
      expect(w.menu.length).toBeGreaterThan(10);
      expect(w.body.length).toBeGreaterThan(20);
      expect(w.points.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the website's page rewrites (next.config.ts)", () => {
  it("map / and /pricing to /site and /site/pricing, only for www.<domain>", () => {
    const rewrites = siteRewrites("weaverams.org");
    expect(rewrites.map((r) => [r.source, r.destination])).toEqual([
      ["/", "/site"],
      ["/pricing", "/site/pricing"],
    ]);
    for (const r of rewrites) {
      expect(r.has).toEqual([{ type: "host", value: "www\\.weaverams\\.org" }]);
      const host = new RegExp(`^${r.has[0].value}$`);
      expect(host.test("www.weaverams.org")).toBe(true);
      for (const other of ["weaverams.org", "admin.weaverams.org", "wwwXweaverams.org", "www.weaverams.org.evil.com"]) expect(host.test(other)).toBe(false);
    }
  });
  it("cover every page of the website, and follow PUBLIC_SITE_DOMAIN", () => {
    expect(siteRewrites("weaverams.org").map((r) => r.source)).toEqual(Object.keys(SITE_PAGES));
    expect(siteRewrites("https://Example.org/")[0].has[0].value).toBe("www\\.example\\.org");
    expect(siteRewrites("not a domain")[0].has[0].value).toBe("www\\.weaverams\\.org");
    expect(normalizeSiteDomain("https://Example.org/")).toBe("example.org");
    expect(normalizeSiteDomain("localhost")).toBeNull();
  });
  it("are what next.config.ts serves (before the file system, so the portal's own / never answers on www)", async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toEqual({ beforeFiles: siteRewrites() });
  });
  it("the 404 page for other addresses on www is a plain page with a way home", () => {
    expect(SITE_NOT_FOUND_HTML).toContain("404");
    expect(SITE_NOT_FOUND_HTML).toContain('href="/"');
    expect(SITE_NOT_FOUND_HTML).toContain("noindex");
  });
});
