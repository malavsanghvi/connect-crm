// Change ONE detail of an event, with the same rules the event builder applies when it saves the whole form
// (src/app/(app)/events/actions.ts eventValues): a name is required, the event ends after it starts, RSVPs close after they
// open, a capacity or a reminder is a whole number in range. Pure: the commands events.draft_change and events.set_field use it
// to show the before and after and to write the columns. Money, status and who owns the event are not here: they have their own
// rules and their own screens. "Who can RSVP" (the audience) is: it is one of five fixed words, and the preview says what members
// would notice. "Date", "start time" and "end time" are conveniences over starts_at / ends_at / lunch_starts_at so that "move it to
// November 9" keeps the times of day.

import { addDays, daysBetween, isoToLocalDateTime } from "@/lib/dates";
import { formatDateTime, fromDateTimeLocal } from "@/lib/events/format";
import { AUDIENCES, audienceLabel } from "@/lib/events/report";

export const EVENT_FIELDS = [
  "name",
  "description",
  "venue",
  "date",
  "start_time",
  "end_time",
  "starts_at",
  "ends_at",
  "capacity",
  "audience",
  "rsvp_opens_at",
  "rsvp_closes_at",
  "confirmation_hours_before",
  "waitlist_enabled",
] as const;
export type EventField = (typeof EVENT_FIELDS)[number];

type Kind = "text" | "datetime" | "int" | "bool" | "date" | "time" | "choice";
type Info = { label: string; kind: Kind; required: boolean; max?: number; min?: number; hint: string };

export const EVENT_FIELD_INFO: Record<EventField, Info> = {
  name: { label: "Event name", kind: "text", required: true, max: 200, hint: "the new name" },
  description: { label: "Description", kind: "text", required: false, max: 4000, hint: "the new description; empty clears it" },
  venue: { label: "Venue", kind: "text", required: false, max: 300, hint: "the new venue; empty clears it" },
  date: { label: "Date", kind: "date", required: true, hint: "the new day like 2026-11-08; the start and end times of day stay as they are (a lunch start moves with it)" },
  start_time: { label: "Start time", kind: "time", required: true, hint: "the new start time like 11:30 (24-hour) on the same day" },
  end_time: { label: "End time", kind: "time", required: true, hint: "the new end time like 14:00 (24-hour) on the same day" },
  starts_at: { label: "Starts", kind: "datetime", required: true, hint: "date and time like 2026-11-08T11:30 in the community's time zone" },
  ends_at: { label: "Ends", kind: "datetime", required: false, hint: "date and time like 2026-11-08T14:00; empty clears it" },
  capacity: { label: "Capacity", kind: "int", required: false, min: 0, max: 100000, hint: "a whole number of people; empty means no limit" },
  audience: { label: "Who can RSVP", kind: "choice", required: true, hint: "everyone, members, life members or pathshala families" },
  rsvp_opens_at: { label: "RSVP opens", kind: "datetime", required: false, hint: "date and time like 2026-11-01T09:00; empty clears it" },
  rsvp_closes_at: { label: "RSVP closes", kind: "datetime", required: false, hint: "date and time like 2026-11-06T21:00; empty clears it" },
  confirmation_hours_before: { label: "Confirmation reminder", kind: "int", required: true, min: 0, max: 336, hint: "hours before the event, 1 to 336; 0 turns the reminder off" },
  waitlist_enabled: { label: "Waitlist", kind: "bool", required: true, hint: "yes or no" },
};

export function isEventField(v: unknown): v is EventField {
  return typeof v === "string" && (EVENT_FIELDS as readonly string[]).includes(v);
}

export type FieldValue = string | number | boolean | null;

export type ParsedField = { ok: true; value: FieldValue } | { ok: false; error: string };

const YES = new Set(["yes", "true", "on", "1"]);
const NO = new Set(["no", "false", "off", "0"]);

/** What a person might say for "who can RSVP", mapped to the stored word. "Everyone" keeps an open-to-the-public event public. */
export function parseAudience(raw: string, current?: string | null): string | null {
  const t = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if ((AUDIENCES as readonly string[]).includes(t.replace(/ /g, "_"))) return t.replace(/ /g, "_");
  if (["everyone", "all", "anyone", "members and guests", "members and their guests", "guests"].includes(t)) return current === "public" ? "public" : "members_and_guests";
  if (["members", "members only", "member"].includes(t)) return "members_only";
  if (["life members", "life members only", "life member"].includes(t)) return "life_members_only";
  if (["pathshala families", "pathshala", "school families", "pathshala families only"].includes(t)) return "pathshala_families";
  if (["public", "open to the public"].includes(t)) return "public";
  return null;
}

function realDay(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
}

