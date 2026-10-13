// Every pledge has a due date (owner decision 2026-10-13; migration 0775). Pure: the Record pledge sheet, the Change due date sheet,
// the pledge upload, the rules checker and the tests use the same rule and sentences. The database applies the same rule
// (app.pledge_default_due_on) to every pledge that arrives without a due date, and checks a change again (app.set_pledge_due_on).

import { addDays, daysBetween, isDateOnly } from "@/lib/dates";

/** Pledges are due this many days after they are made when the community has not said otherwise (what every screen counted with). */
export const DEFAULT_PLEDGE_DUE_DAYS = 30;
export const MAX_PLEDGE_DUE_DAYS = 3650;
/** A due date is within ten years of today (the database's own limit). */
export const DUE_WITHIN_DAYS = 3653;
export const DUE_REASON_MIN = 3;
export const DUE_REASON_MAX = 500;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The stored value as the database reads it: a whole number of days from 0 to 3650 (a number, or digits in a string); else null. */
function readDays(v: unknown): number | null {
  const text = typeof v === "number" ? (Number.isInteger(v) && v >= 0 ? String(v) : "") : typeof v === "string" ? v : "";
  if (!/^[0-9]{1,4}$/.test(text)) return null;
  const n = Number(text);
  return n <= MAX_PLEDGE_DUE_DAYS ? n : null;
}

/** rules.giving.pledge_due_days, or 30 when it is unset or unreadable (exactly as app.pledge_default_due_on reads it). */
export function pledgeDueDays(rules: unknown): number {
  const giving = isRecord(rules) ? rules.giving : undefined;
  return (isRecord(giving) ? readDays(giving.pledge_due_days) : null) ?? DEFAULT_PLEDGE_DUE_DAYS;
}

/** The problem with the stored setting, in plain words (for the rules checker); null when it is unset or fine. */
export function pledgeDueDaysProblem(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return readDays(v) === null ? `"giving.pledge_due_days" must be a whole number of days from 0 to ${MAX_PLEDGE_DUE_DAYS}.` : null;
}

/** The due date a pledge made on `pledgedOn` (YYYY-MM-DD, the community's day) gets when none is given. */
export function defaultDueOn(pledgedOn: string, days: number): string {
  return addDays(pledgedOn, days);
}

/** "Pledges are due 30 days after they are made." */
export function dueRuleSentence(days: number): string {
  if (days === 0) return "Pledges are due the day they are made.";
  return `Pledges are due ${days} ${days === 1 ? "day" : "days"} after they are made.`;
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export type ChangeDueInput = { pledgeId: string; dueOn: string; reason: string };
export type CheckedDueChange = { pledgeId: string; dueOn: string; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A real YYYY-MM-DD date (not 2026-02-30). */
export function isRealDate(v: string): boolean {
  return isDateOnly(v) && addDays(v, 0) === v;
}

/**
 * The checks of Change due date, with the sentence the person sees. `today` is the community's own day; `pledgedOn` (when known) is
 * the day the pledge was made, which the due date may not be before.
 */
export function checkDueChange(i: Partial<ChangeDueInput> | null | undefined, today: string, pledgedOn: string | null = null): Checked<CheckedDueChange> {
  const bad = (error: string): Checked<CheckedDueChange> => ({ ok: false, error });
  const pledgeId = (i?.pledgeId ?? "").trim();
  if (!UUID.test(pledgeId)) return bad("Open the pledge again: it was not found.");
  const due = (i?.dueOn ?? "").trim();
  if (!due) return bad("Choose the new due date.");
  if (!isRealDate(due)) return bad("Enter the due date as a date, like 2026-12-31.");
  if (Math.abs(daysBetween(today, due)) > DUE_WITHIN_DAYS) return bad("The due date must be within ten years of today.");
  if (pledgedOn && isRealDate(pledgedOn) && due < pledgedOn) return bad("The due date cannot be before the day it was pledged.");
  const reason = (i?.reason ?? "").trim();
  if (reason.length < DUE_REASON_MIN) return bad('Say why the due date changes (for example "Asked for more time"). It shows in the family\'s History.');
  if (reason.length > DUE_REASON_MAX) return bad(`Keep the reason to ${DUE_REASON_MAX} characters or fewer.`);
  return { ok: true, value: { pledgeId: pledgeId.toLowerCase(), dueOn: due, reason } };
}
