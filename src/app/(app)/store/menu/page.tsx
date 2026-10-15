import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, EmptyState, InfoBox, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { storeRules } from "@/lib/center-rules";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatTimeRange } from "@/lib/local-time";
import { kindTerm } from "@/lib/kind";
import { kindTitle } from "@/lib/kind-title";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import { sectionSummary, sectionView } from "@/lib/store-sections";

import { saveCategoryAction } from "../actions";
import { StoreSectionBar } from "../section-bar";
import { ItemForm, MenuTable, StoreSettingsForm, WindowForm } from "./menu-forms";
import { loadCustomFieldDefs, withCustomValues } from "@/lib/data/custom-fields";

export const generateMetadata = (): Promise<Metadata> => kindTitle((k) => `Menu & pickup · ${kindTerm(k, "store", "My Store")}`, "Menu & pickup · My Store");

export default async function StoreMenuPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  // The store is "My Store" for a Jain Center; any other kind names its own.
  const storeName = kindTerm(session.kind, "store", "My Store");
  const header = <PageHeader title={storeName} description="What members see in the store, how orders are cut off and picked up" />;
  if (!canAccess(session, "store")) {
    return (
      <>
        {header}
        <NoAccess area={`The ${storeName} menu`} access="store" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const manage = canAccess(session, "storeManage");
  const [categories, items, windows, events, itemDefs] = await Promise.all([
    db.from("store_categories").select("id, name, sort_order, section").eq("center_id", center.id).order("sort_order").order("name"),
    db
      .from("store_items")
      .select("id, sku, name, category_id, description, price_cents, pack_size, taxable, track_inventory, gift_pack, low_stock_threshold, status, section, custom")
      .eq("center_id", center.id)
      .order("sku", { nullsFirst: false })
      .order("name"),
    db
      .from("pickup_windows")
      .select("id, starts_at, ends_at, order_cutoff_at, capacity, location, event_id, status, orders_count")
      .eq("center_id", center.id)
      .order("starts_at", { ascending: false })
      .limit(40),
    db.from("events").select("id, name").eq("center_id", center.id).order("starts_at", { ascending: false, nullsFirst: true }).limit(100),
    loadCustomFieldDefs(db, center.id, "store_items", true),
  ]);
  if (events.error) console.error("[store] events for pickup slots unavailable:", events.error);
  // The store is in sections (0821): Food, and a second one only once it holds something. The page draws one section at a time.
  const view = sectionView(categories.data ?? [], items.data ?? [], param(sp, "section"));
  const cats = view.categories;
  const food = view.current === "food";
  const catOrder = new Map(cats.map((c, i) => [c.id, i]));
  // Staff-only custom values are kept apart from the row (0401); read them for "More details".
  const withCustom = itemDefs.defs.length ? await withCustomValues(db, "store_items", view.items) : { rows: view.items, error: null };
  const menu = [...withCustom.rows].sort(
    (a, b) => (catOrder.get(a.category_id ?? "") ?? 999) - (catOrder.get(b.category_id ?? "") ?? 999) || a.name.localeCompare(b.name),
  );
  const openSlots = (windows.data ?? []).filter((w) => w.status === "open").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const slotsSummary = windows.error
    ? "Pickup slots could not be loaded"
    : openSlots.length === 0
      ? "No open pickup slots — add one below"
      : openSlots
          .map((w) => `${formatTimeRange(w.starts_at, w.ends_at, tz)}${w.location ? ` ${w.location}` : ""}${w.capacity ? ` (${w.capacity})` : ""}`)
          .join(" · ");
  const eventName = new Map((events.data ?? []).map((e) => [e.id, e.name]));

  return (
    <>
      {header}
      <StoreSectionBar path="/store/menu" sections={view.sections} current={view.current} />
      <BlockGrid>
        <Card span={12} title="Menu items" description={`In the ${view.label} section · ${sectionSummary(view.counts[view.current])}`} padded={false}>
          {items.error || categories.error || withCustom.error ? (
            <div className="p-2">
              <QueryError what="the menu" error={items.error ?? categories.error ?? withCustom.error} retryHref="/store/menu" />
            </div>
          ) : menu.length === 0 ? (
            <EmptyState title="No items on the menu yet" />
          ) : (
            <MenuTable items={menu} categories={cats} currency={center.currency} manage={manage} customDefs={itemDefs.defs} />
          )}
        </Card>

        {/* Ordering and pickup are how the Food section sells (the kitchen cuts orders off and members collect them). */}
        {food ? (
          <Card span={12} title="Order and pickup settings">
            <StoreSettingsForm rules={storeRules(center.rules)} slotsSummary={slotsSummary} canSave={canAccess(session, "centerSettings")} />
          </Card>
        ) : null}

        {food ? (
          <Card span={12} title="Pickup slots" description="Each slot has its own order cutoff and capacity" padded={false}>
            {windows.error ? (
              <div className="p-2">
                <QueryError what="pickup slots" error={windows.error} retryHref="/store/menu" />
              </div>
            ) : (windows.data ?? []).length === 0 ? (
              <EmptyState title="No pickup slots yet" />
            ) : (
              <ul className="divide-y divide-line-soft px-2.5">
                {(windows.data ?? []).map((w) => (
                  <li key={w.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <div>
                        <p className="font-bold">
                          {formatTimeRange(w.starts_at, w.ends_at, tz)} · {formatDate(w.starts_at, tz)}
                          {w.location ? ` · ${w.location}` : ""}
                        </p>
                        <p className="text-xs text-muted">
                          Order by {formatDateTime(w.order_cutoff_at, tz)} · {w.orders_count}
                          {w.capacity ? ` of ${w.capacity}` : ""} orders
                          {w.event_id ? ` · ${eventName.get(w.event_id) ?? "event"}` : ""}
                        </p>
                      </div>
                      <span className={w.status === "open" ? "cc-status-ok" : "font-semibold text-muted"}>{w.status[0].toUpperCase() + w.status.slice(1)}</span>
                    </div>
                    {manage ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-bold text-navy">Edit slot</summary>
                        <div className="mt-2">
                          <WindowForm w={w} events={events.data ?? []} timeZone={tz} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {manage ? (
              <div className="border-t border-line-soft px-2.5 pt-3">
                <p className="cc-section mb-2">Add a pickup slot</p>
                <WindowForm w={null} events={events.data ?? []} timeZone={tz} />
              </div>
            ) : null}
          </Card>
        ) : null}

        {manage && !view.open ? (
          <Card span={12} title={`Add to ${view.label}`}>
            <InfoBox>Adding items and categories to the {view.label} section is not available yet.</InfoBox>
          </Card>
        ) : null}

        {manage && view.open ? (
          <>
            <Card span={7} title="Add an item" description={`Goes in the ${view.label} section`}>
              <ItemForm item={null} categories={cats} section={view.current} />
            </Card>
            <Card span={5} title="Add a category" description={`Goes in the ${view.label} section`}>
              <ActionForm action={saveCategoryAction} submitLabel="Add category" pendingLabel="Adding…" resetOnSuccess>
                <input type="hidden" name="section" value={view.current} />
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="cat-name" className="crm-label">
                      Name
                    </label>
                    <input id="cat-name" name="name" required maxLength={80} placeholder="Mithai" className="crm-input" />
                  </div>
                  <div>
                    <label htmlFor="cat-order" className="crm-label">
                      Order
                    </label>
                    <input id="cat-order" name="sort_order" type="number" defaultValue={cats.length + 1} className="crm-input" />
                  </div>
                </div>
              </ActionForm>
            </Card>
          </>
        ) : null}
      </BlockGrid>
    </>
  );
}
