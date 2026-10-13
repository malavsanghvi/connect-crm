// Giving › Pledges in the New look (docs/GIVING_REDESIGN.md section 4, slice 3): search by family, pledge number or amount; chips
// Open, Behind, Waiting for approval, Closed, All; the aging buckets of giving.pledges_behind; rows that act in place.

import type { PledgesModel } from "@/lib/giving-lists/model";

import { BodyState, ChipRow, ListCard, ListHeader, PagerNav, Problems } from "./list-chrome";
import { ListRows } from "./list-rows";
import { ListSearch } from "./list-search";

export function PledgesView({ model }: { model: PledgesModel }) {
  const body = model.body;
  return (
    <div className="flex flex-col gap-1" data-testid="giving-pledges">
      <ListHeader model={model} active="pledges" description="Every pledge across families. Find one, see who is behind, and act on it in its row." />
      <Problems problems={model.problems} note={model.note} />
      {body.state !== "ok" ? (
        <BodyState body={body} />
      ) : (
        <ListCard>
          <div className="mb-3 flex flex-col gap-2.5">
            <ListSearch label={model.searchLabel} initial={model.q} base={model.searchBase} />
            <ChipRow chips={model.chips} label="Pledges to show" />
            {model.buckets.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="m-0 text-[12.5px] font-bold text-muted">Behind by</p>
                <ChipRow chips={model.buckets} label="Behind by" />
              </div>
            ) : null}
            {model.summary ? <p className="m-0 text-[13px] text-muted">{model.summary}</p> : null}
          </div>
          {body.rows.length === 0 ? (
            <p className="m-0 rounded-[12px] bg-ground px-3 py-4 text-center text-[14px] text-muted">{body.empty}</p>
          ) : (
            <ListRows
              rows={body.rows}
              ctx={{ currency: model.currency, locale: model.locale, timeZone: model.timeZone, today: model.today, labels: model.labels }}
              columns={["Pledge", "Family", "Amount", "Status"]}
              expandSingle={model.expandSingle}
              label="Pledges"
            />
          )}
          <PagerNav pager={model.pager} />
        </ListCard>
      )}
    </div>
  );
}
