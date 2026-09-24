import type { Metadata } from "next";

import { Card, EmptyState, KpiGrid, PageHeader, QueryError, Stat, StatusText, TableWrap } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { STAGE_LABEL, daysSince } from "@/lib/platform-onboarding";
import { formatPhone } from "@/lib/security";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";

export const metadata: Metadata = { title: "Onboarding pipeline · Platform" };

export default async function PipelinePage() {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Onboarding pipeline · every organization's stage, checklist progress, blockers, days in stage and owner contact" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const res = await session.db.rpc("platform_onboarding_pipeline");
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the onboarding pipeline" error={res.error} retryHref="/platform/pipeline" />
      </>
    );
  }
  const rows = res.data ?? [];
  const tz = session.center.time_zone;
  const count = (s: string) => rows.filter((r) => r.stage === s).length;
  return (
    <>
      {header}
      <div className="mb-4">
        <KpiGrid cols={4}>
          <Stat label="In sandbox" value={count("sandbox") + count("setup")} hint="Setting up" />
          <Stat label="Go-live requested" value={count("golive_requested")} tone="saffron" hint="Waiting for two approvals" />
          <Stat label="Approved" value={count("approved")} tone="success" hint="The owner promotes next" />
          <Stat label="Promoted" value={count("promoted")} tone="ink" hint="Production created" />
        </KpiGrid>
      </div>
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No organizations are onboarding" />
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Onboarding pipeline">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Stage</th>
                  <th className="num">Days in stage</th>
                  <th>Checklist</th>
                  <th>Readiness</th>
                  <th>Blockers</th>
                  <th>Owner</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.center_id} data-center={r.slug} data-stage={r.stage}>
                    <td className="font-bold">
                      {r.name}
                      <p className="font-mono text-[11px] font-normal text-muted">
                        {r.slug}
                        {r.environment === "sandbox" ? " · sandbox" : ""}
                        {r.promoted_to ? ` → ${r.promoted_to}` : ""}
                      </p>
                      {r.support_live ? <p className="text-[11px] font-semibold text-muted">Support access live</p> : null}
                    </td>
                    <td>
                      <StatusText tone={r.stage === "approved" || r.stage === "promoted" ? "ok" : r.stage === "golive_requested" ? "warn" : "warn"}>{STAGE_LABEL[r.stage] ?? r.stage}</StatusText>
                    </td>
                    <td className="num">{daysSince(r.stage_since) ?? "—"}</td>
                    <td>{r.steps_total ? `${r.steps_done} of ${r.steps_total} steps` : "Could not load"}</td>
                    <td>{r.readiness_total ? `${r.readiness_ok} of ${r.readiness_total} pass` : "Could not load"}</td>
                    <td className="max-w-[320px] text-[12px]">
                      {(r.blockers ?? []).length === 0 ? (
                        <span className="text-muted">None</span>
                      ) : (
                        <ul className="list-disc pl-4">
                          {(r.blockers ?? []).slice(0, 3).map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                          {(r.blockers ?? []).length > 3 ? <li>and {(r.blockers ?? []).length - 3} more</li> : null}
                        </ul>
                      )}
                    </td>
                    <td className="text-[13px]">
                      {r.owner_name ?? "No owner yet"}
                      {r.owner_email ? <p className="text-[12px] text-muted">{r.owner_email}</p> : null}
                      {r.owner_phone ? <p className="text-[12px] text-muted">{formatPhone(`+${r.owner_phone.replace(/^\+/, "")}`)}</p> : null}
                    </td>
                    <td className="whitespace-nowrap text-[13px]">{r.last_activity_at ? formatDate(r.last_activity_at, tz) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
