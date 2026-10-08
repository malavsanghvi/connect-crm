// The public website (www.weaverams.org): its name, the optional-tip promise, and which
// requests belong to it. Pure functions only; src/proxy.ts applies the routing and
// tests/site.test.ts covers it.
//
// The marketing pages live under /site (src/app/site). The portal's own "/" is the
// dashboard, so on the website's hosts the proxy rewrites "/" to "/site" and "/pricing" to
// "/site/pricing", and sends everything that belongs to the portal (sign-in, request access,
// the sandbox start page, invitations, public dashboards, the APIs) to the portal's address.
// Any other host reaches the same pages at /site, which is how they are previewed.

import { hostName, normalizeBaseDomain } from "@/lib/tenancy";

export const SITE_NAME = "Weaver AMS";
export const SITE_TAGLINE = "Free membership software for communities";
export const SITE_DESCRIPTION =
  "Weaver AMS brings your members, households, events, giving, classes and accounting into one trusted place. Free for your organization, forever.";

/** The product's own domain; PUBLIC_SITE_DOMAIN overrides it for another deployment. */
export const DEFAULT_SITE_DOMAIN = "weaverams.org";

/**
 * The optional tip: the most one account is ever asked to add, in total across every transaction in
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
  return normalizeBaseDomain(raw) ?? DEFAULT_SITE_DOMAIN;
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

/** Pages of the website: public path → the route that renders it. */
export const SITE_PAGES: Readonly<Record<string, string>> = Object.freeze({ "/": "/site", "/pricing": "/site/pricing" });

/** Portal paths that may be linked from the website; a request for one is sent to the portal's address. */
export const PORTAL_PATH_PREFIXES = ["/login", "/request-access", "/start", "/invite", "/c", "/api"] as const;

/** Files the website serves itself (robots.txt, sitemap.xml, icons, the social preview image). */
const SITE_FILES = ["/robots.txt", "/sitemap.xml", "/icon.svg", "/apple-icon.png", "/favicon.ico"] as const;
const SOCIAL_IMAGE_PREFIX = "/site/opengraph-image";

export type SiteRoute =
  /** Not one of the website's hosts: the portal handles the request. */
  | { kind: "portal" }
  /** Serve the request as it is. */
  | { kind: "pass" }
  /** Serve this internal route under the same address. */
  | { kind: "rewrite"; pathname: string }
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
  const page = SITE_PAGES[pathname];
  if (page) return { kind: "rewrite", pathname: page };
  // The preview address (/site/...) is not a second copy of the website.
  if (under(pathname, "/site")) {
    const clean = pathname.slice("/site".length) || "/";
    return { kind: "redirect", location: `${siteOrigin(domain).replace(/^https/, input.https ? "https" : "http")}${clean}${search}` };
  }
  if (PORTAL_PATH_PREFIXES.some((p) => under(pathname, p))) {
    return { kind: "redirect", location: `${portalUrl("", input.portal, domain)}${pathname}${search}` };
  }
  // Not a page of the website and not a portal address: let the 404 page answer (it is not the sign-in page).
  return { kind: "rewrite", pathname: "/site/not-found" };
}
