import { describe, expect, it } from "vitest";

import { PUBLIC_PATHS, isPublicPath } from "@/lib/supabase/proxy";
import { DEFAULT_SITE_DOMAIN, TIP_YEARLY_CAP_CENTS, isPublicSiteHost, portalUrl, publicSiteDomain, siteOrigin, siteRoute, usd } from "@/lib/site";

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

  it("serves the two pages of the website at / and /pricing", () => {
    expect(siteRoute({ ...base, host: www, pathname: "/" })).toEqual({ kind: "rewrite", pathname: "/site" });
    expect(siteRoute({ ...base, host: www, pathname: "/pricing" })).toEqual({ kind: "rewrite", pathname: "/site/pricing" });
    expect(siteRoute({ ...base, host: www, pathname: "/pricing/" })).toEqual({ kind: "rewrite", pathname: "/site/pricing" });
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
      expect(siteRoute({ ...base, host: www, pathname })).toEqual({ kind: "rewrite", pathname: "/site/not-found" });
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
