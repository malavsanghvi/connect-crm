// The READ of "Your own files, read by Niva" (board 2c of docs/handoff/prototypes/onboarding-data/Files.dc.html): for one
// dropped spreadsheet, which sheet holds the records, which row holds the headings, which sheets have the same columns (one
// tab per year), which are small lookup tables, which hold nothing, and which rows are totals. Pure: the browser reads the
// file (read-tables.ts) and nothing leaves it.
//
// Built for every organization: headings are compared in any script (normHeading), and a total row is recognised in the
// languages spreadsheets are most often kept in.

import { findHeaderRow, normHeading } from "./recognise";

export type RawSheet = { name: string; rows: readonly (readonly string[])[] };
export type RawWorkbook = { fileName: string; size: number; sheets: readonly RawSheet[] };

/** records: the sheet loaded · same_columns: added to it · lookup: a small table of codes · other_table: left out · empty. */
export type SheetRole = "records" | "same_columns" | "lookup" | "other_table" | "empty";

export type SheetFinding = {
  name: string;
  role: SheetRole;
  /** The heading row, counted from 1 as a spreadsheet shows it; null when the sheet has no table. */
  headerRow: number | null;
  headers: string[];
  /** Data rows: blank rows and total rows left out. */
  rows: string[][];
  totals: number;
};

export type FileReading = {
  fileName: string;
  size: number;
  sheets: SheetFinding[];
  /** The sheet whose records are loaded; -1 when there is none. */
  main: number;
  headers: string[];
  /** The main sheet's rows and those of the sheets with the same columns, in order. */
  rows: string[][];
  headerRow: number | null;
  /** Total rows left out of the main sheet and the sheets added to it. */
  totals: number;
  /** Names of the sheets added to the main one. */
  stacked: string[];
  /** Columns of the main sheet with nothing in them. */
  emptyColumns: number;
};

const text = (v: unknown) => String(v ?? "").trim();
const filled = (row: readonly unknown[]) => row.some((c) => text(c) !== "");

const TOTAL_WORDS = /^(grand\s+|sub-?)?totals?\b|^(gesamt|summe|somme|suma|totaal|totale)\b/i;

/** A row that adds up other rows: its first filled cell starts with "Total", "Subtotal", "Grand total" (or Summe, Somme …). */
export function isTotalRow(row: readonly unknown[]): boolean {
  const first = row.map(text).find((c) => c !== "");
  return first !== undefined && TOTAL_WORDS.test(first);
}

function readSheet(s: RawSheet): Omit<SheetFinding, "role"> {
  const table = s.rows.map((r) => r.map(text));
  const at = findHeaderRow(table);
  if (at < 0) return { name: s.name, headerRow: null, headers: [], rows: [], totals: 0 };
  const headers = table[at]!;
  let totals = 0;
  const rows: string[][] = [];
  for (const r of table.slice(at + 1)) {
    if (!filled(r)) continue;
    if (isTotalRow(r)) {
      totals += 1;
      continue;
    }
    rows.push(headers.map((_, i) => r[i] ?? ""));
  }
  return { name: s.name, headerRow: at + 1, headers, rows, totals };
}

const headingSet = (h: readonly string[]) => new Set(h.map(normHeading).filter((x) => x !== ""));

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  const x = headingSet(a);
  const y = headingSet(b);
  return x.size > 0 && x.size === y.size && [...x].every((h) => y.has(h));
}

export function readWorkbook(book: RawWorkbook): FileReading {
  const read = book.sheets.map(readSheet);
  const usable = read.map((s, i) => ({ s, i })).filter(({ s }) => s.headerRow !== null && s.rows.length > 0);
  // The records: the sheet with the most rows among those with two or more headings (a list of codes is narrower).
  const wide = usable.filter(({ s }) => s.headers.filter((h) => h !== "").length >= 2);
  const pick = (wide.length > 0 ? wide : usable).reduce<{ s: (typeof read)[number]; i: number } | null>((best, x) => (!best || x.s.rows.length > best.s.rows.length ? x : best), null);
  const main = pick?.i ?? -1;
  const mainHeaders = main >= 0 ? read[main]!.headers : [];

  const sheets: SheetFinding[] = read.map((s, i) => {
    let role: SheetRole;
    if (i === main) role = "records";
    else if (s.headerRow === null || s.rows.length === 0) role = "empty";
    else if (sameColumns(s.headers, mainHeaders)) role = "same_columns";
    else if (s.headers.filter((h) => h !== "").length <= 3 && s.rows.length <= 50) role = "lookup";
    else role = "other_table";
    return { ...s, role };
  });

  const loaded = sheets.filter((s) => s.role === "records" || s.role === "same_columns");
  const order = (h: string) => mainHeaders.map(normHeading).indexOf(normHeading(h));
  const rows: string[][] = [];
  for (const s of loaded) {
    if (s.role === "records") rows.push(...s.rows);
    else {
      // The same columns, perhaps in another order: put each cell under the main sheet's heading.
      const at = s.headers.map(order);
      for (const r of s.rows) {
        const out = mainHeaders.map(() => "");
        at.forEach((j, k) => {
          if (j >= 0) out[j] = r[k] ?? "";
        });
        rows.push(out);
      }
    }
  }
  const emptyColumns = mainHeaders.filter((h, i) => h !== "" && rows.every((r) => text(r[i]) === "")).length;
  return {
    fileName: book.fileName,
    size: book.size,
    sheets,
    main,
    headers: mainHeaders,
    rows,
    headerRow: main >= 0 ? read[main]!.headerRow : null,
    totals: loaded.reduce((n, s) => n + s.totals, 0),
    stacked: sheets.filter((s) => s.role === "same_columns").map((s) => s.name),
    emptyColumns,
  };
}
