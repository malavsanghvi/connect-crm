"use server";

import { failure, type ActionResult } from "@/lib/errors";
import { logProofViews } from "@/lib/data/payment-proofs";
import { EVIDENCE_BUCKET, EVIDENCE_LINK_SECONDS, parseEvidence, type EvidenceFile, type EvidenceItem } from "@/lib/pledge-evidence";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, type CrmSession } from "@/lib/session";

// READ ONLY. The evidence of one pledge (app.pledge_evidence, 0866) and a short-lived link to open one file. The database decides who
// may read (the household's adults, and staff who verify or view giving); this only asks. Nothing is written, copied or moved.

/** An item as the browser gets it: the same, but a file carries no storage path (a file is opened through openEvidenceFileAction). */
export type EvidenceItemView = Omit<EvidenceItem, "files"> & { files: Omit<EvidenceFile, "storagePath">[] };

const NO_ACCESS = "You don't have access to this area.";

async function readEvidence(db: CrmSession["db"], pledgeId: string, doing: string) {
  const r = await db.rpc("pledge_evidence", { p_pledge: pledgeId });
  if (r.error) {
    // The database says "You don't have access to this area" itself (42501); say it the same way, not as a failed change.
    if (r.error.code === "42501") return { ok: false as const, error: NO_ACCESS };
    return failure(`Could not ${doing}`, r.error);
  }
  const items = parseEvidence(r.data);
  if (!items) {
    console.error("[household] pledge_evidence returned an unexpected shape:", r.data);
    return { ok: false as const, error: `Could not ${doing} — the database answered in a shape this screen does not understand (has the latest migration been applied?).` };
  }
  return { ok: true as const, items };
}

export async function loadPledgeEvidenceAction(pledgeId: string): Promise<ActionResult<EvidenceItemView[]>> {
  const doing = "load the evidence";
  const auth = await authorizeAction("pledges", doing);
  if (!auth.ok) return auth;
  if (!isUuid(pledgeId)) return { ok: false, error: `Could not ${doing} — the pledge was not found.` };
  const res = await readEvidence(auth.session.db, pledgeId, doing);
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.items.map((i) => ({
      ...i,
      files: i.files.map((f) => ({ id: f.id, contentType: f.contentType, bytes: f.bytes, removed: f.removed, removedOn: f.removedOn, removedReason: f.removedReason })),
    })),
  };
}

/**
 * A link to open one file for 10 minutes. The file must be in this pledge's own evidence (the database is asked again, so a
 * pledge id and a file id from different places never open anything), and a removed file has only its tombstone.
 * A staff view is written to the audit log (log_proof_view, 0872); a failure to log is reported on the server and never hides the file.
 */
export async function openEvidenceFileAction(pledgeId: string, fileId: string): Promise<ActionResult<{ url: string; expiresInSeconds: number }>> {
  const doing = "open the file";
  const auth = await authorizeAction("pledges", doing);
  if (!auth.ok) return auth;
  if (!isUuid(pledgeId) || !isUuid(fileId)) return { ok: false, error: `Could not ${doing} — the file was not found.` };
  const { db } = auth.session;
  const res = await readEvidence(db, pledgeId, doing);
  if (!res.ok) return res;
  const file = res.items.flatMap((i) => i.files).find((f) => f.id === fileId);
  if (!file) return { ok: false, error: `Could not ${doing} — it is not part of this pledge's evidence any more. Reload the page.` };
  if (file.removed || !file.storagePath) return { ok: false, error: `Could not ${doing} — the file was removed${file.removedReason ? ` (${file.removedReason})` : ""}. Only the record that it existed is kept.` };
  const signed = await db.storage.from(EVIDENCE_BUCKET).createSignedUrl(file.storagePath, EVIDENCE_LINK_SECONDS);
  if (signed.error || !signed.data?.signedUrl) return failure(`Could not ${doing}`, signed.error ?? "the storage service gave no link");
  await logProofViews(db, [file.id]);
  return { ok: true, data: { url: signed.data.signedUrl, expiresInSeconds: EVIDENCE_LINK_SECONDS } };
}
