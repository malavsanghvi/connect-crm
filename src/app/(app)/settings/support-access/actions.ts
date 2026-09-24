"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession } from "@/lib/session";

// Settings › Support access: the owner gives a Community Connect team member
// time-boxed access (app.grant_support_access: owner, fresh 2FA, reason) and can end it.

export async function grantSupportAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "grant support access";
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  const grantee = String(fd.get("grantee") ?? "");
  const hours = Number(fd.get("hours"));
  const reason = String(fd.get("reason") ?? "").trim();
  if (!isUuid(grantee)) return { ok: false, error: `Could not ${doing} — choose who at Community Connect.` };
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) return { ok: false, error: `Could not ${doing} — choose how long.` };
  if (!reason) return { ok: false, error: `Could not ${doing} — say what the support is for (it goes in the audit log).` };
  const db = await dbWithReason(state.session, reason);
  const { error } = await db.rpc("grant_support_access", { p_center: state.session.center.id, p_grantee: grantee, p_hours: hours, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/settings/support-access");
  return { ok: true, message: "Support access granted · it ends on its own · audit logged" };
}

export async function revokeSupportAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "end support access";
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  const id = String(fd.get("grant") ?? "");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  const { error } = await state.session.db.rpc("revoke_support_access", { p_grant: id, p_reason: "Ended by the owner" });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/settings/support-access");
  return { ok: true, message: "Support access ended · audit logged" };
}
