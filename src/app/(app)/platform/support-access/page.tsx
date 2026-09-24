import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Alert, Card, EmptyState, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { supportState } from "@/lib/platform-onboarding";
import { getSession } from "@/lib/session";

import { endSupportGrantAction } from "../onboarding-actions";
import { PlatformNoAccess } from "../platform-no-access";

export const metadata: Metadata = { title: "Support access · Platform" };

export default async function SupportAccessPage() {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Support access · time-boxed, granted by each organization's owner, fully audited" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const res = await session.db.from("support_grants").select("*").order("granted_at", { ascending: false }).limit(200);
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the support grants" error={res.error} retryHref="/platform/support-access" />
      </>
    );
  }
  const rows = res.data ?? [];
  const centerIds = [...new Set(rows.map((r) => r.center_id))];
  const cents = centerIds.length ? await session.db.from("centers").select("id, name, slug").in("id", centerIds) : null;
  if (cents?.error) console.error("[platform] could not load the organizations' names:", cents.error);
  const centerOf = new Map((cents?.data ?? []).map((c) => [c.id, { name: c.name, slug: String(c.slug) }]));
  const tz = session.center.time_zone;
  return (
    <>
      {header}
      <div className="mb-4">
        <Alert tone="info" title="What a grant does today">
          A grant is the organization owner&apos;s recorded, time-boxed consent for Community Connect to help inside their organization. Platform admins&apos; database
          access is not yet limited to live grants — that change waits for an owner decision.
        </Alert>
      </div>
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No support access has been granted">An owner grants it in Settings › Support access.</EmptyState>
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Support grants">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Given to</th>
                  <th>Reason</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => {
                  const state = supportState(g);
                  const mine = g.grantee_user_id === session.userId;
                  return (
                    <tr key={g.id} data-state={state}>
                      <td className="font-bold">
                        {centerOf.get(g.center_id)?.name ?? "Unknown"}
                        <p className="font-mono text-[11px] font-normal text-muted">{centerOf.get(g.center_id)?.slug}</p>
                      </td>
                      <td>{mine ? "You" : "Another Community Connect admin"}</td>
                      <td className="max-w-[280px] text-[13px]">{g.reason}</td>
                      <td className="whitespace-nowrap text-[12px]">
                        {formatDateTime(g.granted_at, tz)}
                        <p className="text-muted">until {formatDateTime(g.expires_at, tz)}</p>
                      </td>
                      <td>{state === "live" ? <StatusText tone="ok">Live</StatusText> : <StatusText tone="warn">{state === "ended" ? "Ended" : "Expired"}</StatusText>}</td>
                      <td className="text-right">
                        {state === "live" && mine ? (
                          <ActionForm action={endSupportGrantAction} submitLabel="End now" size="xs" variant="ghost">
                            <input type="hidden" name="grant" value={g.id} />
                          </ActionForm>
                        ) : null}
                      </td>
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
