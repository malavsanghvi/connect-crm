// The timeline of one pledge (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 3.3 and D7; migration 0874 pledge_timeline):
// pledged, every proof event that covers it, every payment applied to it, and Bank reconciled, in time order. Pure: no database,
// no React. app.pledge_timeline answers in time order; this file reads that answer and puts each entry in plain words.

import { formatDate } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";

export type TimelineKind = "pledged" | "proof" | "payment" | "reconciled";

export type TimelineEntry = {
  at: string;
  kind: TimelineKind;
  /** For a proof: submitted, question, reply, approved, rejected, withdrawn, merged or pledge_cancelled. */
  event: string | null;
  /** The words the family reads for a proof event (written when it happened). */
  text: string | null;
  /** The pledge (pledged), this pledge's share of the proof (proof) or of the payment (payment). */
  amountCents: number | null;
  receiptNumber: string | null;
  method: string | null;
  paidOn: string | null;
  /** bank, or historical (imported money history). */
  reconciledKind: string | null;
};

type Tone = "ok" | "warn" | "bad" | "info" | "muted";

const KINDS: readonly string[] = ["pledged", "proof", "payment", "reconciled"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Read what pledge_timeline returned. null when it is not the shape this screen knows (the caller says so; it never shows "no history"). */
export function parseTimeline(data: unknown): TimelineEntry[] | null {
  if (!Array.isArray(data)) return null;
  const out: TimelineEntry[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const at = str(o.at);
    if (!at || typeof o.kind !== "string" || !KINDS.includes(o.kind)) return null;
    const amount = o.amount_cents === null || o.amount_cents === undefined ? null : Number(o.amount_cents);
    out.push({
      at,
      kind: o.kind as TimelineKind,
      event: str(o.event),
      text: str(o.text),
      amountCents: amount !== null && Number.isFinite(amount) ? amount : null,
      receiptNumber: str(o.receipt_number),
      method: str(o.method),
      paidOn: str(o.paid_on),
      reconciledKind: str(o.reconciled_kind),
    });
  }
  return out;
}

/** The badge in front of an entry: the pledge's state at that moment, in the words the household page uses. */
export function timelineState(e: Pick<TimelineEntry, "kind" | "event">): { label: string; tone: Tone } {
  switch (e.kind) {
    case "pledged":
      return { label: "Open", tone: "warn" };
    case "payment":
      return { label: "Paid", tone: "ok" };
    case "reconciled":
      return { label: "Bank reconciled", tone: "ok" };
    default:
      switch (e.event) {
        case "submitted":
        case "reply":
          return { label: "Soft credit", tone: "info" };
        case "question":
          return { label: "Question asked", tone: "warn" };
        case "approved":
          return { label: "Approved", tone: "ok" };
        case "merged":
          return { label: "Kept with the payment", tone: "ok" };
        case "rejected":
          return { label: "Not accepted", tone: "bad" };
        case "withdrawn":
          return { label: "Taken back", tone: "muted" };
        case "pledge_cancelled":
          return { label: "Cancelled", tone: "muted" };
        default:
          return { label: "Confirmation", tone: "muted" };
      }
  }
}

/** The date in front of an entry ("Oct 12"), in the community's time zone. */
export function timelineWhen(e: Pick<TimelineEntry, "at">, timeZone: string): string {
  return formatDate(e.at, timeZone);
}

/** One entry in a sentence: "Pledged $1,000.00.", "Proof for $200.00. Sent by Mina. ...", "Receipt R-1, check: $200.00 applied." */
export function timelineText(e: TimelineEntry, currency: string, locale?: string): string {
  const money = e.amountCents !== null ? formatCents(e.amountCents, currency, locale) : "";
  switch (e.kind) {
    case "pledged":
      return money ? `Pledged ${money}.` : "Pledged.";
    case "payment": {
      const how = e.method ? (PAYMENT_METHOD_LABEL[e.method] ?? e.method.replace(/_/g, " ")).toLowerCase() : "";
      const label = `${e.receiptNumber ? `Receipt ${e.receiptNumber}` : "A payment"}${how ? `, ${how}` : ""}`;
      return `${label}: ${money || "an amount"} applied.`;
    }
    case "reconciled":
      return e.reconciledKind === "historical"
        ? "Marked reconciled: every payment on it is imported history."
        : "Every payment on it is matched to a bank line.";
    default: {
      const share = money && e.event === "submitted" ? `Payment confirmation for ${money}. ` : "";
      return `${share}${e.text ?? "Something happened to the payment confirmation."}`;
    }
  }
}
