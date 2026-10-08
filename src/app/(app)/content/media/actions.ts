"use server";

// Content › Media library uploads. Files (up to the content bucket's 50 MB) never pass through a
// Server Action (next.config.ts caps those at 11 MB): this asks Storage, as the signed-in editor,
// for a one-time signed upload address — Storage checks the editor's write permission
// (app.can_write_object: content.manage, the content module on) before it hands one out — and the
// browser then sends the file straight to Storage. The item is saved afterwards with the path
// (saveContentItemAction).

import { checkMediaFile, isMediaKind, mediaFileRole, mediaObjectPath } from "@/lib/content";
import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction } from "@/lib/session";

export type MediaUploadTicket = { path: string; signedUrl: string; contentType: string };

const BUCKET = "content";

export async function prepareMediaUploadAction(input: { kind: string; fileName: string; type: string; size: number }): Promise<ActionResult<MediaUploadTicket>> {
  const doing = "start the upload";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const kind = String(input?.kind ?? "");
  if (!isMediaKind(kind)) return { ok: false, error: `Could not ${doing} — the form did not say what the file is for. Reload and try again.` };
  const fileName = String(input?.fileName ?? "").slice(0, 300);
  const check = checkMediaFile(mediaFileRole(kind), { name: fileName, type: String(input?.type ?? ""), size: Number(input?.size) });
  if (!check.ok) return { ok: false, error: `Could not ${doing} — ${check.error}` };

  const { db, center } = auth.session;
  const path = mediaObjectPath(center.id, kind, crypto.randomUUID(), fileName, check.contentType);
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    const message = error?.message ?? "";
    console.error(`[content/media] could not sign an upload to ${BUCKET}/${path}:`, error);
    if (/bucket not found/i.test(message)) {
      return { ok: false, error: `Could not ${doing} — the content storage area is not set up on this server yet. Ask Weaver to create it.` };
    }
    if (/row-level security|unauthorized|permission/i.test(message)) {
      return {
        ok: false,
        error: `Could not ${doing} — storage refused it: uploading needs content.manage, and the Content module must be switched on. Paste a YouTube or web link instead, or ask a content manager.`,
      };
    }
    return failure(`Could not ${doing}`, error ?? "storage did not answer");
  }
  return { ok: true, data: { path: data.path, signedUrl: data.signedUrl, contentType: check.contentType } };
}
