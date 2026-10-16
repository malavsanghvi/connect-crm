// Giving › Pledges in the New look (docs/GIVING_REDESIGN.md section 4, slice 3): search by family, pledge number or amount; one line
// of controls (docs/CRM_NAV_REDESIGN_PLAN.md, slice 2): the switch Open, Behind, Waiting for approval, Soft credit, Closed, All and
// the Behind-by buckets of giving.pledges_behind as a dropdown; rows that act in place.

import { ListToolbar } from "@/components/list-toolbar/list-toolbar";
import type { PledgesModel } from "@/lib/giving-lists/model";
import { menuView } from "@/lib/list-toolbar";

import { ExportButton } from "./export-button";
import { BodyState, ListCard, ListHeader, PagerNav, Problems } from "./list-chrome";
import { ListRows } from "./list-rows";
import { ListSearch } from "./list-search";

export function PledgesView({ model }: { model: PledgesModel }) {
  const body = model.body;
  // No bucket and no status is "all": choosing a bucket again from the dropdown's first option goes back there.
  const all = model.chips.find((c) => c.key === "all");
  return (
    <div className="flex flex-col gap-1" data-testid="giving-pledges">
      <ListHeader
        model={model}
        active="pledges"
        description="Every pledge across families. Find one, see who is behind, and act on it in its row."
        actions={model.exportOffer ? <ExportButton offer={model.exportOffer} labels={model.labels} /> : null}
      />
      <Problems problems={model.problems} note={model.note} />
      {body.state !== "ok" ? (
        <BodyState body={body} />
      ) : (
        <ListCard>
          <ListToolbar
            search={<ListSearch label={model.searchLabel} initial={model.q} base={model.searchBase} compact />}
            switchLabel="Pledges to show"
            switchChips={model.chips}
            menus={model.buckets.length > 0 ? [{ label: "Behind by", view: menuView(model.buckets, all ? { label: "Any", href: all.href } : undefined) }] : []}
            summary={model.summary}
          />
          {body.rows.length === 0 ? (
            <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-muted">{body.empty}</p>
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
