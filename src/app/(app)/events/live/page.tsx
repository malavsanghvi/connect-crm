import type { Metadata } from "next";
import Link from "next/link";

import { AutoRefresh } from "@/components/events/auto-refresh";
import { LoadProblem } from "@/components/events/load-problem";
import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, Stat, TableWrap, buttonClass } from "@/components/ui";
import { load, loadEventAccess, loadLiveStats, loadRecentCheckins, rows } from "@/lib/data/events";
import { addDays, dateInTz, startOfDayInTz, todayInTz } from "@/lib/dates";
import { eventAreas, pickCurrentEvent } from "@/lib/events/access";
import { formatClock, formatEventDate, formatTime, plural } from "@/lib/events/format";
import { UNLIMITED_SEATS, formatSeconds } from "@/lib/events/report";
import { canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Live check-in" };

const BOARD_CLASS: Record<string, string> = {
  Serving: "cc-status-ok",
  Next: "font-bold text-ink",
  Queued: "font-bold text-ink",
  Open: "font-bold text-ink",
  Done: "font-semibold text-muted",
};

export default async function LiveCheckInPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  if (!canAccess(session, "events")) {
    return (
      <>
        <PageHeader title="Live check-in" />
        <NoAccess area="Events" access="events" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const access = await loadEventAccess(session);
  const wanted = param(sp, "event");

  const res = await load(async () => {
    // Events around today: the live one, today's, and the next and last few.
    const since = startOfDayInTz(addDays(todayInTz(tz), -45), tz);
    const events = rows(
      await db
        .from("events")
        .select("id, name, venue, starts_at, ends_at, status, lunch_enabled")
        .eq("center_id", center.id)
        .not("status", "in", "(draft,cancelled)")
        .or(`starts_at.gte."${since}",status.eq.live`)
        .order("starts_at", { ascending: true })
        .limit(60),
      "events",
    );
    let current = wanted && isUuid(wanted) ? (events.find((e) => e.id === wanted) ?? null) : null;
    if (wanted && isUuid(wanted) && !current) {
      current = rows(
        await db.from("events").select("id, name, venue, starts_at, ends_at, status, lunch_enabled").eq("id", wanted).limit(1),
        "the event",
      )[0] ?? null;
    }
    if (!current) current = pickCurrentEvent(events, (iso) => dateInTz(iso, tz), todayInTz(tz));
    if (!current) return { events, current: null, stats: null, recent: [] };
    const [stats, recent] = await Promise.all([loadLiveStats(db, current.id), loadRecentCheckins(db, current.id, 8)]);
    return { events, current, stats, recent };
  });

  if (!res.ok) {
    return (
      <>
        <PageHeader title="Live check-in" description="updates every few seconds" />
        <LoadProblem message={res.error} retryHref={`/events/live${wanted ? `?event=${wanted}` : ""}`} />
      </>
    );
  }
  const { events, current, stats, recent } = res.data;
  if (!current || !stats) {
    return (
      <>
        <PageHeader title="Live check-in" description="Nothing is happening today" />
        <Card>
          <EmptyState title="No published events around today">
            Publish an event in the Event builder; on the day, its check-in numbers appear here.
          </EmptyState>
        </Card>
      </>
    );
  }

  const canCheckIn = eventAreas.checkIn(access, current.id);
  const canKitchen = eventAreas.kitchen(access, current.id);
  const others = events.filter((e) => e.id !== current.id && (e.status === "live" || e.status === "published" || e.status === "rsvp_closed")).slice(0, 6);

  return (
    <>
      <PageHeader
        title="Live check-in"
        description={[current.name, current.venue, current.status === "live" ? "updates every few seconds" : `${formatEventDate(current.starts_at, tz)} · not live yet`]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {canKitchen ? (
              <Link href={`/ops/${current.id}/kitchen`} className={buttonClass("ghost")}>
                Kitchen display
              </Link>
            ) : null}
            {canCheckIn ? (
              <Link href={`/ops/${current.id}/checkin`} className={buttonClass("primary")}>
                Open check-in screen
              </Link>
            ) : null}
          </>
        }
      />
      {others.length > 0 ? (
        <nav aria-label="Other events" className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-bold uppercase tracking-[0.04em] text-muted">Event</span>
          <Link href={`/events/live?event=${current.id}`} aria-current="page" className="cc-chip">
            {current.name}
          </Link>
          {others.map((e) => (
            <Link key={e.id} href={`/events/live?event=${e.id}`} className="cc-chip">
              {e.name}
              {e.status === "live" ? " · live" : ""}
            </Link>
          ))}
        </nav>
      ) : null}
      <BlockGrid>
        <Card span={12}>
          <KpiGrid cols={4}>
            <Stat label="Checked in" value={stats.checkedIn} hint={`of ${stats.confirmed} confirmed`} tone="success" />
            <Stat label="Walk-ins" value={stats.walkIns} hint={stats.walkInParties ? `${plural(stats.walkInParties, "party", "parties")} registered at the door` : "registered at the door"} tone="navy" />
            <Stat
              label="Waitlist"
              value={stats.waitlisted}
              hint={stats.waitlisted ? `${plural(stats.waitlistedParties, "family", "families")} waiting for a seat` : "all seats offered"}
              tone="brown"
            />
            <Stat label="Median check-in" value={formatSeconds(stats.medianSeconds)} hint={stats.medianSeconds === null ? "shows after a few scans" : "per family"} tone="navy" />
          </KpiGrid>
        </Card>

        <Card
          span={7}
          padded={false}
          title="Lunch slots"
          description={
            !current.lunch_enabled
              ? "Lunch slots are off for this event"
              : stats.noSlotYet > 0
                ? `${plural(stats.noSlotYet, "person")} checked in without a slot yet (slots may be full)`
                : undefined
          }
          actions={
            <Link href={`/events/${current.id}?tab=lunch`} className={buttonClass("ghost", "sm")}>
              Run lunch
            </Link>
          }
        >
          {stats.slots.length === 0 ? (
            <EmptyState title={current.lunch_enabled ? "No slots yet — they are created at the first check-in" : "No lunch slots"} />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Seats</th>
                    <th>Assigned</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.slots.map((s) => (
                    <tr key={s.id} data-highlight={s.board === "Serving" ? "" : undefined}>
                      <td className="font-bold">{formatTime(s.starts_at, tz)}</td>
                      <td>{s.seats >= UNLIMITED_SEATS ? "Unlimited" : s.seats}</td>
                      <td>{s.assignedCount}</td>
                      <td>
                        <span className={BOARD_CLASS[s.board] ?? "font-bold"}>{s.board}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card span={5} padded={false} title="Recent check-ins">
          {recent.length === 0 ? (
            <EmptyState title="No one has checked in yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Family</th>
                    <th>Lunch</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={`${r.rsvpId}-${r.at}`}>
                      <td className="whitespace-nowrap tabular-nums">{formatClock(r.at, tz)}</td>
                      <td>
                        {r.family} · {r.count}
                      </td>
                      <td className="max-w-[12rem] truncate">
                        {r.lunchSlotStartsAt ? `${formatTime(r.lunchSlotStartsAt, tz)} · ${r.group}` : current.lunch_enabled ? `No slot yet · ${r.group}` : r.group}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </BlockGrid>
      <AutoRefresh seconds={10} timeZone={tz} className="mt-3" />
      {todayInTz(tz) !== (current.starts_at ? dateInTz(current.starts_at, tz) : "") && current.status !== "live" ? (
        <p className="mt-1 text-xs text-muted">This event is not today; the numbers show its RSVPs and any check-ins so far.</p>
      ) : null}
    </>
  );
}
