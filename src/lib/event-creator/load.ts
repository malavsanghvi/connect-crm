import "server-only";

// Everything the guided event creator reads, in one pass: the draft (when resuming), the community's own history as counts and
// settings (past and upcoming events, how many came, last shifts, lessons), its calendar days, its templates, and what already
// hangs off the draft. A failed read of history never stops the page: it becomes a sentence and there are fewer suggestions.

import { kindSchool } from "@/lib/kind";
import { loadCommunityLocale } from "@/lib/community-locale";
import { layerVisibleFor } from "@/lib/calendar";
import { loadEventAccess, resolvePeopleNames } from "@/lib/data/events";
import { eventAreas } from "@/lib/events/access";
import { readCommitment, commitmentEnabled } from "@/lib/events/report";
import { isModuleEnabled } from "@/lib/modules";
import type { CrmSession } from "@/lib/session";

import { addDays, localDay } from "./smart";
import { EVENT_COLUMNS, fromEvent, newDraft, type EventRowLike } from "./mapping";
import type { CalendarDay, CreatorCtx, CreatorExisting, EventDraft, HistoryEvent, HistoryShift } from "./types";

const HISTORY_COLUMNS =
  "id, name, status, starts_at, ends_at, venue, capacity, is_paid, member_price_cents, guest_price_cents, audience, waitlist_enabled, " +
  "lunch_enabled, lunch_slot_minutes, lunch_seats_per_slot, confirmation_hours_before, commitment_options, lessons_learned";

type HistoryRow = {
  id: string;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  venue: string | null;
  capacity: number | null;
  is_paid: boolean;
  member_price_cents: number | null;
  guest_price_cents: number | null;
  audience: string;
  waitlist_enabled: boolean;
  lunch_enabled: boolean;
  lunch_slot_minutes: number | null;
  lunch_seats_per_slot: number | null;
  confirmation_hours_before: number;
  commitment_options: unknown;
  lessons_learned: unknown;
};

function lessonsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.map((l) => (l && typeof l === "object" && typeof (l as { text?: unknown }).text === "string" ? (l as { text: string }).text : null)).filter((t): t is string => !!t) : [];
}

function toHistory(r: HistoryRow, attended: number | null): HistoryEvent {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    venue: r.venue,
    capacity: r.capacity,
    attended,
    is_paid: r.is_paid,
    member_price_cents: r.member_price_cents,
    guest_price_cents: r.guest_price_cents,
    audience: r.audience,
    waitlist_enabled: r.waitlist_enabled,
    lunch_enabled: r.lunch_enabled,
    lunch_slot_minutes: r.lunch_slot_minutes,
    lunch_seats_per_slot: r.lunch_seats_per_slot,
    confirmation_hours_before: r.confirmation_hours_before,
    commitments_used: commitmentEnabled(readCommitment(r.commitment_options)),
    lessons: lessonsOf(r.lessons_learned),
  };
}

export type CreatorLoad =
  | { state: "no_access"; reason: "new" | "event" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "ok"; ctx: CreatorCtx; draft: EventDraft; existing: CreatorExisting };

/** How many past events get a head count of who came (one small count query each). */
const ATTENDANCE_COUNTED = 12;

