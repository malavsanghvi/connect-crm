// qbo.pull_customers_history: copy an organization's QuickBooks customers and
// their history (sales receipts, payments, invoices open and paid, credit memos,
// refund receipts) into app.qbo_customers / app.qbo_transactions, then rebuild
// the donor-match suggestions and queue the history bring-in for customers
// already approved (o-qbo-match, ONBOARDING_WAVE_B).
//
// Queued: when QuickBooks connects (trigger on integration_connections), by the
// "Pull now" button (app.qbo_request_pull), and daily: the worker schedules one
// platform-wide job (center_id NULL) that queues a pull per connected center.
//
// Payload: { full?: boolean }. A pull within 29 days of the last one uses
// QuickBooks' change data capture (CDC keeps 30 days); otherwise, or with
// full: true, everything in the history window (settings.history_years,
// default 7) plus every invoice still open, whatever its date, is read.
//
// No platform env var is needed: the organization's access token is in the
// vault (o-quickbooks stores and refreshes it). INTUIT_API_BASE overrides the
// Intuit host (tests use a local mock).

import { PermanentError } from "../errors";
import {
  apiBase,
  batches,
  createQboClient,
  mapCustomer,
  mapTransaction,
  qLiteral,
  TXN_TYPES,
  windowStart,
  type CustomerRow,
  type TransactionRow,
} from "../qbo_match/qbo";
import { providerStatus } from "../config";
import type { Job, JobContext } from "../types";

export const kind = "qbo.pull_customers_history";

export type Connection = {
  connection_id: string;
  provider: string;
  status: string;
  realm_id: string | null;
  mode: string;
  history_years: number;
  last_pull_at: string | null;
  accounting_on: boolean;
};

/** Whether this pull can use CDC: a last pull under 29 days ago, and not forced full. */
export function shouldUseCdc(lastPullAt: string | null, full: boolean, now = new Date()): boolean {
  if (full || !lastPullAt) return false;
  const t = Date.parse(lastPullAt);
  return Number.isFinite(t) && now.getTime() - t < 29 * 24 * 3600 * 1000;
}

async function one<T>(ctx: JobContext, sql: string, params: unknown[]): Promise<T | null> {
  const rows = await ctx.db.query<{ r: T | null }>(sql, params);
  return (rows[0]?.r ?? null) as T | null;
}

export async function run(job: Job, ctx: JobContext) {
  // The daily platform-wide job: queue one pull per connected center.
  if (!job.center_id) {
    const n = await one<number>(ctx, "select app.qbo_worker_daily_pulls() as r", []);
    ctx.log.info("queued the daily QuickBooks customer pulls", { centers: n ?? 0 });
    return { queued: n ?? 0 };
  }
  const center = job.center_id;
  const conn = await one<Connection>(ctx, "select app.qbo_worker_connection($1) as r", [center]);
  if (!conn) throw new PermanentError("QuickBooks is not connected for this organization. Connect QuickBooks first.");
  if (!conn.accounting_on) throw new PermanentError("Accounting & QuickBooks is switched off for this organization, so nothing was pulled.");
  if (!["connected", "expiring"].includes(conn.status)) {
    throw new PermanentError(`The QuickBooks connection is ${conn.status}. Connect QuickBooks again, then pull.`);
  }
  if (!conn.realm_id) throw new PermanentError("The QuickBooks connection has no company ID. Connect QuickBooks again.");
  const token = await ctx.secret(conn.connection_id, "access_token");
  if (!token) throw new PermanentError("No QuickBooks access token is stored. Connect QuickBooks again.");

  const client = createQboClient(ctx.http, apiBase(ctx.env, conn.mode), conn.realm_id, token);
  const full = (job.payload as { full?: unknown } | null)?.full === true;
  const cdc = shouldUseCdc(conn.last_pull_at, full);
  const since = windowStart(conn.history_years || 7);

  let customers: CustomerRow[] = [];
  const txns: TransactionRow[] = [];
  let deleted = 0;
  // A refused token (QboAuthError) or a 5xx is retried by the queue; the token refresh renews it meanwhile.
  {
    if (cdc) {
      const changedSince = new Date(Date.parse(conn.last_pull_at!) - 5 * 60 * 1000).toISOString();
      const changes = await client.cdc(["Customer", ...TXN_TYPES], changedSince);
      const live = (rows: Record<string, unknown>[] | undefined) =>
        (rows ?? []).filter((r) => {
          const gone = r.status === "Deleted";
          if (gone) deleted++;
          return !gone;
        });
      customers = live(changes.Customer).map(mapCustomer).filter((c): c is CustomerRow => c !== null);
      for (const t of TXN_TYPES) {
        for (const r of live(changes[t])) {
          const m = mapTransaction(t, r);
          if (m && (m.txn_date >= since || (t === "Invoice" && m.open_balance_cents > 0))) txns.push(m);
        }
      }
    } else {
      customers = (await client.queryAll("Customer", "Active IN (true, false)")).map(mapCustomer).filter((c): c is CustomerRow => c !== null);
      for (const t of TXN_TYPES) {
        const rows = await client.queryAll(t, `TxnDate >= ${qLiteral(since)}`);
        if (t === "Invoice") rows.push(...(await client.queryAll("Invoice", `Balance > '0' AND TxnDate < ${qLiteral(since)}`)));
        const seen = new Set<string>();
        for (const r of rows) {
          const m = mapTransaction(t, r);
          if (m && !seen.has(m.qbo_id)) {
            seen.add(m.qbo_id);
            txns.push(m);
          }
        }
      }
    }
  }

  let storedCustomers = 0;
  for (const b of batches(customers)) {
    storedCustomers += (await one<number>(ctx, "select app.qbo_worker_store_customers($1, $2::jsonb) as r", [center, JSON.stringify(b)])) ?? 0;
  }
  let storedTxns = 0;
  for (const b of batches(txns)) {
    storedTxns += (await one<number>(ctx, "select app.qbo_worker_store_transactions($1, $2::jsonb) as r", [center, JSON.stringify(b)])) ?? 0;
  }
  const stats = {
    mode: cdc ? "changes" : "full",
    history_from: since,
    customers_read: customers.length,
    customers_changed: storedCustomers,
    transactions_read: txns.length,
    transactions_changed: storedTxns,
    deleted_in_quickbooks: deleted,
  };
  const finish = await one<Record<string, unknown>>(ctx, "select app.qbo_worker_finish_pull($1, $2::jsonb) as r", [center, JSON.stringify(stats)]);

  // The ambiguous remainder goes to the AI job, when the AI is configured here.
  let aiJob: string | null = null;
  const ambiguous = Number(finish?.ambiguous ?? 0) + Number(finish?.no_candidate ?? 0);
  if (ambiguous > 0 && providerStatus(ctx.env, "anthropic").configured) {
    aiJob = await one<string>(ctx, "select app.enqueue_job($1, 'qbo.match_suggest_ai', '{}'::jsonb, now(), 3)::text as r", [center]);
  }
  ctx.log.info("QuickBooks customers pulled", { ...stats, ai_job: aiJob });
  return { ...stats, matching: finish, ai_job: aiJob };
}
