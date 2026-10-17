// CatchTheMatch Phase 1, piece 3 (migration 0925): the match arrives in Giving. Pure: no I/O. The database decides who may record a match, checks
// the amount and the day again, and creates the payment; this file reads what it was given and writes the words. Money is integer cents.

import { parseAmountToCents } from "@/lib/money";

import { parseClaimRow, type ClaimRow } from "./catch";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** One claim as the form that records its match needs it (app.match_claim_get). */
export type ClaimDetail = { claim: ClaimRow; amounts: boolean; today: string; canManage: boolean; canRecord: boolean };

export function parseClaimDetail(v: unknown): ClaimDetail | null {
  const o = obj(v);
  const claim = parseClaimRow(o.claim);
  if (!claim) return null;
  return { claim, amounts: o.amounts === true, today: str(o.today) ?? "", canManage: o.can_manage === true, canRecord: o.can_record === true };
}

export type MatchPaymentInput = { amountCents: number; receivedOn: string | null; note: string | null };

/** The amount is what the employer paid, in the community's currency, with cents ("120", "120.5", "1,200.00"). */
export function matchPaymentFromForm(fd: FormData): { ok: true; input: MatchPaymentInput } | { ok: false; error: string } {
  const cents = parseAmountToCents(String(fd.get("amount") ?? ""));
  if (cents === null || cents <= 0) return { ok: false, error: "Enter the amount the employer paid, for example 120.00." };
  const day = String(fd.get("received_on") ?? "").trim();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "The day the money was received must look like 2026-10-17." };
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 200) return { ok: false, error: "The note can be at most 200 characters." };
  return { ok: true, input: { amountCents: cents, receivedOn: day || null, note: note || null } };
}

/** What recording does, in words, for the form and for the message after it. */
export const MATCH_PAYMENT_EFFECTS = [
  "One payment is recorded in Giving as a matching gift for the donor's household: the donor's soft credit.",
  "It is not applied to any pledge and it is not credit; no receipt goes to the donor and it is not part of the donor's tax-deductible total.",
  "The claim becomes Match received on the day you give. Reconcile the payment in Giving › Bank when the deposit appears.",
] as const;

export function matchRecordedMessage(donorFirst: string, amountText: string): string {
  return `Recorded ${amountText} in Giving as ${donorFirst}'s employer matching gift, and the claim is now Match received. It is not applied to a pledge and no receipt goes to the donor. Reconcile it in Giving › Bank when the deposit shows.`;
}
