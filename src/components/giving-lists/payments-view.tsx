// Giving › Payments in the New look (docs/GIVING_REDESIGN.md section 4, slice 3): every payment, searchable by family, receipt
// number or amount, with dropdowns for the method, the source and the year on one line (docs/CRM_NAV_REDESIGN_PLAN.md, slice 2); the
// views Refunds, Grants to match and Recurring (read-only). The offering counts have their own tab (slice 5). Today's Record
// payment form sits on top when the address asks for it.

import type { ReactNode } from "react";

import { ListToolbar, type ToolbarMenu } from "@/components/list-toolbar/list-toolbar";
import type { PaymentsModel } from "@/lib/giving-lists/model";
import { menuView } from "@/lib/list-toolbar";

import { ExportButton } from "./export-button";
import { BodyState, ChipRow, ListCard, ListHeader, PagerNav, Problems } from "./list-chrome";
import { ListRows, type RowsContext } from "./list-rows";
import { ListSearch } from "./list-search";

const COLUMNS: Record<PaymentsModel["view"], [string, string, string, string]> = {
  all: ["Receipt", "Family", "Amount", "Status"],
  refunds: ["Receipt", "Family", "Amount", "Status"],
  grants: ["Bank line", "Family", "Amount", "Status"],
  recurring: ["How often", "Family", "Amount", "Status"],
};

const LIST_LABEL: Record<PaymentsModel["view"], string> = {
  all: "Payments",
  refunds: "Refund requests",
  grants: "Grants to match",
  recurring: "Recurring gifts",
};

export function PaymentsView({ model, recordSlot }: { model: PaymentsModel; recordSlot?: ReactNode }) {
  const body = model.body;
  const ctx: RowsContext = { currency: model.currency, locale: model.locale, timeZone: model.timeZone, today: model.today, labels: model.labels };
  const menus: ToolbarMenu[] = [
    { label: "Method", chips: model.methods },
    { label: "Source", chips: model.sources },
    { label: "Year", chips: model.years },
    { label: "Status", chips: model.statuses },
  ]
    .filter((m) => m.chips.length > 0)
    .map((m) => ({ label: m.label, view: menuView(m.chips) }));
  return (
    <div className="flex flex-col gap-1" data-testid="giving-payments">
      <ListHeader
        model={model}
        active="payments"
        description="Every payment across families. Find one, refund it, match a grant, and see recurring gifts."
        actions={model.exportOffer ? <ExportButton offer={model.exportOffer} labels={model.labels} /> : null}
      />
      {recordSlot ? <div className="mb-4">{recordSlot}</div> : null}
      <Problems problems={model.problems} note={model.note} />
      {body.state !== "ok" ? (
        <>
          <div className="mb-3">
            <ChipRow chips={model.views} label="Payments views" />
          </div>
          <BodyState body={body} />
        </>
      ) : (
        <ListCard>
          <ListToolbar
            search={model.searchLabel ? <ListSearch label={model.searchLabel} initial={model.q} base={model.searchBase} compact /> : null}
            switchLabel="Payments views"
            switchChips={model.views}
            menus={menus}
          />
          {model.view === "recurring" ? (
            <p className="m-0 mb-3 text-[13px] text-muted">Recurring gifts are set up in the member app. They never close a pledge unless the giver links them.</p>
          ) : null}
          {model.view === "refunds" && model.flagged.length > 0 ? (
            <div className="mb-4">
              <h2 className="m-0 mb-1 text-[15px] font-bold text-ink">Refunds made in a card provider&apos;s dashboard</h2>
              <p className="m-0 mb-2 text-[13px] text-muted">Nothing changes on the payment until two different people approve each one.</p>
              <ListRows rows={model.flagged} ctx={ctx} columns={["Receipt", "Family", "Refunded", "Status"]} label="Refunds made in a card provider's dashboard" />
              <h2 className="m-0 mb-1 mt-4 text-[15px] font-bold text-ink">Refund requests</h2>
            </div>
          ) : null}
          {body.rows.length === 0 ? (
            <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-muted">{body.empty}</p>
          ) : (
            <ListRows rows={body.rows} ctx={ctx} columns={COLUMNS[model.view]} expandSingle={model.expandSingle} label={LIST_LABEL[model.view]} />
          )}
          <PagerNav pager={model.pager} />
        </ListCard>
      )}
    </div>
  );
}
