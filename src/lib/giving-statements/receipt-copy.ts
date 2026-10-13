// Giving › Statements, a copy of one receipt on request (docs/GIVING_REDESIGN.md slice 8). Pure.
//
// The facts come from app.receipt_copy (0746): the payment, the household card, the adults, and the name on the receipt, which the
// database leaves out when the payer is under the age of majority or the name holds a child's first name; the copy is then
// addressed to the household's adults. A child's name never appears. The wording is the donation-receipt template the treasurer
// approved (signer and personal note); the portal prints a copy only while that approval is current. Nothing is sent: staff print
// the copy or save it as a PDF from the browser, and nothing is recorded (owner, 2026-10-13).

import { moneyIn, type CommunityFormat } from "@/lib/community-format";
import { formatDate } from "@/lib/dates";
import { RECEIPT_KINDS, RELIGIOUS_BENEFIT_LINE, type ReceiptPreviewLine } from "@/lib/giving";
import type { Family } from "@/lib/giving-today/queue";
import type { KindProfile } from "@/lib/kind";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";

import { addressedTo } from "./review";

export type ReceiptCopyIn = {
  paymentId: string;
  householdId: string;
  household: { name: string; number: string | null; orgId: string | null; city: string | null };
  receiptNumber: string;
  receivedOn: string;
  method: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  /** Null when there is none or the database left it out (a child's name). */
  receiptName: string | null;
  receiptNameHidden: boolean;
  jointReceipt: boolean;
  payerIsAdult: boolean | null;
  adults: string[];
  appliedTo: string[];
  templates: { ok: boolean; detail: string };
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (text(x) ? [text(x)!] : [])) : []);

/** app.receipt_copy's answer, read defensively; null when it is not the expected shape. */
export function parseReceiptCopy(data: unknown): ReceiptCopyIn | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const paymentId = text(o.payment_id);
  const householdId = text(o.household_id);
  const receiptNumber = text(o.receipt_number);
  const receivedOn = text(o.received_on);
  if (!paymentId || !householdId || !receiptNumber || !receivedOn) return null;
  const h = o.household && typeof o.household === "object" ? (o.household as Record<string, unknown>) : {};
  const t = o.templates && typeof o.templates === "object" ? (o.templates as Record<string, unknown>) : {};
  return {
    paymentId,
    householdId,
    household: { name: text(h.name) ?? "Unnamed household", number: text(h.number), orgId: text(h.org_id), city: text(h.city) },
    receiptNumber,
    receivedOn,
    method: text(o.method) ?? "other",
    status: text(o.status) ?? "",
    amountCents: int(o.amount_cents),
    refundedCents: int(o.refunded_cents),
    receiptName: o.receipt_name_hidden === true ? null : text(o.receipt_name),
    receiptNameHidden: o.receipt_name_hidden === true,
    jointReceipt: o.joint_receipt === true,
    payerIsAdult: typeof o.payer_is_adult === "boolean" ? o.payer_is_adult : null,
    adults: strings(o.adults),
    appliedTo: strings(o.applied_to),
    templates: { ok: t.ok === true, detail: text(t.detail) ?? "Could not read whether the treasurer approved the receipt templates." },
  };
}

/** The statuses whose money counts as given (app.statement_counted_status, 0522). */
const COUNTED = new Set(["captured", "pending_clearing", "settled", "partially_refunded"]);

/**
 * Why there is no receipt to copy, or null. The database refuses these first (0746); the portal says the same if it is ever
 * handed one.
 */
export function receiptCopyRefusal(c: Pick<ReceiptCopyIn, "status" | "receiptNumber">, isOpeningBalance = false): string | null {
  if (isOpeningBalance) return "An opening-balance line never gets a receipt: it records what was paid before the imported payment history begins.";
  if (c.status === "refunded") return "This payment was refunded in full, so there is no receipt to copy.";
  if (!COUNTED.has(c.status)) return "This payment did not go through, so there is no receipt to copy.";
  if (!c.receiptNumber.trim()) return "This payment has no receipt number yet, so there is no receipt to copy.";
  return null;
}

/** Who the copy is addressed to: the name on the receipt, else the household's adults; never a child. */
export function receiptAddressee(c: Pick<ReceiptCopyIn, "receiptName" | "adults" | "household">): string {
  if (c.receiptName) return c.receiptName;
  if (c.adults.length) return addressedTo(c.adults.map((name) => ({ name, primary: false, email: false, app: false })));
  return c.household.number ? `Household ${c.household.number}` : "The household";
}

/** The household card for the copy: the first adult as the primary, never a child. */
export function receiptFamily(c: ReceiptCopyIn): Family {
  return {
    id: c.householdId,
    name: c.household.name,
    number: c.household.number,
    orgId: c.household.orgId,
    primary: c.adults[0] ?? null,
    city: c.household.city,
  };
}

/** The search box's text, tidied: a receipt number is matched as written, without spaces around it. */
export function cleanReceiptNumber(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v && v.length <= 64 ? v : null;
}

export type ReceiptCopyContext = {
  centerName: string;
  centerAddress: string | null;
  signedBy: string;
  note: string;
  fmt: CommunityFormat;
  timeZone: string;
  /** Today in the community's time zone (YYYY-MM-DD): the day the copy is printed. */
  today: string;
  orgKind?: Pick<KindProfile, "faithBased"> | null;
};

/** The lines of the copy, in the order the template preview draws them, marked as a copy. */
export function receiptCopyLines(c: ReceiptCopyIn, ctx: ReceiptCopyContext): ReceiptPreviewLine[] {
  const faith = ctx.orgKind ? ctx.orgKind.faithBased : true;
  const title = RECEIPT_KINDS.find((k) => k.kind === "donation_receipt")?.label ?? "Donation receipt";
  const method = (PAYMENT_METHOD_LABEL[c.method] ?? c.method).toLowerCase();
  const lines: ReceiptPreviewLine[] = [
    { text: [ctx.centerName, ctx.centerAddress].filter(Boolean).join(" · "), tone: "navy", strong: true },
    { text: `${title} · No. ${c.receiptNumber}`, tone: "ink", strong: true },
    {
      text: `${receiptAddressee(c)} · ${moneyIn(c.amountCents, ctx.fmt)} by ${method} on ${formatDate(c.receivedOn, ctx.timeZone)}`,
      tone: "ink",
    },
  ];
  if (c.refundedCents > 0) {
    lines.push({
      text: `Refunded ${moneyIn(c.refundedCents, ctx.fmt)}: the gift is now ${moneyIn(c.amountCents - c.refundedCents, ctx.fmt)}`,
      tone: "ink",
    });
  }
  if (c.appliedTo.length) lines.push({ text: `Applied to: ${c.appliedTo.join(", ")}`, tone: "ink" });
  if (faith) lines.push({ text: RELIGIOUS_BENEFIT_LINE, tone: "muted" });
  const note = ctx.note.trim();
  const signed = ctx.signedBy.trim();
  if (note || signed) lines.push({ text: [note, signed ? `— ${signed}` : ""].filter(Boolean).join(" "), tone: "muted" });
  lines.push({
    text: `Copy of receipt ${c.receiptNumber}, printed ${formatDate(ctx.today, ctx.timeZone)}. It is not a new gift.`,
    tone: "muted",
  });
  return lines;
}

/** Why printing is off, or null when the treasurer's approval of the templates is current. */
export function printBlockedReason(c: Pick<ReceiptCopyIn, "templates">): string | null {
  return c.templates.ok ? null : `Printing is off until the treasurer approves the receipt wording. ${c.templates.detail}`;
}
