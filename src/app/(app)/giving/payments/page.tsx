import type { Metadata } from "next";
import Link from "next/link";

import { RefundControls } from "@/components/two-person-controls";
import { Alert, Badge, Card, EmptyState, NoAccess, PageHeader, Pagination, QueryError, TableWrap, buttonClass } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import type { Enums } from "@/lib/database.types";
import { chunk } from "@/lib/data/fetch-all";
import type { HouseholdCardData } from "@/components/household-card";
import { householdCards, householdsById, userNames } from "@/lib/data/lookups";
import { formatDate, todayInTz } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { RecordPaymentForm } from "./record-payment-form";

export const metadata: Metadata = { title: "Payments" };

const PAGE_SIZE = 50;
type Method = Enums<"payment_method">;
const METHODS = Object.keys(PAYMENT_METHOD_LABEL) as Method[];

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Payments"
      description="Money received — online, offline (checks, cash, stock) and matched from the bank. Record an offline payment and see exactly which pledges it settles."
    />
  );
  if (!canAccess(session, "payments")) {
    return (
      <>
        {header}
        <NoAccess area="Payments" access="payments" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const rules = identifierRules(center.rules);
  const methodParam = param(sp, "method");
  const method = METHODS.find((m) => m === methodParam);
  const provider = param(sp, "provider");
  const fromDate = param(sp, "from");
  const toDate = param(sp, "to");
  const page = pageParam(sp);
  const retry = hrefWith("/giving/payments", sp, {});
  const canRecord = canAccess(session, "recordPayment");
  const canManage = canAccess(session, "givingManage");
  const canApprove = canAccess(session, "givingApprove");

  let query = db
    .from("payments")
    .select(
      "id, receipt_number, household_id, received_on, method, amount_cents, status, provider, check_number, envelope_number, memo, recorded_by, refunded_cents, refund_approved_by, refund_second_approver, deposit_bank_transaction_id",
      { count: "exact" },
    )
    .eq("center_id", center.id);
  if (method) query = query.eq("method", method);
  if (provider) query = query.eq("provider", provider);
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) query = query.gte("received_on", fromDate);
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) query = query.lte("received_on", toDate);
  const from = (page - 1) * PAGE_SIZE;
  const res = await query.order("received_on", { ascending: false }).order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];

  const allocated = new Map<string, number>();
  let allocError: unknown = null;
  for (const part of chunk(rows.map((r) => r.id))) {
    const a = await db.from("payment_allocations").select("payment_id, amount_cents").in("payment_id", part);
    if (a.error) {
      allocError = a.error;
      break;
    }
    for (const x of a.data ?? []) allocated.set(x.payment_id, (allocated.get(x.payment_id) ?? 0) + x.amount_cents);
  }
  const [households, people] = await Promise.all([
    householdsById(db, rows.map((r) => r.household_id)),
    userNames(db, center.id, [...rows.map((r) => r.recorded_by), ...rows.map((r) => r.refund_approved_by)]),
  ]);

  const prefillId = param(sp, "household");
  let prefill: HouseholdCardData | null = null;
  if (canRecord && isUuid(prefillId)) {
    const cards = await householdCards(db, [prefillId]);
    if (cards.error) console.error("[payments] household prefill failed; the form starts empty:", cards.error);
    prefill = cards.map.get(prefillId) ?? null;
  }

  return (
    <>
      {header}
      {canRecord ? (
        <Card
          title="Record an offline payment"
          description="Check, cash, ACH, Zelle or stock received outside the app. Find the household by any ID, check the card, then see which pledges the payment will close before you save."
          className="mb-6"
        >
          <RecordPaymentForm
            labels={{ orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel }}
            timeZone={tz}
            currency={center.currency}
            today={today}
            canAllocate={canAccess(session, "allocatePayment")}
            initialHousehold={prefill}
          />
        </Card>
      ) : null}

      {!can(session, ["giving.view", "giving.manage"]) ? (
        <div className="mb-4">
          <Alert tone="info">With the finance volunteer role the list shows only payments you recorded yourself.</Alert>
        </div>
      ) : null}

      <form method="get" action="/giving/payments" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="method" className="crm-label">
            Method
          </label>
          <select id="method" name="method" defaultValue={method ?? ""} className="crm-input min-w-44">
            <option value="">All methods</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="provider" className="crm-label">
            Source
          </label>
          <select id="provider" name="provider" defaultValue={provider ?? ""} className="crm-input min-w-44">
            <option value="">All sources</option>
            <option value="offline">Recorded offline</option>
            <option value="bank">Matched from the bank</option>
            <option value="stripe">Online (Stripe)</option>
          </select>
        </div>
        <div>
          <label htmlFor="from" className="crm-label">
            Received from
          </label>
          <input id="from" name="from" type="date" defaultValue={fromDate ?? ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor="to" className="crm-label">
            to
          </label>
          <input id="to" name="to" type="date" defaultValue={toDate ?? ""} className="crm-input" />
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Apply
        </button>
        {method || provider || fromDate || toDate ? (
          <Link href="/giving/payments" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      {res.error ? (
        <QueryError what="payments" error={res.error} retryHref={retry} />
      ) : (
        <Card padded={false}>
          {allocError || households.error ? (
            <div className="p-4">
              <QueryError what="allocations or household names" error={allocError ?? households.error} retryHref={retry} />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title="No payments match" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Received</th>
                    <th>Household</th>
                    <th>Method</th>
                    <th className="num">Amount</th>
                    <th>Applied</th>
                    <th>Status</th>
                    <th>Recorded by</th>
                    {canManage || canApprove ? <th>Refund</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const h = households.map.get(p.household_id);
                    const applied = allocated.get(p.id) ?? 0;
                    return (
                      <tr key={p.id}>
                        <td className="font-mono text-[0.8125rem]">{p.receipt_number ?? "—"}</td>
                        <td className="whitespace-nowrap">{formatDate(p.received_on, tz)}</td>
                        <td>
                          <Link href={`/households/${p.household_id}?tab=payments`} className="crm-link">
                            {h?.display_name ?? "Household"}
                          </Link>
                          <div className="font-mono text-xs text-muted">{h?.household_number ?? ""}</div>
                        </td>
                        <td>
                          {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                          {p.check_number ? <div className="text-xs text-muted">Check #{p.check_number}</div> : null}
                          {p.envelope_number ? <div className="text-xs text-muted">Envelope {p.envelope_number}</div> : null}
                          <div className="text-xs text-muted">{p.provider === "bank" ? "from bank" : (p.provider ?? "")}</div>
                        </td>
                        <td className="num">
                          {formatCents(p.amount_cents, center.currency)}
                          {p.refunded_cents > 0 ? <div className="text-xs text-danger">−{formatCents(p.refunded_cents, center.currency)}</div> : null}
                        </td>
                        <td className="text-[0.8125rem]">
                          {applied >= p.amount_cents ? (
                            <Badge tone="success">Fully applied</Badge>
                          ) : applied > 0 ? (
                            <span>
                              {formatCents(applied, center.currency)}
                              <span className="block text-muted">{formatCents(p.amount_cents - applied, center.currency)} unapplied</span>
                            </span>
                          ) : (
                            <span className="text-muted">Unapplied</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={p.status === "failed" || p.status === "voided" ? "danger" : p.status.includes("refund") ? "warning" : "success"}>
                            {p.status.replace(/_/g, " ")}
                          </Badge>
                          {p.provider === "offline" && (p.method === "check" || p.method === "cash") ? (
                            <div className="mt-1 text-xs text-muted">{p.deposit_bank_transaction_id ? "Deposited" : "Awaiting deposit"}</div>
                          ) : null}
                        </td>
                        <td className="text-[0.8125rem]">{p.recorded_by ? (people.get(p.recorded_by)?.name ?? "Staff") : "System"}</td>
                        {canManage || canApprove ? (
                          <td>
                            <RefundControls
                              paymentId={p.id}
                              provider={p.provider}
                              refundable={p.refunded_cents < p.amount_cents && !["failed", "voided", "authorized"].includes(p.status)}
                              requestedBy={p.refund_approved_by}
                              secondApprover={p.refund_second_approver}
                              requesterName={p.refund_approved_by ? (people.get(p.refund_approved_by)?.name ?? null) : null}
                              me={session.userId}
                              canManage={canManage}
                              canApprove={canApprove}
                            />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/giving/payments", sp, { page: n })} />
        </Card>
      )}
    </>
  );
}
