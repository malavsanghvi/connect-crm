"use server";

import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { failure, type ActionResult } from "@/lib/errors";
import { HONEYPOT_FIELD, clientIpFrom, isHoneypotHit } from "@/lib/platform-onboarding";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";

/**
 * The public "Request access" form (ONBOARDING_PLAN §3). Anonymous: it runs
 * app.submit_access_request with the anon key, passing the browser's address
 * and user agent from this request so the database can rate-limit per address.
 * The hidden honeypot field is checked here first.
 */
export async function submitAccessRequestAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "send your request";
  if (isHoneypotHit(fd.get(HONEYPOT_FIELD))) {
    console.error("[request-access] honeypot field filled — request refused");
    return { ok: false, error: "Your request could not be sent. If you are a person, reload the page and fill in only the visible fields." };
  }
  const env = readPublicEnv();
  if (!env.ok) return { ok: false, error: `Could not ${doing} — the site is not configured. Please try again later.` };
  const s = (n: string) => String(fd.get(n) ?? "").trim();
  const households = s("approx_households");
  const n = households ? Number(households.replace(/[, ]/g, "")) : null;
  if (households && (!Number.isInteger(n) || (n as number) < 0)) return { ok: false, error: "Enter roughly how many households as a whole number, for example 250." };
  const systems = [...fd.getAll("current_systems").map(String), ...s("other_systems").split(",")].map((x) => x.trim()).filter(Boolean);
  let ip: string | null = null;
  let ua: string | null = null;
  try {
    const h = await headers();
    ip = clientIpFrom(h.get("x-forwarded-for"), h.get("x-real-ip"));
    ua = h.get("user-agent");
  } catch (error) {
    console.error("[request-access] could not read the request headers — the database uses its own:", error);
  }
  const db = createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: traceHeaders({ requestId: newRequestId(), screen: "/request-access" }) },
  });
  const { error } = await db.rpc("submit_access_request", {
    p_org_legal_name: s("org_legal_name"),
    p_org_type: s("org_type"),
    p_city: s("city"),
    p_state: s("state"),
    // null = "not given" (the parameter has no default because required ones follow it)
    p_approx_households: n as number,
    p_contact_name: s("contact_name"),
    p_contact_email: s("contact_email"),
    p_contact_phone: s("contact_phone") || undefined,
    p_website: s("website") || undefined,
    p_modules_interested: fd.getAll("modules_interested").map(String),
    p_current_systems: systems,
    p_heard_from: s("heard_from") || undefined,
    p_ip: ip ?? undefined,
    p_user_agent: ua ?? undefined,
  });
  if (error) return failure(`Could not ${doing}`, error);
  return { ok: true, message: "Thank you — your request has reached the Community Connect team. We reply by email within 1–3 working days." };
}
