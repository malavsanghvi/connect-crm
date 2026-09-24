// Center rules the Events module reads (centers.rules, edited in Settings ›
// Rules; keys validated in lib/center-rules.ts). Defaults match the database
// defaults in app.assign_lunch_for_rsvp.

import type { LunchRules } from "./report";

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function lunchRulesFromCenter(rules: unknown): LunchRules {
  const lunch = obj(obj(rules).lunch);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const reminder = lunch.reminder_minutes_before;
  return {
    childAtStart: bool(lunch.family_with_child_under_12_at_start, true),
    seniorAtStart: bool(lunch.senior_at_start, true),
    reminderMinutes: typeof reminder === "number" && Number.isInteger(reminder) && reminder >= 0 ? reminder : 5,
  };
}

/** Default slot length from Settings › Rules (lunch.slot_minutes), else 15. */
export function defaultSlotMinutes(rules: unknown): number {
  const v = obj(obj(rules).lunch).slot_minutes;
  return typeof v === "number" && Number.isInteger(v) && v >= 5 && v <= 120 ? v : 15;
}

/** Default confirmation reminder (rsvp.confirmation_hours_before), else 24. */
export function defaultConfirmationHours(rules: unknown): number {
  const v = obj(obj(rules).rsvp).confirmation_hours_before;
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 336 ? v : 24;
}
