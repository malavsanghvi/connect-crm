// Giving › Statements in the New look (docs/GIVING_REDESIGN.md section 4, slice 8): the year-end review with "Review and send"
// (the send stays off until the statements service is connected), a copy of one receipt, then the receipt wording and the
// treasurer's approval as they were (handed in as children). Drawn on the server; the sheet is the only client part.

import Link from "next/link";
import type { ReactNode } from "react";

import { FamilyCard } from "@/components/giving-actions/sheet";
import { ChipRow, ListCard, PagerNav } from "@/components/giving-lists/list-chrome";
import { GivingTabRow } from "@/components/giving-today/giving-tabs";
import { NoAccess, buttonClass } from "@/components/ui";
import type { Pager } from "@/lib/giving-lists/model";
import { REVIEW_PAGE_SIZE, statementsHref, type StatementsModel } from "@/lib/giving-statements/model";
import { DELIVERY_LABEL, matchesFilter, type Delivery, type ReviewFilter, type ReviewRowView } from "@/lib/giving-statements/review";

import { ReceiptPreview } from "./receipt-preview";
import { ReviewAndSend } from "./review-send";

const PILL: Record<Delivery, string> = {
  email: "bg-navy-50 text-navy",
  post: "bg-saffron-50 text-saffron",
  app: "bg-canvas text-ink-2",
  none: "bg-danger-50 text-[#7a1a14]",
};

function ErrorBox({ message, retry }: { message: string; retry: string }) {
  return (
    <div role="alert" className="rounded-[14px] border border-[#f0b9b4] bg-danger-50 px-4 py-3 text-[14px] text-[#7a1a14]">
      {message}{" "}
      <Link href={retry} className="font-bold underline">
        Try again
      </Link>
    </div>
  );
}

