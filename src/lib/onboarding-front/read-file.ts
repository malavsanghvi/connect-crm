// Reads what the front door's recogniser needs from a file, in the browser: its name, type and size and, for CSV and
// Excel, the heading row and how many rows there are. The file is never uploaded; nothing from a row is kept.

import { parseCsv } from "@/lib/csv";

import { fileKindOf, findHeaderRow, isExcel, looksTabSeparated, rowsUnder, splitTabs, type FileFacts } from "./recognise";

/** Larger files are not opened here (the browser would hold all of it in memory to count the rows). */
export const MAX_READ_BYTES = 30 * 1024 * 1024;

export type ReadResult = { ok: true; facts: FileFacts } | { ok: false; facts: FileFacts; error: string };

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v);
}

function why(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/password|encrypt/i.test(m)) return "it is protected by a password";
  if (/look like|zip|corrupt|invalid|end of data|signature/i.test(m)) return "it looks damaged, or it is not really the kind of file its name says";
  return m.trim() ? m.trim().slice(0, 160) : "the browser could not open it";
}

export async function readFileFacts(file: File): Promise<ReadResult> {
  const facts: FileFacts = { name: file.name, type: file.type, size: file.size, headers: null, rows: null, sheets: null };
  if (fileKindOf(file.name, file.type) !== "spreadsheet") return { ok: true, facts };
  if (file.size > MAX_READ_BYTES) {
    return { ok: false, facts, error: `it is larger than ${MAX_READ_BYTES / (1024 * 1024)} MB, too large to look at in the browser` };
  }
  try {
    if (isExcel(file.name)) {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = await readXlsxFile(file, { parseNumber: (s: string) => s });
      let headers: string[] | null = null;
      let rows = 0;
      for (const sh of sheets) {
        const table = sh.data.map((r) => r.map(cellText));
        const at = findHeaderRow(table);
        if (at < 0) continue;
        if (headers === null) headers = table[at]!;
        rows += rowsUnder(table, at);
      }
      return { ok: true, facts: { ...facts, headers: headers ?? [], rows, sheets: sheets.length } };
    }
    const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
    const table = looksTabSeparated(text) ? splitTabs(text) : parseCsv(text);
    const at = findHeaderRow(table);
    return { ok: true, facts: { ...facts, headers: at < 0 ? [] : table[at]!, rows: rowsUnder(table, at), sheets: 1 } };
  } catch (e) {
    return { ok: false, facts, error: why(e) };
  }
}
