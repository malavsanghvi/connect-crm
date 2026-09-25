import { CustomDetailsCell } from "@/components/custom-details-cell";
import { Alert, Badge, Card, EmptyState, NoAccess, QueryError, TableWrap } from "@/components/ui";
import { loadCustomFieldDefs, withCustomValues } from "@/lib/data/custom-fields";
import { chunk } from "@/lib/data/fetch-all";
import { formatDate, todayInTz } from "@/lib/dates";
import { givingHistoryTotals, OPENING_BALANCE_HINT, OPENING_BALANCE_LABEL, parseYearEndStatement, type YearEndStatement } from "@/lib/giving";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents, sumCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

export async function PaymentsTab({ session, householdId }: { session: CrmSession; householdId: string }) {
  if (!canAccess(session, "payments")) return <NoAccess area="Payments" access="payments" />;
  const { db, center } = session;
  const tz = center.time_zone;
  const retry = `/households/${householdId}?tab=payments`;

  const pRes = await db
    .from("payments")
    .select("id, receipt_number, received_on, method, amount_cents, status, provider, check_number, envelope_number, memo, refunded_cents, deposit_bank_transaction_id, is_historical, is_opening_balance, crm_external_id, custom")
    .eq("household_id", householdId)
    .order("received_on", { ascending: false })
    .limit(500);
  if (pRes.error) return <QueryError what="payments" error={pRes.error} retryHref={retry} />;
  const defs = await loadCustomFieldDefs(db, center.id, "payments", true);
  // Staff-only custom values are kept apart from the row (0401); read them for "More details".
  const withCustom = defs.defs.length ? await withCustomValues(db, "payments", pRes.data ?? []) : { rows: pRes.data ?? [], error: null };
  if (withCustom.error) return <QueryError what="the payments' custom details" error={withCustom.error} retryHref={retry} />;
  const payments = withCustom.rows;
  const editCustom = canAccess(session, "givingManage");

  const allocations: { payment_id: string; pledge_id: string; amount_cents: number }[] = [];
  let allocError: unknown = null;
  for (const part of chunk(payments.map((p) => p.id))) {
    const r = await db.from("payment_allocations").select("payment_id, pledge_id, amount_cents").in("payment_id", part);
    if (r.error) {
      allocError = r.error;
      break;
    }
    allocations.push(...(r.data ?? []));
  }
  const pledgeNumbers = new Map<string, string | null>();
  for (const part of chunk([...new Set(allocations.map((a) => a.pledge_id))])) {
    const r = await db.from("pledges").select("id, pledge_number").in("id", part);
    if (r.error) {
      allocError = r.error;
      break;
    }
    for (const p of r.data ?? []) pledgeNumbers.set(p.id, p.pledge_number);
  }
  const byPayment = new Map<string, typeof allocations>();
  for (const a of allocations) byPayment.set(a.payment_id, [...(byPayment.get(a.payment_id) ?? []), a]);

  // Year-end statements (0522): the last three tax years with gifts, without opening-balance lines.
  const totals = givingHistoryTotals(payments);
  const thisYear = Number(todayInTz(tz).slice(0, 4));
  const years = [...new Set(payments.filter((p) => !p.is_opening_balance).map((p) => Number(p.received_on.slice(0, 4))))]
    .filter((y) => y <= thisYear)
    .sort((a, b) => b - a)
    .slice(0, 3);
  const statements: YearEndStatement[] = [];
  let statementError: unknown = null;
  for (const y of years) {
    const r = await db.rpc("year_end_statement", { p_household: householdId, p_year: y });
    if (r.error) {
      statementError = r.error;
      break;
    }
    const st = parseYearEndStatement(r.data);
    if (!st) {
      console.error(`[household] year_end_statement(${householdId}, ${y}) returned an unexpected shape`);
      statementError = new Error("The year-end statement came back in an unexpected shape.");
      break;
    }
    statements.push(st);
  }

  return (
    <Card
      padded={false}
      title="Payments"
      description={`${payments.length} payments · ${formatCents(totals.receivedCents, center.currency)} received${
        totals.openingCount > 0
          ? ` · ${formatCents(totals.openingCents, center.currency)} opening balance${totals.openingCount === 1 ? "" : "s"} (paid before the imported history)`
          : ""
      }`}
    >
      {!can(session, ["giving.view", "giving.manage"]) ? (
        <div className="p-4">
          <Alert tone="info">With the finance volunteer role you see only the payments you recorded yourself.</Alert>
        </div>
      ) : null}
      {allocError ? (
        <div className="p-4">
          <QueryError what="allocations" error={allocError} retryHref={retry} />
        </div>
      ) : null}
      {statementError ? (
        <div className="p-4">
          <QueryError what="the year-end statement totals" error={statementError} retryHref={retry} />
        </div>
      ) : statements.length > 0 ? (
        <div className="border-b border-line p-4" data-testid="year-end-statements">
          <p className="mb-2 text-sm font-semibold">Year-end statements</p>
          <ul className="space-y-1 text-sm">
            {statements.map((st) => (
              <li key={st.tax_year}>
                <span className="font-semibold">{st.tax_year}</span>: {formatCents(st.total_cents, center.currency)} in {st.gift_count} gift
                {st.gift_count === 1 ? "" : "s"}
                {st.left_out.opening_balance_count > 0 ? (
                  <span className="text-muted">
                    {" "}
                    · {formatCents(st.left_out.opening_balance_cents, center.currency)} opening balance left out
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {statements.some((st) => st.left_out.opening_balance_count > 0) ? (
            <p className="mt-2 text-xs text-muted">{OPENING_BALANCE_HINT}</p>
          ) : null}
        </div>
      ) : null}
      {payments.length === 0 ? (
        <EmptyState title="No payments" />
      ) : (
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Received</th>
                <th>Method</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Applied to pledges</th>
                <th>Memo</th>
                {defs.defs.length ? <th>More details</th> : null}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const allocs = byPayment.get(p.id) ?? [];
                const unallocated = p.amount_cents - sumCents(allocs.map((a) => a.amount_cents));
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-[0.8125rem]">
                      {p.receipt_number ?? "—"}
                      {p.is_opening_balance ? (
                        <div className="font-sans">
                          <Badge tone="purple">{OPENING_BALANCE_LABEL}</Badge>
                          <div className="text-xs text-muted">Not a gift receipt · left out of year-end statements</div>
                        </div>
                      ) : null}
                    </td>
                    <td>{formatDate(p.received_on, tz)}</td>
                    <td>
                      {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                      {p.check_number ? <div className="text-xs text-muted">Check #{p.check_number}</div> : null}
                      {p.envelope_number ? <div className="text-xs text-muted">Envelope {p.envelope_number}</div> : null}
                      <div className="text-xs text-muted">via {p.provider ?? "—"}</div>
                      {p.is_historical ? (
                        <div className="text-xs text-muted" title="Imported money history: already in the books, never posted to QuickBooks">
                          History{p.crm_external_id ? ` · ${p.crm_external_id}` : ""} · not posted to QuickBooks
                        </div>
                      ) : null}
                    </td>
                    <td className="num">
                      {formatCents(p.amount_cents, center.currency)}
                      {p.refunded_cents > 0 ? (
                        <div className="text-xs text-danger">−{formatCents(p.refunded_cents, center.currency)} refunded</div>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={p.status === "settled" || p.status === "captured" ? "success" : p.status === "failed" ? "danger" : "neutral"}>
                        {p.status.replace(/_/g, " ")}
                      </Badge>
                      {p.provider === "offline" && (p.method === "check" || p.method === "cash") ? (
                        <div className="mt-1 text-xs text-muted">{p.deposit_bank_transaction_id ? "Deposited" : "Not yet deposited"}</div>
                      ) : null}
                    </td>
                    <td className="text-[0.8125rem]">
                      {allocs.length === 0 ? <span className="text-muted">Not applied to a pledge</span> : null}
                      {allocs.map((a) => (
                        <div key={a.pledge_id}>
                          <span className="font-mono">{pledgeNumbers.get(a.pledge_id) ?? "pledge"}</span>{" "}
                          {formatCents(a.amount_cents, center.currency)}
                        </div>
                      ))}
                      {allocs.length > 0 && unallocated > 0 ? (
                        <div className="text-muted">{formatCents(unallocated, center.currency)} unallocated</div>
                      ) : null}
                    </td>
                    <td className="max-w-xs text-[0.8125rem]">{p.memo ?? "—"}</td>
                    {defs.defs.length ? (
                      <td>
                        <CustomDetailsCell defs={defs.defs} entity="payments" recordId={p.id} custom={p.custom} editable={editCustom} currency={center.currency} />
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
  );
}
