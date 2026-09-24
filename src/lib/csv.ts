import { parseAmountToCents } from "@/lib/money";

// ---------------------------------------------------------------------------
// Minimal RFC 4180 CSV reader: quoted fields, "" escapes, commas and newlines
// inside quotes, CRLF/LF, BOM. Blank lines are dropped.
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0].trim() === "")) rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      pushRow();
      i += src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Bank statements
// ---------------------------------------------------------------------------
export type StatementFormat = "chase_csv" | "generic_csv";

export type ParsedBankLine = {
  /** 1-based row number in the file (the header is row 1 when present). */
  row: number;
  posted_on: string;
  amount_cents: number;
  description: string;
  /** Chase "Type" (QUICKPAY_CREDIT, CHECK_DEPOSIT, …). */
  bank_type: string | null;
  /** Chase "Details" (CREDIT, DEBIT, CHECK, DSLIP). */
  bank_details: string | null;
  /** Chase "Check or Slip #". */
  check_or_slip: string | null;
  /** The original CSV row, keyed by header. */
  raw: Record<string, string>;
};

export type BankCsvParse = {
  format: StatementFormat;
  rows: ParsedBankLine[];
  errors: { row: number; message: string }[];
  /** Money-out (and zero) lines left out because debits were not requested. */
  skippedDebits: number;
  periodStart: string | null;
  periodEnd: string | null;
};

/** Chase checking CSV header, as exported. */
export const CHASE_HEADER = ["details", "posting date", "description", "amount", "type", "balance", "check or slip #"];

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Chase checking export is recognised by its header row. */
export function detectStatementFormat(header: string[]): StatementFormat {
  const h = header.map(norm);
  const required = ["details", "posting date", "description", "amount", "type"];
  return required.every((k) => h.includes(k)) ? "chase_csv" : "generic_csv";
}

/** "2026-09-14", "09/14/2026", "9/14/26" → "2026-09-14"; null when not a real date. */
export function parseStatementDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    m = Number(match[1]);
    d = Number(match[2]);
    y = Number(match[3]);
    if (match[3].length === 2) y += 2000;
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const GENERIC_ALIASES: Record<"date" | "amount" | "description" | "credit" | "debit", string[]> = {
  date: ["date", "posting date", "posted date", "posted on", "post date", "transaction date", "trans date", "posted"],
  amount: ["amount", "amt", "transaction amount"],
  description: ["description", "memo", "payee", "narrative", "transaction description", "details"],
  credit: ["credit", "credits", "deposit", "deposits", "money in"],
  debit: ["debit", "debits", "withdrawal", "withdrawals", "money out"],
};

function findColumn(header: string[], names: string[]): number {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function rawRecord(header: string[] | null, cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const names = header ?? ["date", "amount", "description"];
  cells.forEach((value, i) => {
    const key = names[i]?.trim() || `column_${i + 1}`;
    // Chase rows usually end with a stray trailing comma: drop empty extras.
    if (i >= names.length && value.trim() === "") return;
    out[key] = value;
  });
  return out;
}

/**
 * Parse a bank statement CSV. Chase's checking export is the primary format
 * (detected from its header); anything else is read as a generic
 * date, amount, description file (with or without a header row).
 * Only money in (amount > 0) is returned unless `includeDebits` is set.
 */
export function parseBankStatementCsv(text: string, options: { includeDebits?: boolean } = {}): BankCsvParse {
  const includeDebits = options.includeDebits ?? false;
  const records = parseCsv(text);
  const result: BankCsvParse = {
    format: "generic_csv",
    rows: [],
    errors: [],
    skippedDebits: 0,
    periodStart: null,
    periodEnd: null,
  };
  if (records.length === 0) {
    result.errors.push({ row: 0, message: "The file is empty." });
    return result;
  }

  const first = records[0];
  const format = detectStatementFormat(first);
  result.format = format;

  let header: string[] | null = null;
  let col = { date: 0, amount: 1, description: 2, credit: -1, debit: -1, type: -1, details: -1, check: -1 };

  if (format === "chase_csv") {
    header = first.map((h) => h.trim());
    col = {
      date: findColumn(first, ["posting date"]),
      amount: findColumn(first, ["amount"]),
      description: findColumn(first, ["description"]),
      credit: -1,
      debit: -1,
      type: findColumn(first, ["type"]),
      details: findColumn(first, ["details"]),
      check: findColumn(first, ["check or slip #", "check or slip"]),
    };
  } else if (parseStatementDate(first[0] ?? "") === null) {
    // Header row present: map columns by name.
    header = first.map((h) => h.trim());
    col = {
      date: findColumn(first, GENERIC_ALIASES.date),
      amount: findColumn(first, GENERIC_ALIASES.amount),
      description: findColumn(first, GENERIC_ALIASES.description),
      credit: findColumn(first, GENERIC_ALIASES.credit),
      debit: findColumn(first, GENERIC_ALIASES.debit),
      type: -1,
      details: -1,
      check: findColumn(first, ["check number", "check #", "check no", "check or slip #"]),
    };
    const missing: string[] = [];
    if (col.date < 0) missing.push("date");
    if (col.amount < 0 && col.credit < 0) missing.push("amount");
    if (col.description < 0) missing.push("description");
    if (missing.length > 0) {
      result.errors.push({
        row: 1,
        message: `The header row has no ${missing.join(", ")} column. Expected a Chase export or columns named date, amount, description.`,
      });
      return result;
    }
  }

  const dataStart = header ? 1 : 0;
  for (let r = dataStart; r < records.length; r++) {
    const cells = records[r];
    const rowNo = r + 1;
    const cell = (i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : "");
    const dateText = cell(col.date);
    const posted = parseStatementDate(dateText);
    if (!posted) {
      result.errors.push({ row: rowNo, message: `"${dateText || "(blank)"}" is not a date.` });
      continue;
    }
    let amount: number | null;
    if (col.amount >= 0 && cell(col.amount) !== "") {
      amount = parseAmountToCents(cell(col.amount));
    } else if (col.credit >= 0 || col.debit >= 0) {
      const credit = cell(col.credit) ? parseAmountToCents(cell(col.credit)) : 0;
      const debit = cell(col.debit) ? parseAmountToCents(cell(col.debit)) : 0;
      amount = credit === null || debit === null ? null : Math.abs(credit) - Math.abs(debit);
    } else {
      amount = null;
    }
    if (amount === null) {
      const shown = col.amount >= 0 ? cell(col.amount) : `${cell(col.credit)}/${cell(col.debit)}`;
      result.errors.push({ row: rowNo, message: `"${shown || "(blank)"}" is not an amount.` });
      continue;
    }
    const description = cell(col.description).replace(/\s+/g, " ");
    if (!description) {
      result.errors.push({ row: rowNo, message: "The description is blank." });
      continue;
    }
    if (amount <= 0 && !includeDebits) {
      result.skippedDebits += 1;
      continue;
    }
    if (amount === 0) {
      result.skippedDebits += 1;
      continue;
    }
    result.rows.push({
      row: rowNo,
      posted_on: posted,
      amount_cents: amount,
      description,
      bank_type: format === "chase_csv" ? cell(col.type) || null : null,
      bank_details: format === "chase_csv" ? cell(col.details) || null : null,
      check_or_slip: cell(col.check) || null,
      raw: rawRecord(header, cells),
    });
    if (!result.periodStart || posted < result.periodStart) result.periodStart = posted;
    if (!result.periodEnd || posted > result.periodEnd) result.periodEnd = posted;
  }
  return result;
}
