import { composeAction, describeAudience, requiresSecondApprover } from "@/lib/comms";
import type { Json } from "@/lib/database.types";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type CommandPreview } from "../../types";
import { dbFail } from "../people/shared";

import { audienceNames, quietHoursInfo, recipientCount } from "./audience";
import { channelWord } from "./pure";
import { audienceFromInput, campaignValues, NOT_SENDING, NOTHING_SENT_BY_NIVA } from "./shared";

const DOING = "send the newsletter";

const input = object({
  name: f.string("A short name for the message, for the staff list.", { min: 0, max: 200 }),
  title: f.string("The subject line members see.", { min: 0, max: 300 }),
  body: f.string("The message itself, in English. Use messages.draft_reminder for an event reminder.", { min: 0, max: 100_000 }),
  channels: f.string("Where it goes, separated by commas: email, push, in_app, sms, whatsapp.", { min: 0, max: 100 }),
  send_at: f.optional(f.string("When it should go out, in the community's time zone, like 2026-10-24T09:00. Leave out for as soon as it is approved.", { min: 1, max: 20 })),
  title_gu: f.optional(f.string("The subject in Gujarati.", { min: 1, max: 300 })),
  body_gu: f.optional(f.string("The message in Gujarati.", { min: 1, max: 100_000 })),
  title_hi: f.optional(f.string("The subject in Hindi.", { min: 1, max: 300 })),
  body_hi: f.optional(f.string("The message in Hindi.", { min: 1, max: 100_000 })),
  to_all_members: f.withDefault(f.boolean("Send to everyone with an active membership (needs two different approvers)."), false),
  to_life_members: f.withDefault(f.boolean("Send to life members."), false),
  zone_ids: f.optional(f.string("Zone ids, separated by commas.", { max: 2000 })),
  pathshala_class_ids: f.optional(f.string("Class ids, separated by commas: families with a child in those classes.", { max: 2000 })),
  event_id: f.optional(f.uuid("An event: the families that RSVP'd to it.")),
  rsvp_statuses: f.optional(f.string("With event_id: which RSVPs, separated by commas (rsvpd, confirmed, attended).", { max: 200 })),
  audience_json: f.optional(f.string("The audience exactly as the compose form builds it. Leave out: use the fields above.", { max: 20000 })),
});
export type ScheduleInput = Infer<typeof input>;
export type ScheduleData = { campaign: { id: string; name: string }; status: "scheduled" | "awaiting_approval"; sent: false };

/** The checks the compose form makes, in its order and its words. Throws the sentence the form has always shown. */
export function planCampaign(ctx: CommandContext, args: ScheduleInput) {
  const aud = audienceFromInput(args);
  if (!aud.ok) throw new CommandError(`Could not ${DOING} — ${aud.error}.`);
  const v = campaignValues(args, ctx.session.center.time_zone);
  if (!v.ok) throw new CommandError(`Could not ${DOING} — ${v.error}.`);
  const mode = composeAction(aud.audience, can(ctx.session, "comms.approve"));
  return { audience: aud.audience, values: v.values, mode, needsSecond: requiresSecondApprover(aud.audience) };
}

/**
 * Create a message to families and send it down the approval path: an approver with a smaller audience schedules it in one step;
 * everyone else sends it for approval, and a message to all members needs a second, different approver. The compose form's button
 * runs this same code. A message is "Scheduled" until it has really gone out; today nothing sends newsletters yet.
 */
