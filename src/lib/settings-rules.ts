// Structured reading and editing of centers.rules for the Settings tabs
// (Rules, Onboarding fields, Notifications, Security). Pure: no server
// imports, so the forms and the tests share it.
//
// Every key below has a default, used when a center has not set it yet.
// Keys added by the Settings parity work (documented in docs/SETTINGS_RULES.md):
//   version                                 structured saves bump it ("Rules saved · version N")
//   membership.life_references_required     1 | 2   references a Life application needs
//   membership.life_prior_yearly_months     0 | 12 | 24  prior Yearly membership before Life
//   points.streak_rest_days_per_month       rest days that keep a streak alive
//   points.behind_after_days                days without practice before a member is "behind"
//   onboarding.fields.<field>               "required" | "optional" | "hidden"
//   notifications.quiet_start_hour / quiet_end_hour / event_day_during_quiet_hours / triggers.<key>
//   security.printed_signin_codes / admin_session_hours / admin_idle_minutes

import { isPlainObject } from "@/lib/center-rules";
import type { Json } from "@/lib/database.types";

export type RulesObject = { [key: string]: Json | undefined };

function at(rules: Json | undefined, path: string[]): Json | undefined {
  let cur: Json | undefined = rules;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}
function int(v: Json | undefined, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) ? v : fallback;
}
function bool(v: Json | undefined, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

// ---------------------------------------------------------------------------
// Rules tab
// ---------------------------------------------------------------------------
export type RuleSettings = {
  childLoginAge: number;
  referenceExpiryDays: number;
  lifeReferencesRequired: number;
  lifePriorYearlyMonths: number;
  askDonorToCoverFees: boolean;
  boliSoftCloseMinutes: number;
  boliStepCents: number;
  lunch: { slotMinutes: number; familyWithChildUnder12AtStart: boolean; seniorAtStart: boolean; reminderMinutesBefore: number };
  rsvp: { confirmationHoursBefore: number; nudgeHourLocal: number };
  store: { giftPackCents: number; cancelHoursBeforePickup: number };
  points: {
    anumodanaPoints: number;
    anumodanaDailyCap: number;
    supportPoints: number;
    dayCompleteBonus: number;
    streakRestDaysPerMonth: number;
    behindAfterDays: number;
  };
};

/** Defaults for every structured rule (what a center without the key gets). */
export const RULE_DEFAULTS: RuleSettings = {
  childLoginAge: 13,
  referenceExpiryDays: 14,
  lifeReferencesRequired: 1,
  lifePriorYearlyMonths: 0,
  askDonorToCoverFees: true,
  boliSoftCloseMinutes: 0,
  boliStepCents: 2100,
  lunch: { slotMinutes: 15, familyWithChildUnder12AtStart: true, seniorAtStart: true, reminderMinutesBefore: 5 },
  rsvp: { confirmationHoursBefore: 24, nudgeHourLocal: 18 },
  store: { giftPackCents: 299, cancelHoursBeforePickup: 24 },
  points: { anumodanaPoints: 5, anumodanaDailyCap: 5, supportPoints: 3, dayCompleteBonus: 20, streakRestDaysPerMonth: 1, behindAfterDays: 3 },
};

export function readRuleSettings(rules: Json): RuleSettings {
  const d = RULE_DEFAULTS;
  const r = (...p: string[]) => at(rules, p);
  return {
    childLoginAge: int(r("child_login_age"), d.childLoginAge),
    referenceExpiryDays: int(r("membership", "reference_expiry_days"), d.referenceExpiryDays),
    lifeReferencesRequired: int(r("membership", "life_references_required"), d.lifeReferencesRequired),
    lifePriorYearlyMonths: int(r("membership", "life_prior_yearly_months"), d.lifePriorYearlyMonths),
    askDonorToCoverFees: bool(r("fees", "ask_donor_to_cover"), d.askDonorToCoverFees),
    boliSoftCloseMinutes: int(r("boli", "soft_close_minutes"), d.boliSoftCloseMinutes),
    boliStepCents: int(r("boli", "step_cents"), d.boliStepCents),
    lunch: {
      slotMinutes: int(r("lunch", "slot_minutes"), d.lunch.slotMinutes),
      familyWithChildUnder12AtStart: bool(r("lunch", "family_with_child_under_12_at_start"), d.lunch.familyWithChildUnder12AtStart),
      seniorAtStart: bool(r("lunch", "senior_at_start"), d.lunch.seniorAtStart),
      reminderMinutesBefore: int(r("lunch", "reminder_minutes_before"), d.lunch.reminderMinutesBefore),
    },
    rsvp: {
      confirmationHoursBefore: int(r("rsvp", "confirmation_hours_before"), d.rsvp.confirmationHoursBefore),
      nudgeHourLocal: int(r("rsvp", "nudge_hour_local"), d.rsvp.nudgeHourLocal),
    },
    store: {
      giftPackCents: int(r("store", "gift_pack_cents"), d.store.giftPackCents),
      cancelHoursBeforePickup: int(r("store", "cancel_hours_before_pickup"), d.store.cancelHoursBeforePickup),
    },
    points: {
      anumodanaPoints: int(r("points", "anumodana_points"), d.points.anumodanaPoints),
      anumodanaDailyCap: int(r("points", "anumodana_daily_cap"), d.points.anumodanaDailyCap),
      supportPoints: int(r("points", "support_points"), d.points.supportPoints),
      dayCompleteBonus: int(r("points", "day_complete_bonus"), d.points.dayCompleteBonus),
      streakRestDaysPerMonth: int(r("points", "streak_rest_days_per_month"), d.points.streakRestDaysPerMonth),
      behindAfterDays: int(r("points", "behind_after_days"), d.points.behindAfterDays),
    },
  };
}

/** The rules' version number; null when no structured save has happened yet. */
export function rulesVersion(rules: Json): number | null {
  const v = at(rules, ["version"]);
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Deep-merge `patch` into `current`: objects merge key by key; anything else replaces. */
export function mergeRules(current: Json, patch: RulesObject): RulesObject {
  const base: RulesObject = isPlainObject(current) ? { ...current } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const prev = base[k];
    base[k] = isPlainObject(v) && isPlainObject(prev) ? mergeRules(prev, v) : v;
  }
  return base;
}

/** Merge a patch and stamp the next version (1 when the rules were never versioned). */
export function applyRulesPatch(current: Json, patch: RulesObject): { rules: RulesObject; version: number } {
  const version = (rulesVersion(current) ?? 0) + 1;
  return { rules: { ...mergeRules(current, patch), version }, version };
}

/** The "Lunch-slot rules" note, written from the center's lunch keys. */
export function lunchRulesText(s: RuleSettings): string {
  const together = [
    s.lunch.familyWithChildUnder12AtStart ? "Families with a child under 12" : null,
    s.lunch.seniorAtStart ? "a senior" : null,
  ].filter(Boolean);
  const first =
    together.length === 2
      ? "Families with a child under 12 or a senior eat together at lunch start."
      : together.length === 1
        ? `${together[0] === "a senior" ? "Families with a senior" : "Families with a child under 12"} eat together at lunch start.`
        : "No family is placed at lunch start automatically.";
  const reminder = s.lunch.reminderMinutesBefore > 0 ? ` Members are reminded ${s.lunch.reminderMinutesBefore} minutes before their slot.` : "";
  return `${first} Other adults are slotted by arrival time, then RSVP order. Anyone who misses a slot may join any later slot. Slot length and seats are set per event (new events start at ${s.lunch.slotMinutes} minutes).${reminder}`;
}

// ---------------------------------------------------------------------------
// Onboarding fields tab
// ---------------------------------------------------------------------------
export type FieldSetting = "required" | "optional" | "hidden";
export const FIELD_SETTINGS: { value: FieldSetting; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
  { value: "hidden", label: "Hidden" },
];

export type OnboardingField = {
  key: string;
  label: string;
  appliesTo: "Everyone" | "Adults" | "Household";
  defaultSetting: FieldSetting;
  /** Privacy choices: always asked, never hidden or skipped. */
  alwaysAsked?: boolean;
};

export const ONBOARDING_FIELDS: OnboardingField[] = [
  { key: "name_relationship", label: "Name, relationship", appliesTo: "Everyone", defaultSetting: "required" },
  { key: "date_of_birth", label: "Date of birth", appliesTo: "Everyone", defaultSetting: "required" },
  { key: "gender", label: "Gender", appliesTo: "Everyone", defaultSetting: "optional" },
  { key: "profession", label: "Profession", appliesTo: "Adults", defaultSetting: "optional" },
  { key: "employer", label: "Employer (matching gifts)", appliesTo: "Adults", defaultSetting: "optional" },
  { key: "mobile_emails", label: "Mobile and emails", appliesTo: "Adults", defaultSetting: "required" },
  { key: "contact_channels", label: "Contact channels and best time", appliesTo: "Adults", defaultSetting: "optional" },
  { key: "language", label: "Language", appliesTo: "Everyone", defaultSetting: "optional" },
  { key: "interests", label: "Interests", appliesTo: "Adults", defaultSetting: "optional" },
  { key: "directory_listing", label: "Directory listing", appliesTo: "Household", defaultSetting: "required", alwaysAsked: true },
  { key: "photo_consent", label: "Photo consent", appliesTo: "Household", defaultSetting: "required", alwaysAsked: true },
  { key: "physical_mail", label: "Physical mail", appliesTo: "Household", defaultSetting: "required", alwaysAsked: true },
];

function isFieldSetting(v: unknown): v is FieldSetting {
  return v === "required" || v === "optional" || v === "hidden";
}

export function readOnboardingFields(rules: Json): Record<string, FieldSetting> {
  const stored = at(rules, ["onboarding", "fields"]);
  const out: Record<string, FieldSetting> = {};
  for (const f of ONBOARDING_FIELDS) {
    const v = isPlainObject(stored) ? stored[f.key] : undefined;
    out[f.key] = f.alwaysAsked ? "required" : isFieldSetting(v) ? v : f.defaultSetting;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Notifications tab
// ---------------------------------------------------------------------------
export type NotificationTrigger = { key: string; label: string; when: (s: RuleSettings) => string; channel: string };

export const NOTIFICATION_TRIGGERS: NotificationTrigger[] = [
  { key: "rsvp_confirmation", label: "RSVP confirmation", when: (s) => `${s.rsvp.confirmationHoursBefore} hours before`, channel: "Push · SMS or WhatsApp for guests" },
  { key: "lunch_reminder", label: "Lunch slot reminder", when: (s) => `${s.lunch.reminderMinutesBefore} minutes before each slot`, channel: "Push · SMS for guests" },
  { key: "special_day_labh", label: "Special-day labh prompt", when: () => "2 weeks before", channel: "Push" },
  { key: "family_celebration", label: "Family celebration", when: () => "When goal or level completed", channel: "Push" },
  { key: "saathi_support", label: "Saathi support request", when: (s) => `After ${s.points.behindAfterDays} days behind`, channel: "Push to anumodana senders" },
  { key: "boli_outbid", label: "Boli outbid / closing", when: () => "On entry · 24 hours before cutoff", channel: "Push" },
  { key: "giving_opportunity", label: "Giving opportunity alert", when: () => "On publish", channel: "Push · email" },
  { key: "pledge_reminder", label: "Pledge reminder", when: () => "Monthly for open pledges", channel: "Email" },
  { key: "store_order_ready", label: "Store order ready", when: () => "At pickup time", channel: "Push" },
  { key: "event_feedback", label: "Event feedback request", when: () => "Morning after the event · one reminder after 3 days", channel: "Push · SMS or WhatsApp for guests" },
  { key: "pachchakhan_reminder", label: "Pachchakhan reminder", when: () => "Member-set times", channel: "Push" },
];

export type NotificationSettings = {
  quietStartHour: number;
  quietEndHour: number;
  eventDayDuringQuietHours: boolean;
  triggers: Record<string, boolean>;
};

export function readNotificationSettings(rules: Json): NotificationSettings {
  const stored = at(rules, ["notifications", "triggers"]);
  const triggers: Record<string, boolean> = {};
  for (const t of NOTIFICATION_TRIGGERS) triggers[t.key] = bool(isPlainObject(stored) ? stored[t.key] : undefined, true);
  return {
    quietStartHour: int(at(rules, ["notifications", "quiet_start_hour"]), 21),
    quietEndHour: int(at(rules, ["notifications", "quiet_end_hour"]), 7),
    eventDayDuringQuietHours: bool(at(rules, ["notifications", "event_day_during_quiet_hours"]), true),
    triggers,
  };
}

/** 0 → "12 AM", 13 → "1 PM", 21 → "9 PM". */
export function hourLabel(h: number): string {
  const hour = ((h % 24) + 24) % 24;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${hour < 12 ? "AM" : "PM"}`;
}

export function quietHoursText(s: NotificationSettings): string {
  return `${hourLabel(s.quietStartHour)} – ${hourLabel(s.quietEndHour)}`;
}

// ---------------------------------------------------------------------------
// Security tab
// ---------------------------------------------------------------------------
export type SecuritySettings = { printedSigninCodes: boolean; adminSessionHours: number; adminIdleMinutes: number };

export function readSecuritySettings(rules: Json): SecuritySettings {
  return {
    printedSigninCodes: bool(at(rules, ["security", "printed_signin_codes"]), true),
    adminSessionHours: int(at(rules, ["security", "admin_session_hours"]), 8),
    adminIdleMinutes: int(at(rules, ["security", "admin_idle_minutes"]), 30),
  };
}

// ---------------------------------------------------------------------------
// Form input → rules patch, one section per Save button
// ---------------------------------------------------------------------------
export type RulesSection = "membership" | "giving" | "lunch" | "bolis_store" | "points" | "onboarding" | "notifications" | "security";

export const SECTION_LABEL: Record<RulesSection, string> = {
  membership: "membership and references",
  giving: "giving, bolis and privacy",
  lunch: "lunch and RSVP",
  bolis_store: "bolis and store",
  points: "points and streaks",
  onboarding: "onboarding fields",
  notifications: "notification rules",
  security: "security settings",
};

export function isRulesSection(v: unknown): v is RulesSection {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SECTION_LABEL, v);
}

type Read = (name: string) => string | null;
export type ParsedSection = { ok: true; patch: RulesObject } | { ok: false; error: string };

function wholeNumber(read: Read, name: string, label: string, min: number, max: number): number | string {
  const raw = (read(name) ?? "").trim();
  if (!/^\d+$/.test(raw)) return `${label} must be a whole number.`;
  const n = Number(raw);
  if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
  return n;
}

/** "2.99" → 299; rejects negatives, more than two decimals and junk. */
export function parseDollarsToCents(raw: string): number | null {
  const v = raw.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function collect(values: Record<string, number | string | boolean>): { errors: string[]; ok: Record<string, number | boolean> } {
  const errors: string[] = [];
  const ok: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string") errors.push(v);
    else ok[k] = v;
  }
  return { errors, ok };
}

const on = (read: Read, name: string) => read(name) === "on";

/**
 * Turn one Settings form into a rules patch. Only the keys that form edits
 * are in the patch; everything else in the rule bag is left untouched.
 * Ranges match the checks in center-rules.ts.
 */
export function parseSection(section: RulesSection, read: Read): ParsedSection {
  const fail = (errors: string[]): ParsedSection => ({ ok: false, error: errors.join(" ") });
  switch (section) {
    case "membership": {
      const { errors, ok } = collect({
        refs: wholeNumber(read, "life_references_required", "References required for Life", 1, 5),
        prior: wholeNumber(read, "life_prior_yearly_months", "Prior yearly membership for Life", 0, 120),
        age: wholeNumber(read, "child_login_age", "The child's own login age", 0, 21),
      });
      if (errors.length) return fail(errors);
      return {
        ok: true,
        patch: { child_login_age: ok.age, membership: { life_references_required: ok.refs, life_prior_yearly_months: ok.prior } },
      };
    }
    case "giving":
      return {
        ok: true,
        patch: { fees: { ask_donor_to_cover: on(read, "ask_donor_to_cover") }, boli: { soft_close_minutes: on(read, "boli_soft_close") ? 5 : 0 } },
      };
    case "lunch": {
      const { errors, ok } = collect({
        slot: wholeNumber(read, "slot_minutes", "The slot length", 5, 240),
        remind: wholeNumber(read, "reminder_minutes_before", "The lunch reminder", 0, 120),
        rsvp: wholeNumber(read, "confirmation_hours_before", "The RSVP confirmation", 0, 720),
      });
      if (errors.length) return fail(errors);
      return {
        ok: true,
        patch: {
          lunch: {
            slot_minutes: ok.slot,
            family_with_child_under_12_at_start: on(read, "family_with_child_under_12_at_start"),
            senior_at_start: on(read, "senior_at_start"),
            reminder_minutes_before: ok.remind,
          },
          rsvp: { confirmation_hours_before: ok.rsvp },
        },
      };
    }
    case "bolis_store": {
      const step = parseDollarsToCents(read("boli_step") ?? "");
      const pack = parseDollarsToCents(read("gift_pack") ?? "");
      const errors: string[] = [];
      if (step === null || step < 1) errors.push("The boli step must be an amount like 21.00 (at least one cent).");
      if (pack === null) errors.push("The gift packing price must be an amount like 2.99.");
      const cancel = wholeNumber(read, "cancel_hours_before_pickup", "The cancellation window", 0, 720);
      if (typeof cancel === "string") errors.push(cancel);
      if (errors.length) return fail(errors);
      return {
        ok: true,
        patch: { boli: { step_cents: step as number }, store: { gift_pack_cents: pack as number, cancel_hours_before_pickup: cancel as number } },
      };
    }
    case "points": {
      const { errors, ok } = collect({
        day_complete_bonus: wholeNumber(read, "day_complete_bonus", "The day-complete bonus", 0, 1000),
        streak_rest_days_per_month: wholeNumber(read, "streak_rest_days_per_month", "Streak rest days", 0, 31),
        anumodana_points: wholeNumber(read, "anumodana_points", "Anumodana points", 0, 1000),
        anumodana_daily_cap: wholeNumber(read, "anumodana_daily_cap", "The anumodana daily limit", 0, 1000),
        support_points: wholeNumber(read, "support_points", "Saathi support points", 0, 1000),
        behind_after_days: wholeNumber(read, "behind_after_days", "\"Behind\" after", 1, 60),
      });
      if (errors.length) return fail(errors);
      return { ok: true, patch: { points: ok } };
    }
    case "onboarding": {
      const fields: RulesObject = {};
      const errors: string[] = [];
      for (const f of ONBOARDING_FIELDS) {
        if (f.alwaysAsked) continue;
        const v = read(`field_${f.key}`);
        if (!isFieldSetting(v)) errors.push(`Choose Required, Optional or Hidden for "${f.label}".`);
        else fields[f.key] = v;
      }
      if (errors.length) return fail(errors);
      return { ok: true, patch: { onboarding: { fields } } };
    }
    case "notifications": {
      const { errors, ok } = collect({
        quiet_start_hour: wholeNumber(read, "quiet_start_hour", "The start of quiet hours", 0, 23),
        quiet_end_hour: wholeNumber(read, "quiet_end_hour", "The end of quiet hours", 0, 23),
      });
      if (errors.length) return fail(errors);
      const triggers: RulesObject = {};
      for (const t of NOTIFICATION_TRIGGERS) triggers[t.key] = on(read, `trigger_${t.key}`);
      return {
        ok: true,
        patch: { notifications: { ...ok, event_day_during_quiet_hours: on(read, "event_day_during_quiet_hours"), triggers } },
      };
    }
    case "security": {
      const { errors, ok } = collect({
        admin_session_hours: wholeNumber(read, "admin_session_hours", "The admin session length", 1, 24),
        admin_idle_minutes: wholeNumber(read, "admin_idle_minutes", "The idle timeout", 5, 240),
      });
      if (errors.length) return fail(errors);
      return { ok: true, patch: { security: { ...ok, printed_signin_codes: on(read, "printed_signin_codes") } } };
    }
  }
}
