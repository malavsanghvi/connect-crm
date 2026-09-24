"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { PRODUCT_NAME } from "@/lib/brand";
import { readPublicEnv } from "@/lib/env";
import { failure, type ActionResult } from "@/lib/errors";
import { explainAuthError, normalizePhone, stepUpFresh } from "@/lib/security";
import { loadSession } from "@/lib/session";
import { createSupabaseServerClient, type AppSupabase } from "@/lib/supabase/server";

// Account › Security and the step-up modal (stream o-security). Everything
// here acts on the signed-in user's OWN sign-in (Supabase Auth MFA and phone);
// the database checks the resulting session (aal2 / amr) on sensitive changes.

type AuthLike = { message?: string; code?: string; status?: number } | null | undefined;

function authFailure(doing: string, error: AuthLike): { ok: false; error: string; stepUp?: boolean } {
  console.error(`[security] ${doing} failed:`, error);
  const text = explainAuthError(error, doing);
  return /fresh 2FA check/.test(text) ? { ok: false, error: text, stepUp: true } : { ok: false, error: text };
}

async function signedIn(doing: string): Promise<{ ok: true; db: AppSupabase; centerId: string | null } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "ok") return { ok: true, db: state.session.db, centerId: state.session.center.id };
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  // A signed-in user whose center did not load can still manage their own sign-in.
  try {
    const db = await createSupabaseServerClient();
    const { data, error } = await db.auth.getClaims();
    if (error || !data?.claims?.sub) return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
    return { ok: true, db, centerId: null };
  } catch (error) {
    return failure(`Could not ${doing}`, error);
  }
}

/** Write the change to the community's audit log too (app.record_security_event). Never blocks the change itself. */
async function note(db: AppSupabase, centerId: string | null, event: "mfa.enrolled" | "mfa.removed" | "phone.verified" | "sessions.revoked") {
  if (!centerId) return null;
  const { error } = await db.rpc("record_security_event", { p_center: centerId, p_event: event });
  if (error) {
    console.error(`[security] could not record ${event} in the audit log:`, error);
    return "It was done, but it could not be written to the community's audit log.";
  }
  return null;
}

async function verifiedTotp(db: AppSupabase) {
  const { data, error } = await db.auth.mfa.listFactors();
  if (error) return { error, factor: null };
  return { error: null, factor: data?.totp?.find((f) => f.status === "verified") ?? null };
}

/**
 * The step-up modal: check the 6-digit code from the user's authenticator app.
 * On success the session cookie is upgraded (aal2, fresh totp time in amr) and
 * the caller retries the action the database refused.
 */
export async function verifyStepUpAction(code: string): Promise<ActionResult<{ needsEnrollment?: boolean }>> {
  const doing = "check the code";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const clean = String(code ?? "").replace(/[\s-]+/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: "Enter the 6-digit code from your authenticator app (numbers only)." };
  const { error: listError, factor } = await verifiedTotp(auth.db);
  if (listError) return authFailure(doing, listError);
  if (!factor) {
    return {
      ok: false,
      error: "You have not set up an authenticator app yet. Set one up in Account › Security, then try again.",
    };
  }
  const { error } = await auth.db.auth.mfa.challengeAndVerify({ factorId: factor.id, code: clean });
  if (error) return authFailure(doing, error);
  return { ok: true, message: "Verified · you can continue for the next 5 minutes" };
}

export type Enrollment = { factorId: string; qrSvg: string; secret: string; uri: string };

