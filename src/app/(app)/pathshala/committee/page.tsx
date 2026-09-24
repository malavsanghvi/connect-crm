import type { Metadata } from "next";
import Link from "next/link";

import { buttonClass, Card, EmptyState, KpiGrid } from "@/components/ui";
import { committeeDashboard, daysUntil, HORIZON_DAYS } from "@/lib/logic/eams";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { addDays, formatDate, todayIso } from "@/lib/pathshala/format";
import { load, resolvePeopleNames, rows, viewerOf } from "@/lib/pathshala/server";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { LoadProblem, Notice, PNoAccess, PStat, SectionHeading } from "../ui";
import { ActionRow } from "./action-row";

export const metadata: Metadata = { title: "Committee dashboard" };

export default async function CommitteeDashboard() {
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.committee(v)) return <PNoAccess area="the Pathshala committee" />;
  if (!can(v, ["events.view", "events.manage"])) {
    return (
      <Notice>
        The dashboard tracks event actions, which your role can&apos;t see. Use{" "}
        <Link className="font-semibold underline" href="/pathshala/committee/concerns">Concerns</Link> or{" "}
        <Link className="font-semibold underline" href="/pathshala/committee/resolutions">Resolutions</Link>.
      </Notice>
    );
  }
  const supabase = v.db;
  const tz = v.center.time_zone;
  const today = todayIso(tz);

  const res = await load(async () => {
    const [actions, events] = await Promise.all([
      supabase
        .from("actions")
        .select("id, name, state, due_on, owner_person_id, phase, priority, event_id, action_type")
        .eq("center_id", v.center.id)
        .eq("is_idea", false)
        .not("state", "in", "(completed,removed)"),
      supabase
        .from("events")
        .select("id, name, starts_at, owner_person_id, program_year, status")
        .eq("center_id", v.center.id)
        .not("starts_at", "is", null)
        .gte("starts_at", `${addDays(today, -2)}T00:00:00Z`)
        .lte("starts_at", `${addDays(today, HORIZON_DAYS + 2)}T00:00:00Z`),
    ]);
    const a = rows(actions, "committee actions");
    const e = rows(events, "upcoming events");
    const eventIds = [...new Set(a.map((x) => x.event_id).filter((x): x is string => Boolean(x)))].filter((id) => !e.some((ev) => ev.id === id));
    const moreEvents = eventIds.length ? rows(await supabase.from("events").select("id, name").in("id", eventIds), "event names") : [];
    const names = await resolvePeopleNames(supabase, [...a.map((x) => x.owner_person_id), ...e.map((x) => x.owner_person_id)]);
    return { actions: a, events: e, eventNames: new Map([...e, ...moreEvents].map((x) => [x.id, x.name])), names };
  });
  if (!res.ok) return <LoadProblem message={res.error} />;
  const { actions, events, eventNames, names } = res.data;
  const dash = committeeDashboard(
    actions,
    events.map((e) => ({ ...e, starts_on: e.starts_at ? todayIso(tz, new Date(e.starts_at)) : null })),
    today,
  );
  const row = (a: (typeof actions)[number]) => (
    <ActionRow key={a.id} a={a} today={today} ownerName={a.owner_person_id ? (names.get(a.owner_person_id) ?? "Someone") : null} eventName={a.event_id ? (eventNames.get(a.event_id) ?? "Event") : null} />
  );

  return (
    <>
      <SectionHeading
        title="Next two weeks"
        description="Overdue, due within 3 days and unassigned actions, plus events in the next 14 days."
        actions={
          can(v, "events.manage") && (
            <Link href="/pathshala/committee/actions#new" className={buttonClass("primary")}>
              New action
            </Link>
          )
        }
      />
      <KpiGrid cols={4}>
        <PStat label="Overdue" value={dash.overdue.length} tone="danger" />
        <PStat label="Due ≤ 3 days" value={dash.dueSoon.length} tone="warning" />
        <PStat label="Unassigned" value={dash.unassigned.length} sub="in the next 2 weeks" tone="maroon" />
        <PStat label="Events ≤ 2 weeks" value={dash.eventsSoon.length} tone="purple" />
      </KpiGrid>
      {dash.allClear ? (
        <EmptyState title="All clear">Nothing at risk in the next two weeks.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {dash.unassigned.length > 0 && (
              <Card title="Unassigned — needs an owner">
                <ul className="divide-y divide-line">{dash.unassigned.map(row)}</ul>
              </Card>
            )}
            {dash.overdue.length > 0 && (
              <Card title="Overdue — needs attention now">
                <ul className="divide-y divide-line">{dash.overdue.map(row)}</ul>
              </Card>
            )}
            {dash.dueSoon.length > 0 && (
              <Card title="Due within 3 days">
                <ul className="divide-y divide-line">{dash.dueSoon.map(row)}</ul>
              </Card>
            )}
          </div>
          <div className="space-y-4">
            <Card title="Upcoming events">
              {dash.eventsSoon.length === 0 ? (
                <p className="text-sm text-muted">No events in the next two weeks.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {dash.eventsSoon.map((e) => {
                    const d = daysUntil(e.starts_on, today);
                    return (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div>
                          <Link href={`/events/${e.id}?tab=checklist`} className="crm-link font-semibold">
                            {e.name}
                          </Link>
                          <p className="text-xs text-muted">
                            {formatDate(e.starts_on)}
                            {e.program_year ? ` · ${e.program_year}` : ""} · owner {e.owner_person_id ? (names.get(e.owner_person_id) ?? "someone") : "not set"}
                          </p>
                        </div>
                        <span className="text-sm font-semibold">{d === 0 ? "Today" : d === -1 ? "Yesterday" : `In ${d} days`}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            {dash.upcoming.length > 0 && (
              <Card title={`Other actions due within ${HORIZON_DAYS} days`}>
                <ul className="divide-y divide-line">{dash.upcoming.map(row)}</ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
