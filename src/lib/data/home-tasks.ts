import "server-only";

import { cache } from "react";

import { householdsById, peopleById, userNames } from "@/lib/data/lookups";
import { addDays, daysBetween, dateInTz, formatDate, todayInTz } from "@/lib/dates";
import { explainError, type DbErrorLike } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import {
  lowStock,
  makeTask,
  orderTasks,
  plural,
  taskSource,
  visibleTaskSources,
  type HomeTask,
  type HomeTasks,
  type TaskFailure,
  type TaskSourceKey,
} from "@/lib/tasks";

// Queries behind Home "My tasks" (src/lib/tasks.ts has the pure rules).
// Each source is read on its own: a failure becomes a visible "could not
// load" row for that source, never a silently shorter list.

class SourceError extends Error {
  constructor(readonly db: DbErrorLike) {
    super(db.message ?? "query failed");
  }
}

function must<T>(res: { data: T | null; error: DbErrorLike | null }): T {
  if (res.error) throw new SourceError(res.error);
  return res.data as T;
}
function count(res: { count: number | null; error: DbErrorLike | null }): number {
  if (res.error) throw new SourceError(res.error);
  return res.count ?? 0;
}

type Loader = (session: CrmSession) => Promise<HomeTask[]>;

const TIER_LABEL: Record<string, string> = { life: "Life", yearly: "Yearly", community: "Community" };

