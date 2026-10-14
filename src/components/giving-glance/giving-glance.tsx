import type { ReactNode } from "react";

import { ChipLinks, QueryError } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { frequencyText } from "@/lib/giving";
import type { GlanceLink, GlanceModel } from "@/lib/giving-glance/compose";
import { deltaText, timeSeriesText, type GlanceSummary } from "@/lib/giving-glance/summary";
import { formatCents } from "@/lib/money";
import { ACCESS } from "@/lib/permissions";

// "Giving at a glance": the panel at the top of a household and a person. It only draws; the figures are made by
// src/lib/giving-glance (tested) and the pages pass in a view. Everything here is words and numbers a person can read: the bars
// repeat their numbers in text, and the small month-by-month chart has a plain-words alternative.

export type GlanceView =
  | { state: "no-access" }
  | { state: "error"; what: string; error: unknown; retryHref: string }
  | { state: "ready"; model: GlanceModel; currency: string; timeZone: string };

const TITLE = "Giving at a glance";

export function GivingGlanceView({ view, idPrefix = "gg" }: { view: GlanceView; idPrefix?: string }) {
  const titleId = `${idPrefix}-title`;
  if (view.state === "no-access") {
    return (
      <section aria-labelledby={titleId} className="cc-card mb-5 px-[18px] py-4" data-testid="giving-glance">
        <h2 id={titleId} className="cc-card-title">
          {TITLE}
        </h2>
        <p className="mt-1 font-display text-[18px] font-semibold text-ink">You don&apos;t have access to this area</p>
        <p className="mt-1 text-[13px] text-muted">
          Giving figures need one of these permissions: <strong className="text-ink">{ACCESS.payments.join(", ")}</strong>. Ask your admin to grant you a role that includes it.
        </p>
      </section>
    );
  }
  if (view.state === "error") {
    return (
      <section aria-labelledby={titleId} className="cc-card mb-5 px-[18px] py-4" data-testid="giving-glance">
        <h2 id={titleId} className="cc-card-title mb-2">
          {TITLE}
        </h2>
        <QueryError what={view.what} error={view.error} retryHref={view.retryHref} />
      </section>
    );
  }
  return <Ready model={view.model} currency={view.currency} timeZone={view.timeZone} titleId={titleId} />;
}

function Ready({ model, currency, timeZone, titleId }: { model: GlanceModel; currency: string; timeZone: string; titleId: string }) {
  const s = model.summary;
  const money = (c: number) => formatCents(c, currency);
  const hasQuestions = model.notes.length > 0;
  return (
    <section aria-labelledby={titleId} className="cc-card mb-5 px-[18px] pb-4 pt-4" data-testid="giving-glance">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={titleId} className="cc-card-title">
          {model.heading}
        </h2>
        <p className="text-[13px] font-semibold text-ink-2" data-testid="giving-glance-whose">
          {model.whose} · {s.window.title}
        </p>
      </div>
      {model.cardLine ? <p className="mt-0.5 text-[12px] text-muted">{model.cardLine}</p> : null}

      <div className="mt-3">
        <ChipLinks label="Year" items={model.yearLinks} active={model.yearLinks.find((l) => l.selected)?.key ?? ""} />
      </div>

      {model.chooser ? (
        <div className="-mt-1" data-testid="giving-glance-chooser">
          <p className="mb-1 text-[12px] font-semibold text-muted">{model.chooser.label}</p>
          <ChipLinks
            label={model.chooser.label}
            active={model.chooser.links.find((l) => l.selected)?.key ?? ""}
            items={model.chooser.links.map((l) => ({ key: l.key, href: l.href, label: <ChooserLabel link={l} money={money} /> }))}
          />
          <p className="-mt-1 mb-3 text-[12px] text-muted">{model.chooser.explain}</p>
        </div>
      ) : null}

      {hasQuestions ? (
        <div className="mb-3 flex flex-col gap-2">
          {model.notes.map((n, i) => (
            <p
              key={i}
              role="status"
              className={`rounded-[10px] border px-3 py-2 text-[13px] ${n.tone === "warning" ? "border-saffron/40 bg-saffron-50 text-brown-900" : "border-navy/20 bg-navy-50 text-navy"}`}
            >
              {n.text}
            </p>
          ))}
        </div>
      ) : null}

      {s.empty ? (
        <EmptyGlance model={model} />
      ) : (
        <>
          <Tiles s={s} money={money} timeZone={timeZone} />
          <Breakdown s={s} money={money} />
        </>
      )}

      {model.personRest ? (
        <p className="mt-3 rounded-[10px] bg-ground px-3 py-2 text-[13px] text-ink-2" data-testid="giving-glance-rest">
          <strong className="text-ink">Not tied to {model.personRest.firstName}:</strong> {money(model.personRest.paidCents)} paid and {money(model.personRest.pledgedCents)} pledged{" "}
          {model.personRest.period}. These are gifts and pledges with no named giver, or recorded under someone else in the household.{" "}
          <a href={model.personRest.seeHouseholdHref} className="crm-link font-semibold">
            See the household&apos;s total
          </a>
        </p>
      ) : null}

      {!s.empty ? (
        <p className="mt-3 text-[12px] text-muted">
          Still open and overdue are counted as of {formatDate(s.today, timeZone)}, whichever year is shown. Paid is after refunds.
          {s.totals.openingBalanceCents > 0
            ? ` An opening balance of ${money(s.totals.openingBalanceCents)} (paid before the imported history) is not counted here, as on year-end statements.`
            : ""}
        </p>
      ) : null}
    </section>
  );
}

