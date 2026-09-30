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

// B14: give Niva web pages to learn from (app.niva_import_pages, migration 0540). One job per
// page; the background service reads each page and saves its sections as DRAFT sources, which
// an administrator still approves before Niva may use them.
export async function importNivaPagesAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "import those web pages";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  // Addresses never contain spaces, so any whitespace or comma separates them.
  const urls = String(fd.get("urls") ?? "").split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return { ok: false, error: `Could not ${doing} — paste at least one web page address, one per line.` };
  const { data, error } = await auth.session.db.rpc("niva_import_pages", { p_center: auth.session.center.id, p_urls: urls });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/niva");
  const n = typeof data === "number" ? data : urls.length;
  return {
    ok: true,
    message: `${n} page${n === 1 ? "" : "s"} queued. They are read a few seconds apart; reload this page in a minute. The new sections appear under Sources as "Not included yet", and any page that could not be read is listed under Recent imports with the reason.`,
  };
}
