import "server-only";

import { communityFormat, workWeekFor } from "@/lib/community-format";
import { addDays, dateInTz, daysBetween, startOfDayInTz, todayInTz } from "@/lib/dates";
import { explainError, type DbErrorLike } from "@/lib/errors";
import { isModuleEnabled } from "@/lib/modules";
import { enabledPaymentPlugins } from "@/lib/payments/plugins/enabled";
import { canAccess, hasCenterRole, scopeIdsForRole } from "@/lib/permissions";
import { WEEKDAY_NAMES, dateParts } from "@/lib/routines/clock";
import { countersNeeded } from "@/lib/routines/needs";
import type { CounterKey } from "@/lib/routines/recipes";
import type { FactEvent, RoutineFacts } from "@/lib/routines/resolve";
import { counterFromTasks } from "@/lib/routines/signals";
import type { CrmSession } from "@/lib/session";
import { visibleTaskSources, type HomeTasks } from "@/lib/tasks";

// The numbers behind Today: the routine's ticks and the morning briefing. Counts only, always: nothing here reads a name, and
// nothing about a learner beyond how many (D2). The Home task list is loaded once per request already (loadHomeTasks is
// cached), so its counters cost nothing extra; the rest are small head-only counts, read in parallel, each on its own: one that
// fails is reported as failed (never as zero) and the others still show.

class CounterError extends Error {
  constructor(readonly db: DbErrorLike) {
    super(db.message ?? "query failed");
  }
}

function n(res: { count: number | null; error: DbErrorLike | null }): number {
  if (res.error) throw new CounterError(res.error);
  return res.count ?? 0;
}

/** Plain English for a counter that could not be read (a read refused for permission is "no access", not "make this change"). */
function why(error: unknown): string {
  const db = error instanceof CounterError ? error.db : error;
  if (typeof db === "object" && db !== null && (db as DbErrorLike).code === "42501") return "you don't have access to this area";
  return explainError(db);
}

type Read = { key: CounterKey; value: number } | { key: CounterKey; error: string };

async function read(key: CounterKey, needed: Set<CounterKey>, allowed: boolean, run: () => Promise<number | undefined>): Promise<Read | null> {
  if (!needed.has(key) || !allowed) return null;
  try {
    const value = await run();
    return value === undefined ? null : { key, value };
  } catch (error) {
    console.error(`[today] could not read the "${key}" counter:`, error);
    return { key, error: why(error) };
  }
}

