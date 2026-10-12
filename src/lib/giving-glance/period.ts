// "Giving at a glance": the year a person is looking at. Pure: no clock, no database; the caller passes today in.
//
// The year is the community's own year: it starts in the month the community set in Setup > Organization profile (the fiscal
// year start; January when nothing is set, which is the calendar year). A year is named by the calendar year it STARTS in, so a
// year that starts in July 2025 is 2025 and is shown as "2025-26". The address carries it (?year=2026 or ?year=all), so a link
// keeps the view.

import { addDays } from "@/lib/dates";
import { currentFiscalYear, daysInMonth, fiscalStartMonth, fiscalYearLabel, sameDayLastYear } from "@/lib/reports/periods";

export type GlanceYear = { kind: "year"; year: number } | { kind: "all" };

export type GlancePrevious = {
  /** How the comparison reads: "the same time last year", "2024". */
  label: string;
  from: string;
  to: string;
};

export type GlanceWindow = {
  selection: GlanceYear;
  /** What goes in the address: "2026" or "all". */
  param: string;
  /** "2026", "2025-26" or "All time". */
  label: string;
  /** For a heading: "This year (2026)", "Last year (2025)", "2024", "All time". */
  title: string;
  /** First and last day of the period (the whole year, even when it is still going on); null for all time. */
  from: string | null;
  to: string | null;
  isCurrent: boolean;
  /** The period to compare with; null for all time. */
  previous: GlancePrevious | null;
  startMonth: number;
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FIRST_YEAR = 1990;

/** The year the address asks for: "all", a four-digit year from 1991 to the current year, or (anything else, nothing) this year. */
export function parseGlanceYear(raw: string | string[] | undefined | null, currentYear: number): GlanceYear {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (v === "all") return { kind: "all" };
  if (v && /^\d{4}$/.test(v)) {
    const year = Number(v);
    if (year > FIRST_YEAR && year <= currentYear) return { kind: "year", year };
  }
  return { kind: "year", year: currentYear };
}

/** The community's year a calendar day falls in, named by the calendar year it starts in. */
export function glanceYearOf(day: string, startMonth: number): number {
  return currentFiscalYear(day, fiscalStartMonth(startMonth));
}

/** The first and last day of a year starting in `startMonth`. */
export function yearBounds(year: number, startMonth: number): { from: string; to: string } {
  const start = fiscalStartMonth(startMonth);
  const endMonth = start === 1 ? 12 : start - 1;
  const endYear = start === 1 ? year : year + 1;
  return { from: `${pad(year, 4)}-${pad(start)}-01`, to: `${pad(endYear, 4)}-${pad(endMonth)}-${pad(daysInMonth(endYear, endMonth))}` };
}

export function glanceWindow(selection: GlanceYear, today: string, startMonthRaw: unknown = 1): GlanceWindow {
  const startMonth = fiscalStartMonth(startMonthRaw);
  const currentYear = glanceYearOf(today, startMonth);
  if (selection.kind === "all") {
    return { selection, param: "all", label: "All time", title: "All time", from: null, to: null, isCurrent: false, previous: null, startMonth };
  }
  const { year } = selection;
  const { from, to } = yearBounds(year, startMonth);
  const isCurrent = year === currentYear;
  const label = fiscalYearLabel(year, startMonth);
  const title = isCurrent ? `This year (${label})` : year === currentYear - 1 ? `Last year (${label})` : label;
  const prev = yearBounds(year - 1, startMonth);
  const previous: GlancePrevious = isCurrent
    ? { label: "the same time last year", from: prev.from, to: sameDayLastYear(today) }
    : { label: fiscalYearLabel(year - 1, startMonth), from: prev.from, to: addDays(from, -1) };
  return { selection, param: String(year), label, title, from, to, isCurrent, previous, startMonth };
}

/** Is this day inside the period? (All time has no edges.) */
export function inWindow(day: string, from: string | null, to: string | null): boolean {
  return (from === null || day >= from) && (to === null || day <= to);
}

export type YearChoice = { key: string; param: string; label: string; selected: boolean };

/**
 * The chips of the year filter: this year, last year, every earlier year that has data, then all time. A year typed in an address
 * that has no data is kept in the row so what is on screen is always one of the chips.
 */
export function yearChoices(days: Iterable<string>, today: string, startMonthRaw: unknown, selection: GlanceYear): YearChoice[] {
  const startMonth = fiscalStartMonth(startMonthRaw);
  const current = glanceYearOf(today, startMonth);
  const earlier = new Set<number>();
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    const y = glanceYearOf(d.slice(0, 10), startMonth);
    if (y < current - 1 && y > FIRST_YEAR) earlier.add(y);
  }
  if (selection.kind === "year" && selection.year < current - 1) earlier.add(selection.year);
  const picked = (y: number) => selection.kind === "year" && selection.year === y;
  const out: YearChoice[] = [
    { key: "this", param: String(current), label: `This year (${fiscalYearLabel(current, startMonth)})`, selected: picked(current) },
    { key: "last", param: String(current - 1), label: `Last year (${fiscalYearLabel(current - 1, startMonth)})`, selected: picked(current - 1) },
  ];
  for (const y of [...earlier].sort((a, b) => b - a)) out.push({ key: String(y), param: String(y), label: fiscalYearLabel(y, startMonth), selected: picked(y) });
  out.push({ key: "all", param: "all", label: "All time", selected: selection.kind === "all" });
  return out;
}

/** The twelve months of a year, in the community's order ("Jul" first for a July year). */
export function monthsOfYear(window: GlanceWindow): { key: string; label: string }[] {
  if (!window.from) return [];
  const startYear = Number(window.from.slice(0, 4));
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const m0 = window.startMonth - 1 + i;
    const year = startYear + Math.floor(m0 / 12);
    const month = (m0 % 12) + 1;
    out.push({ key: `${pad(year, 4)}-${pad(month)}`, label: MONTHS[month - 1] });
  }
  return out;
}

/** An address with these parts, leaving out any that are empty. Only the parts named are kept: the drawers and other state of the page are not carried over. */
export function glanceHref(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
