import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RowActions } from "@/components/row-actions";
import { Alert, BlockGrid, Card, KeyValueRow, NoAccess, PageHeader, QueryError, StatusText } from "@/components/ui";
import { campaignStatusLabel, campaignStatusTone, describeAudience, openRate, requiresSecondApprover, translationLanguages } from "@/lib/comms";
import { audienceOptions } from "@/lib/data/content-comms";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime, isoToLocalDateTime } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { approveCampaignAction, setCampaignStatusAction } from "../../actions";
import { NewsletterCompose } from "../../newsletter-form";
import { audienceNames } from "../../shared";

export const metadata: Metadata = { title: "Communications · Newsletter" };

const CHANNEL_LABEL: Record<string, string> = { email: "Email", push: "Push teaser", in_app: "In-app archive", sms: "SMS", whatsapp: "WhatsApp" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await getSession();
  const back = (
    <Link href="/comms/newsletters" className="crm-link">
      ← Newsletters
    </Link>
  );
  if (!canAccess(session, "comms")) {
    return (
      <>
        <PageHeader title="Communications" eyebrow={back} />
        <NoAccess area="Communications" access="comms" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const [res, opts] = await Promise.all([db.from("comms_campaigns").select("*").eq("id", id).maybeSingle(), audienceOptions(db, center.id)]);
  if (res.error) {
    return (
      <>
        <PageHeader title="Communications" eyebrow={back} />
        <QueryError what="the newsletter" error={res.error} retryHref={`/comms/campaigns/${id}`} />
      </>
    );
  }
  const c = res.data;
  if (!c) notFound();
  const people = await userNames(db, center.id, [c.created_by, c.approved_by, c.second_approver]);
  const who = (uid: string | null) => (uid === session.userId ? "You" : uid ? (people.get(uid)?.name ?? "A colleague") : "Not yet");
  const names = audienceNames(opts.data);
  const needsSecond = c.requires_second_approver || requiresSecondApprover(c.audience);
  const canApprove = canAccess(session, "commsApprove");
  const canSend = canAccess(session, "commsSend");
  const editable = canSend && ["draft", "pending_approval", "scheduled"].includes(c.status);
  const awaiting = c.status === "draft" || (c.status === "pending_approval" && c.approved_by !== session.userId);
  const rate = openRate(c.recipients_count, c.opened_count);

  return (
    <>
      <PageHeader
        title={c.name || c.title}
        eyebrow={back}
        description={
          <>
            <StatusText tone={campaignStatusTone(c.status)}>{campaignStatusLabel(c.status)}</StatusText> · {describeAudience(c.audience, names)}
          </>
        }
        tabs={false}
        actions={
          <>
            {awaiting && canApprove ? (
              <RowActions action={approveCampaignAction} fields={{ id: c.id }} buttons={[{ label: "Approve", value: "approve", variant: "ok", confirm: `Approve "${c.name || c.title}"?` }]} />
            ) : null}
            {(c.status === "pending_approval" || c.status === "scheduled") && canSend ? (
              <RowActions action={setCampaignStatusAction} fields={{ id: c.id }} buttons={[{ label: "Back to approval", value: "draft", variant: "ghost" }]} />
            ) : null}
            {editable ? (
              <RowActions action={setCampaignStatusAction} fields={{ id: c.id }} buttons={[{ label: "Cancel send", value: "cancelled", variant: "bad", confirm: "Cancel this newsletter? It will not go out." }]} />
            ) : null}
          </>
        }
      />
      {c.status === "pending_approval" ? (
        <div className="mb-4">
          <Alert tone="warning" title="Waiting for a second approver">
            All-member sends need two different people. Someone other than {who(c.approved_by)} with comms.approve must approve before it is scheduled.
          </Alert>
        </div>
      ) : null}
      <BlockGrid>
        <Card title="Approval" span={editable ? 12 : 5}>
          <div className="flex flex-col gap-1.5">
            <KeyValueRow label="Written by" value={who(c.created_by)} />
            <KeyValueRow label="Approvals needed" value={needsSecond ? "Two different people (all members)" : "One approver"} />
            <KeyValueRow label="First approval" value={who(c.approved_by)} tone={c.approved_by ? "ok" : "warn"} />
            {needsSecond ? <KeyValueRow label="Second approval" value={who(c.second_approver)} tone={c.second_approver ? "ok" : "warn"} /> : null}
            <KeyValueRow label="Send at" value={c.scheduled_at ? formatDateTime(c.scheduled_at, tz) : "As soon as approved"} />
            {c.sent_at ? <KeyValueRow label="Sent" value={`${formatDateTime(c.sent_at, tz)}${c.recipients_count !== null ? ` · ${c.recipients_count.toLocaleString()} recipients` : ""}${rate ? ` · ${rate}` : ""}`} /> : null}
          </div>
        </Card>
        {editable ? (
          <NewsletterCompose
            options={opts.data}
            canApprove={canApprove}
            myEmail={session.email}
            campaign={{
              id: c.id,
              name: c.name,
              title: c.title,
              body_md: c.body_md,
              channels: c.channels,
              audience: c.audience,
              translations: c.translations,
              scheduled_local: isoToLocalDateTime(c.scheduled_at, tz),
            }}
          />
        ) : (
          <Card title={c.title} span={7}>
            <p className="whitespace-pre-line text-sm">{c.body_md}</p>
            <p className="mt-3 text-xs text-muted">
              Channels: {c.channels.map((ch) => CHANNEL_LABEL[ch] ?? ch).join(", ")}
              {translationLanguages(c.translations).length ? ` · translations: ${translationLanguages(c.translations).join(", ")}` : ""}
            </p>
          </Card>
        )}
      </BlockGrid>
    </>
  );
}
