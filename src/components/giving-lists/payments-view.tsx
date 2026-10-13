// Giving › Payments in the New look (docs/GIVING_REDESIGN.md section 4, slice 3): every payment, searchable by family, receipt
// number or amount, with chips for the method and the source; the views Refunds, Grants to match, Recurring (read-only) and,
// until slice 5 gives them a tab, the offering counts. Today's Record payment form sits on top when the address asks for it.

import type { ReactNode } from "react";

import type { PaymentsModel } from "@/lib/giving-lists/model";

import { BodyState, ChipRow, ListCard, ListHeader, PagerNav, Problems } from "./list-chrome";
import { ListRows, type RowsContext } from "./list-rows";
import { ListSearch } from "./list-search";

const COLUMNS: Record<PaymentsModel["view"], [string, string, string, string]> = {
  all: ["Receipt", "Family", "Amount", "Status"],
  refunds: ["Receipt", "Family", "Amount", "Status"],
  grants: ["Bank line", "Family", "Amount", "Status"],
  recurring: ["How often", "Family", "Amount", "Status"],
  counts: ["Count", "Who counted", "Total", "Status"],
};

const LIST_LABEL: Record<PaymentsModel["view"], string> = {
  all: "Payments",
  refunds: "Refund requests",
  grants: "Grants to match",
  recurring: "Recurring gifts",
  counts: "Counts",
};

export function PaymentsView({ model, recordSlot, countSlot }: { model: PaymentsModel; recordSlot?: ReactNode; countSlot?: ReactNode }) {
  const body = model.body;
  const ctx: RowsContext = { currency: model.currency, locale: model.locale, timeZone: model.timeZone, today: model.today, labels: model.labels };
  return (
    <div className="flex flex-col gap-1" data-testid="giving-payments">
      <ListHeader model={model} active="payments" description="Every payment across families. Find one, refund it, match a grant, and see recurring gifts." />
      {recordSlot ? <div className="mb-4">{recordSlot}</div> : null}
      <Problems problems={model.problems} note={model.note} />
      <div className="mb-3">
        <ChipRow chips={model.views} label="Payments views" />
      </div>
      {body.state !== "ok" ? (
        <BodyState body={body} />
      ) : (
        <ListCard>
          <div className="mb-3 flex flex-col gap-2.5">
            {model.searchLabel ? <ListSearch label={model.searchLabel} initial={model.q} base={model.searchBase} /> : null}
            <ChipRow chips={model.methods} label="Method" />
            <ChipRow chips={model.sources} label="Source" />
            <ChipRow chips={model.statuses} label="Recurring gifts to show" />
            {model.view === "recurring" ? (
              <p className="m-0 text-[13px] text-muted">Recurring gifts are set up in the member app. They never close a pledge unless the giver links them.</p>
            ) : null}
          </div>
          {model.view === "refunds" && model.flagged.length > 0 ? (
            <div className="mb-4">
              <h2 className="m-0 mb-1 text-[15px] font-bold text-ink">Refunds made in a card provider&apos;s dashboard</h2>
              <p className="m-0 mb-2 text-[13px] text-muted">Nothing changes on the payment until two different people approve each one.</p>
              <ListRows rows={model.flagged} ctx={ctx} columns={["Receipt", "Family", "Refunded", "Status"]} label="Refunds made in a card provider's dashboard" />
              <h2 className="m-0 mb-1 mt-4 text-[15px] font-bold text-ink">Refund requests</h2>
            </div>
          ) : null}
          {body.rows.length === 0 ? (
            <p className="m-0 rounded-[12px] bg-ground px-3 py-4 text-center text-[14px] text-muted">{body.empty}</p>
          ) : (
            <ListRows rows={body.rows} ctx={ctx} columns={COLUMNS[model.view]} expandSingle={model.expandSingle} label={LIST_LABEL[model.view]} />
          )}
          <PagerNav pager={model.pager} />
          {model.view === "counts" && countSlot ? <div className="mt-4 border-t border-line pt-4">{countSlot}</div> : null}
        </ListCard>
      )}
    </div>
  );
}
