// Column mapping, row checking and staging for the import tool. Pure: the
// browser uses it for the Map and Check steps, the server uses the very same
// code to build what it stages, so the two never disagree.

import { entityDef, type EntityDef, type FieldDef } from "@/lib/import/registry";
import {
  ageOnDate,
  cleanText,
  isValidEmail,
  slug,
  splitName,
  toBoolean,
  toCents,
  toDate,
  toDateTime,
  toE164,
  toEmail,
  toEnum,
  toIdentifier,
  toInteger,
  toList,
  toName,
  toNumber,
  toTime,
  type DateOrder,
  type Transformed,
} from "@/lib/import/transforms";

export type CustomType = "text" | "number" | "date" | "boolean" | "choice" | "money" | "email" | "phone" | "url";
export const CUSTOM_TYPES: readonly { value: CustomType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / no" },
  { value: "choice", label: "Choice list" },
  { value: "money", label: "Money" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "Link" },
];

export type ColumnTarget =
  | { kind: "field"; field: string }
  | { kind: "custom"; label: string; type: CustomType; choices?: string[]; key?: string }
  | { kind: "skip" };

export type MappingOptions = {
  /** How to read 03/04/2020. */
  dateOrder: DateOrder;
  /** Country code for 10-digit numbers without one. */
  defaultCountry: string;
  /** The `system` legacy CRM IDs belong to (external_ids kind crm), e.g. "neon". */
  crmSystem: string;
};

export type Mapping = {
  /** One target per header, by header position. */
  columns: ColumnTarget[];
  /** Per field: the organization's word → ours ("Life Member" → "life"). */
  valueMaps: Record<string, Record<string, string>>;
  options: MappingOptions;
};

export type Problem = { level: "error" | "warning"; column: string | null; message: string };

export type StagedRow = {
  row_no: number;
  source_key: string;
  raw: Record<string, string>;
  data: Record<string, unknown>;
  extra: Record<string, unknown>;
  custom: Record<string, unknown>;
  problems: Problem[];
};

export const DEFAULT_OPTIONS: MappingOptions = { dateOrder: "mdy", defaultCountry: "1", crmSystem: "legacy_crm" };

/** "Email 1" → "email1"; "State/Province" → "stateprovince". */
export function normHeader(h: string): string {
  return cleanText(h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** The field a header names: key, label, then synonyms. */
export function matchField(entity: EntityDef, header: string): FieldDef | undefined {
  const n = normHeader(header);
  if (!n) return undefined;
  return (
    entity.fields.find((f) => normHeader(f.key) === n) ??
    entity.fields.find((f) => normHeader(f.label) === n) ??
    entity.fields.find((f) => normHeader(f.label.replace(/\(.*?\)/g, "")) === n) ??
    entity.fields.find((f) => (f.synonyms ?? []).some((s) => normHeader(s) === n))
  );
}

// ── Custom field type inference ─────────────────────────────────────────────

const URL_RE = /^https?:\/\/\S+$/i;

/** Guess a custom field's type from its values (all blank → text). */
export function inferCustomType(values: readonly string[], order: DateOrder = "mdy"): { type: CustomType; choices?: string[] } {
  const vals = values.map((v) => cleanText(v)).filter(Boolean);
  if (vals.length === 0) return { type: "text" };
  const every = (fn: (v: string) => boolean) => vals.every(fn);
  if (every((v) => toBoolean(v).ok)) return { type: "boolean" };
  if (every((v) => /^\$/.test(v) && toCents(v, { allowZero: true, allowNegative: true }).ok)) return { type: "money" };
  if (every((v) => /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, "")) && !/^0\d/.test(v))) return { type: "number" };
  if (every((v) => /[-/\s]/.test(v) && toDate(v, order).ok)) return { type: "date" };
  if (every((v) => isValidEmail(v.toLowerCase()))) return { type: "email" };
  if (every((v) => URL_RE.test(v))) return { type: "url" };
  if (every((v) => /[()+\-\s.]/.test(v) && v.replace(/\D/g, "").length >= 10 && toE164(v).ok)) return { type: "phone" };
  const distinct = [...new Set(vals)];
  if (distinct.length <= 8 && vals.length >= distinct.length * 2 && distinct.every((d) => d.length <= 40)) {
    return { type: "choice", choices: distinct.sort((a, b) => a.localeCompare(b)) };
  }
  return { type: "text" };
}

