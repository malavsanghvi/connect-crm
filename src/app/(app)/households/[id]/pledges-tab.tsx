import { CustomDetailsCell } from "@/components/custom-details-cell";
import { EditPledgeButton, EmailPledgeButton, RecordPledgeButton } from "@/components/giving-actions/provider";
import { PrintPledgeButton } from "@/components/giving-actions/pledge-print";
import { PeriodNote } from "@/components/giving-glance/period-note";
import { Badge, Card, EmptyState, KpiGrid, NoAccess, QueryError, Stat, TableWrap, buttonClass } from "@/components/ui";
import { loadCustomFieldDefs, withCustomValues } from "@/lib/data/custom-fields";
import { addDays, formatDate, startOfDayInTz } from "@/lib/dates";
import type { TabPeriod } from "@/lib/giving-glance/page";
import { householdUnbanked, parseUnbanked, type UnbankedRow } from "@/lib/bank-reconcile/unbanked";
import { failure } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { PLEDGE_STANDING_LABEL, isOpenPledgeStatus, pledgeStanding, softCreditWaitingCents, stillToPayCents, totalPledges, type PledgeStanding } from "@/lib/pledge-balance";
import type { CrmSession } from "@/lib/session";

import { PledgeEvidence } from "./pledge-evidence";

