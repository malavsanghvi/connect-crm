import { ActionForm } from "@/components/action-form";
import { Alert, Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { CHANNEL_LABEL, SUPPRESSION_REASON, messageStatus } from "@/lib/messaging/labels";
import type { CrmSession } from "@/lib/session";

import { addSuppressionAction, liftSuppressionAction, sendTestAction } from "../messaging-actions";

// Pieces the Email, Texting, WhatsApp and Notifications settings pages share.

export function SandboxNote({ session }: { session: CrmSession }) {
  if (session.center.environment !== "sandbox") return null;
  return (
    <Alert tone="warning" title="Sandbox · test data">
      This sandbox sends email, texts, WhatsApp and push only to verified test recipients (Settings › Limits), and every message carries the
      “Sandbox · test data” banner. Sign-in codes still reach whoever signs in.
    </Alert>
  );
}

export function TestSendCard({ channel, title, hint, placeholder, canSend }: { channel: "email" | "sms" | "whatsapp" | "push"; title: string; hint: string; placeholder?: string; canSend: boolean }) {
  return (
    <Card span={5} title={title} description={hint}>
      {canSend ? (
        <ActionForm action={sendTestAction} submitLabel="Send a test" size="sm" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="channel" value={channel} />
          {placeholder ? (
            <label className="min-w-[12rem] flex-1">
              <span className="crm-label">To (blank = you)</span>
              <input name="to" className="crm-input" placeholder={placeholder} autoComplete="off" />
            </label>
          ) : null}
        </ActionForm>
      ) : (
        <p className="text-[13px] text-muted">Sending a test needs settings.manage, integrations.manage or comms.send.</p>
      )}
    </Card>
  );
}

type MessageRow = { id: string; channel: string; to_address: string | null; subject: string | null; status: string; failure_reason: string | null; purpose: string | null; created_at: string; sent_at: string | null; provider: string | null };

export async function RecentMessages({ session, channels, title = "Recent messages" }: { session: CrmSession; channels: string[]; title?: string }) {
  const res = await session.db
    .from("messages")
    .select("id, channel, to_address, subject, status, failure_reason, purpose, created_at, sent_at, provider")
    .eq("center_id", session.center.id)
    .in("channel", channels as ("email" | "sms" | "push" | "whatsapp")[])
    .order("created_at", { ascending: false })
    .limit(12);
  return (
    <Card span={12} title={title} description="The newest first · the result is written back by the background service" padded={false}>
      {res.error ? (
        <div className="p-3">
          <QueryError what="the recent messages" error={res.error} />
        </div>
      ) : (res.data ?? []).length === 0 ? (
        <EmptyState title="No messages yet" />
      ) : (
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Channel</th>
                <th>To</th>
                <th>What</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {(res.data as MessageRow[]).map((m) => {
                const s = messageStatus(m.status);
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">{formatDateTime(m.created_at, session.center.time_zone)}</td>
                    <td>{CHANNEL_LABEL[m.channel] ?? m.channel}</td>
                    <td className="font-mono text-[12px]">{m.to_address}</td>
                    <td>{m.subject ?? m.purpose?.replace(/_/g, " ") ?? "—"}</td>
                    <td>
                      <StatusText tone={s.tone}>{s.label}</StatusText>
                      {m.failure_reason ? <span className="block text-[12px] text-muted">{m.failure_reason}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

type Suppression = { id: string; channel: string; address: string; reason: string; detail: string | null; created_at: string };

export async function SuppressionsCard({ session, channels, canManage }: { session: CrmSession; channels: ("email" | "sms" | "whatsapp")[]; canManage: boolean }) {
  const res = await session.db
    .from("message_suppressions")
    .select("id, channel, address, reason, detail, created_at")
    .eq("center_id", session.center.id)
    .in("channel", channels)
    .is("lifted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  return (
    <Card span={7} title="Suppressed addresses" description="Bounces, spam complaints and STOP replies stop all messages to an address; lifting one is audited">
      {res.error ? (
        <QueryError what="the suppressed addresses" error={res.error} />
      ) : (res.data ?? []).length === 0 ? (
        <p className="mb-3 text-[13px] text-muted">None — every address can be messaged.</p>
      ) : (
        <ul className="mb-3 divide-y divide-line-soft text-[13px]">
          {(res.data as Suppression[]).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-16 font-semibold">{CHANNEL_LABEL[s.channel] ?? s.channel}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{s.address}</span>
              <span className="text-muted">
                {SUPPRESSION_REASON[s.reason] ?? s.reason} · {formatDateTime(s.created_at, session.center.time_zone)}
              </span>
              {canManage ? (
                <ActionForm action={liftSuppressionAction} submitLabel="Lift" variant="ghost" size="xs" className="flex items-center gap-1">
                  <input type="hidden" name="id" value={s.id} />
                  <input name="reason" className="crm-input !h-7 w-40" placeholder="Why (required)" aria-label={`Why lift ${s.address}`} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <ActionForm action={addSuppressionAction} submitLabel="Suppress" size="sm" variant="ghost" resetOnSuccess className="flex flex-wrap items-end gap-2">
          <label>
            <span className="crm-label">Channel</span>
            <select name="channel" className="crm-input" defaultValue={channels[0]}>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[10rem] flex-1">
            <span className="crm-label">Address</span>
            <input name="address" className="crm-input" autoComplete="off" />
          </label>
          <label className="min-w-[10rem] flex-1">
            <span className="crm-label">Reason</span>
            <input name="reason" className="crm-input" placeholder="Asked not to be contacted" />
          </label>
        </ActionForm>
      ) : null}
    </Card>
  );
}
