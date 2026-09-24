import "server-only";

import type { StatTone } from "@/components/ui";
import { fetchAll } from "@/lib/data/fetch-all";
import { addDays, formatDate, todayInTz } from "@/lib/dates";
import { explainError, type DbErrorLike } from "@/lib/errors";
import { isModuleEnabled } from "@/lib/modules";
import { can, canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { compactMoney, percent, plural } from "@/lib/tasks";

// Home "At a glance" (prototype P:521–525). Each figure appears only for
// someone whose role reaches the data behind it; a failed read says so.

export type Kpi =
  | { label: string; tone: StatTone; href?: string; state: "ok"; value: string; sub: string }
  | { label: string; tone: StatTone; href?: string; state: "error"; message: string };

type Spec = { label: string; tone: StatTone; href?: string; show: boolean; load: () => Promise<{ value: string; sub: string }> };

class KpiError extends Error {
  constructor(readonly db: DbErrorLike) {
    super(db.message ?? "query failed");
  }
}
function ok<T>(res: { data: T | null; error: DbErrorLike | null }): T {
  if (res.error) throw new KpiError(res.error);
  return res.data as T;
}
function n(res: { count: number | null; error: DbErrorLike | null }): number {
  if (res.error) throw new KpiError(res.error);
  return res.count ?? 0;
}

export async function loadHomeKpis(session: CrmSession): Promise<Kpi[]> {
  const { db, center } = session;
  const cid = center.id;
  const today = todayInTz(center.time_zone);
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const specs: Spec[] = [
    {
      label: "Households",
      tone: "navy",
      href: "/households",
      show: canAccess(session, "memberships") && isModuleEnabled(session, "membership"),
      async load() {
        const [all, fresh] = await Promise.all([
          db
            .from("households")
            .select("id, memberships!inner(id)", { count: "exact", head: true })
            .eq("center_id", cid)
            .is("merged_into_id", null)
            .eq("memberships.status", "active")
            .neq("memberships.tier", "community"),
          db
            .from("memberships")
            .select("id", { count: "exact", head: true })
            .eq("center_id", cid)
            .eq("status", "active")
            .neq("tier", "community")
            .gte("starts_on", yearStart),
        ]);
        return { value: n(all).toLocaleString("en-US"), sub: `Yearly and life members · +${n(fresh).toLocaleString("en-US")} this year` };
      },
    },
    {
      label: "On the app",
      tone: "success",
      href: "/people",
      show: canAccess(session, "households"),
      async load() {
        const [people, logins] = await Promise.all([
          db.from("people").select("id", { count: "exact", head: true }).eq("center_id", cid).is("merged_into_id", null).eq("is_deceased", false),
          db.from("center_users").select("user_id", { count: "exact", head: true }).eq("center_id", cid).not("person_id", "is", null),
        ]);
        const total = n(people);
        const on = n(logins);
        const pct = percent(on, total);
        return { value: pct === null ? "—" : `${pct}%`, sub: `${on.toLocaleString("en-US")} of ${plural(total, "person", "people")} sign in` };
      },
    },
    {
      label: "Given this year",
      tone: "brown",
      href: "/giving/payments",
      show: can(session, ["giving.view", "giving.manage"]) && isModuleEnabled(session, "giving"),
      async load() {
        const { data, error, truncated } = await fetchAll((from, to) =>
          db
            .from("payments")
            .select("id, amount_cents, refunded_cents")
            .eq("center_id", cid)
            .gte("received_on", yearStart)
            .in("status", ["captured", "pending_clearing", "settled", "partially_refunded"])
            .order("id")
            .range(from, to),
        );
        if (error) throw new KpiError(error);
        const total = data.reduce((a, p) => a + p.amount_cents - p.refunded_cents, 0);
        return { value: compactMoney(total, center.currency), sub: `Payments received, cash basis${truncated ? " (first 50,000 only)" : ""}` };
      },
    },
    {
      label: "Open pledges",
      tone: "brown",
      href: "/giving/pledges",
      show: canAccess(session, "pledges") && isModuleEnabled(session, "giving"),
      async load() {
        const { data, error, truncated } = await fetchAll((from, to) =>
          db
            .from("pledges")
            .select("id, amount_cents, paid_cents")
            .eq("center_id", cid)
            .in("status", ["open", "partially_paid"])
            .order("id")
            .range(from, to),
        );
        if (error) throw new KpiError(error);
        const open = data.reduce((a, p) => a + p.amount_cents - p.paid_cents, 0);
        return { value: compactMoney(open, center.currency), sub: `${plural(data.length, "pledge")}${truncated ? " (first 50,000 only)" : ""}` };
      },
    },
    {
      label: "Next event RSVPs",
      tone: "maroon",
      href: "/events",
      show: can(session, ["events.view", "events.manage"]) && isModuleEnabled(session, "events"),
      async load() {
        const events = ok(
          await db
            .from("events")
            .select("id, name, starts_at")
            .eq("center_id", cid)
            .in("status", ["published", "rsvp_closed", "live"])
            .gte("starts_at", new Date().toISOString())
            .order("starts_at")
            .limit(1),
        );
        const e = events[0];
        if (!e) return { value: "—", sub: "No upcoming event is published" };
        const people = n(
          await db
            .from("attendees")
            .select("id", { count: "exact", head: true })
            .eq("event_id", e.id)
            .in("status", ["rsvpd", "confirmed", "attended"]),
        );
        return { value: people.toLocaleString("en-US"), sub: `${e.name} · ${formatDate(e.starts_at, center.time_zone)}` };
      },
    },
    {
      label: "Store orders this cycle",
      tone: "store",
      href: "/store",
      show: can(session, "store.manage") && isModuleEnabled(session, "store"),
      async load() {
        const open = n(
          await db.from("store_orders").select("id", { count: "exact", head: true }).eq("center_id", cid).in("status", ["placed", "preparing", "ready"]),
        );
        return { value: open.toLocaleString("en-US"), sub: "Placed and waiting for pickup" };
      },
    },
    {
      label: "Pathshala students",
      tone: "purple",
      href: "/pathshala",
      show: can(session, "pathshala.manage") && isModuleEnabled(session, "pathshala"),
      async load() {
        const since = `${addDays(today, -30)}T00:00:00Z`;
        const [students, marks] = await Promise.all([
          db.from("pathshala_enrollments").select("id", { count: "exact", head: true }).eq("center_id", cid).eq("status", "active"),
          fetchAll((from, to) =>
            db.from("pathshala_attendance").select("id, status").eq("center_id", cid).gte("marked_at", since).order("id").range(from, to),
          ),
        ]);
        if (marks.error) throw new KpiError(marks.error);
        const present = marks.data.filter((m) => m.status === "present" || m.status === "late").length;
        const pct = percent(present, marks.data.length);
        return { value: n(students).toLocaleString("en-US"), sub: pct === null ? "No attendance marked in the last 30 days" : `${pct}% attendance · last 30 days` };
      },
    },
  ];

  return Promise.all(
    specs
      .filter((s) => s.show)
      .map(async (s): Promise<Kpi> => {
        try {
          const r = await s.load();
          return { label: s.label, tone: s.tone, href: s.href, state: "ok", ...r };
        } catch (error) {
          const detail = error instanceof KpiError ? error.db : error;
          console.error(`[home] "${s.label}" figure failed:`, detail);
          return { label: s.label, tone: s.tone, href: s.href, state: "error", message: explainError(detail) };
        }
      }),
  );
}