const loaders: Record<TaskSourceKey, Loader> = {
  async refund(session) {
    const { db, center } = session;
    const rows = must(
      await db
        .from("payments")
        .select("id, receipt_number, household_id, amount_cents, refund_requested_cents, refund_reason, refund_approved_by, refund_second_approver")
        .eq("center_id", center.id)
        .not("refund_approved_by", "is", null)
        .eq("refunded_cents", 0)
        .order("updated_at")
        .limit(25),
    );
    if (rows.length === 0) return [];
    const [hh, names] = await Promise.all([
      householdsById(db, rows.map((r) => r.household_id)),
      userNames(db, center.id, rows.map((r) => r.refund_approved_by)),
    ]);
    const canApprove = can(session, "giving.approve");
    return rows.map((r) => {
      const amount = formatCents(r.refund_requested_cents ?? r.amount_cents, center.currency);
      const household = hh.map.get(r.household_id)?.display_name ?? "household";
      const mine = r.refund_approved_by === session.userId;
      const who = mine ? "you" : (names.get(r.refund_approved_by ?? "")?.name ?? "a colleague");
      const ref = r.receipt_number ?? "payment";
      const href = `/households/${r.household_id}?tab=payments`;
      if (r.refund_second_approver) {
        return makeTask("refund", r.id, `Record refund ${ref} · ${amount} · ${household}`, `Both approvals are in · ${who} record${mine ? "" : "s"} the refund`, [
          { label: "Open", href },
        ]);
      }
      const meta = `${r.refund_reason ? `${r.refund_reason} · ` : ""}requested by ${who}${mine ? " (you, so another approver is needed)" : ""}`;
      return makeTask(
        "refund",
        r.id,
        `Approve refund ${ref} · ${amount} · ${household}`,
        meta,
        [{ label: "Open", href }],
        !mine && canApprove
          ? {
              table: "payments",
              id: r.id,
              label: "Approve",
              confirmTitle: `Approve refund ${ref}?`,
              confirmBody: `${amount} to ${household}.${r.refund_reason ? ` ${r.refund_reason}.` : ""} You are the second approver; ${who} records the refund afterwards.`,
            }
          : undefined,
      );
    });
  },

  async writeoff(session) {
    const { db, center } = session;
    const rows = must(
      await db
        .from("pledges")
        .select("id, pledge_number, household_id, amount_cents, paid_cents, written_off_by, written_off_second_approver, write_off_reason")
        .eq("center_id", center.id)
        .not("written_off_by", "is", null)
        .in("status", ["open", "partially_paid"])
        .order("updated_at")
        .limit(25),
    );
    if (rows.length === 0) return [];
    const [hh, names] = await Promise.all([
      householdsById(db, rows.map((r) => r.household_id)),
      userNames(db, center.id, rows.map((r) => r.written_off_by)),
    ]);
    const canApprove = can(session, "giving.approve");
    return rows.map((r) => {
      const amount = formatCents(r.amount_cents - r.paid_cents, center.currency);
      const household = hh.map.get(r.household_id)?.display_name ?? "household";
      const mine = r.written_off_by === session.userId;
      const who = mine ? "you" : (names.get(r.written_off_by ?? "")?.name ?? "a colleague");
      const ref = r.pledge_number ?? "pledge";
      const href = `/households/${r.household_id}?tab=pledges`;
      if (r.written_off_second_approver) {
        return makeTask("writeoff", r.id, `Complete write-off ${ref} · ${amount} · ${household}`, `Both approvals are in · ${who} complete${mine ? "" : "s"} the write-off`, [
          { label: "Open", href },
        ]);
      }
      return makeTask(
        "writeoff",
        r.id,
        `Approve write-off ${ref} · ${amount} open · ${household}`,
        `${r.write_off_reason ? `${r.write_off_reason} · ` : ""}requested by ${who}${mine ? " (you, so another approver is needed)" : ""}`,
        [{ label: "Open", href }],
        !mine && canApprove
          ? {
              table: "pledges",
              id: r.id,
              label: "Approve",
              confirmTitle: `Approve write-off ${ref}?`,
              confirmBody: `${amount} still open on ${household}.${r.write_off_reason ? ` ${r.write_off_reason}.` : ""} You are the second approver.`,
            }
          : undefined,
      );
    });
  },

  async override(session) {
    const { db, center } = session;
    const rows = must(
      await db
        .from("eligibility_snapshots")
        .select("id, person_id, override_by, override_reason, override_second_approver, override_can_vote, override_requested_value")
        .eq("center_id", center.id)
        .not("override_by", "is", null)
        .is("override_can_vote", null)
        .limit(25),
    );
    if (rows.length === 0) return [];
    const [people, names] = await Promise.all([
      peopleById(db, rows.map((r) => r.person_id)),
      userNames(db, center.id, rows.map((r) => r.override_by)),
    ]);
    return rows.map((r) => {
      const person = people.map.get(r.person_id)?.name ?? "a member";
      const mine = r.override_by === session.userId;
      const who = mine ? "you" : (names.get(r.override_by ?? "")?.name ?? "a colleague");
      const want = r.override_requested_value === false ? "not eligible" : "eligible";
      const href = `/people/voting?person=${r.person_id}`;
      if (r.override_second_approver) {
        return makeTask("override", r.id, `Apply voting override · ${person}`, `Both approvals are in · mark ${want}`, [{ label: "Open", href }]);
      }
      return makeTask(
        "override",
        r.id,
        `Approve voting override · ${person} (${want})`,
        `${r.override_reason ? `${r.override_reason} · ` : ""}requested by ${who}${mine ? " (you, so another approver is needed)" : ""}`,
        [{ label: "Open", href }],
        !mine
          ? {
              table: "eligibility_snapshots",
              id: r.id,
              label: "Approve",
              confirmTitle: `Approve the voting override for ${person}?`,
              confirmBody: `${person} would be marked ${want}.${r.override_reason ? ` Reason: ${r.override_reason}.` : ""} You are the second approver.`,
            }
          : undefined,
      );
    });
  },

  async deposits(session) {
    const { db, center } = session;
    const [lines, deposits] = await Promise.all([
      db
        .from("bank_transactions")
        .select("id", { count: "exact", head: true })
        .eq("center_id", center.id)
        .in("status", ["unmatched", "suggested"])
        .gt("amount_cents", 0),
      db
        .from("bank_transactions")
        .select("id", { count: "exact", head: true })
        .eq("center_id", center.id)
        .in("status", ["unmatched", "suggested"])
        .gt("amount_cents", 0)
        .eq("is_batch_deposit", true),
    ]);
    const n = count(lines);
    if (n === 0) return [];
    const k = count(deposits);
    return [
      makeTask("deposits", "all", `${plural(n, "bank line")} to match`, `Money in without a matched gift${k ? ` · ${plural(k, "check or cash deposit")}` : ""}`, [
        { label: "Open", href: "/giving/bank" },
      ]),
    ];
  },

  async membership(session) {
    const { db, center } = session;
    const rows = must(
      await db
        .from("membership_applications")
        .select("id, applicant_person_id, reference_person_id, reference_decision, reference_decided_at, tier, fee_cents, fee_authorization_ref, status")
        .eq("center_id", center.id)
        .in("status", ["awaiting_center", "awaiting_ec"])
        .order("created_at")
        .limit(25),
    );
    if (rows.length === 0) return [];
    const people = await peopleById(db, [...rows.map((r) => r.applicant_person_id), ...rows.map((r) => r.reference_person_id)]);
    return rows.map((r) => {
      const who = people.map.get(r.applicant_person_id)?.name ?? "applicant";
      const ref = r.reference_person_id ? (people.map.get(r.reference_person_id)?.name ?? "reference") : "none named";
      const decided =
        r.reference_decision === "approved"
          ? `Approved${r.reference_decided_at ? ` ${formatDate(r.reference_decided_at, center.time_zone)}` : ""}`
          : "reference pending";
      const fee = r.fee_cents > 0 ? `${formatCents(r.fee_cents, center.currency)} ${r.fee_authorization_ref ? "authorized" : "due"}` : "No fee";
      return makeTask(
        "membership",
        r.id,
        `${TIER_LABEL[r.tier] ?? r.tier} membership · ${who}${r.status === "awaiting_ec" ? " · EC approval" : ""}`,
        `Reference ${ref} · ${decided} · ${fee}`,
        [{ label: "Review", href: `/memberships/applications?app=${r.id}` }],
      );
    });
  },

  async newsletter(session) {
    const { db, center } = session;
    const rows = must(
      await db
        .from("comms_campaigns")
        .select("id, title, kind, recipients_count, created_by")
        .eq("center_id", center.id)
        .eq("status", "pending_approval")
        .order("created_at")
        .limit(10),
    );
    if (rows.length === 0) return [];
    const names = await userNames(db, center.id, rows.map((r) => r.created_by));
    return rows.map((r) =>
      makeTask(
        "newsletter",
        r.id,
        `Approve "${r.title}"`,
        `${r.kind === "newsletter" ? "Newsletter" : r.kind.replace(/_/g, " ")}${r.recipients_count ? ` · ${plural(r.recipients_count, "recipient")}` : ""} · drafted by ${names.get(r.created_by ?? "")?.name ?? "a colleague"}`,
        [{ label: "Open", href: taskSource("newsletter").href }],
      ),
    );
  },

  async inbox(session) {
    const { db, center } = session;
    const res = await db
      .from("threads")
      .select("id, created_at", { count: "exact" })
      .eq("center_id", center.id)
      .eq("status", "open")
      .is("assignee_user", null)
      .order("created_at")
      .limit(1);
    const n = count(res);
    if (n === 0) return [];
    const oldest = res.data?.[0]?.created_at;
    const days = oldest ? daysBetween(dateInTz(oldest, center.time_zone), todayInTz(center.time_zone)) : 0;
    return [
      makeTask("inbox", "unassigned", plural(n, "unassigned member question"), `Oldest ${days <= 0 ? "today" : plural(days, "day")} · reply target 3–5 business days`, [
        { label: "Open", href: taskSource("inbox").href },
      ]),
    ];
  },

  async whatsapp(session) {
    const n = count(
      await session.db
        .from("whatsapp_join_requests")
        .select("id", { count: "exact", head: true })
        .eq("center_id", session.center.id)
        .eq("status", "pending"),
    );
    if (n === 0) return [];
    return [
      makeTask("whatsapp", "pending", plural(n, "WhatsApp join request"), "Add members to groups by phone number", [
        { label: "Open", href: taskSource("whatsapp").href },
      ]),
    ];
  },

  async content(session) {
    const { db, center } = session;
    const [items, photos] = await Promise.all([
      db.from("content_items").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "in_review"),
      can(session, "content.manage")
        ? db.from("photos").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "pending")
        : null,
    ]);
    const a = count(items);
    const b = photos ? count(photos) : 0;
    if (a + b === 0) return [];
    const parts = [a ? plural(a, "page or text", "pages and texts") : null, b ? plural(b, "photo") : null].filter(Boolean).join(" and ");
    return [
      makeTask("content", "review", `${plural(a + b, "item")} awaiting approval`, `${parts} · religious text and photos with children are checked first`, [
        { label: "Open", href: taskSource("content").href },
      ]),
    ];
  },

  async quickbooks(session) {
    const n = count(
      await session.db
        .from("ledger_postings")
        .select("id", { count: "exact", head: true })
        .eq("center_id", session.center.id)
        .eq("status", "failed"),
    );
    if (n === 0) return [];
    return [
      makeTask("quickbooks", "failed", plural(n, "QuickBooks exception"), "Month-end close is blocked until cleared", [
        { label: "Fix", href: taskSource("quickbooks").href },
      ]),
    ];
  },

  async inventory(session) {
    const rows = must(
      await session.db
        .from("store_items")
        .select("id, name, track_inventory, stock_on_hand, low_stock_threshold")
        .eq("center_id", session.center.id)
        .eq("status", "active")
        .eq("track_inventory", true)
        .not("low_stock_threshold", "is", null)
        .limit(500),
    );
    const low = lowStock(rows);
    if (low.length === 0) return [];
    const names = low
      .slice(0, 4)
      .map((x) => x.name)
      .join(", ");
    return [
      makeTask("inventory", "low", `${plural(low.length, "item")} below reorder level`, `${names}${low.length > 4 ? ` and ${low.length - 4} more` : ""}`, [
        { label: "Open", href: taskSource("inventory").href },
      ]),
    ];
  },

  async waivers(session) {
    const { db, center } = session;
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 86_400_000).toISOString();
    const events = must(
      await db
        .from("events")
        .select("id, name, starts_at")
        .eq("center_id", center.id)
        .in("status", ["published", "rsvp_closed", "live"])
        .gte("starts_at", now.toISOString())
        .lte("starts_at", horizon)
        .order("starts_at")
        .limit(3),
    );
    const out: HomeTask[] = [];
    for (const e of events) {
      const shifts = must(await db.from("volunteer_shifts").select("id").eq("event_id", e.id));
      if (shifts.length === 0) continue;
      const missing = count(
        await db
          .from("volunteer_assignments")
          .select("id", { count: "exact", head: true })
          .in(
            "shift_id",
            shifts.map((s) => s.id),
          )
          .in("status", ["assigned", "confirmed"])
          .is("waiver_consent_id", null),
      );
      if (missing === 0) continue;
      const days = e.starts_at ? daysBetween(todayInTz(center.time_zone), dateInTz(e.starts_at, center.time_zone)) : 0;
      out.push(
        makeTask(
          "waivers",
          e.id,
          `${e.name} ${days <= 0 ? "today" : `in ${plural(days, "day")}`} · ${plural(missing, "volunteer")} missing signed waivers`,
          "Waivers must be signed in the member app before check-in duty",
          [{ label: "Open event", href: `/events/${e.id}` }],
        ),
      );
    }
    return out;
  },

  async feedback(session) {
    const { db, center } = session;
    const since = addDays(todayInTz(center.time_zone), -21);
    const surveys = must(
      await db
        .from("surveys")
        .select("id, title, event_id, status")
        .eq("center_id", center.id)
        .eq("kind", "event_feedback")
        .in("status", ["open", "closed"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(3),
    );
    const out: HomeTask[] = [];
    for (const s of surveys) {
      const n = count(await db.from("survey_responses").select("id", { count: "exact", head: true }).eq("survey_id", s.id));
      if (n === 0) continue;
      out.push(
        makeTask(
          "feedback",
          s.id,
          `${s.title}: ${plural(n, "response")}`,
          s.status === "open" ? "Still collecting responses" : "Closed · review the answers and follow up",
          [{ label: "Review", href: s.event_id ? `/events/${s.event_id}` : taskSource("feedback").href }],
        ),
      );
    }
    return out;
  },

  async bolis(session) {
    const { db, center } = session;
    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    const bolis = must(
      await db
        .from("bolis")
        .select("id, name, closes_at")
        .eq("center_id", center.id)
        .eq("status", "open")
        .gte("closes_at", now.toISOString())
        .lte("closes_at", horizon)
        .order("closes_at")
        .limit(20),
    );
    if (bolis.length === 0) return [];
    const entries = must(
      await db
        .from("boli_entries")
        .select("boli_id")
        .in(
          "boli_id",
          bolis.map((b) => b.id),
        ),
    );
    const per = new Map<string, number>();
    for (const e of entries) per.set(e.boli_id, (per.get(e.boli_id) ?? 0) + 1);
    const first = bolis[0].closes_at;
    const when = first
      ? new Intl.DateTimeFormat("en-US", { timeZone: center.time_zone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(first))
      : "soon";
    const meta = bolis
      .slice(0, 3)
      .map((b) => {
        const n = per.get(b.id) ?? 0;
        return `${b.name} has ${n ? plural(n, "entry", "entries") : "none yet"}`;
      })
      .join("; ");
    return [
      makeTask("bolis", "closing", `${plural(bolis.length, "digital boli", "digital bolis")} close${bolis.length === 1 ? "s" : ""} ${when}`, meta, [
        { label: "Open", href: taskSource("bolis").href },
      ]),
    ];
  },

  async pathshala(session) {
    const { db, center } = session;
    const today = todayInTz(center.time_zone);
    const [y, m] = today.split("-").map(Number);
    const monthEnd = `${today.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const [signoffs, waitlist, checks] = await Promise.all([
      db.from("gyan_signoffs").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "requested"),
      db.from("pathshala_enrollments").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "waitlisted"),
      can(session, ["safety.view", "safety.manage"])
        ? db
            .from("background_checks")
            .select("id", { count: "exact", head: true })
            .eq("center_id", center.id)
            .eq("status", "clear")
            .gte("expires_on", today)
            .lte("expires_on", monthEnd)
        : null,
    ]);
    const s = count(signoffs);
    const w = count(waitlist);
    const c = checks ? count(checks) : 0;
    if (s + w + c === 0) return [];
    const title = [s ? `${plural(s, "Gyan Path sign-off")} waiting on teachers` : null, c ? `${plural(c, "background check")} expire this month` : null]
      .filter(Boolean)
      .join(" · ");
    const waitText = `${plural(w, "student")} on class waitlists`;
    return [
      makeTask("pathshala", "queue", title || waitText, title && w ? waitText : "Classes, sign-offs and checks", [
        { label: "Open", href: taskSource("pathshala").href },
      ]),
    ];
  },

  async privacy(session) {
    const { db, center } = session;
    const res = await db
      .from("data_requests")
      .select("id, due_on", { count: "exact" })
      .eq("center_id", center.id)
      .in("status", ["open", "in_progress"])
      .order("due_on")
      .limit(1);
    const n = count(res);
    if (n === 0) return [];
    const due = res.data?.[0]?.due_on;
    return [
      makeTask("privacy", "open", `${plural(n, "data request")} in progress`, due ? `Earliest due ${formatDate(due, center.time_zone)}` : "No due date recorded", [
        { label: "Open", href: taskSource("privacy").href },
      ]),
    ];
  },
};

async function runSource(key: TaskSourceKey, session: CrmSession): Promise<{ tasks: HomeTask[]; failure: TaskFailure | null }> {
  try {
    return { tasks: await loaders[key](session), failure: null };
  } catch (error) {
    const detail = error instanceof SourceError ? error.db : error;
    console.error(`[home-tasks] could not load the "${key}" tasks:`, detail);
    return { tasks: [], failure: { source: key, tag: taskSource(key).tag, message: explainError(detail) } };
  }
}

/**
 * Every task the user can act on, in the prototype's order. Cached per
 * request, so the sidebar badge (layout) and Home share one set of queries.
 */
export const loadHomeTasks = cache(async (session: CrmSession): Promise<HomeTasks> => {
  const sources = visibleTaskSources(session);
  const results = await Promise.all(sources.map((s) => runSource(s.key, session)));
  return {
    tasks: orderTasks(results.flatMap((r) => r.tasks)),
    failures: results.flatMap((r) => (r.failure ? [r.failure] : [])),
  };
});

export type TaskCount = { ok: true; count: number } | { ok: false; error: string } | null;

/** The Home badge: how many tasks wait (null when the user has no task sources). */
export async function countHomeTasks(session: CrmSession): Promise<TaskCount> {
  if (visibleTaskSources(session).length === 0) return null;
  const { tasks, failures } = await loadHomeTasks(session);
  if (tasks.length === 0 && failures.length > 0) {
    return { ok: false, error: `Could not count your tasks — ${failures[0].message}` };
  }
  return { ok: true, count: tasks.length };
}
