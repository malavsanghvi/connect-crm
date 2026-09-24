import type { Metadata } from "next";
import Link from "next/link";

import { ClickableRow } from "@/components/events/clickable-row";
import { LoadProblem } from "@/components/events/load-problem";
import { Card, ChipLinks, EmptyState, NoAccess, PageHeader, TableWrap, buttonClass } from "@/components/ui";
import { allRows, load, rows } from "@/lib/data/events";
import { formatEventRange, fromDateTimeLocal, todayIso } from "@/lib/events/format";
import { audienceLabel, eventReport } from "@/lib/events/report";
import { STATUS_TEXT_CLASS, eventRef, eventRowHref, eventStatusLabel } from "@/lib/events/status";
import { canAccess } from "@/lib/permissions";
import { hrefWith, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Events" };

const VIEWS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "undated", label: "No date yet" },
] as const;

const STATUSES = [
  { key: "", label: "Any status" },
  { key: "draft", label: "Draft" },
  { key: "published", label: "RSVP open" },
  { key: "rsvp_closed", label: "RSVP closed" },
  { key: "live", label: "Live" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export default async function EventsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const canManage = canAccess(session, "eventsManage");
  const header = (
    <PageHeader
      title="Events"
      description="RSVPs, eligibility, waitlists, lunch slots and volunteers"
      actions={
        canManage ? (
          <Link href="/events/builder" className={buttonClass("primary")}>
            New event
          </Link>
        ) : null
      }
    />
  );
  if (!canAccess(session, "events")) {
    return (
      <>
        {header}
        <NoAccess area="Events" access="events" />
      </>
    );
  }

  const view = VIEWS.find((v) => v.key === param(sp, "view"))?.key ?? "upcoming";
  const status = STATUSES.some((s) => s.key && s.key === param(sp, "status")) ? param(sp, "status")! : "";
  const { db, center } = session;
  const tz = center.time_zone;

  const res = await load(async () => {
    const startOfToday = fromDateTimeLocal(`${todayIso(tz)}T00:00`, tz)!;
    let q = db
      .from("events")
      .select("id, event_number, name, starts_at, ends_at, venue, status, audience, capacity, waitlist_enabled, program_year, confidential")
      .eq("center_id", center.id);
    if (view === "upcoming") q = q.gte("starts_at", startOfToday).order("starts_at");
    if (view === "past") q = q.lt("starts_at", startOfToday).order("starts_at", { ascending: false }).limit(60);
    if (view === "undated") q = q.is("starts_at", null).order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const events = rows(await q, "events");
    const ids = events.map((e) => e.id);
    const [rsvps, attendees] = ids.length
      ? await Promise.all([
          allRows<{ id: string; event_id: string; status: string; source: string; confirmed_at: string | null }>(
            (f, t) => db.from("rsvps").select("id, event_id, status, source, confirmed_at").in("event_id", ids).order("id").range(f, t),
            "RSVP counts",
          ),
          allRows<{
            id: string;
            event_id: string;
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
                .select("id, event_id, rsvp_id, status, checked_in_at, served_food_at, lunch_slot_id, is_child_under_12, is_senior, needs_assistance")
                .in("event_id", ids)
                .order("id")
                .range(f, t),
            "attendee counts",
          ),
        ])
      : [[], []];
    return { events, rsvps, attendees };
  });

  const viewLabel = VIEWS.find((v) => v.key === view)!.label;

  return (
    <>
      {header}
      {!res.ok ? (
        <LoadProblem message={res.error} retryHref={hrefWith("/events", sp, {})} />
      ) : (
        <Card
          padded={false}
          title={status ? `${viewLabel} · ${STATUSES.find((s) => s.key === status)?.label}` : viewLabel}
          actions={
            <nav aria-label="Which events" className="flex flex-wrap gap-1.5">
              {VIEWS.map((v) => (
                <Link key={v.key} href={hrefWith("/events", sp, { view: v.key === "upcoming" ? undefined : v.key })} aria-current={v.key === view ? "page" : undefined} className="cc-chip">
                  {v.label}
                </Link>
              ))}
            </nav>
          }
        >
          <div className="px-2.5 pt-1">
            <ChipLinks
              label="Status"
              active={status}
              items={STATUSES.map((s) => ({ key: s.key, label: s.label, href: hrefWith("/events", sp, { status: s.key || undefined }) }))}
            />
          </div>
          {res.data.events.length === 0 ? (
            <EmptyState title={view === "upcoming" ? "No upcoming events" : view === "past" ? "No past events" : "No events without a date"}>
              {canManage ? (
                <Link href="/events/builder" className="crm-link font-semibold">
                  Create an event in the builder
                </Link>
              ) : null}
            </EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Audience</th>
                    <th className="num">RSVP</th>
                    <th className="num">Confirmed</th>
                    <th className="num">Cap</th>
                    <th className="num">Waitlist</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.events.map((e) => {
                    const r = eventReport(
                      res.data.rsvps.filter((x) => x.event_id === e.id),
                      res.data.attendees.filter((x) => x.event_id === e.id),
                    );
                    const st = eventStatusLabel(e.status, {
                      waitlistEnabled: e.waitlist_enabled,
                      waitlisted: r.waitlistedPeople,
                      capacity: e.capacity,
                      booked: r.rsvpdPeople,
                    });
                    const href = eventRowHref(e);
                    return (
                      <ClickableRow key={e.id} href={href}>
                        <td className="font-mono text-xs">{eventRef(e)}</td>
                        <td className="max-w-[18rem]">
                          <Link href={href} className="block truncate font-bold text-ink hover:underline">
                            {e.name}
                          </Link>
                          {e.venue || e.program_year || e.confidential ? (
                            <div className="truncate text-xs text-muted">
                              {[e.venue, e.program_year ? `Pathshala ${e.program_year}` : null, e.confidential ? "confidential" : null].filter(Boolean).join(" · ")}
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap">{formatEventRange(e.starts_at, e.ends_at, tz)}</td>
                        <td>{audienceLabel(e.audience)}</td>
                        <td className="num">{r.rsvpdPeople}</td>
                        <td className="num">{r.confirmedPeople || "—"}</td>
                        <td className="num">{e.capacity ?? "—"}</td>
                        <td className="num">{r.waitlistedPeople || "—"}</td>
                        <td>
                          <span className={`whitespace-nowrap ${STATUS_TEXT_CLASS[st.tone]}`}>{st.label}</span>
                        </td>
                      </ClickableRow>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
    </>
  );
}
