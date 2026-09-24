import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { metaStatus } from "@/lib/messaging/labels";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { RecentMessages, SandboxNote, TestSendCard } from "../_components/messaging-ui";
import { saveWhatsAppAction, submitWhatsAppTemplateAction } from "../messaging-actions";

export const metadata: Metadata = { title: "WhatsApp · Settings" };

/**
 * Settings › WhatsApp (ONBOARDING_PLAN §4 Step 1.5): the WhatsApp Business
 * account and number, and the message templates submitted for Meta's approval.
 * These are records with their status: Meta's decisions are recorded by
 * Community Connect when they arrive, never assumed.
 */
export default async function WhatsAppSettingsPage() {
  const session = await getSession();
  const center = session.center;
  const header = <PageHeader title="Settings" description={`WhatsApp Business for ${center.short_name || center.name} · community messages go over WhatsApp`} />;
  if (!canAccess(session, "messaging")) {
    return (
      <>
        {header}
        <NoAccess area="WhatsApp settings" access="messaging" />
      </>
    );
  }
  if (!isModuleEnabled(session, "comms")) {
    return (
      <>
        {header}
        <EmptyState title="Communications is switched off">WhatsApp belongs to the Communications module. Switch it on in Settings › Modules to set up WhatsApp.</EmptyState>
      </>
    );
  }
  const canManage = canAccess(session, "messagingManage");
  const [accRes, tplRes] = await Promise.all([
    session.db.from("whatsapp_accounts").select("id, waba_id, phone_number_id, display_name, status, detail, updated_at").eq("center_id", center.id).maybeSingle(),
    session.db.from("whatsapp_template_submissions").select("id, name, language, category, body, status, submitted_at, decided_at, rejection_reason").eq("center_id", center.id).order("submitted_at", { ascending: false }),
  ]);
  const acc = accRes.data;
  const detail = (acc?.detail ?? {}) as Record<string, unknown>;
  const st = metaStatus(acc?.status);

  return (
    <>
      {header}
      <SandboxNote session={session} />
      <BlockGrid>
        <Card span={7} title="WhatsApp Business account" description="Meta verifies the business, approves the number (it must not be in use in the regular WhatsApp app) and the display name. This takes days.">
          {accRes.error ? <QueryError what="the WhatsApp account" error={accRes.error} retryHref="/settings/whatsapp" /> : null}
          <p className="mb-2 text-[13px]">
            <StatusText tone={st.tone}>{st.label}</StatusText>
            {acc?.updated_at ? <span className="text-muted"> · updated {formatDateTime(acc.updated_at, center.time_zone)}</span> : null}
          </p>
          {typeof detail.reviewer_note === "string" ? <p className="mb-2 text-[13px] text-muted">Meta: {detail.reviewer_note}</p> : null}
          {canManage ? (
            <ActionForm action={saveWhatsAppAction} submitLabel={acc ? "Save" : "Submit for Meta approval"} size="sm" className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <label>
                  <span className="crm-label">Display name</span>
                  <input name="display_name" className="crm-input" defaultValue={acc?.display_name ?? center.name} />
                </label>
                <label>
                  <span className="crm-label">WhatsApp number</span>
                  <input name="phone" className="crm-input" defaultValue={typeof detail.phone_e164 === "string" ? detail.phone_e164 : ""} placeholder="+1 713 555 0100" />
                </label>
                <label>
                  <span className="crm-label">WhatsApp Business account ID (if you have one)</span>
                  <input name="waba_id" className="crm-input" defaultValue={acc?.waba_id ?? ""} />
                </label>
                <label>
                  <span className="crm-label">Phone number ID (if you have one)</span>
                  <input name="phone_number_id" className="crm-input" defaultValue={acc?.phone_number_id ?? ""} />
                </label>
              </div>
              <label className="block">
                <span className="crm-label">Reason</span>
                <input name="reason" className="crm-input" placeholder="Start WhatsApp Business" />
              </label>
            </ActionForm>
          ) : null}
        </Card>

        <TestSendCard channel="whatsapp" title="Send a test WhatsApp" hint="Only once Meta approved the number · to your verified mobile unless you type one" placeholder="+1 713 555 0100" canSend={canAccess(session, "messagingTest")} />

        <Card span={12} title="Message templates" description="Messages sent outside a member's 24-hour reply window must use a template Meta approved" padded={false}>
          {tplRes.error ? (
            <div className="p-3">
              <QueryError what="the templates" error={tplRes.error} retryHref="/settings/whatsapp" />
            </div>
          ) : (tplRes.data ?? []).length === 0 ? (
            <EmptyState title="No templates submitted yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Language</th>
                    <th>Category</th>
                    <th>Text</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(tplRes.data ?? []).map((t) => {
                    const ts = metaStatus(t.status);
                    return (
                      <tr key={t.id}>
                        <td className="font-mono text-[12px]">{t.name}</td>
                        <td>{t.language}</td>
                        <td>{t.category}</td>
                        <td className="max-w-[28rem] whitespace-pre-wrap text-[13px]">{t.body}</td>
                        <td>
                          <StatusText tone={ts.tone}>{ts.label}</StatusText>
                          <span className="block text-[12px] text-muted">Submitted {formatDateTime(t.submitted_at, center.time_zone)}</span>
                          {t.rejection_reason ? <span className="block text-[12px] text-danger">{t.rejection_reason}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {canManage && acc ? (
            <div className="px-3 pb-3">
              <ActionForm action={submitWhatsAppTemplateAction} submitLabel="Submit template" size="sm" resetOnSuccess className="grid gap-2 sm:grid-cols-4">
                <label>
                  <span className="crm-label">Name</span>
                  <input name="name" className="crm-input" placeholder="event_reminder" />
                </label>
                <label>
                  <span className="crm-label">Language</span>
                  <select name="language" className="crm-input" defaultValue="en">
                    <option value="en">English</option>
                    <option value="gu">Gujarati</option>
                    <option value="hi">Hindi</option>
                  </select>
                </label>
                <label>
                  <span className="crm-label">Category</span>
                  <select name="category" className="crm-input" defaultValue="utility">
                    <option value="utility">Utility (reminders, updates)</option>
                    <option value="marketing">Marketing (appeals, newsletters)</option>
                    <option value="authentication">Authentication (codes)</option>
                  </select>
                </label>
                <label>
                  <span className="crm-label">Reason</span>
                  <input name="reason" className="crm-input" placeholder="Reminder template" />
                </label>
                <label className="sm:col-span-4">
                  <span className="crm-label">Text ({"{{1}}"}, {"{{2}}"} for the values)</span>
                  <textarea name="body" className="crm-input min-h-[4rem]" placeholder="Reminder: {{1}} starts at {{2}}." />
                </label>
              </ActionForm>
            </div>
          ) : null}
        </Card>
        <RecentMessages session={session} channels={["whatsapp"]} title="Recent WhatsApp messages" />
      </BlockGrid>
    </>
  );
}
