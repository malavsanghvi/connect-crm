"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/demo-signin/rules";
import { dbWithReason, loadSession, type CrmSession } from "@/lib/session";

// Platform › Setup › Demo sign-in. Every write is a database function that checks again that the caller is a platform admin, asks for a
// fresh 2FA check and writes the reason to the audit log. Nothing here sees a password: the database makes them and keeps them in the vault.

export type DemoSigninResult<T = undefined> = ActionResult<T> & { stepUp?: boolean };

async function platformSession(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only Weaver platform admins can do this.` };
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
}

function field(data: unknown, key: string): unknown {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>)[key] : undefined;
}

/** The kill switch. Off: no new demo can start and every running one ends at once. */
export async function setDemoSigninAction(enabled: boolean, reasonInput: string): Promise<DemoSigninResult> {
  const doing = enabled ? "turn the demo on" : "turn the demo off";
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  const { data, error } = await db.rpc("set_demo_signin", { p_enabled: enabled, p_reason: reason.reason });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  const ended = Number(field(data, "ended") ?? 0);
  return { ok: true, message: enabled ? "The demo is on · audit logged" : `The demo is off · ${ended} running demo${ended === 1 ? "" : "s"} ended · audit logged` };
}

/** Make the demo sign-ins (once), or replace their passwords. */
export async function setupDemoSigninAction(reasonInput: string, rotate: boolean): Promise<DemoSigninResult> {
  const doing = rotate ? "replace the demo passwords" : "set up the demo sign-ins";
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  const { data, error } = await db.rpc("demo_signin_setup", { p_reason: reason.reason, p_rotate: rotate });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  const created = Number(field(data, "created") ?? 0);
  const rotated = Number(field(data, "rotated") ?? 0);
  const base = rotate ? `Replaced ${rotated} password${rotated === 1 ? "" : "s"} · running demos ended` : `Set up ${created} demo sign-in${created === 1 ? "" : "s"}`;
  // A partial result is said out loud: the addresses that were left alone, and why.
  const refused = field(data, "refused");
  if (Array.isArray(refused) && refused.length > 0) {
    const names = refused.map((r) => String((r as { email?: unknown }).email ?? "")).filter(Boolean).join(", ");
    return {
      ok: true,
      message: `${base}. NOT set up: ${names} — already belong${refused.length === 1 ? "s" : ""} to someone else. Remove that account in Supabase Auth, then run this again.`,
    };
  }
  return { ok: true, message: `${base} · audit logged` };
}

/** Create one of the two demo communities (platform admin; the database asks for the fresh 2FA check). */
export async function createDemoCommunityAction(kind: string, reasonInput: string): Promise<DemoSigninResult> {
  const doing = "create the demo community";
  if (kind !== "faith" && kind !== "neutral") return { ok: false, error: `Could not ${doing} — choose faith-based or not faith-based.` };
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  const { data, error } = await db.rpc("create_demo_community", { p_kind: kind });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  const note = field(data, "note");
  return { ok: true, message: typeof note === "string" && note ? note : "Demo community created · audit logged" };
}

/** Start one demo community over now (the nightly job does the same when it has been used). */
export async function resetDemoCommunityAction(centerId: string, reasonInput: string): Promise<DemoSigninResult> {
  const doing = "start the demo community over";
  if (!isUuid(centerId)) return { ok: false, error: `Could not ${doing} — that community was not found. Reload the page.` };
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  const { error } = await db.rpc("reset_demo_community", { p_center: centerId });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  return { ok: true, message: "Demo community started over · audit logged" };
}
