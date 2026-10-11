// The Events workspace in the new look (look "v2"): one event, its numbers, what blocks it going live, and Niva beside it with the
// reminder in each of the community's languages and the audience. Pure: everything here turns what was already loaded (the event,
// app.event_summary, the readiness check, the Niva commands' answers) into what the page shows. Counts only for people: no name of
// anyone under 18 is ever in here, and the household cards come from the command layer with adults only.

import type { HouseholdCard } from "@/lib/commands/types";
import type { DueTone } from "@/lib/events/checklist";
import { dueBadge } from "@/lib/events/checklist";
import { EVENT_FIELD_INFO, type EventField } from "@/lib/events/field-patch";
import type { ReadinessGoal } from "@/lib/events/readiness";
import { placesLeft, summarySentences, type EventSummary } from "@/lib/events/summary";
import { languageList, languageName, nativeLanguageName } from "@/lib/languages";

/** One part of the page: what it shows, or the plain sentence that says why it can't (said on the card, never hidden). */
export type Piece<T> = { ok: true; data: T } | { ok: false; error: string };

/** Two households in the reminder's audience, as cards (adults only), and how many there are. */
export type WorkspaceHouseholds = { total: number; cards: HouseholdCard[] };

/** The tabs the board draws, in its order. "checkin" opens the live check-in screen; the rest are ?tab= views of this page. */
export const WORKSPACE_TABS = ["overview", "rsvps", "lunch", "volunteers", "checkin", "survey"] as const;
/** Every view the new-look event page can show: the board's tabs plus the classic page's other three, reached from the header. */
export const WORKSPACE_VIEWS = ["overview", "rsvps", "lunch", "volunteers", "survey", "details", "checklist", "report"] as const;
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

const TAB_LABEL: Record<(typeof WORKSPACE_TABS)[number], string> = {
  overview: "Overview",
  rsvps: "RSVPs",
  lunch: "Meals",
  volunteers: "Volunteers",
  checkin: "Check-in",
  survey: "Feedback",
};

export type WorkspaceTab = { key: (typeof WORKSPACE_TABS)[number]; label: string; href: string; current: boolean };

/** The view a ?tab= value asks for; anything else is the overview. */
export function workspaceView(raw: string | null | undefined): WorkspaceView {
  return (WORKSPACE_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as WorkspaceView) : "overview";
}

export function workspaceHref(eventId: string, view: WorkspaceView): string {
  return view === "overview" ? `/events/${eventId}` : `/events/${eventId}?tab=${view}`;
}

export function workspaceTabs(eventId: string, view: WorkspaceView): WorkspaceTab[] {
  return WORKSPACE_TABS.map((key) => ({
    key,
    label: TAB_LABEL[key],
    href: key === "checkin" ? `/events/live?event=${eventId}` : workspaceHref(eventId, key),
    current: key === view,
  }));
}

// ---------------------------------------------------------------------------
// The four numbers
// ---------------------------------------------------------------------------
export type TileTone = "indigo" | "blue" | "sun" | "green";
export type WorkspaceTile = { key: "attending" | "households" | "meals" | "volunteers"; label: string; value: string; sub: string; tone: TileTone };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const count = (n: number) => n.toLocaleString("en-US");

/** Attending, households, meals and volunteers, from app.event_summary. People are counted, never named. */
export function workspaceTiles(s: EventSummary): WorkspaceTile[] {
  const left = placesLeft(s);
  const attending: WorkspaceTile = {
    key: "attending",
    label: "Attending",
    value: count(s.people.rsvpd),
    sub: s.event.capacity === null ? "No capacity limit" : `of ${count(s.event.capacity)} places${left === 0 ? ", full" : ""}`,
    tone: "indigo",
  };

  const h = s.households;
  const going = (h.rsvpd ?? 0) + (h.confirmed ?? 0) + (h.attended ?? 0);
  const extra = [
    `${count(h.confirmed ?? 0)} confirmed`,
    (h.waitlisted ?? 0) > 0 ? `${count(h.waitlisted ?? 0)} waiting` : null,
    (h.cancelled ?? 0) > 0 ? `${count(h.cancelled ?? 0)} cancelled` : null,
  ].filter(Boolean);
  const households: WorkspaceTile = { key: "households", label: "Households", value: count(going), sub: extra.join(" · "), tone: "blue" };

  const l = s.lunch;
  const meals: WorkspaceTile =
    l.enabled || l.slots > 0
      ? {
          key: "meals",
          label: "Meal seats taken",
          value: count(l.assigned),
          sub: l.unlimited_slots > 0 ? `${plural(l.slots, "slot")}, ${plural(l.unlimited_slots, "open slot")}` : `of ${count(l.seats)} seats in ${plural(l.slots, "slot")}`,
          tone: "sun",
        }
      : { key: "meals", label: "Meals", value: "Off", sub: "No meal for this event", tone: "sun" };

  const v = s.volunteers;
  let volunteers: WorkspaceTile;
  if (v.shifts === 0) volunteers = { key: "volunteers", label: "Volunteers", value: "0", sub: "No shifts yet", tone: "green" };
  else if (!v.visible) volunteers = { key: "volunteers", label: "Volunteers", value: count(v.spots_needed), sub: `places in ${plural(v.shifts, "shift")}; your role can't see who is assigned`, tone: "green" };
  else {
    const open = v.shifts_open ?? 0;
    volunteers = { key: "volunteers", label: "Volunteers", value: `${count(v.assigned ?? 0)} / ${count(v.spots_needed)}`, sub: open > 0 ? `${plural(open, "shift")} open` : "Every shift is filled", tone: "green" };
  }
  return [attending, households, meals, volunteers];
}

