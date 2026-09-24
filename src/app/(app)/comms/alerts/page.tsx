import type { Metadata } from "next";

import { DrawerForm } from "@/components/drawer-form";
import { RowActions } from "@/components/row-actions";
import { Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { describeAudience } from "@/lib/comms";
import { audienceOptions } from "@/lib/data/content-comms";
import { formatDateTime } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { createAlertAction, endAlertAction } from "../actions";
import { AudienceChips } from "../audience-chips";
import { audienceNames, CommsHeader, commsGate } from "../shared";

export const metadata: Metadata = { title: "Communications · Alerts" };

const SUB = "Time-critical notices (closures, weather) shown at the top of the member app";
const SEVERITY: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  info: { label: "Info", tone: "ok" },
  important: { label: "Important", tone: "warn" },
  urgent: { label: "Urgent", tone: "bad" },
};

export default async function AlertsPage() {
  const session = await getSession();
  const gate = commsGate(session, "comms", SUB);
  if (gate) return gate;
  const { db, center } = session;
  const tz = center.time_zone;
  const canSend = canAccess(session, "commsSend");
  const [alerts, opts] = await Promise.all([
    db.from("alerts").select("*").eq("center_id", center.id).order("starts_at", { ascending: false }).limit(50),
    audienceOptions(db, center.id),
  ]);
  const names = audienceNames(opts.data);
  const nowIso = new Date().toISOString();

  return (
    <>
      <CommsHeader
        sub={SUB}
        actions={
          canSend ? (
            <DrawerForm label="Post an alert" kicker="Alerts" title="Post an alert" action={createAlertAction} submitLabel="Post alert" confirmMessage="Post this alert now? Members see it at the top of the app.">
              <div>
                <label htmlFor="al-sev" className="crm-label">
                  Severity
                </label>
                <select id="al-sev" name="severity" defaultValue="important" className="crm-input">
                  <option value="info">Info</option>
                  <option value="important">Important</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label htmlFor="al-title" className="crm-label">
                  Title
                </label>
                <input id="al-title" name="title" required className="crm-input" />
              </div>
              <div>
                <label htmlFor="al-body" className="crm-label">
                  Message
                </label>
                <textarea id="al-body" name="body" required rows={3} className="crm-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="al-start" className="crm-label">
                    Starts
                  </label>
                  <input id="al-start" type="datetime-local" name="starts_at" className="crm-input" />
                  <p className="crm-hint">Blank = now</p>
                </div>
                <div>
                  <label htmlFor="al-end" className="crm-label">
                    Ends
                  </label>
                  <input id="al-end" type="datetime-local" name="ends_at" className="crm-input" />
                </div>
              </div>
              <AudienceChips zones={opts.data.zones} classes={opts.data.classes} events={opts.data.events} />
            </DrawerForm>
          ) : null
        }
      />
      <Card padded={false}>
        {alerts.error ? (
          <div className="p-4">
            <QueryError what="the alerts" error={alerts.error} retryHref="/comms/alerts" />
          </div>
        ) : (alerts.data ?? []).length === 0 ? (
          <EmptyState title="No alerts" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Alert</th>
                  <th>Severity</th>
                  <th>Audience</th>
                  <th>Showing</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(alerts.data ?? []).map((a) => {
                  const live = a.starts_at <= nowIso && (!a.ends_at || a.ends_at > nowIso);
                  const future = a.starts_at > nowIso;
                  const sev = SEVERITY[a.severity] ?? { label: a.severity, tone: "warn" as const };
                  return (
                    <tr key={a.id}>
                      <td className="font-bold">
                        {a.title}
                        <div className="line-clamp-2 text-xs font-normal text-ink-2">{a.body}</div>
                      </td>
                      <td>
                        <StatusText tone={sev.tone}>{sev.label}</StatusText>
                      </td>
                      <td>{describeAudience(a.audience, names)}</td>
                      <td className="text-[13px]">
                        {formatDateTime(a.starts_at, tz)}
                        {a.ends_at ? ` → ${formatDateTime(a.ends_at, tz)}` : ""}
                      </td>
                      <td>{live ? <StatusText tone="ok">Showing</StatusText> : future ? <StatusText tone="warn">Scheduled</StatusText> : <span className="text-muted">Ended</span>}</td>
                      <td className="text-right">
                        {(live || future) && canSend ? (
                          <RowActions action={endAlertAction} fields={{ id: a.id }} buttons={[{ label: "End now", value: "end", variant: "bad", confirm: "Stop showing this alert?" }]} />
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
