// The pure core of click-to-edit on the Family page and the person slide-over (docs/PEOPLE_REDESIGN.md section 5).
// No server imports and no React: the same checks run in the browser (so a mistake shows under the field before anything is sent)
// and in the commands (which check again), and the tests need no database.
//
//   - edit units: which fields are changed together (a name is two fields) and which need a reason
//   - checkDraft: what was typed, turned into the canonical stored values, with the sentence for a mistake
//   - expect helpers: "the value the person saw", compared with the current row by the two update commands
//   - reduce: the state of one edit (idle, editing, saving, error, conflict) as a plain state machine
//   - sentences: saved, undone, error and conflict, always in plain words

import { ageOn } from "@/lib/dates";
import {
  FIELD_LABELS,
  RELATIONSHIP_OPTIONS,
  formatPhone,
  genderLabel,
  genderValue,
  languageLabel,
  listPhrase,
  parseHouseholdForm,
  parsePersonForm,
  relationshipLabel,
  toUsDate,
} from "@/lib/people";

// ---------------------------------------------------------------------------
// Fields and edit units
// ---------------------------------------------------------------------------
export type PersonFieldKey = "first_name" | "last_name" | "date_of_birth" | "gender" | "profession" | "employer" | "phone_e164" | "email" | "language" | "role";
export type HouseholdFieldKey =
  | "display_name"
  | "address_line1"
  | "address_line2"
  | "city"
  | "state_region"
  | "postal_code"
  | "zone_id"
  | "directory_opt_in"
  | "physical_mail_opt_in"
  | "notes";
export type FieldKey = PersonFieldKey | HouseholdFieldKey;

/** Values as the database holds them, in text: a missing value is "", a switch is "on" or "off". */
export type Values = Record<string, string>;

/** A thing that is edited in one go: one or several fields, saved together. */
export type EditUnit = {
  id: string;
  /** "Mobile", used in the field label and in sentences ("Saved Tunde's mobile"). */
  label: string;
  fields: readonly FieldKey[];
  /** Name and date of birth: Enter saves, with a one-line why (plan section 5). Leaving the field does not save. */
  needsReason: boolean;
};

const unit = (id: string, label: string, fields: readonly FieldKey[], needsReason = false): EditUnit => ({ id, label, fields, needsReason });

export const PERSON_UNITS = {
  name: unit("name", "name", ["first_name", "last_name"], true),
  relationship: unit("relationship", "relationship", ["role"]),
  mobile: unit("mobile", "mobile", ["phone_e164"]),
  email: unit("email", "email", ["email"]),
  language: unit("language", "language", ["language"]),
  dob: unit("dob", "birth date", ["date_of_birth"], true),
  gender: unit("gender", "gender", ["gender"]),
  profession: unit("profession", "profession", ["profession"]),
} as const satisfies Record<string, EditUnit>;

export const HOUSEHOLD_UNITS = {
  name: unit("hh-name", "name", ["display_name"]),
  address: unit("address", "address", ["address_line1", "address_line2", "city", "state_region", "postal_code", "zone_id"]),
  notes: unit("notes", "notes", ["notes"]),
  directory: unit("directory", "directory listing", ["directory_opt_in"]),
  mail: unit("mail", "physical mail", ["physical_mail_opt_in"]),
} as const satisfies Record<string, EditUnit>;

/** The people fields a screen may send (anything else is dropped by the action). */
export const PERSON_EDITABLE: readonly PersonFieldKey[] = ["first_name", "last_name", "date_of_birth", "gender", "profession", "employer", "phone_e164", "email", "language", "role"];
export const HOUSEHOLD_EDITABLE: readonly HouseholdFieldKey[] = [
  "display_name",
  "address_line1",
  "address_line2",
  "city",
  "state_region",
  "postal_code",
  "zone_id",
  "directory_opt_in",
  "physical_mail_opt_in",
  "notes",
];

