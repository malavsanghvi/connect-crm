import type { Metadata } from "next";

import { HouseholdDrawerProvider, HouseholdRow } from "@/app/(app)/giving/_components/household-drawer";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { householdsById } from "@/lib/data/lookups";
import { addDays, todayInTz } from "@/lib/dates";
import { weekdayMonthDay } from "@/lib/giving";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { addLabhOptionAction, markLabhScheduledAction, saveLabhOptionAction } from "./actions";

export const metadata: Metadata = { title: "Labh fulfillment" };

const STATUS: Record<string, { label: string; tone: "ok" | "warn" }> = {
  to_schedule: { label: "To schedule", tone: "warn" },
  scheduled: { label: "Scheduled", tone: "ok" },
  done: { label: "Done", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "warn" },
};

export default async function LabhPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Giving"
      description="Special-day labh taken in the app · schedule the puja, tell the Pathshala teacher, show the dedication"
    />
  );
  if (!canAccess(session, "labh")) {
    return (
      <>
        {header}
        <NoAccess area="Labh fulfillment" access="labh" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const canManage = canAccess(session, "labhManage");
  const rules = identifierRules(center.rules);

  const [pledges, menu] = await Promise.all([
    db
      .from("pledges")
      .select("id, pledge_number, household_id, amount_cents, dedication, due_on, status")
      .eq("center_id", center.id)
      .eq("source", "labh")
      .not("status", "in", "(cancelled,written_off)")
      .gte("due_on", addDays(today, -14))
      .order("due_on", { ascending: true })
      .limit(60),
    db.from("labh_options").select("id, name, amount_cents, fulfilled_by, active, sort_order").eq("center_id", center.id).order("sort_order"),
  ]);
  const rows = pledges.data ?? [];
  const [fulfillments, households] = await Promise.all([
    rows.length
      ? db.from("labh_fulfillments").select("pledge_id, labh_option_id, occasion, status").in("pledge_id", rows.map((r) => r.id))
      : Promise.resolve({ data: [] as { pledge_id: string; labh_option_id: string | null; occasion: string | null; status: string }[], error: null }),
    householdsById(db, rows.map((r) => r.household_id)),
  ]);
  const fBy = new Map((fulfillments.data ?? []).map((f) => [f.pledge_id, f]));
  const optionName = new Map((menu.data ?? []).map((o) => [o.id, o.name]));

  return (
    <HouseholdDrawerProvider labels={{ orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel }} timeZone={tz} currency={center.currency}>
      {header}
      <Card title="Upcoming labh" padded={false} className="mb-4">
        {pledges.error || fulfillments.error ? (
          <div className="p-2.5">
            <QueryError what="upcoming labh" error={pledges.error ?? fulfillments.error} retryHref="/giving/labh" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No labh taken for upcoming special days" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Household</th>
                  <th>Occasion</th>
                  <th>Labh</th>
                  <th>Dedication</th>
                  <th>Status</th>
                  {canManage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const f = fBy.get(p.id);
                  const st = STATUS[f?.status ?? "to_schedule"] ?? STATUS.to_schedule;
                  const h = households.map.get(p.household_id);
                  return (
                    <HouseholdRow key={p.id} householdId={p.household_id} label={`Open ${h?.display_name ?? "the household"}`}>
                      <td className="whitespace-nowrap font-bold">{weekdayMonthDay(p.due_on)}</td>
                      <td>{h?.display_name ?? "Household"}</td>
                      <td>{f?.occasion ?? <span className="text-muted">Special day</span>}</td>
                      <td>
                        {f?.labh_option_id ? (optionName.get(f.labh_option_id) ?? "Labh") : <span className="text-muted">Labh</span>}
                        <div className="text-xs text-muted">
                          {formatCents(p.amount_cents, center.currency)} · {p.pledge_number ?? ""}
                        </div>
                      </td>
                      <td className="max-w-xs">{p.dedication ?? <span className="text-muted">—</span>}</td>
                      <td>
                        <StatusText tone={st.tone}>{st.label}</StatusText>
                      </td>
                      {canManage ? (
                        <td>
                          {(f?.status ?? "to_schedule") === "to_schedule" ? (
                            <ActionForm action={markLabhScheduledAction} submitLabel="Mark scheduled" pendingLabel="Saving…" size="xs">
                              <input type="hidden" name="pledge_id" value={p.id} />
                              <input type="hidden" name="status" value="scheduled" />
                            </ActionForm>
                          ) : f?.status === "scheduled" ? (
                            <ActionForm action={markLabhScheduledAction} submitLabel="Mark done" pendingLabel="Saving…" variant="ok" size="xs">
                              <input type="hidden" name="pledge_id" value={p.id} />
                              <input type="hidden" name="status" value="done" />
                            </ActionForm>
                          ) : null}
                        </td>
                      ) : null}
                    </HouseholdRow>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Labh menu" description="Shown to members 2 weeks before a family special day" padded={false}>
        {menu.error ? (
          <div className="p-2.5">
            <QueryError what="the labh menu" error={menu.error} retryHref="/giving/labh" />
          </div>
        ) : (menu.data ?? []).length === 0 ? (
          <EmptyState title="The labh menu is empty" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Labh</th>
                  <th className="num">Amount</th>
                  <th>Fulfilled by</th>
                  <th>Active</th>
                  {canManage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {(menu.data ?? []).map((o) => (
                  <tr key={o.id}>
                    <td className="font-bold">{o.name}</td>
                    <td className="num">{formatCents(o.amount_cents, center.currency)}</td>
                    <td>{o.fulfilled_by ?? <span className="text-muted">Not set</span>}</td>
                    <td>{o.active ? <StatusText tone="ok">Yes</StatusText> : <span className="font-semibold text-muted">No</span>}</td>
                    {canManage ? (
                      <td>
                        <details>
                          <summary className="cursor-pointer text-[13px] font-semibold text-navy">Edit…</summary>
                          <ActionForm action={saveLabhOptionAction} submitLabel="Save" pendingLabel="Saving…" size="xs" className="mt-2 w-60">
                            <input type="hidden" name="id" value={o.id} />
                            <label htmlFor={`la-${o.id}`} className="crm-label">
                              Amount ($)
                            </label>
                            <input id={`la-${o.id}`} name="amount" inputMode="decimal" defaultValue={(o.amount_cents / 100).toFixed(2)} className="crm-input mb-1" />
                            <label htmlFor={`lf-${o.id}`} className="crm-label">
                              Fulfilled by
                            </label>
                            <input id={`lf-${o.id}`} name="fulfilled_by" defaultValue={o.fulfilled_by ?? ""} placeholder="e.g. Pujari schedule" className="crm-input mb-1" />
                            <label className="mb-2 flex min-h-9 items-center gap-2 text-[13px]">
                              <input type="checkbox" name="active" defaultChecked={o.active} className="h-5 w-5" /> Offered to members
                            </label>
                          </ActionForm>
                        </details>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {canManage ? (
          <details className="px-2.5 pb-2 pt-1">
            <summary className="cursor-pointer text-[13px] font-semibold text-navy">Add a labh to the menu</summary>
            <ActionForm action={addLabhOptionAction} submitLabel="Add labh" pendingLabel="Adding…" size="sm" resetOnSuccess className="mt-2">
              <div className="mb-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label htmlFor="nl-name" className="crm-label">
                    Labh
                  </label>
                  <input id="nl-name" name="name" required maxLength={120} className="crm-input" />
                </div>
                <div>
                  <label htmlFor="nl-amount" className="crm-label">
                    Amount ($)
                  </label>
                  <input id="nl-amount" name="amount" inputMode="decimal" required className="crm-input" />
                </div>
                <div>
                  <label htmlFor="nl-by" className="crm-label">
                    Fulfilled by
                  </label>
                  <input id="nl-by" name="fulfilled_by" maxLength={120} className="crm-input" />
                </div>
              </div>
            </ActionForm>
          </details>
        ) : null}
      </Card>
    </HouseholdDrawerProvider>
  );
}
