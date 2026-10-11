// Pieces the Reports commands share: the dates a question may name, the money words, the check that a section is one the person
// may see, and turning a failed read into the plain sentence the command layer logs and explains.

import { addDays, formatDate, todayInTz } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { isModuleEnabled, moduleDef, moduleOffMessage, type ModuleKey } from "@/lib/modules";
import { canAccess, type AccessKey } from "@/lib/permissions";
import { loadFiscalStart } from "@/lib/reports/fiscal";
import type { Section } from "@/lib/reports/load";
import { chosenYear, currentFiscalYear, startOfFiscalYear, yearWindow, type YearWindow } from "@/lib/reports/periods";

import { f } from "../../schema";
import { CommandDbError, CommandError, type CommandContext } from "../../types";

export const NO_ACCESS = "You don't have access to this area.";

/** A section's value, or a CommandDbError ("Could not read the giving figures — …"): logged and explained by the command runner. */
export function got<T>(section: Section<T>, doing: string): T {
  if (!section.ok) throw new CommandDbError(section.error, doing);
  return section.value;
}

export const todayOf = (ctx: CommandContext): string => todayInTz(ctx.session.center.time_zone, ctx.now?.());

export const moneyOf =
  (ctx: CommandContext) =>
  (cents: number): string =>
    formatCents(cents, ctx.session.center.currency);

/** Throws the "switched off" sentence when the community has this module off (a report of a module nobody uses would be all zeros). */
export function requireModule(ctx: CommandContext, key: ModuleKey): void {
  if (!isModuleEnabled(ctx.session, key)) throw new CommandError(moduleOffMessage(key, ctx.session.center.name, moduleDef(key).label));
}

/** True when the person may see this area; the commands leave an area out (and say so) instead of showing zeros. */
export const mayAccess = (ctx: CommandContext, key: AccessKey): boolean => canAccess(ctx.session, key);

/** The same words everywhere an area is left out. */
export function notShown(area: string): { area: string; reason: string } {
  return { area, reason: NO_ACCESS };
}

export const dateFields = {
  from: f.optional(f.date("The first day, like 2026-01-01. Leave out for the usual start (said in the description).")),
  to: f.optional(f.date("The last day, like 2026-10-31. Leave out for today.")),
};

const MAX_DAYS = 3660;

/** The days a question covers. `defaultFrom` is the start when none was given (the first day of this year, or 30 days ago). */
export function resolveRange(
  ctx: CommandContext,
  input: { from?: string; to?: string },
  defaultFrom: (today: string) => string,
): { from: string; to: string; today: string; words: string } {
  const today = todayOf(ctx);
  const to = input.to ?? today;
  const from = input.from ?? defaultFrom(today);
  if (from > to) throw new CommandError("The first day must come before the last day.");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_DAYS) throw new CommandError("Ask for ten years or less at a time.");
  const tz = ctx.session.center.time_zone;
  return { from, to, today, words: `${formatDate(from, tz)} to ${formatDate(to, tz)}` };
}

/** The first day of this year: January 1 (use fiscalYearStart for the community's own financial year). */
export const startOfYear = (today: string): string => `${today.slice(0, 4)}-01-01`;

/**
 * The community's financial year for a question about "a year": the window asked for (or this year's), and the note to tell the person
 * when the start of the financial year could not be read and the calendar year was used instead.
 */
export async function fiscalYear(ctx: CommandContext, asked?: number): Promise<{ today: string; w: YearWindow; note: string | null }> {
  const today = todayOf(ctx);
  const fiscal = await loadFiscalStart(ctx.session.db, ctx.session.center.id);
  const currentYear = currentFiscalYear(today, fiscal.month);
  return { today, w: yearWindow(chosenYear(asked ?? currentYear, currentYear), currentYear, today, fiscal.month), note: fiscal.problem };
}

/**
 * The start of "this year so far" for a question with no dates: the first day of the community's financial year. Returns the function
 * resolveRange wants, plus the note to tell the person when the start of the financial year could not be read.
 */
export async function fiscalYearStart(ctx: CommandContext): Promise<{ from: (today: string) => string; note: string | null }> {
  const fiscal = await loadFiscalStart(ctx.session.db, ctx.session.center.id);
  return { from: (today) => startOfFiscalYear(today, fiscal.month), note: fiscal.problem };
}
export const thirtyDaysAgo = (today: string): string => addDays(today, -29);

/** "+12%" style words, or null when there is nothing to compare with. */
export function changeWords(change: number | null): string | null {
  return change === null ? null : `${change >= 0 ? "+" : ""}${change}%`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
