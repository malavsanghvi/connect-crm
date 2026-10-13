"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { decisionFromForm, decisionMessage } from "@/lib/matching/decision";
import { programFromForm } from "@/lib/matching/directory";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession, type CrmSession } from "@/lib/session";

// Platform › Gift matching directory: Weaver's team keeps the shared employer-program directory (0765) and decides the
// submissions of every community (0766). The database checks that the caller is on Weaver's team again; Weaver's team never
// sees who in a community sent or decided a submission, only the community's name.

async function weaverSession(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only Weaver's team keeps the gift matching directory.` };
  return { ok: true, session: state.session };
}

function revalidateDirectory(id?: string) {
  revalidatePath("/platform/matching");
  if (id) revalidatePath(`/platform/matching/${id}`);
  revalidatePath("/giving/matching");
}

/** Adds an entry (no id) or saves a change to one, with the reason (app.save_match_program). A new entry opens its page. */
export async function saveProgramAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("program_id") ?? "");
  if (id && !isUuid(id)) return { ok: false, error: "Could not save the entry — it was not found. Reload the page and try again." };
  const parsed = programFromForm(fd, "weaver");
  if (!parsed.ok) return { ok: false, error: `Could not save the entry — ${parsed.error[0].toLowerCase()}${parsed.error.slice(1)}` };
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  if (!reason) return { ok: false, error: "Could not save the entry — say what changed and why. It goes in the directory's history." };
  const auth = await weaverSession("save the entry");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("save_match_program", { p_id: id || (null as unknown as string), p_program: parsed.facts as unknown as Json, p_reason: reason });
  if (error) return failure("Could not save the directory entry", error);
  const saved = typeof data === "string" ? data : id;
  revalidateDirectory(saved);
  if (!id && saved) redirect(`/platform/matching/${saved}`);
  return { ok: true, message: "Saved. Every community that uses gift matching sees it now." };
}

/** Retires an entry (the program ended) or brings it back (app.set_match_program_retired). */
export async function retireProgramAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("program_id") ?? "");
  const retire = fd.get("retire") === "true";
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  const doing = retire ? "mark the program as ended" : "bring the entry back";
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — the entry was not found. Reload the page and try again.` };
  if (!reason) return { ok: false, error: `Could not ${doing} — say why. It goes in the directory's history.` };
  const auth = await weaverSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_match_program_retired", { p_id: id, p_retired: retire, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  revalidateDirectory(id);
  return { ok: true, message: retire ? "Marked as ended. It can no longer be chosen for an employer on file." : "Brought back. It is active again." };
}

/** Merges a duplicate into this entry (app.merge_match_programs). */
export async function mergeProgramsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const keep = String(fd.get("program_id") ?? "");
  const drop = String(fd.get("duplicate_id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  if (!isUuid(keep) || !isUuid(drop)) return { ok: false, error: "Could not merge — choose the duplicate to merge into this entry." };
  if (!reason) return { ok: false, error: "Could not merge — say why. It goes in the directory's history." };
  const auth = await weaverSession("merge the entries");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("merge_match_programs", { p_keep: keep, p_drop: drop, p_reason: reason });
  if (error) return failure("Could not merge the entries", error);
  revalidateDirectory(keep);
  revalidatePath(`/platform/matching/${drop}`);
  return { ok: true, message: "Merged. The duplicate's names are this entry's now, and links to it follow here." };
}

/** Weaver's team approves, rejects or marks a duplicate, for any community's submission (app.decide_match_submission). */
export async function decidePlatformSubmissionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = decisionFromForm(fd);
  if (!parsed.ok) return { ok: false, error: `Could not decide — ${parsed.error}` };
  const auth = await weaverSession("decide");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, parsed.args.p_reason ?? "Decided a gift matching submission");
  const { data, error } = await db.rpc("decide_match_submission", { ...parsed.args, p_program: parsed.args.p_program as unknown as Json | undefined });
  if (error) return failure("Could not decide on the submission", error);
  revalidateDirectory();
  const status = (data as { status?: unknown } | null)?.status;
  return { ok: true, message: decisionMessage(typeof status === "string" ? status : "", "weaver") };
}
