import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { BlockGrid, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { SENDER_PURPOSES, domainStatus, recordStatus } from "@/lib/messaging/labels";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { RecentMessages, SandboxNote, SuppressionsCard, TestSendCard } from "../_components/messaging-ui";
import {
  addEmailDomainAction,
  recheckEmailDomainAction,
  saveEmailFooterAction,
  saveEmailSenderAction,
  setEmailProviderAction,
} from "../messaging-actions";

export const metadata: Metadata = { title: "Email · Settings" };

type DnsRecord = { type: string; name: string; value: string; purpose: string; status: string; priority?: number | null };

/**
 * Settings › Email (ONBOARDING_PLAN §4 Step 1.3): the sending service, the
 * domain with its DNS records (copy buttons; re-checked every 15 minutes until
 * they verify), the senders, the footer, suppressions and a test send.
 */
export default async function EmailSettingsPage() {
  const session = await getSession();
  const center = session.center;
  const header = <PageHeader title="Settings" description={`How ${center.short_name || center.name} sends email · sign-in codes, receipts and newsletters`} />;
  if (!canAccess(session, "messaging")) {
    return (
      <>
        {header}
        <NoAccess area="Email settings" access="messaging" />
      </>
    );
  }
  const canManage = canAccess(session, "messagingManage");
  const [settingsRes, domainsRes, sendersRes, connRes] = await Promise.all([
    session.db.from("messaging_settings").select("email_provider, footer_postal_address, footer_note, last_test_at, last_test_channel, last_test_status").eq("center_id", center.id).maybeSingle(),
    session.db.from("email_domains").select("id, domain, provider, status, dns_records, last_checked_at, verified_at, last_error").eq("center_id", center.id).order("created_at"),
    session.db.from("email_senders").select("purpose, from_name, from_address, reply_to, verified").eq("center_id", center.id),
    session.db.from("integration_connections").select("provider, status, settings").eq("center_id", center.id).in("provider", ["resend", "postmark"]),
  ]);
  const provider = settingsRes.data?.email_provider ?? "resend";
  const senders = new Map((sendersRes.data ?? []).map((s) => [s.purpose, s]));
  const domains = domainsRes.data ?? [];
  const mode = (connRes.data ?? []).find((c) => c.provider === provider && c.status === "connected");
  const modeText = mode && typeof mode.settings === "object" && mode.settings && !Array.isArray(mode.settings) ? String((mode.settings as Record<string, unknown>).mode ?? "") : "";

  return (
    <>
      {header}
      <SandboxNote session={session} />
      <BlockGrid>
        <Card span={5} title="Email service" description="Community Connect's own account sends for you; nothing technical to set up">
          {settingsRes.error ? <QueryError what="the email settings" error={settingsRes.error} retryHref="/settings/email" /> : null}
          <p className="mb-2 text-[13px]">
            {mode ? (
              <StatusText tone="ok">
                {provider === "resend" ? "Resend" : "Postmark"} · {modeText === "test" ? "test mode (sandbox)" : "live"}
              </StatusText>
            ) : (
              <StatusText tone="warn">Not chosen yet · Resend is used by default</StatusText>
            )}
          </p>
          {canManage ? (
            <ActionForm action={setEmailProviderAction} submitLabel="Save" size="sm" className="flex flex-wrap items-end gap-2" confirmMessage="Change the email service? Your domains are added to the new service and must verify again.">
              <label>
                <span className="crm-label">Service</span>
                <select name="provider" className="crm-input" defaultValue={provider}>
                  <option value="resend">Resend (recommended)</option>
                  <option value="postmark">Postmark</option>
                </select>
              </label>
              <label className="min-w-[10rem] flex-1">
                <span className="crm-label">Reason</span>
                <input name="reason" className="crm-input" placeholder="Why the change" />
              </label>
            </ActionForm>
          ) : null}
        </Card>

        <TestSendCard
          channel="email"
          title="Send a test email"
          hint={
            settingsRes.data?.last_test_at && settingsRes.data.last_test_channel === "email"
              ? `Last test ${formatDateTime(settingsRes.data.last_test_at, center.time_zone)}: ${settingsRes.data.last_test_status ?? "queued"}`
              : "Goes to your own sign-in email unless you type another address"
          }
          placeholder="you@example.org"
          canSend={canAccess(session, "messagingTest")}
        />

        <Card span={12} title="Sending domain" description="Add the domain your email comes from (for example mail.example.org), then add these records at your DNS host. We check again every 15 minutes." padded={false}>
          <div className="px-3">
            {domainsRes.error ? (
              <QueryError what="the domains" error={domainsRes.error} retryHref="/settings/email" />
            ) : domains.length === 0 ? (
              <EmptyState title="No sending domain yet">Until one verifies, email goes from Community Connect&apos;s address in your community&apos;s name.</EmptyState>
            ) : (
              domains.map((d) => {
                const st = domainStatus(d.status);
                const records = (Array.isArray(d.dns_records) ? d.dns_records : []) as DnsRecord[];
                return (
                  <div key={d.id} className="mb-4 border-b border-line-soft pb-3">
                    <div className="flex flex-wrap items-center gap-2 py-2">
                      <span className="font-mono text-[14px] font-bold">{d.domain}</span>
                      <StatusText tone={st.tone}>{st.label}</StatusText>
                      <span className="text-[12px] text-muted">
                        {d.last_checked_at ? `Checked ${formatDateTime(d.last_checked_at, center.time_zone)}` : "Not checked yet — the background service adds it at the provider"}
                        {d.verified_at ? ` · verified ${formatDateTime(d.verified_at, center.time_zone)}` : ""}
                      </span>
                      {canManage ? (
                        <ActionForm action={recheckEmailDomainAction} submitLabel="Check again" variant="ghost" size="xs">
                          <input type="hidden" name="id" value={d.id} />
                        </ActionForm>
                      ) : null}
                    </div>
                    {d.last_error && d.status !== "verified" ? <p className="mb-2 text-[12px] text-muted">{d.last_error}</p> : null}
                    {records.length === 0 ? (
                      <p className="text-[13px] text-muted">The DNS records appear here once the provider has the domain (usually within a minute).</p>
                    ) : (
                      <TableWrap>
                        <table className="crm-table">
                          <thead>
                            <tr>
                              <th>For</th>
                              <th>Type</th>
                              <th>Name (host)</th>
                              <th>Value</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((r, i) => {
                              const rs = recordStatus(r.status);
                              return (
                                <tr key={`${r.name}-${i}`}>
                                  <td>{r.purpose}</td>
                                  <td>
                                    {r.type}
                                    {r.priority != null ? ` · priority ${r.priority}` : ""}
                                  </td>
                                  <td>
                                    <span className="break-all font-mono text-[12px]">{r.name}</span> <CopyButton value={r.name} />
                                  </td>
                                  <td>
                                    <span className="break-all font-mono text-[12px]">{r.value}</span> <CopyButton value={r.value} />
                                  </td>
                                  <td>
                                    <StatusText tone={rs.tone}>{rs.label}</StatusText>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </TableWrap>
                    )}
                  </div>
                );
              })
            )}
            {canManage ? (
              <ActionForm action={addEmailDomainAction} submitLabel="Add domain" size="sm" resetOnSuccess className="flex flex-wrap items-end gap-2 pb-3">
                <label className="min-w-[14rem] flex-1">
                  <span className="crm-label">Domain</span>
                  <input name="domain" className="crm-input" placeholder="mail.example.org" autoComplete="off" />
                </label>
                <label className="min-w-[12rem] flex-1">
                  <span className="crm-label">Reason</span>
                  <input name="reason" className="crm-input" placeholder="Our sending domain" />
                </label>
              </ActionForm>
            ) : null}
          </div>
        </Card>

        <Card span={7} title="Senders" description="Who each kind of email comes from · an address must be on a verified sending domain to be used">
          {sendersRes.error ? <QueryError what="the senders" error={sendersRes.error} retryHref="/settings/email" /> : null}
          <div className="space-y-4">
            {SENDER_PURPOSES.map((p) => {
              const s = senders.get(p.key);
              return (
                <div key={p.key}>
                  <p className="text-[13px] font-bold">
                    {p.label}{" "}
                    {s ? s.verified ? <StatusText tone="ok">Verified</StatusText> : <StatusText tone="warn">Domain not verified yet</StatusText> : <span className="font-normal text-muted">· not set</span>}
                  </p>
                  <p className="crm-hint">{p.hint}</p>
                  {canManage ? (
                    <ActionForm action={saveEmailSenderAction} submitLabel="Save" size="xs" className="mt-1 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="purpose" value={p.key} />
                      <label className="min-w-[9rem] flex-1">
                        <span className="crm-label">From name</span>
                        <input name="from_name" className="crm-input" defaultValue={s?.from_name ?? center.short_name ?? center.name} aria-label={`${p.label} from name`} />
                      </label>
                      <label className="min-w-[11rem] flex-1">
                        <span className="crm-label">From address</span>
                        <input name="from_address" className="crm-input" defaultValue={s?.from_address ?? ""} placeholder={`${p.key === "auth" ? "codes" : p.key}@${domains[0]?.domain ?? "mail.example.org"}`} aria-label={`${p.label} from address`} />
                      </label>
                      <label className="min-w-[11rem] flex-1">
                        <span className="crm-label">Reply-to</span>
                        <input name="reply_to" className="crm-input" defaultValue={s?.reply_to ?? ""} placeholder="office@example.org" aria-label={`${p.label} reply-to`} />
                      </label>
                    </ActionForm>
                  ) : s ? (
                    <p className="text-[13px]">
                      {s.from_name} &lt;{s.from_address}&gt;{s.reply_to ? ` · replies to ${s.reply_to}` : ""}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>

        <Card span={5} title="Footer" description="On every email: your postal address (US law requires it on newsletters). Newsletters and notifications also carry an unsubscribe link.">
          {canManage ? (
            <ActionForm action={saveEmailFooterAction} submitLabel="Save footer" size="sm">
              <label className="block">
                <span className="crm-label">Postal address</span>
                <input name="postal_address" className="crm-input" defaultValue={settingsRes.data?.footer_postal_address ?? ""} placeholder="123 Temple Rd, Houston TX 77001" />
              </label>
              <label className="mt-2 block">
                <span className="crm-label">Extra line (optional)</span>
                <input name="note" className="crm-input" defaultValue={settingsRes.data?.footer_note ?? ""} placeholder="A 501(c)(3) non-profit" />
              </label>
              <label className="mt-2 block">
                <span className="crm-label">Reason</span>
                <input name="reason" className="crm-input" placeholder="Footer for newsletters" />
              </label>
            </ActionForm>
          ) : (
            <p className="text-[13px]">{settingsRes.data?.footer_postal_address ?? "No postal address yet."}</p>
          )}
        </Card>

        <SuppressionsCard session={session} channels={["email"]} canManage={canManage} />
        <RecentMessages session={session} channels={["email"]} title="Recent emails" />
      </BlockGrid>
    </>
  );
}
