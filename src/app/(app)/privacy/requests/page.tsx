import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, EmptyState, NoAccess, PageHeader, Pagination, QueryError, TableWrap, Tabs } from "@/components/ui";
import { peopleById, userNames } from "@/lib/data/lookups";
import { daysBetween, formatDate, todayInTz } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { updateDataRequestAction } from "./actions";

export const metadata: Metadata = { title: "Privacy requests" };

const PAGE_SIZE = 50;
const VIEWS = { open: ["open", "in_progress"], completed: ["completed"], rejected: ["rejected"], all: [] as string[] } as const;
type View = keyof typeof VIEWS;
const KIND_LABEL: Record<string, string> = {
  export: "Export my data",
  deletion: "Delete my account",
  deactivation: "Deactivate my account",
  reactivation: "Reactivate my account",
};

export default async function PrivacyRequestsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Privacy requests"
      description="Data export, deletion and account requests from members. Each must be handled by its due date (30 days). Deletion removes app data; financial records are kept 7 years, then anonymized."
    />
  );
  if (!canAccess(session, "privacy")) {
    return (
      <>
        {header}
        <NoAccess area="Privacy requests" access="privacy" />
      </>
    );
  }
  const sp = await searchParams;
  const viewParam = param(sp, "view");
  const view: View = viewParam && viewParam in VIEWS ? (viewParam as View) : "open";
  const page = pageParam(sp);
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);

  let q = db
    .from("data_requests")
    .select("id, person_id, requested_by, kind, status, due_on, handled_by, completed_at, export_path, created_at", { count: "exact" })
    .eq("center_id", center.id);
  const statuses = VIEWS[view] as readonly string[];
  if (statuses.length > 0) q = q.in("status", [...statuses]);
  const from = (page - 1) * PAGE_SIZE;
  const res = await q.order("due_on", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];
  const [people, handlers] = await Promise.all([
    peopleById(db, rows.map((r) => r.person_id)),
    userNames(db, center.id, [...rows.map((r) => r.handled_by), ...rows.map((r) => r.requested_by)]),
  ]);

  return (
    <>
      {header}
      <div className="mb-4">
        <Alert tone="info">
          Marking a request complete records the decision. The export bundle and the deletion itself are produced by the privacy service (edge
          function); paste the export file path here when it is ready.
        </Alert>
      </div>
      <Tabs
        active={view}
        tabs={(Object.keys(VIEWS) as View[]).map((v) => ({
          key: v,
          label: v === "open" ? "Open" : v[0].toUpperCase() + v.slice(1),
          href: hrefWith("/privacy/requests", {}, { view: v }),
        }))}
      />
      {res.error ? (
        <QueryError what="privacy requests" error={res.error} retryHref={hrefWith("/privacy/requests", sp, {})} />
      ) : (
        <Card padded={false}>
          {rows.length === 0 ? (
            <EmptyState title="No requests here" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Request</th>
                    <th>Received</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Handled by</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const left = daysBetween(today, r.due_on);
                    const open = r.status === "open" || r.status === "in_progress";
                    return (
                      <tr key={r.id}>
                        <td>
                          <Link href={`/people/${r.person_id}`} className="crm-link">
                            {people.map.get(r.person_id)?.name ?? "Person"}
                          </Link>
                          <div className="font-mono text-xs text-muted">{people.map.get(r.person_id)?.member_number ?? ""}</div>
                          {r.requested_by ? (
                            <div className="text-xs text-muted">asked by {handlers.get(r.requested_by)?.name ?? "the account holder"}</div>
                          ) : null}
                        </td>
                        <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                        <td className="whitespace-nowrap">{formatDate(r.created_at, tz)}</td>
                        <td className="whitespace-nowrap">
                          {formatDate(r.due_on, tz)}
                          {open ? (
                            <div className={`text-xs ${left < 0 ? "font-semibold text-maroon" : left <= 7 ? "text-brown" : "text-muted"}`}>
                              {left < 0 ? `${-left} days overdue` : left === 0 ? "due today" : `${left} days left`}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <Badge tone={r.status === "completed" ? "success" : r.status === "rejected" ? "neutral" : r.status === "in_progress" ? "navy" : "warning"}>
                            {r.status.replace("_", " ")}
                          </Badge>
                          {r.completed_at ? <div className="text-xs text-muted">{formatDate(r.completed_at, tz)}</div> : null}
                          {r.export_path ? <div className="font-mono text-xs text-muted">{r.export_path}</div> : null}
                        </td>
                        <td className="text-[0.8125rem]">{r.handled_by ? (handlers.get(r.handled_by)?.name ?? "staff") : "—"}</td>
                        <td className="min-w-[13rem] space-y-1">
                          {r.status === "open" ? <Move id={r.id} status="in_progress" label="Start" /> : null}
                          {open ? (
                            <details>
                              <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-navy">Finish…</summary>
                              <div className="mt-2 space-y-2">
                                <ActionForm action={updateDataRequestAction} submitLabel="Mark complete" pendingLabel="Saving…" variant="success" size="sm">
                                  <input type="hidden" name="id" value={r.id} />
                                  <input type="hidden" name="status" value="completed" />
                                  {r.kind === "export" ? (
                                    <>
                                      <label htmlFor={`ep-${r.id}`} className="crm-label">
                                        Export file path
                                      </label>
                                      <input id={`ep-${r.id}`} name="export_path" className="crm-input mb-2" />
                                    </>
                                  ) : null}
                                </ActionForm>
                                <Move id={r.id} status="rejected" label="Reject" danger />
                              </div>
                            </details>
                          ) : null}
                          {r.status === "in_progress" ? <Move id={r.id} status="open" label="Back to open" /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/privacy/requests", sp, { page: n })} />
        </Card>
      )}
    </>
  );
}

function Move({ id, status, label, danger }: { id: string; status: string; label: string; danger?: boolean }) {
  return (
    <ActionForm
      action={updateDataRequestAction}
      submitLabel={label}
      pendingLabel="Saving…"
      variant={danger ? "danger" : "secondary"}
      size="sm"
      confirmMessage={danger ? "Reject this request? The member should be told why." : undefined}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
    </ActionForm>
  );
}
