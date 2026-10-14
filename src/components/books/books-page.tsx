import Link from "next/link";

import { setCloseItemAction } from "@/app/(app)/accounting/close/actions";
import { LockMonthButton } from "@/app/(app)/accounting/close/lock-button";
import { ActionForm } from "@/components/action-form";
import { DonorMatchApprove } from "@/components/books/donor-match-act";
import { FamilyCard } from "@/components/giving-actions/sheet";
import type { CardLabels } from "@/components/household-card";
import { Card, ChipLinks, PageHeader, QueryError, buttonClass } from "@/components/ui";
import type { CloseItem } from "@/lib/books/close";
import type { CloseState } from "@/lib/data/books-close";
import { loadDonorMatches, type DonorMatchesIn } from "@/lib/data/books-donors";
import { formatDateTime } from "@/lib/dates";
import { familyRef } from "@/lib/giving-today/queue";
import type { Part } from "@/lib/giving-workspace/view";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

// Giving › Books in the New look (docs/GIVING_REDESIGN.md section 4, owner decision 2): month-end close first, with the checks
// the data proves ticked; then QuickBooks (sync and exceptions, setup) and donor matching, where a match is approved in its row
// next to the household card. Every button is an existing action: Mark done, Lock (fresh 2FA), Approve (a reason, audited).

/** Donor matches approved on this page; the rest wait in Donor matching. */
const DONOR_ROWS = 5;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export type BooksViewProps = {
  state: CloseState;
  months: { key: string; label: string; href: string }[];
  closerName: string | null;
  labels: CardLabels;
  timeZone: string;
  canClose: boolean;
  /** null: the person cannot open QuickBooks sync. */
  qbo: QuickBooksGlance | null;
  /** null: the person cannot see donor matching. */
  donors: Part<DonorMatchesIn> | null;
};

/** What Books reads besides the close itself, with the person's own access. */
export async function loadBooksExtras(session: CrmSession): Promise<Pick<BooksViewProps, "qbo" | "donors">> {
  const [qbo, donors] = await Promise.all([
    canAccess(session, "qbo") ? loadQuickBooks(session) : Promise.resolve(null),
    canAccess(session, "qboMatch") ? loadDonorMatches(session, DONOR_ROWS) : Promise.resolve(null),
  ]);
  return { qbo, donors };
}