export async function loadCreator(session: CrmSession, eventId: string | null, now: Date = new Date()): Promise<CreatorLoad> {
  const { db, center } = session;
  const access = await loadEventAccess(session);
  if (eventId ? !eventAreas.edit(access, eventId) : !eventAreas.manage(access)) return { state: "no_access", reason: eventId ? "event" : "new" };
  const tz = center.time_zone;
  const nowIso = now.toISOString();
  const problems: string[] = [];
  const modules = {
    giving: isModuleEnabled(session, "giving"),
    volunteers: isModuleEnabled(session, "volunteers"),
    comms: isModuleEnabled(session, "comms"),
    surveys: isModuleEnabled(session, "surveys"),
    calendar: isModuleEnabled(session, "calendar"),
  };

  const [eventRes, pastRes, upcomingRes, templatesRes, locale] = await Promise.all([
    eventId ? db.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("events").select(HISTORY_COLUMNS).eq("center_id", center.id).lt("starts_at", nowIso).neq("status", "cancelled").order("starts_at", { ascending: false }).limit(40),
    db.from("events").select(HISTORY_COLUMNS).eq("center_id", center.id).gte("starts_at", nowIso).neq("status", "cancelled").order("starts_at").limit(60),
    !eventId && eventAreas.manage(access) ? db.from("event_templates").select("id, name, description").eq("center_id", center.id).order("name") : Promise.resolve({ data: [], error: null }),
    loadCommunityLocale(db, center),
  ]);

  if (eventRes.error) {
    console.error("[event-creator] could not load the event:", eventRes.error);
    return { state: "error", message: "Could not load the draft — the database did not answer. Try again in a moment." };
  }
  const row = eventRes.data as EventRowLike | null;
  if (eventId && !row) return { state: "missing" };

  if (pastRes.error || upcomingRes.error) {
    console.error("[event-creator] could not load past events:", pastRes.error ?? upcomingRes.error);
    problems.push("Could not load your past events, so there are no suggestions from them. You can still answer every card.");
  }
  if (templatesRes.error) {
    console.error("[event-creator] could not load the event templates:", templatesRes.error);
    problems.push("Could not load your event templates. You can still start a new event.");
  }
  if (!locale.known && locale.note) problems.push(locale.note);
  const pastRows = (pastRes.data ?? []) as unknown as HistoryRow[];
  const upcomingRows = ((upcomingRes.data ?? []) as unknown as HistoryRow[]).filter((r) => r.id !== eventId);

  // Head counts of who came (counts only) for the latest past events, and their shifts (roles and numbers, no names).
  const counted = pastRows.slice(0, ATTENDANCE_COUNTED);
  const shiftIds = pastRows.slice(0, 20).map((r) => r.id);
  const [counts, shiftsRes, calendar, owner] = await Promise.all([
    Promise.all(
      counted.map(async (r) => {
        const res = await db.from("attendees").select("id", { count: "exact", head: true }).eq("event_id", r.id).not("checked_in_at", "is", null);
        return res.error ? null : (res.count ?? 0);
      }),
    ),
    shiftIds.length ? db.from("volunteer_shifts").select("event_id, station, notes, capacity, starts_at, ends_at").in("event_id", shiftIds).limit(400) : Promise.resolve({ data: [], error: null }),
    modules.calendar ? loadCalendar(session, now, problems) : Promise.resolve([] as CalendarDay[]),
    row?.owner_person_id ? resolvePeopleNames(db, [row.owner_person_id]).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
  ]);
  if (shiftsRes.error) console.error("[event-creator] could not load past shifts:", shiftsRes.error);
  const startOf = new Map(pastRows.map((r) => [r.id, r.starts_at]));
  const shifts: HistoryShift[] = ((shiftsRes.data ?? []) as { event_id: string; station: string; notes: string | null; capacity: number | null; starts_at: string | null; ends_at: string | null }[]).map((s) => {
    const evStart = startOf.get(s.event_id);
    const from = s.starts_at && evStart ? Math.round((Date.parse(s.starts_at) - Date.parse(evStart)) / 60000) : null;
    const minutes = s.starts_at && s.ends_at ? Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000) : null;
    return { event_id: s.event_id, station: s.station, notes: s.notes, capacity: s.capacity, from_start_minutes: from, minutes: minutes && minutes > 0 ? minutes : null };
  });

  const ctx: CreatorCtx = {
    community: { name: center.name, kindKey: session.kind.key, kindLabel: session.kind.label, faithBased: session.kind.faithBased },
    school: kindSchool(session.kind),
    modules,
    languages: locale.languages,
    tz,
    currency: center.currency,
    locale: locale.locale,
    now: nowIso,
    rules: center.rules,
    templates: (templatesRes.data ?? []) as CreatorCtx["templates"],
    history: {
      past: pastRows.map((r, i) => toHistory(r, i < counted.length ? counts[i] : null)),
      upcoming: upcomingRows.map((r) => toHistory(r, null)),
      shifts,
      calendar,
      problems,
    },
  };

  const draft = row
    ? fromEvent(row, tz, row.owner_person_id ? { id: row.owner_person_id, name: owner.get(row.owner_person_id) ?? "Event lead", detail: null } : null)
    : newDraft(ctx);
  const existing = row ? await loadExisting(session, row.id) : { shifts: [], checklist: [], lunchSlots: 0, problems: [] };
  return { state: "ok", ctx, draft, existing };
}

/** The community's calendar days for the next ~13 months (the layers its kind shows). */
async function loadCalendar(session: CrmSession, now: Date, problems: string[]): Promise<CalendarDay[]> {
  const { db, center } = session;
  const layers = await db.from("calendar_layers").select("id, name, kind").or(`center_id.eq.${center.id},center_id.is.null`);
  if (layers.error) {
    console.error("[event-creator] could not load the calendar layers:", layers.error);
    problems.push("Could not load your calendar, so no dates come from it.");
    return [];
  }
  const visible = (layers.data ?? []).filter((l) => layerVisibleFor(session.kind, l.kind));
  if (!visible.length) return [];
  const today = localDay(now.toISOString(), center.time_zone);
  const entries = await db
    .from("calendar_entries")
    .select("layer_id, title, starts_on, ends_on")
    .in(
      "layer_id",
      visible.map((l) => l.id),
    )
    .gte("starts_on", today)
    .lte("starts_on", addDays(today, 400))
    .order("starts_on")
    .limit(300);
  if (entries.error) {
    console.error("[event-creator] could not load the calendar entries:", entries.error);
    problems.push("Could not load your calendar, so no dates come from it.");
    return [];
  }
  const name = new Map(visible.map((l) => [l.id, l.name]));
  return (entries.data ?? []).map((e) => ({ title: e.title, starts_on: e.starts_on, ends_on: e.ends_on, layer: name.get(e.layer_id) ?? "community" }));
}

/** The draft's shifts, checklist and meal slots, as they are now. */
export async function loadExisting(session: CrmSession, eventId: string): Promise<CreatorExisting> {
  const { db } = session;
  const [shifts, checklist, slots] = await Promise.all([
    db.from("volunteer_shifts").select("id, station, notes, capacity, starts_at, ends_at").eq("event_id", eventId).order("starts_at"),
    db.from("actions").select("id, name, phase, due_on, state").eq("event_id", eventId).neq("state", "removed").order("due_on"),
    db.from("lunch_slots").select("id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  const problems: string[] = [];
  if (shifts.error) problems.push("Could not load this event's shifts. Reload to try again.");
  if (checklist.error) problems.push("Could not load this event's checklist. Reload to try again.");
  if (slots.error) problems.push("Could not count this event's meal slots. Reload to try again.");
  for (const e of [shifts.error, checklist.error, slots.error]) if (e) console.error("[event-creator] could not load what hangs off the draft:", e);
  return { shifts: shifts.data ?? [], checklist: (checklist.data ?? []) as CreatorExisting["checklist"], lunchSlots: slots.count ?? 0, problems };
}
