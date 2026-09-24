import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, NoAccess, PageHeader, QueryError, TableWrap, buttonClass } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { setKpiVisibilityAction } from "./actions";

export const metadata: Metadata = { title: "Community dashboard" };

const SECTION: Record<string, string> = { summary: "Summary", practice: "Practicing together", learning: "Pathshala and learning", seva: "Seva", charts: "Charts" };

export default async function CommunityDashboardSettingsPage() {
  const session = await getSession();
  const { db, center } = session;
  const href = `/c/${center.slug}`;
  const header = (
    <PageHeader
      title="Reports"
      description="Choose which KPIs appear on the public community dashboard (no sign-in)"
      actions={
        <a href={href} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
          Open public dashboard
        </a>
      }
    />
  );
  if (!canAccess(session, "publicKpis")) {
    return (
      <>
        {header}
        <NoAccess area="Community dashboard settings" access="publicKpis" />
      </>
    );
  }
  const canPublish = canAccess(session, "publicKpisManage");
  const res = await db.rpc("public_kpi_catalog", { p_center: center.id });
  const rows = res.data ?? [];
  const membersOnly = rows.filter((r) => r.visibility !== "public").length;

  return (
    <>
      {header}
      <Card
        title="Public KPIs"
        description={`Aggregates only · groups under 10 hidden · changes are audited${rows.length ? ` · ${membersOnly} kept members-only` : ""}`}
        padded={false}
      >
        {res.error ? (
          <div className="p-2.5">
            <QueryError what="the KPI list" error={res.error} retryHref="/reports/community" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No KPIs to publish" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Section</th>
                  <th>Visibility</th>
                  {canPublish ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => {
                  const pub = k.visibility === "public";
                  return (
                    <tr key={k.kpi_key}>
                      <td className="font-bold">{k.label}</td>
                      <td className="text-muted">{SECTION[k.section] ?? k.section}</td>
                      <td className={`font-bold ${pub ? "text-success" : "text-faint"}`}>{pub ? "Public" : "Members only"}</td>
                      {canPublish ? (
                        <td>
                          <ActionForm action={setKpiVisibilityAction} submitLabel={pub ? "Unpublish" : "Publish"} pendingLabel="Saving…" variant={pub ? "bad" : "ok"} size="xs">
                            <input type="hidden" name="key" value={k.kpi_key} />
                            <input type="hidden" name="label" value={k.label} />
                            <input type="hidden" name="visibility" value={pub ? "members" : "public"} />
                          </ActionForm>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {!canPublish ? <p className="px-2.5 pb-2 text-[13px] text-muted">Publishing KPIs needs settings.manage (center admin).</p> : null}
      </Card>
    </>
  );
}
