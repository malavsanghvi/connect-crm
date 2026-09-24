import "server-only";

import { chunk, fetchAll } from "@/lib/data/fetch-all";
import type { Tables } from "@/lib/database.types";
import { addDays } from "@/lib/dates";
import type { DbErrorLike } from "@/lib/errors";
import { summarizeAttendance } from "@/lib/logic/attendance";
import { LoadError, resolvePeopleNames, rows } from "@/lib/pathshala/server";
import { countExpiring, parseTermStats, type TermStats } from "@/lib/pathshala/stats";
import { can } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

// Pathshala reads (moved from connect-admin lib/data/pathshala.ts), plus the
// Classes-tab overview the prototype shows: four KPIs and one row per class.

export type Term = Tables<"pathshala_terms">;
export type PClass = Tables<"pathshala_classes">;
export type Level = Tables<"pathshala_levels"> & { track_name: string };

export async function loadTerms(supabase: AppSupabase, centerId: string): Promise<Term[]> {
  return rows(await supabase.from("pathshala_terms").select("*").eq("center_id", centerId).order("starts_on", { ascending: false }), "Pathshala terms");
}

/** The term to show: the requested one, else active, else open for registration, else the latest. */
export function pickTerm(terms: Term[], requested?: string | null): Term | null {
  if (requested) {
    const t = terms.find((x) => x.id === requested);
    if (t) return t;
  }
  return terms.find((t) => t.status === "active") ?? terms.find((t) => t.status === "registration") ?? terms[0] ?? null;
}

const TRACK_ORDER = ["jainism", "gujarati", "hindi"];

export async function loadLevels(supabase: AppSupabase, centerId: string): Promise<Level[]> {
  const [tracks, levels] = await Promise.all([
    supabase.from("pathshala_tracks").select("id, name, key").eq("center_id", centerId),
    supabase.from("pathshala_levels").select("*").eq("center_id", centerId).order("sort_order"),
  ]);
  const t = rows(tracks, "Pathshala tracks");
  const trackName = new Map(t.map((x) => [x.id, x.name]));
  const trackOrder = new Map(t.map((x, i) => [x.id, TRACK_ORDER.includes(x.key) ? TRACK_ORDER.indexOf(x.key) : 10 + i]));
  return rows(levels, "Pathshala levels")
    .map((l) => ({ ...l, track_name: trackName.get(l.track_id) ?? "Other" }))
    .sort((a, b) => (trackOrder.get(a.track_id) ?? 99) - (trackOrder.get(b.track_id) ?? 99) || a.sort_order - b.sort_order);
}

export async function loadClasses(supabase: AppSupabase, centerId: string, termId: string): Promise<PClass[]> {
  return rows(await supabase.from("pathshala_classes").select("*").eq("center_id", centerId).eq("term_id", termId).order("name"), "classes");
}

export async function loadTeachers(supabase: AppSupabase, classIds: string[]) {
  if (!classIds.length) return [];
  return rows(await supabase.from("pathshala_teachers").select("*").in("class_id", classIds), "teachers");
}

export const ROSTER_STATUSES = ["placed", "active"] as const;

export function levelLabel(levels: Level[], id: string | null | undefined): string {
  if (!id) return "—";
  const l = levels.find((x) => x.id === id);
  return l ? l.name : "—";
}

export function ageFrom(dob: string | null, todayIso: string): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = todayIso.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

// ---------------------------------------------------------------------------
// Classes tab: KPIs + one row per class
// ---------------------------------------------------------------------------

/** How many days ahead a background check counts as "expiring" (prototype Home: "expire this month"). */
export const BACKGROUND_CHECK_WINDOW_DAYS = 30;

export type ClassRow = {
  cls: PClass;
  teacherNames: string[];
  students: number;
  waitlisted: number;
  /** attended / countable marks across the term's class days so far, or null before any marks */
  attendanceRate: number | null;
};

export type ClassesOverview = {
  classes: ClassRow[];
  stats: TermStats;
  /** Where the KPIs came from, for the logs and the tests. */
  statsSource: "rpc" | "query";
};

type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;

/** True when the database has no app.pathshala_term_stats yet (migration not applied). */
function isMissingFunction(error: DbErrorLike): boolean {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "");
}

/**
 * The Classes tab in one call. KPIs come from app.pathshala_term_stats(p_term)
 * when the database has it; otherwise (or if it fails) they are counted here
 * from the same rows the table uses. The table rows are always read directly.
 */