/** One custom value, typed. Blank → null (nothing is written). */
export function convertCustom(type: CustomType, cell: string, choices: readonly string[] | undefined, opts: MappingOptions): Transformed<unknown> | null {
  const s = cleanText(cell);
  if (!s) return null;
  switch (type) {
    case "text":
      return s.length > 2000 ? { ok: false, error: "is longer than 2,000 characters" } : { ok: true, value: s };
    case "number":
      return toNumber(s);
    case "money":
      return toCents(s, { allowZero: true, allowNegative: true });
    case "boolean":
      return toBoolean(s);
    case "date":
      return toDate(s, opts.dateOrder);
    case "email":
      return toEmail(s);
    case "phone":
      return toE164(s, opts.defaultCountry);
    case "url":
      return URL_RE.test(s) ? { ok: true, value: s } : { ok: false, error: `"${s}" is not a web address` };
    case "choice": {
      const hit = (choices ?? []).find((c) => slug(c) === slug(s));
      return hit ? { ok: true, value: hit } : { ok: false, error: `"${s}" is not one of: ${(choices ?? []).join(", ")}` };
    }
  }
}

/** Turn a label into the key the database will use ("Senior status" → "senior_status"). */
export function customKeyFor(label: string): string {
  const k = slug(label).slice(0, 50);
  return /^[a-z]/.test(k) ? k : `field_${k}`;
}

// ── Auto-mapping ─────────────────────────────────────────────────────────────

/**
 * Map every header: a saved mapping for this source wins, then the field
 * whose key, label or synonym matches the header. Anything left becomes
 * "Keep as a custom field" with a type guessed from its values, so nothing is
 * silently dropped; an empty column is skipped. A field is used once.
 */
export function autoMap(
  entityKey: string,
  headers: readonly string[],
  sampleRows: readonly (readonly string[])[],
  saved?: { columns: Record<string, ColumnTarget>; valueMaps?: Record<string, Record<string, string>>; options?: Partial<MappingOptions> } | null,
  options: Partial<MappingOptions> = {},
): Mapping {
  const entity = entityDef(entityKey);
  if (!entity) throw new Error(`Unknown data type "${entityKey}"`);
  const opts: MappingOptions = { ...DEFAULT_OPTIONS, ...(saved?.options ?? {}), ...options };
  const used = new Set<string>();
  const columns: ColumnTarget[] = headers.map((h, i) => {
    const fromSaved = saved?.columns[normHeader(h)];
    if (fromSaved && (fromSaved.kind !== "field" || (!used.has(fromSaved.field) && entity.fields.some((f) => f.key === fromSaved.field)))) {
      if (fromSaved.kind === "field") used.add(fromSaved.field);
      return fromSaved;
    }
    const f = matchField(entity, h);
    if (f && !used.has(f.key)) {
      used.add(f.key);
      return { kind: "field", field: f.key };
    }
    const values = sampleRows.map((r) => r[i] ?? "");
    if (values.every((v) => !cleanText(v))) return { kind: "skip" };
    const label = cleanText(h) || `Column ${i + 1}`;
    return { kind: "custom", label, ...inferCustomType(values, opts.dateOrder) };
  });
  return { columns, valueMaps: { ...(saved?.valueMaps ?? {}) }, options: opts };
}

/** What gets saved for a source ("Neon export"): targets keyed by normalized header. */
export function savedMappingOf(headers: readonly string[], mapping: Mapping) {
  const columns: Record<string, ColumnTarget> = {};
  headers.forEach((h, i) => {
    const t = mapping.columns[i];
    if (t) columns[normHeader(h)] = t;
  });
  return { columns, valueMaps: mapping.valueMaps, options: mapping.options };
}

/** Required fields no column is mapped to. */
export function missingRequired(entity: EntityDef, mapping: Mapping): FieldDef[] {
  const mapped = new Set(mapping.columns.flatMap((c) => (c.kind === "field" ? [c.field] : [])));
  return entity.fields.filter((f) => {
    if (!f.required || mapped.has(f.key)) return false;
    // People: a full-name column stands in for first + last name.
    if (entity.key === "people" && (f.key === "first_name" || f.key === "last_name") && mapped.has("full_name")) return false;
    return true;
  });
}

// ── Row building ─────────────────────────────────────────────────────────────

