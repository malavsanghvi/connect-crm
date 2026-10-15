import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, EmptyState, InfoBox, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { storeRules } from "@/lib/center-rules";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatTimeRange } from "@/lib/local-time";
import { kindTerm } from "@/lib/kind";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { MARKET_STARTER_CATEGORIES, marketModuleOn, sectionSummary, sectionView, STORE_SECTION_LABELS } from "@/lib/store-sections";
import { loadCustomFieldDefs, withCustomValues } from "@/lib/data/custom-fields";

import { removeMarketCategoryAction, saveCategoryAction, saveMarketCategoryAction, startMarketAction } from "../actions";
import { sectionHrefs, StoreSectionBar } from "../section-bar";
import { ItemForm, MenuTable, StoreSettingsForm, WindowForm } from "./menu-forms";

/**
 * Store › Menu & pickup (/store/menu) and Store › Community Market (/store/market): the store one section at a time (docs/STORE_SECTIONS.md).
 * Food is the menu with its ordering and pickup cards. The Community Market (0830) is the community's own listings and their categories,
 * and it can be started from here: it appears as a tab on Menu & pickup only once it holds something, and its own page (/store/market,
 * in the Store's tabs while Weaver has granted it) always opens, so the first category can be added.
 */
export async function StoreMenuView({ requested, path, marketPage }: { requested: string | undefined; path: "/store/menu" | "/store/market"; marketPage: boolean }) {
  const session = await getSession();
  // The store is "My Store" for a Jain Center; any other kind names its own.
  const storeName = kindTerm(session.kind, "store", "My Store");
  const header = (
    <PageHeader
      title={storeName}
      description={marketPage ? "Your own products and services in the Community Market, and the categories they are grouped in" : "What members see in the store, how orders are cut off and picked up"}
    />
  );
  const food = canAccess(session, "store");
  const marketOn = marketModuleOn(session) && canAccess(session, "marketView");
  if (marketPage ? !marketOn : !food) {
    return (
      <>
        {header}
        <NoAccess area={marketPage ? `The ${STORE_SECTION_LABELS.market}` : `The ${storeName} menu`} access={marketPage ? "marketView" : "store"} />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
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
  // The store is in sections (0821, 0830): Food, and the Community Market while it is on and holds something. The page draws one at a time.
  const view = sectionView(categories.data ?? [], items.data ?? [], marketPage ? "market" : requested, {
    marketOn,
    foodAllowed: food,
    openEmptyMarket: marketPage,
  });
  const cats = view.categories;
  const isFood = view.current === "food";
  // Who may change this section's rows: the store's manager in Food; the store's manager or market.manage in the Community Market.
  const manage = canAccess(session, isFood ? "storeManage" : "marketManage");
  const noun = isFood ? "item" : "listing";
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
  const itemsPerCategory = new Map<string, number>();
  for (const i of view.items) if (i.category_id) itemsPerCategory.set(i.category_id, (itemsPerCategory.get(i.category_id) ?? 0) + 1);

  return (
    <>
      {header}
      <StoreSectionBar hrefs={sectionHrefs(path)} sections={view.sections} current={view.current} />
      <BlockGrid>
        {/* The market is on and holds nothing yet: offer to start it (to a person who may). */}
        {!isFood && view.marketEmpty && manage ? (
          <Card span={12} title="Start the Community Market" description="A second section of your store, beside Food">
            <p className="mb-3 text-[13px] text-muted">
              Add the starter categories ({MARKET_STARTER_CATEGORIES.join(", ")}), then list your own products and services. You can rename or
              remove any category, and add your own. Members see the Community Market in the store once there is something in it.
            </p>
            <ActionForm action={startMarketAction} submitLabel="Add the starter categories" pendingLabel="Adding…" />
          </Card>
        ) : null}

        <Card
          span={12}
          title={isFood ? "Menu items" : "Listings"}
          description={`In the ${view.label} section · ${sectionSummary(view.counts[view.current])}`}
          padded={false}
        >
          {items.error || categories.error || withCustom.error ? (
            <div className="p-2">
              <QueryError what={isFood ? "the menu" : "the listings"} error={items.error ?? categories.error ?? withCustom.error} retryHref={path} />
            </div>
          ) : menu.length === 0 ? (
            <EmptyState title={isFood ? "No items on the menu yet" : "No listings yet"} />
          ) : (
            <MenuTable items={menu} categories={cats} currency={center.currency} manage={manage} customDefs={itemDefs.defs} noun={noun} />
          )}
        </Card>

        {/* The Community Market's categories: how its listings are grouped in the app. */}
        {!isFood ? (
          <Card span={12} title="Categories" description="How listings are grouped for members" padded={false}>
            {categories.error ? (
              <div className="p-2">
                <QueryError what="the categories" error={categories.error} retryHref={path} />
              </div>
            ) : cats.length === 0 ? (
              <EmptyState title="No categories yet" />
            ) : (
              <ul className="divide-y divide-line-soft px-2.5">
                {cats.map((c) => (
                  <li key={c.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <p className="font-bold">{c.name}</p>
                      <span className="text-xs text-muted">
                        {itemsPerCategory.get(c.id) ?? 0} {(itemsPerCategory.get(c.id) ?? 0) === 1 ? "listing" : "listings"}
                      </span>
                    </div>
                    {manage ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-bold text-navy">Rename, re-order or remove</summary>
                        <div className="mt-2">
                          <ActionForm action={saveMarketCategoryAction.bind(null, c.id)} submitLabel="Save category" pendingLabel="Saving…">
                            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div>
                                <label htmlFor={`mc-name-${c.id.slice(0, 6)}`} className="crm-label">
                                  Name
                                </label>
                                <input id={`mc-name-${c.id.slice(0, 6)}`} name="name" required maxLength={80} defaultValue={c.name} className="crm-input" />
                              </div>
                              <div>
                                <label htmlFor={`mc-order-${c.id.slice(0, 6)}`} className="crm-label">
                                  Order
                                </label>
                                <input id={`mc-order-${c.id.slice(0, 6)}`} name="sort_order" type="number" defaultValue={c.sort_order} className="crm-input" />
                              </div>
                            </div>
                          </ActionForm>
                          <div className="mt-3 border-t border-line-soft pt-3">
                            <p className="mb-2 text-xs text-muted">Removing a category keeps its listings: they stay in the Community Market without a category.</p>
                            <ActionForm
                              action={removeMarketCategoryAction.bind(null, c.id)}
                              submitLabel="Remove category"
                              pendingLabel="Removing…"
                              variant="secondary"
                              size="sm"
                              confirmMessage={`Remove the category "${c.name}"? Its listings are kept, without a category.`}
                            />
                          </div>
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {/* Ordering and pickup are how the Food section sells (the kitchen cuts orders off and members collect them). */}
        {isFood ? (
          <Card span={12} title="Order and pickup settings">
            <StoreSettingsForm rules={storeRules(center.rules)} slotsSummary={slotsSummary} canSave={canAccess(session, "centerSettings")} />
          </Card>
        ) : null}

        {isFood ? (
          <Card span={12} title="Pickup slots" description="Each slot has its own order cutoff and capacity" padded={false}>
            {windows.error ? (
              <div className="p-2">
                <QueryError what="pickup slots" error={windows.error} retryHref={path} />
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
            <InfoBox>The {view.label} is not on for your community, so nothing can be added to it.</InfoBox>
          </Card>
        ) : null}

        {manage && view.open ? (
          <>
            <Card span={7} title={isFood ? "Add an item" : "Add a listing"} description={`Goes in the ${view.label} section`}>
              <ItemForm item={null} categories={cats} section={view.current} noun={noun} />
            </Card>
            <Card span={5} title="Add a category" description={`Goes in the ${view.label} section`}>
              <ActionForm action={saveCategoryAction} submitLabel="Add category" pendingLabel="Adding…" resetOnSuccess>
                <input type="hidden" name="section" value={view.current} />
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="cat-name" className="crm-label">
                      Name
                    </label>
                    <input id="cat-name" name="name" required maxLength={80} placeholder={isFood ? "Mithai" : "Gifts"} className="crm-input" />
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
