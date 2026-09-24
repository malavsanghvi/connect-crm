import { LoadProblem } from "@/components/events/load-problem";
import { BlockGrid, Card, KpiGrid, Stat, TableWrap } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { allRows, load, rows } from "@/lib/data/events";
import { formatTime, humanize } from "@/lib/events/format";
import { UNLIMITED_SEATS, eventReport, formatSeconds, lunchSlotCounts, medianCheckinSeconds } from "@/lib/events/report";
import type { CrmSession } from "@/lib/session";

export async function ReportTab({ event, session }: { event: Tables<"events">; session: CrmSession }) {
  const { db, center } = session;
  const tz = center.time_zone;
  const res = await load(async () => {
    const [rsvps, attendees, slots, scans] = await Promise.all([
      allRows<{ id: string; status: string; source: string; confirmed_at: string | null }>(
        (f, t) => db.from("rsvps").select("id, status, source, confirmed_at").eq("event_id", event.id).order("id").range(f, t),
        "RSVPs",
      ),
      allRows<Tables<"attendees">>((f, t) => db.from("attendees").select("*").eq("event_id", event.id).order("display_name").range(f, t), "attendees"),
      db.from("lunch_slots").select("id, starts_at, seats, status").eq("event_id", event.id),
      allRows<{ station: string; result: string; offline_queued: boolean; scanned_at: string; device_id: string | null }>(
        (f, t) => db.from("scan_log").select("station, result, offline_queued, scanned_at, device_id").eq("event_id", event.id).order("id").range(f, t),
        "the scan log",
      ),
    ]);
    return { rsvps, attendees, slots: rows(slots, "lunch slots"), scans };
  });
  if (!res.ok) return <LoadProblem message={res.error} retryHref={`/events/${event.id}?tab=report`} />;
  const { rsvps, attendees, slots, scans } = res.data;
  const r = eventReport(rsvps, attendees);
  const lunch = lunchSlotCounts(slots, attendees);
  const scanBy = new Map<string, number>();
  for (const s of scans) scanBy.set(`${s.station}|${s.result}`, (scanBy.get(`${s.station}|${s.result}`) ?? 0) + 1);
  const offline = scans.filter((s) => s.offline_queued).length;
  const noShowNames = attendees.filter((a) => {
    const rv = rsvps.find((x) => x.id === a.rsvp_id);
    return rv && rv.status !== "cancelled" && rv.status !== "waitlisted" && rv.source !== "walk_in" && a.status !== "cancelled" && !a.checked_in_at;
  });

  return (
    <BlockGrid>
      <Card span={12}>
        <KpiGrid cols={4}>
          <Stat label="RSVP'd" value={r.rsvpdPeople} hint={`${r.householdsTotal} households`} tone="maroon" />
          <Stat label="Confirmed" value={r.confirmedPeople} tone="navy" />
          <Stat label="Checked in" value={r.checkedIn} hint={`${r.walkIns} walk-ins (${r.walkInHouseholds} parties)`} tone="success" />
          <Stat label="Served lunch" value={r.served} hint={`${r.giftsGiven} gifts given`} tone="brown" />
        </KpiGrid>
      </Card>
      <Card span={6} title="Funnel" padded={false}>
        <TableWrap>
          <table className="crm-table">
            <tbody>
              {(
                [
                  ["RSVP'd (people, excl. walk-ins and waitlist)", r.rsvpdPeople],
                  ["Confirmed", r.confirmedPeople],
                  ["Waitlisted", r.waitlistedPeople],
                  ["Checked in (incl. walk-ins)", r.checkedIn],
                  ["Walk-ins", r.walkIns],
                  ["No-shows (RSVP'd, not checked in)", r.noShows],
                  ["Served food", r.served],
                  ["Median check-in per family", formatSeconds(medianCheckinSeconds(scans))],
                  ["Children under 12 · seniors · assistance", `${r.flags.childUnder12} · ${r.flags.senior} · ${r.flags.assistance}`],
                ] as [string, string | number][]
              ).map(([k, val]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num font-bold">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      <Card span={6} title="Scans by station" description={offline ? `${offline} were recorded offline and synced later.` : undefined} padded={false}>
        {scans.length === 0 ? (
          <p className="px-2.5 pb-2 text-[13px] text-muted">No scans yet.</p>
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Result</th>
                  <th className="num">Count</th>
                </tr>
              </thead>
              <tbody>
                {[...scanBy.entries()].sort().map(([k, n]) => {
                  const [station, result] = k.split("|");
                  return (
                    <tr key={k}>
                      <td>{humanize(station)}</td>
                      <td>{humanize(result)}</td>
                      <td className="num">{n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {lunch.length > 0 ? (
        <Card span={6} title="Lunch by slot" padded={false}>
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th className="num">Seats</th>
                  <th className="num">Assigned</th>
                  <th className="num">Served</th>
                </tr>
              </thead>
              <tbody>
                {lunch.map((s) => (
                  <tr key={s.id}>
                    <td className="font-bold">{formatTime(s.starts_at, tz)}</td>
                    <td className="num">{s.seats >= UNLIMITED_SEATS ? "∞" : s.seats}</td>
                    <td className="num">{s.assignedCount}</td>
                    <td className="num">{s.servedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}
      {noShowNames.length > 0 ? (
        <Card span={lunch.length > 0 ? 6 : 12} title={`Not checked in (${noShowNames.length})`}>
          <details>
            <summary className="cursor-pointer text-[13px] font-bold text-navy">Show names</summary>
            <ul className="mt-2 columns-1 gap-6 text-[13px] sm:columns-2">
              {noShowNames.map((a) => (
                <li key={a.id}>{a.display_name}</li>
              ))}
            </ul>
          </details>
        </Card>
      ) : null}
    </BlockGrid>
  );
}