const STANDING_TONE: Record<PledgeStanding, "warning" | "navy" | "success" | "neutral"> = {
  open: "warning",
  part_paid: "navy",
  soft_credit: "navy",
  paid: "success",
  bank_reconciled: "success",
  written_off: "neutral",
  cancelled: "neutral",
};

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
    .select("id, pledge_number, crm_external_id, campaign_id, source, amount_cents, paid_cents, soft_credit_cents, reconciled_at, status, pledged_at, due_on, dedication, anonymous, custom")
    .eq("household_id", householdId);
  // By the day the pledge was made, in the community's time zone.
  if (period?.from) pledgeQuery = pledgeQuery.gte("pledged_at", startOfDayInTz(period.from, tz));
  if (period?.to) pledgeQuery = pledgeQuery.lt("pledged_at", startOfDayInTz(addDays(period.to, 1), tz));
  const showBank = isModuleEnabled(session, "giving_bank");
  const showProofs = isModuleEnabled(session, "giving_proofs");
  const [pRes, cRes, defs, unbanked] = await Promise.all([
    pledgeQuery.order("pledged_at", { ascending: false }).limit(500),
    db.from("campaigns").select("id, name").eq("center_id", center.id),
    loadCustomFieldDefs(db, center.id, "pledges", true),
    showBank ? loadUnbanked(session) : Promise.resolve(null),
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
  const outstanding = pledges.filter((p) => isOpenPledgeStatus(p.status));
  // The Open balance rule (owner, 2026-10-15): amount - paid - soft credit over Open and Partly paid pledges. Soft credit is its own figure.
  const totals = totalPledges(pledges);
  const open = outstanding.reduce((a, p) => ({ amount: a.amount + p.amount_cents, paid: a.paid + p.paid_cents, soft: a.soft + softCreditWaitingCents(p) }), { amount: 0, paid: 0, soft: 0 });
  const money = (c: number) => formatCents(c, center.currency);
  const mine = unbanked && "rows" in unbanked ? householdUnbanked(unbanked.rows, householdId) : null;
  const showSoft = showProofs || totals.softCreditCount > 0;
  const sum = pledges.reduce(
    (a, p) => ({ amount: a.amount + p.amount_cents, paid: a.paid + p.paid_cents, soft: a.soft + softCreditWaitingCents(p), open: a.open + (isOpenPledgeStatus(p.status) ? stillToPayCents(p) : 0) }),
    { amount: 0, paid: 0, soft: 0, open: 0 },
  );

  return (
    <Card
      padded={false}
      title="Pledges"
      actions={recordPledge ? <RecordPledgeButton householdId={householdId} className={`${buttonClass("primary", "sm")} min-h-[44px]`} /> : undefined}
      description={`${pledges.length} pledges${period ? ` made in ${period.label}` : ""} · ${money(totals.openCents)} open on ${totals.openCount}${totals.softCreditCents > 0 ? ` · ${money(totals.softCreditCents)} soft credit waiting` : ""}`}
    >
      {period ? <PeriodNote period={period} what="pledges" /> : null}
      <div className="space-y-3 px-[18px] pb-3 pt-3" data-testid="pledge-tiles">
        <KpiGrid cols={4}>
          <Stat label="Open balance" value={money(totals.openCents)} tone="brown" hint={`${totals.openCount} ${totals.openCount === 1 ? "pledge" : "pledges"}. Leaves out soft credit and reconciled money.`} />
          {showSoft ? (
            <Stat
              label="Soft credit, waiting"
              value={money(totals.softCreditCents)}
              hint={totals.softCreditCount > 0 ? `On ${totals.softCreditCount} ${totals.softCreditCount === 1 ? "pledge" : "pledges"}, not yet verified` : "No proof is waiting to be verified"}
            />
          ) : null}
          {showBank ? (
            <Stat
              label="Paid, not on the bank"
              value={mine ? money(mine.cents) : "—"}
              hint={
                mine
                  ? mine.count === 0
                    ? "Every verified payment is on the bank"
                    : `${mine.count} ${mine.count === 1 ? "payment" : "payments"}, ${mine.oldestDays} ${mine.oldestDays === 1 ? "day" : "days"} since verified (oldest)`
                  : unbanked && "error" in unbanked
                    ? unbanked.error
                    : undefined
              }
            />
          ) : null}
          {showBank ? <Stat label="Bank reconciled" value={money(totals.reconciledCents)} tone="success" hint={`${totals.reconciledCount} ${totals.reconciledCount === 1 ? "pledge" : "pledges"}, final`} /> : null}
        </KpiGrid>
        <p className="m-0 rounded-lg bg-subtle px-3 py-2 text-[0.8125rem] text-ink">
          <strong>How Open balance is counted:</strong> amount − paid − soft credit, over pledges that are Open or Partly paid. Soft credit, Paid and Bank reconciled pledges
          add nothing. {money(open.amount)} pledged − {money(open.paid)} paid − {money(open.soft)} soft credit = <strong>{money(totals.openCents)}</strong>.
        </p>
      </div>
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
                <th className="num">Paid (verified)</th>
                {showSoft ? <th className="num">Soft credit</th> : null}
                <th className="num">In Open balance</th>
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
                    <Badge tone={STANDING_TONE[standingOf(p, showBank)]}>{PLEDGE_STANDING_LABEL[standingOf(p, showBank)]}</Badge>
                    <span className="block whitespace-normal text-xs text-muted">{standingNote(p, money, showBank)}</span>
                    {showProofs || softCreditWaitingCents(p) > 0 || p.status === "paid" ? (
                      <PledgeEvidence pledgeId={p.id} reference={p.pledge_number ?? "the pledge"} currency={center.currency} timeZone={tz} />
                    ) : null}
                  </td>
                  <td className="num">{formatCents(p.amount_cents, center.currency)}</td>
                  <td className="num">{formatCents(p.paid_cents, center.currency)}</td>
                  {showSoft ? <td className="num">{formatCents(softCreditWaitingCents(p), center.currency)}</td> : null}
                  <td className="num font-semibold">{formatCents(isOpenPledgeStatus(p.status) ? stillToPayCents(p) : 0, center.currency)}</td>
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
              <tr className="border-t-2 border-ink font-bold" data-testid="pledge-totals">
                <td>Total</td>
                <td />
                <td />
                <td />
                <td className="num">{money(sum.amount)}</td>
                <td className="num">{money(sum.paid)}</td>
                {showSoft ? <td className="num">{money(sum.soft)}</td> : null}
                <td className="num">{money(sum.open)}</td>
                <td />
                <td />
                {defs.defs.length ? <td /> : null}
                {hasActions ? <td /> : null}
              </tr>
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

/** The word a pledge shows: "Bank reconciled" only where the community uses the Bank reconciliation add-on (otherwise Paid is the final state). */
function standingOf(p: { status: string; reconciled_at: string | null }, showBank: boolean): PledgeStanding {
  const st = pledgeStanding(p);
  return st === "bank_reconciled" && !showBank ? "paid" : st;
}

/** The line under the status: what is waiting, or what is still to pay. */
function standingNote(
  p: { status: string; amount_cents: number; paid_cents: number; soft_credit_cents: number; reconciled_at: string | null },
  money: (c: number) => string,
  showBank: boolean,
): string {
  const soft = softCreditWaitingCents(p);
  if (p.status === "soft_credit") return `Soft credit ${money(soft)} waiting to be verified. Reminders paused.`;
  if (isOpenPledgeStatus(p.status) && soft > 0) return `Soft credit ${money(soft)} waiting; ${money(stillToPayCents(p))} still to pay`;
  if (p.status === "paid" && showBank) return p.reconciled_at ? "Every payment on it is matched to the bank" : "Not on the bank yet";
  return "";
}

/** The payments counted as paid that no bank line has banked (0868), for the household's tile. A part that cannot be read says so. */
async function loadUnbanked(session: CrmSession): Promise<{ rows: UnbankedRow[] } | { error: string }> {
  const r = await session.db.rpc("unbanked_payments_report", { p_center: session.center.id });
  if (r.error) {
    if (r.error.code === "42501") return { error: "You don't have access to this figure" };
    return { error: failure("Could not read the payments not yet on the bank", r.error).error };
  }
  const rows = parseUnbanked(r.data);
  if (!rows) {
    console.error("[household] unbanked_payments_report returned an unexpected shape:", r.data);
    return { error: "Could not read the payments not yet on the bank — the database answered in a shape this screen does not understand" };
  }
  return { rows };
}
