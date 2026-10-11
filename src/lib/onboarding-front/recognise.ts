// The front door's file recogniser (docs/ONBOARDING_REDESIGN.md "The front door"): from what the browser can see of a
// file — its name, type and size and, for a spreadsheet, its heading row and how many rows it has — say what it most
// likely is and where it can go. Pure: no I/O, no network. In this version the file never leaves the browser; only the
// headings and the counts are kept, never a value from a row.
//
// Built for every organization: the known exports are systems any organization may use (Neon, QuickBooks, Zeffy,
// PayPal, Google Contacts, a bank's statement), and headings are compared in any script (letters and digits of every
// language are kept when a heading is normalised).

export type SourceKey = "neon" | "quickbooks" | "zeffy" | "paypal" | "google_contacts" | "bank";

/** What the browser could see of one file. */
export type FileFacts = {
  name: string;
  /** The browser's MIME type; often "" for a CSV. */
  type: string;
  /** Bytes. */
  size: number;
  /** The heading row (first sheet), for CSV and Excel; null for anything else. */
  headers: readonly string[] | null;
  /** Data rows under the headings (every sheet), null when not counted. */
  rows: number | null;
  /** Sheets in a workbook (1 for a CSV), null for anything else. */
  sheets: number | null;
};

export type FileKind = "spreadsheet" | "old_excel" | "photo" | "pdf" | "other";

export type RecognitionKind = "template" | "known_source" | "spreadsheet" | "photo" | "pdf" | "old_excel" | "empty" | "unreadable" | "unsupported";

/** Where the file can go from here: Guided onboarding, Data import, bank matching, nowhere yet (coming next) or nowhere. */
export type Goes = "guided" | "data_import" | "bank" | "coming_next" | "none";

export type Tone = "blue" | "green" | "sun" | "grey" | "danger";

export type Recognition = {
  kind: RecognitionKind;
  source: SourceKey | null;
  templateKey: string | null;
  /** Non-empty headings. */
  columns: number;
  /** Headings Weaver already knows. */
  known: number;
  rows: number | null;
  sheets: number | null;
  /** "1,240 rows · 41 columns", "Photo · 1.2 MB". */
  sizeLine: string;
  /** "Known source", "Weaver template", "Your own spreadsheet" … */
  tag: string;
  tone: Tone;
  /** "Looks like a Neon CRM export: 1,240 rows, 6 columns we know." */
  sentence: string;
  /** What can happen next, in one sentence. */
  next: string;
  goes: Goes;
};

/** A file the drop zone has looked at, as its list shows it. */
export type DroppedFile = { id: string; name: string; rec: Recognition };

/** A Weaver template's headings (Guided onboarding's members and past-donations templates). */
export type TemplateSignature = { key: string; label: string; headers: readonly string[] };

export type RecogniseContext = {
  templates: readonly TemplateSignature[];
  /** Headings Weaver can already place (Guided onboarding's fields and their other names). */
  knownHeadings: readonly string[];
};

// ---------------------------------------------------------------------------
// Small words
// ---------------------------------------------------------------------------

const NUM = new Intl.NumberFormat("en-US");

