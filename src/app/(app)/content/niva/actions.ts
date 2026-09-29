"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { loadSession } from "@/lib/session";

// B14: re-run Niva's answering job (app.niva_regenerate, migration 0530) for
// a past question, after a source has been edited or newly approved. The
// existing answer stays visible to the member until the worker finishes.

async function signedIn(doing: string) {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false as const, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false as const, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  return { ok: true as const, session: state.session };
}

export async function regenerateNivaAnswerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "regenerate Niva's answer";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  const id = String(fd.get("conversation_id") ?? "").trim();
  if (!id) return { ok: false, error: `Could not ${doing} — no question was given.` };
  const { error } = await auth.session.db.rpc("niva_regenerate", { p_id: id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/niva");
  return { ok: true, message: "Regenerating — Niva's new answer will replace this one shortly." };
}
