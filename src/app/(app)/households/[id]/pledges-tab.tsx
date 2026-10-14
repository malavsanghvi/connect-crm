import { CustomDetailsCell } from "@/components/custom-details-cell";
import { EditPledgeButton, EmailPledgeButton, RecordPledgeButton } from "@/components/giving-actions/provider";
import { PrintPledgeButton } from "@/components/giving-actions/pledge-print";
import { PeriodNote } from "@/components/giving-glance/period-note";
import { Badge, Card, EmptyState, NoAccess, QueryError, TableWrap, buttonClass } from "@/components/ui";
import { loadCustomFieldDefs, withCustomValues } from "@/lib/data/custom-fields";
import { addDays, formatDate, startOfDayInTz } from "@/lib/dates";
import type { TabPeriod } from "@/lib/giving-glance/page";
import { PLEDGE_STATUS_LABEL, PLEDGE_STATUS_TONE } from "@/lib/labels";
import { formatCents, sumCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

/**
 * `period`: only the pledges made in this year (the year chosen in "Giving at a glance"); all of them when it is left out.
 * `recordPledge`: the New look's Record pledge button (it opens the sheet in place for giving.manage, and draws nothing otherwise).
 */
export async function PledgesTab({ session, householdId, period, recordPledge = false }: { session: CrmSession; householdId: string; period?: TabPeriod; recordPledge?: boolean }) {
  if (!canAccess(session, "pledges")) return <NoAccess area="Pledges" access="pledges" />;
  const { db, center } = session;
  const tz = center.time_zone;
  const retry = `/households/${householdId}?tab=pledges`;

  let pledgeQuery = db
    .from("pledges")
    .select("id, pledge_number, crm_external_id, campaign_id, source, amount_cents, paid_cents, status, pledged_at, due_on, dedication, anonymous, custom")
    .eq("household_id", householdId);
  // By the day the pledge was made, in the community's time zone.
  if (period?.from) pledgeQuery = pledgeQuery.gte("pledged_at", startOfDayInTz(period.from, tz));
  if (period?.to) pledgeQuery = pledgeQuery.lt("pledged_at", startOfDayInTz(addDays(period.to, 1), tz));
  const [pRes, cRes, defs] = await Promise.all([
    pledgeQuery.order("pledged_at", { ascending: false }).limit(500),
    db.from("campaigns").select("id, name").eq("center_id", center.id),
    loadCustomFieldDefs(db, center.id, "pledges", true),
  ]);
  // Edit (and Delete, inside the sheet) is giving.manage; the database decides again and says what is locked on each pledge (0782).
  const editCustom = canAccess(session, "givingManage");
  const canEdit = editCustom;
  // Print (giving.view or giving.manage) and Email (giving.manage) beside Edit: a PDF of the pledge as an invoice (0791, 0792).
  const canPrint = canAccess(session, "pledgeCopy");
  const hasActions = canEdit || canPrint;
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
      actions={recordPledge ? <RecordPledgeButton householdId={householdId} className={`${buttonClass("primary", "sm")} min-h-[44px]`} /> : undefined}
      description={`${pledges.length} pledges${period ? ` made in ${period.label}` : ""} · ${formatCents(sumCents(outstanding.map((p) => p.amount_cents - p.paid_cents)), center.currency)} outstanding on ${outstanding.length}`}
    >
      {period ? <PeriodNote period={period} what="pledges" /> : null}
      {cRes.error ? (
        <div className="p-4">
          <QueryError what="campaign names" error={cRes.error} retryHref={retry} />
        </div>
      ) : null}
      {pledges.length === 0 ? (
        <EmptyState title={period ? `No pledges made in ${period.label}` : "No pledges"}>
          {period ? (
            <a href={period.showAllHref} className="crm-link font-semibold">
              Show all years
            </a>
          ) : null}
        </EmptyState>
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
                {hasActions ? (
                  <th>
                    <span className="sr-only">Edit, print and email</span>
                  </th>
                ) : null}
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
                  {hasActions ? (
                    <td className="whitespace-nowrap">
                      {p.status !== "cancelled" ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {canEdit ? (
                            <EditPledgeButton pledgeId={p.id} label={`Edit pledge ${p.pledge_number ?? ""}`.trim()} className={`${buttonClass("ghost", "xs")} min-h-[36px]`}>
                              Edit
                            </EditPledgeButton>
                          ) : null}
                          {canPrint ? <PrintPledgeButton pledgeId={p.id} reference={p.pledge_number ?? "the pledge"} variant="button" label="Print" /> : null}
                          <EmailPledgeButton pledgeId={p.id} label={`Email pledge ${p.pledge_number ?? ""}`.trim()} className={`${buttonClass("ghost", "xs")} min-h-[36px]`}>
                            Email
                          </EmailPledgeButton>
                        </span>
                      ) : null}
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