function ChooserLabel({ link, money }: { link: GlanceLink; money: (c: number) => string }) {
  return (
    <span>
      {link.label}
      {link.cents !== undefined ? <span className="font-normal"> · {money(link.cents)}</span> : null}
    </span>
  );
}

function EmptyGlance({ model }: { model: GlanceModel }) {
  const w = model.summary.window;
  return (
    <div className="rounded-[12px] bg-ground px-4 py-5" data-testid="giving-glance-empty">
      <p className="text-[15px] font-semibold text-ink">{w.selection.kind === "all" ? "No giving recorded yet" : "No giving recorded for this year"}</p>
      {w.selection.kind === "all" ? null : <p className="mt-0.5 text-[13px] text-muted">Nothing was pledged or paid in {w.label}.</p>}
      {model.yearsWithData.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-muted">See</span>
          {model.yearsWithData.map((l) => (
            <a key={l.key} href={l.href} className="cc-chip">
              {l.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The eight indicators
// ---------------------------------------------------------------------------
function Tile({ label, value, tone = "ink", children }: { label: string; value: ReactNode; tone?: "ink" | "danger" | "success"; children?: ReactNode }) {
  const color = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink";
  return (
    <div className="cc-kpi h-full">
      <p className="cc-kpi-label">{label}</p>
      <p className={`cc-kpi-value break-words text-[1.25rem] sm:text-[1.5rem] ${color}`}>{value}</p>
      <div className="cc-kpi-sub">{children}</div>
    </div>
  );
}

const line = (key: string, text: ReactNode) => (
  <span key={key} className="block">
    {text}
  </span>
);

function Tiles({ s, money, timeZone }: { s: GlanceSummary; money: (c: number) => string; timeZone: string }) {
  const t = s.totals;
  const prev = s.window.previous;
  const against = (now: number, before: number | undefined, fmt: (c: number) => string = money) =>
    prev && before !== undefined ? deltaText(now, before, prev.label, fmt) : null;
  const countText = (n: number) => String(n);
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

  const pledgedDelta = against(t.pledgedCents, s.previous?.pledgedCents);
  const paidDelta = against(t.paidCents, s.previous?.paidCents);
  const giftsDelta = against(t.giftCount, s.previous?.giftCount, countText);

  const fulfil = s.fulfilmentPercent;
  const fulfilDelta =
    prev && s.previousFulfilmentPercent !== null && fulfil !== null
      ? fulfil === s.previousFulfilmentPercent
        ? `Same as ${prev.label} (${s.previousFulfilmentPercent}%)`
        : `${fulfil > s.previousFulfilmentPercent ? "Up" : "Down"} ${Math.abs(fulfil - s.previousFulfilmentPercent)} points on ${prev.label} (${s.previousFulfilmentPercent}%)`
      : null;

  const last = s.lastGiftInPeriod;
  const recurring = s.recurring;

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="giving-glance-tiles">
      <Tile label="Pledged" value={money(t.pledgedCents)}>
        {line("n", `${plural(t.pledgedCount, "pledge")} made${t.writtenOffCents > 0 ? ` · ${money(t.writtenOffCents)} written off` : ""}`)}
        {pledgedDelta ? line("d", pledgedDelta) : null}
      </Tile>
      <Tile label="Paid" value={money(t.paidCents)} tone="success">
        {line("n", t.refundedCents > 0 ? `After ${money(t.refundedCents)} refunded` : "Received, no refunds")}
        {paidDelta ? line("d", paidDelta) : null}
      </Tile>
      <Tile label="Still open" value={money(s.open.cents)}>
        {line("n", `${plural(s.open.count, "open pledge")}, as of today`)}
        {s.window.selection.kind === "year" && s.open.fromPeriodCents > 0 && s.open.fromPeriodCents !== s.open.cents
          ? line("p", `${money(s.open.fromPeriodCents)} of it from pledges made in ${s.window.label}`)
          : null}
      </Tile>
      <Tile label="Overdue" value={money(s.open.overdueCents)} tone={s.open.overdueCents > 0 ? "danger" : "ink"}>
        {s.open.overdueCount > 0
          ? line("n", `${plural(s.open.overdueCount, "pledge")} · oldest ${plural(s.open.oldestOverdueDays, "day")} late`)
          : line("n", "Nothing is past its due date")}
      </Tile>
      <Tile label="Pledges fulfilled" value={fulfil === null ? "—" : `${fulfil}%`}>
        {fulfil === null ? (
          line("n", "No pledges were made in this period")
        ) : (
          <>
            <span className="my-1 block h-1.5 overflow-hidden rounded-full bg-track" aria-hidden="true">
              <span className="block h-full rounded-full bg-navy" style={{ width: `${fulfil}%` }} />
            </span>
            {line("n", `${money(t.paidOnPledgesCents)} of ${money(t.pledgedCents)} pledged has been paid`)}
            {fulfilDelta ? line("d", fulfilDelta) : null}
          </>
        )}
      </Tile>
      <Tile label="Gifts" value={t.giftCount}>
        {line("n", t.averageCents === null ? "No gifts in this period" : `Average ${money(t.averageCents)}`)}
        {giftsDelta ? line("d", giftsDelta) : null}
      </Tile>
      <Tile label="Last gift" value={last ? money(last.cents) : "None"}>
        {last
          ? line("n", formatDate(last.on, timeZone))
          : s.lastGiftEver
            ? line("n", `None in this period. Latest: ${formatDate(s.lastGiftEver.on, timeZone)}, ${money(s.lastGiftEver.cents)}`)
            : line("n", "No gift on record")}
      </Tile>
      <Tile label="Recurring gift" value={recurring.count === 0 ? "None" : recurring.count === 1 ? money(recurring.items[0].amountCents) : `${recurring.count} active`}>
        {recurring.count === 0
          ? line("n", "No active recurring gift")
          : line("n", recurring.items.map((r) => `${frequencyText(r.frequency)} ${money(r.amountCents)}`).join(" · "))}
      </Tile>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Where it went, and when
// ---------------------------------------------------------------------------
function Breakdown({ s, money }: { s: GlanceSummary; money: (c: number) => string }) {
  const yearly = s.window.selection.kind === "all";
  const peak = s.byTime.reduce((best, b) => (b.cents > best.cents ? b : best), s.byTime[0] ?? { key: "", label: "", cents: 0 });
  const max = Math.max(...s.byTime.map((b) => b.cents), 0);
  const what = yearly ? "Paid by year" : "Paid by month";
  return (
    <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2" data-testid="giving-glance-breakdown">
      <div>
        <h3 className="mb-2 text-[13px] font-bold text-ink">Where the money went</h3>
        {s.byCause.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing was paid in this period.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {s.byCause.map((c) => (
              <li key={c.label} className="text-[13px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold text-ink" title={c.label}>
                    {c.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-2">
                    {money(c.cents)} · {c.percent}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden="true">
                  <div className="h-full rounded-full bg-navy" style={{ width: `${c.percent}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-bold text-ink">{yearly ? "Year by year" : "Month by month"}</h3>
        {max <= 0 ? (
          <p className="text-[13px] text-muted">Nothing was paid in this period.</p>
        ) : (
          <>
            <div role="img" aria-label={timeSeriesText(s.byTime, what, money)} className="flex h-20 items-end gap-1" data-testid="giving-glance-sparkline">
              {s.byTime.map((b) => (
                <div key={b.key} className={`flex h-full min-w-0 flex-1 items-end ${yearly ? "max-w-[56px]" : ""}`} title={`${b.label}: ${money(b.cents)}`}>
                  <div
                    aria-hidden="true"
                    className={`w-full rounded-t-[3px] ${b.cents > 0 ? "bg-navy" : "bg-line"}`}
                    style={{ height: b.cents > 0 ? `${Math.max(6, Math.round((b.cents / max) * 100))}%` : "2px" }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1 text-[10px] text-muted" aria-hidden="true">
              {s.byTime.map((b) => (
                <span key={b.key} className={`min-w-0 flex-1 truncate text-center ${yearly ? "max-w-[56px]" : ""}`}>
                  {yearly ? b.key : b.label}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-ink-2">
              {yearly ? "Biggest year" : "Busiest month"}: <strong>{peak.label}</strong>, {money(peak.cents)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