// ---------------------------------------------------------------------------
// RSVPs by status (the board's "by area, against last year" is Coming next)
// ---------------------------------------------------------------------------
export type RsvpBar = { key: string; label: string; households: number; pct: number };

const BAR_ROWS: { key: string; label: string }[] = [
  { key: "rsvpd", label: "RSVP'd" },
  { key: "confirmed", label: "Confirmed" },
  { key: "attended", label: "Checked in" },
  { key: "waitlisted", label: "Waiting list" },
  { key: "cancelled", label: "Cancelled" },
];

/** Households by RSVP status as bars against the largest. Waiting list and cancelled show only when there are some. */
export function rsvpBars(s: EventSummary): RsvpBar[] {
  const rows = BAR_ROWS.map((r) => ({ ...r, households: s.households[r.key] ?? 0 })).filter(
    (r) => r.households > 0 || r.key === "rsvpd" || r.key === "confirmed",
  );
  const max = Math.max(1, ...rows.map((r) => r.households));
  return rows.map((r) => ({ ...r, pct: Math.round((r.households / max) * 100) }));
}

/** The line under the bars: the event's first summary sentence ("412 people have RSVP'd (300 confirmed); 450 places, 38 left."). */
export function rsvpLine(s: EventSummary): string {
  return summarySentences(s)[0] ?? "";
}

// ---------------------------------------------------------------------------
// Checklist preview
// ---------------------------------------------------------------------------
export type ChecklistRow = { id: string; name: string; state: string; due_on: string | null };
export type ChecklistItem = { id: string; name: string; done: boolean; due: { label: string; tone: DueTone } | null };

/** The first few checklist actions: done ones first (as the board draws them), then what is open, by due date. Removed ones are left out. */
export function checklistPreview(rows: readonly ChecklistRow[], today: string, max = 7): ChecklistItem[] {
  const live = rows.filter((r) => r.state !== "removed");
  const done = live.filter((r) => r.state === "completed");
  const open = live.filter((r) => r.state !== "completed");
  return [...done, ...open].slice(0, max).map((r) => {
    const isDone = r.state === "completed";
    const badge = dueBadge(r, today);
    return { id: r.id, name: r.name, done: isDone, due: isDone || badge.label === "No date" ? null : badge };
  });
}

// ---------------------------------------------------------------------------
// Readiness and what Niva says first
// ---------------------------------------------------------------------------
/** A draft is checked for opening RSVPs; an event already open is checked for the day itself (check-in). */
export function readinessGoalFor(status: string): ReadinessGoal {
  return status === "draft" ? "publish" : "event_day";
}

export function readinessTitle(goal: ReadinessGoal): string {
  return goal === "publish" ? "What is blocking this going live" : "What is left before the day";
}