function ReviewRow({ row, model }: { row: ReviewRowView; model: StatementsModel }) {
  const nothing = row.givenCents <= 0;
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 md:flex-row md:items-start md:justify-between" data-testid="statements-review-row">
      <div className="min-w-0 flex-1">
        <FamilyCard family={row.family} labels={model.labels}>
          <p className="m-0 text-[13px] text-ink-2">Addressed to: {row.addressedTo}</p>
        </FamilyCard>
        {row.problems.length ? (
          <ul className="m-0 mt-2 list-none p-0" aria-label="To fix before sending">
            {row.problems.map((p) => (
              <li key={p.key} className="text-[13px] font-semibold text-[#8a4b00]">
                {p.text}
              </li>
            ))}
          </ul>
        ) : null}
        {row.notes.map((n) => (
          <p key={n.key} className="m-0 mt-1 text-[12px] text-muted">
            {n.text}
          </p>
        ))}
      </div>
      <div className="flex flex-row items-center gap-3 md:w-48 md:flex-col md:items-end">
        <span className="text-[17px] font-bold tabular-nums text-ink">{row.total}</span>
        <span className="text-[12px] text-muted">
          {row.giftCount.toLocaleString("en-US")} {row.giftCount === 1 ? "gift" : "gifts"}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${nothing ? PILL.app : PILL[row.delivery]}`}>
          {nothing ? "Nothing to state" : DELIVERY_LABEL[row.delivery]}
        </span>
      </div>
    </li>
  );
}

function ReviewSection({ model }: { model: StatementsModel }) {
  const { review, year } = model;
  const soFar = model.yearOver ? "" : " (so far)";
  const href = (q: { show?: ReviewFilter; page?: number; year?: number }) =>
    statementsHref(model.base, { year: q.year ?? year, show: q.show ?? model.filter, page: q.page, receipt: model.receiptQuery || null });
  const years = model.years.map((y) => ({ key: String(y), label: String(y), href: href({ year: y, show: "all" }), count: null, on: y === year }));

  let body: ReactNode;
  let action: ReactNode = null;
  if (review.state === "off") {
    body = (
      <p role="status" className="m-0 text-[14px] text-muted" data-testid="statements-switched-off">
        Statements are switched off for {model.communityName}. A copy of one receipt and the receipt wording keep working below.
      </p>
    );
  } else if (review.state === "no_access") {
    body = <NoAccess area="Year-end statements" access="statements" />;
  } else if (review.state === "error") {
    body = <ErrorBox message={review.message} retry={href({})} />;
  } else if (review.rows.length === 0) {
    body = (
      <p className="m-0 text-[14px] text-muted" data-testid="statements-review-empty">
        No household gave in {year}
        {model.yearOver ? "" : " so far"}, so there are no statements to review.
      </p>
    );
  } else {
    const s = review.summary;
    action = <ReviewAndSend year={year} yearOver={model.yearOver} summary={s} labels={model.labels} initiallyOpen={model.openReview} />;
    const shown = review.rows.filter((r) => matchesFilter(r, model.filter));
    const pages = Math.max(1, Math.ceil(shown.length / REVIEW_PAGE_SIZE));
    const page = Math.min(model.page, pages);
    const slice = shown.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE);
    const pager: Pager | null =
      shown.length > REVIEW_PAGE_SIZE
        ? {
            page,
            total: shown.length,
            prev: page > 1 ? href({ page: page - 1 }) : null,
            next: page < pages ? href({ page: page + 1 }) : null,
            label: `${((page - 1) * REVIEW_PAGE_SIZE + 1).toLocaleString("en-US")} to ${Math.min(page * REVIEW_PAGE_SIZE, shown.length).toLocaleString("en-US")} of ${shown.length.toLocaleString("en-US")}`,
          }
        : null;
    const chip = (key: ReviewFilter, label: string, count: number) => ({ key, label, href: href({ show: key, page: 1 }), count, on: model.filter === key });
    body = (
      <>
        <ul className="m-0 mb-3 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-4" data-testid="statements-review-summary">
          <li className="rounded-[12px] border border-line px-3 py-2">
            <span className="block text-[20px] font-bold tabular-nums text-ink">{s.households.toLocaleString("en-US")}</span>
            <span className="text-[13px] text-muted">households gave</span>
          </li>
          <li className="rounded-[12px] border border-line px-3 py-2">
            <span className="block text-[20px] font-bold tabular-nums text-ink">{s.total}</span>
            <span className="text-[13px] text-muted">given{soFar}</span>
          </li>
          <li className="col-span-2 rounded-[12px] border border-line px-3 py-2">
            <span className="block text-[15px] font-bold text-ink">{s.sentence}</span>
            <span className="text-[13px] text-muted">how the statements would reach them</span>
          </li>
        </ul>
        <ChipRow
          label="Show"
          chips={[
            chip("all", "All", s.households),
            chip("fix", "Needs a fix", s.needFix),
            chip("email", "By email", s.counts.email),
            chip("post", "By post", s.counts.post),
            chip("app", "In the app only", s.counts.app),
          ]}
        />
        {slice.length === 0 ? (
          <p className="m-0 py-3 text-[14px] text-muted">Nothing to show here.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {slice.map((r) => (
              <ReviewRow key={r.householdId} row={r} model={model} />
            ))}
          </ul>
        )}
        <PagerNav pager={pager} />
      </>
    );
  }

  return (
    <ListCard>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-display text-[22px] font-semibold text-ink">
            Year-end statements for {year}
            {soFar}
          </h2>
          <p className="m-0 mt-1 text-[13px] text-muted">
            January to December {year}. Totals leave out opening-balance lines and take off refunds, as every statement does; each statement
            is addressed to the household&apos;s adults.
          </p>
        </div>
        {action}
      </div>
      <ChipRow label="Year" chips={years} />
      {body}
    </ListCard>
  );
}

function ReceiptSection({ model }: { model: StatementsModel }) {
  const r = model.receipt;
  let body: ReactNode = null;
  if (r.state === "not_found" || r.state === "refused") {
    body = (
      <p role="alert" className="m-0 rounded-[12px] border border-[#f3d39b] bg-saffron-50 px-3 py-2 text-[14px] text-ink" data-testid="receipt-copy-problem">
        {r.message}
      </p>
    );
  } else if (r.state === "no_access") {
    body = <NoAccess area="Receipts" access="statements" />;
  } else if (r.state === "error") {
    body = <ErrorBox message={r.message} retry={statementsHref(model.base, { year: model.year, receipt: model.receiptQuery })} />;
  } else if (r.state === "ok") {
    const v = r.view;
    body = (
      <div className="flex flex-col gap-3" data-testid="receipt-copy">
        <FamilyCard family={v.family} labels={model.labels} />
        <ReceiptPreview lines={v.lines} />
        {v.copy.receiptNameHidden ? (
          <p className="m-0 text-[13px] text-muted">The name on this receipt is not shown: the copy is addressed to the household&apos;s adults.</p>
        ) : null}
        {v.printBlocked ? (
          <p role="status" className="m-0 rounded-[12px] border border-line bg-canvas px-3 py-2 text-[13px] text-ink-2" data-testid="receipt-print-off">
            {v.printBlocked}
          </p>
        ) : model.printBase ? (
          <div>
            <Link href={`${model.printBase}/${v.copy.paymentId}`} className={`${buttonClass("primary", "sm")} min-h-[44px]`} data-testid="receipt-print-open">
              Open the printable copy
            </Link>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <ListCard>
      <h2 className="m-0 font-display text-[22px] font-semibold text-ink">A copy of one receipt</h2>
      <p className="m-0 mt-1 text-[13px] text-muted">
        Find the payment by its receipt number, check the copy, then print it or save it as a PDF to hand over. Nothing is sent to the family
        from here.
      </p>
      <form method="get" action={model.base} className="my-3 flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="year" value={model.year} />
        <div className="min-w-0 flex-1">
          <label htmlFor="receipt-number" className="crm-label">
            Receipt number
          </label>
          <input id="receipt-number" name="receipt" defaultValue={model.receiptQuery} maxLength={64} className="crm-input min-h-[44px] w-full" autoComplete="off" />
        </div>
        <button type="submit" className={`${buttonClass("ghost")} min-h-[44px]`}>
          Find
        </button>
      </form>
      {body}
    </ListCard>
  );
}

export function StatementsView({ model, children }: { model: StatementsModel; children?: ReactNode }) {
  return (
    <>
      <header className="mb-4 flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">{model.title}</h1>
          <p className="m-0 text-[14px] text-muted">Year-end statements, a copy of one receipt, and the receipt wording.</p>
        </div>
        <GivingTabRow tabs={model.tabs} active="statements" />
      </header>
      <div className="flex flex-col gap-4">
        <ReviewSection model={model} />
        <ReceiptSection model={model} />
        {children}
      </div>
    </>
  );
}
