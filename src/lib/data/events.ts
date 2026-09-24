import "server-only";

import { unstable_rethrow } from "next/navigation";

import { fetchAll } from "@/lib/data/fetch-all";
import { householdsById, personName } from "@/lib/data/lookups";
import type { DbErrorLike } from "@/lib/errors";
import { explainError } from "@/lib/errors";
import type { EventAccess, ScopedGrant } from "@/lib/events/access";
import { eventReport, lunchSlotCounts, medianCheckinSeconds, recentCheckins, slotBoard, type RecentCheckin } from "@/lib/events/report";
import { FormError } from "@/lib/events/forms";
import { loadSession, type CrmSession } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

// Data loading for the Events module. Every read runs as the signed-in user,
// so RLS decides what comes back.

/** A read failed; `friendly` is the plain-English sentence for the page. */
export class LoadError extends Error {
  constructor(public readonly friendly: string) {
    super(friendly);
    this.name = "LoadError";
  }
}

type QueryResult = { data: unknown; error: unknown };

/** Unwrap a list query; logs the technical detail and throws a LoadError. */
export function rows<R extends QueryResult>(res: R, what: string): NonNullable<R["data"]> {
  if (res.error) {
    console.error(`[events] loading ${what} failed:`, res.error);
    throw new LoadError(`Could not load ${what} — ${explainError(res.error)}`);
  }
  return (res.data ?? []) as NonNullable<R["data"]>;
}

/** Unwrap a maybeSingle query. */
export function row<R extends QueryResult>(res: R, what: string): NonNullable<R["data"]> | null {
  if (res.error) {
    console.error(`[events] loading ${what} failed:`, res.error);
    throw new LoadError(`Could not load ${what} — ${explainError(res.error)}`);
  }
  return (res.data ?? null) as NonNullable<R["data"]> | null;
}

/** Run a page's loader; any failure becomes one plain-English message. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof LoadError) return { ok: false, error: error.friendly };
    console.error("[events] page loader failed:", error);
    return { ok: false, error: `Could not load this page — ${explainError(error)}` };
  }
}

/** All rows of a query (pages past the 1000-row cap), or a LoadError. */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbErrorLike | null }>, what: string): Promise<T[]> {
  const res = await fetchAll(page);
  if (res.error) {
    console.error(`[events] loading ${what} failed:`, res.error);
    throw new LoadError(`Could not load ${what} — ${explainError(res.error)}`);
  }
  if (res.truncated) console.error(`[events] ${what}: stopped after ${res.data.length} rows; totals may be partial`);
  return res.data;
}

/**
 * The session plus the user's grants with their scope, so pages can honour
 * event-scoped roles (an event lead or check-in volunteer for one event).
 * A failed read falls back to center-wide permissions only, and says so in the log.
 */
export async function loadEventAccess(session: CrmSession): Promise<EventAccess> {
  const { data, error } = await session.db
    .from("role_grants")
    .select("role_key, scope_kind, scope_id, starts_at, ends_at")
    .eq("center_id", session.center.id)
    .eq("user_id", session.userId);
  if (error) {
    console.error("[events] could not load event-scoped roles; using center-wide permissions only:", error);
  }
  const grants: ScopedGrant[] = data ?? [];
  return { permissions: session.permissions, isPlatformAdmin: session.isPlatformAdmin, grants };
}

/** Names for person ids (people the user may see, then the opt-in directory). Missing names stay absent. */
export async function resolvePeopleNames(db: AppSupabase, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const { data, error } = await db.from("people").select("id, first_name, last_name, preferred_name").in("id", unique);
  if (error) console.error("[events] name lookup failed; falling back to the directory:", error);
  for (const p of data ?? []) names.set(p.id, personName(p));
  const rest = unique.filter((id) => !names.has(id));
  if (rest.length) {
    const { data: dir, error: dirError } = await db.from("directory").select("person_id, name").in("person_id", rest);
    if (dirError) console.error("[events] directory name lookup failed; some names stay hidden:", dirError);
    for (const d of dir ?? []) if (d.person_id && d.name) names.set(d.person_id, d.name);
  }
  return names;
}