function transformField(f: FieldDef, cell: unknown, mapping: Mapping): Transformed<unknown> {
  const o = mapping.options;
  switch (f.type) {
    case "id":
      return toIdentifier(cell);
    case "ref": {
      const v = toIdentifier(cell);
      if (!v.ok) return v;
      const ref = f.ref!;
      return {
        ok: true,
        value: { $ref: ref.kind, value: v.value, ...("by" in ref && ref.by ? { by: ref.by } : {}), ...(ref.kind === "lookup" ? { table: ref.table } : {}) },
      };
    }
    case "text": {
      const s = cleanText(cell);
      return s ? (s.length > 500 ? { ok: false, error: "is longer than 500 characters" } : { ok: true, value: s }) : { ok: false, error: "is blank" };
    }
    case "longtext": {
      const s = String(cell ?? "").trim();
      return s ? (s.length > 5000 ? { ok: false, error: "is longer than 5,000 characters" } : { ok: true, value: s }) : { ok: false, error: "is blank" };
    }
    case "name":
    case "fullname":
      return toName(cell);
    case "email":
      return toEmail(cell);
    case "phone":
      return toE164(cell, o.defaultCountry);
    case "date":
      return toDate(cell, o.dateOrder);
    case "datetime":
      return toDateTime(cell, o.dateOrder);
    case "time":
      return toTime(cell);
    case "money":
      return toCents(cell, { allowZero: Boolean(f.allowZero) });
    case "integer":
      return toInteger(cell);
    case "number":
      return toNumber(cell);
    case "boolean":
      return toBoolean(cell);
    case "enum":
      return toEnum(cell, f.options ?? [], { ...(f.valueMap ?? {}), ...(mapping.valueMaps[f.key] ?? {}) });
    case "list":
      return toList(cell);
  }
}

/** A short, stable fingerprint of a string (FNV-1a, hex). Not for security. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Check one file row and build what gets staged. Errors block the row;
 * warnings don't. Every problem is plain English and names its column.
 */
export function buildRow(
  entityKey: string,
  mapping: Mapping,
  headers: readonly string[],
  cells: readonly unknown[],
  rowNo: number,
  today: string,
): StagedRow {
  const entity = entityDef(entityKey);
  if (!entity) throw new Error(`Unknown data type "${entityKey}"`);
  const raw: Record<string, string> = {};
  headers.forEach((h, i) => {
    const v = cells[i];
    raw[h || `Column ${i + 1}`] = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  });
  const row: StagedRow = { row_no: rowNo, source_key: "", raw, data: {}, extra: {}, custom: {}, problems: [] };
  const byField = new Map<string, { value: unknown; header: string }>();

  mapping.columns.forEach((t, i) => {
    const header = headers[i] || `Column ${i + 1}`;
    const cell = cells[i];
    if (t.kind === "skip") return;
    if (t.kind === "custom") {
      const conv = convertCustom(t.type, cell === null || cell === undefined ? "" : String(cell), t.choices, mapping.options);
      if (conv === null) return;
      if (!conv.ok) {
        row.problems.push({ level: "warning", column: header, message: `${t.label} ${conv.error} — left out.` });
        return;
      }
      row.custom[t.key ?? customKeyFor(t.label)] = conv.value;
      return;
    }
    const f = entity.fields.find((x) => x.key === t.field);
    if (!f) return;
    const blank = cleanText(cell instanceof Date ? cell.toISOString() : cell) === "";
    if (blank) return;
    if (entity.key === "pledges" && f.key === "status" && /writ/i.test(String(cell))) {
      row.problems.push({
        level: "error",
        column: header,
        message: "Written-off pledges cannot be imported as written off: a write-off needs two approvers. Import it as cancelled, or leave it out.",
      });
      return;
    }
    const v = transformField(f, cell, mapping);
    if (!v.ok) {
      const lvl = f.required ? "error" : "warning";
      row.problems.push({ level: lvl, column: header, message: `${f.label} ${v.error}${lvl === "warning" ? " — left out" : ""}.` });
      return;
    }
    byField.set(f.key, { value: v.value, header });
  });

  // People: a full name stands in for first and last name.
  if (entity.key === "people" && byField.has("full_name") && !(byField.has("first_name") && byField.has("last_name"))) {
    const split = splitName(String(byField.get("full_name")!.value));
    if (split) {
      if (!byField.has("first_name")) byField.set("first_name", { value: split.first, header: byField.get("full_name")!.header });
      if (!byField.has("last_name")) byField.set("last_name", { value: split.last, header: byField.get("full_name")!.header });
    } else {
      row.problems.push({ level: "error", column: byField.get("full_name")!.header, message: "Full name must have a first and a last name." });
    }
  }
  byField.delete("full_name");

  for (const f of entity.fields) {
    if (!f.required || byField.has(f.key)) continue;
    if (row.problems.some((p) => p.level === "error" && p.message.startsWith(f.label))) continue;
    row.problems.push({ level: "error", column: null, message: `${f.label} is required.` });
  }

  for (const [key, { value }] of byField) {
    const f = entity.fields.find((x) => x.key === key)!;
    if (f.column) row.data[f.column] = value;
    else if (f.extra) row.extra[f.extra] = value;
  }

  applyEntityRules(entity, row, byField, today);

  // Source key: the fields that identify the row across re-imports.
  const parts = entity.sourceKey.map((k) => {
    const v = byField.get(k)?.value;
    if (v && typeof v === "object" && "value" in (v as object)) return String((v as { value: unknown }).value);
    return v === undefined || v === null ? "" : String(v);
  });
  row.source_key = parts.some((p) => p !== "")
    ? parts.join("|").slice(0, 300)
    : `row:${fingerprint(JSON.stringify([row.data, row.extra, row.custom]))}`;
  return row;
}

