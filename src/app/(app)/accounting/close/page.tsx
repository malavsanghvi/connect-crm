import type { Metadata } from "next";
import { cookies } from "next/headers";

import { ActionForm } from "@/components/action-form";
import { BooksView, loadBooksExtras } from "@/components/books/books-page";
import type { CardLabels } from "@/components/household-card";
import { Card, ChipLinks, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { loadCloseState } from "@/lib/data/books-close";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime, todayInTz } from "@/lib/dates";
import { addMonths, firstOfMonth, longMonth } from "@/lib/giving";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
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
  const v2 = parseLook((await cookies()).get(LOOK_COOKIE)?.value) === "v2";
  const current = firstOfMonth(todayInTz(tz));
  const sp = await searchParams;
  const months = [0, -1, -2].map((n) => addMonths(current, n));
  const wanted = param(sp, "month");
  const month = months.find((m) => m.slice(0, 7) === wanted) ?? current;
  const label = longMonth(month);
  const shortLabel = label.split(" ")[0];
  const header = v2 ? (
    <PageHeader title="Books" description={`${label} close`} />
  ) : (
    <PageHeader title="Accounting" description={`${label} close · locking prevents changes; later corrections post as adjustments`} />
  );
  if (!canAccess(session, "close")) {
    return (
      <>
        {header}
        <NoAccess area="Month-end close" access="close" />
      </>
    );
  }
  const canClose = canAccess(session, "closeManage");
  // One reader for the screen, the lock and Niva: the checks the data proves are ticked (src/lib/books/close.ts).
  const state = await loadCloseState(session, month);
  const { items, locked } = state;
  const ready = items.every((i) => i.done);
  const closer = locked ? await userNames(db, center.id, [state.period?.closed_by]) : new Map();
  const closerName = state.period?.closed_by ? (closer.get(state.period.closed_by)?.name ?? null) : null;
  const monthChips = months.map((m) => ({ key: m, label: longMonth(m), href: m === current ? "/accounting/close" : `/accounting/close?month=${m.slice(0, 7)}` }));

  if (v2) {
    const rules = identifierRules(center.rules);
    const labels: CardLabels = { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel };
    const extras = await loadBooksExtras(session);
    return <BooksView state={state} months={monthChips} closerName={closerName} labels={labels} timeZone={tz} canClose={canClose} {...extras} />;
  }

  return (
    <>
      {header}
      <ChipLinks label="Month" active={month} items={monthChips} />
      {state.periodError ? (
        <QueryError what="the accounting period" error={state.periodError} retryHref="/accounting/close" />
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
                  {i.manual && canClose && !locked && i.sub !== "Mark done" && i.sub !== "Done" ? <span className="block text-[11px] text-faint">{i.sub}</span> : null}
                </span>
                {!i.manual || locked || !canClose ? (
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
              Locked {formatDateTime(state.period?.closed_at, tz)}
              {state.period?.closed_by ? ` by ${closerName ?? "a treasurer"}` : ""}.
            </p>
          ) : !canClose ? (
            <p className="mt-3 text-[13px] text-muted">Locking a month needs accounting.close.</p>
          ) : null}
        </Card>
      )}
    </>
  );
}
