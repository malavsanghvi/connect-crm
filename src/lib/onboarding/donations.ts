// Onboarding step "Past donations": the template, the column mapping, the per-row validation by the
// field's type and intent, and the two files (households, payments) that the existing import tool then
// stages, previews, commits and can undo. Pure (no I/O) so the rules are tested.

import { normHeader } from "@/lib/import/mapping";
import { cleanText, toCents, toDate, toE164, toEmail, type Transformed } from "@/lib/import/transforms";
import type { PayerInput, Group } from "./match";

export type PayerFieldKey = "name" | "email" | "phone" | "address1" | "address2" | "city" | "state" | "zip" | "amount" | "date" | "method" | "receipt" | "memo";

export type PayerField = { key: PayerFieldKey; label: string; required: boolean; hint: string; example: string; synonyms: string[] };

/** The donation file's columns. Anything else in the file is kept as custom data. */
export const PAYER_FIELDS: readonly PayerField[] = [
  { key: "name", label: "Payer name", required: true, hint: "Who paid, as written on the check, receipt or bank statement.", example: "Malav & Palak Sanghvi", synonyms: ["name", "donor", "donor name", "payer", "paid by", "customer", "account name", "full name", "household name"] },
  { key: "amount", label: "Amount", required: true, hint: "Dollars, e.g. 1,001.00", example: "$1,001.00", synonyms: ["gift amount", "donation amount", "total", "payment amount", "amount paid"] },
  { key: "date", label: "Date", required: true, hint: "The day it was received.", example: "2024-09-02", synonyms: ["received on", "payment date", "gift date", "donation date", "date received", "transaction date"] },
  { key: "method", label: "Method", required: false, hint: "Check, cash, card, ACH, Zelle, PayPal, DAF…", example: "check", synonyms: ["payment method", "tender", "payment type", "type"] },
  { key: "email", label: "Email", required: false, hint: "Helps match the same family.", example: "malav@example.com", synonyms: ["email address", "e-mail", "donor email", "payer email"] },
  { key: "phone", label: "Phone", required: false, hint: "Helps match the same family.", example: "281-555-0142", synonyms: ["mobile", "cell", "phone number", "telephone", "mobile phone", "donor phone"] },
  { key: "address1", label: "Address", required: false, hint: "Street address. Helps match the same family.", example: "12 Lotus Lane", synonyms: ["address line 1", "street", "street address", "address 1", "billing address"] },
  { key: "address2", label: "Address line 2", required: false, hint: "Apartment or suite.", example: "Apt 4", synonyms: ["address 2", "apt", "unit"] },
  { key: "city", label: "City", required: false, hint: "", example: "Sugar Land", synonyms: ["town"] },
  { key: "state", label: "State", required: false, hint: "", example: "TX", synonyms: ["state/province", "province", "region"] },
  { key: "zip", label: "ZIP", required: false, hint: "", example: "77478", synonyms: ["zip code", "postal code", "postcode"] },
  { key: "receipt", label: "Receipt number", required: false, hint: "Kept as issued; makes re-uploading safe.", example: "10331", synonyms: ["receipt #", "receipt no", "receipt", "payment id", "payment number", "donation id", "transaction id", "check number"] },
  { key: "memo", label: "Memo", required: false, hint: "Purpose or note.", example: "Paryushan", synonyms: ["note", "notes", "purpose", "fund", "campaign", "description"] },
] as const;

export function donationTemplateHeader(): string[] {
  return PAYER_FIELDS.map((f) => f.label);
}
export function donationTemplateExample(): string[] {
  return PAYER_FIELDS.map((f) => f.example);
}

/** Each file column -> a payer field, "custom" (kept as custom data) or "skip" (empty column). */
export type ColumnChoice = PayerFieldKey | "custom" | "skip";

export function autoMapColumns(headers: readonly string[], sampleRows: readonly (readonly string[])[]): ColumnChoice[] {
  const used = new Set<PayerFieldKey>();
  return headers.map((h, i) => {
    const n = normHeader(h);
    const f =
      PAYER_FIELDS.find((x) => normHeader(x.key) === n) ??
      PAYER_FIELDS.find((x) => normHeader(x.label) === n) ??
      PAYER_FIELDS.find((x) => x.synonyms.some((s) => normHeader(s) === n));
    if (f && !used.has(f.key)) {
      used.add(f.key);
      return f.key;
    }
    return sampleRows.every((r) => !cleanText(r[i] ?? "")) ? "skip" : "custom";
  });
}

