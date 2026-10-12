// Suggestions from the community's OWN data: its past events (venues, how many came, prices, meals, shifts, reminders, lessons
// learned), its other upcoming events (clashes) and its calendar layers (festivals, holidays, school days). Every suggestion
// carries the reason it is shown, and nothing is applied until the person picks it. Counts and settings only: never who came.
// Pure: the history is loaded on the server (src/lib/event-creator/load.ts) and passed in.

import { formatShortCents, toDateTimeLocal } from "@/lib/events/format";

import type { CardId, Clash, CreatorCtx, EventDraft, HistoryEvent, HistoryShift, Suggestion } from "./types";

// ---------------------------------------------------------------------------
// Words and days
// ---------------------------------------------------------------------------

const STOP = new Set(["the", "and", "for", "with", "our", "annual", "yearly", "event", "night", "day", "des", "del", "las", "los", "une", "und", "der", "die"]);

/** The significant words of a name, folded (accents off, lower case, any script), years and short words left out. */
export function nameWords(text: string): string[] {
  const folded = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const out: string[] = [];
  for (const w of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || /^\d+$/.test(w) || STOP.has(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

/** 0..1: how much two names share (twice the shared words over all the words: one common word in short names is not enough). */
export function nameSimilarity(a: string, b: string): number {
  const A = nameWords(a);
  const B = nameWords(b);
  if (!A.length || !B.length) return 0;
  const shared = A.filter((w) => B.includes(w)).length;
  return (2 * shared) / (A.length + B.length);
}

/** Every word of `short` is in `long` (a calendar day "Diwali" in "Diwali dinner and cultural program"). */
export function nameContains(long: string, short: string): boolean {
  const L = nameWords(long);
  const S = nameWords(short);
  return S.length > 0 && S.every((w) => L.includes(w));
}

export const SIMILAR = 0.5;

/** "YYYY-MM-DD" of an instant in the community's zone. */
export function localDay(iso: string, tz: string): string {
  return toDateTimeLocal(iso, tz).slice(0, 10);
}

function localTime(iso: string, tz: string): string {
  return toDateTimeLocal(iso, tz).slice(11, 16);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 1 for the first such weekday of its month, 2 for the second … */
function nthOfMonth(day: string): number {
  return Math.ceil(Number(day.slice(8, 10)) / 7);
}

function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Sun, Nov 8" in the community's locale. */
export function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(dayDate(day));
}

function monthYear(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", year: "numeric" }).format(dayDate(day));
}

function weekdayName(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" }).format(dayDate(day));
}

/** "6:00 PM" for "18:00" in the community's locale. */
export function formatClockText(hhmm: string, locale: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(Date.UTC(2026, 0, 1, h, m)));
}

const ORDINAL = ["first", "second", "third", "fourth", "fifth"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function money(cents: number, ctx: CreatorCtx): string {
  return formatShortCents(cents, ctx.currency);
}

// ---------------------------------------------------------------------------
// Similar past events
// ---------------------------------------------------------------------------

/** Past events like this name, best first (ties: the most recent). */
export function similarPast(name: string, ctx: CreatorCtx): HistoryEvent[] {
  if (!nameWords(name).length) return [];
  return ctx.history.past
    .map((e, i) => ({ e, i, s: nameSimilarity(name, e.name) }))
    .filter((x) => x.s >= SIMILAR)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.e);
}

export function mostSimilar(name: string, ctx: CreatorCtx): HistoryEvent | null {
  return similarPast(name, ctx)[0] ?? null;
}

/** The community's usual start time: the most common one of its past events, else 6 pm. */
function usualStart(ctx: CreatorCtx): string {
  const count = new Map<string, number>();
  for (const e of ctx.history.past) if (e.starts_at) count.set(localTime(e.starts_at, ctx.tz), (count.get(localTime(e.starts_at, ctx.tz)) ?? 0) + 1);
  let best = "18:00";
  let n = 0;
  for (const [t, c] of count) if (c > n) [best, n] = [t, c];
  return best;
}

function durationMinutes(e: HistoryEvent | null): number | null {
  if (!e?.starts_at || !e.ends_at) return null;
  const m = Math.round((Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60000);
  return m > 0 && m <= 24 * 60 ? m : null;
}

function plusMinutes(local: string, minutes: number): string {
  const [day, time] = local.split("T");
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const d = addDays(day, Math.floor(total / 1440));
  const rest = ((total % 1440) + 1440) % 1440;
  return `${d}T${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Clashes
// ---------------------------------------------------------------------------

const sameText = (a: string | null, b: string | null) => !!a && !!b && nameWords(a).join(" ") === nameWords(b).join(" ") && nameWords(a).length > 0;

/** What else is on that day: the community's other events (same venue = a warning) and its calendar days (for information). */
export function clashesOn(day: string, venue: string | null, ctx: CreatorCtx, exceptId: string | null = null): Clash[] {
  const out: Clash[] = [];
  for (const e of ctx.history.upcoming) {
    if (!e.starts_at || e.id === exceptId || e.status === "cancelled") continue;
    const from = localDay(e.starts_at, ctx.tz);
    const to = e.ends_at ? localDay(e.ends_at, ctx.tz) : from;
    if (day < from || day > to) continue;
    const at = formatClockText(localTime(e.starts_at, ctx.tz), ctx.locale);
    if (venue && sameText(venue, e.venue)) out.push({ level: "warn", text: `${e.name} is at ${e.venue} that day too (${at}).` });
    else out.push({ level: "info", text: `Also that day: ${e.name} (${at}${e.venue ? `, ${e.venue}` : ""}).` });
  }
  for (const c of ctx.history.calendar) {
    if (day < c.starts_on || day > (c.ends_on ?? c.starts_on)) continue;
    out.push({ level: "info", text: `${c.title} is on your ${c.layer} calendar that day.` });
  }
  return out;
}

/** The clashes for the draft's own date. */
export function clashesFor(draft: EventDraft, ctx: CreatorCtx): Clash[] {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(draft.starts_at)) return [];
  return clashesOn(draft.starts_at.slice(0, 10), draft.venue.trim() || null, ctx, draft.id);
}

function clashLine(day: string, venue: string | null, ctx: CreatorCtx, exceptId: string | null): string {
  const list = clashesOn(day, venue, ctx, exceptId).filter((c) => !c.text.endsWith("calendar that day."));
  if (!list.length) return "No other events that day.";
  return list.length === 1 ? list[0].text : `${plural(list.length, "other event")} that day.`;
}

// ---------------------------------------------------------------------------
// Card 1: dates
// ---------------------------------------------------------------------------

export type WhenValue = { starts_at: string; ends_at: string };

/**
 * Up to three dates, best first, each with its reason: a matching day on the community's calendar ("Christmas Eve, on your
 * Holidays calendar"), the next date of a regular series ("The second Thursday, like the last 3 times"), and about a year after
 * the most similar past event, on the same weekday. Each says what else is on that day.
 */
export function dateSuggestions(draft: EventDraft, ctx: CreatorCtx): Suggestion<WhenValue>[] {
  const today = localDay(ctx.now, ctx.tz);
  const horizon = addDays(today, 400);
  const sims = similarPast(draft.name, ctx);
  const sim = sims[0] ?? null;
  const time = sim?.starts_at ? localTime(sim.starts_at, ctx.tz) : usualStart(ctx);
  const length = durationMinutes(sim);
  const venue = draft.venue.trim() || sim?.venue || null;
  const found: { day: string; why: string; source: "calendar" | "history" }[] = [];

  // A day on the community's calendar with the same words ("Diwali" in "Diwali dinner").
  if (nameWords(draft.name).length) {
    for (const c of ctx.history.calendar) {
      if (c.starts_on < today || c.starts_on > horizon || !nameContains(draft.name, c.title)) continue;
      found.push({ day: c.starts_on, why: `${c.title}, on your ${c.layer} calendar.`, source: "calendar" });
      break;
    }
  }

  // A regular series: the similar past events share a weekday and its place in the month.
  const dated = sims.filter((e) => e.starts_at).slice(0, 4);
  if (dated.length >= 2) {
    const days = dated.map((e) => localDay(e.starts_at!, ctx.tz));
    const wd = weekday(days[0]);
    const nth = nthOfMonth(days[0]);
    if (days.every((d) => weekday(d) === wd && nthOfMonth(d) === nth) && nth <= 4) {
      let d = today;
      for (let i = 0; i < 400; i++, d = addDays(d, 1)) {
        if (d > today && weekday(d) === wd && nthOfMonth(d) === nth) break;
      }
      found.push({ day: d, why: `The ${ORDINAL[nth - 1]} ${weekdayName(d, ctx.locale)} of the month, like the last ${dated.length} times.`, source: "history" });
    }
  }

  // About a year after the most similar past event, on the same weekday.
  if (sim?.starts_at) {
    const was = localDay(sim.starts_at, ctx.tz);
    let d = addDays(was, 364);
    while (d <= today) d = addDays(d, 364);
    if (d <= horizon) found.push({ day: d, why: `About a year after ${sim.name} (${formatDay(was, ctx.locale)}, ${was.slice(0, 4)}), on the same weekday.`, source: "history" });
  }

  const seen = new Set<string>();
  const out: Suggestion<WhenValue>[] = [];
  for (const f of found) {
    if (seen.has(f.day) || out.length >= 3) continue;
    seen.add(f.day);
    const starts = `${f.day}T${time}`;
    out.push({
      value: { starts_at: starts, ends_at: length ? plusMinutes(starts, length) : "" },
      label: `${formatDay(f.day, ctx.locale)} · ${formatClockText(time, ctx.locale)}`,
      why: `${f.why} ${clashLine(f.day, venue, ctx, draft.id)}`,
      source: f.source,
      best: out.length === 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Card 2: where and how many
// ---------------------------------------------------------------------------

export type VenueValue = { venue: string; capacity: number | null };

/** The places this community has used, the most similar event's first, then the most used. */
export function venueSuggestions(draft: EventDraft, ctx: CreatorCtx): Suggestion<VenueValue>[] {
  const sim = mostSimilar(draft.name, ctx);
  const groups = new Map<string, { venue: string; count: number; last: string | null; capacity: number | null }>();
  for (const e of [...ctx.history.past, ...ctx.history.upcoming]) {
    if (!e.venue || e.id === draft.id) continue;
    const key = nameWords(e.venue).join(" ") || e.venue.toLowerCase();
    const g = groups.get(key) ?? { venue: e.venue, count: 0, last: null, capacity: null };
    g.count += 1;
    const day = e.starts_at ? localDay(e.starts_at, ctx.tz) : null;
    if (day && (!g.last || day > g.last)) [g.last, g.venue] = [day, e.venue];
    if (e.capacity !== null) g.capacity = Math.max(g.capacity ?? 0, e.capacity);
    groups.set(key, g);
  }
  const simKey = sim?.venue ? nameWords(sim.venue).join(" ") || sim.venue.toLowerCase() : null;
  const list = [...groups.entries()].sort(([ka, a], [kb, b]) => Number(kb === simKey) - Number(ka === simKey) || b.count - a.count || (b.last ?? "").localeCompare(a.last ?? ""));
  return list.slice(0, 4).map(([key, g], i) => {
    const simDay = sim?.starts_at ? localDay(sim.starts_at, ctx.tz) : null;
    const why =
      key === simKey && sim
        ? `Used for ${sim.name}${simDay ? ` (${monthYear(simDay, ctx.locale)})` : ""}.${sim.attended !== null ? ` ${sim.attended} came.` : ""}`
        : `Used for ${plural(g.count, "event")}${g.last ? `, most recently ${monthYear(g.last, ctx.locale)}` : ""}.`;
    return { value: { venue: g.venue, capacity: g.capacity }, label: g.venue, why, source: "history", best: i === 0 && key === simKey };
  });
}

/** How many to plan for: last time's turnout plus about 20%, else the room size used before. */
export function capacitySuggestion(draft: EventDraft, ctx: CreatorCtx): Suggestion<number> | null {
  const sim = mostSimilar(draft.name, ctx);
  if (sim?.attended) {
    const v = Math.ceil((sim.attended * 1.2) / 10) * 10;
    return { value: v, label: `Plan for ${v}`, why: `Last time ${sim.attended} came to ${sim.name}. Planning for ${v} gives about 20% room.`, source: "history" };
  }
  if (sim?.capacity) return { value: sim.capacity, label: `Room for ${sim.capacity}`, why: `${sim.name} was set for ${sim.capacity}.`, source: "history" };
  const venue = draft.venue.trim();
  if (venue) {
    const at = ctx.history.past.find((e) => e.capacity !== null && sameText(e.venue, venue));
    if (at) return { value: at.capacity!, label: `Room for ${at.capacity}`, why: `${at.venue} was set for ${at.capacity} at ${at.name}.`, source: "history" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Card 4: money (suggested, never set silently)
// ---------------------------------------------------------------------------

export type PriceValue = { member_cents: number; guest_cents: number | null };

export function priceSuggestion(draft: EventDraft, ctx: CreatorCtx): Suggestion<PriceValue> | null {
  const sim = mostSimilar(draft.name, ctx);
  if (!sim?.is_paid || sim.member_price_cents === null) return null;
  const g = sim.guest_price_cents;
  return {
    value: { member_cents: sim.member_price_cents, guest_cents: g },
    label: `${money(sim.member_price_cents, ctx)} members${g !== null ? ` · ${money(g, ctx)} guests` : ""}`,
    why: `${sim.name} was ${money(sim.member_price_cents, ctx)} for members${g !== null ? ` and ${money(g, ctx)} for guests` : ""}.`,
    source: "history",
  };
}

/** The donation commitment at RSVP, when the similar event asked for one (and the community takes donations here). */
export function commitmentSuggestion(draft: EventDraft, ctx: CreatorCtx): Suggestion<true> | null {
  const sim = mostSimilar(draft.name, ctx);
  if (!ctx.modules.giving || !sim?.commitments_used) return null;
  return { value: true, label: "Ask for a donation commitment", why: `${sim.name} asked for a donation commitment at RSVP.`, source: "history" };
}

// ---------------------------------------------------------------------------
// Card 5: help on the day (meals, shifts)
// ---------------------------------------------------------------------------

export type MealValue = { slot_minutes: number | null; seats: number | null };

export function mealSuggestion(draft: EventDraft, ctx: CreatorCtx): Suggestion<MealValue> | null {
  const sim = mostSimilar(draft.name, ctx);
  if (!sim?.lunch_enabled) return null;
  const parts = [sim.lunch_slot_minutes ? `${sim.lunch_slot_minutes}-minute slots` : null, sim.lunch_seats_per_slot ? `${sim.lunch_seats_per_slot} seats each` : null].filter(Boolean);
  return {
    value: { slot_minutes: sim.lunch_slot_minutes, seats: sim.lunch_seats_per_slot },
    label: "Serve a meal, like last time",
    why: `${sim.name} served a meal${parts.length ? ` (${parts.join(", ")})` : ""}.`,
    source: "history",
  };
}

/** The volunteer areas a shift can be in (volunteer_shifts.station, the list createShift accepts). The role name goes in its note. */
export const STATION_LABEL: Record<string, string> = {
  entry: "Entry (check-in)",
  food: "Food",
  gifts: "Gifts",
  kitchen: "Kitchen",
  parking: "Parking",
  app_seva: "App help desk",
};

export type ShiftValue = { station: string; role: string; capacity: number; from_start_minutes: number; minutes: number };

/** Last time's shifts (the similar event's, else the latest event that had any), moved to this event's start. */
export function shiftSuggestions(draft: EventDraft, ctx: CreatorCtx): Suggestion<ShiftValue>[] {
  const byEvent = new Map<string, HistoryShift[]>();
  for (const s of ctx.history.shifts) byEvent.set(s.event_id, [...(byEvent.get(s.event_id) ?? []), s]);
  const source = similarPast(draft.name, ctx).find((e) => byEvent.has(e.id)) ?? ctx.history.past.find((e) => byEvent.has(e.id)) ?? null;
  if (!source) return [];
  const isSim = similarPast(draft.name, ctx).some((e) => e.id === source.id);
  return byEvent.get(source.id)!.map((s) => {
    const role = s.notes?.trim() || STATION_LABEL[s.station] || s.station;
    const capacity = s.capacity ?? 1;
    return {
      value: { station: s.station, role, capacity, from_start_minutes: s.from_start_minutes ?? -60, minutes: s.minutes ?? 180 },
      label: role,
      why: `${isSim ? "Same as" : "Like"} ${source.name}: ${plural(capacity, "person", "people")}.`,
      source: "history" as const,
    };
  });
}

/** A shift's start and end (datetime-local) from the event's start. */
export function shiftTimes(startsAt: string, s: Pick<ShiftValue, "from_start_minutes" | "minutes">): { starts_at: string; ends_at: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startsAt)) return null;
  const from = plusMinutes(startsAt.slice(0, 16), s.from_start_minutes);
  return { starts_at: from, ends_at: plusMinutes(from, s.minutes) };
}

// ---------------------------------------------------------------------------
// Card 7: the confirmation reminder
// ---------------------------------------------------------------------------

export function reminderSuggestion(draft: EventDraft, ctx: CreatorCtx, ruleHours: number): Suggestion<number> {
  const sim = mostSimilar(draft.name, ctx);
  if (sim && sim.confirmation_hours_before > 0) {
    return { value: sim.confirmation_hours_before, label: `${sim.confirmation_hours_before} hours before`, why: `${sim.name} asked people to confirm ${sim.confirmation_hours_before} hours before.`, source: "history" };
  }
  return { value: ruleHours, label: `${ruleHours} hours before`, why: "Your community's usual reminder, from Settings › Rules.", source: "rule" };
}

// ---------------------------------------------------------------------------
// Lessons learned, at the card they are about
// ---------------------------------------------------------------------------

const LESSON_CARD: [CardId, RegExp][] = [
  ["help", /\b(food|meal|lunch|dinner|kitchen|ran out|serve|served|serving|volunteer|helper|shift|queue|line|cleanup|setup|set up)/i],
  ["where", /\b(parking|room|hall|venue|space|seat|chairs|tables|stage|sound|overflow|crowd)/i],
  ["money", /\b(ticket|price|paid|pay|cash|card|donat|pledge|sponsor)/i],
  ["sending", /\b(remind|email|message|text|sms|whatsapp|notice|announce)/i],
  ["words", /\b(flyer|poster|photo|description|wording|translat|language)/i],
];

export function lessonCard(text: string): CardId {
  return LESSON_CARD.find(([, re]) => re.test(text))?.[0] ?? "review";
}

export type Lesson = { text: string; from: string };

/** Lessons written after similar past events, for this card (Review shows them all). */
export function lessonsFor(card: CardId, draft: EventDraft, ctx: CreatorCtx): Lesson[] {
  const out: Lesson[] = [];
  for (const e of similarPast(draft.name, ctx)) {
    for (const text of e.lessons) {
      if (card === "review" || lessonCard(text) === card) out.push({ text, from: e.name });
    }
  }
  return out.slice(0, card === "review" ? 8 : 3);
}

/** Past events to start from ("Start like …"): the similar ones first, else the latest few. */
export function startLike(draft: EventDraft, ctx: CreatorCtx): Suggestion<HistoryEvent>[] {
  const sims = similarPast(draft.name, ctx);
  const list = sims.length ? sims.slice(0, 2) : [];
  return list.map((e, i) => {
    const day = e.starts_at ? localDay(e.starts_at, ctx.tz) : null;
    const bits = [day ? formatDay(day, ctx.locale) + ", " + day.slice(0, 4) : null, e.venue, e.attended !== null ? `${e.attended} came` : null].filter(Boolean);
    return {
      value: e,
      label: e.name,
      why: `${bits.join(" · ")}. Copies its place, room, who it is for, meals and reminder; never its prices.`,
      source: "history" as const,
      best: i === 0,
    };
  });
}
