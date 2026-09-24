import "server-only";

import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { parseHttpsStatus, type HttpsStatus } from "@/lib/https";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";

// Server side of HTTPS for the portal (o-https): the droplet's HTTPS status file
// and the platform's public addresses saved in Platform setup.

export const DEFAULT_HTTPS_STATUS_FILE = "/srv/connect/https-status.json";

export type HttpsStatusRead = { ok: true; status: HttpsStatus } | { ok: false; reason: "missing" | "unreadable"; detail?: string };

/** The status written every minute by deploy/https-confirm.mjs on the droplet. */
export async function readHttpsStatus(): Promise<HttpsStatusRead> {
  const file = process.env.HTTPS_STATUS_FILE?.trim() || DEFAULT_HTTPS_STATUS_FILE;
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { ok: false, reason: "missing" };
    console.error(`[https] could not read the HTTPS status file ${file}:`, e);
    return { ok: false, reason: "unreadable", detail: code ?? "read error" };
  }
  try {
    const status = parseHttpsStatus(JSON.parse(text));
    if (status) return { ok: true, status };
    console.error(`[https] the HTTPS status file ${file} is not in the expected format`);
    return { ok: false, reason: "unreadable", detail: "unexpected format" };
  } catch (e) {
    console.error(`[https] the HTTPS status file ${file} is not valid JSON:`, e);
    return { ok: false, reason: "unreadable", detail: "not valid JSON" };
  }
}

export type PublicAddresses = { portal_domain: string | null; wildcard_domain: string | null };

// Cached briefly: a domain saved in Platform setup takes effect within a minute.
const ADDR_TTL_MS = 60_000;
let addrCache: { at: number; value: PublicAddresses } | null = null;

/** The portal domain and organizations' base domain saved in Platform setup (app.platform_public_addresses, 0330). */
export async function platformPublicAddresses(): Promise<{ ok: true; value: PublicAddresses } | { ok: false; error: string }> {
  if (addrCache && Date.now() - addrCache.at < ADDR_TTL_MS) return { ok: true, value: addrCache.value };
  const env = readPublicEnv();
  if (!env.ok) return { ok: false, error: "Supabase is not configured on this server" };
  const db = createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: traceHeaders({ requestId: newRequestId(), screen: null }) },
  });
  const { data, error } = await db.rpc("platform_public_addresses");
  if (error) {
    console.error("[https] could not read the platform's saved addresses:", error);
    return { ok: false, error: error.message };
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const value: PublicAddresses = {
    portal_domain: typeof d.portal_domain === "string" ? d.portal_domain : null,
    wildcard_domain: typeof d.wildcard_domain === "string" ? d.wildcard_domain : null,
  };
  addrCache = { at: Date.now(), value };
  return { ok: true, value };
}