export function missingRequired(choices: readonly ColumnChoice[]): PayerField[] {
  return PAYER_FIELDS.filter((f) => f.required && !choices.includes(f.key));
}

export const METHOD_VALUES = ["check", "cash", "card", "ach", "zelle", "stock", "daf", "matching_gift", "apple_pay", "google_pay", "other"] as const;
export type MethodValue = (typeof METHOD_VALUES)[number];

/** The organization's word for how it was paid -> ours. Unknown words become "other" (with a warning). */
export function methodOf(text: string): { value: MethodValue; known: boolean } {
  const s = cleanText(text).toLowerCase();
  if (!s) return { value: "other", known: false };
  if (/zelle/.test(s)) return { value: "zelle", known: true };
  if (/apple\s*pay/.test(s)) return { value: "apple_pay", known: true };
  if (/google\s*pay|gpay/.test(s)) return { value: "google_pay", known: true };
  if (/paypal|credit|debit|visa|master|amex|discover|\bcard\b|stripe|square/.test(s)) return { value: "card", known: true };
  if (/\bach\b|bank|wire|eft|transfer|direct deposit|online/.test(s)) return { value: "ach", known: true };
  if (/che?que?|\bchk\b/.test(s)) return { value: "check", known: true };
  if (/cash/.test(s)) return { value: "cash", known: true };
  if (/stock|securit/.test(s)) return { value: "stock", known: true };
  if (/\bdaf\b|donor.?advised|fidelity|schwab|benevity|charitable/.test(s)) return { value: "daf", known: true };
  if (/match/.test(s)) return { value: "matching_gift", known: true };
  return { value: "other", known: false };
}

export type ParsedDonation = {
  rowNo: number;
  name: string;
  email: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  amountCents: number;
  receivedOn: string;
  method: MethodValue;
  receipt: string | null;
  memo: string | null;
  /** Columns with no field: header -> cell (kept as custom data). */
  extras: Record<string, string>;
};

export type RowProblem = { rowNo: number; column: string; level: "error" | "warning"; message: string };

export type ValidationResult = { rows: ParsedDonation[]; problems: RowProblem[]; badRows: Set<number> };

export type ValidateOptions = { dateOrder?: "mdy" | "dmy"; defaultMethod?: MethodValue };

function unwrap<T>(t: Transformed<T>): T | null {
  return t.ok ? t.value : null;
}

/**
 * Check every row by what the column IS: a name is required, an amount must be a positive money value, a
 * date a real date, an email/phone well formed. Bad optional values (an email that is not one) are dropped
 * with a warning, so a typo in a nice-to-have column never blocks the donation; a bad required value stops
 * that row, which is listed so it can be fixed and uploaded again.
 */