/** Niva's first line beside the event: the RSVPs in numbers and how many things block it. Worded by rule, never by a model. */
export function nivaOpening(s: EventSummary | null, blockers: number | null, languages: readonly string[]): string {
  const parts: string[] = [];
  if (s) {
    const going = (s.households.rsvpd ?? 0) + (s.households.confirmed ?? 0) + (s.households.attended ?? 0);
    parts.push(`${plural(going, "household")} ${going === 1 ? "has" : "have"} RSVP'd so far, ${plural(s.people.rsvpd, "person", "people")} in all.`);
  }
  if (blockers !== null) parts.push(blockers === 0 ? "Nothing is blocking it." : `${plural(blockers, "thing")} ${blockers === 1 ? "needs" : "need"} fixing first.`);
  const names = languages.map((l) => languageName(l));
  parts.push(names.length > 1 ? `I drafted the reminder in ${languageList(languages)}.` : `I drafted the reminder in ${names[0] ?? "English"}.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// The reminder, one tab per language the community uses
// ---------------------------------------------------------------------------
export type DraftLike = { language: string; language_name: string; direction: "ltr" | "rtl"; text_direction: "ltr" | "rtl"; subject: string; body: string; source: string; needs_translation: boolean };

export type LanguageTab = {
  code: string;
  /** The language in its own script when Weaver knows it ("Español", "हिन्दी"), else its English name. */
  label: string;
  /** Its English name, for the note under the text. */
  name: string;
  subject: string;
  body: string;
  /** The way the drafted text runs (an English stand-in for Arabic still runs left to right). */
  dir: "ltr" | "rtl";
  needsTranslation: boolean;
  /** The line under the draft: who should check it, or that it needs translating. */
  note: string;
};

function capitalise(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

export function languageTabs(drafts: readonly DraftLike[]): LanguageTab[] {
  return drafts.map((d) => {
    const name = languageName(d.language);
    const native = nativeLanguageName(d.language);
    const note = d.needs_translation
      ? `Weaver has no ${name} wording for this yet, so this is the English text. Ask someone who reads ${name} to translate it before it goes out.`
      : d.source === "community_template"
        ? `From your saved ${name} template. Read it through before it goes out.`
        : `Drafted by Niva from the event's details. Have someone who reads ${name} check the wording before you send.`;
    return { code: d.language, label: capitalise(native ?? name), name, subject: d.subject, body: d.body, dir: d.text_direction, needsTranslation: d.needs_translation, note };
  });
}

// ---------------------------------------------------------------------------
// The audience, counted
// ---------------------------------------------------------------------------
export type AudienceLike = {
  who: string;
  households: number;
  adults: number | null;
  channels: { email: number | null; sms: number | null; whatsapp: number | null };
  adults_with_no_channel: number | null;
  quiet_hours: { window: string; goes_out_at: string; held: boolean; note: string };
  notes: string[];
};
export type AudienceTile = { key: string; text: string; strong: string; tone: "plain" | "warn" | "bad" };

/** The audience card's tiles: email, text, WhatsApp, quiet hours, and who cannot be reached. Null counts (role can't see) say so. */
export function audienceTiles(a: AudienceLike): AudienceTile[] {
  const n = (v: number | null) => (v === null ? "?" : count(v));
  const tiles: AudienceTile[] = [
    { key: "email", strong: n(a.channels.email), text: "by email", tone: "plain" },
    { key: "sms", strong: n(a.channels.sms), text: "by text", tone: "plain" },
    { key: "whatsapp", strong: n(a.channels.whatsapp), text: "by WhatsApp", tone: "plain" },
    a.quiet_hours.held
      ? { key: "quiet", strong: "Held", text: `until ${a.quiet_hours.goes_out_at} (quiet hours)`, tone: "warn" }
      : { key: "quiet", strong: "Goes at once", text: `quiet hours are ${a.quiet_hours.window}`, tone: "plain" },
  ];
  if (a.adults_with_no_channel !== null && a.adults_with_no_channel > 0) {
    tiles.push({ key: "none", strong: count(a.adults_with_no_channel), text: a.adults_with_no_channel === 1 ? "adult cannot be reached" : "adults cannot be reached", tone: "bad" });
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Change one thing, copy to a new date
// ---------------------------------------------------------------------------
/** The details "change one thing" offers, in the order a person thinks of them (the precise date-and-time ones are left to Niva). */
export const CHANGE_FIELDS: readonly EventField[] = ["date", "start_time", "end_time", "venue", "name", "capacity", "rsvp_closes_at", "description"];

export type ChangeFieldOption = { value: EventField; label: string; hint: string; input: "text" | "date" | "time" | "datetime-local" | "number" };

const INPUT_FOR = { text: "text", date: "date", time: "time", datetime: "datetime-local", int: "number", bool: "text", choice: "text" } as const;

export function changeFieldOptions(): ChangeFieldOption[] {
  return CHANGE_FIELDS.map((f) => ({ value: f, label: EVENT_FIELD_INFO[f].label, hint: EVENT_FIELD_INFO[f].hint, input: INPUT_FOR[EVENT_FIELD_INFO[f].kind] }));
}

/** The same day a year later ("2025-11-07" gives "2026-11-07"; 29 February gives 28 February), the copy's first suggested date. */
export function sameDayNextYear(localDate: string | null, today: string): string {
  const base = localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : today;
  const [y, m, d] = base.split("-").map(Number);
  const next = y + 1;
  const last = new Date(Date.UTC(next, m, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${next}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "Saturday, November 7, 2026 · 6:00 PM" in the community's time zone and locale, or "No date yet". */
export function eventWhenLine(startsAt: string | null, tz: string, locale = "en-US"): string {
  if (!startsAt) return "No date yet";
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "No date yet";
  try {
    const day = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
    const time = new Intl.DateTimeFormat(locale, { timeZone: tz, timeStyle: "short" }).format(d);
    return `${day} · ${time}`;
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}