/** "19:00", "7:30 pm" and "7pm" as "HH:MM"; null when it is not a time of day. */
export function parseTimeOfDay(raw: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const mer = m[3]?.toLowerCase().replace(/\./g, "");
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mer === "pm" ? 12 : 0);
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** A date and time like "2026-11-08T11:30" (or with a space) read as the community's wall clock, as an ISO moment. */
export function parseLocalDateTime(raw: string, tz: string, label: string): ParsedField {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(raw.trim());
  const valid = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31 && Number(m[4]) <= 23 && Number(m[5]) <= 59 && !Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`));
  const iso = valid ? fromDateTimeLocal(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, tz) : null;
  // 2026-02-31 rolls over to March in Date: reject a day the month does not have.
  if (!iso || (m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDate() !== Number(m[3]))) {
    return { ok: false, error: `${label} must be a date and time like 2026-11-08T11:30.` };
  }
  return { ok: true, value: iso };
}

/** Read what a person (or a model) typed for one field. An empty value clears the fields that may be empty. */
export function parseEventField(field: EventField, raw: string, tz: string, current?: { audience?: string | null }): ParsedField {
  const info = EVENT_FIELD_INFO[field];
  const text = raw.trim();
  const clear = text === "";
  if (clear && info.required && info.kind !== "bool") return { ok: false, error: `${info.label} is required.` };
  switch (info.kind) {
    case "text": {
      if (clear) return { ok: true, value: null };
      if (Array.from(text).length > (info.max ?? 4000)) return { ok: false, error: `${info.label} can be at most ${info.max} characters.` };
      return { ok: true, value: text };
    }
    case "datetime": {
      if (clear) return { ok: true, value: null };
      return parseLocalDateTime(text, tz, info.label);
    }
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (!m || !realDay(Number(m[1]), Number(m[2]), Number(m[3]))) return { ok: false, error: `${info.label} must be a day like 2026-11-08.` };
      return { ok: true, value: text };
    }
    case "time": {
      const t = parseTimeOfDay(text);
      if (!t) return { ok: false, error: `${info.label} must be a time like 11:30 or 2:00 pm.` };
      return { ok: true, value: t };
    }
    case "choice": {
      const a = parseAudience(text, current?.audience);
      if (!a) return { ok: false, error: `${info.label} must be everyone, members, life members or pathshala families.` };
      return { ok: true, value: a };
    }
    case "int": {
      if (clear) return { ok: true, value: null };
      if (!/^\d+$/.test(text)) return { ok: false, error: `${info.label} must be a whole number.` };
      const n = Number(text);
      if (info.min !== undefined && n < info.min) return { ok: false, error: `${info.label} must be at least ${info.min}.` };
      if (info.max !== undefined && n > info.max) return { ok: false, error: `${info.label} must be at most ${info.max}.` };
      return { ok: true, value: n };
    }
    case "bool": {
      const v = text.toLowerCase();
      if (YES.has(v)) return { ok: true, value: true };
      if (NO.has(v)) return { ok: true, value: false };
      return { ok: false, error: `${info.label} must be yes or no.` };
    }
  }
}

const AUDIENCE_WORDS: Record<string, string> = {
  members_only: "Members only",
  life_members_only: "Life members only",
  pathshala_families: "Pathshala families",
  members_and_guests: "Everyone (members and their guests)",
  public: "Everyone (open to the public)",
};

/** A stored value as a person reads it. */
export function describeEventField(field: EventField, value: unknown, tz: string): string {
  const info = EVENT_FIELD_INFO[field];
  if (info.kind === "bool") return value === true ? "Yes" : "No";
  if (value === null || value === undefined || value === "") {
    return field === "capacity" ? "No limit" : "Not set";
  }
  if (info.kind === "datetime" || info.kind === "date" || info.kind === "time") return formatDateTime(String(value), tz);
  if (field === "audience") return AUDIENCE_WORDS[String(value)] ?? audienceLabel(String(value));
  if (field === "confirmation_hours_before") return value === 0 ? "Off" : `${value} hours before the event`;
  return String(value);
}

/** The dates a change must still fit with: the event as it is stored. */
export type EventDates = { starts_at: string | null; ends_at: string | null; rsvp_opens_at: string | null; rsvp_closes_at: string | null };

/** Same checks as the builder: the event ends after it starts, RSVPs close after they open. Null when the change fits. */
export function eventFieldConflict(field: EventField, value: FieldValue, current: EventDates): string | null {
  const next: EventDates = { ...current, ...(field === "starts_at" || field === "ends_at" || field === "rsvp_opens_at" || field === "rsvp_closes_at" ? { [field]: value as string | null } : {}) };
  // Stored values and typed ones are written differently ("+00:00" and "Z"): compare the moments, not the text.
  const notAfter = (later: string | null, earlier: string | null) => later !== null && earlier !== null && Date.parse(later) <= Date.parse(earlier);
  if ((field === "starts_at" || field === "ends_at") && notAfter(next.ends_at, next.starts_at)) {
    return "The event must end after it starts. Change the end time as well, or choose a later one.";
  }
  if ((field === "rsvp_opens_at" || field === "rsvp_closes_at") && notAfter(next.rsvp_closes_at, next.rsvp_opens_at)) {
    return "RSVPs must close after they open.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// The whole change: what it writes, and how it reads before and after
// ---------------------------------------------------------------------------
/** The columns of an event a one-detail change reads. */
export type EventFieldRow = EventDates & {
  name: string;
  description: string | null;
  venue: string | null;
  capacity: number | null;
  audience: string;
  confirmation_hours_before: number;
  waitlist_enabled: boolean;
  lunch_starts_at: string | null;
};

export type FieldPlan = {
  label: string;
  /** The event's value now, and what it would be, as a person reads them. */
  before: string;
  after: string;
  changed: boolean;
  /** The columns to write: one for most details, more for "date" (start, end and lunch start move together). */
  patch: Record<string, FieldValue>;
  /** Things to know that do not stop the change. */
  warnings: string[];
};

export type FieldPlanResult = ({ ok: true } & FieldPlan) | { ok: false; error: string };

const sameMoment = (a: unknown, b: unknown) => a !== null && b !== null && a !== undefined && b !== undefined && Date.parse(String(a)) === Date.parse(String(b));

/** The local day and time of day (HH:MM) of a stored moment. */
function localParts(iso: string, tz: string): { day: string; time: string } {
  const local = isoToLocalDateTime(iso, tz);
  return { day: local.slice(0, 10), time: local.slice(11, 16) };
}

/**
 * Work out one change: parse what was typed, apply the builder's rules, and say what would be written and how it reads before and
 * after. Everything a screen or a model needs is in the answer; nothing is read or written here. `now` only feeds a warning.
 */
export function planEventFieldChange(field: EventField, raw: string, row: EventFieldRow, tz: string, now: Date = new Date()): FieldPlanResult {
  const info = EVENT_FIELD_INFO[field];
  const parsed = parseEventField(field, raw, tz, row);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const warnings: string[] = [];

  if (info.kind === "date" || info.kind === "time") {
    if (!row.starts_at) return { ok: false, error: `This event has no start time yet, so there is no ${info.kind === "date" ? "time of day to keep" : "day to put it on"}. Set the start date and time instead.` };
    const start = localParts(row.starts_at, tz);
    const patch: Record<string, FieldValue> = {};
    if (field === "date") {
      const newDay = String(value);
      const delta = daysBetween(start.day, newDay);
      const move = (iso: string | null): string | null => {
        if (!iso) return null;
        const p = localParts(iso, tz);
        return fromDateTimeLocal(`${addDays(p.day, delta)}T${p.time}`, tz);
      };
      const newStart = move(row.starts_at);
      if (!newStart) return { ok: false, error: "That day could not be worked out. Try a date like 2026-11-08." };
      patch.starts_at = newStart;
      const newEnd = move(row.ends_at);
      if (newEnd) patch.ends_at = newEnd;
      const newLunch = move(row.lunch_starts_at);
      if (newLunch) patch.lunch_starts_at = newLunch;
      const closes = row.rsvp_closes_at ? Date.parse(row.rsvp_closes_at) : null;
      const opens = row.rsvp_opens_at ? Date.parse(row.rsvp_opens_at) : null;
      if (closes !== null && closes > Date.parse(newStart)) warnings.push("RSVPs are set to close after the new start time. Check the RSVP dates.");
      if (opens !== null && opens >= Date.parse(newStart)) warnings.push("RSVPs are set to open after the new start time. Check the RSVP dates.");
      if (Date.parse(newStart) < now.getTime()) warnings.push("That date has already passed.");
      if (row.lunch_starts_at) warnings.push("Lunch starts at the same time of day on the new date. Lunch slots that already exist are not moved.");
      return { ok: true, label: info.label, before: describeEventField("starts_at", row.starts_at, tz), after: describeEventField("starts_at", newStart, tz), changed: !sameMoment(row.starts_at, newStart), patch, warnings };
    }
    // start_time / end_time keep the day.
    const column = field === "start_time" ? "starts_at" : "ends_at";
    const baseDay = field === "start_time" ? start.day : row.ends_at ? localParts(row.ends_at, tz).day : start.day;
    const next = fromDateTimeLocal(`${baseDay}T${String(value)}`, tz);
    if (!next) return { ok: false, error: `${info.label} could not be worked out.` };
    const conflict = eventFieldConflict(column, next, row);
    if (conflict) return { ok: false, error: conflict };
    const current = column === "starts_at" ? row.starts_at : row.ends_at;
    return { ok: true, label: info.label, before: current ? formatDateTime(current, tz) : "Not set", after: formatDateTime(next, tz), changed: !sameMoment(current, next), patch: { [column]: next }, warnings };
  }

  const conflict = eventFieldConflict(field, value, row);
  if (conflict) return { ok: false, error: conflict };
  const current = (row as Record<string, unknown>)[field] as FieldValue;
  const same = current === value || (info.kind === "datetime" && sameMoment(current, value));
  return { ok: true, label: info.label, before: describeEventField(field, current, tz), after: describeEventField(field, value, tz), changed: !same, patch: { [field]: value }, warnings };
}
