// Recording an offline payment (check, cash, ACH, Zelle, stock): the checks that come before anything is written. ONE place
// for them, used by the Record payment screen's Server Action and by the Giving commands (giving.draft_payment today, the
// confirm-level giving.record_payment later), so the screen, ⌘K and Niva refuse the same things in the same words.
// Pure: no database, no Next imports.

import { stockMemo } from "@/lib/giving";
import { OFFLINE_METHODS } from "@/lib/labels";
import { parseAmountToCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";

export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

/** How the allocation is chosen: earliest open pledge first, only the named pledges (in that order), or none. */
export type AllocationMode = "auto" | "choose" | "none";

export type OfflinePaymentInput = {
  householdId: string;
  /** Dollars as typed: "250", "250.00", "$1,250.50". Parsed to integer cents here and nowhere else. */
  amount: string;
  method: string;
  /** YYYY-MM-DD */
  receivedOn: string;
  /** Check number (check), shares and value (stock), or a reference (other methods). */
  reference?: string;
  envelopeNumber?: string;
  memo?: string;
  allocation: AllocationMode;
  pledgeIds?: string[];
};

/** What was asked for, cleaned and in the form the payments table stores. */
export type CheckedOfflinePayment = {
  householdId: string;
  amountCents: number;
  method: OfflineMethod;
  receivedOn: string;
  checkNumber: string | null;
  envelopeNumber: string | null;
  memo: string | null;
  allocation: AllocationMode;
  /** The pledges named, in order, when allocation is "choose"; otherwise null. */
  chosen: string[] | null;
};

export type OfflinePaymentCheck = { ok: true; value: CheckedOfflinePayment } | { ok: false; error: string };

function clip(value: string | undefined, max: number): string | null {
  return (value ?? "").trim().slice(0, max) || null;
}

/**
 * The first thing wrong with a payment, in plain English, or the payment in the shape the database stores. `doing` is the
 * phrase after "Could not": the screen says "record the payment", a draft says "prepare the payment".
 * The messages are the Record payment screen's own, word for word.
 */
export function checkOfflinePayment(input: OfflinePaymentInput, today: string, doing = "record the payment"): OfflinePaymentCheck {
  const fail = (rest: string): OfflinePaymentCheck => ({ ok: false, error: `Could not ${doing} — ${rest}` });
  const amountCents = parseAmountToCents(input.amount);
  const method = input.method as OfflineMethod;
  if (!isUuid(input.householdId)) return fail("choose the household first.");
  if (amountCents === null || amountCents <= 0) return fail("enter an amount greater than zero, like 251.00.");
  if (!OFFLINE_METHODS.includes(method)) return fail("choose check, cash, ACH, Zelle or stock.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) || input.receivedOn > today) {
    return fail("the received date must be a real date, not in the future.");
  }
  const chosen = input.allocation === "choose" ? (input.pledgeIds ?? []).filter(isUuid) : null;
  if (input.allocation === "choose" && (!chosen || chosen.length === 0)) {
    return fail("tick the pledges to apply it to, or switch to earliest-first.");
  }
  const ref = (input.reference ?? "").trim();
  // payments has no stock or reference columns: stock details and other references lead the memo.
  const memo =
    method === "stock"
      ? stockMemo(ref, input.memo ?? "")
      : method !== "check" && ref
        ? clip(`Ref ${ref}${input.memo?.trim() ? ` · ${input.memo.trim()}` : ""}`, 500)
        : clip(input.memo, 500);
  if (method === "stock" && !ref) {
    return fail("for a stock gift, enter the shares and their value on the date received.");
  }
  return {
    ok: true,
    value: {
      householdId: input.householdId,
      amountCents,
      method,
      receivedOn: input.receivedOn,
      checkNumber: method === "check" ? clip(ref.replace(/^#/, ""), 40) : null,
      envelopeNumber: clip(input.envelopeNumber, 40),
      memo,
      allocation: input.allocation,
      chosen,
    },
  };
}