export function fieldNoun(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Reasons (name and birth date)
// ---------------------------------------------------------------------------
export const DEFAULT_REASON = "Correction";
export const REASON_CHIPS = [DEFAULT_REASON, "Legal name change", "Married", "Verified from ID"] as const;
export const REASON_MAX = 300;

// ---------------------------------------------------------------------------
// Showing and checking values
// ---------------------------------------------------------------------------
const isSwitch = (key: string) => key === "directory_opt_in" || key === "physical_mail_opt_in";

/** The text a stored value is shown as when it is not being edited. "" stands for nothing recorded. */
export function displayValue(key: string, stored: string): string {
  if (!stored) return "";
  switch (key) {
    case "phone_e164":
      return formatPhone(stored);
    case "date_of_birth":
      return toUsDate(stored) || stored;
    case "gender":
      return genderLabel(stored);
    case "language":
      return languageLabel(stored);
    case "role":
      return relationshipLabel(stored);
    default:
      return stored;
  }
}

/** What the input holds when editing starts. */
export function toDraft(key: string, stored: string): string {
  if (key === "phone_e164") return formatPhone(stored);
  if (key === "date_of_birth") return toUsDate(stored);
  return stored;
}

export type CheckContext = {
  /** Today in the community's time zone, YYYY-MM-DD (a birth date cannot be later). */
  today: string;
  /** The community's own languages; a language outside them is refused. Left out: any language is taken. */
  languages?: readonly string[];
  /** The ids of the community's zones. */
  zoneIds?: readonly string[];
};

export type Checked = { ok: true; stored: Values } | { ok: false; error: string };

function asStored(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v);
}

/** What was typed for these fields, as the stored values (phone as +1713…, date as 1984-03-14, email in lower case), or the sentence for a mistake. */
export function checkDraft(u: EditUnit, draft: Values, ctx: CheckContext): Checked {
  const stored: Values = {};
  const person: Record<string, string> = {};
  const household: Record<string, string> = {};
  for (const k of u.fields) {
    const v = draft[k] ?? "";
    if (k === "role") {
      if (!RELATIONSHIP_OPTIONS.some((o) => o.value === v)) return { ok: false, error: "Choose a relationship from the list" };
      stored.role = v;
    } else if (isSwitch(k)) {
      stored[k] = v === "on" ? "on" : "off";
    } else if ((HOUSEHOLD_EDITABLE as readonly string[]).includes(k)) household[k] = v;
    else person[k] = v;
  }
  if (Object.keys(person).length > 0) {
    const parsed = parsePersonForm(person, ctx.today, ctx.languages);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    for (const k of Object.keys(person)) stored[k] = asStored((parsed.value as Record<string, unknown>)[k]);
  }
  if (Object.keys(household).length > 0) {
    const parsed = parseHouseholdForm(household, ctx.zoneIds ?? []);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    for (const k of Object.keys(household)) stored[k] = asStored((parsed.value as Record<string, unknown>)[k]);
  }
  return { ok: true, stored };
}

/** One value as text, for comparing: nothing, "" and null are the same; case does not matter for an email or a language; a legacy "F" is "female". */
export function normalizeStored(key: string, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "on" : "off";
  const s = String(v).trim();
  if (isSwitch(key)) return s === "on" || s === "true" || s === "yes" ? "on" : "off";
  if (key === "email" || key === "language") return s.toLowerCase();
  if (key === "gender") return genderValue(s) || s.toLowerCase();
  return s;
}

export function sameValue(key: string, a: unknown, b: unknown): boolean {
  return normalizeStored(key, a) === normalizeStored(key, b);
}

// ---------------------------------------------------------------------------
// Children and the age line
// ---------------------------------------------------------------------------
/** A birth date that moves someone across the age of majority says so ("This makes Aarav 12, a child"); null when nothing changes class. */
export function ageCrossing(a: { firstName: string; before: string | null | undefined; after: string | null | undefined; today: string; majority: number }): string | null {
  const now = ageOn(a.after, a.today);
  if (now === null) return null;
  const was = ageOn(a.before, a.today);
  const isAdult = now >= a.majority;
  if (was === null) return isAdult ? null : `This makes ${a.firstName} ${now}, a child`;
  if (was >= a.majority === isAdult) return null;
  return `This makes ${a.firstName} ${now}, ${isAdult ? "an adult" : "a child"}`;
}

