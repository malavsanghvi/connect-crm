import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Card, ChipLinks, EmptyState, KpiGrid, PageHeader, Pagination, Stat, buttonClass } from "@/components/ui";
import { ReopenThank, ThankActions } from "@/components/care/thank-actions";
import { NO_ACCESS, householdLine } from "@/lib/care/model";
import {
  THANKS_FILTERS,
  THANKS_FILTER_LABEL,
  dueLine,
  giftLine,
  howLine,
  medianLine,
  onTimeLine,
  openLine,
  personalLine,
  type ThanksFilter,
  type ThanksRow,
} from "@/lib/care/thanks";
import { THANKS_PAGE_SIZE, loadThanksQueue, loadThanksSummary, seesCare } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { formatCents } from "@/lib/money";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Thank-yous" };

// The thank-you tracker (DonorDelight slice 3): every gift opens a step, due within the organization's window; the step closes when the
// receipt is sent or a thank-you is recorded, and a first or large gift needs a personal one. A relationship owner (care.own) sees
// only their own households; care.view and care.manage see every one. Amounts show only to a role that also sees giving; without
// one the line says "Thank them warmly". The database decides (app.care_thanks_queue, 0883: no platform-admin branch) and logs the read.

function filterOf(v: string | undefined): ThanksFilter {
  return (THANKS_FILTERS as readonly string[]).includes(v ?? "") ? (v as ThanksFilter) : "open";
}

function StepRow({ row, money }: { row: ThanksRow; money: (c: number) => string }) {
  const done = row.thankedAt !== null;
  const aside = row.setAsideAt !== null;
  return (
    <li className="flex flex-col gap-2 border-b border-line-soft px-4 py-3 last:border-b-0 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0">
        <Link href={`/households/${row.household.id}`} className="crm-link font-semibold">
          {row.household.name}
        </Link>
        <div className="text-[12px] text-muted">{householdLine(row.household)}</div>
        <div className="mt-1 text-[14px] text-ink">{giftLine(row, money)}</div>
        <div className="text-[13px] text-muted">
          {done ? howLine(row.how, row.thankedAt) : aside ? `Set aside: ${row.setAsideReason ?? ""}` : (
            <>
              <span className={row.overdue ? "font-semibold text-danger" : undefined}>{dueLine(row)}</span> · {personalLine(row.needsPersonal)}
            </>
          )}
        </div>
      </div>
      <div className="md:max-w-[460px]">
        {done ? null : aside ? <ReopenThank stepId={row.id} /> : <ThankActions stepId={row.id} householdId={row.household.id} needsPersonal={row.needsPersonal} />}
      </div>
    </li>
  );
}

export default async function ThanksPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const label = kindName(session.kind, "care", "DonorDelight");
  const header = (
    <PageHeader
      title={`${label}: thank-yous`}
      description="Every gift opens a thank-you. It closes when the receipt is sent or a thank-you is recorded; a first or large gift needs a personal one."
    />
  );
  const card = (title: string, body?: string) => (
    <>
      {header}
      <div className="cc-card px-6 py-10 text-center">
        <p className="font-display text-[22px] font-semibold text-ink">{title}</p>
        {body ? <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">{body}</p> : null}
      </div>
    </>
  );

  if (!seesCare(session)) return card(NO_ACCESS, `${label} is open only to the roles your organization gives it. Ask your organization's owner or care lead.`);

  const filter = filterOf(param(sp, "show"));
  const page = pageParam(sp);
  const [queue, summary] = await Promise.all([loadThanksQueue(session, filter, page), loadThanksSummary(session)]);

  if (queue.status === "no_access") return card(NO_ACCESS);
  if (queue.status === "off") return card(queue.message);
  if (queue.status === "error") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load the thank-yous"
          action={
            <a href={hrefWith("/care/thanks", sp, {})} className={buttonClass("bad", "xs")}>
              Try again
            </a>
          }
        >
          {queue.error.charAt(0).toUpperCase() + queue.error.slice(1).replace(/\.?$/, ".")}
        </Alert>
      </>
    );
  }

  const data = queue.data;
  if (data.state === "giving_off") return card("Giving is off, so there are no gifts to thank.", "Turn Giving on in Settings › Modules to start thanking gifts here.");
  if (data.state === "not_set_up") {
    return (
      <>
        {header}
        <div className="cc-card px-6 py-10 text-center">
          <p className="font-display text-[22px] font-semibold text-ink">Choose how gifts are thanked to start</p>
          <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
            Nothing is thanked, and no gift opens a step, until the rules are saved: how fast, and which gifts need a personal thank-you.
          </p>
          {data.canManage ? (
            <Link href="/care/settings" className={`${buttonClass("primary", "sm")} mt-4`}>
              Set the thank-you rules
            </Link>
          ) : (
            <p className="mx-auto mt-3 max-w-lg text-[13px] text-muted">Someone who manages {label} sets them.</p>
          )}
        </div>
      </>
    );
  }

  const money = (c: number) => formatCents(c, session.center.currency);
  const sum = summary.status === "ok" && summary.data.state === "ok" ? summary.data : null;
  const chips = THANKS_FILTERS.map((f) => {
    const n = f === "open" ? data.counts.open : f === "overdue" ? data.counts.overdue : f === "done" ? data.counts.done : data.counts.setAside;
    return { key: f, label: `${THANKS_FILTER_LABEL[f]} (${n})`, href: hrefWith("/care/thanks", sp, { show: f, page: null }) };
  });

  return (
    <>
      {header}
      {data.canManage ? (
        <p className="m-0 mb-3 text-[13px] text-muted">
          Thanked within {data.windowDays} {data.windowDays === 1 ? "day" : "days"}. <Link href="/care/settings" className="crm-link font-semibold">Change the rules</Link>
        </p>
      ) : null}
      <KpiGrid cols={4}>
        <Stat label="To thank" value={data.counts.open} hint={openLine(data.counts)} tone={data.counts.overdue > 0 ? "brown" : "navy"} />
        <Stat label="Need a personal thank-you" value={data.counts.personalOpen} hint="A call, a visit, a card or a video" />
        <Stat
          label="Thanked on time"
          value={sum ? (onTimeLine(sum.onTimeShare) ?? "Not enough yet") : "…"}
          hint={sum ? `Last ${sum.days} days` : "Could not load the summary"}
        />
        <Stat
          label="Time to thank"
          value={sum ? (medianLine(sum.medianHours) ?? "Not enough yet") : "…"}
          hint={sum ? "Typical, from the gift" : "Could not load the summary"}
        />
      </KpiGrid>
      <div className="mt-4">
        <ChipLinks label="Show" items={chips} active={data.filter} />
      </div>
      <Card padded={false}>
        {data.rows.length === 0 ? (
          <EmptyState
            title={
              data.filter === "open"
                ? "Every gift is thanked."
                : data.filter === "overdue"
                  ? "Nothing is overdue."
                  : data.filter === "done"
                    ? "Nothing was thanked in the last 30 days."
                    : "Nothing is set aside."
            }
          />
        ) : (
          <ul className="m-0 list-none p-0">
            {data.rows.map((r) => (
              <StepRow key={r.id} row={r} money={money} />
            ))}
          </ul>
        )}
        <Pagination page={page} pageSize={THANKS_PAGE_SIZE} total={data.total} hrefFor={(p) => hrefWith("/care/thanks", sp, { page: p })} />
      </Card>
    </>
  );
}
