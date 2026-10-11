import { describeAudience, requiresSecondApprover } from "@/lib/comms";
import type { TablesUpdate } from "@/lib/database.types";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type CommandPreview } from "../../types";
import { must } from "../db";
import { dbFail } from "../people/shared";

import { audienceNames } from "./audience";
import { channelWord } from "./pure";
import { NOT_SENDING, NOTHING_SENT_BY_NIVA } from "./shared";

const DOING = "approve the newsletter";

const input = object({
  campaign_id: f.uuid("The message to approve (its campaign_id, from messages.campaigns)."),
});
export type ApproveInput = Infer<typeof input>;
export type ApproveData = { campaign: { id: string; name: string }; result: "scheduled" | "waiting_for_second_approver" };

type Row = {
  name: string | null;
  title: string;
  status: string;
  audience: unknown;
  channels: string[] | null;
  requires_second_approver: boolean;
  approved_by: string | null;
  scheduled_at: string | null;
};

const SECOND_IS_YOURS =
  "This message already has its first approval. The second approval is something only you can give, yourself, on the Newsletters page: Niva can't give it, so that two different people really have approved.";

async function load(ctx: CommandContext, id: string): Promise<Row> {
  const c = must(
    await ctx.session.db.from("comms_campaigns").select("name, title, status, audience, channels, requires_second_approver, approved_by, scheduled_at").eq("id", id).maybeSingle(),
    DOING,
  ) as Row | null;
  if (!c) throw new CommandError(`Could not ${DOING} — it no longer exists.`);
  return c;
}

/**
 * Approve a message. The first approval of a message that is not for all members schedules it; for all members it waits for a second,
 * different approver (app.approve_as_second, and the two_person_comms trigger in the database, enforce that). The rule is the one the
 * Newsletters page has always used. Niva never gives the second approval: that is only for the person.
 */
export const approveCampaign = defineCommand<ApproveInput, ApproveData>({
  key: "messages.approve_campaign",
  title: "Approve a message to families",
  description:
    "Give your approval to a newsletter or announcement that is waiting (use messages.campaigns to find it). A message that is not for all members is approved and Scheduled; a message to all members is approved and then waits for a second, different approver. " +
    "This asks the person to confirm first. Niva never gives the second approval of a message: that is only for the person, on the Newsletters page. " +
    "Scheduled means queued, not sent: nothing sends newsletters yet. Check the audience with messages.audience_preview first.",
  level: "confirm",
  permission: "commsApprove",
  module: "comms",
  // Off until the owner switches it on in the community's settings (assistant.tools.messages.approve_campaign).
  enabledByDefault: false,
  covers: ["src/app/(app)/comms/actions.ts#approveCampaignAction"],
  input,
  async preview(ctx, { campaign_id }): Promise<CommandPreview> {
    const c = await load(ctx, campaign_id);
    const label = c.name || c.title;
    const second = c.requires_second_approver || requiresSecondApprover(c.audience);
    if (c.status === "pending_approval") {
      if (c.approved_by === ctx.session.userId) throw new CommandError(`Could not approve "${label}" — you gave the first approval; the two-person rule needs a different approver.`);
      if (ctx.via === "assistant") throw new CommandError(SECOND_IS_YOURS);
    } else if (c.status !== "draft") {
      throw new CommandError(`Could not approve "${label}" — it is no longer awaiting approval.`);
    }
    const aud = c.audience && typeof c.audience === "object" && !Array.isArray(c.audience) ? (c.audience as Record<string, unknown>) : {};
    const { names } = await audienceNames(ctx, [aud]);
    const who = describeAudience(c.audience, names);
    const warnings: string[] = [];
    let after: string;
    if (c.status === "draft" && second) {
      after = "Approved, then waiting for a second approver";
      warnings.push("This goes to all members, so a second, different person must approve it before it is scheduled.");
    } else {
      after = "Scheduled (not yet sent)";
      warnings.push(`Scheduled means queued, not sent.${NOT_SENDING.trimEnd()}`);
    }
    warnings.push(NOTHING_SENT_BY_NIVA);
    return {
      summary: c.status === "draft" && second ? `Give your first approval to "${label}" for ${who}.` : `Approve and schedule "${label}" for ${who}.`,
      lines: [
        { label: "Subject", value: c.title },
        { label: "Audience", value: who },
        { label: "Channels", value: (c.channels ?? []).map(channelWord).join(", ") || "none chosen" },
        { label: "Approval step", value: c.status === "pending_approval" ? "Second approval" : "First approval" },
        { label: "After you confirm", value: after },
      ],
      warnings,
    };
  },
  confirmText: (_input, preview) => (preview.summary.startsWith("Give your first") ? "Yes, give my approval" : "Yes, approve and schedule it"),
  async execute(ctx, { campaign_id: id }) {
    const { db, userId } = ctx.session;
    const c = await load(ctx, id);
    const label = c.name || c.title;
    const needsSecond = c.requires_second_approver || requiresSecondApprover(c.audience);
    const sendAt = c.scheduled_at ?? new Date().toISOString();
    const ref = { id, name: label };

    if (c.status === "draft") {
      const patch: TablesUpdate<"comms_campaigns"> = needsSecond
        ? { approved_by: userId, requires_second_approver: true, status: "pending_approval" }
        : { approved_by: userId, status: "scheduled", scheduled_at: sendAt };
      const { error } = await db.from("comms_campaigns").update(patch).eq("id", id).eq("status", "draft");
      if (error) return dbFail(`Could not ${DOING}`, error);
      revalidateAfterCommand(["/comms", "/"]);
      return {
        ok: true,
        data: { campaign: ref, result: needsSecond ? "waiting_for_second_approver" : "scheduled" },
        message: needsSecond ? `"${label}" approved · waiting for a second approver (all-member send).` : `"${label}" approved and scheduled.${NOT_SENDING}`,
      };
    }
    if (c.status === "pending_approval") {
      if (c.approved_by === userId) {
        return { ok: false, error: `Could not approve "${label}" — you gave the first approval; the two-person rule needs a different approver.` };
      }
      // Only the person gives a second approval, never Niva (the preview refuses it; this keeps a direct call from skipping the preview).
      if (ctx.via === "assistant") return { ok: false, error: SECOND_IS_YOURS };
      const second = await db.rpc("approve_as_second", { p_table: "comms_campaigns", p_id: id });
      if (second.error) return dbFail(`Could not approve "${label}"`, second.error);
      const { error } = await db.from("comms_campaigns").update({ status: "scheduled", scheduled_at: sendAt }).eq("id", id);
      if (error) return dbFail(`Your approval of "${label}" was recorded, but it could not be scheduled`, error);
      revalidateAfterCommand(["/comms", "/"]);
      return { ok: true, data: { campaign: ref, result: "scheduled" }, message: `"${label}" approved by two people and scheduled.${NOT_SENDING}` };
    }
    return { ok: false, error: `Could not approve "${label}" — it is no longer awaiting approval.` };
  },
});