export function validateDonations(headers: readonly string[], rows: readonly (readonly string[])[], choices: readonly ColumnChoice[], opts: ValidateOptions = {}): ValidationResult {
  const at = (key: PayerFieldKey) => choices.indexOf(key);
  const idx = Object.fromEntries(PAYER_FIELDS.map((f) => [f.key, at(f.key)])) as Record<PayerFieldKey, number>;
  const out: ParsedDonation[] = [];
  const problems: RowProblem[] = [];
  const badRows = new Set<number>();
  rows.forEach((cells, k) => {
    const rowNo = k + 2; // the file's own row number: row 1 is the header
    const cell = (key: PayerFieldKey) => (idx[key] >= 0 ? cleanText(cells[idx[key]] ?? "") : "");
    const err = (column: string, message: string) => {
      problems.push({ rowNo, column, level: "error", message });
      badRows.add(rowNo);
    };
    const warn = (column: string, message: string) => problems.push({ rowNo, column, level: "warning", message });

    const name = cell("name");
    if (!name) err("Payer name", "is blank");
    const amount = toCents(cell("amount"));
    if (!amount.ok) err("Amount", amount.error);
    const date = toDate(cell("date"), opts.dateOrder ?? "mdy");
    if (!date.ok) err("Date", date.error);

    let email: string | null = null;
    if (cell("email")) {
      email = unwrap(toEmail(cell("email")));
      if (!email) warn("Email", `"${cell("email")}" is not an email address; it was left out`);
    }
    let phone: string | null = null;
    if (cell("phone")) {
      phone = unwrap(toE164(cell("phone")));
      if (!phone) warn("Phone", `"${cell("phone")}" is not a phone number; it was left out`);
    }
    let method: MethodValue = opts.defaultMethod ?? "other";
    if (cell("method")) {
      const m = methodOf(cell("method"));
      method = m.value;
      if (!m.known) warn("Method", `"${cell("method")}" is not a method we know; it is recorded as Other`);
    }
    const extras: Record<string, string> = {};
    choices.forEach((c, i) => {
      if (c === "custom" && cleanText(cells[i] ?? "")) extras[cleanText(headers[i] ?? `Column ${i + 1}`)] = cleanText(cells[i] ?? "");
    });
    if (name && amount.ok && date.ok) {
      out.push({
        rowNo,
        name,
        email,
        phone,
        address1: cell("address1") || null,
        address2: cell("address2") || null,
        city: cell("city") || null,
        state: cell("state") || null,
        zip: cell("zip") || null,
        amountCents: amount.value,
        receivedOn: date.value,
        method,
        receipt: cell("receipt") || null,
        memo: cell("memo") || null,
        extras,
      });
    }
  });
  return { rows: out, problems, badRows };
}

export function toPayerInputs(rows: readonly ParsedDonation[]): PayerInput[] {
  return rows.map((r) => ({ rowNo: r.rowNo, name: r.name, email: r.email, phone: r.phone, address1: r.address1, address2: r.address2, zip: r.zip }));
}

export const householdLegacyId = (g: Group): string => `ONB-H-${String(g.id + 1).padStart(5, "0")}`;

export type TableFile = { headers: string[]; rows: string[][] };

const dollars = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** One row per household: the address from the first row that has one, every name it paid under kept as custom data. */
export function buildHouseholdFile(groups: readonly Group[], rows: readonly ParsedDonation[]): TableFile {
  const byRow = new Map(rows.map((r) => [r.rowNo, r]));
  const headers = ["Household ID (old system)", "Household name", "Address", "Address line 2", "City", "State", "ZIP", "Also paid as"];
  const out = groups.map((g) => {
    const members = g.rows.map((n) => byRow.get(n)).filter((r): r is ParsedDonation => !!r);
    const withAddr = members.find((m) => m.address1) ?? null;
    return [householdLegacyId(g), g.displayName, withAddr?.address1 ?? "", withAddr?.address2 ?? "", withAddr?.city ?? "", withAddr?.state ?? "", withAddr?.zip ?? "", g.names.join("; ")];
  });
  return { headers, rows: out };
}

/** One row per donation, linked to its household, plus the file's extra columns as custom data. */
export function buildPaymentFile(groups: readonly Group[], rows: readonly ParsedDonation[]): TableFile {
  const groupOfRow = new Map<number, Group>();
  groups.forEach((g) => g.rows.forEach((n) => groupOfRow.set(n, g)));
  const extraHeaders = [...new Set(rows.flatMap((r) => Object.keys(r.extras)))];
  const headers = ["Payment number (old system)", "Household ID (old system)", "Amount", "Method", "Received on", "Receipt number", "Memo", ...extraHeaders];
  const used = new Set<string>();
  const out: string[][] = [];
  for (const r of rows) {
    const g = groupOfRow.get(r.rowNo);
    if (!g) continue;
    // The payment's own number: the receipt number when the file has one (unique), else the row.
    let id = r.receipt ? `ONB-R-${r.receipt}` : `ONB-P-${String(r.rowNo).padStart(6, "0")}`;
    if (used.has(id)) id = `${id}-${r.rowNo}`;
    used.add(id);
    out.push([id, householdLegacyId(g), dollars(r.amountCents), r.method, r.receivedOn, r.receipt ?? "", r.memo ?? "", ...extraHeaders.map((h) => r.extras[h] ?? "")]);
  }
  return { headers, rows: out };
}
