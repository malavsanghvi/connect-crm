// Dates for the Reports page and the Reports commands. Pure. A "day" is a calendar day written YYYY-MM-DD in the community's own
// time zone (the database turns it into the right instants); this file never looks at a clock, the caller passes today in.

import { addDays } from "@/lib/dates";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 30;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The same calendar day a year earlier; February 29 becomes February 28 when the earlier year has no 29th. */
export function sameDayLastYear(day: string): string {
  const m = DAY.exec(day);
  if (!m) return day;
  const year = Number(m[1]) - 1;
  const month = Number(m[2]);
  const d = Math.min(Number(m[3]), daysInMonth(year, month));
  return `${pad(year, 4)}-${m[2]}-${pad(d)}`;
}

export type YearWindow = {
  year: number;
  isCurrentYear: boolean;
  /** January 1 and December 31 of the year. */
  from: string;
  yearEnd: string;
  /** Where the year's figures stop: today for the current year, December 31 for any other. */
  periodEnd: string;
  /** The year before, from January 1 to the same day (the "vs last year" comparison). */
  prevFrom: string;
  prevEnd: string;
};

export function yearWindow(year: number, currentYear: number, today: string): YearWindow {
  const isCurrentYear = year === currentYear;
  const yearEnd = `${pad(year, 4)}-12-31`;
  const periodEnd = isCurrentYear ? today : yearEnd;
  return { year, isCurrentYear, from: `${pad(year, 4)}-01-01`, yearEnd, periodEnd, prevFrom: `${pad(year - 1, 4)}-01-01`, prevEnd: sameDayLastYear(periodEnd) };
}

/** A year typed in an address: a whole year after 1990 and no later than next year; anything else is this year. */
export function chosenYear(raw: number, currentYear: number): number {
  return Number.isInteger(raw) && raw > 1990 && raw <= currentYear + 1 ? raw : currentYear;
}

/** "+12%" or "-5%" for a against b, or null when b is zero (there is nothing to compare with). */
export function pctText(a: number, b: number): string | null {
  return b > 0 ? `${a >= b ? "+" : ""}${Math.round(((a - b) * 100) / b)}%` : null;
}

/** The change as a whole percent, or null when b is zero. */
export function pctChange(a: number, b: number): number | null {
  return b > 0 ? Math.round(((a - b) * 100) / b) : null;
}

// ---------------------------------------------------------------------------
// "This month with last month"
// ---------------------------------------------------------------------------
const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTH_NAME[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : month;
}

export type MonthWindow = { month: string; label: string; from: string; to: string };

export type MonthComparison =
  | {
      ok: true;
      /** True when the month is the one in progress: it is compared with the same days of last month. */
      partial: boolean;
      current: MonthWindow;
      /** Last month, for the same days when `partial`, otherwise the whole month. */
      previous: MonthWindow;
      /** The whole of last month (equal to `previous` when the month is complete). */
      previousFull: MonthWindow;
    }
  | { ok: false; error: string };

function windowOf(year: number, month: number, lastDay: number): MonthWindow {
  const key = `${pad(year, 4)}-${pad(month)}`;
  return { month: key, label: monthLabel(key), from: `${key}-01`, to: `${key}-${pad(lastDay)}` };
}

/**
 * The two windows to compare. `month` is "2026-10" (or left out for the month `today` is in). The month in progress runs from
 * the 1st to today and is compared with the same days of the month before; a finished month is compared in full.
 */
export function compareMonths(today: string, month?: string): MonthComparison {
  const t = DAY.exec(today);
  if (!t) return { ok: false, error: "Today's date could not be read." };
  const wanted = month ?? `${t[1]}-${t[2]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(wanted);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return { ok: false, error: "The month must look like 2026-10." };
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const todayKey = `${t[1]}-${t[2]}`;
  if (wanted > todayKey) return { ok: false, error: `${monthLabel(wanted)} has not started yet, so there is nothing to compare.` };
  const partial = wanted === todayKey;
  const lastDay = daysInMonth(year, mon);
  const dayNow = Number(t[3]);
  const current = windowOf(year, mon, partial ? Math.min(dayNow, lastDay) : lastDay);
  const prevYear = mon === 1 ? year - 1 : year;
  const prevMon = mon === 1 ? 12 : mon - 1;
  const prevLast = daysInMonth(prevYear, prevMon);
  const previousFull = windowOf(prevYear, prevMon, prevLast);
  const previous = partial ? windowOf(prevYear, prevMon, Math.min(Number(current.to.slice(8)), prevLast)) : previousFull;
  return { ok: true, partial, current, previous, previousFull };
}

/** The last `days` days up to and including `today` (for "recently"). */
export function lastDays(today: string, days: number): { from: string; to: string } {
  return { from: addDays(today, -(Math.max(days, 1) - 1)), to: today };
}
