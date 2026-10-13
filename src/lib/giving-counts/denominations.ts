// Counting by notes and coins (docs/GIVING_REDESIGN.md slice 5): optional, for the currencies listed here; any other currency
// enters the total only. Pure. Every value is in the currency's minor unit (cents, pence, paise), so a total is an integer sum.
// totals_by_denomination (0003) holds {"<value in minor units>": <how many>}, zero counts left out.

import { formatCents } from "@/lib/money";

/** Notes and coins in common use, largest first, in minor units. */
const DENOMINATIONS: Readonly<Record<string, readonly number[]>> = {
  USD: [10_000, 5_000, 2_000, 1_000, 500, 200, 100, 25, 10, 5, 1],
  CAD: [10_000, 5_000, 2_000, 1_000, 500, 200, 100, 25, 10, 5],
  EUR: [20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  GBP: [5_000, 2_000, 1_000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  INR: [50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100],
  AUD: [10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50, 20, 10, 5],
  NZD: [10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50, 20, 10],
  SGD: [10_000, 5_000, 1_000, 500, 200, 100, 50, 20, 10, 5],
  ZAR: [20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50, 20, 10],
  KES: [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 100],
};

/** The most of one note or coin a count can hold (a typo guard, not a rule). */
export const MAX_PIECES = 100_000;

/** The community's notes and coins, or null when counting by them is not offered for its currency. */
export function denominationsFor(currency: string): readonly number[] | null {
  return DENOMINATIONS[currency.toUpperCase()] ?? null;
}

/** A note or coin as the currency writes it, without ".00" for a whole value: "$20", "€0.50", "₹500". */
export function denominationLabel(valueCents: number, currency: string, locale: string): string {
  const full = formatCents(valueCents, currency, locale);
  return valueCents % 100 === 0 ? full.replace(/[.,]00(?=\D*$)/, "") : full;
}

export type DenominationCounts = Record<string, number>;

/** The sum of the notes and coins, in minor units. */
export function denominationTotal(counts: DenominationCounts): number {
  let total = 0;
  for (const [value, n] of Object.entries(counts)) total += Number(value) * n;
  return total;
}

/**
 * The notes and coins as the sheet sends them ({"2000": "3", "25": ""}): only the currency's own values, whole numbers from 0 to
 * MAX_PIECES, zero and empty left out. An empty breakdown is { counts: {}, totalCents: null }.
 */
export function readDenominations(
  raw: unknown,
  currency: string,
): { ok: true; counts: DenominationCounts; totalCents: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, counts: {}, totalCents: null };
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "the notes and coins could not be read" };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "the notes and coins could not be read" };
  const allowed = denominationsFor(currency);
  const counts: DenominationCounts = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (text === "" || text === "0") continue;
    if (!allowed || !allowed.includes(Number(key))) return { ok: false, error: "a note or coin is not one of this currency's" };
    if (!/^\d+$/.test(text) || Number(text) > MAX_PIECES) return { ok: false, error: "each note and coin needs a whole number, like 12" };
    counts[String(Number(key))] = Number(text);
  }
  return { ok: true, counts, totalCents: Object.keys(counts).length > 0 ? denominationTotal(counts) : null };
}

/**
 * The count's total: the one typed, the notes and coins, or both when they agree. Both given and different is a plain error
 * naming the two amounts; neither given is a count saved before its total is known (0).
 */
export function reconcileTotal(
  typedCents: number | null,
  piecesCents: number | null,
  money: (cents: number) => string,
): { ok: true; cents: number } | { ok: false; error: string } {
  if (typedCents !== null && piecesCents !== null && typedCents !== piecesCents) {
    return { ok: false, error: `the notes and coins add up to ${money(piecesCents)} but the total says ${money(typedCents)}` };
  }
  return { ok: true, cents: piecesCents ?? typedCents ?? 0 };
}
