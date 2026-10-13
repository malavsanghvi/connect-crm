"use client";

// The Bank tab's own pieces (docs/GIVING_REDESIGN.md slice 4): the import sheet, the More menu with the recently learned payer
// names, a card payout row (the provider's side and the bank's side together, with the difference) and a History row.

import { useState, type ReactNode } from "react";

import type { ActContext } from "@/components/giving-actions/row-actions";
import { GivingSheet } from "@/components/giving-actions/sheet";
import { buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import type { BankModel, HistoryRowView, PayoutRowView } from "@/lib/giving-bank/views";
import { familyLine } from "@/lib/giving-today/queue";

import { IgnoreLineAct, RestoreLineAct } from "./line-acts";

/** Import a statement, in a sheet. The import itself is today's importer, with its own button; the sheet only closes. */
export function ImportSheet({ model, children }: { model: BankModel; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${buttonClass("primary", "sm")} min-h-[44px]`} onClick={() => setOpen(true)}>
        Import a statement
      </button>
      {open ? (
        <GivingSheet
          title={`Import a statement${model.account ? ` into ${model.account.name}` : ""}`}
          labels={model.labels}
          what={
            <>
              <span className="block">Download the account activity from the bank as a CSV file and choose it here. Lines already imported are skipped.</span>
              <span className="mt-1 block font-bold md:hidden">Import works best on a computer.</span>
            </>
          }
          pending={false}
          onClose={() => setOpen(false)}
        >
          {children}
        </GivingSheet>
      ) : null}
    </>
  );
}

/** More: what a treasurer looks at now and then. Today it holds the payer names that confirmed matches taught the system. */
export function MoreMenu({ model }: { model: BankModel }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="relative">
      <summary className={`${buttonClass("ghost", "sm")} min-h-[40px] cursor-pointer list-none`}>More</summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-[12px] border border-line bg-white p-1 shadow-lg">
        <button
          type="button"
          className="flex min-h-[44px] w-full items-center rounded-[10px] px-3 py-2 text-left text-[14px] font-semibold text-ink hover:bg-canvas"
          onClick={() => setOpen(true)}
        >
          Recently learned payer names
        </button>
      </div>
      {open ? (
        <GivingSheet
          title="Recently learned payer names"
          labels={model.labels}
          what="Names that confirmed matches taught the system. They are hints only: two families can share a name, so a match is always confirmed with the family's card."
          pending={false}
          onClose={() => setOpen(false)}
        >
          {model.learned.state === "error" ? (
            <p role="alert" className="m-0 rounded-[12px] border border-[#f0b9b4] bg-danger-50 px-3 py-2 text-[13px] text-[#7a1a14]">
              {model.learned.error}
            </p>
          ) : model.learned.rows.length === 0 ? (
            <p className="m-0 text-[14px] text-muted">None learned yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {model.learned.rows.map((l) => (
                <li key={l.id} className="rounded-[12px] border border-line px-3 py-2 text-[13.5px]">
                  <p className="m-0 font-mono font-bold text-ink">{l.value}</p>
                  <p className="m-0 text-muted">
                    {l.family ? `${l.family.name} · ${familyLine(l.family, model.labels)}` : "Family not shown"}
                  </p>
                  <p className="m-0 text-[12px] text-faint">
                    Seen {l.times} {l.times === 1 ? "time" : "times"}
                    {l.last ? ` · last ${formatDate(l.last, model.timeZone)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </GivingSheet>
      ) : null}
    </details>
  );
}

const DIFF_TONE: Record<PayoutRowView["difference"]["tone"], string> = {
  ok: "bg-success-50 text-success",
  warn: "bg-saffron-50 text-saffron",
  muted: "bg-ground text-muted",
};

/** One card payout: what the provider paid out, what reached the bank, and the difference. Read-only until slice 9. */
export function PayoutRow({ row }: { row: PayoutRowView }) {
  return (
    <div className="grid grid-cols-1 gap-3 border-t border-line py-3.5 first:border-t-0 md:grid-cols-[1fr_1fr_minmax(0,14rem)]" data-row={row.id}>
      <div className="min-w-0">
        <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-faint">Provider</p>
        {row.provider ? (
          <>
            <p className="m-0 text-[14px] font-bold text-ink">{row.provider.title}</p>
            <p className="m-0 text-[13px] text-muted">{row.provider.date}</p>
            <p className="m-0 text-[13px] text-muted">
              Gross {row.provider.gross} · fees {row.provider.fees} · <span className="font-bold text-ink">net {row.provider.net}</span>
            </p>
          </>
        ) : (
          <p className="m-0 text-[13px] text-muted">No payout found</p>
        )}
      </div>
      <div className="min-w-0">
        <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-faint">Bank</p>
        {row.bank ? (
          <>
            <p className="m-0 text-[14px] font-bold tabular-nums text-ink">{row.bank.amount}</p>
            <p className="m-0 text-[13px] text-muted">{row.bank.date}</p>
            <p className="m-0 break-words font-mono text-[12px] text-muted">{row.bank.title}</p>
          </>
        ) : (
          <p className="m-0 text-[13px] text-muted">No bank line found</p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className={`self-start rounded-full px-2.5 py-0.5 text-[13px] font-bold ${DIFF_TONE[row.difference.tone]}`}>{row.difference.text}</span>
        <p className="m-0 text-[12px] text-faint">{row.how}</p>
      </div>
    </div>
  );
}

/** A line already dealt with (matched or ignored), or money out to check. */
export function HistoryRow({ row, ctx, done, labels }: { row: HistoryRowView; ctx: ActContext; done: string | undefined; labels: BankModel["labels"] }) {
  if (done) {
    return (
      <div role="status" className="border-t border-line py-3.5 text-[14px] font-bold text-success first:border-t-0">
        {done}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-line py-3.5 first:border-t-0 md:flex-row md:items-start md:gap-4" data-row={row.id}>
      <div className="min-w-0 flex-1">
        <p className="m-0 flex flex-wrap items-baseline gap-x-3">
          <span className={`font-display text-[18px] font-semibold tabular-nums ${row.negative ? "text-danger" : "text-ink"}`}>{row.amount}</span>
          <span className="text-[13px] text-muted">{row.date}</span>
        </p>
        <p className="m-0 break-words font-mono text-[12px] text-muted">{row.description}</p>
        {row.family ? (
          <p className="m-0 mt-0.5 text-[13px] text-muted">
            <span className="font-bold text-ink">{row.family.name}</span> · {familyLine(row.family, labels)}
          </p>
        ) : null}
        <p className="m-0 mt-0.5 text-[13px] text-ink-2">{row.what}</p>
      </div>
      {row.act ? (
        <div className="flex flex-wrap gap-2 md:justify-end">
          {row.act === "restore" ? <RestoreLineAct id={row.id} amount={row.amount} ctx={ctx} /> : <IgnoreLineAct id={row.id} amount={row.amount} label="Ignore…" ctx={ctx} />}
        </div>
      ) : null}
    </div>
  );
}
