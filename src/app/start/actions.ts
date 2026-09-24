"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import { CENTER_COOKIE, currentOrigin, portalBaseDomain } from "@/lib/center-resolve";
import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { failure, type ActionResult } from "@/lib/errors";
import { PRODUCT_NAME } from "@/lib/brand";
import { checkCodeMessage, clientIpFrom, normalizeSandboxCode, slugProblem } from "@/lib/platform-onboarding";
import { explainAuthError, normalizePhone } from "@/lib/security";
import { switchUrl } from "@/lib/tenancy";
import { createSupabaseServerClient, type AppSupabase } from "@/lib/supabase/server";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";

import { START_COOKIE, readStartCode } from "./start-code";

// /start (ONBOARDING_PLAN §3): redeem a sandbox code in five steps. The code is
// kept in an http-only cookie between the steps (it never goes in the address).
// Every step's rule is enforced again by the database when the sandbox is created
// (app.redeem_sandbox_code: the code's email, aal2, a verified phone, the terms).

async function browserContext(): Promise<{ ip: string | null; ua: string | null }> {
  try {
    const h = await headers();
    return { ip: clientIpFrom(h.get("x-forwarded-for"), h.get("x-real-ip")), ua: h.get("user-agent") };
  } catch (error) {
    console.error("[start] could not read the request headers:", error);
    return { ip: null, ua: null };
  }
}

async function signedIn(doing: string): Promise<{ ok: true; db: AppSupabase } | { ok: false; error: string }> {
  try {
    const db = await createSupabaseServerClient();
    const { data, error } = await db.auth.getClaims();
    if (error || !data?.claims?.sub) return { ok: false, error: `Could not ${doing} — sign in with your email first.` };
    return { ok: true, db };
  } catch (error) {
    return failure(`Could not ${doing}`, error);
  }
}

type AuthLike = { message?: string; code?: string; status?: number } | null | undefined;
function authFailure(doing: string, error: AuthLike): { ok: false; error: string } {
  console.error(`[start] ${doing} failed:`, error);
  return { ok: false, error: explainAuthError(error, doing) };
}

/** Step 1: check the code (anonymous, rate-limited) and remember it for the next steps. */
export async function checkStartCodeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const code = normalizeSandboxCode(String(fd.get("code") ?? ""));
  if (!code) return { ok: false, error: checkCodeMessage("invalid")! };
  const env = readPublicEnv();
  if (!env.ok) return { ok: false, error: "Could not check the code — the site is not configured. Please try again later." };
  const { ip } = await browserContext();
  const db = createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: traceHeaders({ requestId: newRequestId(), screen: "/start" }) },
  });
  const { data, error } = await db.rpc("check_sandbox_code", { p_code: code, p_ip: ip ?? undefined });
  if (error) return failure("Could not check the code", error);
  const problem = checkCodeMessage(String(data));
  if (problem && data !== "used") return { ok: false, error: problem };
  try {
    const origin = await currentOrigin();
    (await cookies()).set(START_COOKIE, code, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: origin.protocol.startsWith("https"),
      maxAge: 60 * 60 * 24,
    });
  } catch (err) {
    return failure("Could not remember the code for the next step", err);
  }
  return { ok: true, message: data === "used" ? "This code has been used" : "Code accepted" };
}

/** Start over with another code (and, if asked, sign out). */
export async function forgetStartCodeAction(signOut: boolean): Promise<ActionResult> {
  try {
    (await cookies()).delete(START_COOKIE);
  } catch (error) {
    return failure("Could not start over", error);
  }
  if (signOut) {
    const auth = await signedIn("sign out");
    if (auth.ok) {
      const { error } = await auth.db.auth.signOut({ scope: "local" });
      if (error) return authFailure("sign out", error);
    }
  }
  return { ok: true };
}

/** Step 3: text a code to the mobile number (Supabase Auth phone change). */
export async function sendStartPhoneCodeAction(rawPhone: string): Promise<ActionResult<{ phone: string }>> {
  const doing = "send a code to that number";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Enter the mobile number with its area code, for example (713) 555-0142, or +44 … for other countries." };
  const { error } = await auth.db.auth.updateUser({ phone });
  if (error) return authFailure(doing, error);
  return { ok: true, data: { phone }, message: `Code sent to ${phone}` };
}

