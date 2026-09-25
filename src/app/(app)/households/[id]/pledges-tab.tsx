import { CustomDetailsCell } from "@/components/custom-details-cell";
import { Badge, Card, EmptyState, NoAccess, QueryError, TableWrap } from "@/components/ui";
import { loadCustomFieldDefs, withCustomValues } from "@/lib/data/custom-fields";
import { formatDate } from "@/lib/dates";
import { PLEDGE_STATUS_LABEL, PLEDGE_STATUS_TONE } from "@/lib/labels";
import { formatCents, sumCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

export async function PledgesTab({ session, householdId }: { session: CrmSession; householdId: string }) {
  if (!canAccess(session, "pledges")) return <NoAccess area="Pledges" access="pledges" />;
  const { db, center } = session;
  const tz = center.time_zone;
  const retry = `/households/${householdId}?tab=pledges`;

  const [pRes, cRes, defs] = await Promise.all([
    db
      .from("pledges")
      .select("id, pledge_number, crm_external_id, campaign_id, source, amount_cents, paid_cents, status, pledged_at, due_on, dedication, anonymous, custom")
      .eq("household_id", householdId)
      .order("pledged_at", { ascending: false })
      .limit(500),
    db.from("campaigns").select("id, name").eq("center_id", center.id),
    loadCustomFieldDefs(db, center.id, "pledges", true),
  ]);
  const editCustom = canAccess(session, "givingManage");
  if (pRes.error) return <QueryError what="pledges" error={pRes.error} retryHref={retry} />;
  const campaign = new Map((cRes.data ?? []).map((c) => [c.id, c.name]));
  const withCustom = defs.defs.length ? await withCustomValues(db, "pledges", pRes.data ?? []) : { rows: pRes.data ?? [], error: null };
  if (withCustom.error) return <QueryError what="the pledges' custom details" error={withCustom.error} retryHref={retry} />;
  const pledges = withCustom.rows;
  const outstanding = pledges.filter((p) => p.status === "open" || p.status === "partially_paid");

  return (
    <Card
      padded={false}
      title="Pledges"
      description={`${pledges.length} pledges · ${formatCents(sumCents(outstanding.map((p) => p.amount_cents - p.paid_cents)), center.currency)} outstanding on ${outstanding.length}`}
    >
      {cRes.error ? (
        <div className="p-4">
          <QueryError what="campaign names" error={cRes.error} retryHref={retry} />
        </div>
      ) : null}
      {pledges.length === 0 ? (
        <EmptyState title="No pledges" />
      ) : (
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Pledge</th>
                <th>Campaign</th>
                <th>Source</th>
                <th>Status</th>
                <th className="num">Amount</th>
                <th className="num">Paid</th>
                <th className="num">Open</th>
                <th>Pledged</th>
                <th>Due</th>
                {defs.defs.length ? <th>More details</th> : null}
              </tr>
            </thead>
            <tbody>
              {pledges.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-[0.8125rem]">
                    {p.pledge_number ?? "—"}
                    {p.dedication ? <div className="font-sans text-xs text-muted">{p.dedication}</div> : null}
                    {p.crm_external_id?.startsWith("qbo:") ? (
                      <div className="font-sans text-xs text-muted" title="Brought in from QuickBooks: history, already in the books">
                        History · QuickBooks {p.crm_external_id.slice(4).replace(":", " #")}
                      </div>
                    ) : null}
                  </td>
                  <td>{p.campaign_id ? (campaign.get(p.campaign_id) ?? "—") : "—"}</td>
                  <td className="capitalize">{p.source.replace(/_/g, " ")}</td>
                  <td>
                    <Badge tone={PLEDGE_STATUS_TONE[p.status]}>{PLEDGE_STATUS_LABEL[p.status]}</Badge>
                  </td>
                  <td className="num">{formatCents(p.amount_cents, center.currency)}</td>
                  <td className="num">{formatCents(p.paid_cents, center.currency)}</td>
                  <td className="num font-semibold">
                    {formatCents(Math.max(0, p.amount_cents - p.paid_cents), center.currency)}
                  </td>
                  <td>{formatDate(p.pledged_at, tz)}</td>
                  <td>{formatDate(p.due_on, tz)}</td>
                  {defs.defs.length ? (
                    <td>
                      <CustomDetailsCell defs={defs.defs} entity="pledges" recordId={p.id} custom={p.custom} editable={editCustom} currency={center.currency} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
