// Evidence on a pledge (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md sections 3.3 and 4.5). Pure: no database, no React.
//
// app.pledge_evidence(pledge) (0866) answers, for a pledge in ANY status, every proof and file connected to it: the share of the proof
// that covered this pledge, the state (waiting, approved, merged, not accepted), the payment and receipt, the kept-until date, and,
// once removed, the tombstone (when, why). This file reads that answer and puts it in plain words. Evidence is linked, never copied.

import { formatDate } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";

export type EvidenceFile = {
  id: string;
  /** Where the bytes are (bucket payment-evidence). Never sent to the browser: a file is opened through a short-lived signed link. */
  storagePath: string;
  contentType: string | null;
  bytes: number | null;
  /** The bytes were purged (retention): only the tombstone is left. */
  removed: boolean;
  removedOn: string | null;
  removedReason: string | null;
};

export type EvidenceItem = {
  kind: "proof" | "payment";
  proofId: string | null;
  paymentId: string | null;
  /** waiting, needs_info, rejected, withdrawn (proofs); paid, reconciled (payments). */
  state: string;
  coveredCents: number;
  method: string | null;
  paidOn: string | null;
  reference: string | null;
  receiptNumber: string | null;
  reason: string | null;
  sentOn: string | null;
  /** The day the file may first be purged; null when a legal hold keeps it. */
  keptUntil: string | null;
  files: EvidenceFile[];
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
}

/** Read what pledge_evidence returned. null when it is not the shape this screen knows (the caller says so; it never shows "no evidence"). */
export function parseEvidence(data: unknown): EvidenceItem[] | null {
  if (!Array.isArray(data)) return null;
  const items: EvidenceItem[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const kind = o.kind === "proof" || o.kind === "payment" ? o.kind : null;
    if (!kind) return null;
    const files: EvidenceFile[] = [];
    if (o.files !== undefined && o.files !== null) {
      if (!Array.isArray(o.files)) return null;
      for (const f of o.files) {
        if (!f || typeof f !== "object") return null;
        const fo = f as Record<string, unknown>;
        const id = str(fo.id);
        if (!id) return null;
        files.push({
          id,
          storagePath: str(fo.storage_path) ?? "",
          contentType: str(fo.content_type),
          bytes: typeof fo.bytes === "number" ? fo.bytes : null,
          removed: fo.removed === true,
          removedOn: str(fo.removed_on),
          removedReason: str(fo.removed_reason),
        });
      }
    }
    items.push({
      kind,
      proofId: str(o.proof_id),
      paymentId: str(o.payment_id),
      state: str(o.state) ?? "waiting",
      coveredCents: num(o.covered_cents),
      method: str(o.method),
      paidOn: str(o.paid_on),
      reference: str(o.reference),
      receiptNumber: str(o.receipt_number),
      reason: str(o.reason),
      sentOn: str(o.sent_on),
      keptUntil: str(o.kept_until),
      files,
    });
  }
  return items;
}

type Tone = "ok" | "warn" | "bad" | "info" | "muted";

/** The state of one piece of evidence, in the words the household page uses. */
export function evidenceState(item: Pick<EvidenceItem, "kind" | "state">): { label: string; tone: Tone } {
  switch (item.state) {
    case "waiting":
      return { label: "Waiting", tone: "info" };
    case "needs_info":
      return { label: "Question asked", tone: "warn" };
    case "approved":
      return { label: "Approved", tone: "ok" };
    case "merged":
      return { label: "Kept with the payment", tone: "ok" };
    case "rejected":
      return { label: "Not accepted", tone: "bad" };
    case "withdrawn":
      return { label: "Withdrawn", tone: "muted" };
    case "reconciled":
      return { label: "Evidence on a bank reconciled payment", tone: "ok" };
    case "paid":
      return { label: "Evidence on a payment", tone: "ok" };
    default:
      return { label: item.kind === "proof" ? "Confirmation" : "Payment", tone: "muted" };
  }
}

function methodWord(method: string | null): string {
  if (!method) return "";
  return PAYMENT_METHOD_LABEL[method] ?? method.replace(/_/g, " ");
}

/** "Proof for $250.00, check 1048" or "Receipt R-2026-0211, cash". */
export function evidenceTitle(item: EvidenceItem, currency: string, locale?: string): string {
  const money = formatCents(item.coveredCents, currency, locale);
  const how = methodWord(item.method).toLowerCase();
  if (item.kind === "payment") {
    return `${item.receiptNumber ? `Receipt ${item.receiptNumber}` : "Payment"}${how ? `, ${how}` : ""} · ${money} on this pledge`;
  }
  return `Payment confirmation for ${money}${how ? `, ${how}` : ""}${item.reference ? ` ${item.reference}` : ""}`;
}

/** "Sent Oct 12 · paid Oct 10" (or the payment date). */
export function evidenceWhen(item: EvidenceItem, timeZone: string): string {
  const parts: string[] = [];
  if (item.sentOn) parts.push(`Sent ${formatDate(item.sentOn, timeZone)}`);
  if (item.paidOn) parts.push(`${item.kind === "payment" ? "Paid" : "Dated"} ${formatDate(item.paidOn, timeZone)}`);
  return parts.join(" · ");
}

/** "Kept until Dec 31, 2033" or the legal-hold sentence. */
export function keptUntilText(item: Pick<EvidenceItem, "keptUntil">, timeZone: string): string {
  return item.keptUntil ? `Kept until ${formatDate(item.keptUntil, timeZone)}` : "Kept: a legal hold stops all removal";
}

/** The size of a file in plain words ("1.2 MB"). */
export function fileSize(bytes: number | null): string {
  if (bytes === null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What kind of file it is, from its content type. */
export function fileKind(contentType: string | null): string {
  if (!contentType) return "File";
  if (contentType === "application/pdf") return "PDF";
  if (contentType.startsWith("image/")) return "Photo";
  return "File";
}

/** One file's line: "Photo · 1.2 MB", or its tombstone ("Removed Sep 3, 2033, retention"). Staff see tombstones; so does the household. */
export function fileLine(f: EvidenceFile, timeZone: string): string {
  if (f.removed) {
    const when = f.removedOn ? ` ${formatDate(f.removedOn, timeZone)}` : "";
    return `${fileKind(f.contentType)} removed${when}${f.removedReason ? `, ${f.removedReason}` : ""}`;
  }
  const size = fileSize(f.bytes);
  return size ? `${fileKind(f.contentType)} · ${size}` : fileKind(f.contentType);
}

/** Open links are short-lived on purpose: 10 minutes (the plan, section 4.5). */
export const EVIDENCE_LINK_SECONDS = 600;
export const EVIDENCE_BUCKET = "payment-evidence";
