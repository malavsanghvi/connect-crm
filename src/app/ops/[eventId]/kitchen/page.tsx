import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/events/action-button";
import { AutoRefresh } from "@/components/events/auto-refresh";
import { LoadProblem } from "@/components/events/load-problem";
import { NoAccess } from "@/components/ui";
import { allRows, load, loadEventAccess, row, rows } from "@/lib/data/events";
import { addDays, startOfDayInTz, todayInTz } from "@/lib/dates";
import { eventAreas } from "@/lib/events/access";
import { formatTime } from "@/lib/events/format";
import { UNLIMITED_SEATS, lunchSlotCounts, slotBoard } from "@/lib/events/report";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { setSlotStatus } from "@/app/(app)/events/actions";

export const metadata: Metadata = { title: "Kitchen display" };

export default async function KitchenPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) notFound();
  const session = await getSession();
  const access = await loadEventAccess(session);
  if (!eventAreas.kitchen(access, eventId)) {
    return <NoAccess area="The kitchen display" access="events" extra="The kitchen display is for the kitchen lead and the event lead of this event." />;
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const canRun = eventAreas.runLunch(access, eventId);

  const res = await load(async () => {
    const event = row(await db.from("events").select("id, name, starts_at, lunch_enabled").eq("id", eventId).maybeSingle(), "the event");
    if (!event) return null;
    const dayStart = startOfDayInTz(today, tz);
    const dayEnd = startOfDayInTz(addDays(today, 1), tz);
    const [slots, attendees, windows] = await Promise.all([
      db.from("lunch_slots").select("id, starts_at, seats, status").eq("event_id", eventId).order("starts_at"),
      allRows<{ id: string; checked_in_at: string | null; served_food_at: string | null; lunch_slot_id: string | null }>(
        (f, t) => db.from("attendees").select("id, checked_in_at, served_food_at, lunch_slot_id").eq("event_id", eventId).order("id").range(f, t),
        "attendees",
      ),
      db
        .from("pickup_windows")
        .select("id, starts_at, ends_at, location, event_id")
        // Timestamps are quoted: PostgREST treats "." and ":" as reserved inside or().
        .or(`event_id.eq.${eventId},and(starts_at.gte."${dayStart}",starts_at.lt."${dayEnd}")`)
        .order("starts_at"),
    ]);
    // Store orders need store or kitchen permission; the display still works without them, and says so.
    let storeNote: string | null = null;
    let orders: { id: string; order_number: string; status: string; pickup_window_id: string | null }[] = [];
    let lines: { order_id: string; item_id: string; quantity: number }[] = [];
    let items: { id: string; name: string }[] = [];
    const w = windows.error ? [] : (windows.data ?? []);
    if (windows.error) {
      console.error("[kitchen] pickup windows unavailable:", windows.error);
      storeNote = "Store pickup windows couldn't be loaded for your role.";
    } else if (w.length) {
      const o = await db
        .from("store_orders")
        .select("id, order_number, status, pickup_window_id")
        .in(
          "pickup_window_id",
          w.map((x) => x.id),
        )
        .in("status", ["placed", "preparing", "ready"]);
      if (o.error) {
        console.error("[kitchen] store orders unavailable:", o.error);
        storeNote = "Store orders need kitchen or store access.";
      } else {
        orders = o.data ?? [];
        if (orders.length) {
          const l = await db.from("store_order_lines").select("order_id, item_id, quantity").in(
            "order_id",
            orders.map((x) => x.id),
          );
          if (l.error) {
            console.error("[kitchen] order lines unavailable:", l.error);
            storeNote = "Order items couldn't be loaded.";
          } else lines = l.data ?? [];
          const ids = [...new Set(lines.map((x) => x.item_id))];
          if (ids.length) {
            const it = await db.from("store_items").select("id, name").in("id", ids);
            if (it.error) {
              console.error("[kitchen] item names unavailable:", it.error);
              storeNote = "Item names couldn't be loaded.";
            }
            items = it.data ?? [];
          }
        }
      }
    }
    return { event, slots: rows(slots, "lunch slots"), attendees, windows: w, orders, lines, items, storeNote };
  });
  if (!res.ok) return <LoadProblem message={res.error} retryHref={`/ops/${eventId}/kitchen`} />;
  if (!res.data) notFound();
  const { slots, attendees, windows, orders, lines, items, storeNote } = res.data;
  const counts = slotBoard(lunchSlotCounts(slots, attendees));
  const serving = counts.find((s) => s.board === "Serving");
  const next = counts.find((s) => s.board === "Next");
  const checkedIn = attendees.filter((a) => a.checked_in_at).length;
  const noSlot = attendees.filter((a) => a.checked_in_at && !a.lunch_slot_id).length;
  const served = attendees.filter((a) => a.served_food_at).length;
  const prep = new Map<string, number>();
  for (const l of lines) {
    const o = orders.find((x) => x.id === l.order_id);
    if (o && o.status !== "ready") prep.set(l.item_id, (prep.get(l.item_id) ?? 0) + l.quantity);
  }

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh seconds={20} timeZone={tz} />
      <section className="rounded-2xl bg-success p-6 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-widest">Now serving</p>
        <p className="font-display text-6xl font-semibold">{serving ? formatTime(serving.starts_at, tz) : "—"}</p>
        {serving ? (
          <p className="mt-1 text-lg">
            {serving.assignedCount} assigned · {serving.servedCount} served
          </p>
        ) : null}
        {next ? (
          <p className="mt-2 text-base opacity-90">
            Next: {formatTime(next.starts_at, tz)} · {next.assignedCount} people
          </p>
        ) : null}
      </section>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          [checkedIn, "checked in"],
          [served, "served"],
          [noSlot, "no slot yet"],
        ].map(([n, l]) => (
          <div key={String(l)} className="rounded-xl bg-white p-3">
            <p className="font-display text-3xl font-semibold">{n}</p>
            <p className="text-xs text-muted">{l}</p>
          </div>
        ))}
      </div>
      <section className="rounded-xl bg-white p-4">
        <h2 className="mb-2 font-display text-xl font-semibold">Headcount by slot</h2>
        {counts.length === 0 ? (
          <p className="text-sm text-muted">No lunch slots yet — they appear with the first check-in.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {counts.map((s) => (
              <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 py-3 ${s.board === "Serving" ? "bg-success-50 px-2" : ""}`}>
                <span className="text-2xl font-semibold">{formatTime(s.starts_at, tz)}</span>
                <span className="text-lg">
                  <strong>{s.assignedCount}</strong>
                  {s.seats < UNLIMITED_SEATS ? ` / ${s.seats}` : ""} · {s.servedCount} served
                  <span className="ml-2 text-sm text-muted">{s.board}</span>
                </span>
                {canRun && s.status !== "now_serving" && s.status !== "done" ? (
                  <ActionButton action={setSlotStatus.bind(null, eventId, s.id)} fields={{ status: "now_serving" }} label="Start serving" variant="ok" size="md" />
                ) : null}
                {canRun && s.status === "now_serving" ? (
                  <ActionButton action={setSlotStatus.bind(null, eventId, s.id)} fields={{ status: "done" }} label="Done" size="md" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl bg-white p-4">
        <h2 className="mb-2 font-display text-xl font-semibold">Store orders due</h2>
        {storeNote ? <p className="mb-2 rounded-lg bg-saffron-50 p-2 text-sm text-brown">{storeNote}</p> : null}
        {windows.length === 0 ? (
          <p className="text-sm text-muted">No pickup windows for this event or today.</p>
        ) : (
          <>
            {prep.size > 0 ? (
              <>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">To prepare</h3>
                <ul className="mb-3 grid grid-cols-2 gap-2">
                  {[...prep.entries()].map(([itemId, qty]) => (
                    <li key={itemId} className="rounded-lg bg-ground p-2 text-lg">
                      <strong>{qty}×</strong> {items.find((i) => i.id === itemId)?.name ?? "Item"}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <ul className="divide-y divide-line-soft">
              {windows.map((w) => {
                const os = orders.filter((o) => o.pickup_window_id === w.id);
                return (
                  <li key={w.id} className="py-2">
                    <p className="font-semibold">
                      {formatTime(w.starts_at, tz)}–{formatTime(w.ends_at, tz)}
                      {w.location ? ` · ${w.location}` : ""}
                    </p>
                    <p className="text-sm text-muted">
                      {os.length} orders · {os.filter((o) => o.status === "placed").length} placed · {os.filter((o) => o.status === "preparing").length} preparing ·{" "}
                      {os.filter((o) => o.status === "ready").length} ready
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
