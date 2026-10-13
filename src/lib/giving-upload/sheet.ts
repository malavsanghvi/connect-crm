// Giving uploads (GV-U): what every upload shares, whatever it records. Pure: the browser, the server, the dev preview and the
// tests read a file the same way. The file itself never leaves the browser; only its rows (at most MAX_UPLOAD_ROWS) are sent.
//
// Built for every community: amounts in the community's own currency (integer minor units underneath), its symbol or code
// accepted, a comma for the decimals where the community writes money that way, and dates in the community's own order
// (day first in most of the world, month first in the United States). An ISO date (2026-10-13) is always understood.

import { normHeading } from "@/lib/onboarding-front/recognise";
import { toDate, type DateOrder } from "@/lib/import/transforms";
import { addDays, daysBetween } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";

/** At most this many rows per file: one confirmation, one database call, all or nothing. */
export const MAX_UPLOAD_ROWS = 500;
/** Files larger than this are not opened in the browser. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Dates are within ten years of today (the database's own limit). */
export const WITHIN_DAYS = 3653;

export type UploadSource = "csv" | "xlsx";

/** A file read into text cells: the heading row and the data rows under it, with each data row's line number in the file. */
export type UploadTable = { fileName: string; source: UploadSource; headers: string[]; rows: { line: number; cells: string[] }[] };

/** How this community writes money and dates. */
export type Conventions = { currency: string; locale: string; dateOrder: DateOrder; decimal: "." | "," };

