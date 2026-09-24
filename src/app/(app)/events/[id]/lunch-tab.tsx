import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { Alert, Card, EmptyState, TableWrap } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { allRows, load, rows } from "@/lib/data/events";
import { eventAreas, type EventAccess } from "@/lib/events/access";
import { formatDateTime, formatTime, plural } from "@/lib/events/format";
import { UNLIMITED_SEATS, lunchSlotCounts, slotBoard } from "@/lib/events/report";
import type { CrmSession } from "@/lib/session";

import { generateLunchSlots, setSlotStatus, updateSlotSeats } from "../actions";

const BOARD_CLASS: Record<string, string> = {
  Serving: "cc-status-ok",
  Done: "font-semibold text-muted",
};

export async function LunchTab({ event, session, access }: { event: Tables<"events">; session: CrmSession; access: EventAccess }) {
  const { db, center } = session;
  const tz = center.time_zone;
  if (!event.lunch_enabled) {
    return (
      <Card>
        <EmptyState title="Lunch slots are off for this event">
          Turn them on in the{" "}
          <Link className="crm-link font-semibold" href={`/events/builder?event=${event.id}`}>
            Event builder
          </Link>{" "}
          and set the lunch start time.
        </EmptyState>
      </Card>
    );
  }
  const res = await load(async () => {
    const [slots, attendees] = await Promise.all([
      db.from("lunch_slots").select("*").eq("event_id", event.id).order("starts_at"),
      allRows<{ id: string; checked_in_at: string | null; served_food_at: string | null; lunch_slot_id: string | null }>(
        (f, t) => db.from("attendees").select("id, checked_in_at, served_food_at, lunch_slot_id").eq("event_id", event.id).order("id").range(f, t),
        "attendees",
      ),
    ]);
    return { slots: rows(slots, "lunch slots"), attendees };
  });
  if (!res.ok) return <LoadProblem message={res.error} retryHref={`/events/${event.id}?tab=lunch`} />;
  const { slots, attendees } = res.data;
  const canRun = eventAreas.runLunch(access, event.id);
  const counts = slotBoard(lunchSlotCounts(slots, attendees));
  const waiting = attendees.filter((a) => a.checked_in_at && !a.lunch_slot_id).length;

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">
        Lunch starts {formatDateTime(event.lunch_starts_at, tz)} · {event.lunch_slot_minutes}-minute slots ·{" "}
        {event.lunch_seats_per_slot ? `${event.lunch_seats_per_slot} seats each` : "unlimited seats"}. Families with a child under 12 and seniors eat at the
        first slot (Settings › Rules); everyone else is placed by arrival when they check in.
      </Alert>
      {waiting > 0 ? <Alert tone="warning">{plural(waiting, "checked-in person", "checked-in people")} have no lunch slot yet (all slots may be full).</Alert> : null}
      {counts.length === 0 ? (
        <Card>
          <EmptyState title="No slots yet">Slots are created automatically at the first check-in, or you can create them now.</EmptyState>
          {canRun ? (
            <div className="mt-3 text-center">
              <ActionButton action={generateLunchSlots.bind(null, event.id)} label="Create slots now" variant="primary" size="sm" />
            </div>
          ) : null}
        </Card>
      ) : (
        <Card title="Lunch slots" padded={false}>
          <TableWrap>
            <table className="crm-table min-w-[680px]">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Seats</th>
                  <th>Assigned</th>
                  <th>Served</th>
                  <th>Status</th>
                  {canRun ? <th className="row-actions">Control</th> : null}
                </tr>
              </thead>
              <tbody>
                {counts.map((s) => (
                  <tr key={s.id} data-highlight={s.status === "now_serving" ? "" : undefined}>
                    <td className="font-bold">{formatTime(s.starts_at, tz)}</td>
                    <td>
                      {canRun ? (
                        <ActionForm action={updateSlotSeats.bind(null, event.id, s.id)} submitLabel="Set" variant="ghost" size="xs" className="flex flex-wrap items-center gap-2">
                          <input
                            name="seats"
                            type="number"
                            min={0}
                            defaultValue={s.seats >= UNLIMITED_SEATS ? "" : s.seats}
                            placeholder="∞"
                            aria-label={`Seats for ${formatTime(s.starts_at, tz)}`}
                            className="crm-input !min-h-[30px] w-20"
                          />
                        </ActionForm>
                      ) : s.seats >= UNLIMITED_SEATS ? (
                        "Unlimited"
                      ) : (
                        s.seats
                      )}
                    </td>
                    <td>
                      {s.assignedCount}
                      {s.seats < UNLIMITED_SEATS ? <span className="text-muted"> · {s.seatsLeft} left</span> : null}
                    </td>
                    <td>{s.servedCount}</td>
                    <td>
                      <span className={BOARD_CLASS[s.board] ?? "font-bold text-ink"}>{s.board}</span>
                    </td>
                    {canRun ? (
                      <td className="row-actions">
                        {s.status !== "now_serving" ? (
                          <ActionButton action={setSlotStatus.bind(null, event.id, s.id)} fields={{ status: "now_serving" }} label="Serve now" variant="ok" />
                        ) : (
                          <ActionButton action={setSlotStatus.bind(null, event.id, s.id)} fields={{ status: "done" }} label="Done" />
                        )}
                        {s.status === "done" ? (
                          <ActionButton action={setSlotStatus.bind(null, event.id, s.id)} fields={{ status: "scheduled" }} label="Reset" />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
