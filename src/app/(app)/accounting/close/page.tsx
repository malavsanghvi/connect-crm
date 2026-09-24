import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Card, ChipLinks, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime, todayInTz } from "@/lib/dates";
import { addMonths, closeChecklist, firstOfMonth, longMonth } from "@/lib/giving";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { setCloseItemAction } from "./actions";
import { LockMonthButton } from "./lock-button";

export const metadata: Metadata = { title: "Month-end close" };

export default async function ClosePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const { center, db } = session;
  const tz = center.time_zone;
  const current = firstOfMonth(todayInTz(tz));
  const sp = await searchParams;
  const months = [0, -1, -2].map((n) => addMonths(current, n));
  const wanted = param(sp, "month");
  const month = months.find((m) => m.slice(0, 7) === wanted) ?? current;
  const label = longMonth(month);
  const shortLabel = label.split(" ")[0];
  const header = <PageHeader title="Accounting" description={`${label} close · locking prevents changes; later corrections post as adjustments`} />;
  if (!canAccess(session, "close")) {
    return (
      <>
        {header}
        <NoAccess area="Month-end close" access="close" />
      </>
    );
  }
  const canClose = canAccess(session, "closeManage");
  const [period, ex] = await Promise.all([
    db.from("accounting_periods").select("status, checklist, closed_by, closed_at").eq("center_id", center.id).eq("period_month", month).maybeSingle(),
    db.from("ledger_postings").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "failed").lte("period_month", month),
  ]);
  if (ex.error) console.error("[close] exception count failed:", ex.error);
  const items = closeChecklist(period.data?.checklist ?? {}, ex.error ? null : (ex.count ?? 0));
  const ready = items.every((i) => i.done);
  const locked = period.data?.status === "closed";
  const closer = locked ? await userNames(db, center.id, [period.data?.closed_by]) : new Map();

  return (
    <>
      {header}
      <ChipLinks
        label="Month"
        active={month}
        items={months.map((m) => ({ key: m, label: longMonth(m), href: m === current ? "/accounting/close" : `/accounting/close?month=${m.slice(0, 7)}` }))}
      />
      {period.error ? (
        <QueryError what="the accounting period" error={period.error} retryHref="/accounting/close" />
      ) : (
        <Card
          title="Close checklist"
          actions={canClose ? <LockMonthButton month={month} monthLabel={label} shortLabel={shortLabel} ready={ready} locked={locked} /> : null}
        >
          <div className="flex flex-col gap-1 rounded-xl bg-ground px-3 py-2.5">
            <p className="text-xs font-extrabold tracking-[0.04em] text-navy">{label.toUpperCase()}</p>
            {items.map((i) => (
              <div key={i.key} className="flex min-h-9 items-center gap-2 py-1 text-[13px] text-ink">
                <span
                  aria-hidden
                  className={`flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border-2 border-success text-xs font-extrabold text-white ${i.done ? "bg-success" : "bg-white"}`}
                >
                  {i.done ? "✓" : ""}
                </span>
                <span className="flex-1">
                  {i.label}
                  <span className="sr-only">{i.done ? " (done)" : " (not done)"}</span>
                </span>
                {i.key === "exceptions_cleared" || locked || !canClose ? (
                  <span className="text-[11px] text-faint">{i.sub}</span>
                ) : (
                  <ActionForm action={setCloseItemAction} submitLabel={i.done ? "Undo" : "Mark done"} pendingLabel="Saving…" variant={i.done ? "plain" : "ghost"} size="xs">
                    <input type="hidden" name="month" value={month} />
                    <input type="hidden" name="key" value={i.key} />
                    <input type="hidden" name="done" value={i.done ? "false" : "true"} />
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
          {locked ? (
            <p className="mt-3 text-[13px] text-success">
              Locked {formatDateTime(period.data?.closed_at, tz)}
              {period.data?.closed_by ? ` by ${closer.get(period.data.closed_by)?.name ?? "a treasurer"}` : ""}.
            </p>
          ) : !canClose ? (
            <p className="mt-3 text-[13px] text-muted">Locking a month needs accounting.close.</p>
          ) : null}
        </Card>
      )}
    </>
  );
}
