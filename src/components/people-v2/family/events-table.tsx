import Link from "next/link";

import { Badge, Card, EmptyState, TableWrap } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { eventsSummary, type EventLine } from "@/lib/people-v2/family-events";

// The Events tab of the Family page: which events this household answered, what they said, and whether anyone came. Read only; the
// RSVP itself is changed on the event. It only draws lines the page (or the dev preview) built; no hooks, so it renders on the server.

export function EventsTable({ lines, timeZone, olderLeftOut = false }: { lines: EventLine[]; timeZone: string; /** True when older RSVPs were not loaded. */ olderLeftOut?: boolean }) {
  const summary = eventsSummary(lines);
  return (
    <Card title="Events" description={summary.text || undefined} padded={false}>
      {lines.length === 0 ? (
        <EmptyState title="No RSVPs from this household" />
      ) : (
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Answer</th>
                <th className="num">Seats</th>
                <th className="num">Checked in</th>
                <th>How</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.rsvpId}>
                  <td>
                    {l.eventVisible ? (
                      <Link href={`/events/${l.eventId}`} className="crm-link">
                        {l.eventName}
                      </Link>
                    ) : (
                      <span className="text-muted">{l.eventName}</span>
                    )}
                  </td>
                  <td>{l.startsAt ? formatDate(l.startsAt, timeZone) : "—"}</td>
                  <td>
                    <Badge tone={l.tone}>{l.answer}</Badge>
                  </td>
                  <td className="num">{l.party > 0 ? l.party : "—"}</td>
                  <td className="num">{l.party > 0 ? `${l.checkedIn} of ${l.party}` : "—"}</td>
                  <td className="text-[0.8125rem]">{l.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {olderLeftOut ? <p className="m-0 px-3 pb-2 pt-1 text-[13px] text-muted">Showing the latest RSVPs only; older ones are on each event.</p> : null}
    </Card>
  );
}
