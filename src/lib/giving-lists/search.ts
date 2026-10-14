// Searching Giving's Pledges and Payments lists (docs/GIVING_REDESIGN.md section 4, slice 3). Pure: no database. One box per list
// reads what was typed as a receipt or pledge number, an amount, or a family (a name, a household number or any identifier, found
// by the existing household search). The list then asks the database for rows that match ANY of them, and each row says why.
//
// Speed (no search function needed): an exact number hits the unique (center_id, receipt_number) and (center_id, pledge_number)
// indexes; a part of a number is an ilike over one community's rows; an amount is an equality; a family is household_id in (…)
// on the (center_id, household_id, …) indexes. A community holds thousands of rows, so each of these takes milliseconds.
//
// Built for every organization: any currency symbol, the community's own currency code ("250 EUR", "CAD 40"), any language for
// names. A European "1.250,00" is not read as an amount (the shared parser reads "." as the decimal point); it is searched as text.

import { parseAmountToCents } from "@/lib/money";
import { safeFilterText } from "@/lib/search-params";

export type ListSearch = {
  /** What was typed, squeezed and cut to 120 characters. */
  text: string;
  /** A word with a digit in it: searched inside receipt or pledge numbers. */
  numberToken: string | null;
  /** The text read as an amount, in cents. */
  amountCents: number | null;
  /** The text handed to the household search (names, household numbers, any identifier); null when it is only an amount. */
  familyText: string | null;
};

export type MatchedBy = "number" | "amount" | "family";

const MAX = 120;

function squeeze(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX);
}

/** The text without the community's currency code around it ("250 EUR" → "250", "CAD 40" → "40"). */
function withoutCode(text: string, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return text;
  return text.replace(new RegExp(`^${code}\\s*|\\s*${code}$`, "i"), "").trim();
}

/** "250 €" → "€250": the shared parser reads the symbol in front. */
function symbolFirst(text: string): string {
  const m = /^([\d.,\s]+?)\s*(\p{Sc})$/u.exec(text);
  return m ? `${m[2]}${m[1].trim()}` : text;
}

/** Money only: a currency symbol or code was typed, or the number has cents ("200.00"). Such a text is never a family. */
function moneyOnly(raw: string, bare: string): boolean {
  if (/\p{L}/u.test(bare)) return false;
  return /\p{Sc}/u.test(raw) || raw !== bare || /^\d[\d,]*\.\d{1,2}$/.test(bare);
}

export function readListSearch(raw: string | null | undefined, currency: string): ListSearch | null {
  const text = squeeze(String(raw ?? ""));
  if (!text) return null;
  const bare = withoutCode(text, currency);
  const cents = /\p{L}/u.test(bare) ? null : parseAmountToCents(symbolFirst(bare));
  const amountCents = cents !== null && cents > 0 ? cents : null;
  const money = amountCents !== null && moneyOnly(text, bare);
  const withDigit = text.split(" ").filter((w) => /\d/.test(w));
  const token = !money && withDigit.length === 1 ? safeFilterText(withDigit[0]).replace(/\s+/g, "") : "";
  const familyText = money || text.length < 2 ? null : text;
  return { text, numberToken: token.length >= 2 ? token : null, amountCents, familyText };
}

/**
 * The PostgREST `or` filter for a list: the number column contains the token, the amount is equal, or the household is one the
 * household search found. null when nothing could match (the list is then empty without asking the database).
 */
export function searchFilter(
  s: ListSearch,
  { numberColumn, amountColumn = "amount_cents", householdIds }: { numberColumn: string | null; amountColumn?: string | null; householdIds: readonly string[] },
): string | null {
  const parts: string[] = [];
  if (numberColumn && s.numberToken) parts.push(`${numberColumn}.ilike.*${s.numberToken}*`);
  if (amountColumn && s.amountCents !== null) parts.push(`${amountColumn}.eq.${s.amountCents}`);
  const ids = householdIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, MAX_FAMILIES);
  if (ids.length > 0) parts.push(`household_id.in.(${ids.join(",")})`);
  return parts.length > 0 ? parts.join(",") : null;
}

/** At most this many families from one search (the household search returns its best first). */
export const MAX_FAMILIES = 60;

/** Why a row came back, said on the row. */
export function matchedBy(
  s: ListSearch | null,
  row: { number: string | null; amountCents: number; householdId: string | null },
  householdIds: ReadonlySet<string>,
): MatchedBy | null {
  if (!s) return null;
  if (s.numberToken && row.number && row.number.toLowerCase().includes(s.numberToken.toLowerCase())) return "number";
  if (s.amountCents !== null && row.amountCents === s.amountCents) return "amount";
  if (row.householdId && householdIds.has(row.householdId)) return "family";
  return null;
}

export function matchedByText(by: MatchedBy | null, numberWord: string): string | null {
  if (by === "number") return `Found by its ${numberWord}`;
  if (by === "amount") return "Found by its amount";
  if (by === "family") return "Found by the family";
  return null;
}
