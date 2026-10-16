"use client";

// The rows of Giving's Pledges and Payments lists (docs/GIVING_REDESIGN.md sections 4 and 8): a table row on a computer, a card
// on a phone (reference, household card, amount, status). A row acts in place through the same sheets as Today (ActButtons):
// the buttons its state asks for on the row, the rest in its menu (⋯). When a search finds exactly one row, its actions are
// shown open. A row someone acted on stays on the page as "Done: …" until the page is reloaded, as on Today.

import { useEffect, useId, useRef, useState } from "react";

import { ActButtons, type ActContext } from "@/components/giving-actions/row-actions";
import type { CardLabels } from "@/components/household-card";
import { PaymentEvidence } from "@/components/payment-evidence/payment-evidence";
import { HistoryButton } from "@/components/record-history";
import { familyLine } from "@/lib/giving-today/queue";
import type { ListRow, Tone } from "@/lib/giving-lists/types";

export type RowsContext = { currency: string; locale: string; timeZone: string; today: string; labels: CardLabels };

const TONE: Record<Tone, string> = {
  ok: "bg-success-50 text-success",
  warn: "bg-warning-50 text-warning-ink",
  bad: "bg-danger-50 text-danger",
  info: "bg-navy-50 text-navy",
  muted: "border border-line bg-ground text-muted",
};

export function StatusPill({ status }: { status: ListRow["status"] }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12.5px] font-bold ${TONE[status.tone]}`}>{status.label}</span>;
}

function RowMenu({ row, ctx }: { row: ListRow; ctx: ActContext }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (row.menu.length === 0 && !row.history) return null;
  // The items stay mounted while the menu is closed: a sheet opened from an item lives on after the menu closes.
  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`More for ${row.reference === "—" ? row.title : row.reference}`}
        title="More"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 min-w-10 items-center justify-center rounded-field border border-line bg-white px-2 text-[18px] font-bold leading-none text-ink-2 hover:bg-canvas"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <div
        id={id}
        hidden={!open}
        onClickCapture={() => setOpen(false)}
        className="absolute right-0 top-11 z-30 flex w-64 max-w-[calc(100vw-32px)] flex-col gap-0.5 rounded-[14px] border border-line bg-white p-1.5 shadow-menu"
      >
        <ActButtons acts={row.menu} row={row} ctx={{ ...ctx, trigger: "menu" }} />
        {row.history ? (
          <span className="px-1.5 py-1">
            <HistoryButton table={row.history.table} recordId={row.id} title={row.history.title} variant="plain" size="sm" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Row({ row, ctx, expanded }: { row: ListRow; ctx: ActContext; expanded: boolean }) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 md:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_minmax(7rem,9rem)_minmax(8rem,11rem)_minmax(0,auto)] md:items-start">
      <div className="flex items-baseline justify-between gap-3 md:block">
        <p className="m-0 font-mono text-[13px] font-bold text-ink">{row.reference}</p>
        <p className="m-0 text-[12.5px] text-muted">{row.date}</p>
      </div>
      <div className="min-w-0">
        {row.family ? (
          <>
            <p className="m-0 text-[14.5px] font-bold text-ink">{row.family.name}</p>
            <p className="m-0 text-[12.5px] leading-[1.4] text-muted">{familyLine(row.family, ctx.labels)}</p>
          </>
        ) : null}
        {row.lines.map((l) => (
          <p key={l} className="m-0 text-[12.5px] leading-[1.45] text-ink-2">
            {l}
          </p>
        ))}
        {row.note ? <p className="m-0 mt-1 text-[12.5px] font-semibold text-ink-2">{row.note}</p> : null}
        {row.found ? <p className="m-0 mt-0.5 text-[12px] text-faint">{row.found}</p> : null}
        {row.evidence ? (
          <PaymentEvidence paymentId={row.evidence.paymentId} reference={row.evidence.reference} timeZone={ctx.timeZone} canAttach={row.evidence.canAttach} canRemove={row.evidence.canRemove} />
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-3 md:block md:text-right">
        <p className="m-0 text-[15px] font-bold tabular-nums text-ink">{row.amount}</p>
        {row.amountNote ? <p className="m-0 text-[12.5px] text-muted">{row.amountNote}</p> : null}
      </div>
      <div>
        <StatusPill status={row.status} />
      </div>
      <div className="flex flex-wrap items-start gap-2 md:justify-end">
        <ActButtons acts={expanded ? [...row.primary, ...row.menu] : row.primary} row={row} ctx={ctx} />
        {expanded ? (
          row.history ? <HistoryButton table={row.history.table} recordId={row.id} title={row.history.title} variant="ghost" size="sm" /> : null
        ) : (
          <RowMenu row={row} ctx={ctx} />
        )}
      </div>
    </div>
  );
}

/** One list: a header on a computer, cards on a phone. */
export function ListRows({
  rows,
  ctx,
  columns,
  expandSingle = false,
  label,
}: {
  rows: ListRow[];
  ctx: RowsContext;
  columns: [string, string, string, string];
  expandSingle?: boolean;
  label: string;
}) {
  const [done, setDone] = useState<Record<string, string>>({});
  const expanded = expandSingle && rows.length === 1;
  return (
    <div>
      <div className="hidden gap-x-4 border-b border-line pb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted md:grid md:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_minmax(7rem,9rem)_minmax(8rem,11rem)_minmax(0,auto)]" aria-hidden="true">
        <span>{columns[0]}</span>
        <span>{columns[1]}</span>
        <span className="text-right">{columns[2]}</span>
        <span>{columns[3]}</span>
        <span />
      </div>
      <ul aria-label={label} className="m-0 flex list-none flex-col gap-2.5 p-0 md:gap-0">
        {rows.map((row) => {
          const act: ActContext = { ...ctx, onDone: (text) => setDone((d) => ({ ...d, [row.id]: text })) };
          const text = done[row.id];
          return (
            <li key={row.id} data-row={row.id} className="rounded-[14px] border border-line bg-white p-3 md:rounded-none md:border-0 md:border-b md:bg-transparent md:px-0 md:py-3">
              {text ? (
                <p role="status" className="m-0 text-[14px] font-bold text-success">
                  {text}
                </p>
              ) : (
                <Row row={row} ctx={act} expanded={expanded} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
