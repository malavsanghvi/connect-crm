import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { CODE_STATE_LABEL, codeState, emailStatusText } from "@/lib/platform-onboarding";
import { getSession } from "@/lib/session";

import { CodeForm } from "../_components/code-form";
import { DrawerButton } from "../_components/drawer-button";
import { reissueCodeAction, revokeCodeAction } from "../onboarding-actions";
import { PlatformNoAccess } from "../platform-no-access";

export const metadata: Metadata = { title: "Sandbox codes · Platform" };

export default async function CodesPage() {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Sandbox codes · single use, bound to the contact's email, 14 days · re-issue, revoke, see redemptions" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const res = await session.db
    .from("sandbox_codes")
    .select("id, request_id, code_last4, email, expires_at, issued_at, issue_reason, redeemed_at, revoked_at, revoke_reason, email_status, center_id")
    .order("issued_at", { ascending: false })
    .limit(300);
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the sandbox codes" error={res.error} retryHref="/platform/codes" />
      </>
    );
  }
  const rows = res.data ?? [];
  const reqIds = [...new Set(rows.map((r) => r.request_id))];
  const centerIds = [...new Set(rows.map((r) => r.center_id).filter((x): x is string => Boolean(x)))];
  const [reqs, cents] = await Promise.all([
    reqIds.length ? session.db.from("access_requests").select("id, org_legal_name").in("id", reqIds) : null,
    centerIds.length ? session.db.from("centers").select("id, slug").in("id", centerIds) : null,
  ]);
  if (reqs?.error) console.error("[platform/codes] could not load the requests:", reqs.error);
  if (cents?.error) console.error("[platform/codes] could not load the sandboxes:", cents.error);
  const orgOf = new Map((reqs?.data ?? []).map((x) => [x.id, x.org_legal_name]));
  const slugOf = new Map((cents?.data ?? []).map((x) => [x.id, String(x.slug)]));
  const tz = session.center.time_zone;
  const redeemedRequests = new Set(rows.filter((r) => r.redeemed_at).map((r) => r.request_id));
  const newestPerRequest = new Set<string>();
  const newest = rows.filter((r) => (newestPerRequest.has(r.request_id) ? false : (newestPerRequest.add(r.request_id), true))).map((r) => r.id);
  return (
    <>
      {header}
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No sandbox codes yet">Approving an access request issues its code.</EmptyState>
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Sandbox codes">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Organization · email</th>
                  <th>Issued</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const state = codeState(r);
                  const mail = emailStatusText(r.email_status);
                  const org = orgOf.get(r.request_id) ?? (reqs?.error ? "Organization could not be loaded" : "Unknown request");
                  return (
                    <tr key={r.id} data-code-last4={r.code_last4} data-state={state}>
                      <td className="font-mono text-[13px]">CC-SBX-····-{r.code_last4}</td>
                      <td>
                        <span className="font-bold">{org}</span>
                        <p className="text-[12px] text-muted">{r.email}</p>
                      </td>
                      <td className="whitespace-nowrap text-[13px]">
                        {formatDateTime(r.issued_at, tz)}
                        <p className="text-[11px] text-muted">expires {formatDateTime(r.expires_at, tz)}</p>
                      </td>
                      <td>
                        {state === "used" ? (
                          <StatusText tone="ok">
                            {CODE_STATE_LABEL.used}
                            {r.center_id && slugOf.get(r.center_id) ? ` · ${slugOf.get(r.center_id)}` : ""}
                          </StatusText>
                        ) : state === "valid" ? (
                          <span className="font-semibold">{CODE_STATE_LABEL.valid}</span>
                        ) : (
                          <StatusText tone={state === "revoked" ? "bad" : "warn"}>{CODE_STATE_LABEL[state]}</StatusText>
                        )}
                        {r.redeemed_at ? <p className="text-[11px] text-muted">{formatDateTime(r.redeemed_at, tz)}</p> : null}
                        {r.revoke_reason ? <p className="text-[11px] text-muted">{r.revoke_reason}</p> : null}
                      </td>
                      <td className="max-w-[260px] text-[12px]">
                        <StatusText tone={mail.tone}>{mail.text}</StatusText>
                      </td>
                      <td className="text-right">
                        {state !== "used" && !redeemedRequests.has(r.request_id) && (state === "valid" || newest.includes(r.id)) ? (
                          <DrawerButton label="Manage" kicker="Sandbox code" title={org} subtitle={`CC-SBX-····-${r.code_last4} · ${CODE_STATE_LABEL[state]}`}>
                            <div className="flex flex-col gap-5 text-[13px]">
                              <section>
                                <p className="crm-label">Re-issue</p>
                                <p className="mb-2 text-muted">A new code is issued and emailed; this request&apos;s open code stops working.</p>
                                <CodeForm action={reissueCodeAction} buttons={[{ label: "Re-issue the code", variant: "primary" }]}>
                                  <input type="hidden" name="request" value={r.request_id} />
                                  <input name="reason" className="crm-input" maxLength={500} placeholder="Reason, e.g. the email went to spam" aria-label="Reason for re-issuing" />
                                </CodeForm>
                              </section>
                              {state === "valid" ? (
                                <section>
                                  <p className="crm-label">Revoke</p>
                                  <ActionForm action={revokeCodeAction} submitLabel="Revoke the code" variant="bad" confirmMessage="Revoke this sandbox code?\nIt stops working at once.">
                                    <input type="hidden" name="code" value={r.id} />
                                    <input name="reason" className="crm-input mb-2" maxLength={500} placeholder="Reason (goes in the audit log)" aria-label="Reason for revoking" />
                                  </ActionForm>
                                </section>
                              ) : null}
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
