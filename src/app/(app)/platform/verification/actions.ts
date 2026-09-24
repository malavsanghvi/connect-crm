"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession } from "@/lib/session";

/**
 * Platform › Verification: verify an organization as a non-profit, or send it
 * back with a note (app.decide_org_verification — platform admins only, not
 * the person who submitted it; audited with the note as the reason).
 */
export async function decideVerificationAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const verified = fd.get("decision") === "verify";
  const doing = verified ? "verify the organization" : "send the organization back";
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only Community Connect platform admins verify organizations.` };
  const center = String(fd.get("center") ?? "");
  if (!isUuid(center)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  const note = String(fd.get("note") ?? "").trim();
  if (!verified && !note) return { ok: false, error: "Could not send it back — say what is missing or wrong, so the organization knows what to fix." };
  if (note.length > 1000) return { ok: false, error: `Could not ${doing} — keep the note under 1,000 characters.` };
  const db = note ? await dbWithReason(state.session, note) : state.session.db;
  const { error } = await db.rpc("decide_org_verification", { p_center: center, p_verified: verified, p_note: note || undefined });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/platform/verification");
  return { ok: true, message: verified ? "Verified non-profit · audit logged" : "Sent back with your note · audit logged" };
}
