import type { Metadata } from "next";

import { Card, ChipLinks, EmptyState, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { moduleLabelFor } from "@/lib/modules";
import { REQUEST_STATUS_LABEL, emailStatusText, orgTypeLabel } from "@/lib/platform-onboarding";
import { formatPhone } from "@/lib/security";
import { getSession } from "@/lib/session";

import { CodeForm } from "../_components/code-form";
import { DrawerButton } from "../_components/drawer-button";
import { decideRequestAction } from "../onboarding-actions";
import { PlatformNoAccess } from "../platform-no-access";

export const metadata: Metadata = { title: "Requests · Platform" };

const FILTERS = [
  { key: "open", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
  { key: "all", label: "All" },
];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Access requests · approve (a sandbox code is issued), decline with a reason, or ask for more information" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.status) ? String(sp.status) : "open";
  let q = session.db.from("access_requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (filter === "open") q = q.in("status", ["new", "more_info"]);
  else if (filter !== "all") q = q.eq("status", filter);
  const res = await q;
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the access requests" error={res.error} retryHref="/platform/requests" />
      </>
    );
  }
  const rows = res.data ?? [];
  const tz = session.center.time_zone;
  return (
    <>
      {header}
      <ChipLinks label="Request status" active={filter} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: `/platform/requests?status=${f.key}` }))} />
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={filter === "open" ? "No requests waiting for review" : "No requests here"}>
              Organizations ask for access at <span className="font-mono">/request-access</span>.
            </EmptyState>
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Access requests">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Contact</th>
                  <th className="num">Households</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mail = r.decision_email_status ? emailStatusText(r.decision_email_status) : null;
                  const open = r.status === "new" || r.status === "more_info";
                  return (
                    <tr key={r.id} data-request={r.contact_email} data-status={r.status}>
                      <td className="font-bold">
                        {r.org_legal_name}
                        <p className="text-[12px] font-normal text-muted">
                          {orgTypeLabel(r.org_type)} · {r.city}, {r.state}
                        </p>
                      </td>
                      <td>
                        {r.contact_name}
                        <p className="text-[12px] text-muted">{r.contact_email}</p>
                      </td>
                      <td className="num">{r.approx_households?.toLocaleString() ?? "—"}</td>
                      <td className="whitespace-nowrap text-[13px]">{formatDateTime(r.created_at, tz)}</td>
                      <td>
                        {r.status === "approved" ? (
                          <StatusText tone="ok">Approved</StatusText>
                        ) : r.status === "declined" ? (
                          <StatusText tone="bad">Declined</StatusText>
                        ) : r.status === "more_info" ? (
                          <StatusText tone="warn">Asked for more information</StatusText>
                        ) : (
                          <span className="font-semibold">New</span>
                        )}
                      </td>
                      <td className="text-right">
                        <DrawerButton label={open ? "Review" : "Open"} variant={open ? "primary" : "ghost"} kicker="Access request" title={r.org_legal_name} subtitle={REQUEST_STATUS_LABEL[r.status] ?? r.status}>
                          <div className="flex flex-col gap-4 text-[13px]">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                              <dt className="text-muted">Kind</dt>
                              <dd>{orgTypeLabel(r.org_type)}</dd>
                              <dt className="text-muted">Where</dt>
                              <dd>
                                {r.city}, {r.state}
                              </dd>
                              <dt className="text-muted">Households</dt>
                              <dd>{r.approx_households?.toLocaleString() ?? "—"}</dd>
                              <dt className="text-muted">Website</dt>
                              <dd className="break-all">{r.website ?? "—"}</dd>
                              <dt className="text-muted">Contact</dt>
                              <dd>
                                {r.contact_name} · {r.contact_email}
                                {r.contact_phone ? ` · ${formatPhone(r.contact_phone)}` : ""}
                              </dd>
                              <dt className="text-muted">Interested in</dt>
                              <dd>{r.modules_interested.length ? r.modules_interested.map(moduleLabelFor).join(", ") : "—"}</dd>
                              <dt className="text-muted">Uses today</dt>
                              <dd>{r.current_systems.length ? r.current_systems.join(", ") : "—"}</dd>
                              <dt className="text-muted">Heard from</dt>
                              <dd>{r.heard_from ?? "—"}</dd>
                              <dt className="text-muted">Sent from</dt>
                              <dd className="font-mono text-[12px]">{r.ip ? String(r.ip) : "unknown address"}</dd>
                            </dl>
                            {r.decision_note ? (
                              <p className="text-muted">
                                Last note: {r.decision_note} {mail ? <StatusText tone={mail.tone}>{mail.text.replace(" — the code is shown here for the Community Connect team to send by hand", " — send it by hand")}</StatusText> : null}
                              </p>
                            ) : null}
                            {open ? (
                              <CodeForm
                                action={decideRequestAction}
                                buttons={[
                                  { label: "Approve and issue a code", value: "approve", variant: "ok" },
                                  { label: "Ask for more information", value: "more_info", variant: "ghost" },
                                  { label: "Decline", value: "decline", variant: "bad" },
                                ]}
                              >
                                <input type="hidden" name="request" value={r.id} />
                                <label className="crm-label" htmlFor={`note-${r.id}`}>
                                  Note (required to decline or to ask; the contact receives it by email)
                                </label>
                                <textarea id={`note-${r.id}`} name="note" className="crm-input min-h-[70px]" maxLength={1000} />
                              </CodeForm>
                            ) : (
                              <p className="text-muted">
                                {r.status === "approved" ? "Approved. Re-issue or revoke its code under Sandbox codes." : "Declined. Nothing more to decide."}
                              </p>
                            )}
                          </div>
                        </DrawerButton>
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
