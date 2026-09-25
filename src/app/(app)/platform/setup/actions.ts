"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { readPublicEnv } from "@/lib/env";
import { failure, type ActionResult } from "@/lib/errors";
import { FIELDS, fieldProblem, isStepKey, normalizeDomain, SETUP_LATER_COOKIE, STEP_BY_KEY } from "@/lib/platform-setup/catalog";
import { loadPlatformConfig } from "@/lib/platform-setup/server-config";
import { generatedSecret, loadSetupView } from "@/lib/platform-setup/view";
import { dbWithReason, loadSession, type CrmSession } from "@/lib/session";

// The platform setup wizard (/platform/setup). Every write goes through a
// 0320 RPC that checks platform-admin rights again, asks for a fresh 2FA check
// for keys and settings, and audits with the reason. A key's value goes to the
// database once and is never logged, returned, or sent back to the browser.

export type SetupResult<T = undefined> = ActionResult<T> & { stepUp?: boolean };

async function platformSession(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only Community Connect platform admins can do this.` };
  return { ok: true, session: state.session };
}

function cleanReason(raw: unknown, doing: string): { ok: true; reason: string } | { ok: false; error: string } {
  const r = String(raw ?? "").trim();
  if (!r) return { ok: false, error: `Could not ${doing} — say why. The reason is kept in the audit log.` };
  if (r.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  return { ok: true, reason: r };
}

function done(): void {
  revalidatePath("/platform/setup");
  revalidatePath("/platform");
}

/** Save one field: a key into the vault (fingerprint back) or a setting. */
export async function saveFieldAction(nameInput: string, valueInput: string, reasonInput: string): Promise<SetupResult> {
  const name = String(nameInput ?? "").trim();
  const field = FIELDS[name];
  const doing = field ? `save the ${field.label.toLowerCase()}` : "save that value";
  if (!field) return { ok: false, error: `Could not ${doing} — the wizard has no such field. Reload the page.` };
  const raw = String(valueInput ?? "");
  const problem = fieldProblem(name, raw);
  if (problem) return { ok: false, error: `Could not ${doing} — ${problem}` };
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  if (field.kind === "secret") {
    const { data, error } = await db.rpc("set_platform_secret", { p_name: name, p_value: raw.trim(), p_reason: reason.reason });
    if (error) return failure(`Could not ${doing}`, error);
    await loadPlatformConfig(true);
    done();
    const fp = data && typeof data === "object" && !Array.isArray(data) ? String((data as Record<string, unknown>).fingerprint ?? "") : "";
    const rotated = data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>).rotated === true;
    return { ok: true, message: `${rotated ? "Replaced" : "Saved"} ${field.label} (ends ${fp}) · in use within a minute · audit logged` };
  }
  const value = name === "portal_domain" || name === "wildcard_domain" ? normalizeDomain(raw, name === "wildcard_domain") : raw.trim();
  const { error } = await db.rpc("set_platform_setting", { p_key: name, p_value: value, p_reason: reason.reason });
  if (error) return failure(`Could not ${doing}`, error);
  await loadPlatformConfig(true);
  done();
  return { ok: true, message: `Saved ${field.label} · in use within a minute · audit logged` };
}

/** "Generate": the server makes a strong random value and stores it; nobody ever sees it. */
export async function generateFieldAction(nameInput: string, reasonInput: string): Promise<SetupResult> {
  const name = String(nameInput ?? "").trim();
  const field = FIELDS[name];
  const doing = field ? `generate the ${field.label.toLowerCase()}` : "generate that value";
  if (!field || !field.generate) return { ok: false, error: `Could not ${doing} — only signing secrets can be generated.` };
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  const { data, error } = await db.rpc("set_platform_secret", { p_name: name, p_value: generatedSecret(), p_reason: reason.reason });
  if (error) return failure(`Could not ${doing}`, error);
  await loadPlatformConfig(true);
  done();
  const fp = data && typeof data === "object" && !Array.isArray(data) ? String((data as Record<string, unknown>).fingerprint ?? "") : "";
  return { ok: true, message: `Generated a new ${field.label.toLowerCase()} (ends ${fp}) · audit logged. Links signed with the old one stop working.` };
}

/** Test: the background service calls the provider with the keys it will use. */
export async function testStepAction(step: string): Promise<SetupResult<{ jobId: number }>> {
  const doing = "start the test";
  if (!isStepKey(step) || !STEP_BY_KEY[step].workerTest) return { ok: false, error: `Could not ${doing} — this step has no background test.` };
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("enqueue_platform_test", { p_step: step });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  return { ok: true, message: "Test queued · the background service runs it within a few seconds", data: { jobId: Number(data) } };
}

/** Sign-in hooks: ask Supabase Auth to send the signed-in admin a sign-in code; the hook should carry it. */
export async function testSignInHookAction(): Promise<SetupResult<{ since: string }>> {
  const doing = "send a test sign-in code";
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const email = auth.session.email;
  if (!email) return { ok: false, error: `Could not ${doing} — your login has no email address.` };
  const env = readPublicEnv();
  if (!env.ok) return { ok: false, error: `Could not ${doing} — the portal is missing its Supabase settings.` };
  const since = new Date(Date.now() - 2000).toISOString();
  let res: Response;
  try {
    res = await fetch(`${env.env.supabaseUrl.replace(/\/+$/, "")}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: env.env.supabaseAnonKey, "content-type": "application/json" },
      body: JSON.stringify({ email, create_user: false }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error("[platform-setup] the sign-in service did not answer the test code request:", err);
    return { ok: false, error: `Could not ${doing} — the sign-in service did not answer. Try again.` };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { msg?: string; message?: string; error_description?: string };
    const why = body.msg ?? body.message ?? body.error_description ?? `HTTP ${res.status}`;
    console.error(`[platform-setup] the sign-in service refused the test code: ${res.status} ${why}`);
    return {
      ok: false,
      error: res.status === 429
        ? `Could not ${doing} — the sign-in service allows one code a minute per address. Wait a minute and try again.`
        : `Could not ${doing} — the sign-in service said: ${why}. If the hook is on, this is what people signing in see too.`,
    };
  }
  done();
  return { ok: true, message: `A sign-in code was sent to ${email}. The page shows below whether it went through the hook.`, data: { since } };
}

