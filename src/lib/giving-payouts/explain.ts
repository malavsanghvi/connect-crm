// Pairing a card payout with the bank's card-payout line, and explaining a difference (docs/GIVING_REDESIGN.md slice 9; section 2
// "Handle a payout difference"; owner decisions 2026-10-13: giving.manage, no second approver). Pure: the sheet
// (src/components/giving-actions/explain-payout.tsx), its Server Action and the tests share these words and checks; the database
// (app.explain_payout, 0747) checks them again and decides.
//
// Nothing here moves money: the payout already reached the bank. Pairing records that the two are the same money and, when the
// amounts differ, why. It can be undone with a reason until the month is locked.

export const DIFFERENCE_REASONS = [
  { code: "provider_fees", label: "The card provider's fees were different" },
  { code: "refund_or_dispute", label: "A refund or a dispute was taken out of the payout" },
  { code: "bank_fee", label: "The bank charged a fee" },
  { code: "rounding", label: "Currency conversion or rounding" },
  { code: "other", label: "Something else" },
] as const;

export type DifferenceCode = (typeof DIFFERENCE_REASONS)[number]["code"];

export function isDifferenceCode(value: string | null | undefined): value is DifferenceCode {
  return DIFFERENCE_REASONS.some((r) => r.code === value);
}

export function reasonLabel(code: string | null | undefined): string | null {
  return DIFFERENCE_REASONS.find((r) => r.code === code)?.label ?? null;
}

/** The bank line minus the payout's net: negative when the bank received less. */
export function payoutDifference(netCents: number, bankCents: number): number {
  return bankCents - netCents;
}

/** "The bank received $2.00 less than the payout." */
export function differenceSentence(differenceCents: number, money: (cents: number) => string): string {
  if (differenceCents === 0) return "The amounts agree.";
  return `The bank received ${money(Math.abs(differenceCents))} ${differenceCents < 0 ? "less" : "more"} than the payout.`;
}

/** The button names what it does: "Accept the $2.00 difference", or "Pair them: the amounts agree". */
export function acceptLabel(differenceCents: number, money: (cents: number) => string): string {
  return differenceCents === 0 ? "Pair them: the amounts agree" : `Accept the ${money(Math.abs(differenceCents))} difference`;
}

/** What the sheet still needs before its button can be pressed, or null. */
export function explainProblem(differenceCents: number, code: string | null, note: string): string | null {
  if (differenceCents === 0) return null;
  if (!isDifferenceCode(code)) return "Choose why the bank line and the payout differ.";
  if (note.trim().length === 0) return "Say in a sentence what happened; it is kept in the audit log.";
  return null;
}