/** Confirm the texted code with a cookie-less client, so the signed-in session is kept (as in Account › Security). */
export async function verifyStartPhoneCodeAction(rawPhone: string, code: string): Promise<ActionResult> {
  const doing = "verify the phone number";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const phone = normalizePhone(rawPhone);
  const clean = String(code ?? "").replace(/[\s-]+/g, "");
  if (!phone) return { ok: false, error: "The phone number is missing. Send a new code." };
  if (!/^\d{6,10}$/.test(clean)) return { ok: false, error: "Enter the code from the text message (numbers only)." };
  const env = readPublicEnv();
  if (!env.ok) return { ok: false, error: `Could not ${doing} — the site is not configured.` };
  const verifier = createClient(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.verifyOtp({ phone, token: clean, type: "phone_change" });
  if (error) return authFailure(doing, error);
  if (data.session) {
    const { error: outError } = await verifier.auth.signOut({ scope: "local" });
    if (outError) console.error("[start] could not close the extra session from the phone check:", outError);
  }
  return { ok: true, message: `Phone verified · ${phone}` };
}

export type StartEnrollment = { factorId: string; qrSvg: string; secret: string };

/** Step 4: add an authenticator app (QR code and setup key, shown to this user only). */
export async function startTotpAction(): Promise<ActionResult<StartEnrollment>> {
  const doing = "start setting up the authenticator app";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const { data: list, error: listError } = await auth.db.auth.mfa.listFactors();
  if (listError) return authFailure(doing, listError);
  for (const f of list?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      const { error } = await auth.db.auth.mfa.unenroll({ factorId: f.id });
      if (error) return authFailure(doing, error);
    }
  }
  const { data, error } = await auth.db.auth.mfa.enroll({
    factorType: "totp",
    issuer: PRODUCT_NAME,
    friendlyName: `Authenticator 1 · ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return authFailure(doing, error);
  return { ok: true, data: { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret } };
}

/** Finish with the app's first code: 2FA is on and this session passes it (aal2). */
export async function confirmTotpAction(factorId: string, code: string): Promise<ActionResult> {
  const doing = "turn on 2FA";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const clean = String(code ?? "").replace(/[\s-]+/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: "Enter the 6-digit code your authenticator app shows (numbers only)." };
  const { error } = await auth.db.auth.mfa.challengeAndVerify({ factorId: String(factorId), code: clean });
  if (error) return authFailure(doing, error);
  return { ok: true, message: "2FA is on" };
}

/** A returning redeemer who already has an app: pass its code so the session is aal2. */
export async function checkTotpAction(code: string): Promise<ActionResult> {
  const doing = "check the code";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const clean = String(code ?? "").replace(/[\s-]+/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: "Enter the 6-digit code from your authenticator app (numbers only)." };
  const { data: list, error: listError } = await auth.db.auth.mfa.listFactors();
  if (listError) return authFailure(doing, listError);
  const factor = list?.totp?.find((f) => f.status === "verified");
  if (!factor) return { ok: false, error: "No authenticator app is set up on this account yet. Reload the page to set one up." };
  const { error } = await auth.db.auth.mfa.challengeAndVerify({ factorId: factor.id, code: clean });
  if (error) return authFailure(doing, error);
  return { ok: true, message: "Verified" };
}

/** Step 5a: accept the Community Connect sandbox terms (recorded with the address and browser). */
export async function acceptStartTermsAction(documentId: string): Promise<ActionResult> {
  const auth = await signedIn("accept the sandbox terms");
  if (!auth.ok) return auth;
  const code = await readStartCode();
  if (!code) return { ok: false, error: "Could not accept the terms — the code is no longer remembered. Enter it again." };
  const { ip, ua } = await browserContext();
  const { error } = await auth.db.rpc("accept_sandbox_terms", { p_code: code, p_document: String(documentId), p_ip: ip ?? undefined, p_user_agent: ua ?? undefined });
  if (error) return failure("Could not accept the sandbox terms", error);
  return { ok: true, message: "Sandbox terms accepted" };
}

/** Step 5b: create the sandbox. Returns where to go next (its Setup checklist). */
export async function createSandboxAction(rawSlug: string): Promise<ActionResult<{ url: string; slug: string }>> {
  const auth = await signedIn("create the sandbox");
  if (!auth.ok) return auth;
  const code = await readStartCode();
  if (!code) return { ok: false, error: "Could not create the sandbox — the code is no longer remembered. Enter it again." };
  const problem = slugProblem(String(rawSlug ?? ""));
  if (problem) return { ok: false, error: `Could not create the sandbox — ${problem}` };
  const { data, error } = await auth.db.rpc("redeem_sandbox_code", { p_code: code, p_org_slug: String(rawSlug).trim().toLowerCase() });
  if (error) return failure("Could not create the sandbox", error);
  const slug = String((data as { slug?: unknown } | null)?.slug ?? "");
  if (!slug) return { ok: false, error: "Could not create the sandbox — the database did not say which organization it created. Reload and try again." };
  try {
    const store = await cookies();
    store.delete(START_COOKIE);
    const origin = await currentOrigin();
    // The same rule as the organization switcher: its subdomain (keeping the port) only when this
    // portal is already reached under the base domain; otherwise the organization cookie.
    const sub = switchUrl({ slug, portal_domain: null }, origin, portalBaseDomain());
    if (sub) return { ok: true, data: { slug, url: `${sub}setup` }, message: "Sandbox created" };
    store.set(CENTER_COOKIE, slug, { path: "/", httpOnly: true, sameSite: "lax", secure: origin.protocol.startsWith("https"), maxAge: 60 * 60 * 24 * 365 });
  } catch (err) {
    console.error("[start] the sandbox was created but the portal could not switch to it:", err);
    return { ok: true, data: { slug, url: "/" }, message: `Sandbox ${slug} created — choose it in the organization switcher` };
  }
  return { ok: true, data: { slug, url: "/setup" }, message: "Sandbox created" };
}
