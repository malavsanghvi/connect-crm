// Giving > Payment proofs: the four decisions (approve, approve with changes, ask for more, reject) as pure code. It checks what the
// person typed before the database is asked, builds the arguments of approve_payment_proof (0866), reads its answer, and words the
// outcome. The database checks everything again; these checks only give a plain sentence next to what the person did.

import { isDateOnly } from "@/lib/dates";
import type { DbErrorLike } from "@/lib/errors";
import { parseAmountToCents } from "@/lib/money";
import { parseLookalikes, type Lookalike } from "@/lib/payment-proofs/queue";

/** The ways an organization takes money outside a card (the enum values record_offline_payment accepts). */
export const OFFLINE_METHODS = ["cash", "check", "ach", "zelle", "stock", "daf", "matching_gift", "other"] as const;
export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

export function isOfflineMethod(v: unknown): v is OfflineMethod {
  return typeof v === "string" && (OFFLINE_METHODS as readonly string[]).includes(v);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The most the database accepts for one payment ($1,000,000), in cents. */
export const MAX_PROOF_CENTS = 100_000_000;

export type ApproveInput = {
  proofId: string;
  /** Changes: what the proof really shows. Left out (null) means "as the member claimed". */
  amountCents?: number | null;
  paidOn?: string | null;
  method?: string | null;
  note?: string | null;
  /** The treasurer chose to keep the photos as evidence on a payment that already exists. */
  mergePaymentId?: string | null;
  /** The treasurer says why this is a different gift from the lookalike. */
  separateReason?: string | null;
  /** Also match this bank line in the same click. */
  bankTxnId?: string | null;
};

export type ApproveArgs = {
  p_proof: string;
  p_amount_cents?: number;
  p_paid_on?: string;
  p_method?: string;
  p_note?: string;
  p_merge_payment?: string;
  p_separate_reason?: string;
  p_bank_txn?: string;
};

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

/** Checks an approval and builds the database call. Arguments the person did not set are left out, so the database keeps the claim. */
export function approveArgs(input: ApproveInput): { ok: true; args: ApproveArgs } | { ok: false; error: string } {
  if (!isUuid(input.proofId)) return { ok: false, error: "That payment confirmation was not recognised. Reload the page and try again." };
  const args: ApproveArgs = { p_proof: input.proofId };
  if (input.amountCents !== null && input.amountCents !== undefined) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > MAX_PROOF_CENTS) {
      return { ok: false, error: "Enter an amount from 0.01 to 1,000,000." };
    }
    args.p_amount_cents = input.amountCents;
  }
  if (input.paidOn) {
    if (!isDateOnly(input.paidOn) || Number.isNaN(Date.parse(`${input.paidOn}T00:00:00Z`))) return { ok: false, error: "Enter the date the money was paid as a real date." };
    args.p_paid_on = input.paidOn;
  }
  if (input.method) {
    if (!isOfflineMethod(input.method)) return { ok: false, error: "Choose one of the ways of paying in the list." };
    args.p_method = input.method;
  }
  const note = cleanText(input.note, 240);
  if (note) args.p_note = note;
  if (input.mergePaymentId) {
    if (!isUuid(input.mergePaymentId)) return { ok: false, error: "The payment to keep the photos with was not recognised. Reload and try again." };
    args.p_merge_payment = input.mergePaymentId;
  }
  const separate = typeof input.separateReason === "string" ? input.separateReason.trim() : "";
  if (separate) {
    if (separate.length < 5) return { ok: false, error: "Say why this is a different gift, in a few words." };
    args.p_separate_reason = separate.slice(0, 500);
  }
  if (args.p_merge_payment && args.p_separate_reason) return { ok: false, error: "Choose one: keep the photos with the existing payment, or record a different gift." };
  if (input.bankTxnId) {
    if (!isUuid(input.bankTxnId)) return { ok: false, error: "The bank line was not recognised. Reload and try again." };
    args.p_bank_txn = input.bankTxnId;
  }
  return { ok: true, args };
}

/** "Reject" and "Ask for more" both need a few words the family will read. */
export function reasonProblem(text: string | null | undefined, what: "reject" | "ask"): string | null {
  const t = (text ?? "").trim();
  if (t.length < 3) return what === "reject" ? "Say why, in a few words. The family will read it." : "Write what you need, in a few words. The family will read it.";
  if (t.length > 500) return "Keep it under 500 characters.";
  return null;
}

// ---------------------------------------------------------------------------------------------------- the changes form

export type ChangesForm = { amount: string; paidOn: string; method: string };

