"use client";

// Giving › Bank in the New look (docs/GIVING_REDESIGN.md section 4, slice 4). Five views: To match, Deposits, Zelle, Card payouts
// (with the Accounting module) and History; Import a statement is a sheet; "Recently learned payer names" is under More. The rows
// of To match, Deposits and Zelle are Today's own rows (the same component and the same in-row sheets), so a bank line looks and
// acts the same in both places. A row that is done stays on the page as "Done: …" until the page is reloaded. On a phone the rows
// stack as cards to read and confirm.

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { ZelleReports } from "@/app/(app)/giving/payments/bank/zelle-reports";
import { BankResultsProvider } from "@/app/(app)/giving/payments/bank/bank-results";
import type { ActContext } from "@/components/giving-actions/row-actions";
import { BodyState, ChipRow, ListCard, Problems } from "@/components/giving-lists/list-chrome";
import { Row } from "@/components/giving-today/today-page";
import { GivingTabRow } from "@/components/giving-today/giving-tabs";
import { buttonClass } from "@/components/ui";
import type { BankModel } from "@/lib/giving-bank/views";

import { ReconcileView } from "./reconcile-view";
import { UnbankedView } from "./unbanked-view";

import { HistoryRow, ImportSheet, MoreMenu, PayoutRow } from "./bank-parts";
import { IgnoreLineAct } from "./line-acts";

const INTRO: Record<BankModel["view"], string> = {
  match: "Gift lines from the bank (bank transfers, fund grants) with the family they most likely came from.",
  reconcile:
    "A preview of the whole statement: each line tried against payments already recorded, waiting proofs and Zelle reports first, then open pledges. Nothing is written until you apply a row.",
  deposits: "Deposits of paper payments and cash: tick the recorded payments in each one. They must add up to the cent.",
  zelle: "What members reported sending, against the bank statement. Nothing is credited until you confirm it.",
  payouts:
    "Card payouts move money the platform already recorded; they are never matched to a family. The provider's side and the bank's side are shown together, with the difference. Explain and accept pairs them; a difference needs a reason.",
  unbanked: "Payments counted as paid that no bank line has banked yet. Those past the usual window for their method are flagged.",
  history: "Lines already dealt with, and money out to check.",
};