export async function loadClassesOverview(session: CrmSession, term: Term, today: string): Promise<ClassesOverview> {
  const { db, center } = session;
  const classes = await loadClasses(db, center.id, term.id);
  const classIds = classes.map((c) => c.id);
  const [teachers, enrollments] = await Promise.all([
    loadTeachers(db, classIds),
    fetchAll((from, to) =>
      db.from("pathshala_enrollments").select("id, class_id, status").eq("term_id", term.id).order("id").range(from, to),
    ),
  ]);
  if (enrollments.error) throw loadError("enrollments", enrollments.error);
  const enr = enrollments.data;

  // Every class day held so far this term, and its marks.
  const sessions: { id: string; class_id: string }[] = [];
  for (const part of chunk(classIds)) {
    const res = await fetchAll((from, to) =>
      db.from("pathshala_sessions").select("id, class_id").in("class_id", part).lte("held_on", today).order("id").range(from, to),
    );
    if (res.error) throw loadError("class days", res.error);
    sessions.push(...res.data);
  }
  const marks: { session_id: string; enrollment_id: string; status: string }[] = [];
  for (const part of chunk(sessions.map((s) => s.id))) {
    const res = await fetchAll((from, to) =>
      db.from("pathshala_attendance").select("session_id, enrollment_id, status").in("session_id", part).order("id").range(from, to),
    );
    if (res.error) throw loadError("attendance", res.error);
    marks.push(...res.data);
  }

  const names = await resolvePeopleNames(db, teachers.map((t) => t.person_id));
  const sessionClass = new Map(sessions.map((s) => [s.id, s.class_id]));
  const onRoster = (e: { status: string }) => (ROSTER_STATUSES as readonly string[]).includes(e.status);

  const rowsOut: ClassRow[] = classes.map((cls) => {
    const roster = enr.filter((e) => e.class_id === cls.id && onRoster(e));
    const classMarks = marks.filter((m) => sessionClass.get(m.session_id) === cls.id);
    return {
      cls,
      teacherNames: teachers
        .filter((t) => t.class_id === cls.id)
        .sort((a, b) => (a.role === "teacher" ? 0 : 1) - (b.role === "teacher" ? 0 : 1))
        .map((t) => `${names.get(t.person_id) ?? "Teacher"}${t.role !== "teacher" ? ` (${t.role})` : ""}`),
      students: roster.length,
      waitlisted: enr.filter((e) => e.class_id === cls.id && e.status === "waitlisted").length,
      attendanceRate: termRate(roster.map((e) => e.id), classMarks),
    };
  });

  const fromRpc = await termStatsFromRpc(db, term.id);
  if (fromRpc) return { classes: rowsOut, stats: fromRpc, statsSource: "rpc" };

  // Direct-query fallback: the same counts, from the rows above.
  const placedIds = enr.filter(onRoster).map((e) => e.id);
  const teacherIds = [...new Set(teachers.map((t) => t.person_id))];
  const signoffs = await db
    .from("gyan_signoffs")
    .select("id", { count: "exact", head: true })
    .eq("center_id", center.id)
    .eq("status", "requested");
  if (signoffs.error) console.error("[pathshala] counting sign-offs failed; the KPI shows as unavailable:", signoffs.error);

  return {
    classes: rowsOut,
    statsSource: "query",
    stats: {
      students: placedIds.length,
      waitlisted: enr.filter((e) => e.status === "waitlisted").length,
      teachers: teacherIds.length,
      backgroundChecksExpiring: await expiringChecks(session, teacherIds, today),
      attendanceRate: termRate(placedIds, marks),
      signoffsWaiting: signoffs.error ? null : (signoffs.count ?? 0),
    },
  };
}

function loadError(what: string, error: DbErrorLike): LoadError {
  console.error(`[pathshala] could not load ${what}:`, error);
  return new LoadError(`Could not load ${what} — ${error.message ?? "unknown error"}.`);
}

/** Term attendance for a set of enrollments over many class days: attended ÷ (marked − excused). */
function termRate(rosterIds: string[], marks: { enrollment_id: string; status: string; session_id: string }[]): number | null {
  const bySession = new Map<string, { enrollment_id: string; status: string }[]>();
  for (const m of marks) bySession.set(m.session_id, [...(bySession.get(m.session_id) ?? []), m]);
  let attended = 0;
  let countable = 0;
  for (const list of bySession.values()) {
    const s = summarizeAttendance(rosterIds, list);
    attended += s.attended;
    countable += s.present + s.late + s.absent;
  }
  return countable > 0 ? attended / countable : null;
}

async function termStatsFromRpc(db: AppSupabase, termId: string): Promise<TermStats | null> {
  try {
    // app.pathshala_term_stats is added by the schema stream; until the
    // generated types include it, call it through the untyped signature.
    const rpc = db.rpc.bind(db) as unknown as RpcCaller;
    const { data, error } = await rpc("pathshala_term_stats", { p_term: termId });
    if (error) {
      if (isMissingFunction(error)) {
        console.warn("[pathshala] app.pathshala_term_stats is not in this database yet; counting the KPIs directly.");
      } else {
        console.error("[pathshala] app.pathshala_term_stats failed; counting the KPIs directly instead:", error);
      }
      return null;
    }
    const parsed = parseTermStats(data);
    if (!parsed) console.error("[pathshala] app.pathshala_term_stats returned an unexpected shape; counting the KPIs directly instead:", data);
    return parsed;
  } catch (error) {
    console.error("[pathshala] calling app.pathshala_term_stats threw; counting the KPIs directly instead:", error);
    return null;
  }
}

/** Background checks of this term's teachers that expire within the window; null when the role cannot see checks. */
async function expiringChecks(session: CrmSession, teacherIds: string[], today: string): Promise<number | null> {
  // background_checks is readable with safety.view/.manage only; without it RLS returns nothing, which is not "0".
  if (!can(session, ["safety.view", "safety.manage"])) return null;
  if (!teacherIds.length) return 0;
  const until = addDays(today, BACKGROUND_CHECK_WINDOW_DAYS);
  // A teacher's current check is their latest one; it is "expiring" when it runs out inside the window.
  const latest = new Map<string, string>();
  for (const part of chunk(teacherIds)) {
    const { data, error } = await session.db
      .from("background_checks")
      .select("person_id, expires_on")
      .eq("center_id", session.center.id)
      .in("person_id", part)
      .not("expires_on", "is", null);
    if (error) {
      console.error("[pathshala] counting expiring background checks failed; the KPI shows as unavailable:", error);
      return null;
    }
    for (const r of data ?? []) {
      if (!r.expires_on) continue;
      const cur = latest.get(r.person_id);
      if (!cur || r.expires_on > cur) latest.set(r.person_id, r.expires_on);
    }
  }
  return countExpiring([...latest.values()], today, until);
}
