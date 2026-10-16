// Giving › the counts tab in the New look (docs/GIVING_REDESIGN.md slice 5, B93), named with the kind's word (Bhandar counts,
// Collection counts, Offering counts, Cash counts). Every count with its counters, total and deposit; Start a count on top; each
// row acts in place: Match its deposit (Bank reconciliation on), Mark deposited (the slip reference), and a treasurer's undo.
// A table on a computer, cards on a phone. No hooks: drawn on the server, with the rows and the sheets as client parts.

import { StartCountButton } from "@/components/giving-actions/count-acts";
import { BodyState, ListCard, PagerNav, Problems } from "@/components/giving-lists/list-chrome";
import { SwitchLinks } from "@/components/list-toolbar/list-toolbar";
import { ListRows, type RowsContext } from "@/components/giving-lists/list-rows";
import { GivingTabRow } from "@/components/giving-today/giving-tabs";
import { buttonClass } from "@/components/ui";
import type { CountsModel } from "@/lib/giving-counts/model";

export function CountsView({ model }: { model: CountsModel }) {
  const body = model.body;
  const ctx: RowsContext = { currency: model.currency, locale: model.locale, timeZone: model.timeZone, today: model.today, labels: model.labels };
  const canStart = model.can.record && body.state === "ok";
  return (
    <div className="flex flex-col gap-1 pb-24 md:pb-2" data-testid="giving-counts">
      <header className="mb-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">{model.countsWord}</h1>
            <p className="m-0 text-[14px] text-muted">
              Two adults from different households count, seal the bags and match the count to its bank deposit
              {model.bankOn ? " by picking the line." : " with the slip number."}
            </p>
          </div>
          {canStart ? (
            <div className="hidden md:block">
              <StartCountButton labels={model.labels} />
            </div>
          ) : null}
        </div>
        <GivingTabRow tabs={model.tabs} active="counts" />
      </header>
      <Problems problems={model.problems} note={model.note} />
      {body.state !== "ok" ? (
        <BodyState body={body} />
      ) : (
        <>
          {model.summary ? <p className="m-0 mb-2 text-[15px] font-bold text-ink">{model.summary}</p> : null}
          <div className="mb-3">
            <SwitchLinks chips={model.chips} label="Counts to show" />
          </div>
          <ListCard>
            {body.rows.length === 0 ? (
              <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-muted">{body.empty}</p>
            ) : (
              <ListRows rows={body.rows} ctx={ctx} columns={["Count", "Who counted", "Total", "Deposit"]} label={model.countsWord} />
            )}
            <PagerNav pager={model.pager} />
          </ListCard>
        </>
      )}
      {canStart ? (
        // At the door the phone is what counts: Start a count stays in reach above the bottom bar.
        <div className="fixed inset-x-0 bottom-[calc(67px+env(safe-area-inset-bottom))] z-20 flex border-t border-line bg-white px-4 py-2 md:hidden">
          <StartCountButton labels={model.labels} full className={`${buttonClass("primary")} min-h-[44px] w-full justify-center`} />
        </div>
      ) : null}
    </div>
  );
}
