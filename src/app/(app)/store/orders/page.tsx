import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { ClickableRow } from "@/components/clickable-row";
import { BlockGrid, buttonClass, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { chunk } from "@/lib/data/fetch-all";
import { formatDate, formatDateTime, startOfDayInTz, todayInTz } from "@/lib/dates";
import type { DbErrorLike } from "@/lib/errors";
import { formatTimeRange } from "@/lib/local-time";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import { prepList, slotStatus, topItems, windowCounts, type SlotStatus } from "@/lib/store";

import { moveOrderAction } from "../actions";

export const metadata: Metadata = { title: "Orders by pickup · Satvik Store" };

const NEXT_STEP: Record<string, { to: string; label: string; variant: "ghost" | "ok" | "primary" }[]> = {
  placed: [{ to: "preparing", label: "Start preparing", variant: "ghost" }],
  preparing: [{ to: "ready", label: "Ready for pickup", variant: "ok" }],
  ready: [{ to: "picked_up", label: "Picked up", variant: "primary" }],
};

const STATUS_TONE: Record<SlotStatus, "ok" | "warn" | "bad" | null> = {
  Open: "ok",
  Preparing: "warn",
  Ready: "ok",
  "Picked up": null,
  Closed: null,
  "No orders": null,
};

export default async function StoreOrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="Satvik Store" description="Kitchen prep lists by pickup slot" />;
  if (!canAccess(session, "storeOrders")) {
    return (
      <>
        {header}
        <NoAccess area="Store orders" access="storeOrders" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const sp = await searchParams;
  const picked = param(sp, "window");
  const canMove = canAccess(session, "storePickup");

  // This cycle: open slots plus anything picking up from today on.
  const since = startOfDayInTz(todayInTz(tz), tz);
  const windows = await db
    .from("pickup_windows")
    .select("id, starts_at, ends_at, order_cutoff_at, capacity, location, status")
    .eq("center_id", center.id)
    .or(`status.eq.open,ends_at.gte."${since}"`)
    .order("starts_at")
    .limit(30);
  const cycle = windows.data ?? [];
  const selected = picked && isUuid(picked) ? picked : null;
  const windowIds = [...new Set([...cycle.map((w) => w.id), ...(selected ? [selected] : [])])];

  let ordersError: DbErrorLike | null = null;
  const orders: { id: string; order_number: string; status: string; pickup_window_id: string | null; guest_name: string | null; total_cents: number; placed_at: string | null; gift_message: string | null }[] = [];
  const lines: { id: string; order_id: string; item_id: string; quantity: number; is_gift: boolean }[] = [];
  for (const part of chunk(windowIds)) {
    const o = await db
      .from("store_orders")
      .select("id, order_number, status, pickup_window_id, guest_name, total_cents, placed_at, gift_message")
      .eq("center_id", center.id)
      .in("pickup_window_id", part)
      .neq("status", "cart")
      .order("placed_at", { ascending: true })
      .limit(1000);
    if (o.error) {
      ordersError = o.error;
      break;
    }
    orders.push(...(o.data ?? []));
  }
  if (!ordersError) {
    for (const part of chunk(orders.map((o) => o.id))) {
      const l = await db.from("store_order_lines").select("id, order_id, item_id, quantity, is_gift").in("order_id", part);
      if (l.error) {
        ordersError = l.error;
        break;
      }
      lines.push(...(l.data ?? []));
    }
  }
  const cycleOrderIds = new Set(orders.filter((o) => o.pickup_window_id && cycle.some((w) => w.id === o.pickup_window_id)).map((o) => o.id));
  const prep = prepList(
    orders.filter((o) => cycleOrderIds.has(o.id)),
    lines,
  );
  const top = topItems(prep);
  const itemIds = [...new Set(lines.map((l) => l.item_id))];
  const names = new Map<string, string>();
  for (const part of chunk(itemIds)) {
    const it = await db.from("store_items").select("id, name").in("id", part);
    if (it.error) {
      console.error("[store] item names for orders unavailable:", it.error);
      break;
    }
    for (const i of it.data ?? []) names.set(i.id, i.name);
  }
  const itemName = (id: string) => names.get(id) ?? "Item";
  let selectedWindow = selected ? cycle.find((w) => w.id === selected) : undefined;
  if (selected && !selectedWindow) {
    const w = await db.from("pickup_windows").select("id, starts_at, ends_at, order_cutoff_at, capacity, location, status").eq("id", selected).maybeSingle();
    if (w.error) console.error("[store] selected pickup slot unavailable:", w.error);
    selectedWindow = w.data ?? undefined;
  }
  const slotOrders = selectedWindow ? orders.filter((o) => o.pickup_window_id === selectedWindow!.id) : [];

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={7} title="This cycle" description="Open a slot for its orders board" padded={false}>
          {windows.error ? (
            <div className="p-2">
              <QueryError what="pickup slots" error={windows.error} retryHref="/store/orders" />
            </div>
          ) : ordersError ? (
            <div className="p-2">
              <QueryError what="orders" error={ordersError} retryHref="/store/orders" />
            </div>
          ) : cycle.length === 0 ? (
            <EmptyState title="No pickup slots this cycle">Add slots on Menu &amp; pickup.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Pickup slot</th>
                    <th className="num">Orders</th>
                    <th className="num">Gift packs</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cycle.map((w) => {
                    const c = windowCounts(w.id, orders, lines);
                    const s = slotStatus(w, c);
                    const tone = STATUS_TONE[s];
                    return (
                      <ClickableRow key={w.id} href={`/store/orders?window=${w.id}`} highlight={w.id === selectedWindow?.id}>
                        <td className="font-bold">
                          <Link href={`/store/orders?window=${w.id}`} scroll={false} className="hover:underline">
                            {formatTimeRange(w.starts_at, w.ends_at, tz)}
                          </Link>
                          <div className="text-xs font-normal text-muted">
                            {formatDate(w.starts_at, tz)}
                            {w.location ? ` · ${w.location}` : ""}
                          </div>
                        </td>
                        <td className="num">
                          {c.orders}
                          {w.capacity ? <span className="text-muted"> / {w.capacity}</span> : null}
                        </td>
                        <td className="num">{c.giftPacks}</td>
                        <td>{tone ? <StatusText tone={tone}>{s}</StatusText> : <span className="font-bold text-muted">{s}</span>}</td>
                      </ClickableRow>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card span={5} title="Top items to prepare" description="Units on placed and preparing orders this cycle">
          {ordersError ? (
            <p className="text-[13px] text-muted">Unavailable until orders load.</p>
          ) : top.length === 0 ? (
            <EmptyState title="Nothing to prepare right now" />
          ) : (
            <div className="flex flex-col gap-2">
              {top.map((t) => (
                <div key={t.item_id} className="flex items-center gap-2.5 text-[13px]">
                  <div className="w-[150px] truncate font-semibold">{itemName(t.item_id)}</div>
                  <div className="h-3.5 flex-1 rounded-full bg-track" aria-hidden>
                    <div className="h-3.5 rounded-full bg-store" style={{ width: `${t.pct}%` }} />
                  </div>
                  <div className="w-[80px] text-right font-bold">{t.units} units</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {selectedWindow ? (
          <Card
            span={12}
            title={`Orders · ${formatTimeRange(selectedWindow.starts_at, selectedWindow.ends_at, tz)}, ${formatDate(selectedWindow.starts_at, tz)}${selectedWindow.location ? ` · ${selectedWindow.location}` : ""}`}
            description={`Order cutoff ${formatDateTime(selectedWindow.order_cutoff_at, tz)}`}
            actions={
              <Link href="/store/orders" scroll={false} className={buttonClass("ghost", "sm")}>
                Close board
              </Link>
            }
          >
            {slotOrders.length === 0 ? (
              <EmptyState title="No orders for this slot" />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {(["placed", "preparing", "ready"] as const).map((status) => {
                  const col = slotOrders.filter((o) => o.status === status);
                  return (
                    <section key={status}>
                      <h3 className="cc-section mb-2">
                        {status === "placed" ? "Placed" : status === "preparing" ? "Preparing" : "Ready"} ({col.length})
                      </h3>
                      <ul className="space-y-2.5">
                        {col.map((o) => (
                          <li key={o.id} className="rounded-xl border border-line bg-white p-3 text-[13px]">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-bold">#{o.order_number}</p>
                              <span className="font-bold">{formatCents(o.total_cents, center.currency)}</span>
                            </div>
                            <p className="text-xs text-muted">
                              {o.guest_name ?? "Member order"}
                              {o.placed_at ? ` · placed ${formatDateTime(o.placed_at, tz)}` : ""}
                            </p>
                            <ul className="mt-1.5">
                              {lines
                                .filter((l) => l.order_id === o.id)
                                .map((l) => (
                                  <li key={l.id}>
                                    {l.quantity}× {itemName(l.item_id)}
                                    {l.is_gift ? " (gift pack)" : ""}
                                  </li>
                                ))}
                            </ul>
                            {o.gift_message ? <p className="mt-1 text-xs italic">“{o.gift_message}”</p> : null}
                            {canMove ? (
                              <div className="mt-2.5 flex flex-wrap gap-2">
                                {(NEXT_STEP[o.status] ?? []).map((n) => (
                                  <ActionForm key={n.to} action={moveOrderAction.bind(null, o.id)} submitLabel={n.label} variant={n.variant} size="xs">
                                    <input type="hidden" name="to" value={n.to} />
                                  </ActionForm>
                                ))}
                                {o.status === "placed" || o.status === "preparing" ? (
                                  <ActionForm
                                    action={moveOrderAction.bind(null, o.id)}
                                    submitLabel="Cancel"
                                    variant="bad"
                                    size="xs"
                                    confirmMessage={`Cancel order #${o.order_number}?`}
                                  >
                                    <input type="hidden" name="to" value="cancelled" />
                                  </ActionForm>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
            {slotOrders.some((o) => o.status === "picked_up" || o.status === "cancelled") ? (
              <p className="mt-3 text-xs text-muted">
                Also in this slot: {slotOrders.filter((o) => o.status === "picked_up").length} picked up ·{" "}
                {slotOrders.filter((o) => o.status === "cancelled").length} cancelled.
              </p>
            ) : null}
          </Card>
        ) : null}
      </BlockGrid>
    </>
  );
}