/** Start adding an authenticator app: returns the QR code and the setup key (shown to this user only). */
export async function startTotpEnrollmentAction(): Promise<ActionResult<Enrollment>> {
  const doing = "start setting up the authenticator app";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const { data: list, error: listError } = await auth.db.auth.mfa.listFactors();
  if (listError) return authFailure(doing, listError);
  // An abandoned, never-verified setup blocks a new one: clear it first.
  for (const f of list?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      const { error } = await auth.db.auth.mfa.unenroll({ factorId: f.id });
      if (error) return authFailure(doing, error);
    }
  }
  const verifiedCount = (list?.totp ?? []).filter((f) => f.status === "verified").length;
  const { data, error } = await auth.db.auth.mfa.enroll({
    factorType: "totp",
    issuer: PRODUCT_NAME,
    friendlyName: `Authenticator ${verifiedCount + 1} · ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return authFailure(doing, error);
  return { ok: true, data: { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri } };
}

/** Finish adding the app with its first code. The session becomes aal2. */
export async function confirmTotpEnrollmentAction(factorId: string, code: string): Promise<ActionResult> {
  const doing = "turn on 2FA";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const clean = String(code ?? "").replace(/[\s-]+/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: "Enter the 6-digit code your authenticator app shows (numbers only)." };
  const { error } = await auth.db.auth.mfa.challengeAndVerify({ factorId: String(factorId), code: clean });
  if (error) return authFailure(doing, error);
  const auditProblem = await note(auth.db, auth.centerId, "mfa.enrolled");
  revalidatePath("/", "layout");
  return { ok: true, message: `2FA is on · you'll enter a code from the app at sign-in and before sensitive changes${auditProblem ? ` · ${auditProblem}` : ""}` };
}

/** Remove an authenticator app. Needs a fresh 2FA check (the sign-in service insists on aal2). */
export async function removeTotpFactorAction(factorId: string): Promise<ActionResult> {
  const doing = "remove the authenticator app";
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  const { db, center, aal, amr } = state.session;
  if (!stepUpFresh(aal, amr, Math.floor(Date.now() / 1000))) {
    return { ok: false, error: `Could not ${doing} — this needs a fresh 2FA check.`, stepUp: true };
  }
  const { error } = await db.auth.mfa.unenroll({ factorId: String(factorId) });
  if (error) return authFailure(doing, error);
  const auditProblem = await note(db, center.id, "mfa.removed");
  revalidatePath("/", "layout");
  return { ok: true, message: `Authenticator app removed${auditProblem ? ` · ${auditProblem}` : ""}` };
}

/** Text a code to a new mobile number (Supabase Auth phone change). */
export async function sendPhoneCodeAction(rawPhone: string): Promise<ActionResult<{ phone: string }>> {
  const doing = "send a code to that number";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Enter the mobile number with its area code, for example (713) 555-0142, or +44 … for other countries." };
  const { error } = await auth.db.auth.updateUser({ phone });
  if (error) return authFailure(doing, error);
  return { ok: true, data: { phone }, message: `Code sent to ${phone}` };
}

/**
 * Confirm the texted code. Verified with a separate, cookie-less client: the
 * sign-in service answers a phone confirmation with a brand-new session that
 * has not passed 2FA, and swapping the user's session for it would drop them
 * back to aal1. That extra session is signed out straight away.
 */
export async function verifyPhoneCodeAction(rawPhone: string, code: string): Promise<ActionResult> {
  const doing = "verify the phone number";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const phone = normalizePhone(rawPhone);
  const clean = String(code ?? "").replace(/[\s-]+/g, "");
  if (!phone) return { ok: false, error: "The phone number is missing. Send a new code." };
  if (!/^\d{6,10}$/.test(clean)) return { ok: false, error: "Enter the code from the text message (numbers only)." };
  const env = readPublicEnv();
  if (!env.ok) return { ok: false, error: `Could not ${doing} — the app is not configured.` };
  const verifier = createClient(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.verifyOtp({ phone, token: clean, type: "phone_change" });
  if (error) return authFailure(doing, error);
  if (data.session) {
    const { error: outError } = await verifier.auth.signOut({ scope: "local" });
    if (outError) console.error("[security] could not close the extra session from the phone check:", outError);
  }
  const auditProblem = await note(auth.db, auth.centerId, "phone.verified");
  revalidatePath("/account/security");
  return { ok: true, message: `Phone verified · ${phone}${auditProblem ? ` · ${auditProblem}` : ""}` };
}

/** Sign out on every device (revokes every refresh token), including this one. */
export async function signOutEverywhereAction(): Promise<ActionResult> {
  const doing = "sign out everywhere";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const auditProblem = await note(auth.db, auth.centerId, "sessions.revoked");
  if (auditProblem) console.error("[security] sign-out everywhere was not audited");
  const { error } = await auth.db.auth.signOut({ scope: "global" });
  if (error) return authFailure(doing, error);
  return { ok: true, message: "Signed out everywhere" };
}
