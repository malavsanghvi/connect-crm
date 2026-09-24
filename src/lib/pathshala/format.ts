// Formatting at the edge only. Money is integer cents everywhere else.

export const CENTER_TIME_ZONE_FALLBACK = "America/Chicago";

export function formatCents(cents: number | null | undefined, opts: { currency?: string } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: opts.currency ?? "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "12.50" / "$12" / "12" -> 1250. Returns null for blank or invalid input. */
export function parseDollarsToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

export function formatDate(value: string | Date | null | undefined, tz = CENTER_TIME_ZONE_FALLBACK): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseDateish(value) : value;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : tz,
  }).format(d);
}

export function formatDateTime(value: string | null | undefined, tz = CENTER_TIME_ZONE_FALLBACK): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

export function formatTime(value: string | null | undefined, tz = CENTER_TIME_ZONE_FALLBACK): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
}

function parseDateish(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + "T00:00:00Z");
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** yyyy-mm-dd for "today" in the center's time zone. */
export function todayIso(tz = CENTER_TIME_ZONE_FALLBACK, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Value for <input type="datetime-local"> in the center's time zone. */
export function toDateTimeLocal(value: string | null | undefined, tz = CENTER_TIME_ZONE_FALLBACK): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Interpret a datetime-local value ("2026-11-08T11:30") as wall-clock time in
 * the center's zone and return an ISO instant. Returns null for blank input.
 */
export function fromDateTimeLocal(value: string | null | undefined, tz = CENTER_TIME_ZONE_FALLBACK): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of the zone at that instant (two passes handle DST edges).
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(new Date(guess), tz);
    guess = asUtc - offset;
  }
  return new Date(guess).toISOString();
}

function zoneOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

export function personName(p: { first_name: string; last_name: string; preferred_name?: string | null } | null | undefined): string {
  if (!p) return "Unknown";
  return `${p.preferred_name || p.first_name} ${p.last_name}`.trim();
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function humanize(key: string | null | undefined): string {
  if (!key) return "—";
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Normalize a US-style phone entry to E.164 (+1XXXXXXXXXX). Returns null if it can't. */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

/** Shift a yyyy-mm-dd date by whole days. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DAY_SHORT: Record<string, string> = {
  sunday: "Sun",
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
};

/** "10:00" / "10:30:00" → "10 AM" / "10:30 AM" (12-hour, minutes only when not on the hour). */
export function clockTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${suffix}`;
}

/**
 * When a class meets, as the prototype shows it: "Sun 10 AM". The day is the
 * short weekday; the start time is 12-hour. Without a start time: "Sun".
 */
export function classTimeLabel(meetsOn: string | null | undefined, startsTime: string | null | undefined): string {
  const day = meetsOn ? (DAY_SHORT[meetsOn.toLowerCase()] ?? humanize(meetsOn)) : null;
  const time = clockTime(startsTime);
  return [day, time].filter(Boolean).join(" ") || "—";
}
