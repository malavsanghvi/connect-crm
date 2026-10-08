// What next.config.ts needs to know about the public website, with no imports (the config file cannot use the "@/"
// alias): the product's domain, the website's pages, and the host-conditioned rewrites that serve them.
//
// Why rewrites live in the config and not in src/proxy.ts: behind the TLS-terminating proxy (Caddy) the browser uses
// https but the connection to this server is plain http. A rewrite made in the proxy file is an absolute address, and
// Next treats one whose address differs from the connection's as an external site and fetches it: over plain http that
// accidentally worked, over https it failed with a 500 and (even when it worked) changed the Host header the page saw.
// A rewrite in the config is internal and keeps the real Host.

/** The product's own domain; PUBLIC_SITE_DOMAIN overrides it for another deployment. */
export const DEFAULT_SITE_DOMAIN = "weaverams.org";

/** Pages of the website: public path → the route that renders it. */
export const SITE_PAGES: Readonly<Record<string, string>> = Object.freeze({ "/": "/site", "/pricing": "/site/pricing", "/get-ready/checklist.csv": "/site/get-ready/checklist.csv" });

/** "https://Example.org/" → "example.org"; null when it is not a plain domain name. */
export function normalizeSiteDomain(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : null;
}

export type SiteRewrite = { source: string; destination: string; has: { type: "host"; value: string }[] };

/** The rewrites that serve the website's pages on www.<domain> (the proxy has already moved the bare domain to www). */
export function siteRewrites(raw: string | null | undefined = process.env.PUBLIC_SITE_DOMAIN): SiteRewrite[] {
  const domain = normalizeSiteDomain(raw) ?? DEFAULT_SITE_DOMAIN;
  // The host is matched as a whole-string regular expression: escape the dots.
  const host = `www\\.${domain.replace(/\./g, "\\.")}`;
  return Object.entries(SITE_PAGES).map(([source, destination]) => ({ source, destination, has: [{ type: "host" as const, value: host }] }));
}
