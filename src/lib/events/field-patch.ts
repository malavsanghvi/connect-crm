// Change ONE field of an event, with the same rules the event builder applies when it saves the whole form
// (src/app/(app)/events/actions.ts eventValues): a name is required, the event ends after it starts, RSVPs close after they
// open, a capacity or a reminder is a whole number in range. Pure: the commands events.draft_change and events.set_field use it
// to show the before and after and to write the one column. Money, status, the audience and who owns the event are not here:
// they have their own rules and their own screens.

import { formatDateTime, fromDateTimeLocal } from "@/lib/events/format";

export const EVENT_FIELDS = [
  "name",
  "description",
  "venue",
  "starts_at",
  "ends_at",
  "capacity",
  "rsvp_opens_at",
  "rsvp_closes_at",
  "confirmation_hours_before",
  "waitlist_enabled",
] as const;
export type EventField = (typeof EVENT_FIELDS)[number];

type Kind = "text" | "datetime" | "int" | "bool";
type Info = { label: string; kind: Kind; required: boolean; max?: number; min?: number; hint: string };

export const EVENT_FIELD_INFO: Record<EventField, Info> = {
  name: { label: "Event name", kind: "text", required: true, max: 200, hint: "the new name" },
  description: { label: "Description", kind: "text", required: false, max: 4000, hint: "the new description; empty clears it" },
  venue: { label: "Venue", kind: "text", required: false, max: 300, hint: "the new venue; empty clears it" },
  starts_at: { label: "Starts", kind: "datetime", required: true, hint: "date and time like 2026-11-08T11:30 in the community's time zone" },
  ends_at: { label: "Ends", kind: "datetime", required: false, hint: "date and time like 2026-11-08T14:00; empty clears it" },
  capacity: { label: "Capacity", kind: "int", required: false, min: 0, max: 100000, hint: "a whole number of people; empty means no limit" },
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

/** Read what a person (or a model) typed for one field. An empty value clears the fields that may be empty. */
export function parseEventField(field: EventField, raw: string, tz: string): ParsedField {
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
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(text);
      const valid = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31 && Number(m[4]) <= 23 && Number(m[5]) <= 59 && !Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`));
      const iso = valid ? fromDateTimeLocal(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, tz) : null;
      // 2026-02-31 rolls over to March in Date: reject a day the month does not have.
      if (!iso || (m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDate() !== Number(m[3]))) {
        return { ok: false, error: `${info.label} must be a date and time like 2026-11-08T11:30.` };
      }
      return { ok: true, value: iso };
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

/** A stored value as a person reads it. */
export function describeEventField(field: EventField, value: unknown, tz: string): string {
  const info = EVENT_FIELD_INFO[field];
  if (info.kind === "bool") return value === true ? "Yes" : "No";
  if (value === null || value === undefined || value === "") {
    return field === "capacity" ? "No limit" : "Not set";
  }
  if (info.kind === "datetime") return formatDateTime(String(value), tz);
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
