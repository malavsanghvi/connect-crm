import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";
import { SLUG_RE, hostName, normalizeBaseDomain, resolveHost } from "@/lib/tenancy";

/** The organization chosen with the switcher when the address does not name one (bare IP, localhost, single site). */
export const CENTER_COOKIE = "cc_center";

export type CenterChoice = {
  slug: string;
  /** How it was chosen: the <slug>.<base> address, an organization's own domain, the switcher, or the deployment default. */
  source: "subdomain" | "domain" | "switcher" | "default";
};

export function portalBaseDomain(): string | null {
  return normalizeBaseDomain(process.env.PORTAL_BASE_DOMAIN);
}

// Own-domain lookups are cached briefly in this server process: every page
// load of a single-site deployment (crm.jsh.org) would otherwise ask the
// database whether that host is some organization's own domain.
const DOMAIN_TTL_MS = 60_000;
const domainCache = new Map<string, { slug: string | null; at: number }>();

export async function slugForDomain(host: string): Promise<string | null> {
  const hit = domainCache.get(host);
  if (hit && Date.now() - hit.at < DOMAIN_TTL_MS) return hit.slug;
  const env = readPublicEnv();
  if (!env.ok) return null;
  const db = createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: traceHeaders({ requestId: newRequestId(), screen: null }) },
  });
  const { data, error } = await db.rpc("center_slug_for_domain", { p_domain: host });
  if (error) {
    // Not cached: the next request tries again. The portal falls back to the switcher / default community.
    console.error(`[tenancy] could not look up the organization for "${host}" — using the default community:`, error);
    return null;
  }
  const slug = typeof data === "string" && data ? data : null;
  if (domainCache.size > 500) domainCache.clear();
  domainCache.set(host, { slug, at: Date.now() });
  return slug;
}

/**
 * Which organization this request is for, in order: the address
 * (<slug>.<PORTAL_BASE_DOMAIN>, or an organization's own domain), then the
 * switcher's cookie, then NEXT_PUBLIC_CENTER_SLUG (the bare IP or localhost of
 * a single-organization deployment keeps working exactly as before).
 */
export const resolveCenterChoice = cache(async (fallbackSlug: string): Promise<CenterChoice> => {
  let host: string | null = null;
  try {
    host = (await headers()).get("host");
  } catch (error) {
    console.error(`[tenancy] could not read the request host — using "${fallbackSlug}":`, error);
    return { slug: fallbackSlug, source: "default" };
  }
  const r = resolveHost(host, portalBaseDomain());
  if (r.kind === "subdomain") return { slug: r.slug, source: "subdomain" };
  if (r.kind === "custom") {
    const slug = await slugForDomain(r.host);
    if (slug) return { slug, source: "domain" };
  }
  try {
    const chosen = (await cookies()).get(CENTER_COOKIE)?.value?.trim().toLowerCase();
    if (chosen && SLUG_RE.test(chosen)) return { slug: chosen, source: "switcher" };
  } catch (error) {
    console.error("[tenancy] could not read the organization cookie — using the default community:", error);
  }
  return { slug: fallbackSlug, source: "default" };
});

/** The request's host and protocol, for building another organization's address. */
export async function currentOrigin(): Promise<{ protocol: string; host: string | null }> {
  const h = await headers();
  const host = h.get("host");
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (hostName(host)?.match(/^(localhost|\d|\[)/) ? "http" : "https");
  return { protocol: proto, host };
}
