"use client";

import { useState, type ReactNode } from "react";

import { ActionForm } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import { Drawer } from "@/components/drawer";
import { buttonClass, InfoBox, StatusText, TableWrap } from "@/components/ui";
import { formatWeeklyCutoff, WEEKDAYS, type StoreRules } from "@/lib/center-rules";
import { utcToLocal } from "@/lib/local-time";
import { formatCents } from "@/lib/money";

import { saveItemAction, saveStoreSettingsAction, saveWindowAction } from "../actions";

export type MenuItem = {
  id: string;
  sku: string | null;
  name: string;
  category_id: string | null;
  description: string | null;
  price_cents: number;
  pack_size: string | null;
  taxable: boolean;
  track_inventory: boolean;
  gift_pack: boolean;
  low_stock_threshold: number | null;
  status: string;
};

type Category = { id: string; name: string };

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Menu items table (SKU · ITEM · CATEGORY · DESCRIPTION · PRICE · GIFT PACK · ACTIVE); a row opens the item in a drawer. */
export function MenuTable({ items, categories, currency, manage }: { items: MenuItem[]; categories: Category[]; currency: string; manage: boolean }) {
  const [open, setOpen] = useState<MenuItem | null>(null);
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <>
      <TableWrap>
        <table className="crm-table min-w-[860px]">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th>Category</th>
              <th>Description</th>
              <th className="num">Price</th>
              <th>Gift pack</th>
              <th>Active</th>
              {manage ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className={manage ? "cursor-pointer" : undefined} onClick={manage ? () => setOpen(i) : undefined}>
                <td className="font-mono text-xs">{i.sku ?? "—"}</td>
                <td className="font-bold">
                  {i.name}
                  {i.pack_size ? <span className="font-normal text-muted"> · {i.pack_size}</span> : null}
                </td>
                <td>{i.category_id ? (cat.get(i.category_id) ?? "—") : "—"}</td>
                <td className="max-w-md text-muted">{i.description ?? "—"}</td>
                <td className="num">{formatCents(i.price_cents, currency)}</td>
                <td>{i.gift_pack ? "Yes" : "No"}</td>
                <td>
                  {i.status === "active" ? (
                    <StatusText tone="ok">Yes</StatusText>
                  ) : (
                    <span className="font-semibold text-muted">{i.status === "paused" ? "Paused" : "Retired"}</span>
                  )}
                </td>
                {manage ? (
                  <td>
                    <button type="button" onClick={() => setOpen(i)} className={buttonClass("ghost", "xs")}>
                      Edit
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <Drawer open={open !== null} onClose={() => setOpen(null)} kicker={`MENU ITEM${open?.sku ? ` · ${open.sku}` : ""}`} title={open?.name ?? ""}>
        {open ? <ItemForm key={open.id} item={open} categories={categories} /> : null}
      </Drawer>
    </>
  );
}

export function ItemForm({ item, categories }: { item: MenuItem | null; categories: Category[] }) {
  const [taxable, setTaxable] = useState(item?.taxable ?? true);
  const [track, setTrack] = useState(item?.track_inventory ?? false);
  const [gift, setGift] = useState(item?.gift_pack ?? true);
  const [status, setStatus] = useState(item?.status ?? "active");
  const p = item ? `it-${item.id.slice(0, 6)}` : "it-new";
  return (
    <ActionForm action={saveItemAction.bind(null, item?.id ?? null)} submitLabel={item ? "Save item" : "Add item"} pendingLabel="Saving…" resetOnSuccess={!item}>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${p}-name`} className="crm-label">
            Name
          </label>
          <input id={`${p}-name`} name="name" required maxLength={120} defaultValue={item?.name ?? ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-sku`} className="crm-label">
            SKU
          </label>
          <input id={`${p}-sku`} name="sku" maxLength={40} defaultValue={item?.sku ?? ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-cat`} className="crm-label">
            Category
          </label>
          <select id={`${p}-cat`} name="category_id" defaultValue={item?.category_id ?? ""} className="crm-input">
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${p}-price`} className="crm-label">
            Price ($)
          </label>
          <input id={`${p}-price`} name="price" required inputMode="decimal" defaultValue={item ? dollars(item.price_cents) : ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-pack`} className="crm-label">
            Pack size
          </label>
          <input id={`${p}-pack`} name="pack_size" maxLength={40} placeholder="e.g. 250 g" defaultValue={item?.pack_size ?? ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-reorder`} className="crm-label">
            Reorder at
          </label>
          <input id={`${p}-reorder`} name="low_stock_threshold" type="number" min={0} defaultValue={item?.low_stock_threshold ?? ""} className="crm-input" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${p}-desc`} className="crm-label">
            Description
          </label>
          <input id={`${p}-desc`} name="description" maxLength={300} defaultValue={item?.description ?? ""} className="crm-input" />
        </div>
        <div className="sm:col-span-2">
          <span className="crm-label">Active</span>
          <ChipGroup
            name="status"
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Active (on the menu)" },
              { value: "paused", label: "Paused" },
              { value: "retired", label: "Retired" },
            ]}
          />
        </div>
        <div>
          <span className="crm-label">Gift pack</span>
          <Toggle name="gift_pack" label="Gift pack" checked={gift} onChange={setGift} onNote="Can be gift-packed" offNote="No gift packing" />
        </div>
        <div>
          <span className="crm-label">Sales tax</span>
          <Toggle name="taxable" label="Taxable" checked={taxable} onChange={setTaxable} onNote="Taxable" offNote="Not taxable" />
        </div>
        <div>
          <span className="crm-label">Stock</span>
          <Toggle name="track_inventory" label="Track stock" checked={track} onChange={setTrack} onNote="Track stock" offNote="Not tracked" />
        </div>
      </div>
    </ActionForm>
  );
}

/** "Order and pickup settings", backed by centers.rules.store (see lib/center-rules.ts). */
export function StoreSettingsForm({ rules, slotsSummary, canSave }: { rules: StoreRules; slotsSummary: string; canSave: boolean }) {
  const [kitchen, setKitchen] = useState(rules.kitchenSummaryAtCutoff);
  const [visible, setVisible] = useState<string>(rules.visibleTo);
  const disabled = !canSave;
  return (
    <ActionForm action={saveStoreSettingsAction} submitLabel="Save store settings" pendingLabel="Saving…" hideSubmit={!canSave}>
      <fieldset disabled={disabled} className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="ss-gift" className="crm-label">
            Gift packing price
          </label>
          <input id="ss-gift" name="gift_pack" inputMode="decimal" defaultValue={dollars(rules.giftPackCents)} className="crm-input" />
        </div>
        <div>
          <span className="crm-label">Order cutoff</span>
          <div className="flex gap-2">
            <select name="cutoff_day" aria-label="Cutoff day" defaultValue={rules.orderCutoffDay} className="crm-input">
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {d[0].toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
            <input name="cutoff_time" aria-label="Cutoff time" type="time" defaultValue={rules.orderCutoffTime} className="crm-input w-32" />
          </div>
          <p className="crm-hint">{formatWeeklyCutoff(rules.orderCutoffDay, rules.orderCutoffTime)}</p>
        </div>
        <div>
          <label htmlFor="ss-cancel" className="crm-label">
            Cancellation window
          </label>
          <input id="ss-cancel" name="cancel_hours" type="number" min={0} max={720} defaultValue={rules.cancelHoursBeforePickup} className="crm-input" />
          <p className="crm-hint">Up to {rules.cancelHoursBeforePickup} hours before pickup</p>
        </div>
        <div className="md:col-span-2">
          <span className="crm-label">Pickup slots</span>
          <InfoBox>{slotsSummary}</InfoBox>
        </div>
        <div>
          <span className="crm-label">Sales tax</span>
          <InfoBox>From the center&rsquo;s state and address</InfoBox>
        </div>
        <div>
          <span className="crm-label">Kitchen summary</span>
          <Toggle name="kitchen_summary" label="Kitchen summary" checked={kitchen} onChange={setKitchen} disabled={disabled} onNote="Send prep list at cutoff" offNote="No prep list" />
        </div>
        <div>
          <span className="crm-label">Store visible to</span>
          <ChipGroup
            name="visible_to"
            label="Store visible to"
            value={visible}
            onChange={setVisible}
            disabled={disabled}
            options={[
              { value: "everyone", label: "Everyone" },
              { value: "members", label: "Members only" },
            ]}
          />
        </div>
        <div>
          <span className="crm-label">Checkout by children</span>
          <InfoBox>Blocked · ask a parent</InfoBox>
        </div>
      </fieldset>
      {!canSave ? (
        <p className="mb-2 text-xs text-muted">Changing these needs settings.manage (center settings). Ask a center admin, or use Settings → Center.</p>
      ) : null}
    </ActionForm>
  );
}

export type PickupWindow = {
  id: string;
  starts_at: string;
  ends_at: string;
  order_cutoff_at: string;
  capacity: number | null;
  location: string | null;
  event_id: string | null;
  status: string;
};

export function WindowForm({ w, events, timeZone }: { w: PickupWindow | null; events: { id: string; name: string }[]; timeZone: string }) {
  const p = w ? `pw-${w.id.slice(0, 6)}` : "pw-new";
  const field = (key: string, label: string, input: ReactNode) => (
    <div>
      <label htmlFor={`${p}-${key}`} className="crm-label">
        {label}
      </label>
      {input}
    </div>
  );
  return (
    <ActionForm action={saveWindowAction.bind(null, w?.id ?? null)} submitLabel={w ? "Save slot" : "Add pickup slot"} pendingLabel="Saving…" resetOnSuccess={!w}>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {field("start", "Pickup starts", <input id={`${p}-start`} name="starts_at" type="datetime-local" required defaultValue={utcToLocal(w?.starts_at, timeZone)} className="crm-input" />)}
        {field("end", "Pickup ends", <input id={`${p}-end`} name="ends_at" type="datetime-local" required defaultValue={utcToLocal(w?.ends_at, timeZone)} className="crm-input" />)}
        {field(
          "cutoff",
          "Order cutoff",
          <input id={`${p}-cutoff`} name="order_cutoff_at" type="datetime-local" required defaultValue={utcToLocal(w?.order_cutoff_at, timeZone)} className="crm-input" />,
        )}
        {field("cap", "Capacity (orders)", <input id={`${p}-cap`} name="capacity" type="number" min={1} defaultValue={w?.capacity ?? ""} className="crm-input" />)}
        {field("loc", "Location", <input id={`${p}-loc`} name="location" maxLength={120} defaultValue={w?.location ?? ""} className="crm-input" />)}
        {field(
          "event",
          "Event",
          <select id={`${p}-event`} name="event_id" defaultValue={w?.event_id ?? ""} className="crm-input">
            <option value="">None</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>,
        )}
        {field(
          "status",
          "Status",
          <select id={`${p}-status`} name="status" defaultValue={w?.status ?? "open"} className="crm-input">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="fulfilled">Fulfilled</option>
          </select>,
        )}
      </div>
    </ActionForm>
  );
}
