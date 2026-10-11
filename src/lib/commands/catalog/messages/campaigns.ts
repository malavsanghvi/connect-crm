import { loadCommunityLocale } from "@/lib/community-locale";
import { campaignStatusLabel, describeAudience, languagesNeedingTranslation, requiresSecondApprover, translationLanguages } from "@/lib/comms";
import { formatDateTime } from "@/lib/dates";
import { languageName } from "@/lib/languages";
import { can } from "@/lib/permissions";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { must } from "../db";

import { audienceNames } from "./audience";
import { channelWord } from "./pure";
import { childGuard, guardText } from "./shared";

export type CampaignRow = {
  id: string;
  name: string | null;
  title: string;
  kind: string;
  status: string;
  audience: unknown;
  channels: string[] | null;
  translations: unknown;
  scheduled_at: string | null;
  sent_at: string | null;
  recipients_count: number | null;
  requires_second_approver: boolean;
  approved_by: string | null;
  second_approver: string | null;
  created_at: string;
};

export type CampaignsData = {
  /** Newest first. `status_label` is the wording to use: a message is "Scheduled" until it has really gone out (went_out). */
  campaigns: {
    campaign_id: string;
    name: string;
    subject: string;
    status: string;
    status_label: string;
    went_out: boolean;
    audience: string;
    channels: string[];
    languages: string[];
    goes_out: string | null;
    needs_two_approvers: boolean;
    approvals: string;
    you_can_approve_now: boolean;
  }[];
  notes: string[];
};

const WHICH = {
  waiting: { statuses: ["draft", "pending_approval"], label: "waiting for approval" },
  scheduled: { statuses: ["scheduled", "sending"], label: "scheduled" },
  sent: { statuses: ["sent"], label: "sent" },
  all: { statuses: [] as string[], label: "recent" },
} as const;

const input = object({
  which: f.withDefault(f.enum("waiting: waiting for approval. scheduled: approved and queued. sent: gone out. all: the newest of every kind.", ["waiting", "scheduled", "sent", "all"] as const), "waiting"),
  limit: f.withDefault(f.integer("How many, newest first (1 to 30).", { min: 1, max: 30 }), 10),
});

function approvalsLine(c: CampaignRow, me: string): string {
  const second = c.requires_second_approver || requiresSecondApprover(c.audience);
  switch (c.status) {
    case "draft":
      return second ? "Nobody has approved it yet. It goes to all members, so two different people must approve it." : "Nobody has approved it yet.";
    case "pending_approval":
      return c.approved_by === me ? "You gave the first approval. A different person must give the second." : "The first approval is done. It is waiting for a second, different approver.";
    case "scheduled":
      return second ? "Approved by two people." : "Approved.";
    case "cancelled":
      return "Cancelled.";
    default:
      return c.status === "sent" ? "Approved and gone out." : "Approved.";
  }
}

/** The messages to families by where they are in approval, in the words the Newsletters page uses. Reads only. */
export const campaigns = defineCommand<Infer<typeof input>, CampaignsData>({
  key: "messages.campaigns",
  title: "See the messages waiting for approval",
  description:
    "The newsletters and announcements to families: which are waiting for approval, which are scheduled, which have gone out. Each has its audience in words, its channels, when it is meant to go out, " +
    "who has approved it, and whether the person asking can approve it now (a message to all members needs two different approvers). " +
    "A message is only 'Scheduled' until it has really gone out: say Scheduled, never Sent, unless went_out is true. Today nothing sends newsletters yet, so a scheduled message stays queued. " +
    "Use the campaign_id with messages.approve_campaign, messages.set_campaign_status or messages.why_not_delivered. It changes nothing and sends nothing.",
  level: "read",
  permission: "comms",
  module: "comms",
  input,
  async execute(ctx, { which, limit }) {
    const { db, center, userId } = ctx.session;
    const tz = center.time_zone;
    let q = db
      .from("comms_campaigns")
      .select("id, name, title, kind, status, audience, channels, translations, scheduled_at, sent_at, recipients_count, requires_second_approver, approved_by, second_approver, created_at")
      .eq("center_id", center.id);
    const statuses = WHICH[which].statuses;
    if (statuses.length > 0) q = q.in("status", [...statuses]);
    const rows = (must(await q.order("created_at", { ascending: false }).limit(limit), "read the messages") ?? []) as CampaignRow[];
    const { names } = await audienceNames(ctx, rows.map((r) => (r.audience && typeof r.audience === "object" && !Array.isArray(r.audience) ? (r.audience as Record<string, unknown>) : {})));
    const canApprove = can(ctx.session, "comms.approve");
    const community = await loadCommunityLocale(db, center);
    const main = languageName(community.languages[0] ?? "en");

    const list = rows.map((c) => {
      const second = c.requires_second_approver || requiresSecondApprover(c.audience);
      const approvable = canApprove && (c.status === "draft" || (c.status === "pending_approval" && c.approved_by !== userId));
      return {
        campaign_id: c.id,
        name: c.name || c.title,
        subject: c.title,
        status: c.status,
        status_label: campaignStatusLabel(c.status),
        went_out: c.status === "sent",
        audience: describeAudience(c.audience, names),
        channels: (c.channels ?? []).map(channelWord),
        languages: [main, ...translationLanguages(c.translations).map(languageName)],
        needs_translation: languagesNeedingTranslation(community.languages, c.translations).map(languageName),
        goes_out: c.scheduled_at ? formatDateTime(c.scheduled_at, tz) : null,
        needs_two_approvers: second,
        approvals: approvalsLine(c, userId),
        you_can_approve_now: approvable,
      };
    });
    const notes: string[] = [];
    if (community.note) notes.push(community.note);
    if (list.length === 0) notes.push(`Nothing ${WHICH[which].label}.`);
    if (list.some((c) => c.status === "scheduled")) notes.push("Scheduled messages are queued: email, SMS, WhatsApp and push sending are not connected to this app yet, so none has gone out.");
    return { ok: true, data: guardText({ campaigns: list, notes }, await childGuard(ctx)) };
  },
});
