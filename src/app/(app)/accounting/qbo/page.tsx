import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import {
  Alert,
  Badge,
  Card,
  DefinitionList,
  EmptyState,
  NoAccess,
  PageHeader,
  Pagination,
  QueryError,
  KpiGrid,
  Stat,
  StatusText,
  TableWrap,
  Tabs,
  shortId,
} from "@/components/ui";
import { householdsById, userNames } from "@/lib/data/lookups";
import { formatDate, formatDateTime, formatMonth, startOfDayInTz, todayInTz } from "@/lib/dates";
import { classifyQboException, qboClassFor } from "@/lib/giving";
import { isPlainObject } from "@/lib/center-rules";
import { LEDGER_STATUS_TONE, LEDGER_TXN_LABEL, QBO_PURPOSES } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { approveMappingAction, retryAllFailedAction, retryPostingAction, saveMappingAction } from "./actions";

export const metadata: Metadata = { title: "QuickBooks sync" };

const PAGE_SIZE = 50;
const STATUSES = ["all", "queued", "posting", "posted", "failed", "skipped", "superseded"] as const;
type StatusFilter = (typeof STATUSES)[number];

export default async function QboPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader title="Accounting" description="QuickBooks Online is the book of record · cash basis · the platform posts every money event once" />
  );
  if (!canAccess(session, "qbo")) {
    return (
      <>
        {header}
        <NoAccess area="QuickBooks" access="qbo" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const tz = center.time_zone;
  const statusParam = param(sp, "status");
  const status: StatusFilter = STATUSES.find((s) => s === statusParam) ?? "all";
  const page = pageParam(sp);
  const retry = hrefWith("/accounting/qbo", sp, {});
  const canManage = canAccess(session, "qboManage");
  const canSeeLedger = canAccess(session, "qboLedger");
  const canSeeConnection = canAccess(session, "qboConnection");

  const connection = canSeeConnection
    ? await db
        .from("integration_connections")
        .select("status, display_name, external_account_id, settings, token_expires_at, connected_at, last_error, updated_at")
        .eq("center_id", center.id)
        .eq("provider", "quickbooks_online")
        .maybeSingle()
    : null;

  const [mappings, counts, postings] = canSeeLedger
    ? await Promise.all([
        db
          .from("qbo_account_mappings")
          .select("id, purpose, qbo_account_id, qbo_account_name, approved_by, approved_at")
          .eq("center_id", center.id),
        Promise.all(
          STATUSES.filter((s) => s !== "all").map(async (s) => {
            const r = await db.from("ledger_postings").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", s);
            return [s, r.error ? null : (r.count ?? 0)] as const;
          }),
        ),
        (() => {
          let q = db
            .from("ledger_postings")
            .select("id, created_at, txn_type, amount_cents, period_month, source_table, source_id, status, attempts, last_error, qbo_entity, qbo_ref, posted_at", {
              count: "exact",
            })
            .eq("center_id", center.id);
          if (status !== "all") q = q.eq("status", status);
          const from = (page - 1) * PAGE_SIZE;
          return q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
        })(),
      ])
    : [null, null, null];

  const countOf = new Map(counts ?? []);
  const rows = postings?.data ?? [];
  const mappingByPurpose = new Map((mappings?.data ?? []).map((m) => [m.purpose, m]));
  const extraPurposes = (mappings?.data ?? []).filter((m) => !QBO_PURPOSES.some((p) => p.purpose === m.purpose));
  const approvers = await userNames(db, center.id, (mappings?.data ?? []).map((m) => m.approved_by));

  // Describe each posting's source record.
  const paymentIds = rows.filter((r) => r.source_table === "payments").map((r) => r.source_id);
  const paymentsRes = paymentIds.length
    ? await db.from("payments").select("id, receipt_number, household_id, method").in("id", paymentIds)
    : { data: [] as { id: string; receipt_number: string | null; household_id: string; method: string }[], error: null };
  const paymentBy = new Map((paymentsRes.data ?? []).map((p) => [p.id, p]));
  const households = await householdsById(db, (paymentsRes.data ?? []).map((p) => p.household_id));

  const conn = connection?.data;
  const settings = conn && isPlainObject(conn.settings) ? conn.settings : {};
  const failedCount = countOf.get("failed") ?? 0;
  const pendingCount = (countOf.get("queued") ?? 0) + (countOf.get("posting") ?? 0);

  // KPI tiles, the exceptions list and payouts.
  const [postedToday, lastPosted, exceptions, payouts] = canSeeLedger
    ? await Promise.all([
        db
          .from("ledger_postings")
          .select("id", { count: "exact", head: true })
          .eq("center_id", center.id)
          .eq("status", "posted")
          .gte("posted_at", startOfDayInTz(todayInTz(tz), tz)),
        db.from("ledger_postings").select("posted_at").eq("center_id", center.id).not("posted_at", "is", null).order("posted_at", { ascending: false }).limit(1),
        db
          .from("ledger_postings")
          .select("id, txn_type, amount_cents, source_table, source_id, last_error, created_at")
          .eq("center_id", center.id)
          .eq("status", "failed")
          .order("created_at", { ascending: true })
          .limit(20),
        db
          .from("payouts")
          .select("id, provider, provider_ref, gross_cents, fee_cents, net_cents, arrives_on, matched, variance_cents")
          .eq("center_id", center.id)
          .order("arrives_on", { ascending: false, nullsFirst: false })
          .limit(10),
      ])
    : [null, null, null, null];
  const mappingState = QBO_PURPOSES.map((p) => {
    const m = mappingByPurpose.get(p.purpose);
    return { purpose: p.purpose, label: p.label, mapped: Boolean(m), approved: Boolean(m?.approved_at) };
  });
  const lastSync = lastPosted?.data?.[0]?.posted_at ?? null;

  return (
    <>
      {header}

      {canSeeLedger ? (
        <>
          <div className="mb-4">
            <KpiGrid cols={4}>
              <Stat label="Posted today" value={postedToday?.error ? "—" : (postedToday?.count ?? 0).toLocaleString()} hint="sales receipts, deposits, refunds" tone="success" />
              <Stat label="Pending" value={pendingCount.toLocaleString()} hint="waiting for the QuickBooks poster" tone="brown" />
              <Stat
                label="Exceptions"
                value={failedCount.toLocaleString()}
                hint={failedCount ? "need a person" : "all clear"}
                tone={failedCount ? "danger" : "success"}
                href={failedCount ? "/accounting/qbo?status=failed" : undefined}
              />
              <Stat
                label="Last sync"
                value={lastSync ? formatDateTime(lastSync, tz).replace(/^[A-Z][a-z]{2} \d+, \d{4}, /, "") : "—"}
                hint={
                  !canSeeConnection
                    ? lastSync
                      ? formatDate(lastSync, tz)
                      : "nothing posted yet"
                    : !conn
                      ? "not connected"
                      : conn.status === "connected"
                        ? `connection healthy${lastSync ? ` · ${formatDate(lastSync, tz)}` : ""}`
                        : `connection ${conn.status}`
                }
                tone="navy"
              />
            </KpiGrid>
          </div>
          <Card title="Exceptions" padded={false} className="mb-4">
            {exceptions?.error ? (
              <div className="p-2.5">
                <QueryError what="the exceptions" error={exceptions.error} retryHref={retry} />
              </div>
            ) : (exceptions?.data ?? []).length === 0 ? (
              <EmptyState title="All clear — nothing needs a person" />
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Transaction</th>
                      <th>Reason</th>
                      <th>Suggested fix</th>
                      {canManage ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {(exceptions?.data ?? []).map((e) => {
                      const x = classifyQboException(e.last_error, mappingState);
                      return (
                        <tr key={e.id}>
                          <td className="font-mono text-[0.8125rem]">QB-EX-{shortId(e.id).slice(0, 4).toUpperCase()}</td>
                          <td className="font-bold">
                            {LEDGER_TXN_LABEL[e.txn_type] ?? e.txn_type} · {formatCents(e.amount_cents, center.currency)}
                            <div className="text-xs font-normal text-muted">{formatDateTime(e.created_at, tz)}</div>
                          </td>
                          <td className="max-w-sm text-[13px]">{x.reason}</td>
                          <td className="max-w-sm text-[13px]">{x.fix}</td>
                          {canManage ? (
                            <td>
                              {x.applyPurpose ? (
                                <ActionForm action={retryPostingAction} submitLabel="Apply fix" pendingLabel="Reposting…" size="xs">
                                  <input type="hidden" name="id" value={e.id} />
                                </ActionForm>
                              ) : (
                                <span className="text-xs text-muted">Needs a person</span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Connection" className="xl:col-span-1">
          {!canSeeConnection ? (
            <p className="text-sm text-muted">Connection details need integrations.view.</p>
          ) : connection?.error ? (
            <QueryError what="the QuickBooks connection" error={connection.error} retryHref={retry} />
          ) : !conn ? (
            <Alert tone="warning" title="Not connected">
              QuickBooks has not been connected for this center. A center admin connects it (OAuth) from the integrations setup; nothing
              posts until then — postings wait in the queue.
            </Alert>
          ) : (
            <>
              <p className="mb-3">
                <Badge tone={conn.status === "connected" ? "success" : conn.status === "error" ? "danger" : "warning"}>{conn.status}</Badge>
              </p>
              <DefinitionList
                items={[
                  { label: "Company", value: conn.display_name ?? "—" },
                  { label: "Realm id", value: conn.external_account_id ?? "—" },
                  { label: "Connected", value: formatDateTime(conn.connected_at, tz) },
                  { label: "Token expires", value: formatDateTime(conn.token_expires_at, tz) },
                  { label: "Basis", value: typeof settings.basis === "string" ? settings.basis : "—" },
                  { label: "Posting", value: typeof settings.posting === "string" ? settings.posting.replace(/_/g, " ") : "—" },
                ]}
              />
              {conn.last_error ? (
                <div className="mt-3">
                  <Alert tone="danger" title="Last error">
                    {conn.last_error}
                  </Alert>
                </div>
              ) : null}
            </>
          )}
        </Card>

        <Card title="Posting queue at a glance" className="xl:col-span-2">
          {!canSeeLedger ? (
            <p className="text-sm text-muted">The posting queue needs giving.view or accounting.manage.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {STATUSES.filter((s) => s !== "all").map((s) => (
                <Link
                  key={s}
                  href={hrefWith("/accounting/qbo", {}, { status: s })}
                  className={`min-h-11 rounded-lg border px-3 py-2 hover:bg-subtle ${s === "failed" && (countOf.get(s) ?? 0) > 0 ? "border-danger/40" : "border-line"}`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{s === "failed" ? "Failed (exceptions)" : s}</p>
                  <p className="font-display text-xl font-semibold tabular-nums">{countOf.get(s) ?? "—"}</p>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {canSeeLedger ? (
        <>
          <Card
            title="Account mapping"
            description="Which QuickBooks account each kind of money posts to. The treasurer approves every mapping; a changed mapping needs approval again."
            padded={false}
            className="mb-6"
          >
            {mappings?.error ? (
              <div className="p-4">
                <QueryError what="account mappings" error={mappings.error} retryHref={retry} />
              </div>
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Purpose</th>
                      <th>QuickBooks account</th>
                      <th>Class</th>
                      <th>Approval</th>
                      {canManage ? <th>Change</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {[...QBO_PURPOSES, ...extraPurposes.map((m) => ({ purpose: m.purpose, label: m.purpose, hint: "" }))].map((p) => {
                      const m = mappingByPurpose.get(p.purpose);
                      return (
                        <tr key={p.purpose}>
                          <td>
                            <span className="font-semibold">{p.label}</span>
                            <div className="font-mono text-xs text-muted">{p.purpose}</div>
                            {p.hint ? <div className="text-xs text-muted">{p.hint}</div> : null}
                          </td>
                          <td>
                            {m ? (
                              <>
                                {m.qbo_account_name ?? "—"}
                                <div className="font-mono text-xs text-muted">id {m.qbo_account_id}</div>
                              </>
                            ) : (
                              <Badge tone="warning">Not mapped</Badge>
                            )}
                          </td>
                          <td>{qboClassFor(p.purpose)}</td>
                          <td>
                            {m?.approved_at ? (
                              <span className="text-sm">
                                <Badge tone="success">Approved</Badge>
                                <span className="block text-xs text-muted">
                                  {approvers.get(m.approved_by ?? "")?.name ?? "treasurer"}, {formatDate(m.approved_at, tz)}
                                </span>
                              </span>
                            ) : m ? (
                              canManage ? (
                                <ActionForm action={approveMappingAction} submitLabel="Approve" pendingLabel="Approving…" variant="success" size="sm">
                                  <input type="hidden" name="id" value={m.id} />
                                </ActionForm>
                              ) : (
                                <Badge tone="warning">Awaiting approval</Badge>
                              )
                            ) : (
                              "—"
                            )}
                          </td>
                          {canManage ? (
                            <td>
                              <details>
                                <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-navy">
                                  {m ? "Change…" : "Map…"}
                                </summary>
                                <ActionForm action={saveMappingAction} submitLabel="Save mapping" pendingLabel="Saving…" size="sm" className="mt-2 w-64">
                                  <input type="hidden" name="purpose" value={p.purpose} />
                                  <label htmlFor={`qa-${p.purpose}`} className="crm-label">
                                    QuickBooks account id
                                  </label>
                                  <input id={`qa-${p.purpose}`} name="qbo_account_id" defaultValue={m?.qbo_account_id ?? ""} required className="crm-input mb-2" />
                                  <label htmlFor={`qn-${p.purpose}`} className="crm-label">
                                    Account name
                                  </label>
                                  <input id={`qn-${p.purpose}`} name="qbo_account_name" defaultValue={m?.qbo_account_name ?? ""} className="crm-input mb-2" />
                                </ActionForm>
                              </details>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card
            title="Payouts"
            description="Card-processor payouts matched line for line to bank deposits (the bank's Card payouts view lists the deposit side)"
            padded={false}
            className="mb-6"
          >
            {payouts?.error ? (
              <div className="p-2.5">
                <QueryError what="payouts" error={payouts.error} retryHref={retry} />
              </div>
            ) : (payouts?.data ?? []).length === 0 ? (
              <EmptyState title="No payouts yet">Payouts arrive once the payment provider is connected.</EmptyState>
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Payout</th>
                      <th>Arrives</th>
                      <th className="num">Gross</th>
                      <th className="num">Fees</th>
                      <th className="num">Net</th>
                      <th>Bank deposit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payouts?.data ?? []).map((po) => (
                      <tr key={po.id}>
                        <td>
                          <span className="capitalize">{po.provider}</span> <span className="font-mono text-xs">{po.provider_ref}</span>
                        </td>
                        <td>{formatDate(po.arrives_on, tz)}</td>
                        <td className="num">{formatCents(po.gross_cents, center.currency)}</td>
                        <td className="num">{formatCents(po.fee_cents, center.currency)}</td>
                        <td className="num">{formatCents(po.net_cents, center.currency)}</td>
                        <td>
                          {po.matched ? (
                            <StatusText tone={po.variance_cents === 0 ? "ok" : "warn"}>
                              Matched{po.variance_cents !== 0 ? ` · variance ${formatCents(po.variance_cents, center.currency)}` : ""}
                            </StatusText>
                          ) : (
                            <StatusText tone="warn">Not matched yet</StatusText>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <h2 className="mb-3 font-display text-xl font-semibold text-navy">Posting queue</h2>
          <Tabs
            active={status}
            tabs={STATUSES.map((s) => ({
              key: s,
              label: s === "all" ? "All" : s === "failed" ? `Failed (${countOf.get("failed") ?? "?"})` : s[0].toUpperCase() + s.slice(1),
              href: hrefWith("/accounting/qbo", {}, { status: s === "all" ? undefined : s }),
            }))}
          />
          {status === "failed" && canManage && failedCount > 0 ? (
            <div className="mb-3">
              <ActionForm
                action={retryAllFailedAction}
                submitLabel={`Retry all ${failedCount} failed`}
                pendingLabel="Queuing…"
                variant="secondary"
                confirmMessage="Put every failed posting back in the queue? Fix the cause first (e.g. a missing mapping), or they will fail again."
              />
            </div>
          ) : null}
          {postings?.error ? (
            <QueryError what="the posting queue" error={postings.error} retryHref={retry} />
          ) : (
            <Card padded={false}>
              {rows.length === 0 ? (
                <EmptyState title={status === "failed" ? "No exceptions — nothing has failed" : "No postings here"} />
              ) : (
                <TableWrap>
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Queued</th>
                        <th>Type</th>
                        <th className="num">Amount</th>
                        <th>Period</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>QuickBooks</th>
                        {canManage ? <th /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const pay = r.source_table === "payments" ? paymentBy.get(r.source_id) : null;
                        return (
                          <tr key={r.id}>
                            <td className="whitespace-nowrap">{formatDateTime(r.created_at, tz)}</td>
                            <td>{LEDGER_TXN_LABEL[r.txn_type] ?? r.txn_type}</td>
                            <td className="num">{formatCents(r.amount_cents, center.currency)}</td>
                            <td className="whitespace-nowrap">{formatMonth(r.period_month)}</td>
                            <td className="text-[0.8125rem]">
                              {pay ? (
                                <>
                                  Receipt <span className="font-mono">{pay.receipt_number ?? "—"}</span>
                                  <div>
                                    <Link href={`/households/${pay.household_id}?tab=payments`} className="crm-link">
                                      {households.map.get(pay.household_id)?.display_name ?? "household"}
                                    </Link>
                                  </div>
                                </>
                              ) : (
                                <>
                                  {r.source_table.replace(/_/g, " ")} <span className="font-mono text-xs">{shortId(r.source_id)}</span>
                                </>
                              )}
                            </td>
                            <td>
                              <Badge tone={LEDGER_STATUS_TONE[r.status as keyof typeof LEDGER_STATUS_TONE] ?? "neutral"}>{r.status}</Badge>
                              {r.attempts > 0 ? <div className="text-xs text-muted">{r.attempts} attempt{r.attempts === 1 ? "" : "s"}</div> : null}
                              {r.last_error ? <div className="mt-1 max-w-xs text-xs text-danger">{r.last_error}</div> : null}
                            </td>
                            <td className="text-[0.8125rem]">
                              {r.qbo_ref ? (
                                <>
                                  {r.qbo_entity ?? "Entry"} <span className="font-mono">{r.qbo_ref}</span>
                                  <div className="text-xs text-muted">{formatDateTime(r.posted_at, tz)}</div>
                                </>
                              ) : (
                                <span className="text-muted">Not posted</span>
                              )}
                            </td>
                            {canManage ? (
                              <td>
                                {r.status === "failed" ? (
                                  <ActionForm action={retryPostingAction} submitLabel="Retry" pendingLabel="Queuing…" variant="secondary" size="sm">
                                    <input type="hidden" name="id" value={r.id} />
                                  </ActionForm>
                                ) : null}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <Pagination page={page} pageSize={PAGE_SIZE} total={postings?.count ?? null} hrefFor={(n) => hrefWith("/accounting/qbo", sp, { page: n })} />
            </Card>
          )}
        </>
      ) : null}
    </>
  );
}