/** How many Pathshala learners wait for a class and how many fee-assistance requests wait: the database's own counters, counts only. */
async function pathshalaCounts(session: CrmSession): Promise<{ to_place: number; assistance: number | undefined } | undefined> {
  const res = await session.db.rpc("pathshala_task_counts", { p_center: session.center.id });
  if (res.error) {
    // A database without the function yet is skipped silently; anything else is this counter's failure.
    if (res.error.code === "PGRST202" || res.error.code === "42883") return undefined;
    throw new CounterError(res.error);
  }
  const data = (res.data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return { to_place: num(data.to_place) ?? 0, assistance: num(data.assistance_to_decide) };
}

/** Classes that meet today in an active term, and how many of them have no attendance marked yet. Counts only: no learner is read. */
async function classesToday(session: CrmSession, today: string): Promise<{ classes: number; missing: number }> {
  const { db, center } = session;
  const terms = await db
    .from("pathshala_terms")
    .select("id, no_class_dates")
    .eq("center_id", center.id)
    .eq("status", "active")
    .lte("starts_on", today)
    .gte("ends_on", today);
  if (terms.error) throw new CounterError(terms.error);
  const open = (terms.data ?? []).filter((t) => !(t.no_class_dates ?? []).includes(today));
  if (open.length === 0) return { classes: 0, missing: 0 };

  const classes = await db
    .from("pathshala_classes")
    .select("id")
    .eq("center_id", center.id)
    .in("term_id", open.map((t) => t.id))
    .eq("meets_on", WEEKDAY_NAMES[dateParts(today).weekday].toLowerCase());
  if (classes.error) throw new CounterError(classes.error);
  const ids = (classes.data ?? []).map((c) => c.id);
  if (ids.length === 0) return { classes: 0, missing: 0 };

  const sessions = await db.from("pathshala_sessions").select("id, class_id").in("class_id", ids).eq("held_on", today);
  if (sessions.error) throw new CounterError(sessions.error);
  const opened = sessions.data ?? [];
  if (opened.length === 0) return { classes: ids.length, missing: ids.length };

  // Only the session of each mark is read (never who it is about).
  const marks = await db.from("pathshala_attendance").select("session_id").in("session_id", opened.map((s) => s.id));
  if (marks.error) throw new CounterError(marks.error);
  const marked = new Set((marks.data ?? []).map((m) => m.session_id));
  const withMarks = new Set(opened.filter((s) => marked.has(s.id)).map((s) => s.class_id));
  return { classes: ids.length, missing: ids.filter((id) => !withMarks.has(id)).length };
}

/** Events starting in the next 7 days that this person can see (all of them, or only the ones they lead). */
async function upcomingEvents(session: CrmSession, today: string): Promise<FactEvent[]> {
  const { db, center } = session;
  const everything = canAccess(session, "events") || hasCenterRole(session, "event_lead");
  const scoped = scopeIdsForRole(session, "event_lead");
  if (!everything && scoped.length === 0) return [];
  let q = db
    .from("events")
    .select("id, name, starts_at")
    .eq("center_id", center.id)
    .in("status", ["published", "rsvp_closed", "live"])
    .gte("starts_at", startOfDayInTz(today, center.time_zone))
    .lt("starts_at", startOfDayInTz(addDays(today, 8), center.time_zone))
    .order("starts_at")
    .limit(30);
  if (!everything) q = q.in("id", scoped);
  const res = await q;
  if (res.error) throw new CounterError(res.error);
  return (res.data ?? [])
    .filter((e): e is typeof e & { starts_at: string } => e.starts_at !== null)
    .map((e) => ({ id: e.id, name: e.name, days: daysBetween(today, dateInTz(e.starts_at, center.time_zone)) }));
}

/** Everything Today needs, once per request. `home` is the already-loaded Home task list. */
export async function loadRoutineFacts(session: CrmSession, home: HomeTasks): Promise<RoutineFacts> {
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const needed = countersNeeded(session);
  const on = (module: string) => isModuleEnabled(session, module);
  const fmt = communityFormat(center);
  // The payment ways are read only for a person whose routine has a step about money.
  const plugins = canAccess(session, "bank") || canAccess(session, "recordPayment") || canAccess(session, "recurring") ? enabledPaymentPlugins(session) : Promise.resolve(null);

  const fromTasks = counterFromTasks(home.tasks, home.failures, visibleTaskSources(session).map((s) => s.key));
  const counts: RoutineFacts["counts"] = { ...fromTasks.counts };
  const failed: RoutineFacts["failed"] = { ...fromTasks.failed };

  let events: FactEvent[] = [];
  const pathshalaOn = on("pathshala") && canAccess(session, "pathshala");

  // The Pathshala counters share one database call each, so they are read once and handed to the counters that use them.
  const pathshala = needed.has("pathshala_to_place") || needed.has("pathshala_assistance") ? (pathshalaOn ? pathshalaCounts(session) : null) : null;
  const classes = needed.has("classes_today") || needed.has("attendance_missing") ? (pathshalaOn ? classesToday(session, today) : null) : null;

  const results = await Promise.all([
    read("applications", needed, canAccess(session, "applications") && on("membership"), async () =>
      n(await db.from("membership_applications").select("id", { count: "exact", head: true }).eq("center_id", center.id).in("status", ["awaiting_center", "awaiting_ec"])),
    ),
    read("bank_lines", needed, canAccess(session, "bank") && on("giving_bank"), async () =>
      n(
        await db
          .from("bank_transactions")
          .select("id", { count: "exact", head: true })
          .eq("center_id", center.id)
          .in("status", ["unmatched", "suggested"])
          .gt("amount_cents", 0),
      ),
    ),
    read("pledges_overdue", needed, canAccess(session, "pledges") && on("giving"), async () =>
      n(
        await db
          .from("pledges")
          .select("id", { count: "exact", head: true })
          .eq("center_id", center.id)
          .in("status", ["open", "partially_paid"])
          .lt("due_on", today),
      ),
    ),
    read("pledges_due_week", needed, canAccess(session, "pledges") && on("giving"), async () =>
      n(
        await db
          .from("pledges")
          .select("id", { count: "exact", head: true })
          .eq("center_id", center.id)
          .in("status", ["open", "partially_paid"])
          .gte("due_on", today)
          .lte("due_on", addDays(today, 6)),
      ),
    ),
    read("gyan_signoffs", needed, canAccess(session, "pathshalaSignoffs") && on("pathshala") && on("gyan_path"), async () =>
      n(await db.from("gyan_signoffs").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "requested")),
    ),
    read("pathshala_to_place", needed, pathshalaOn, async () => (await pathshala)?.to_place),
    read("pathshala_assistance", needed, pathshalaOn, async () => (await pathshala)?.assistance),
    read("classes_today", needed, pathshalaOn, async () => (await classes)?.classes),
    read("attendance_missing", needed, pathshalaOn, async () => (await classes)?.missing),
    read("events_week", needed, on("events"), async () => {
      events = await upcomingEvents(session, today);
      return events.length;
    }),
  ]);

  for (const r of results) {
    if (!r) continue;
    if ("error" in r) failed[r.key] = r.error;
    else counts[r.key] = r.value;
  }
  return { today, counts, failed, events, locale: fmt.locale, workWeek: workWeekFor(fmt.locale, center.rules), paymentPlugins: await plugins };
}
