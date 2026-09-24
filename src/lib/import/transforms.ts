// Value transforms for the import tool (ONBOARDING_PLAN Steps 3–5, "Transform").
// Pure and shared by the browser (Check step) and the server (staging), so
// what the person sees in the preview is exactly what gets written.
//
// Rules that matter:
// - Identifiers stay text, exactly as the other system shows them: leading
//   zeros are never dropped ("0417" stays "0417").
// - Money becomes integer cents.
// - Phone numbers become E.164 (+1… for 10-digit US numbers).
// - Dates become YYYY-MM-DD; an ambiguous 03/04/2020 is read as the run's
//   date order (month first by default, as US exports are).

import { parseAmountToCents } from "@/lib/money";

export type DateOrder = "mdy" | "dmy";

export type Transformed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Transformed<T> => ({ ok: true, value });
const bad = <T>(error: string): Transformed<T> => ({ ok: false, error });

/** Trim and collapse inner whitespace; "" for nothing. */
export function cleanText(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input).replace(/\s+/g, " ").trim();
}

/** Identifiers are text: trimmed, never numeric-converted, leading zeros kept. */
export function toIdentifier(input: unknown): Transformed<string> {
  const s = cleanText(input);
  if (!s) return bad("is blank");
  if (s.length > 100) return bad("is longer than 100 characters");
  return ok(s);
}

/** "Shah, Rahul" / "Rahul Shah" / "Rahul K. Shah" → first + last. */
export function splitName(full: string): { first: string; last: string } | null {
  const s = cleanText(full);
  if (!s) return null;
  if (s.includes(",")) {
    const [last, ...rest] = s.split(",");
    const first = rest.join(" ").trim();
    if (!last.trim() || !first) return null;
    return { first, last: last.trim() };
  }
  const parts = s.split(" ");
  if (parts.length < 2) return null;
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export function toName(input: unknown): Transformed<string> {
  const s = cleanText(input);
  if (!s) return bad("is blank");
  if (s.length > 200) return bad("is longer than 200 characters");
  return ok(s);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s);
}

export function toEmail(input: unknown): Transformed<string> {
  const s = cleanText(input).toLowerCase().replace(/^mailto:/, "");
  if (!s) return bad("is blank");
  if (!isValidEmail(s)) return bad(`"${s}" is not an email address`);
  return ok(s);
}

/**
 * Phone to E.164. 10 digits → US (+1). 11 digits starting 1 → +1. A leading
 * "+" or "00" keeps the country code. Extensions ("x123") are dropped.
 */
export function toE164(input: unknown, defaultCountry = "1"): Transformed<string> {
  const raw = cleanText(input);
  if (!raw) return bad("is blank");
  const main = raw.split(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i)[0];
  const plus = main.trim().startsWith("+") || main.trim().startsWith("00");
  let digits = main.replace(/\D/g, "");
  if (main.trim().startsWith("00")) digits = digits.slice(2);
  if (!plus) {
    if (digits.length === 10 && defaultCountry === "1") digits = `1${digits}`;
    else if (digits.length === 11 && digits.startsWith("1") && defaultCountry === "1") {
      /* already has the US country code */
    } else if (digits.length >= 7 && digits.length <= 10 && defaultCountry !== "1") digits = `${defaultCountry}${digits}`;
    else return bad(`"${raw}" is not a full phone number`);
  }
  if (!/^[1-9]\d{6,14}$/.test(digits)) return bad(`"${raw}" is not a phone number`);
  return ok(`+${digits}`);
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function ymd(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1850 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Two-digit years: 00–(this year + 5) are 20xx, the rest 19xx. */
function fullYear(y: string, now: Date): number {
  if (y.length === 4) return Number(y);
  const n = Number(y);
  const pivot = (now.getUTCFullYear() % 100) + 5;
  return n <= pivot ? 2000 + n : 1900 + n;
}

/** Excel serial day number (1900 date system) → YYYY-MM-DD. */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function toDate(input: unknown, order: DateOrder = "mdy", now: Date = new Date()): Transformed<string> {
  if (input instanceof Date) {
    const v = ymd(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate());
    return v ? ok(v) : bad("is not a real date");
  }
  const s = cleanText(input);
  if (!s) return bad("is blank");
  let m: RegExpExecArray | null;
  let v: string | null = null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) {
    v = ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(m[3], now);
    // An unambiguous day (13–31) in the first place wins over the run's order.
    if (a > 12 && b <= 12) v = ymd(y, b, a);
    else if (b > 12 && a <= 12) v = ymd(y, a, b);
    else v = order === "mdy" ? ymd(y, a, b) : ymd(y, b, a);
  } else if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s,]+(\d{2}|\d{4})$/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase()];
    v = mon ? ymd(fullYear(m[3], now), mon, Number(m[1])) : null;
  } else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
    const mon = MONTHS[m[1].toLowerCase()];
    v = mon ? ymd(Number(m[3]), mon, Number(m[2])) : null;
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    v = excelSerialToDate(Number(s));
  }
  return v ? ok(v) : bad(`"${s}" is not a date`);
}

