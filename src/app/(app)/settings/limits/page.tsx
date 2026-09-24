import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { entitlementLabel, formatEntitlement } from "@/lib/tenancy";

import { addTestRecipientAction, removeTestRecipientAction } from "./actions";

export const metadata: Metadata = { title: "Plan & limits · Settings" };

const CHANNEL_LABEL: Record<string, string> = { email: "Email", sms: "Text", whatsapp: "WhatsApp", push: "Push" };

/**
 * Settings › Plan & limits: what this community may do (entitlements, set by
 * Community Connect) and, for sandboxes, the verified test recipients that
 * messages may reach.
 */
export default async function LimitsPage() {
  const session = await getSession();
  const center = session.center;
  const sandbox = center.environment === "sandbox";
  const header = (
    <PageHeader
      title="Settings"
      description={
        sandbox
          ? `${center.name} is a sandbox · limits are set by Community Connect and lift when the community goes live`
          : `What ${center.short_name || center.name}'s plan includes · limits are set by Community Connect`
      }
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Plan & limits" access="centerSettings" />
      </>
    );
  }
  const [entRes, recRes, peopleRes, householdsRes] = await Promise.all([
    session.db.rpc("center_entitlement_list", { p_center: center.id }),
    session.db.from("sandbox_test_recipients").select("id, channel, address, verified_at, created_at").eq("center_id", center.id).order("created_at"),
    session.db.from("people").select("id", { count: "exact", head: true }).eq("center_id", center.id).is("merged_into_id", null),
    session.db.from("households").select("id", { count: "exact", head: true }).eq("center_id", center.id),
  ]);
  const used: Record<string, number | null> = {
    max_people: peopleRes.error ? null : (peopleRes.count ?? 0),
    max_households: householdsRes.error ? null : (householdsRes.count ?? 0),
  };
  if (peopleRes.error) console.error("[settings/limits] could not count people:", peopleRes.error);
  if (householdsRes.error) console.error("[settings/limits] could not count households:", householdsRes.error);
  const recipients = recRes.data ?? [];

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={7} title="Limits" description="Ask Community Connect to change any of these" padded={false}>
          {entRes.error ? (
            <div className="p-3">
              <QueryError what="the limits" error={entRes.error} retryHref="/settings/limits" />
            </div>
          ) : (entRes.data ?? []).length === 0 ? (
            <EmptyState title="No limits are defined" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Limit</th>
                    <th>In effect</th>
                    <th>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {(entRes.data ?? []).map((e) => (
                    <tr key={e.key}>
                      <td className="font-bold">{entitlementLabel(e.key)}</td>
                      <td>
                        {formatEntitlement(e.key, e.effective)}
                        {e.override_value !== null ? <span className="block text-[12px] text-muted">Set for {center.short_name || center.name}: {e.reason}</span> : null}
                      </td>
                      <td>
                        {e.key in used
                          ? used[e.key] === null
                            ? <span className="text-muted">Could not count</span>
                            : used[e.key]!.toLocaleString("en-US")
                          : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card
          span={5}
          title="Test recipients"
          description={
            sandbox
              ? "A sandbox sends email, texts, WhatsApp and push only to these (up to 10), once each is verified"
              : "Addresses for test sends (up to 10)"
          }
        >
          {recRes.error ? (
            <QueryError what="the test recipients" error={recRes.error} retryHref="/settings/limits" />
          ) : recipients.length === 0 ? (
            <p className="mb-3 text-[13px] text-muted">No test recipients yet.</p>
          ) : (
            <ul className="mb-3 divide-y divide-line-soft text-[13px]">
              {recipients.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <span className="w-16 font-semibold">{CHANNEL_LABEL[r.channel] ?? r.channel}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{r.address}</span>
                  {r.verified_at ? (
                    <StatusText tone="ok">Verified {formatDateTime(r.verified_at, center.time_zone)}</StatusText>
                  ) : (
                    <StatusText tone="warn">Not verified yet</StatusText>
                  )}
                  <ActionForm action={removeTestRecipientAction} submitLabel="Remove" variant="bad" size="xs" confirmMessage={`Remove ${r.address} from the test recipients?`}>
                    <input type="hidden" name="id" value={r.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addTestRecipientAction} submitLabel="Add" size="sm" resetOnSuccess className="flex flex-wrap items-end gap-2">
            <label>
              <span className="crm-label">Channel</span>
              <select name="channel" className="crm-input" defaultValue="email">
                <option value="email">Email</option>
                <option value="sms">Text</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="push">Push</option>
              </select>
            </label>
            <label className="min-w-[12rem] flex-1">
              <span className="crm-label">Address</span>
              <input name="address" className="crm-input" placeholder="tester@example.org or +1 713 555 0100" autoComplete="off" />
            </label>
          </ActionForm>
          <p className="crm-hint mt-2">
            Verification (a code sent to the address) arrives with the message sender. Until then, messages to unverified addresses are held back.
          </p>
        </Card>
      </BlockGrid>
    </>
  );
}