export function BooksView({ state, months, closerName, labels, timeZone: tz, canClose, qbo, donors }: BooksViewProps) {
  const items = state.items;
  const doneCount = items.filter((i) => i.done).length;
  const ready = items.every((i) => i.done);
  const shortLabel = state.label.split(" ")[0];

  return (
    <>
      <PageHeader title="Books" description={`${state.label} close · the checks Weaver can prove tick themselves; locking prevents changes and later corrections post as adjustments`} />
      <ChipLinks label="Month" active={state.month} items={months} />
      {state.periodError ? (
        <QueryError what="the accounting period" error={state.periodError} retryHref="/accounting/close" />
      ) : (
        <Card
          title={`${state.label} close: ${doneCount} of ${plural(items.length, "check")}`}
          actions={canClose ? <LockMonthButton month={state.month} monthLabel={state.label} shortLabel={shortLabel} ready={ready} locked={state.locked} /> : null}
        >
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {items.map((i) => (
              <CheckLine key={i.key} item={i} month={state.month} canMark={canClose && !state.locked} />
            ))}
          </ul>
          {state.locked ? (
            <p className="mt-3 text-[13px] text-success">
              Locked {formatDateTime(state.period?.closed_at, tz)}
              {state.period?.closed_by ? ` by ${closerName ?? "a treasurer"}` : ""}.
            </p>
          ) : !canClose ? (
            <p className="mt-3 text-[13px] text-muted">A person with accounting.close marks the checks and locks the month.</p>
          ) : (
            <p className="mt-3 text-[13px] text-muted">The ticked checks were proven from your records; mark the others once they are done, then lock {state.label}.</p>
          )}
        </Card>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {qbo ? <QuickBooksCard q={qbo} timeZone={tz} /> : null}
        {donors ? (
          <Card id="donor-matching" title="Donor matching" description="QuickBooks customers with a suggested household. Nothing is approved on its own.">
            {donors.state === "error" ? (
              <QueryError what="the QuickBooks donor matches" error={{ message: donors.error }} retryHref="/accounting/close" />
            ) : donors.state !== "ok" ? null : donors.data.customers === 0 ? (
              <p className="m-0 text-[13.5px] text-muted">No QuickBooks customer is waiting for a household.</p>
            ) : (
              <>
                <p className="m-0 text-[13.5px] text-ink">
                  {plural(donors.data.customers, "QuickBooks customer")} {donors.data.customers === 1 ? "has" : "have"} a suggested household
                  {donors.data.several > 0 ? `; ${plural(donors.data.several, "customer")} ${donors.data.several === 1 ? "has" : "have"} more than one, chosen in Donor matching` : ""}.
                </p>
                {donors.data.canApprove ? (
                  <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
                    {donors.data.shown.map((m) => (
                      <li key={m.matchId} className="rounded-[12px] border border-line bg-ground px-3 py-2.5">
                        <p className="m-0 text-[13.5px] font-bold text-ink">QuickBooks: “{m.qboName}”</p>
                        <p className="m-0 mb-2 text-[12.5px] text-muted">{m.how}</p>
                        <FamilyCard family={m.family} labels={labels} />
                        <DonorMatchApprove matchId={m.matchId} label={`Approve: “${m.qboName}” is the ${familyRef(m.family)}`} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 mt-2 text-[13px] text-muted">A person with accounting.manage approves them, each next to its household card.</p>
                )}
                <Link href="/accounting/qbo/matching" className={`${buttonClass("ghost", "sm")} mt-3`}>
                  Review all in Donor matching
                </Link>
              </>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}

function CheckLine({ item, month, canMark }: { item: CloseItem; month: string; canMark: boolean }) {
  return (
    <li className="flex flex-wrap items-start gap-2 rounded-[10px] border border-line bg-white px-2.5 py-2 text-[13.5px]">
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border-2 border-success text-xs font-bold text-white ${item.done ? "bg-success" : "bg-white"}`}
      >
        {item.done ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`font-bold ${item.done ? "text-success" : "text-ink"}`}>{item.label}</span>
        <span className="sr-only">{item.done ? " (done)" : " (still to do)"}</span>
        {item.sub && item.sub !== "Mark done" && item.sub !== "Done" ? <span className="block text-[12.5px] text-muted">{item.sub}</span> : null}
      </span>
      {item.manual && canMark ? (
        <ActionForm action={setCloseItemAction} submitLabel={item.done ? "Undo" : "Mark done"} pendingLabel="Saving…" variant={item.done ? "plain" : "ghost"} size="xs">
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="done" value={item.done ? "false" : "true"} />
        </ActionForm>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------- QuickBooks at a glance

export type QuickBooksGlance = {
  /** null: the person cannot see the connection (integrations.view). */
  connection: { connected: boolean; name: string | null } | null;
  /** null: the person cannot see the postings (giving.view or accounting.manage). */
  ledger: { failed: number | null; waiting: number | null; lastPostedAt: string | null } | null;
};

async function loadQuickBooks(session: CrmSession): Promise<QuickBooksGlance> {
  const { db, center } = session;
  const count = async (statuses: string[]) => {
    const r = await db.from("ledger_postings").select("id", { count: "exact", head: true }).eq("center_id", center.id).in("status", statuses);
    if (r.error) console.error("[books] QuickBooks posting count failed:", r.error);
    return r.error ? null : (r.count ?? 0);
  };
  const [connection, failed, waiting, last] = await Promise.all([
    canAccess(session, "qboConnection")
      ? db.from("integration_connections").select("status, display_name").eq("center_id", center.id).in("provider", ["quickbooks_online", "intuit_sandbox"]).limit(2)
      : null,
    canAccess(session, "qboLedger") ? count(["failed"]) : null,
    canAccess(session, "qboLedger") ? count(["queued", "posting"]) : null,
    canAccess(session, "qboLedger")
      ? db.from("ledger_postings").select("posted_at").eq("center_id", center.id).not("posted_at", "is", null).order("posted_at", { ascending: false }).limit(1)
      : null,
  ]);
  if (connection?.error) console.error("[books] QuickBooks connection read failed:", connection.error);
  const live = connection && !connection.error ? (connection.data ?? []).find((c) => c.status !== "disconnected") : undefined;
  return {
    connection: connection && !connection.error ? { connected: Boolean(live), name: live?.display_name ?? null } : null,
    ledger: canAccess(session, "qboLedger") ? { failed, waiting, lastPostedAt: last && !last.error ? (last.data?.[0]?.posted_at ?? null) : null } : null,
  };
}

function QuickBooksCard({ q, timeZone: tz }: { q: QuickBooksGlance; timeZone: string }) {
  const parts: string[] = [];
  if (q.connection) parts.push(q.connection.connected ? `Connected${q.connection.name ? ` to ${q.connection.name}` : ""}` : "Not connected");
  if (q.ledger) {
    parts.push(q.ledger.lastPostedAt ? `last posting ${formatDateTime(q.ledger.lastPostedAt, tz)}` : "nothing posted yet");
    parts.push(q.ledger.failed === null ? "could not count the exceptions" : plural(q.ledger.failed, "exception"));
    parts.push(q.ledger.waiting === null ? "could not count what waits to post" : `${q.ledger.waiting.toLocaleString("en-US")} waiting to post`);
  }
  return (
    <Card title="QuickBooks" description="The book of record. Weaver posts every money event once.">
      <p className="m-0 text-[13.5px] text-ink">{parts.length ? `${parts.join(" · ")}.` : "You can open QuickBooks sync and setup."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={q.ledger?.failed ? "/accounting/qbo?status=failed" : "/accounting/qbo"} className={buttonClass(q.ledger?.failed ? "primary" : "ghost", "sm")}>
          {q.ledger?.failed ? "Fix the exceptions" : "Sync and exceptions"}
        </Link>
        <Link href="/accounting/qbo/mapping" className={buttonClass("ghost", "sm")}>
          Account mapping
        </Link>
        <Link href="/accounting/qbo/setup" className={buttonClass("ghost", "sm")}>
          QuickBooks setup
        </Link>
      </div>
    </Card>
  );
}
