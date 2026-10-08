// The public website (www.weaverams.org): its name, the Chip In promise, and which
// requests belong to it. Pure functions only; src/proxy.ts applies the routing and
// tests/site.test.ts covers it.
//
// The marketing pages live under /site (src/app/site). The portal's own "/" is the
// dashboard, so on the website's hosts next.config.ts rewrites "/" to "/site" and "/pricing" to
// "/site/pricing" (src/lib/site-hosts.ts says why it is not done in the proxy), and the proxy
// sends everything that belongs to the portal (sign-in, request access, the sandbox start page,
// invitations, public dashboards, the APIs) to the portal's address.
// Any other host reaches the same pages at /site, which is how they are previewed.

import { DEFAULT_SITE_DOMAIN, SITE_PAGES, normalizeSiteDomain } from "@/lib/site-hosts";
import { hostName } from "@/lib/tenancy";

export { DEFAULT_SITE_DOMAIN, SITE_PAGES };

export const SITE_NAME = "Weaver";
export const SITE_TAGLINE = "AI Native Community Weaver Platform - Paid Forward Already";
export const SITE_DESCRIPTION =
  "Faith Weaver, Community Weaver and Org Weaver bring your members, households, events, giving, classes and accounting into one trusted place. Built and runs on generosity: free for your organization, for everyone, forever.";

/**
 * The optional Chip In: the most one account is ever asked to add, in total across every transaction in
 * a year (owner decision 2026-10-07). Integer cents like every amount; format only at the edge.
 */
export const TIP_YEARLY_CAP_CENTS = 2_500;

/** Whole dollars for headlines ("$25"); amounts with cents keep both digits ("$7.50"). */
export function usd(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
}

export function publicSiteDomain(raw: string | null | undefined = process.env.PUBLIC_SITE_DOMAIN): string {
  return normalizeSiteDomain(raw) ?? DEFAULT_SITE_DOMAIN;
}

/** The website's canonical origin: always the www name. */
export function siteOrigin(domain: string = publicSiteDomain()): string {
  return `https://www.${domain}`;
}

/** The portal's address (NEXT_PUBLIC_PORTAL_URL, else admin.<domain>), with an optional path. */
export function portalUrl(path = "", configured: string | null | undefined = process.env.NEXT_PUBLIC_PORTAL_URL, domain: string = publicSiteDomain()): string {
  const base = (configured ?? "").trim().replace(/\/+$/, "") || `https://admin.${domain}`;
  return `${base}${path}`;
}

/** True for the website's own names: the bare domain and www. */
export function isPublicSiteHost(rawHost: string | null | undefined, domain: string = publicSiteDomain()): boolean {
  const host = hostName(rawHost);
  return host === domain || host === `www.${domain}`;
}

/** Portal paths that may be linked from the website; a request for one is sent to the portal's address. */
export const PORTAL_PATH_PREFIXES = ["/login", "/request-access", "/start", "/invite", "/c", "/api"] as const;

/** Files the website serves itself (robots.txt, sitemap.xml, icons, the social preview image). */
const SITE_FILES = ["/robots.txt", "/sitemap.xml", "/icon.svg", "/apple-icon.png", "/favicon.ico"] as const;
const SOCIAL_IMAGE_PREFIX = "/site/opengraph-image";

export type SiteRoute =
  /** Not one of the website's hosts: the portal handles the request. */
  | { kind: "portal" }
  /** Serve the request as it is (the website's pages are mapped to /site by the rewrites in next.config.ts). */
  | { kind: "pass" }
  /** Answer 404 with SITE_NOT_FOUND_HTML. */
  | { kind: "not-found" }
  /** Send the browser to this absolute address. */
  | { kind: "redirect"; location: string };

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * What the proxy does with a request. On the bare domain everything moves to www (same path and query,
 * same protocol, so an address that has no certificate yet is never sent to https). On www only the website
 * is served: its pages, its files and its social preview image. Portal addresses are sent to the portal and
 * anything else is a plain 404 rather than the sign-in page.
 */
export function siteRoute(input: {
  host: string | null | undefined;
  pathname: string;
  search?: string;
  https: boolean;
  domain?: string;
  portal?: string;
}): SiteRoute {
  const domain = input.domain ?? publicSiteDomain();
  const host = hostName(input.host);
  if (!isPublicSiteHost(host, domain)) return { kind: "portal" };
  const search = input.search ?? "";
  const pathname = input.pathname.length > 1 ? input.pathname.replace(/\/+$/, "") || "/" : "/";

  if (host === domain) {
    return { kind: "redirect", location: `${input.https ? "https" : "http"}://www.${domain}${pathname}${search}` };
  }
  if (pathname === SOCIAL_IMAGE_PREFIX || pathname.startsWith(`${SOCIAL_IMAGE_PREFIX}-`)) return { kind: "pass" };
  if (SITE_FILES.includes(pathname as (typeof SITE_FILES)[number])) return { kind: "pass" };
  if (SITE_PAGES[pathname]) return { kind: "pass" };
  // The preview address (/site/...) is not a second copy of the website.
  if (under(pathname, "/site")) {
    const clean = pathname.slice("/site".length) || "/";
    return { kind: "redirect", location: `${siteOrigin(domain).replace(/^https/, input.https ? "https" : "http")}${clean}${search}` };
  }
  if (PORTAL_PATH_PREFIXES.some((p) => under(pathname, p))) {
    return { kind: "redirect", location: `${portalUrl("", input.portal, domain)}${pathname}${search}` };
  }
  // Not a page of the website and not a portal address: a plain 404 (never the sign-in page).
  return { kind: "not-found" };
}

/** The 404 page for an address on the website's host that is not part of it (the proxy answers it directly). */
export const SITE_NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page not found · ${SITE_NAME}</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F6F2EA;color:#1B2C5C;font-family:system-ui,sans-serif;text-align:center"><main style="padding:24px"><p style="margin:0;font-size:72px;font-weight:700;color:#C9731C">404</p><h1 style="margin:8px 0">We could not find that page</h1><p><a href="/" style="color:#1B2C5C;font-weight:700">Back to the home page</a></p></main></body></html>`;
