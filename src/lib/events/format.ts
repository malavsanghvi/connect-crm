// Formatting helpers for the Events module (moved from connect-admin
// lib/format.ts). Money stays integer cents; format only at the edge.

import { parseAmountToCents } from "@/lib/money";

export const CENTER_TIME_ZONE_FALLBACK = "America/Chicago";

/** "$3" for whole dollars, "$3.50" otherwise (commitment chips, prices). */
export function formatShortCents(cents: number | null | undefined, currency = "USD"): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Positive amount in cents ("12.50" / "$12" / "12"), or null when blank or not an amount. */
export function parseDollarsToCents(input: string | null | undefined): number | null {
  const c = parseAmountToCents(input);
  return c === null || c < 0 ? null : c;
}

export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

/** "Sun, Nov 8" (or "Sun, Nov 8, 2027" when not this year) in the center's zone. */
export function formatEventDate(value: string | null | undefined, tz: string, now: Date = new Date()): string {
  if (!value) return "No date yet";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const year = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" });
  const sameYear = year.format(d) === year.format(now);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/** "Sun, Nov 8" for one day, "Oct 17–25" for several days in the same month. */
export function formatEventRange(startsAt: string | null | undefined, endsAt: string | null | undefined, tz: string, now: Date = new Date()): string {
  if (!startsAt) return "No date yet";
  if (!endsAt) return formatEventDate(startsAt, tz, now);
  const day = (v: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v));
  if (day(startsAt) === day(endsAt)) return formatEventDate(startsAt, tz, now);
  const month = (v: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short" }).format(new Date(v));
  const dom = (v: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).format(new Date(v));
  if (month(startsAt) === month(endsAt)) return `${month(startsAt)} ${dom(startsAt)}–${dom(endsAt)}`;
  return `${month(startsAt)} ${dom(startsAt)} – ${month(endsAt)} ${dom(endsAt)}`;
}

export function formatDateTime(value: string | null | undefined, tz: string): string {
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

/** "12:15 PM" in the center's zone. */
export function formatTime(value: string | null | undefined, tz: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
}

/** "10:42" (24-hour-free clock without AM/PM), as the prototype's recent check-ins. */
export function formatClock(value: string | null | undefined, tz: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
    .format(d)
    .replace(/\s?[AP]M$/i, "");
}

/** yyyy-mm-dd for "today" in the center's time zone. */
export function todayIso(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Value for <input type="datetime-local"> in the center's time zone. */
export function toDateTimeLocal(value: string | null | undefined, tz: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Interpret a datetime-local value ("2026-11-08T11:30") as wall-clock time in
 * the center's zone and return an ISO instant. Returns null for blank or bad input.
 */
export function fromDateTimeLocal(value: string | null | undefined, tz: string): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) guess = asUtc - zoneOffsetMs(new Date(guess), tz);
  return new Date(guess).toISOString();
}

function zoneOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - (date.getTime() - (date.getTime() % 1000));
}

export function personName(p: { first_name: string; last_name: string; preferred_name?: string | null } | null | undefined): string {
  if (!p) return "Unknown";
  return `${p.preferred_name || p.first_name} ${p.last_name}`.trim();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "rsvp_closed" → "Rsvp closed". */
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
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
