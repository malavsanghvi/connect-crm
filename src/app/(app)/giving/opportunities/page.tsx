import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { BarList, type BarColor } from "@/components/bar-list";
import { BlockGrid, Card, ChipLinks, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { fetchAll } from "@/lib/data/fetch-all";
import { OPPORTUNITY_TYPES, barPercent, optionRows } from "@/lib/giving";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { setOpportunityStatusAction } from "./actions";
import { OpportunityBuilder, type BuilderInitial } from "./builder";

export const metadata: Metadata = { title: "Opportunities" };

const COLORS: BarColor[] = ["saffron", "navy", "purple", "green", "stone"];
const TYPE_LABEL: Record<string, string> = { ...Object.fromEntries(OPPORTUNITY_TYPES.map((t) => [t.kind, t.label])), fixed: "Fixed amount" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="Giving" description="Build the opportunities members see in the Give tab, and who gets alerted" />;
  if (!canAccess(session, "campaigns")) {
    return (
      <>
        {header}
        <NoAccess area="Opportunities" access="campaigns" />
      </>
    );
  }
  const sp = await searchParams;
  const editId = param(sp, "edit");
  const { db, center } = session;
  const canManage = canAccess(session, "campaignsManage");

  const [campaigns, funds, opps, pledges] = await Promise.all([
    db.from("campaigns").select("id, name, status, fund_id, goal_cents").eq("center_id", center.id).neq("status", "archived").order("name"),
    db.from("funds").select("id, name, restricted").eq("center_id", center.id),
    db
      .from("opportunities")
      .select("id, name, subtitle, kind, options, campaign_id, status, allow_anonymous, quantity_available, created_at")
      .eq("center_id", center.id)
      .order("created_at", { ascending: false })
      .limit(60),
    fetchAll((f, t) =>
      db
        .from("pledges")
        .select("id, campaign_id, amount_cents")
        .eq("center_id", center.id)
        .not("campaign_id", "is", null)
        .not("status", "in", "(cancelled,written_off)")
        .order("id")
        .range(f, t),
    ),
  ]);
  const fundBy = new Map((funds.data ?? []).map((f) => [f.id, f]));
  const campaignName = new Map((campaigns.data ?? []).map((c) => [c.id, c.name]));
  const pledged = new Map<string, number>();
  for (const p of pledges.data) if (p.campaign_id) pledged.set(p.campaign_id, (pledged.get(p.campaign_id) ?? 0) + p.amount_cents);

  const progress = (campaigns.data ?? [])
    .filter((c) => c.status === "published" && (c.goal_cents ?? 0) > 0)
    .map((c) => ({ c, raised: pledged.get(c.id) ?? 0 }))
    .sort((a, b) => (b.c.goal_cents ?? 0) - (a.c.goal_cents ?? 0))
    .slice(0, 6);

  const oppRows = opps.data ?? [];
  const availability = new Map<string, { taken: Record<string, number>; slotsTaken: number | null; slotsTotal: number | null; goal: number | null }>();
  await Promise.all(
    oppRows.map(async (o) => {
      const r = await db.rpc("opportunity_availability", { p_opportunity: o.id });
      if (r.error) {
        console.error("[opportunities] availability failed:", r.error);
        return;
      }
      const taken: Record<string, number> = {};
      for (const a of r.data ?? []) if (a.option_key) taken[a.option_key] = a.taken_count ?? 0;
      const first = r.data?.[0];
      availability.set(o.id, { taken, slotsTaken: first?.slots_taken ?? null, slotsTotal: first?.slots_total ?? null, goal: first?.goal_percent ?? null });
    }),
  );

  const editing = isUuid(editId) ? oppRows.find((o) => o.id === editId) : undefined;
  const initial: BuilderInitial | null = editing
    ? {
        id: editing.id,
        name: editing.name,
        subtitle: editing.subtitle ?? "",
        kind: editing.kind,
        campaignId: editing.campaign_id,
        allowAnonymous: editing.allow_anonymous,
        rows: optionRows(editing.kind, editing.options),
        taken: availability.get(editing.id)?.taken ?? {},
        status: editing.status,
      }
    : null;

  return (
    <>
      {header}
      <ChipLinks
        label="Opportunities views"
        active="opportunities"
        items={[
          { key: "opportunities", label: "Opportunities", href: "/giving/opportunities" },
          { key: "campaigns", label: "Campaigns", href: "/giving/opportunities/campaigns" },
        ]}
      />
      {campaigns.error ? <QueryError what="campaigns" error={campaigns.error} retryHref="/giving/opportunities" /> : null}
      <BlockGrid className="mb-4">
        <Card span={5} title="Campaign progress" description="Pledged against each published campaign's goal">
          {pledges.error ? (
            <QueryError what="campaign totals" error={pledges.error} retryHref="/giving/opportunities" />
          ) : (
            <BarList
              empty="No published campaign has a goal yet."
              items={progress.map(({ c, raised }, i) => ({
                label: c.name,
                percent: barPercent(raised, c.goal_cents ?? 0),
                value: formatCents(raised, center.currency).replace(/\.00$/, ""),
                color: COLORS[i % COLORS.length],
              }))}
            />
          )}
        </Card>
        <OpportunityBuilder
          key={initial?.id ?? "new"}
          campaigns={(campaigns.data ?? []).map((c) => {
            const f = c.fund_id ? fundBy.get(c.fund_id) : undefined;
            return { id: c.id, name: c.name, status: c.status, fund: f?.name ?? null, restricted: f?.restricted ?? false };
          })}
          initial={initial}
          canManage={canManage}
          currency={center.currency}
          centerName={center.short_name || center.name}
        />
      </BlockGrid>

      <Card title="Opportunities" description="What members see in the Give tab. Drafts are visible to staff only." padded={false}>
        {opps.error ? (
          <div className="p-2.5">
            <QueryError what="opportunities" error={opps.error} retryHref="/giving/opportunities" />
          </div>
        ) : oppRows.length === 0 ? (
          <EmptyState title="No opportunities yet">Build the first one above.</EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Campaign</th>
                  <th>Type</th>
                  <th>Taken</th>
                  <th>Status</th>
                  {canManage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {oppRows.map((o) => {
                  const a = availability.get(o.id);
                  return (
                    <tr key={o.id} data-highlight={o.id === editId ? "" : undefined}>
                      <td className="font-semibold">
                        {o.name}
                        {o.subtitle ? <div className="text-xs font-normal text-muted">{o.subtitle}</div> : null}
                      </td>
                      <td>{campaignName.get(o.campaign_id) ?? "—"}</td>
                      <td>{TYPE_LABEL[o.kind] ?? o.kind}</td>
                      <td className="text-[13px]">
                        {a
                          ? a.slotsTotal
                            ? `${a.slotsTaken ?? 0} of ${a.slotsTotal}`
                            : `${a.slotsTaken ?? 0} pledge${a.slotsTaken === 1 ? "" : "s"}`
                          : "—"}
                        {a?.goal !== null && a?.goal !== undefined ? <div className="text-xs text-muted">{a.goal}% of goal</div> : null}
                      </td>
                      <td>
                        {o.status === "open" ? (
                          <StatusText tone="ok">Open</StatusText>
                        ) : o.status === "draft" ? (
                          <span className="font-semibold text-muted">Draft</span>
                        ) : (
                          <StatusText tone="warn">{o.status === "taken" ? "Taken" : "Closed"}</StatusText>
                        )}
                      </td>
                      {canManage ? (
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            <Link href={`/giving/opportunities?edit=${o.id}`} className={buttonClass("ghost", "xs")}>
                              Edit
                            </Link>
                            {o.status === "open" ? (
                              <StatusButton id={o.id} status="closed" label="Close" />
                            ) : (
                              <StatusButton id={o.id} status="open" label={o.status === "draft" ? "Publish" : "Reopen"} />
                            )}
                          </div>
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
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <ActionForm action={setOpportunityStatusAction} submitLabel={label} pendingLabel="Saving…" variant={status === "closed" ? "bad" : "ok"} size="xs">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
    </ActionForm>
  );
}
