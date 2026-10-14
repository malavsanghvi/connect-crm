// Giving uploads: read a chosen file in the browser into text cells (CSV, tab-separated text or Excel .xlsx). The file is never
// uploaded: its rows are sent to be checked, and its SHA-256 fingerprint is kept so that the same file uploaded twice is noticed.

import { parseCsv } from "@/lib/csv";
import { fileKindOf, isExcel, looksTabSeparated, splitTabs } from "@/lib/onboarding-front/recognise";

import { MAX_UPLOAD_BYTES, tableFromCells, type UploadTable } from "./sheet";

export type ReadUpload = { ok: true; table: UploadTable; sha256: string | null } | { ok: false; error: string };

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v);
}

async function fingerprint(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const hash = await subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function why(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/password|encrypt/i.test(m)) return "it is protected by a password";
  if (/zip|corrupt|invalid|end of data|signature/i.test(m)) return "it looks damaged, or it is not really the kind of file its name says";
  return "the browser could not open it";
}

export async function readUploadFile(file: File): Promise<ReadUpload> {
  const kind = fileKindOf(file.name, file.type);
  if (kind === "old_excel") return { ok: false, error: "This is an old Excel file (.xls). Save it as .xlsx or .csv in Excel, then choose it again." };
  if (kind !== "spreadsheet") return { ok: false, error: "Choose a spreadsheet: a .csv or an Excel .xlsx file." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `The file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Split it, then upload each part.` };
  try {
    const buffer = await file.arrayBuffer();
    const sha256 = await fingerprint(buffer);
    let cells: string[][];
    let source: UploadTable["source"];
    if (isExcel(file.name)) {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = await readXlsxFile(file, { parseNumber: (s: string) => s });
      const first = sheets.find((sh) => sh.data.some((r) => r.some((c) => cellText(c).trim() !== "")));
      cells = (first?.data ?? []).map((r) => r.map(cellText));
      source = "xlsx";
    } else {
      const text = new TextDecoder("utf-8").decode(buffer);
      cells = looksTabSeparated(text) ? splitTabs(text) : parseCsv(text);
      source = "csv";
    }
    const t = tableFromCells(file.name, source, cells);
    return t.ok ? { ok: true, table: t.value, sha256 } : { ok: false, error: t.error };
  } catch (e) {
    console.error("[giving upload] the file could not be read:", e);
    return { ok: false, error: `Could not read the file: ${why(e)}. Choose it again, or save it as .csv first.` };
  }
}
