// How a community writes money, numbers and days: its currency (centers.currency), its place (centers.country, which gives the
// regional convention: "1,250.00", "1,25,000.00", "1.250,00") and its time zone. Pure, so the portal, Niva, the reports and the
// tests all read the same thing. Money underneath stays integer minor units (cents, pence, paise); this file only writes it.
//
// The portal's own words are English, so the locale is "en-" plus the community's region ("en-IN", "en-GB"). A community with no
// usable country gets the generic English convention ("en-US"), the same one the portal always used.

import { communityLocale as localeOfLanguages } from "./languages";
import { formatCents } from "./money";

export const DEFAULT_LOCALE = "en-US";

export type CommunityFormat = {
  /** ISO 4217 code: "USD", "INR", "GBP". */
  currency: string;
  /** BCP 47 tag used for digits, grouping and day names: "en-US", "en-IN", "en-GB". */
  locale: string;
};

/**
 * The convention the staff portal writes digits, money and days in for a community: English (the portal's own language) in the
 * community's country ("en-IN", "en-GB"); the generic English convention when it has no usable country. The same rule the community's
 * own languages use (src/lib/languages.ts), with English as the language because the portal is read in English.
 */
export function regionLocale(country: string | null | undefined): string {
  return localeOfLanguages(["en"], country);
}

/** The community's money and number convention from its row (the currency has no default: a row always has one). */
export function communityFormat(center: { currency?: string | null; country?: string | null }): CommunityFormat {
  const currency = (center.currency ?? "").trim().toUpperCase();
  return { currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD", locale: regionLocale(center.country) };
}

/** An amount in minor units, written the way this community writes money. The same writer the whole portal uses. */
export function moneyIn(minor: number | null | undefined, fmt: CommunityFormat): string {
  return formatCents(minor, fmt.currency, fmt.locale);
}

/**
 * A round example amount for a sentence ("$250", "₹250", "£8.50"): whole when it is whole, two decimals otherwise. Examples are
 * words, never stored; a currency the runtime cannot write falls back to the code and the number.
 */
export function moneyExample(minor: number, fmt: CommunityFormat): string {
  const whole = minor % 100 === 0;
  try {
    return new Intl.NumberFormat(fmt.locale, {
      style: "currency",
      currency: fmt.currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${fmt.currency} ${(minor / 100).toFixed(whole ? 0 : 2)}`;
  }
}

/** The currency's own symbol in this convention ("$", "₹", "£"), or the code when it has none. */
export function currencySymbol(fmt: CommunityFormat): string {
  try {
    const part = new Intl.NumberFormat(fmt.locale, { style: "currency", currency: fmt.currency }).formatToParts(0).find((p) => p.type === "currency");
    return part?.value ?? fmt.currency;
  } catch {
    return fmt.currency;
  }
}

/** "the community's currency (INR)": what a model is told, and what a command description says instead of a currency name. */
export function currencyPhrase(currency?: string | null): string {
  const code = (currency ?? "").trim().toUpperCase();
  return code ? `the community's currency (${code})` : "the community's currency";
}

/**
 * A large amount short enough for a tile ("$4.12M", "₹12L", "£12K"): the runtime's own compact notation for this convention, so a
 * lakh is a lakh where the community counts in lakhs. Under ten thousand it is the full amount without empty decimals.
 */
export function compactMoney(minor: number, fmt: CommunityFormat): string {
  const major = minor / 100;
  const abs = Math.abs(major);
  try {
    if (abs >= 10_000) {
      return new Intl.NumberFormat(fmt.locale, {
        style: "currency",
        currency: fmt.currency,
        notation: "compact",
        maximumFractionDigits: abs >= 1_000_000 && abs < 10_000_000 ? 2 : 0,
        minimumFractionDigits: 0,
      }).format(major);
    }
  } catch {
    // fall through to the full amount
  }
  return moneyIn(minor, fmt).replace(/[.,]00$/, "");
}

/** A whole number with this convention's grouping ("12,345", "12,345" in en-IN below a lakh). */
export function numberIn(n: number, locale: string): string {
  try {
    return n.toLocaleString(locale);
  } catch {
    return String(n);
  }
}

/** "Saturday, October 10" / "Saturday 10 October" in the community's time zone and convention. */
export function longDay(timeZone: string, locale: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(now);
  }
}

/** The English word for a day of the week (0 = Sunday), in this convention. */
export function weekdayName(day: number, locale: string): string {
  // 2026-10-04 is a Sunday.
  const d = new Date(Date.UTC(2026, 9, 4 + (((day % 7) + 7) % 7)));
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" }).format(d);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: "UTC", weekday: "long" }).format(d);
  }
}

/**
 * The community's working week as day numbers (0 = Sunday): `start` is the first day after the weekend and `end` the last day
 * before it. It comes from the community's own settings when it has set them (`rules.routines.week_start` / `week_end`), else from
 * the regional convention of its country (a Monday-to-Friday week in the United States and Britain, Sunday-to-Thursday where the
 * weekend is Friday and Saturday).
 */
export type WorkWeek = { start: number; end: number };

const isDay = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6;

type WeekInfo = { firstDay: number; weekend: number[] };

function weekInfoOf(locale: string): WeekInfo | null {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };
    const info = typeof l.getWeekInfo === "function" ? l.getWeekInfo() : l.weekInfo;
    return info && Array.isArray(info.weekend) && info.weekend.length > 0 ? info : null;
  } catch {
    return null;
  }
}

/** The regional working week (Intl numbers days 1 = Monday … 7 = Sunday; this file uses 0 = Sunday). */
export function regionalWorkWeek(locale: string): WorkWeek {
  const info = weekInfoOf(locale) ?? weekInfoOf(DEFAULT_LOCALE);
  if (!info) return { start: 1, end: 5 };
  const weekend = new Set(info.weekend.map((d) => d % 7));
  let start = -1;
  let end = -1;
  for (let d = 0; d < 7; d += 1) {
    const before = (d + 6) % 7;
    const after = (d + 1) % 7;
    if (!weekend.has(d) && weekend.has(before) && start < 0) start = d;
    if (!weekend.has(d) && weekend.has(after)) end = d;
  }
  return { start: start < 0 ? 1 : start, end: end < 0 ? 5 : end };
}

/** The working week for a community: its own settings over its country's convention. `rules` is centers.rules. */
export function workWeekFor(locale: string, rules?: unknown): WorkWeek {
  const base = regionalWorkWeek(locale);
  const routines = rules && typeof rules === "object" && !Array.isArray(rules) ? (rules as Record<string, unknown>).routines : null;
  const own = routines && typeof routines === "object" && !Array.isArray(routines) ? (routines as Record<string, unknown>) : {};
  return { start: isDay(own.week_start) ? own.week_start : base.start, end: isDay(own.week_end) ? own.week_end : base.end };
}
