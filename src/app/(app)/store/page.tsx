import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { isLowStock } from "@/lib/store";

import { recordMovementAction } from "./actions";
import { QuickAdjust } from "./quick-adjust";

export const metadata: Metadata = { title: "Satvik Store" };

const REASON = { received: "received", waste: "waste", returned: "returned", adjustment: "adjustment" } as Record<string, string>;

export default async function StoreInventoryPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Satvik Store"
      description="Made to order · sales post to QuickBooks as store income with sales tax, never as donations"
    />
  );
  if (!canAccess(session, "store")) {
    return (
      <>
        {header}
        <NoAccess area="The Satvik Store" access="store" extra={canAccess(session, "storeOrders") ? <Link className="crm-link" href="/store/orders">Open Orders by pickup</Link> : null} />
      </>
    );
  }
  const { db, center } = session;
  const manage = canAccess(session, "storeManage");
  const [items, movements] = await Promise.all([
    db
      .from("store_items")
      .select("id, sku, name, price_cents, stock_on_hand, low_stock_threshold, track_inventory, status")
      .eq("center_id", center.id)
      .neq("status", "retired")
      .order("sku", { nullsFirst: false })
      .order("name"),
    db.from("inventory_movements").select("id, item_id, delta, reason, recorded_at").eq("center_id", center.id).order("recorded_at", { ascending: false }).limit(40),
  ]);
  const list = items.data ?? [];
  const name = new Map(list.map((i) => [i.id, i.name]));
  const tracked = list.filter((i) => i.track_inventory);

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={12} title="Inventory" description="Stock of ingredients packs and packaging per item" padded={false}>
          {items.error ? (
            <div className="p-2">
              <QueryError what="the store items" error={items.error} retryHref="/store" />
            </div>
          ) : list.length === 0 ? (
            <EmptyState title="No items on the menu yet">Add items on Menu &amp; pickup.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Item</th>
                    <th className="num">Price</th>
                    <th className="num">Stock</th>
                    <th className="num">Reorder at</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((i) => {
                    const low = isLowStock(i);
                    return (
                      <tr key={i.id} data-highlight={low ? "" : undefined}>
                        <td className="font-mono text-xs">{i.sku ?? "—"}</td>
                        <td className="font-bold">{i.name}</td>
                        <td className="num">{formatCents(i.price_cents, center.currency)}</td>
                        <td className="num font-bold">{i.track_inventory ? i.stock_on_hand : "—"}</td>
                        <td className="num">{i.track_inventory ? (i.low_stock_threshold ?? "—") : "—"}</td>
                        <td>
                          {!i.track_inventory ? (
                            <span className="font-semibold text-muted">Not tracked</span>
                          ) : low ? (
                            <StatusText tone="bad">Low stock</StatusText>
                          ) : (
                            <StatusText tone="ok">OK</StatusText>
                          )}
                        </td>
                        <td>{manage && i.track_inventory ? <QuickAdjust itemId={i.id} itemName={i.name} /> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {manage ? (
          <Card span={5} title="Record a stock change" description="Deliveries, waste and returns, with a reason">
            {tracked.length === 0 ? (
              <EmptyState title="No items track stock">Turn on “Track stock” for an item on Menu &amp; pickup.</EmptyState>
            ) : (
              <ActionForm action={recordMovementAction} submitLabel="Record" pendingLabel="Recording…" resetOnSuccess>
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="mv-item" className="crm-label">
                      Item
                    </label>
                    <select id="mv-item" name="item_id" required defaultValue="" className="crm-input">
                      <option value="" disabled>
                        Choose
                      </option>
                      {tracked.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.sku ? `${i.sku} · ` : ""}
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="mv-reason" className="crm-label">
                      Reason
                    </label>
                    <select id="mv-reason" name="reason" defaultValue="received" className="crm-input">
                      <option value="received">Received (add)</option>
                      <option value="waste">Waste (remove)</option>
                      <option value="returned">Returned (add)</option>
                      <option value="adjustment">Adjustment (+/−)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="mv-qty" className="crm-label">
                      Quantity
                    </label>
                    <input id="mv-qty" name="quantity" type="number" step={1} required className="crm-input" />
                  </div>
                </div>
              </ActionForm>
            )}
          </Card>
        ) : null}

        <Card span={manage ? 7 : 12} title="Recent changes" description="Every stock change, newest first" padded={false}>
          {movements.error ? (
            <div className="p-2">
              <QueryError what="stock changes" error={movements.error} retryHref="/store" />
            </div>
          ) : (movements.data ?? []).length === 0 ? (
            <EmptyState title="No stock changes yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Item</th>
                    <th className="num">Change</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(movements.data ?? []).map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(m.recorded_at, center.time_zone)}</td>
                      <td>{name.get(m.item_id) ?? "Item"}</td>
                      <td className={`num font-bold ${m.delta < 0 ? "text-danger" : "text-success"}`}>
                        {m.delta > 0 ? "+" : ""}
                        {m.delta}
                      </td>
                      <td>{REASON[m.reason] ?? m.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
