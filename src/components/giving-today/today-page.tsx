"use client";

// Giving › Today in the New look (docs/GIVING_REDESIGN.md section 4): the work queue first, its tiles filtering the rows, each
// row acting in place; then three numbers for the month and the families seen most recently. On a phone the rows stack, the
// tab row scrolls sideways and a bar above the bottom bar holds Record payment and Find.
//
// The large box (slice 2) sits above the queue: "200 check patel" opens the Record payment sheet filled in, a receipt number or an
// amount finds the payment, a family opens its giving in place. Record payment opens the same sheet; nothing leaves Giving.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { StartCountButton } from "@/components/giving-actions/count-acts";
import { FamilyGivingLink, RecordPaymentButton } from "@/components/giving-actions/provider";
import { RowButtons, RowInline, type ActContext } from "@/components/giving-actions/row-actions";
import { useNiva } from "@/components/niva/niva-context";
import { FindBox } from "@/components/people-v2/find/find-box";
import { buttonClass } from "@/components/ui";
import type { GivingTodayModel } from "@/lib/data/giving-today";
import { familyLine, queueTiles, type GroupKey, type QueueRow, type RowIcon, type RowTone } from "@/lib/giving-today/queue";
import type { Part } from "@/lib/giving-workspace/view";
import { formatCents } from "@/lib/money";

import { GivingTabRow } from "./giving-tabs";

const TONE: Record<RowTone, string> = {
  blue: "bg-navy-50 text-navy",
  sun: "bg-saffron-50 text-brown",
  green: "bg-success-50 text-success",
  indigo: "bg-purple-50 text-purple",
  plain: "border border-line bg-ground text-muted",
};

const ICON: Record<RowIcon | "done", string> = {
  approve: "M9 12l2 2 4-4 M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  refund: "M4 9h12a4 4 0 0 1 0 8H8 M4 9l4-4 M4 9l4 4",
  bank: "M3 10h18 M5 10v8 M9.5 10v8 M14.5 10v8 M19 10v8 M3 20h18 M12 3l9 5H3z",
  deposit: "M4 7h16v12H4z M4 11h16 M8 15h3",
  pledge: "M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z",
  count: "M5 8h14l-1 12H6z M9 8V5h6v3",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11",
  info: "M12 8h.01 M11 12h1v5h1 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  done: "M5 13l4 4 10-10",
};

