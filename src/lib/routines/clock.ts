// Calendar helpers for routines and the morning briefing. Pure: a "today" is a YYYY-MM-DD date already worked out in the
// organization's time zone (src/lib/dates.ts todayInTz), so nothing here depends on the server's own clock or zone.

import { DEFAULT_LOCALE, longDay, numberIn } from "@/lib/community-format";

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type DateParts = { weekday: number; dayOfMonth: number };

/** Day of the week (0 = Sunday) and day of the month of a YYYY-MM-DD date. */
export function dateParts(today: string): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) throw new Error(`not a date: ${today}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return { weekday: d.getUTCDay(), dayOfMonth: d.getUTCDate() };
}

/** "25th", "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const last = n % 10;
  const suffix = teen ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** "Saturday, October 10" (or "Saturday 10 October" where the community writes it so) in the organization's time zone. */
export function todayLabel(timeZone: string, now: Date = new Date(), locale: string = DEFAULT_LOCALE): string {
  return longDay(timeZone, locale, now);
}

/** "1 thing" / "2 things" (counts are shown with the community's thousands separators). */
export function countOf(n: number, one: string, many: string = `${one}s`, locale: string = DEFAULT_LOCALE): string {
  return `${numberIn(n, locale)} ${n === 1 ? one : many}`;
}
