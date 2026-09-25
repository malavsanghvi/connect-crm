"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { PLATFORM_DOC_KINDS } from "@/lib/legal-platform";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession } from "@/lib/session";

// Platform › Agreements (#19, owner decision 2026-09-25): Community Connect's agreements with
// organizations are drafts that a platform admin edits and publishes as a new version. A
// published version never changes (0422), and a new one asks every owner to accept again.

function refresh() {
  revalidatePath("/platform/agreements");
  revalidatePath("/settings/agreements");
}

export async function savePlatformDraftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: "Could not save the draft — your session has expired. Sign in again." };
  if (!state.session.isPlatformAdmin) return { ok: false, error: "Could not save the draft — only the Community Connect team edits platform agreements." };
  const id = String(fd.get("id") ?? "");
  const kind = String(fd.get("kind") ?? "");
  const title = String(fd.get("title") ?? "").trim();
  const version = String(fd.get("version") ?? "").trim();
  const body = String(fd.get("body_md") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!isUuid(id) && !(PLATFORM_DOC_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Could not save the draft — choose the agreement." };
  if (!title || !version || !body.trim()) return { ok: false, error: "Could not save the draft — the title, version and text are all needed." };
  if (!reason) return { ok: false, error: "Could not save the draft — give a reason (for example, counsel's revision). It goes in the audit log." };
  const db = await dbWithReason(state.session, reason);
  const { error } = await db.rpc("save_platform_document", {
    p_document: isUuid(id) ? id : (null as unknown as string),
    p_kind: isUuid(id) ? (null as unknown as string) : kind,
    p_title: title,
    p_body_md: body,
    p_version: version,
    p_reason: reason,
  });
  if (error) return failure("Could not save the draft", error);
  refresh();
  return { ok: true, message: `Draft ${title} (${version}) saved · not published yet — organizations do not see it.` };
}

export async function publishPlatformDraftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: "Could not publish — your session has expired. Sign in again." };
  if (!state.session.isPlatformAdmin) return { ok: false, error: "Could not publish — only the Community Connect team publishes platform agreements." };
  const id = String(fd.get("id") ?? "");
  const title = String(fd.get("title") ?? "the agreement");
  if (!isUuid(id)) return { ok: false, error: "Could not publish — the draft was not found." };
  const db = await dbWithReason(state.session, `Published ${title}`);
  const { error } = await db.rpc("publish_platform_document", { p_document: id });
  if (error) return failure(`Could not publish ${title}`, error);
  refresh();
  return { ok: true, message: `${title} published · every organization's owner is asked to accept this version (earlier acceptances keep their version).` };
}