export function possessive(name: string): string {
  const n = name.trim();
  if (!n) return "their";
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

// ---------------------------------------------------------------------------
// "The value the person saw" (expect) and conflicts
// ---------------------------------------------------------------------------
/** Every conflict sentence starts with this, so a screen can tell a conflict from any other refusal. */
export const CONFLICT_PREFIX = "Could not save — someone else changed this first";

export function isConflictMessage(message: string | null | undefined): boolean {
  return typeof message === "string" && message.startsWith(CONFLICT_PREFIX);
}

export function conflictSentence(fieldKeys: readonly string[]): string {
  const what = listPhrase([...new Set(fieldKeys.map(fieldNoun))]);
  return `${CONFLICT_PREFIX} (${what}). Nothing was saved: look at the new value and choose which to keep.`;
}

export type ParsedExpect = { ok: true; value: Values | null } | { ok: false; error: string };

/** `expect` arrives as JSON text of {field: value you saw}. Nothing given is fine (the old callers); a malformed one is refused, never ignored. */
export function parseExpect(raw: string | null | undefined): ParsedExpect {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "The value you saw (expect) must be JSON like {\"phone_e164\": \"+15125550101\"}." };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "The value you saw (expect) must be JSON like {\"phone_e164\": \"+15125550101\"}." };
  const out: Values = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v !== null && typeof v !== "string" && typeof v !== "boolean") return { ok: false, error: `The value you saw for ${fieldNoun(k)} must be text.` };
    out[k] = v === null ? "" : typeof v === "boolean" ? (v ? "on" : "off") : v;
  }
  return { ok: true, value: out };
}

/** Of the fields about to change, the ones whose current value is no longer the value that was seen. */
export function conflictKeys(expect: Values | null, current: Record<string, unknown>, changing: readonly string[]): string[] {
  if (!expect) return [];
  return changing.filter((k) => Object.prototype.hasOwnProperty.call(expect, k) && !sameValue(k, current[k], expect[k]));
}

/** Text a screen sends as `expect`. */
export function expectText(values: Values): string {
  return JSON.stringify(values);
}

// ---------------------------------------------------------------------------
// The state of one edit
// ---------------------------------------------------------------------------
export type EditPhase = "idle" | "editing" | "saving" | "error" | "conflict";

export type SavePayload = { fields: Values; expect: Values; reason: string | null };

export type EditState = {
  phase: EditPhase;
  /** The values as the server last confirmed them: what `expect` sends. */
  committed: Values;
  /** What the input holds (as typed). */
  draft: Values;
  reason: string;
  /** A mistake in what was typed, shown under the field. */
  problem: string | null;
  /** A failed save, in words, shown next to the field. */
  message: string | null;
  conflict: { theirs: Values; who: string | null; at: string | null } | null;
  /** What the save in flight sends. */
  pending: SavePayload | null;
};

export type EditEvent =
  | { type: "start" }
  | { type: "change"; key: string; value: string }
  | { type: "reason"; value: string }
  | { type: "cancel" }
  | { type: "submit" }
  | { type: "saved" }
  | { type: "failed"; message: string }
  | { type: "conflicted"; theirs: Values; who: string | null; at: string | null }
  | { type: "use_theirs" }
  | { type: "keep_mine" }
  | { type: "sync"; values: Values };

const pick = (from: Values, keys: readonly string[]): Values => Object.fromEntries(keys.map((k) => [k, from[k] ?? ""]));

function draftOf(u: EditUnit, committed: Values): Values {
  return Object.fromEntries(u.fields.map((k) => [k, toDraft(k, committed[k] ?? "")]));
}

export function initialEdit(u: EditUnit, committed: Values): EditState {
  const values = pick(committed, u.fields);
  return { phase: "idle", committed: values, draft: draftOf(u, values), reason: DEFAULT_REASON, problem: null, message: null, conflict: null, pending: null };
}

