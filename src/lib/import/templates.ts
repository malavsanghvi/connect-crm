// Templates and the column dictionary for each data type, plus the
// problem-rows file. Pure: the route handlers turn these into CSV or XLSX.

import type { EntityDef, FieldDef } from "@/lib/import/registry";
import type { Problem, StagedRow } from "@/lib/import/mapping";

/** One CSV cell, quoted when it needs to be. Formula-looking text is prefixed so spreadsheets never run it. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const TYPE_WORDS: Record<FieldDef["type"], string> = {
  id: "Identifier (text; leading zeros kept)",
  text: "Text",
  longtext: "Text",
  name: "Name",
  fullname: "Full name",
  email: "Email address",
  phone: "Phone number",
  date: "Date",
  datetime: "Date and time",
  time: "Time",
  money: "Amount in dollars",
  integer: "Whole number",
  number: "Number",
  boolean: "Yes or no",
  enum: "One of the allowed values",
  list: "List, separated by semicolons",
  ref: "Link to another record",
};

/** Template header row: the field labels (auto-mapping reads them back). */
export function templateHeader(e: EntityDef): string[] {
  return e.fields.map((f) => f.label);
}

export function templateExample(e: EntityDef): string[] {
  return e.fields.map((f) => f.example);
}

export type DictionaryRow = { column: string; required: string; type: string; description: string; example: string; allowed: string };

export function dictionary(e: EntityDef): DictionaryRow[] {
  return e.fields.map((f) => ({
    column: f.label,
    required: f.required ? "Required" : "Optional",
    type: TYPE_WORDS[f.type],
    description: f.description,
    example: f.example,
    allowed: f.options ? f.options.map((o) => o.label).join("; ") : "",
  }));
}

export function templateCsv(e: EntityDef): string {
  return toCsv([templateHeader(e), templateExample(e)]);
}

export function dictionaryCsv(e: EntityDef): string {
  const d = dictionary(e);
  return toCsv([
    ["Column", "Required", "Type", "What it is", "Example", "Allowed values"],
    ...d.map((r) => [r.column, r.required, r.type, r.description, r.example, r.allowed]),
    [],
    ["Any other column", "Optional", "Kept as a custom field", "Columns with no matching field are kept as custom fields on the record (staff-only until reviewed).", "", ""],
  ]);
}

/** Download of the rows that need fixing: the original row, then what is wrong with it. */
export function problemRowsCsv(headers: readonly string[], rows: readonly Pick<StagedRow, "row_no" | "raw" | "problems">[]): string {
  const out: unknown[][] = [["Row", ...headers, "Problems"]];
  for (const r of rows) {
    if (r.problems.length === 0) continue;
    out.push([r.row_no, ...headers.map((h) => r.raw[h] ?? ""), describeProblems(r.problems)]);
  }
  return toCsv(out);
}

export function describeProblems(problems: readonly Problem[]): string {
  return problems.map((p) => `${p.level === "error" ? "Error" : "Warning"}: ${p.message}`).join(" | ");
}
