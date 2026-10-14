import type { Metadata } from "next";
import Link from "next/link";

import { RowActions } from "@/components/row-actions";
import { BlockGrid, Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { loadCommunityLocale } from "@/lib/community-locale";
import { campaignStatusLabel, campaignStatusTone, describeAudience, openRate, refCode } from "@/lib/comms";
import { campaignMenu, isCopyableKind, RECENT_STATUSES, recentWhen, templateDefaultName, templateTokens, type RecentRow, type TemplateRow } from "@/lib/comms-templates";
import { audienceOptions } from "@/lib/data/content-comms";
import { loadChannels, loadTemplates } from "@/lib/data/comms-templates";
import { kindSchool } from "@/lib/kind";
import { userNames } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { approveCampaignAction } from "../actions";
import { CampaignActions } from "../campaign-menu";
import { NewsletterCompose } from "../newsletter-form";
import { audienceNames, CommsHeader, commsGate } from "../shared";
import { StartFrom } from "../start-from";

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

  const [campaigns, opts, community, channels, templates] = await Promise.all([
    db.from("comms_campaigns").select("*").eq("center_id", center.id).neq("kind", "alert").order("created_at", { ascending: false }).limit(100),
    audienceOptions(db, center.id, kindSchool(session.kind)),
    loadCommunityLocale(db, center),
    // Copy as new draft, Save as template and Start from: only for someone who writes communications, and only the channels the community has.
    canSend ? loadChannels(db, session) : null,
    canSend ? loadTemplates(db, center.id) : null,
  ]);
  const list = campaigns.data ?? [];
  const tplList = templates?.data ?? [];
  const people = await userNames(db, center.id, [...list.map((c) => c.created_by), ...tplList.map((t) => t.created_by)]);
  const names = audienceNames(opts.data);
  const who = (id: string | null) => (id === session.userId ? "You" : (people.get(id ?? "")?.name ?? "Staff"));
  const available = channels?.available ?? [];

  // What the Start-from picker lists: the communications that went out, are scheduled or are drafts, and the saved templates.
  const recent: RecentRow[] = list
    .filter((c) => RECENT_STATUSES.includes(c.status) && isCopyableKind(c.kind))
    .slice(0, 50)
    .map((c) => ({
      id: c.id,
      name: c.name || c.title,
      subject: c.title,
      channels: c.channels,
      audience: describeAudience(c.audience, names),
      statusLabel: campaignStatusLabel(c.status),
      when: recentWhen(c, (iso) => formatDate(iso, tz)),
      by: who(c.created_by),
    }));
  const templateRows: TemplateRow[] = tplList.map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.title,
    channels: t.channels,
    tokens: templateTokens(t),
    by: who(t.created_by),
    when: `Saved ${formatDate(t.updated_at, tz)}`,
  }));

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
            {community.note ? <p className="col-span-12 text-[13px] text-muted">{community.note}</p> : null}
            {channels?.error ? (
              <div className="col-span-12">
                <QueryError what="which channels are set up (text and WhatsApp copies are hidden until it loads)" error={channels.error} retryHref="/comms/newsletters" />
              </div>
            ) : null}
            {templates?.error ? (
              <div className="col-span-12">
                <QueryError what="the saved templates" error={templates.error} retryHref="/comms/newsletters" />
              </div>
            ) : null}
            <StartFrom recent={recent} templates={templateRows} available={available} />
            <NewsletterCompose options={opts.data} canApprove={canApprove} myEmail={session.email} languages={community.languages} />
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
                        <td>{who(c.created_by)}</td>
                        <td className="whitespace-nowrap">
                          {c.sent_at
                            ? `${formatDate(c.sent_at, tz)}${rate ? ` · ${rate}` : ""}`
                            : c.status === "scheduled" && c.scheduled_at
                              ? `Sends ${formatDate(c.scheduled_at, tz)}`
                              : "—"}
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
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
                            <CampaignActions
                              layout="menu"
                              campaign={{ id: c.id, label: c.name || c.title, defaultTemplateName: templateDefaultName(c.name, c.title), channels: c.channels }}
                              items={campaignMenu({ canWrite: canSend, kind: c.kind, channels: c.channels, available })}
                            />
                          </div>
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