/** Mark done — only when the live check passes right now (checked again here, not trusted from the page). */
export async function completeStepAction(step: string): Promise<SetupResult> {
  const doing = "mark the step done";
  if (!isStepKey(step)) return { ok: false, error: `Could not ${doing} — unknown step.` };
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const loaded = await loadSetupView(auth.session);
  if (!loaded.ok) return { ok: false, error: `Could not ${doing} — the setup could not be read (${loaded.error}).` };
  const s = loaded.view.steps.find((x) => x.key === step)!;
  if (!s.canComplete) return { ok: false, error: `Not done yet — ${s.live.summary}` };
  const { error } = await auth.session.db.rpc("complete_platform_setup_step", { p_key: step, p_note: `Checked: ${s.live.summary}`.slice(0, 1000) });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  return { ok: true, message: `${s.title} is done · audit logged` };
}

export async function parkStepAction(step: string, reasonInput: string): Promise<SetupResult> {
  const doing = "park the step";
  if (!isStepKey(step)) return { ok: false, error: `Could not ${doing} — unknown step.` };
  if (STEP_BY_KEY[step].required) return { ok: false, error: `Could not ${doing} — ${STEP_BY_KEY[step].title} is required and cannot be parked.` };
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  const { error } = await db.rpc("park_platform_setup_step", { p_key: step, p_reason: reason.reason });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  return { ok: true, message: `${STEP_BY_KEY[step].title} parked · it stays on the Platform home as a reminder` };
}

export async function reopenStepAction(step: string, reasonInput: string): Promise<SetupResult> {
  const doing = "reopen the step";
  if (!isStepKey(step)) return { ok: false, error: `Could not ${doing} — unknown step.` };
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  const { error } = await db.rpc("reopen_platform_setup_step", { p_key: step, p_reason: reason.reason });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  return { ok: true, message: `${STEP_BY_KEY[step].title} reopened · audit logged` };
}

/** "Continue to the portal": no more redirects to the wizard until the next sign-in. */
export async function setupLaterAction(): Promise<SetupResult> {
  const jar = await cookies();
  // A browser-session cookie (no expiry): a preference, not a credential.
  jar.set(SETUP_LATER_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/" });
  return { ok: true };
}
