import { Alert, Badge, Card, EmptyState, NoAccess, QueryError, TableWrap } from "@/components/ui";
import { chunk } from "@/lib/data/fetch-all";
import { formatDate } from "@/lib/dates";
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
    .select("id, receipt_number, received_on, method, amount_cents, status, provider, check_number, envelope_number, memo, refunded_cents, deposit_bank_transaction_id")
    .eq("household_id", householdId)
    .order("received_on", { ascending: false })
    .limit(500);
  if (pRes.error) return <QueryError what="payments" error={pRes.error} retryHref={retry} />;
  const payments = pRes.data ?? [];

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

  return (
    <Card
      padded={false}
      title="Payments"
      description={`${payments.length} payments · ${formatCents(sumCents(payments.map((p) => p.amount_cents)), center.currency)} received`}
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
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const allocs = byPayment.get(p.id) ?? [];
                const unallocated = p.amount_cents - sumCents(allocs.map((a) => a.amount_cents));
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-[0.8125rem]">{p.receipt_number ?? "—"}</td>
                    <td>{formatDate(p.received_on, tz)}</td>
                    <td>
                      {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                      {p.check_number ? <div className="text-xs text-muted">Check #{p.check_number}</div> : null}
                      {p.envelope_number ? <div className="text-xs text-muted">Envelope {p.envelope_number}</div> : null}
                      <div className="text-xs text-muted">via {p.provider ?? "—"}</div>
                    </td>
                    <td className="num">
                      {formatCents(p.amount_cents, center.currency)}
                      {p.refunded_cents > 0 ? (
                        <div className="text-xs text-maroon">−{formatCents(p.refunded_cents, center.currency)} refunded</div>
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
