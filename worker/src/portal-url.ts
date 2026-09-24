// The portal's public address for links in messages (o-https). PORTAL_PUBLIC_URL
// wins; without it, the portal domain saved in Platform setup
// (app.platform_public_addresses, 0330) — https:// once the droplet's HTTPS check
// (deploy/https-confirm.mjs) has confirmed its certificate, http:// before that.
// Cached for a minute so a domain saved in the wizard takes effect without a redeploy.
import { readFile } from "node:fs/promises";

import type { JobContext } from "./types";

const TTL_MS = 60_000;
let cache: { at: number; value: string | null } | null = null;

export function resetPortalUrlCache(): void {
  cache = null;
}

/** https://<domain> when the status file lists it as confirmed; pure. */
export function originFor(domain: string, statusJson: unknown): string {
  const names = (statusJson as { names?: { name?: unknown; confirmed?: unknown }[] } | null)?.names;
  const ok = Array.isArray(names) && names.some((n) => n?.name === domain && n?.confirmed === true);
  return `${ok ? "https" : "http"}://${domain}`;
}

export async function portalPublicUrl(ctx: Pick<JobContext, "db" | "env" | "log">): Promise<string | null> {
  const env = typeof ctx.env.PORTAL_PUBLIC_URL === "string" ? ctx.env.PORTAL_PUBLIC_URL.trim() : "";
  if (env) return env.replace(/\/+$/, "");
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let domain: string | null = null;
  try {
    const rows = await ctx.db.query<{ a: { portal_domain?: unknown } | null }>("select app.platform_public_addresses() as a", []);
    const d = rows[0]?.a?.portal_domain;
    domain = typeof d === "string" && d ? d : null;
  } catch (e) {
    // Cached like a success (one log line a minute, not one per message); retried after the TTL.
    ctx.log.error("could not read the portal domain saved in Platform setup; links stay relative", { error: e instanceof Error ? e.message : String(e) });
    cache = { at: Date.now(), value: null };
    return null;
  }
  let value: string | null = null;
  if (domain) {
    const file = (typeof ctx.env.HTTPS_STATUS_FILE === "string" && ctx.env.HTTPS_STATUS_FILE) || "/srv/connect/https-status.json";
    let status: unknown = null;
    try {
      status = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") ctx.log.warn("could not read the HTTPS status file; using http:// for the portal links", { file, error: e instanceof Error ? e.message : String(e) });
    }
    value = originFor(domain, status);
  }
  cache = { at: Date.now(), value };
  return value;
}
