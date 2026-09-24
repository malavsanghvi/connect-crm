import type { Metadata } from "next";
import Link from "next/link";

import { RowActions } from "@/components/row-actions";
import { BlockGrid, Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { campaignStatusLabel, campaignStatusTone, describeAudience, openRate, refCode } from "@/lib/comms";
import { audienceOptions } from "@/lib/data/content-comms";
import { userNames } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { approveCampaignAction } from "../actions";
import { NewsletterCompose } from "../newsletter-form";
import { audienceNames, CommsHeader, commsGate } from "../shared";

export const metadata: Metadata = { title: "Communications · Newsletters" };

const SUB = "Newsletters by email with a push teaser and in-app archive · every email has topic unsubscribe";

export default async function NewslettersPage() {
  const session = await getSession();
  const gate = commsGate(session, "comms", SUB);
  if (gate) return gate;
  const { db, center } = session;
  const tz = center.time_zone;
  const canSend = canAccess(session, "commsSend");
  const canApprove = canAccess(session, "commsApprove");

  const [campaigns, opts] = await Promise.all([
    db.from("comms_campaigns").select("*").eq("center_id", center.id).neq("kind", "alert").order("created_at", { ascending: false }).limit(100),
    audienceOptions(db, center.id),
  ]);
  const list = campaigns.data ?? [];
  const people = await userNames(db, center.id, list.map((c) => c.created_by));
  const names = audienceNames(opts.data);

  return (
    <>
      <CommsHeader sub={SUB} />
      <BlockGrid>
        {canSend ? (
          <>
            {opts.error ? (
              <div className="col-span-12">
                <QueryError what="the audience lists" error={opts.error} retryHref="/comms/newsletters" />
              </div>
            ) : null}
            <NewsletterCompose options={opts.data} canApprove={canApprove} myEmail={session.email} />
          </>
        ) : (
          <p className="col-span-12 text-[13px] text-muted">Your role can read newsletters but not write them (needs comms.send).</p>
        )}
        <Card title="Recent" span={12} padded={false}>
          {campaigns.error ? (
            <div className="p-4">
              <QueryError what="recent newsletters" error={campaigns.error} retryHref="/comms/newsletters" />
            </div>
          ) : list.length === 0 ? (
            <EmptyState title="No newsletters yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Audience</th>
                    <th>Status</th>
                    <th>By</th>
                    <th>Sent</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const rate = openRate(c.recipients_count, c.opened_count);
                    const awaiting = c.status === "draft" || c.status === "pending_approval";
                    const iFirst = c.status === "pending_approval" && c.approved_by === session.userId;
                    return (
                      <tr key={c.id}>
                        <td className="font-mono whitespace-nowrap">{refCode("NL", c.id)}</td>
                        <td className="font-bold">
                          <Link href={`/comms/campaigns/${c.id}`} className="crm-link">
                            {c.name || c.title}
                          </Link>
                        </td>
                        <td>
                          {describeAudience(c.audience, names)}
                          {c.recipients_count !== null ? ` · ${c.recipients_count.toLocaleString()} households` : ""}
                        </td>
                        <td>
                          <StatusText tone={campaignStatusTone(c.status)}>{campaignStatusLabel(c.status)}</StatusText>
                        </td>
                        <td>{c.created_by === session.userId ? "You" : (people.get(c.created_by ?? "")?.name ?? "Staff")}</td>
                        <td className="whitespace-nowrap">
                          {c.sent_at
                            ? `${formatDate(c.sent_at, tz)}${rate ? ` · ${rate}` : ""}`
                            : c.status === "scheduled" && c.scheduled_at
                              ? `Sends ${formatDate(c.scheduled_at, tz)}`
                              : "—"}
                        </td>
                        <td className="text-right">
                          {awaiting && canApprove ? (
                            iFirst ? (
                              <span className="text-xs text-muted">Needs another approver</span>
                            ) : (
                              <RowActions
                                action={approveCampaignAction}
                                fields={{ id: c.id }}
                                buttons={[{ label: "Approve", value: "approve", variant: "ok", confirm: `Approve "${c.name || c.title}"? ${describeAudience(c.audience, names)}.` }]}
                              />
                            )
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
      </BlockGrid>
    </>
  );
}
