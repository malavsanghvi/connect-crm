"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isAttestationKey } from "@/lib/platform-onboarding";
import { slugProblem } from "@/lib/platform-onboarding";
import { dbWithReason, loadSession } from "@/lib/session";

// Setup › Go-live (ONBOARDING_PLAN Steps 7–8, §5): the owner confirms training,
// the health check and the pilot (readiness check 13), requests go-live, and —
// once two Community Connect admins approve — promotes the sandbox.

async function ownerSession(doing: string) {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false as const, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false as const, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  return { ok: true as const, session: state.session };
}

export async function attestAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "record the confirmation";
  const auth = await ownerSession(doing);
  if (!auth.ok) return auth;
  const key = fd.get("key");
  if (!isAttestationKey(key)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 1000) return { ok: false, error: `Could not ${doing} — keep the note under 1,000 characters.` };
  const db = note ? await dbWithReason(auth.session, note) : auth.session.db;
  const { error } = await db.rpc("attest_center", { p_center: auth.session.center.id, p_key: key, p_note: note || undefined });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/setup/go-live");
  revalidatePath("/setup/readiness");
  revalidatePath("/setup");
  return { ok: true, message: "Confirmed · recorded with your name · audit logged" };
}

export async function requestGoliveAction(): Promise<ActionResult> {
  const doing = "request go-live";
  const auth = await ownerSession(doing);
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("request_golive", { p_center: auth.session.center.id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/setup/go-live");
  revalidatePath("/setup");
  return { ok: true, message: "Go-live requested · Community Connect will review (two different people approve)" };
}

export async function promoteAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "promote the sandbox";
  const auth = await ownerSession(doing);
  if (!auth.ok) return auth;
  const slug = String(fd.get("slug") ?? "").trim().toLowerCase();
  const reason = String(fd.get("reason") ?? "").trim();
  // A sandbox that holds the organization's own records (0500, promotion.in_place) goes live
  // under its own web name; the database keeps that name whatever is sent.
  const inPlace = await auth.session.db.rpc("promotes_in_place", { p_center: auth.session.center.id });
  if (inPlace.error) return failure(`Could not ${doing}`, inPlace.error);
  const problem = inPlace.data === true ? null : slugProblem(slug);
  if (problem) return { ok: false, error: `Could not ${doing} — ${problem}` };
  if (!reason) return { ok: false, error: `Could not ${doing} — give a reason (it goes in the audit log).` };
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("promote_sandbox", { p_sandbox: auth.session.center.id, p_slug: inPlace.data === true ? "" : slug, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/setup/go-live");
  return {
    ok: true,
    message: inPlace.data === true ? "Going live started · the background service switches this organization to production, keeping every record" : `Promotion to ${slug} started · the background service copies the configuration`,
  };
}
