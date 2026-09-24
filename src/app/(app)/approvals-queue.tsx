import Link from "next/link";

import { approveAsSecondAction } from "@/app/(app)/approvals/actions";
import { ActionForm } from "@/components/action-form";
import { RefundControls, WriteOffControls } from "@/components/two-person-controls";
import { Card, EmptyState, QueryError, TableWrap, Tag } from "@/components/ui";
import { householdsById, peopleById, userNames } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import type { DbErrorLike } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

/**
 * Requests waiting on the two-person rule (0016): pledge write-offs, refunds
 * and voting-eligibility overrides. A different authorized person approves.
 */
export async function ApprovalsQueue({ session }: { session: CrmSession }) {
  if (!canAccess(session, "approvals")) return null;
  const { db, center } = session;
  const tz = center.time_zone;
  const canManage = canAccess(session, "givingManage");
  const canApproveGiving = canAccess(session, "givingApprove");
  const canApprovePeople = canAccess(session, "peopleApprove");
  const seesGiving = can(session, ["giving.view", "giving.manage"]);
  const seesPeople = can(session, ["people.view", "people.approve"]);

  const [pledges, payments, overrides] = await Promise.all([
    seesGiving
      ? db
          .from("pledges")
          .select("id, pledge_number, household_id, amount_cents, paid_cents, written_off_by, written_off_second_approver, write_off_reason")
          .eq("center_id", center.id)
          .not("written_off_by", "is", null)
          .in("status", ["open", "partially_paid"])
          .limit(50)
      : null,
    seesGiving
      ? db
          .from("payments")
          .select("id, receipt_number, household_id, amount_cents, refunded_cents, provider, status, refund_approved_by, refund_second_approver, received_on")
          .eq("center_id", center.id)
          .not("refund_approved_by", "is", null)
          .eq("refunded_cents", 0)
          .limit(50)
      : null,
    seesPeople
      ? db
          .from("eligibility_snapshots")
          .select("id, person_id, override_by, override_reason, override_second_approver, computed_at")
          .eq("center_id", center.id)
          .not("override_by", "is", null)
          .is("override_second_approver", null)
          .limit(50)
      : null,
  ]);
  const error: DbErrorLike | null = pledges?.error ?? payments?.error ?? overrides?.error ?? null;
  const p = pledges?.data ?? [];
  const r = payments?.data ?? [];
  const o = overrides?.data ?? [];
  const [households, people, requesters] = await Promise.all([
    householdsById(db, [...p.map((x) => x.household_id), ...r.map((x) => x.household_id)]),
    peopleById(db, o.map((x) => x.person_id)),
    userNames(db, center.id, [...p.map((x) => x.written_off_by), ...r.map((x) => x.refund_approved_by), ...o.map((x) => x.override_by)]),
  ]);
  const total = p.length + r.length + o.length;

  return (
    <Card
      title="Waiting for second approval"
      description="Refunds, pledge write-offs and voting-eligibility overrides need two different people. The database refuses the final step until then."
      padded={false}
      className="mt-4"
    >
      {error ? (
        <div className="p-4">
          <QueryError what="the approval queue" error={error} retryHref="/" />
        </div>
      ) : null}
      {total === 0 ? (
        <EmptyState title="Nothing is waiting for a second approver" />
      ) : (
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>For</th>
                <th className="num">Amount</th>
                <th>Requested by</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {p.map((x) => {
                const h = households.map.get(x.household_id);
                return (
                  <tr key={`p-${x.id}`}>
                    <td>
                      <Tag color="brown">Write-off</Tag> <span className="font-mono text-[0.8125rem]">{x.pledge_number ?? "pledge"}</span>
                      {x.write_off_reason ? <div className="mt-1 text-xs text-muted">“{x.write_off_reason}”</div> : null}
                    </td>
                    <td>
                      <Link href={`/households/${x.household_id}?tab=pledges`} className="crm-link">
                        {h?.display_name ?? "Household"}
                      </Link>
                      <div className="font-mono text-xs text-muted">{h?.household_number ?? ""}</div>
                    </td>
                    <td className="num">{formatCents(x.amount_cents - x.paid_cents, center.currency)} open</td>
                    <td>{x.written_off_by === session.userId ? "You" : (requesters.get(x.written_off_by ?? "")?.name ?? "Staff")}</td>
                    <td>
                      <WriteOffControls
                        pledgeId={x.id}
                        requestedBy={x.written_off_by}
                        secondApprover={x.written_off_second_approver}
                        requesterName={requesters.get(x.written_off_by ?? "")?.name ?? null}
                        reason={null}
                        me={session.userId}
                        canManage={canManage}
                        canApprove={canApproveGiving}
                      />
                    </td>
                  </tr>
                );
              })}
              {r.map((x) => {
                const h = households.map.get(x.household_id);
                return (
                  <tr key={`r-${x.id}`}>
                    <td>
                      <Tag color="danger">Refund</Tag> <span className="font-mono text-[0.8125rem]">{x.receipt_number ?? "payment"}</span>
                      <div className="text-xs text-muted">received {formatDate(x.received_on, tz)}</div>
                    </td>
                    <td>
                      <Link href={`/households/${x.household_id}?tab=payments`} className="crm-link">
                        {h?.display_name ?? "Household"}
                      </Link>
                      <div className="font-mono text-xs text-muted">{h?.household_number ?? ""}</div>
                    </td>
                    <td className="num">{formatCents(x.amount_cents, center.currency)}</td>
                    <td>{x.refund_approved_by === session.userId ? "You" : (requesters.get(x.refund_approved_by ?? "")?.name ?? "Staff")}</td>
                    <td>
                      <RefundControls
                        paymentId={x.id}
                        provider={x.provider}
                        refundable
                        requestedBy={x.refund_approved_by}
                        secondApprover={x.refund_second_approver}
                        requesterName={requesters.get(x.refund_approved_by ?? "")?.name ?? null}
                        me={session.userId}
                        canManage={canManage}
                        canApprove={canApproveGiving}
                      />
                    </td>
                  </tr>
                );
              })}
              {o.map((x) => (
                <tr key={`o-${x.id}`}>
                  <td>
                    <Tag color="purple">Voting override</Tag>
                    {x.override_reason ? <div className="mt-1 text-xs text-muted">“{x.override_reason}”</div> : null}
                  </td>
                  <td>
                    <Link href={`/people/${x.person_id}`} className="crm-link">
                      {people.map.get(x.person_id)?.name ?? "Person"}
                    </Link>
                  </td>
                  <td className="num">—</td>
                  <td>{x.override_by === session.userId ? "You" : (requesters.get(x.override_by ?? "")?.name ?? "Staff")}</td>
                  <td>
                    {x.override_by !== session.userId && canApprovePeople ? (
                      <ActionForm action={approveAsSecondAction} submitLabel="Approve as second person" pendingLabel="Approving…" variant="success" size="sm">
                        <input type="hidden" name="table" value="eligibility_snapshots" />
                        <input type="hidden" name="id" value={x.id} />
                      </ActionForm>
                    ) : (
                      <span className="text-sm text-muted">Waiting for a different person with people.approve</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
