// Dates are shown in the center's time zone (centers.time_zone).
// `date` columns (YYYY-MM-DD) are calendar dates and are never shifted.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateInTz(instant: Date | string, timeZone: string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function todayInTz(timeZone: string, now: Date = new Date()): string {
  return dateInTz(now, timeZone);
}

/** "Sep 14, 2026". Date-only values are formatted as calendar dates; timestamps in the zone. */
export function formatDate(value: string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  if (isDateOnly(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** "Sep 2026" for a first-of-month date (accounting periods). */
export function formatMonth(value: string | null | undefined): string {
  if (!value || !isDateOnly(value)) return value ?? "—";
  const [y, m] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** "Sep 14, 2026, 3:05 PM" in the center's zone. */
export function formatDateTime(value: string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function toUtcDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDay(to) - toUtcDay(from)) / 86_400_000);
}

/** Age in whole years on `today` (YYYY-MM-DD). */
export function ageOn(dateOfBirth: string | null | undefined, today: string): number | null {
  if (!dateOfBirth || !isDateOnly(dateOfBirth)) return null;
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age >= 0 ? age : null;
}

/** Offset (ms) of a time zone from UTC at an instant: local = utc + offset. */
function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - (instant - (instant % 1000));
}

/** The UTC instant (ISO) of local midnight at the start of `date` in `timeZone`. */
export function startOfDayInTz(date: string, timeZone: string): string {
  const guess = toUtcDay(date);
  let ts = guess - tzOffsetMs(guess, timeZone);
  // Re-check once across a DST boundary.
  const second = guess - tzOffsetMs(ts, timeZone);
  if (second !== ts) ts = second;
  return new Date(ts).toISOString();
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(toUtcDay(date) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** A `datetime-local` value ("2026-09-22T07:00") read as wall-clock time in `timeZone` → ISO instant; null when invalid. */
export function localDateTimeToIso(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let ts = guess - tzOffsetMs(guess, timeZone);
  const second = guess - tzOffsetMs(ts, timeZone);
  if (second !== ts) ts = second;
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

/** ISO instant → `datetime-local` value in `timeZone` ("" when empty). */
export function isoToLocalDateTime(value: string | null | undefined, timeZone: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