/** The community's conventions from its money format ("en-US" month first and a dot; "en-GB" day first; "en-DE" a decimal comma). */
export function conventionsFor(fmt: { currency: string; locale: string }): Conventions {
  let dateOrder: DateOrder = "dmy";
  let decimal: "." | "," = ".";
  try {
    const parts = new Intl.DateTimeFormat(fmt.locale, { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).formatToParts(
      new Date(Date.UTC(2026, 11, 31)),
    );
    const month = parts.findIndex((p) => p.type === "month");
    const day = parts.findIndex((p) => p.type === "day");
    if (month >= 0 && day >= 0 && month < day) dateOrder = "mdy";
  } catch {
    // An unknown locale: day first, as most of the world writes it.
  }
  try {
    const dec = new Intl.NumberFormat(fmt.locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value;
    if (dec === ",") decimal = ",";
  } catch {
    // An unknown locale: a dot.
  }
  return { currency: fmt.currency.toUpperCase(), locale: fmt.locale, dateOrder, decimal };
}

/** "31/12/2026" for a community that writes the day first; "12/31/2026" for one that writes the month first. */
export function dateExample(conv: Pick<Conventions, "dateOrder">): string {
  return conv.dateOrder === "mdy" ? "12/31/2026" : "31/12/2026";
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * An amount in minor units. Accepts the community's currency symbol or code ("$1,250.50", "EUR 80", "₹1,25,000"), and where the
 * community writes a decimal comma, "1.250,50". A spreadsheet cell's number is always written with a dot.
 */
export function readAmount(text: string, conv: Conventions, source: UploadSource): Read<number> {
  let s = text.trim();
  if (!s) return { ok: false, error: "is empty" };
  const code = conv.currency.toUpperCase();
  s = s.replace(new RegExp(`^${code}\\s*|\\s*${code}$`, "i"), "").replace(/\s+/g, "");
  if (conv.decimal === "," && source === "csv") {
    // "1.250,50" or "1250,5": the comma is the decimal point and dots group the thousands. "1.250" alone is one thousand two hundred
    // and fifty here.
    if (/,\d{1,2}$/.test(s) || /^\D*\d{1,3}(\.\d{3})+\D*$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  }
  const cents = parseAmountToCents(s);
  if (cents === null) return { ok: false, error: `“${text.trim()}” is not an amount` };
  if (cents <= 0) return { ok: false, error: "must be more than zero" };
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_000) return { ok: false, error: "is too large" };
  return { ok: true, value: cents };
}

/** A date (YYYY-MM-DD) in the community's order, an ISO date, or a spreadsheet's date cell. */
export function readDate(text: string, conv: Pick<Conventions, "dateOrder">): Read<string> {
  const s = text.trim();
  if (!s) return { ok: false, error: "is empty" };
  const r = toDate(s, conv.dateOrder);
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: `“${s}” is not a date (write it like ${dateExample(conv)})` };
}

/** Whether a date is within ten years of today. */
export function withinTenYears(date: string, today: string): boolean {
  return Math.abs(daysBetween(today, date)) <= WITHIN_DAYS;
}

export { addDays };

// ---------------------------------------------------------------------------------------------------------------------- Columns

export type ColumnSpec<K extends string> = {
  key: K;
  /** The heading in the template. */
  header: string;
  required: boolean;
  /** Other headings that mean this column (compared without case, spaces or punctuation). */
  synonyms: readonly string[];
  /** What goes in it, for the template's second sheet and the page. */
  help: string;
};

export type ColumnMap<K extends string> = {
  /** The index of each column found. */
  at: Partial<Record<K, number>>;
  /** Headings nothing here reads (they are left alone). */
  ignored: string[];
  /** Required columns the file does not have. */
  missing: K[];
};

/** Which heading is which column: its own heading first, then the synonyms, each heading used once. */
export function mapColumns<K extends string>(headers: readonly string[], specs: readonly ColumnSpec<K>[]): ColumnMap<K> {
  const norm = headers.map((h) => normHeading(h ?? ""));
  const at: Partial<Record<K, number>> = {};
  const used = new Set<number>();
  const take = (spec: ColumnSpec<K>, names: readonly string[]) => {
    if (at[spec.key] !== undefined) return;
    for (const name of names) {
      const i = norm.findIndex((h, idx) => !used.has(idx) && h !== "" && h === normHeading(name));
      if (i >= 0) {
        at[spec.key] = i;
        used.add(i);
        return;
      }
    }
  };
  for (const spec of specs) take(spec, [spec.header]);
  for (const spec of specs) take(spec, spec.synonyms);
  const ignored = headers.filter((h, i) => !used.has(i) && (h ?? "").trim() !== "");
  const missing = specs.filter((s) => s.required && at[s.key] === undefined).map((s) => s.key);
  return { at, ignored, missing };
}

/** The cell of a column in a row ("" when the file has no such column). */
export function cell<K extends string>(cells: readonly string[], map: ColumnMap<K>, key: K): string {
  const i = map.at[key];
  return i === undefined ? "" : (cells[i] ?? "").trim();
}

// ---------------------------------------------------------------------------------------------------------------------- Tables

const filled = (row: readonly string[]) => row.filter((c) => c.trim() !== "").length;

/**
 * The heading row and the data rows of a sheet's cells: the heading is the first row at least half as full as the widest of the first
 * fifteen (a title line above the table is skipped); blank rows are left out; each data row keeps its line number in the file.
 */
export function tableFromCells(fileName: string, source: UploadSource, cells: readonly (readonly string[])[]): Read<UploadTable> {
  const top = cells.slice(0, 15);
  const widest = Math.max(0, ...top.map((r) => filled(r.map(String))));
  if (widest === 0) return { ok: false, error: "The file is empty." };
  const need = widest <= 1 ? 1 : Math.max(2, Math.ceil(widest / 2));
  const at = top.findIndex((r) => filled(r.map(String)) >= need);
  const headers = (cells[at] ?? []).map((c) => String(c ?? "").replace(/^﻿/, "").trim());
  const rows: UploadTable["rows"] = [];
  for (let i = at + 1; i < cells.length; i++) {
    const r = (cells[i] ?? []).map((c) => String(c ?? "").trim());
    if (filled(r) === 0) continue;
    rows.push({ line: i + 1, cells: r });
  }
  if (rows.length === 0) return { ok: false, error: "The file has headings but no rows under them." };
  if (rows.length > MAX_UPLOAD_ROWS) {
    return { ok: false, error: `The file has ${rows.length} rows; an upload holds at most ${MAX_UPLOAD_ROWS}. Split it and upload each part.` };
  }
  return { ok: true, value: { fileName, source, headers, rows } };
}

/** The confirmation of one upload: made once when the person reaches the review, so recording twice records once. */
export function newUploadKey(prefix: string): string {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return `${prefix}-${c.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function isUploadKey(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9:_-]{8,120}$/.test(v);
}

export function isSha256(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

/** "1 row" / "18 rows". */
export function rowsWord(n: number, one = "row", many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