function Icon({ name, tone }: { name: RowIcon | "done"; tone: RowTone }) {
  return (
    <span aria-hidden="true" className={`flex h-9 w-9 flex-none items-center justify-center rounded-[12px] ${TONE[tone]}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON[name]} />
      </svg>
    </span>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-t border-line py-3.5 first:border-t-0">
      <Icon name="info" tone="sun" />
      <p className="m-0 min-w-0 flex-1 text-[14px] text-danger">{message}</p>
      <a href="/giving" className={`${buttonClass("ghost", "sm")} min-h-[40px]`}>
        Reload to try again
      </a>
    </div>
  );
}

export function Row({ row, ctx, done }: { row: QueueRow; ctx: ActContext; done: string | undefined }) {
  if (done) {
    return (
      <div className="flex items-center gap-3.5 border-t border-line py-3.5 first:border-t-0" data-row={row.id} role="status">
        <Icon name="done" tone="green" />
        <p className="m-0 min-w-0 flex-1 text-[14px] font-bold text-success">{done}</p>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-2.5 border-t border-line py-3.5 first:border-t-0 md:flex-row md:items-start md:gap-3.5"
      data-row={row.id}
      data-spotlight={ctx.spotlight ? "bank-line" : undefined}
    >
      <div className="flex min-w-0 flex-1 gap-3.5">
        <Icon name={row.icon} tone={row.tone} />
        <div className="min-w-0 flex-1">
          <p className={`m-0 text-[15px] leading-snug ${row.info ? "font-semibold text-ink-2" : "font-bold text-ink"}`}>{row.title}</p>
          {row.family ? (
            <p className="m-0 mt-0.5 text-[13px] leading-[1.4] text-muted" data-spotlight={ctx.spotlight ? "bank-household" : undefined}>
              <span className="font-bold text-ink">{row.family.name}</span> · {familyLine(row.family, ctx.labels)}
            </p>
          ) : null}
          {row.lines.map((l) => (
            <p key={l} className="m-0 mt-0.5 text-[13px] leading-[1.4] text-muted">
              {l}
            </p>
          ))}
          {row.since ? <p className="m-0 mt-0.5 text-[12px] text-faint">{row.since}</p> : null}
          <RowInline row={row} ctx={ctx} />
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-2 pl-[50px] md:max-w-[46%] md:justify-end md:pl-0">
        <RowButtons row={row} ctx={ctx} />
      </div>
    </div>
  );
}

function Numbers<T>({ part, children }: { part: Part<T>; children: (d: T) => ReactNode }) {
  if (part.state === "no_access" || part.state === "off") return null;
  if (part.state === "error") {
    return (
      <div role="alert" className="rounded-[14px] border border-danger/30 bg-danger-50 px-3.5 py-3 text-[13px] text-danger">
        {part.error}
      </div>
    );
  }
  return <div className="rounded-[14px] border border-line bg-white px-3.5 py-3">{children(part.data)}</div>;
}

export function TodayPage({ model }: { model: GivingTodayModel }) {
  const pathname = usePathname() ?? "/giving";
  const niva = useNiva();
  const [tile, setTile] = useState<GroupKey | "all">(model.initialTile);
  const [done, setDone] = useState<Record<string, string>>({});
  const doneIds = new Set(Object.keys(done));
  const tiles = queueTiles(model.queue.rows, { countsWord: model.countsWord, visible: Object.fromEntries(model.queue.tiles.map((t) => [t.key, true])) as Record<GroupKey, boolean> }, doneIds);
  const waiting = tiles[0].count;
  const rows = model.queue.rows.filter((r) => tile === "all" || r.group === tile);
  const problems = model.queue.problems.filter((p) => tile === "all" || p.group === tile);
  const fmt = (c: number) => formatCents(c, model.currency, model.locale);
  const ctxFor = (row: QueueRow): ActContext => ({
    currency: model.currency,
    locale: model.locale,
    timeZone: model.timeZone,
    labels: model.labels,
    onDone: (text) => setDone((d) => ({ ...d, [row.id]: text })),
  });

  /** The phone bar's Find: the large box at the top of the page, focused. */
  function focusFind() {
    const input = document.querySelector<HTMLInputElement>("[data-giving-find] input");
    input?.scrollIntoView({ block: "center" });
    input?.focus();
  }

  function choose(k: GroupKey | "all") {
    setTile(k);
    try {
      window.history.replaceState(null, "", k === "all" ? pathname : `${pathname}?show=${k}`);
    } catch {
      // The address is a convenience; the filter works without it.
    }
  }

  const tileLabel = tiles.find((t) => t.key === tile)?.label ?? "";
  const seesNumbers = [model.month.recorded, model.month.open, model.month.matched].some((p) => p.state !== "no_access" && p.state !== "off");

  return (
    <div data-v2-tokens className="flex flex-col gap-5 pb-24 md:pb-2">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">{model.title}</h1>
          <p className="m-0 text-[14px] text-muted">What needs you today. Each item acts in its own row.</p>
        </div>
        {model.can.record || model.can.countStart ? (
          <div className="hidden flex-wrap items-start gap-2 md:flex">
            {model.can.countStart ? <StartCountButton labels={model.labels} className={buttonClass("ghost", "sm")} /> : null}
            {model.can.record ? (
              <RecordPaymentButton href="/giving/payments" className={buttonClass("primary", "sm")}>
                Record payment
              </RecordPaymentButton>
            ) : null}
          </div>
        ) : null}
      </header>

      <GivingTabRow tabs={model.tabs} counts={model.tabCounts} active="today" />

      {model.can.find ? (
        <section aria-label="Find in Giving" data-giving-find="">
          <FindBox variant="page" scope="giving" cookieName={null} />
        </section>
      ) : null}

      <section aria-labelledby="giving-queue" className="rounded-[18px] border border-line bg-white px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id="giving-queue" className="m-0 font-display text-[20px] font-semibold text-ink">
            Work queue
          </h2>
          <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-[13px] font-bold text-navy">{waiting} waiting</span>
        </div>
        {model.roleNote ? <p className="m-0 mt-2 rounded-[10px] bg-saffron-50 px-3 py-2 text-[13px] text-brown">{model.roleNote}</p> : null}

        <div role="group" aria-label="Show" className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tile === t.key}
              onClick={() => choose(t.key)}
              className={`flex min-h-[64px] flex-col items-start gap-0.5 rounded-[16px] border-[1.5px] px-3.5 py-2.5 text-left ${
                tile === t.key ? "border-navy bg-navy-50" : "border-line bg-white hover:border-navy-300"
              }`}
            >
              <span className="font-display text-[26px] font-semibold leading-none text-ink">{t.count}</span>
              <span className="text-[13px] text-muted">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-2">
          {problems.map((p) => (
            <Problem key={`${p.group}:${p.message}`} message={p.message} />
          ))}
          {rows.map((r) => (
            <Row key={r.id} row={r} ctx={ctxFor(r)} done={done[r.id]} />
          ))}
          {rows.length === 0 && problems.length === 0 ? (
            <p className="m-0 py-6 text-center text-[14px] text-muted">
              {tile === "all" ? "Nothing is waiting for you. When something needs you, it shows here." : `Nothing is waiting under ${tileLabel}.`}
            </p>
          ) : null}
        </div>
      </section>

      {seesNumbers ? (
        <section aria-labelledby="giving-month">
          <h2 id="giving-month" className="m-0 mb-2.5 font-display text-[20px] font-semibold text-ink">
            {model.month.label}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Numbers part={model.month.recorded}>
              {(d) => (
                <>
                  <p className="m-0 font-display text-[24px] font-semibold text-ink">{fmt(d.cents)}</p>
                  <p className="m-0 text-[13px] text-muted">
                    {d.onlyMine ? "recorded by you this month" : "recorded this month"}
                    {d.truncated ? " (the first 50,000 payments)" : ""}
                  </p>
                </>
              )}
            </Numbers>
            <Numbers part={model.month.open}>
              {(d) => (
                <>
                  <p className="m-0 font-display text-[24px] font-semibold text-ink">{fmt(d.open_cents)}</p>
                  <p className="m-0 text-[13px] text-muted">
                    in open pledges across {d.households} {d.households === 1 ? "household" : "households"}
                  </p>
                </>
              )}
            </Numbers>
            <Numbers part={model.month.matched}>
              {(d) =>
                d.total === 0 ? (
                  <>
                    <p className="m-0 font-display text-[24px] font-semibold text-ink">—</p>
                    <p className="m-0 text-[13px] text-muted">No bank lines imported this month yet</p>
                  </>
                ) : (
                  <>
                    <p className="m-0 font-display text-[24px] font-semibold text-ink">{Math.floor((d.matched * 100) / d.total)}%</p>
                    <p className="m-0 text-[13px] text-muted">
                      of this month&apos;s bank lines matched ({d.matched} of {d.total})
                    </p>
                  </>
                )
              }
            </Numbers>
          </div>
        </section>
      ) : null}

      {model.recent.state === "no_access" || model.recent.state === "off" ? null : (
        <section aria-labelledby="giving-recent">
          <h2 id="giving-recent" className="m-0 mb-2.5 font-display text-[20px] font-semibold text-ink">
            Recent families
          </h2>
          {model.recent.state === "error" ? (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {model.recent.error}
            </p>
          ) : model.recent.data.length === 0 ? (
            <p className="m-0 text-[14px] text-muted">No payments recorded yet.</p>
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4">
              {model.recent.data.map((f) => (
                <li key={f.id}>
                  <FamilyGivingLink householdId={f.id} className="block w-full rounded-[16px] border border-line bg-white px-3.5 py-3 text-left no-underline hover:border-navy-300">
                    <span className="block font-display text-[17px] font-semibold text-ink">{f.name}</span>
                    <span className="block text-[13px] text-muted">{familyLine(f, model.labels)}</span>
                  </FamilyGivingLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="fixed inset-x-0 bottom-[calc(67px+env(safe-area-inset-bottom))] z-20 flex gap-2 border-t border-line bg-white px-4 py-2 md:hidden">
        {model.can.record ? (
          <RecordPaymentButton href="/giving/payments" className={`${buttonClass("primary")} min-h-[44px] flex-1 justify-center`}>
            Record payment
          </RecordPaymentButton>
        ) : null}
        {model.can.countStart ? (
          <span className="flex flex-1">
            <StartCountButton labels={model.labels} full className={`${buttonClass("ghost")} min-h-[44px] w-full justify-center`}>
              Count
            </StartCountButton>
          </span>
        ) : null}
        {model.can.find ? (
          <button type="button" onClick={focusFind} className={`${buttonClass("ghost")} min-h-[44px] flex-1 justify-center`}>
            Find
          </button>
        ) : niva ? (
          <button type="button" onClick={() => niva.openPalette()} className={`${buttonClass("ghost")} min-h-[44px] flex-1 justify-center`}>
            Find
          </button>
        ) : (
          <Link href="/search" className={`${buttonClass("ghost")} min-h-[44px] flex-1 justify-center`}>
            Find
          </Link>
        )}
      </div>
    </div>
  );
}