export function count(n: number): string {
  return NUM.format(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return plural(n, "byte");
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A heading reduced to its letters and digits, lower case, in any script ("E-mail 1 - Value" → "email1value"). */
export function normHeading(h: string): string {
  return h
    .replace(/^﻿/, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const EXT = (name: string) => (/\.([a-z0-9]+)$/i.exec(name.trim())?.[1] ?? "").toLowerCase();

const SHEET_EXT = new Set(["csv", "tsv", "txt", "xlsx", "xlsm"]);
const PHOTO_EXT = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tif", "tiff", "bmp"]);

export function fileKindOf(name: string, type: string): FileKind {
  const ext = EXT(name);
  if (ext === "xls") return "old_excel";
  if (SHEET_EXT.has(ext)) return "spreadsheet";
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (PHOTO_EXT.has(ext) || type.startsWith("image/")) return "photo";
  if (type === "text/csv") return "spreadsheet";
  return "other";
}

/** Whether the browser reads the file as Excel (true) or as text (false). */
export function isExcel(name: string): boolean {
  const ext = EXT(name);
  return ext === "xlsx" || ext === "xlsm";
}

// ---------------------------------------------------------------------------
// Tables: which row holds the headings, and splitting tab-separated text
// ---------------------------------------------------------------------------

const filled = (row: readonly unknown[]) => row.filter((c) => String(c ?? "").trim() !== "").length;

/**
 * The heading row among the first rows of a sheet. Reports (QuickBooks puts the company, the report's name and the dates
 * above the table) start with rows of one cell: the headings are the first row at least half as full as the widest one.
 */
export function findHeaderRow(rows: readonly (readonly unknown[])[], look = 15): number {
  const top = rows.slice(0, look);
  const widest = Math.max(0, ...top.map(filled));
  if (widest === 0) return -1;
  const need = widest <= 1 ? 1 : Math.max(2, Math.ceil(widest / 2));
  const at = top.findIndex((r) => filled(r) >= need);
  return at;
}

/** Data rows under the heading row (blank rows are not counted). */
export function rowsUnder(rows: readonly (readonly unknown[])[], header: number): number {
  if (header < 0) return 0;
  return rows.slice(header + 1).filter((r) => filled(r) > 0).length;
}

/** Text that is tab-separated rather than comma-separated (a .tsv, or a .txt saved from a spreadsheet). */
export function looksTabSeparated(text: string): boolean {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return (first.match(/\t/g) ?? []).length > (first.match(/,/g) ?? []).length;
}

export function splitTabs(text: string): string[][] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t"));
}

// ---------------------------------------------------------------------------
// The known exports
// ---------------------------------------------------------------------------

type SourceDef = {
  key: SourceKey;
  /** "a Neon CRM export" */
  name: string;
  goes: Goes;
  /** Headings of this export Weaver has a place for (normalised; a trailing * matches the start). */
  columns: readonly string[];
  test: (h: ReadonlySet<string>) => boolean;
};

const hasAny = (h: ReadonlySet<string>, keys: readonly string[]) => keys.some((k) => h.has(k));
const countOf = (h: ReadonlySet<string>, keys: readonly string[]) => keys.filter((k) => h.has(k)).length;
const startsAny = (h: ReadonlySet<string>, prefix: string) => [...h].some((k) => k.startsWith(prefix));

/** Most specific first: a PayPal download has a Balance column too, so it is tested before a bank statement. */
const SOURCES: readonly SourceDef[] = [
  {
    key: "zeffy",
    name: "a Zeffy export",
    goes: "guided",
    columns: ["firstname", "lastname", "email", "totalamount", "paymentdate*", "campaigntitle", "formtitle", "address", "city", "postalcode", "country", "companyname"],
    test: (h) => startsAny(h, "zeffy") || (hasAny(h, ["campaigntitle", "formtitle"]) && (h.has("totalamount") || startsAny(h, "paymentdate"))),
  },
  {
    key: "paypal",
    name: "a PayPal export",
    goes: "guided",
    columns: ["date", "name", "gross", "net", "fee", "currency", "fromemailaddress", "transactionid", "note", "subject"],
    test: (h) =>
      h.has("gross") && h.has("net") && countOf(h, ["fee", "transactionid", "fromemailaddress", "toemailaddress", "balanceimpact", "timezone", "referencetxnid", "receiptid", "currency"]) >= 2,
  },
  {
    key: "google_contacts",
    name: "a Google Contacts export",
    goes: "guided",
    columns: ["name", "givenname", "familyname", "firstname", "lastname", "email1value", "phone1value", "address1formatted", "address1street", "address1city", "address1region", "address1postalcode"],
    test: (h) =>
      hasAny(h, ["email1value", "phone1value", "groupmembership", "yominame", "phoneticfirstname"]) &&
      countOf(h, ["email1value", "email1type", "email1label", "phone1value", "phone1type", "phone1label", "groupmembership", "yominame", "phoneticfirstname", "givenname", "familyname", "labels"]) >= 2,
  },
  {
    key: "neon",
    name: "a Neon CRM export",
    goes: "guided",
    columns: ["accountid", "householdid", "firstname", "lastname", "email1", "phone1fullnumberf", "addressline1", "addressline2", "city", "stateprovince", "zipcode", "donationamount", "donationdate", "fund", "campaignname"],
    test: (h) =>
      h.has("accountid") &&
      countOf(h, ["email1", "phone1fullnumberf", "stateprovince", "zipcode", "householdid", "accounttype", "individualtype", "addressline1", "primaryaffiliation", "donationamount", "companyname"]) >= 2,
  },
  {
    key: "quickbooks",
    name: "a QuickBooks export",
    goes: "guided",
    columns: ["customer", "fullname", "email", "phonenumbers", "billingaddress", "date", "num", "name", "memodescription", "class", "amount"],
    test: (h) =>
      (h.has("transactiontype") && h.has("num")) ||
      (h.has("customer") && countOf(h, ["openbalance", "billingaddress", "shippingaddress", "customertype", "phonenumbers", "fullname", "companyname"]) >= 2),
  },
  {
    key: "bank",
    name: "a bank statement",
    goes: "bank",
    columns: ["details", "postingdate", "postdate", "transactiondate", "date", "description", "amount", "debit", "credit", "type", "balance", "checkorslip", "checknumber"],
    test: (h) => {
      const chase = ["details", "postingdate", "description", "amount", "type", "balance"].every((k) => h.has(k));
      if (chase) return true;
      const date = hasAny(h, ["postingdate", "postdate", "transactiondate", "valuedate", "bookingdate", "date"]);
      const what = hasAny(h, ["description", "memo", "payee", "narrative", "details", "transactiondescription"]);
      const money = h.has("amount") || (h.has("debit") && h.has("credit")) || (h.has("withdrawals") && h.has("deposits"));
      const bankish = hasAny(h, ["balance", "runningbalance", "runningbal", "checkorslip", "checknumber", "checkno", "chequenumber", "debit", "withdrawals"]);
      const personish = hasAny(h, ["email", "emailaddress", "firstname", "lastname", "fromemailaddress"]);
      return date && what && money && bankish && !personish;
    },
  },
];

export const SOURCE_KEYS: readonly SourceKey[] = SOURCES.map((s) => s.key);

function knows(columns: readonly string[], heading: string): boolean {
  return columns.some((c) => (c.endsWith("*") ? heading.startsWith(c.slice(0, -1)) : heading === c));
}

// ---------------------------------------------------------------------------
// Recognising one file
// ---------------------------------------------------------------------------

function sheetSizeLine(rows: number | null, sheets: number | null, columns: number): string {
  if (sheets !== null && sheets > 1) return rows === null ? plural(sheets, "sheet") : `${plural(sheets, "sheet")} · ${plural(rows, "row")}`;
  return rows === null ? plural(columns, "column") : `${plural(rows, "row")} · ${plural(columns, "column")}`;
}

const base = (f: FileFacts) => ({ source: null, templateKey: null, columns: 0, known: 0, rows: f.rows, sheets: f.sheets });

/** A file the browser could not read: the reason is shown next to it, never hidden. */
export function unreadableFile(f: Pick<FileFacts, "name" | "size">, reason: string): Recognition {
  const why = reason.trim().replace(/[.!?]$/, "") || "the browser could not open it";
  return {
    kind: "unreadable",
    source: null,
    templateKey: null,
    columns: 0,
    known: 0,
    rows: null,
    sheets: null,
    sizeLine: formatBytes(f.size),
    tag: "Could not read",
    tone: "danger",
    sentence: `Could not read this file — ${why}.`,
    next: "Save it again as CSV or Excel (.xlsx) and drop it in.",
    goes: "none",
  };
}

export function recogniseFile(f: FileFacts, ctx: RecogniseContext): Recognition {
  const kind = fileKindOf(f.name, f.type);
  if (kind === "photo") {
    return {
      ...base(f),
      kind: "photo",
      rows: null,
      sheets: null,
      sizeLine: `Photo · ${formatBytes(f.size)}`,
      tag: "Photo of paper",
      tone: "grey",
      sentence: "A photo, perhaps of a printed list.",
      next: "Reading printed lists from photos is coming next. Photos are never sent to an AI service.",
      goes: "coming_next",
    };
  }
  if (kind === "pdf") {
    return {
      ...base(f),
      kind: "pdf",
      rows: null,
      sheets: null,
      sizeLine: `PDF · ${formatBytes(f.size)}`,
      tag: "PDF",
      tone: "grey",
      sentence: "A PDF, perhaps a printed list or a report.",
      next: "Reading lists from PDFs is coming next. PDFs are never sent to an AI service.",
      goes: "coming_next",
    };
  }
  if (kind === "old_excel") {
    return {
      ...base(f),
      kind: "old_excel",
      rows: null,
      sheets: null,
      sizeLine: formatBytes(f.size),
      tag: "Older Excel file",
      tone: "grey",
      sentence: "An older Excel file (.xls), which cannot be read here.",
      next: "Open it in Excel or Google Sheets, save it as .xlsx or CSV, and drop it in again.",
      goes: "none",
    };
  }
  if (kind === "other") {
    return {
      ...base(f),
      kind: "unsupported",
      rows: null,
      sheets: null,
      sizeLine: formatBytes(f.size),
      tag: "Not recognised",
      tone: "grey",
      sentence: "Weaver cannot read this kind of file yet.",
      next: "Excel, CSV, a photo or a PDF work best.",
      goes: "none",
    };
  }

  const headings = (f.headers ?? []).map((h) => String(h ?? "").trim()).filter((h) => h !== "");
  const norms = headings.map(normHeading).filter((h) => h !== "");
  if (f.headers === null || norms.length === 0) {
    return {
      ...base(f),
      kind: "empty",
      sizeLine: formatBytes(f.size),
      tag: "Not recognised",
      tone: "grey",
      sentence: "This file looks empty: there is no heading row to read.",
      next: "Check that the first rows hold the column headings, then drop it in again.",
      goes: "none",
    };
  }
  const set = new Set(norms);
  const columns = norms.length;
  const rowsPhrase = f.rows === null ? null : plural(f.rows, "row");
  const sizeLine = sheetSizeLine(f.rows, f.sheets, columns);

  // A Weaver template: the same headings, nothing missing and nothing else.
  for (const t of ctx.templates) {
    const want = new Set(t.headers.map(normHeading).filter((h) => h !== ""));
    if (want.size > 0 && want.size === set.size && [...want].every((h) => set.has(h))) {
      return {
        ...base(f),
        kind: "template",
        templateKey: t.key,
        columns,
        known: columns,
        sizeLine,
        tag: "Weaver template",
        tone: "green",
        sentence: `Weaver's own ${t.label} template, filled in${rowsPhrase ? `: ${rowsPhrase}` : ""}.`,
        next: "The headings match exactly, so Guided onboarding can take it straight to the checks.",
        goes: "guided",
      };
    }
  }

  const known = new Set(ctx.knownHeadings.map(normHeading).filter((h) => h !== ""));
  for (const s of SOURCES) {
    if (!s.test(set)) continue;
    const knownHere = norms.filter((h) => known.has(h) || knows(s.columns, h)).length;
    const knownPhrase = `${plural(knownHere, "column")} we know`;
    const sentence = rowsPhrase ? `Looks like ${s.name}: ${rowsPhrase}, ${knownPhrase}.` : `Looks like ${s.name}, with ${knownPhrase}.`;
    return {
      ...base(f),
      kind: "known_source",
      source: s.key,
      columns,
      known: knownHere,
      sizeLine,
      tag: "Known source",
      tone: "blue",
      sentence,
      next:
        s.goes === "bank"
          ? "Bank lines are matched to donations in bank matching, not loaded here."
          : "Loading this layout directly is coming next; for now Guided onboarding can take the file and match its columns with you.",
      goes: s.goes,
    };
  }

  const knownHere = norms.filter((h) => known.has(h)).length;
  const shape = rowsPhrase ? `${rowsPhrase}, ${plural(columns, "column")}` : plural(columns, "column");
  return {
    ...base(f),
    kind: "spreadsheet",
    columns,
    known: knownHere,
    sizeLine,
    tag: "Your own spreadsheet",
    tone: "sun",
    sentence: `Your own spreadsheet: ${shape}, ${knownHere === 0 ? "none of them" : count(knownHere)} we know.`,
    next: knownHere === 0 ? "Data import can take it and ask you where each column goes." : "Data import can take it and match the other columns with you.",
    goes: "data_import",
  };
}

/**
 * The line above the list: "I looked at 3 files and 1 photo, here in your browser. …". Photos are counted apart from the
 * other files, as on the board.
 */
export function droppedSummary(list: readonly Pick<Recognition, "kind">[]): string {
  if (list.length === 0) return "";
  const photos = list.filter((r) => r.kind === "photo").length;
  const files = list.length - photos;
  const what = [files > 0 ? plural(files, "file") : null, photos > 0 ? plural(photos, "photo") : null].filter(Boolean).join(" and ");
  return `I looked at ${what}, here in your browser. Here is what each is and where it can go. Nothing has been uploaded or saved.`;
}