/** A date or a date-time → ISO 8601 (dates become midnight UTC of that day). */
export function toDateTime(input: unknown, order: DateOrder = "mdy"): Transformed<string> {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? bad("is not a real date") : ok(input.toISOString());
  const s = cleanText(input);
  if (!s) return bad("is blank");
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(s)) {
    const d = new Date(s.replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) return ok(d.toISOString());
  }
  const m = /^(.*?)[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
  const datePart = m ? m[1] : s;
  const d = toDate(datePart, order);
  if (!d.ok) return bad(`"${s}" is not a date and time`);
  if (!m) return ok(`${d.value}T00:00:00.000Z`);
  let h = Number(m[2]);
  const ap = m[5]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || Number(m[3]) > 59) return bad(`"${s}" has an impossible time`);
  return ok(`${d.value}T${String(h).padStart(2, "0")}:${m[3]}:${m[4] ?? "00"}.000Z`);
}

export function toCents(input: unknown, { allowZero = false, allowNegative = false } = {}): Transformed<number> {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return bad("is not an amount");
    const c = Math.round(input * 100);
    if (Math.abs(input * 100 - c) > 1e-6) return bad(`${input} has fractions of a cent`);
    return checkCents(c, allowZero, allowNegative, String(input));
  }
  const s = cleanText(input).replace(/^(USD|US\$)\s*/i, "").replace(/\s*USD$/i, "");
  if (!s) return bad("is blank");
  const c = parseAmountToCents(s);
  if (c === null) return bad(`"${s}" is not an amount`);
  return checkCents(c, allowZero, allowNegative, s);
}

function checkCents(c: number, allowZero: boolean, allowNegative: boolean, shown: string): Transformed<number> {
  if (c === 0 && !allowZero) return bad("is zero");
  if (c < 0 && !allowNegative) return bad(`"${shown}" is negative`);
  return ok(c);
}

export function toInteger(input: unknown): Transformed<number> {
  const s = cleanText(input).replace(/,/g, "");
  if (!s) return bad("is blank");
  if (!/^-?\d+$/.test(s)) return bad(`"${s}" is not a whole number`);
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return bad(`"${s}" is too large`);
  return ok(n);
}

export function toNumber(input: unknown): Transformed<number> {
  const s = cleanText(input).replace(/,/g, "");
  if (!s) return bad("is blank");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return bad(`"${s}" is not a number`);
  return ok(Number(s));
}

const TRUE = new Set(["yes", "y", "true", "t", "1", "x", "checked", "on", "active", "opted in", "opt in", "subscribed"]);
const FALSE = new Set(["no", "n", "false", "f", "0", "unchecked", "off", "inactive", "opted out", "opt out", "unsubscribed"]);

export function toBoolean(input: unknown): Transformed<boolean> {
  if (typeof input === "boolean") return ok(input);
  const s = cleanText(input).toLowerCase();
  if (!s) return bad("is blank");
  if (TRUE.has(s)) return ok(true);
  if (FALSE.has(s)) return ok(false);
  return bad(`"${cleanText(input)}" is not yes or no`);
}

/** Lower-case, alphanumerics only, single underscores: "Life Member" → "life_member". */
export function slug(s: string): string {
  return cleanText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Translate the organization's word to ours: exact option value, option
 * label, the entity's built-in synonyms, then the run's own value map
 * ("Life Member" → "life"). Case and punctuation never matter.
 */
export function toEnum(
  input: unknown,
  options: readonly { value: string; label: string }[],
  valueMap: Record<string, string> = {},
): Transformed<string> {
  const s = cleanText(input);
  if (!s) return bad("is blank");
  const k = slug(s);
  const mapped = Object.entries(valueMap).find(([from]) => slug(from) === k)?.[1];
  const candidate = mapped ?? s;
  const ck = slug(candidate);
  const hit = options.find((o) => slug(o.value) === ck || slug(o.label) === ck);
  if (hit) return ok(hit.value);
  return bad(`"${s}" is not one of: ${options.map((o) => o.label).join(", ")}`);
}

/** "a; b, c" → ["a","b","c"] */
export function toList(input: unknown): Transformed<string[]> {
  const s = cleanText(input);
  if (!s) return bad("is blank");
  const items = s
    .split(/[;,|]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return items.length ? ok(items) : bad("is blank");
}

/** "14:30", "2:30 pm" → "14:30:00" */
export function toTime(input: unknown): Transformed<string> {
  const s = cleanText(input).toLowerCase();
  if (!s) return bad("is blank");
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return bad(`"${s}" is not a time`);
  let h = Number(m[1]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  const min = Number(m[2] ?? "0");
  if (h > 23 || min > 59) return bad(`"${s}" is not a time`);
  return ok(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`);
}

/** Age in whole years on `today` (YYYY-MM-DD). */
export function ageOnDate(dob: string, today: string): number {
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}
