"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { dbWithReason, loadSession } from "@/lib/session";

// Go-live approvals behind readiness checks 8 and 12 (migration 0300). The database
// decides who may approve (the treasurer; an administrator for Niva) and records
// who, when and a fingerprint of what was approved.

async function signedIn(doing: string) {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false as const, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false as const, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  return { ok: true as const, session: state.session };
}

function readNote(fd: FormData): { ok: true; note: string } | { ok: false; error: string } {
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 1000) return { ok: false, error: "keep the note under 1,000 characters." };
  return { ok: true, note };
}

function revalidate(extra: string) {
  revalidatePath(extra);
  revalidatePath("/setup");
  revalidatePath("/setup/readiness");
  revalidatePath("/setup/go-live");
}

export async function approveStatementTemplatesAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "approve the receipt and statement templates";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const n = readNote(fd);
  if (!n.ok) return { ok: false, error: `Could not ${doing} — ${n.error}` };
  const db = n.note ? await dbWithReason(auth.session, n.note) : auth.session.db;
  const { error } = await db.rpc("approve_statement_templates", { p_center: auth.session.center.id, p_note: n.note || undefined });
  if (error) return failure(`Could not ${doing}`, error);
  revalidate("/giving/statements");
  return { ok: true, message: "Templates approved · recorded with your name · readiness check 8 updated" };
}

export async function approveNivaContentAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "approve Niva's content";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const n = readNote(fd);
  if (!n.ok) return { ok: false, error: `Could not ${doing} — ${n.error}` };
  const db = n.note ? await dbWithReason(auth.session, n.note) : auth.session.db;
  const { error } = await db.rpc("approve_niva_content", { p_center: auth.session.center.id, p_note: n.note || undefined });
  if (error) return failure(`Could not ${doing}`, error);
  revalidate("/content/niva");
  return { ok: true, message: "Niva's sources approved · recorded with your name · readiness check 12 updated" };
}