export const scheduleCampaign = defineCommand<ScheduleInput, ScheduleData>({
  key: "messages.schedule_campaign",
  title: "Schedule a message to families",
  description:
    "Create a newsletter or announcement to families and put it on the approval path. If the person may approve and the audience is not all members, it is approved and Scheduled in one step; otherwise it is sent for approval, " +
    "and a message to all members needs two different approvers. This asks the person to confirm first, showing the audience, the channels, the number of households and the quiet-hours effect. " +
    "It is Scheduled, not Sent: nothing sends newsletters yet, and Niva never sends anything itself. Prepare the wording first with messages.draft_reminder and check the reach with messages.audience_preview. " +
    "Pass the Gujarati and Hindi text in title_gu/body_gu and title_hi/body_hi when you have it.",
  level: "confirm",
  permission: "commsSend",
  module: "comms",
  // Off until the owner switches it on in the community's settings (assistant.tools.messages.schedule_campaign).
  enabledByDefault: false,
  covers: ["src/app/(app)/comms/actions.ts#submitNewsletterAction"],
  input,
  async preview(ctx, args): Promise<CommandPreview> {
    const p = planCampaign(ctx, args);
    const { center } = ctx.session;
    const now = ctx.now?.() ?? new Date();
    const warnings: string[] = [];
    const { names } = await audienceNames(ctx, [p.audience]);
    const who = describeAudience(p.audience, names);
    let reach = "could not be counted";
    try {
      const n = await recipientCount(ctx, p.audience);
      reach = `${n} household${n === 1 ? "" : "s"} with an adult who accepts email`;
      if (n === 0) warnings.push("No household can be reached by email with this audience.");
    } catch (error) {
      console.error("[messages] could not count the recipients for a preview:", error);
      warnings.push("The number of recipients could not be counted just now.");
    }
    const at = p.values.scheduled_at ? new Date(p.values.scheduled_at) : now;
    const quiet = quietHoursInfo(ctx, at, false);
    if (quiet.held && p.values.channels.some((c) => c === "sms" || c === "whatsapp" || c === "push")) warnings.push(quiet.note);
    if (p.mode === "submit") {
      warnings.push(
        p.needsSecond
          ? "This goes to all members, so two different people must approve it. It appears in approvers' tasks first."
          : "You can't approve it yourself, so it is sent to the approvers. It appears in their tasks.",
      );
    } else {
      warnings.push("It will be approved by you and Scheduled.");
    }
    warnings.push(`Scheduled means queued, not sent.${NOT_SENDING.trimEnd()}`);
    warnings.push(NOTHING_SENT_BY_NIVA);
    const languages = ["English", ...(args.title_gu || args.body_gu ? ["Gujarati"] : []), ...(args.title_hi || args.body_hi ? ["Hindi"] : [])];
    return {
      summary: p.mode === "schedule" ? `Approve and schedule "${p.values.name}" for ${who}.` : `Send "${p.values.name}" for ${who} to the approvers.`,
      lines: [
        { label: "Subject", value: p.values.title },
        { label: "Audience", value: who },
        { label: "Reach", value: reach },
        { label: "Channels", value: p.values.channels.map(channelWord).join(", ") },
        { label: "Goes out", value: p.values.scheduled_at ? formatDateTime(p.values.scheduled_at, center.time_zone) : "As soon as it is approved" },
        { label: "Languages", value: languages.join(", ") },
        { label: "After you confirm", value: p.mode === "schedule" ? "Scheduled (not yet sent)" : "Waiting for approval" },
      ],
      warnings,
    };
  },
  confirmText: (_input, preview) => (preview.summary.startsWith("Approve") ? "Yes, approve and schedule it" : "Yes, send it for approval"),
  async execute(ctx, args) {
    const p = planCampaign(ctx, args);
    const { db, center, userId } = ctx.session;
    const created = await db
      .from("comms_campaigns")
      .insert({
        ...p.values,
        center_id: center.id,
        kind: "newsletter",
        audience: p.audience as Json,
        requires_second_approver: p.needsSecond,
        status: "draft",
        created_by: userId,
      })
      .select("id")
      .single();
    if (created.error) return dbFail(`Could not ${DOING}`, created.error);
    revalidateAfterCommand(["/comms", "/"]);
    const campaign = { id: created.data.id, name: p.values.name };
    if (p.mode === "submit") {
      return { ok: true, data: { campaign, status: "awaiting_approval", sent: false }, message: `"${p.values.name}" sent for approval · it appears in approvers' tasks.` };
    }
    const { error } = await db
      .from("comms_campaigns")
      .update({ approved_by: userId, status: "scheduled", scheduled_at: p.values.scheduled_at ?? new Date().toISOString() })
      .eq("id", created.data.id);
    if (error) return dbFail(`"${p.values.name}" was saved and is awaiting approval, but could not be scheduled`, error);
    revalidateAfterCommand(["/comms", "/"]);
    return { ok: true, data: { campaign, status: "scheduled", sent: false }, message: `"${p.values.name}" approved and scheduled.${NOT_SENDING}` };
  },
});