export function reduce(state: EditState, event: EditEvent, u: EditUnit, ctx: CheckContext): EditState {
  switch (event.type) {
    case "start":
      if (state.phase !== "idle") return state;
      return { ...state, phase: "editing", draft: draftOf(u, state.committed), reason: DEFAULT_REASON, problem: null, message: null };
    case "change":
      if (state.phase !== "editing" && state.phase !== "error") return state;
      return { ...state, phase: "editing", draft: { ...state.draft, [event.key]: event.value }, problem: null, message: null };
    case "reason":
      if (state.phase !== "editing" && state.phase !== "error") return state;
      return { ...state, reason: event.value.slice(0, REASON_MAX) };
    case "cancel":
      if (state.phase === "saving" || state.phase === "idle") return state;
      return { ...state, phase: "idle", draft: draftOf(u, state.committed), problem: null, message: null, conflict: null, pending: null };
    case "submit": {
      if (state.phase !== "editing" && state.phase !== "error") return state;
      const checked = checkDraft(u, state.draft, ctx);
      if (!checked.ok) return { ...state, phase: "editing", problem: checked.error, message: null };
      const changed = u.fields.filter((k) => !sameValue(k, checked.stored[k], state.committed[k]));
      if (changed.length === 0) return { ...state, phase: "idle", draft: draftOf(u, state.committed), problem: null, message: null };
      const reason = u.needsReason ? state.reason.trim() || DEFAULT_REASON : null;
      return {
        ...state,
        phase: "saving",
        problem: null,
        message: null,
        pending: { fields: pick(checked.stored, changed), expect: pick(state.committed, changed), reason },
      };
    }
    case "saved": {
      if (state.phase !== "saving" || !state.pending) return state;
      const committed = { ...state.committed, ...state.pending.fields };
      return { ...state, phase: "idle", committed, draft: draftOf(u, committed), problem: null, message: null, conflict: null, pending: null };
    }
    case "failed":
      if (state.phase !== "saving") return state;
      return { ...state, phase: "error", message: event.message, pending: null };
    case "conflicted":
      if (state.phase !== "saving") return state;
      return { ...state, phase: "conflict", conflict: { theirs: event.theirs, who: event.who, at: event.at } };
    case "use_theirs": {
      if (state.phase !== "conflict" || !state.conflict) return state;
      const committed = { ...state.committed, ...state.conflict.theirs };
      return { ...state, phase: "idle", committed, draft: draftOf(u, committed), conflict: null, pending: null, problem: null, message: null };
    }
    case "keep_mine": {
      if (state.phase !== "conflict" || !state.conflict || !state.pending) return state;
      // The value they wrote is now the one we have seen; our change goes on top of it.
      const seen = { ...state.committed, ...state.conflict.theirs };
      return {
        ...state,
        phase: "saving",
        committed: seen,
        conflict: null,
        pending: { ...state.pending, expect: pick(seen, Object.keys(state.pending.fields)) },
      };
    }
    case "sync": {
      // The page has new values (a refresh after a save, an undo, someone else's change). Only an idle field adopts them.
      if (state.phase !== "idle") return state;
      const values = pick({ ...state.committed, ...event.values }, u.fields);
      return { ...state, committed: values, draft: draftOf(u, values) };
    }
  }
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------
export type SaveKind = "access" | "conflict" | "step_up" | "other";

/** How long the Undo stays on the screen after a save. */
export const UNDO_MS = 30_000;

export function savedSentence(owner: string, unitLabel: string): string {
  return `Saved ${possessive(owner)} ${unitLabel}`;
}

export function undoneSentence(owner: string, unitLabel: string): string {
  return `Put ${possessive(owner)} ${unitLabel} back`;
}

/** The reason an Undo carries: it says what it undoes, so the history reads on its own. */
export function undoReason(unitLabel: string, original: string | null): string {
  return `Undo of ${unitLabel} change${original ? ` (${original})` : ""}`.slice(0, REASON_MAX);
}

const ACCESS = /you don't have permission|not have permission|you may not have permission|you can't see/i;

/** A refusal from the server, as the sentence for the field and the kind of thing it was. */
export function friendlySaveError(raw: string, ownerAndUnit: string): { message: string; kind: SaveKind } {
  if (isConflictMessage(raw)) return { message: raw, kind: "conflict" };
  if (/fresh 2FA check|CCSTP|step-up/i.test(raw)) return { message: raw, kind: "step_up" };
  if (ACCESS.test(raw)) return { message: `You don't have access to this area. ${capitalise(ownerAndUnit)} was not changed.`, kind: "access" };
  return { message: raw || `Could not save ${ownerAndUnit}. Try again.`, kind: "other" };
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "a minute ago", "2 hours ago", "on Oct 5": how long ago someone else changed a value. */
export function agoText(at: string | null | undefined, now: Date): string {
  if (!at) return "a moment ago";
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "a moment ago";
  const secs = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (secs < 45) return "a moment ago";
  const mins = Math.floor(secs / 60);
  if (mins < 2) return "a minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** "Ravi changed this a minute ago to (832) 555-0199": the conflict line, with the new value shown the way the field shows values. */
export function conflictLine(c: { who: string | null; at: string | null; keys: readonly string[]; theirs: Values }, now: Date): string {
  const shown = c.keys.map((k) => displayValue(k, c.theirs[k] ?? "") || "empty").join(" ");
  return `${c.who ?? "Someone"} changed this ${agoText(c.at, now)} to ${shown}. Your change was not saved.`;
}
