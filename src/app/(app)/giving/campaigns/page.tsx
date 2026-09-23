import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, NoAccess, PageHeader, QueryError, TableWrap } from "@/components/ui";
import { fetchAll } from "@/lib/data/fetch-all";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { createCampaignAction, setCampaignStatusAction } from "./actions";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS_TONE = { draft: "neutral", published: "success", closed: "navy", archived: "neutral" } as const;

export default async function CampaignsPage() {
  const session = await getSession();
  const header = (
    <PageHeader title="Campaigns" description="Giving campaigns and their progress. Drafts are visible to staff only; published campaigns appear in the member app." />
  );
  if (!canAccess(session, "campaigns")) {
    return (
      <>
        {header}
        <NoAccess area="Campaigns" access="campaigns" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const canManage = canAccess(session, "campaignsManage");

  const [campaigns, funds, pledges] = await Promise.all([
    db
      .from("campaigns")
      .select("id, name, kind, fund_id, goal_cents, starts_on, ends_on, status, description, created_at")
      .eq("center_id", center.id)
      .order("created_at", { ascending: false }),
    db.from("funds").select("id, name, restricted").eq("center_id", center.id).order("name"),
    fetchAll((f, t) =>
      db
        .from("pledges")
        .select("id, campaign_id, amount_cents, paid_cents")
        .eq("center_id", center.id)
        .not("campaign_id", "is", null)
        .not("status", "in", "(cancelled,written_off)")
        .order("id")
        .range(f, t),
    ),
  ]);
  const fundName = new Map((funds.data ?? []).map((f) => [f.id, f.name]));
  const totals = new Map<string, { pledged: number; paid: number; count: number }>();
  for (const p of pledges.data) {
    if (!p.campaign_id) continue;
    const t = totals.get(p.campaign_id) ?? { pledged: 0, paid: 0, count: 0 };
    t.pledged += p.amount_cents;
    t.paid += p.paid_cents;
    t.count += 1;
    totals.set(p.campaign_id, t);
  }

  return (
    <>
      {header}
      {campaigns.error ? (
        <QueryError what="campaigns" error={campaigns.error} retryHref="/giving/campaigns" />
      ) : (
        <Card padded={false} className="mb-6">
          {pledges.error ? (
            <div className="p-4">
              <QueryError what="campaign totals" error={pledges.error} retryHref="/giving/campaigns" />
            </div>
          ) : null}
          {(campaigns.data ?? []).length === 0 ? (
            <EmptyState title="No campaigns yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Fund</th>
                    <th>Dates</th>
                    <th className="num">Goal</th>
                    <th className="num">Pledged</th>
                    <th className="num">Paid</th>
                    <th>Status</th>
                    {canManage ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {(campaigns.data ?? []).map((c) => {
                    const t = totals.get(c.id) ?? { pledged: 0, paid: 0, count: 0 };
                    const pct = c.goal_cents ? Math.min(100, Math.round((t.pledged / c.goal_cents) * 100)) : null;
                    return (
                      <tr key={c.id}>
                        <td className="min-w-[14rem]">
                          <span className="font-semibold">{c.name}</span>
                          <div className="text-xs capitalize text-muted">{c.kind}</div>
                          {c.description ? <div className="mt-1 max-w-md text-xs text-muted">{c.description}</div> : null}
                        </td>
                        <td>{c.fund_id ? (fundName.get(c.fund_id) ?? "—") : "—"}</td>
                        <td className="whitespace-nowrap text-[0.8125rem]">
                          {c.starts_on ? formatDate(c.starts_on, tz) : "—"} – {c.ends_on ? formatDate(c.ends_on, tz) : "open"}
                        </td>
                        <td className="num">{c.goal_cents ? formatCents(c.goal_cents, center.currency) : "—"}</td>
                        <td className="num">
                          {formatCents(t.pledged, center.currency)}
                          <div className="text-xs text-muted">
                            {t.count} pledge{t.count === 1 ? "" : "s"}
                            {pct !== null ? ` · ${pct}% of goal` : ""}
                          </div>
                        </td>
                        <td className="num">{formatCents(t.paid, center.currency)}</td>
                        <td>
                          <Badge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE] ?? "neutral"}>{c.status}</Badge>
                        </td>
                        {canManage ? (
                          <td className="space-y-1">
                            {c.status === "draft" || c.status === "closed" ? (
                              <StatusButton id={c.id} status="published" label={c.status === "closed" ? "Reopen" : "Publish"} />
                            ) : null}
                            {c.status === "published" ? <StatusButton id={c.id} status="closed" label="Close" /> : null}
                            {c.status === "closed" || c.status === "draft" ? <StatusButton id={c.id} status="archived" label="Archive" /> : null}
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
      )}

      {canManage ? (
        <Card title="New campaign">
          <ActionForm action={createCampaignAction} submitLabel="Create draft" pendingLabel="Creating…" resetOnSuccess>
            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label htmlFor="c-name" className="crm-label">
                  Name
                </label>
                <input id="c-name" name="name" required maxLength={160} className="crm-input" />
              </div>
              <div>
                <label htmlFor="c-kind" className="crm-label">
                  Kind
                </label>
                <select id="c-kind" name="kind" defaultValue="general" className="crm-input">
                  {["general", "boli", "sponsorship", "construction", "pathshala", "event", "membership", "store", "other"].map((k) => (
                    <option key={k} value={k}>
                      {k[0].toUpperCase() + k.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="c-fund" className="crm-label">
                  Fund
                </label>
                <select id="c-fund" name="fund_id" defaultValue="" className="crm-input">
                  <option value="">No specific fund</option>
                  {(funds.data ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.restricted ? " (restricted)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="c-goal" className="crm-label">
                  Goal ($, optional)
                </label>
                <input id="c-goal" name="goal" inputMode="decimal" className="crm-input" />
              </div>
              <div>
                <label htmlFor="c-start" className="crm-label">
                  Starts on
                </label>
                <input id="c-start" name="starts_on" type="date" className="crm-input" />
              </div>
              <div>
                <label htmlFor="c-end" className="crm-label">
                  Ends on
                </label>
                <input id="c-end" name="ends_on" type="date" className="crm-input" />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label htmlFor="c-desc" className="crm-label">
                  Description
                </label>
                <textarea id="c-desc" name="description" maxLength={2000} className="crm-input min-h-20" />
              </div>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <ActionForm action={setCampaignStatusAction} submitLabel={label} pendingLabel="Saving…" variant={status === "archived" ? "ghost" : "secondary"} size="sm">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
    </ActionForm>
  );
}
