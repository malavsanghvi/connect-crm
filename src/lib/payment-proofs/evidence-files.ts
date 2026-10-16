// Evidence on a recorded payment (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 3.3, migration 0874): the files a family sent
// with its proof and the photos and receipts staff attach themselves. Pure: no React, no database, so the rules a person is told
// before an upload starts are the same ones the tests check. The database decides again (attach_payment_evidence).

import { formatDate } from "@/lib/dates";
import { fileKind, fileSize } from "@/lib/pledge-evidence";

/** The same types and limit as every proof file (bucket payment-evidence, 0865). */
export const EVIDENCE_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"] as const;
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
/** Live files staff may attach to one payment. */
export const STAFF_FILES_PER_PAYMENT = 5;

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};
const EXTENSION_OF: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

export type FileCheck = { ok: true; contentType: string } | { ok: false; error: string };

/**
 * Whether a file can be attached, in words. Phones and some browsers leave the type empty for HEIC photos, so the ending of the name
 * is used then. `liveStaffFiles` is how many staff files the payment already has.
 */
export function checkEvidenceFile(file: { name: string; type: string; size: number }, liveStaffFiles = 0): FileCheck {
  if (liveStaffFiles >= STAFF_FILES_PER_PAYMENT) {
    return { ok: false, error: `A payment can have up to ${STAFF_FILES_PER_PAYMENT} files attached by staff. Remove one first.` };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > EVIDENCE_MAX_BYTES) return { ok: false, error: `The file is ${fileSize(file.size)}. A file can be at most 10 MB.` };
  const declared = file.type.trim().toLowerCase();
  const contentType = (EVIDENCE_FILE_TYPES as readonly string[]).includes(declared) ? declared : declared === "" ? (BY_EXTENSION[extensionOf(file.name)] ?? "") : "";
  if (!contentType) return { ok: false, error: "Attach a photo (JPEG, PNG, WebP or HEIC) or a PDF." };
  return { ok: true, contentType };
}

/** A file name made safe for a storage path and still readable: letters, digits, dashes, at most 40 characters. */
export function safeBaseName(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40)
    .replace(/-+$/, "");
  return cleaned || "file";
}

/** <center>/staff/<payment>/<uuid>-<readable name>.<ext>: the only place staff may write (the bucket rule, 0865; the database checks it again). */
export function evidenceObjectPath(centerId: string, paymentId: string, id: string, fileName: string, contentType: string): string {
  return `${centerId}/staff/${paymentId}/${id}-${safeBaseName(fileName)}.${EXTENSION_OF[contentType] ?? "bin"}`;
}

/** The name a person gave the file, back from its path ("check-front.jpg"); null for the family's files (named by a uuid only). */
export function evidenceDisplayName(path: string): string | null {
  const last = path.split("/").pop() ?? "";
  const m = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/.exec(last);
  return m ? m[1]! : null;
}

/** One file of a payment as the browser gets it. The link is made when the section is opened and lasts 10 minutes. */
export type PaymentEvidenceFile = {
  id: string;
  /** The family sent it with a proof, or staff attached it. */
  source: "family" | "staff";
  name: string | null;
  contentType: string | null;
  bytes: number | null;
  addedOn: string;
  removed: boolean;
  removedOn: string | null;
  removedReason: string | null;
  url: string | null;
};

type Row = {
  id: string;
  proof_id: string | null;
  storage_path: string;
  content_type: string | null;
  bytes: number | null;
  created_at: string;
  deleted_at: string | null;
  deleted_reason: string | null;
};

/** The payment_proof_files rows of one payment (read with the person's own access) as the list the section shows, oldest first. */
export function evidenceFilesFrom(rows: readonly Row[], urls: ReadonlyMap<string, string>): PaymentEvidenceFile[] {
  return [...rows]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      source: r.proof_id ? "family" : "staff",
      name: evidenceDisplayName(r.storage_path),
      contentType: r.content_type,
      bytes: r.bytes,
      addedOn: r.created_at,
      removed: r.deleted_at !== null,
      removedOn: r.deleted_at,
      removedReason: r.deleted_reason,
      url: r.deleted_at ? null : (urls.get(r.storage_path) ?? null),
    }));
}

/** "Check-front.jpg · Photo · 1.4 MB · attached by staff Oct 14", or the tombstone of a removed file. */
export function evidenceFileLine(f: PaymentEvidenceFile, timeZone: string): string {
  const who = f.source === "staff" ? "attached by staff" : "sent by the family";
  if (f.removed) {
    const when = f.removedOn ? ` ${formatDate(f.removedOn, timeZone)}` : "";
    return `${fileKind(f.contentType)} ${who}, removed${when}${f.removedReason ? `: ${f.removedReason}` : ""}`;
  }
  const parts = [f.name, fileKind(f.contentType), fileSize(f.bytes), `${who} ${formatDate(f.addedOn, timeZone)}`].filter((p): p is string => Boolean(p));
  return parts.join(" · ");
}

/** How many of the files are staff files that still exist (the count the 5-file rule uses). */
export function liveStaffFiles(files: readonly PaymentEvidenceFile[]): number {
  return files.filter((f) => f.source === "staff" && !f.removed).length;
}