export type PersonOption = { id: string; name: string; detail: string | null };

/** Search people by name, email, phone or member number (RLS-limited) plus the member directory. */
export async function searchPeople(db: AppSupabase, centerId: string, query: string): Promise<{ people: PersonOption[]; error: string | null }> {
  const q = query.trim();
  if (q.length < 2) return { people: [], error: null };
  const safe = q.replace(/[%,()*"\\:]/g, " ").trim();
  const parts = safe.split(/\s+/).filter(Boolean);
  let builder = db
    .from("people")
    .select("id, first_name, last_name, preferred_name, email, member_number")
    .eq("center_id", centerId)
    .is("merged_into_id", null)
    .limit(20);
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 7) builder = builder.like("phone_e164", `%${digits.slice(-10)}`);
  else if (safe.includes("@")) builder = builder.ilike("email", `%${safe}%`);
  else if (parts.length >= 2) builder = builder.ilike("first_name", `${parts[0]}%`).ilike("last_name", `${parts.slice(1).join(" ")}%`);
  else builder = builder.or(`first_name.ilike.${safe}%,last_name.ilike.${safe}%,preferred_name.ilike.${safe}%,member_number.ilike.${safe}%`);
  const { data, error } = await builder;
  if (error) {
    console.error("[events] people search failed:", error);
    return { people: [], error: `The people search failed — ${explainError(error)}.` };
  }
  const found: PersonOption[] = (data ?? []).map((p) => ({
    id: p.id,
    name: personName(p),
    detail: [p.member_number, p.email].filter(Boolean).join(" · ") || null,
  }));
  if (found.length < 20 && digits.length < 7 && safe) {
    const { data: dir, error: dirError } = await db.from("directory").select("person_id, name, zone").eq("center_id", centerId).ilike("name", `%${safe}%`).limit(20);
    if (dirError) console.error("[events] directory search failed; showing people results only:", dirError);
    for (const d of dir ?? []) {
      if (d.person_id && d.name && !found.some((f) => f.id === d.person_id)) {
        found.push({ id: d.person_id, name: d.name, detail: d.zone ? `${d.zone} zone` : "Member directory" });
      }
    }
  }
  return { people: found.slice(0, 20), error: null };
}

// ---------------------------------------------------------------------------
// Live check-in dashboard
//
// The schema stream is adding app.event_live_stats(p_event) and
// app.event_recent_checkins(p_event, p_limit). Until they exist these two
// functions compute the same numbers with direct queries; switching is a
// change inside these functions only (the page consumes LiveStats /
// RecentCheckin and nothing else).
// ---------------------------------------------------------------------------
export type LiveSlot = { id: string; starts_at: string; seats: number; assignedCount: number; board: string; status: string };

export type LiveStats = {
  checkedIn: number;
  /** People on confirmed (or arrived) RSVPs, walk-ins excluded — the prototype's "of 298 confirmed". */
  confirmed: number;
  walkIns: number;
  walkInParties: number;
  waitlisted: number;
  waitlistedParties: number;
  medianSeconds: number | null;
  slots: LiveSlot[];
  noSlotYet: number;
};

export async function loadLiveStats(db: AppSupabase, eventId: string): Promise<LiveStats> {
  const [rsvps, attendees, slots, scans] = await Promise.all([
    allRows<{ id: string; status: string; source: string; confirmed_at: string | null }>(
      (f, t) => db.from("rsvps").select("id, status, source, confirmed_at").eq("event_id", eventId).order("id").range(f, t),
      "RSVPs",
    ),
    allRows<{
      id: string;
      rsvp_id: string;
      status: string;
      checked_in_at: string | null;
      served_food_at: string | null;
      lunch_slot_id: string | null;
      is_child_under_12: boolean;
      is_senior: boolean;
      needs_assistance: boolean;
    }>(
      (f, t) =>
        db
          .from("attendees")
          .select("id, rsvp_id, status, checked_in_at, served_food_at, lunch_slot_id, is_child_under_12, is_senior, needs_assistance")
          .eq("event_id", eventId)
          .order("id")
          .range(f, t),
      "attendees",
    ),
    db.from("lunch_slots").select("id, starts_at, seats, status").eq("event_id", eventId).order("starts_at"),
    allRows<{ scanned_at: string; device_id: string | null; station: string; result: string }>(
      (f, t) => db.from("scan_log").select("scanned_at, device_id, station, result").eq("event_id", eventId).eq("station", "entry").order("id").range(f, t),
      "the scan log",
    ),
  ]);
  const report = eventReport(rsvps, attendees);
  const board = slotBoard(lunchSlotCounts(rows(slots, "lunch slots"), attendees));
  return {
    checkedIn: report.checkedIn,
    confirmed: report.confirmedPeople,
    walkIns: report.walkIns,
    walkInParties: report.walkInHouseholds,
    waitlisted: report.waitlistedPeople,
    waitlistedParties: report.waitlistedHouseholds,
    medianSeconds: medianCheckinSeconds(scans),
    slots: board.map((s) => ({ id: s.id, starts_at: s.starts_at, seats: s.seats, assignedCount: s.assignedCount, board: s.board, status: s.status })),
    noSlotYet: attendees.filter((a) => a.checked_in_at && !a.lunch_slot_id).length,
  };
}

export async function loadRecentCheckins(db: AppSupabase, eventId: string, limit = 8): Promise<RecentCheckin[]> {
  const recent = rows(
    await db
      .from("attendees")
      .select("rsvp_id, checked_in_at, lunch_slot_id, is_child_under_12, is_senior, needs_assistance")
      .eq("event_id", eventId)
      .not("checked_in_at", "is", null)
      .order("checked_in_at", { ascending: false })
      .limit(limit * 8),
    "recent check-ins",
  );
  const rsvpIds = [...new Set(recent.map((a) => a.rsvp_id))];
  const slotIds = [...new Set(recent.map((a) => a.lunch_slot_id).filter((x): x is string => Boolean(x)))];
  const [rsvpRes, slotRes] = await Promise.all([
    rsvpIds.length ? db.from("rsvps").select("id, household_id, guest_name").in("id", rsvpIds) : Promise.resolve({ data: [], error: null }),
    slotIds.length ? db.from("lunch_slots").select("id, starts_at").in("id", slotIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const rsvpRows = rows(rsvpRes, "RSVPs for recent check-ins");
  const slotRows = rows(slotRes, "lunch slots for recent check-ins");
  const hh = await householdsById(
    db,
    rsvpRows.map((r) => r.household_id),
  );
  if (hh.error) console.error("[events] household names for recent check-ins unavailable:", hh.error);
  const label = (rsvpId: string) => {
    const r = rsvpRows.find((x) => x.id === rsvpId);
    if (!r) return "Family";
    if (r.household_id) return hh.map.get(r.household_id)?.display_name ?? r.guest_name ?? "Member family";
    return r.guest_name ?? "Guest party";
  };
  return recentCheckins(recent, label, (id) => slotRows.find((s) => s.id === id)?.starts_at ?? null, limit);
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------
export type EventActionContext = { session: CrmSession; access: EventAccess; db: AppSupabase; centerId: string; tz: string; userId: string };

/**
 * Every Events Server Action starts here: re-check the session and the
 * permission (actions are reachable by direct POST). RLS is the final word.
 * Throws FormError with a plain-English reason.
 */
export async function eventActionContext(check: (a: EventAccess) => boolean, denied: string): Promise<EventActionContext> {
  const state = await loadSession();
  if (state.status === "signed_out") throw new FormError("Your session has expired. Sign in again, then retry.");
  if (state.status !== "ok") {
    const why =
      state.status === "env_missing" ? "the app is not configured" : state.status === "center_missing" ? `center "${state.slug}" was not found` : state.message;
    throw new FormError(why);
  }
  const access = await loadEventAccess(state.session);
  if (!check(access)) throw new FormError(denied);
  return { session: state.session, access, db: state.session.db, centerId: state.session.center.id, tz: state.session.center.time_zone, userId: state.session.userId };
}