/** Turns what was typed in "Approve with changes" into the values that differ from the claim (nothing that is unchanged is sent). */
export function changesFromForm(form: ChangesForm, claim: { amountCents: number; paidOn: string; method: string }):
  | { ok: true; amountCents: number | null; paidOn: string | null; method: string | null }
  | { ok: false; error: string } {
  const cents = parseAmountToCents(form.amount);
  if (cents === null || cents < 1 || cents > MAX_PROOF_CENTS) return { ok: false, error: "Enter the amount you see on the confirmation, from 0.01 to 1,000,000." };
  if (!isDateOnly(form.paidOn)) return { ok: false, error: "Enter the date you see on the confirmation." };
  if (!isOfflineMethod(form.method)) return { ok: false, error: "Choose how it was paid." };
  return {
    ok: true,
    amountCents: cents === claim.amountCents ? null : cents,
    paidOn: form.paidOn === claim.paidOn ? null : form.paidOn,
    method: form.method === claim.method ? null : form.method,
  };
}

// ---------------------------------------------------------------------------------------------------- reading the answer

export type DecisionState = "approved" | "merged" | "first_approved" | "rejected" | "needs_info";
export type Notice = { queued: number; failed: number };
export type Decision = { state: DecisionState; paymentId: string | null; receipt: string | null; notice: Notice | null; amountCents: number | null };

const STATES: readonly string[] = ["approved", "merged", "first_approved", "rejected", "needs_info"];

export function parseDecision(data: unknown): Decision | null {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  if (typeof o.state !== "string" || !STATES.includes(o.state)) return null;
  const n = typeof o.notice === "object" && o.notice !== null ? (o.notice as Record<string, unknown>) : null;
  const proof = typeof o.proof === "object" && o.proof !== null ? (o.proof as Record<string, unknown>) : null;
  const amount = Number(proof?.approved_amount_cents ?? proof?.amount_cents);
  return {
    state: o.state as DecisionState,
    paymentId: typeof o.payment_id === "string" ? o.payment_id : null,
    receipt: typeof o.receipt_number === "string" && o.receipt_number !== "" ? o.receipt_number : null,
    notice: n ? { queued: Math.max(0, Number(n.queued) || 0), failed: Math.max(0, Number(n.failed) || 0) } : null,
    amountCents: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null,
  };
}

/** Whether the family was told: said plainly either way, never left out. */
export function noticeSentence(n: Notice | null): string {
  if (!n) return "";
  if (n.failed > 0) return " The family could not be notified on every channel, so let them know yourself.";
  if (n.queued === 0) return " No notice was sent because this confirmation has no account to notify, so let the family know yourself.";
  return " The family was told.";
}

export function decisionMessage(d: Decision, opts: { reconciled: boolean; money: (cents: number) => string }): string {
  switch (d.state) {
    case "first_approved":
      return "First approval recorded. The payment is recorded when a second person with approval rights also approves.";
    case "merged":
      return `The photos are now kept with the payment that was already recorded. No new payment was made.${noticeSentence(d.notice)}`;
    case "approved": {
      const paid = d.amountCents !== null ? ` ${opts.money(d.amountCents)}` : "";
      const receipt = d.receipt ? ` Receipt ${d.receipt}.` : "";
      return `Approved. The${paid} payment is recorded and its pledges are paid.${receipt}${opts.reconciled ? " It was matched to the bank line." : ""}${noticeSentence(d.notice)}`;
    }
    case "rejected":
      return `Rejected. The soft credit is released and the pledges are open again.${noticeSentence(d.notice)}`;
    case "needs_info":
      return `Question sent. The pledges stay as soft credit until the family answers.${noticeSentence(d.notice)}`;
  }
}

// ---------------------------------------------------------------------------------------------------- errors

/**
 * The database's own sentence for a refusal it wrote itself (SQLSTATE 42501 / 22023 / 23505 with a capitalised sentence, as
 * app.approve_payment_proof raises them). Postgres' own messages ("permission denied for table …", "new row violates …") are not
 * plain English and return null, so the caller falls back to explainError.
 */
export function plainDbSentence(error: DbErrorLike | null | undefined): string | null {
  if (!error) return null;
  const code = error.code ?? "";
  const msg = (error.message ?? "").trim();
  if (!["42501", "22023", "23505", "P0001"].includes(code) || msg === "") return null;
  if (/row-level security|permission denied|violates|duplicate key/i.test(msg)) return null;
  if (!/^[A-Z]/.test(msg)) return null;
  return msg;
}

/** SQLSTATE the database raises when a lookalike payment exists and the treasurer must merge or say why it is different. */
export const DUPLICATE_SQLSTATE = "CCDUP";

/** The lookalikes in a CCDUP error (its detail is the JSON list), or null when the error is not that. */
export function duplicateFromError(error: DbErrorLike | null | undefined): Lookalike[] | null {
  if (!error || error.code !== DUPLICATE_SQLSTATE) return null;
  try {
    return parseLookalikes(JSON.parse(error.details ?? "[]"));
  } catch {
    return [];
  }
}
