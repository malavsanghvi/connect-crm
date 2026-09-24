import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { GOLIVE_STATUS_LABEL, goliveProgress } from "@/lib/platform-onboarding";
import { getSession } from "@/lib/session";
import { mergeReadiness } from "@/lib/setup";

import { ReadinessTable } from "../../setup/readiness/readiness-table";
import { DrawerButton } from "../_components/drawer-button";
import { decideGoliveAction } from "../onboarding-actions";
import { PlatformNoAccess } from "../platform-no-access";

export const metadata: Metadata = { title: "Go-live approvals · Platform" };

export default async function GoLivePage() {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Go-live approvals · the readiness checks with their evidence · two different Community Connect admins approve" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const { db } = session;
  const res = await db.from("golive_requests").select("*").order("requested_at", { ascending: false }).limit(100);
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the go-live requests" error={res.error} retryHref="/platform/go-live" />
      </>
    );
  }
  const rows = res.data ?? [];
  const centerIds = [...new Set(rows.map((r) => r.center_id))];
  const cents = centerIds.length ? await session.db.from("centers").select("id, name, slug").in("id", centerIds) : null;
  if (cents?.error) console.error("[platform] could not load the organizations' names:", cents.error);
  const centerOf = new Map((cents?.data ?? []).map((c) => [c.id, { name: c.name, slug: String(c.slug) }]));
  const open = rows.filter((r) => r.status === "requested");
  const live = await Promise.all(
    open.map(async (r) => {
      const x = await db.rpc("readiness", { p_center: r.center_id });
      if (x.error) console.error(`[platform/go-live] could not run readiness for ${r.center_id}:`, x.error);
      return [r.id, x.error ? null : mergeReadiness(x.data ?? [])] as const;
    }),
  );
  const readiness = new Map(live);
  const tz = session.center.time_zone;
  return (
    <>
      {header}
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No go-live requests yet">The organization&apos;s owner requests go-live from Setup › Go-live once every readiness check passes.</EmptyState>
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Go-live requests">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Approvals</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rows13 = readiness.get(r.id);
                  const mine = r.first_approver === session.userId;
                  return (
                    <tr key={r.id} data-golive={centerOf.get(r.center_id)?.slug} data-status={r.status}>
                      <td className="font-bold">
                        {centerOf.get(r.center_id)?.name ?? "Unknown"}
                        <p className="font-mono text-[11px] font-normal text-muted">{centerOf.get(r.center_id)?.slug}</p>
                      </td>
                      <td className="whitespace-nowrap text-[13px]">{formatDateTime(r.requested_at, tz)}</td>
                      <td>
                        <StatusText tone={r.status === "rejected" ? "bad" : r.status === "requested" ? "warn" : "ok"}>{GOLIVE_STATUS_LABEL[r.status] ?? r.status}</StatusText>
                        {r.note ? <p className="text-[11px] text-muted">{r.note}</p> : null}
                      </td>
                      <td className="text-[13px]">{goliveProgress(r)}</td>
                      <td className="text-right">
                        {r.status === "requested" ? (
                          <DrawerButton label="Review" variant="primary" kicker="Go-live approval" title={centerOf.get(r.center_id)?.name ?? "Organization"} subtitle={goliveProgress(r)}>
                            <div className="flex flex-col gap-4 text-[13px]">
                              {rows13 ? <ReadinessTable rows={rows13} links={false} /> : <p className="text-danger">The readiness checks could not be run. Reload to try again.</p>}
                              {mine ? (
                                <p className="rounded-[10px] bg-canvas px-3 py-2 text-muted">You gave the first approval. A second, different Community Connect admin must approve.</p>
                              ) : null}
                              <ActionForm
                                action={decideGoliveAction}
                                submitLabel="Send back"
                                variant="warn"
                                extraButtons={
                                  <button type="submit" name="decision" value="approve" className="cc-btn cc-btn-ok" data-variant="ok" disabled={mine}>
                                    {r.first_approver ? "Approve (second)" : "Approve (first)"}
                                  </button>
                                }
                              >
                                <input type="hidden" name="request" value={r.id} />
                                <label className="crm-label" htmlFor={`gl-${r.id}`}>
                                  Note (required to send back)
                                </label>
                                <textarea id={`gl-${r.id}`} name="note" className="crm-input mb-3 min-h-[70px]" maxLength={1000} />
                              </ActionForm>
                            </div>
                          </DrawerButton>
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
