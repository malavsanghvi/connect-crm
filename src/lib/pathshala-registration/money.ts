// Money on the Pathshala Levels and Fees screens: integer cents in, plain words out (plan §2.2, §2.4). Pure.
// "Pathshala fee" everywhere, never a donation or a gift (P20).

import { parseDollarsToCents } from "@/lib/pathshala/format";

import { MAX_FEE_CENTS, MIN_FEE_CENTS } from "./contract";

/** "$1,250.00" (always two decimals: a fee table reads in cents); a negative amount gets a true minus sign. */
export function formatMoney(cents: number, currency = "USD"): string {
  const abs = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(cents) / 100);
  return cents < 0 ? `−${abs}` : abs;
}

/** A level's fee as the Fees screen shows it: "Free" for $0 (§2.2), "Not set" when there is none. */
export function feeLabel(cents: number | null | undefined, currency = "USD"): string {
  if (cents === null || cents === undefined) return "Not set";
  return cents === 0 ? "Free" : formatMoney(cents, currency);
}

/** A part that lowers a line (sibling discount, cap, assistance): "−$13.00", or "—" when nothing comes off. */
export function reductionLabel(cents: number, currency = "USD"): string {
  return cents === 0 ? "—" : `−${formatMoney(Math.abs(cents), currency)}`;
}

/** A part that raises a line (the late fee): "+$25.00", or "—". */
export function additionLabel(cents: number, currency = "USD"): string {
  return cents === 0 ? "—" : `+${formatMoney(cents, currency)}`;
}

/** The fee rule in words (§2.2: $0 is entered as Free; 1–49 cents cannot be paid online). */
export const FEE_RULE = "A fee is $0 (Free) or at least $0.50, the smallest online payment.";

/** Null when the amount can be a level's fee, else the sentence app.set_pathshala_level_fees would refuse with. */
export function feeProblem(cents: number, levelName: string, currency = "USD"): string | null {
  if (!Number.isInteger(cents) || cents < 0) return `The fee for ${levelName} must be Free or an amount like 130 or 130.50.`;
  if (cents > 0 && cents < MIN_FEE_CENTS) return `A fee is $0 (Free) or at least $0.50 (${levelName} was ${formatMoney(cents, currency)}).`;
  if (cents > MAX_FEE_CENTS) return "A fee can be at most $1,000,000.";
  return null;
}

export type FeeEntry = { ok: true; cents: number | null } | { ok: false; error: string };

/**
 * What a fee box holds: blank (leave the fee as it is), "Free" or 0, or dollars ("130", "$130.00", "1,250.5").
 * The database checks the same rule again.
 */
export function parseFeeInput(raw: string | null | undefined, levelName: string, currency = "USD"): FeeEntry {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, cents: null };
  if (/^free$/i.test(text)) return { ok: true, cents: 0 };
  const cents = parseDollarsToCents(text);
  if (cents === null) return { ok: false, error: `The fee for ${levelName} must be Free or an amount like 130 or 130.50.` };
  const problem = feeProblem(cents, levelName, currency);
  return problem ? { ok: false, error: problem } : { ok: true, cents };
}

export type MoneyEntry = { ok: true; cents: number | null } | { ok: false; error: string };

/** An optional amount (the family cap, the late fee): blank → null; "$275", "275.00" → cents. */
export function parseMoneyInput(raw: string | null | undefined, label: string): MoneyEntry {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, cents: null };
  const cents = parseDollarsToCents(text);
  if (cents === null) return { ok: false, error: `${label} must be an amount like 25 or 25.50.` };
  return { ok: true, cents };
}

/** Cents → the value of a fee box ("130", "130.50", "Free"); blank when there is none. */
export function feeInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  if (cents === 0) return "Free";
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}