/** `exportSlot`: the view's Export button (slice 9), passed in by the page so this file stays free of the step-up pieces. */
export function BankTab({ model, importer, noAccount, exportSlot }: { model: BankModel; importer?: ReactNode; noAccount?: ReactNode; exportSlot?: ReactNode }) {
  const [done, setDone] = useState<Record<string, string>>({});
  // The guided tour (src/lib/spotlight/tours) lights the first gift line that has a clear suggestion, else the first gift line.
  const giftRows = model.view === "match" ? model.rows.filter(({ row }) => row.id.startsWith("bank:gift:")) : [];
  const tourRowId = (giftRows.find(({ row }) => row.family) ?? giftRows[0])?.row.id;
  const ctxFor = (id: string): ActContext => ({
    spotlight: id === tourRowId,
    currency: model.currency,
    locale: model.locale,
    timeZone: model.timeZone,
    labels: model.labels,
    today: model.today,
    onDone: (text) => setDone((d) => ({ ...d, [id]: text })),
  });
  const body = model.body;
  const showImport = body.state === "ok" && model.can.import && model.account && importer;

  return (
    <div data-v2-tokens className="flex flex-col gap-1 pb-24 md:pb-2" data-testid="giving-bank">
      <header className="mb-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">{model.title}</h1>
            <p className="m-0 text-[14px] text-muted">The bank statement, matched to families and to the payments recorded for them.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {body.state === "ok" ? exportSlot : null}
            {showImport ? <ImportSheet model={model}>{importer}</ImportSheet> : null}
          </div>
        </div>
        <GivingTabRow tabs={model.tabs} active="bank" />
      </header>
      <Problems problems={model.problems} note={model.note} />
      {body.state === "no_account" ? (
        <ListCard>
          <h2 className="m-0 text-[18px] font-bold text-ink">No bank accounts yet</h2>
          <p className="m-0 mt-1 text-[14px] text-muted">Add the bank account the statements come from before importing.</p>
          {body.canAdd ? <div className="mt-3">{noAccount}</div> : <p className="m-0 mt-2 text-[14px]">A treasurer with accounting.manage can add one.</p>}
        </ListCard>
      ) : body.state !== "ok" ? (
        <BodyState body={body} />
      ) : (
        <>
          {model.accounts.length > 0 ? (
            <div className="mb-2">
              <ChipRow label="Bank account" chips={model.accounts.map((a) => ({ key: a.id, label: a.label, href: a.href, count: null, on: a.on }))} />
            </div>
          ) : null}
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1" data-spotlight="bank-views">
              <ChipRow chips={model.views} label="Bank views" />
            </div>
            <MoreMenu model={model} />
          </div>
          <ListCard>
            <p className="m-0 mb-2 text-[13px] text-muted">{INTRO[model.view]}</p>
            {model.view === "history" ? (
              <div className="mb-2">
                <ChipRow chips={model.historyChips} label="History" />
              </div>
            ) : null}

            {model.view === "match" || model.view === "deposits" || model.view === "zelle"
              ? model.rows.map(({ row, line }) => (
                  <div key={row.id}>
                    <Row row={row} ctx={ctxFor(row.id)} done={done[row.id]} />
                    {line && model.can.ignore && !done[row.id] ? (
                      <div className="-mt-2 flex justify-end pb-2">
                        <IgnoreLineAct id={line.id} amount={line.amount} label="Set aside…" ctx={ctxFor(row.id)} />
                      </div>
                    ) : null}
                  </div>
                ))
              : null}
            {model.view === "reconcile" && model.reconcile ? (
              <ReconcileView accountId={model.reconcile.accountId} labels={model.labels} currency={model.currency} locale={model.locale} timeZone={model.timeZone} canConfirm={model.can.confirm} />
            ) : null}
            {model.view === "unbanked" && model.unbanked ? (
              <UnbankedView model={model.unbanked} labels={model.labels} currency={model.currency} locale={model.locale} timeZone={model.timeZone} />
            ) : null}
            {model.view === "payouts" ? model.payouts.map((p) => <PayoutRow key={p.id} row={p} canPair={model.can.pairPayouts === true} labels={model.labels} />) : null}
            {model.view === "history"
              ? model.historyRows.map((h) => <HistoryRow key={h.id} row={h} ctx={ctxFor(h.id)} done={done[h.id]} labels={model.labels} />)
              : null}

            {isEmpty(model) ? <p className="m-0 rounded-field bg-ground px-3 py-4 text-center text-[14px] text-muted">{model.empty}</p> : null}

            {model.view === "zelle" && model.zelle ? (
              <div className="mt-4 border-t border-line pt-4">
                <BankResultsProvider>
                  <ZelleReports
                    queue={model.zelle}
                    accounts={model.zelleAccounts}
                    canConfigure={model.can.configureZelle}
                    labels={model.labels}
                    timeZone={model.timeZone}
                    currency={model.currency}
                    canConfirm={model.can.confirm}
                    withExact={false}
                  />
                </BankResultsProvider>
              </div>
            ) : null}

            {model.pager ? (
              <nav aria-label="Pages" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
                <span>{model.pager.label}</span>
                <span className="flex gap-2">
                  {model.pager.prev ? (
                    <Link href={model.pager.prev} className={`${buttonClass("ghost", "sm")} min-h-[40px]`}>
                      Previous
                    </Link>
                  ) : null}
                  {model.pager.next ? (
                    <Link href={model.pager.next} className={`${buttonClass("ghost", "sm")} min-h-[40px]`}>
                      Next
                    </Link>
                  ) : null}
                </span>
              </nav>
            ) : null}
          </ListCard>
        </>
      )}
    </div>
  );
}

function isEmpty(model: BankModel): boolean {
  // Reconcile and Unbanked say their own empty state.
  if (model.view === "reconcile" || model.view === "unbanked") return false;
  if (model.view === "payouts") return model.payouts.length === 0;
  if (model.view === "history") return model.historyRows.length === 0;
  // Someone who may only look sees the reports below without the exact-match row: no "no exact matches" line for them.
  if (model.view === "zelle" && !model.can.confirm) return false;
  return model.rows.length === 0;
}