/** Rules that span fields: consent, minors, write-offs, allocations. */
function applyEntityRules(entity: EntityDef, row: StagedRow, byField: Map<string, { value: unknown; header: string }>, today: string) {
  const warn = (column: string | null, message: string) => row.problems.push({ level: "warning", column, message });
  const error = (column: string | null, message: string) => row.problems.push({ level: "error", column, message });

  if (entity.key === "people") {
    const dob = row.data.date_of_birth as string | undefined;
    if (dob) {
      if (dob > today) {
        error(byField.get("date_of_birth")?.header ?? null, "Birth date is in the future.");
      } else if (ageOnDate(dob, today) < 13) {
        warn(null, "Under 13: this child cannot sign in until a parent gives consent.");
      }
    } else if (row.extra.relationship === "child") {
      warn(null, "A child without a birth date — add it so the rules for minors apply. Listed on the data-quality view.");
    }
    // Email consent: only an explicit opt-in with its date and source counts; opt-outs always import.
    const optIn = row.extra.email_opt_in;
    const date = row.extra.email_opt_in_date as string | undefined;
    const source = row.extra.email_opt_in_source as string | undefined;
    delete row.extra.email_opt_in;
    delete row.extra.email_opt_in_date;
    delete row.extra.email_opt_in_source;
    if (optIn === true) {
      if (!date || !source) {
        warn(byField.get("email_opt_in")?.header ?? null, "Email opt-in left out: an opt-in counts only with its date and its source.");
      } else if (!row.data.email) {
        warn(byField.get("email_opt_in")?.header ?? null, "Email opt-in left out: there is no email address to opt in.");
      } else {
        row.extra.email_optin = { opted_in: true, date, source };
      }
    } else if (optIn === false) {
      row.extra.email_optin = { opted_in: false, date: date ?? null, source: source ?? "import" };
    }
    if (row.extra.other_emails) {
      const emails = (row.extra.other_emails as string[]).map((e) => e.toLowerCase());
      const good = emails.filter(isValidEmail);
      if (good.length < emails.length) warn(byField.get("other_emails")?.header ?? null, "Some other emails are not email addresses — left out.");
      row.extra.other_emails = good;
    }
  }

  if (entity.key === "channel_optins" && row.data.opted_in === true && (!row.data.source || !row.data.recorded_at)) {
    error(null, "An opt-in counts only with its date and its source. Opt-outs need neither.");
  }
  if (entity.key === "channel_optins" && row.data.channel === "email" && typeof row.data.address === "string") {
    row.data.address = row.data.address.toLowerCase();
  }

  if (entity.key === "pledges" && row.extra.paid_so_far !== undefined && row.data.amount_cents !== undefined) {
    if (Number(row.extra.paid_so_far) > Number(row.data.amount_cents)) {
      warn(byField.get("paid_so_far")?.header ?? null, "Paid so far is more than the pledge amount.");
    }
  }

  if (entity.key === "payments" && row.extra.allocation_cents !== undefined && row.data.amount_cents !== undefined) {
    if (Number(row.extra.allocation_cents) > Number(row.data.amount_cents)) {
      error(byField.get("allocation_cents")?.header ?? null, "The amount applied to the pledge is more than the payment.");
    }
  }
  if (entity.key === "payments" && row.extra.allocation_cents !== undefined && row.extra.allocate_to === undefined) {
    warn(byField.get("allocation_cents")?.header ?? null, "An amount applied to a pledge but no pledge number — the allocation is left out.");
    delete row.extra.allocation_cents;
  }
}

/** Rows as the Check step shows them: counts of errors and warnings. */
export function summarize(rows: readonly StagedRow[]) {
  let errors = 0;
  let warnings = 0;
  let blocked = 0;
  for (const r of rows) {
    const e = r.problems.filter((p) => p.level === "error").length;
    errors += e;
    warnings += r.problems.length - e;
    if (e > 0) blocked += 1;
  }
  return { rows: rows.length, blocked, ready: rows.length - blocked, errors, warnings };
}

/** Rows that share a source key inside one file (the later one would update the earlier). */
export function duplicateKeys(rows: readonly StagedRow[]): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  for (const r of rows) {
    if (r.source_key.startsWith("row:")) continue;
    const list = seen.get(r.source_key) ?? [];
    list.push(r.row_no);
    seen.set(r.source_key, list);
  }
  return new Map([...seen].filter(([, v]) => v.length > 1));
}
