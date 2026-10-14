import { campaignStatusLabel } from "@/lib/comms";
import type { TablesUpdate } from "@/lib/database.types";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandPreview } from "../../types";
import { must } from "../db";
import { dbFail } from "../people/shared";

import { NOTHING_SENT_BY_NIVA } from "./shared";

const input = object({
  campaign_id: f.uuid("The message (its campaign_id, from messages.campaigns)."),
  decision: f.enum("cancelled: stop it for good. draft: take back its approvals and send it back to awaiting approval.", ["cancelled", "draft"] as const),
});
export type CampaignStatusInput = Infer<typeof input>;
export type CampaignStatusData = { campaign: { id: string; name: string | null }; now: "cancelled" | "awaiting_approval" };

export const doingFor = (decision: string): string => (decision === "cancelled" ? "cancel the newsletter" : "move the newsletter back to approval");

const OPEN = ["draft", "pending_approval", "scheduled"] as const;

/** A working draft (a copy, or a start from a template) has no approvals to take back, but it can be discarded: cancelled. */
const openFor = (decision: string): readonly string[] => (decision === "cancelled" ? [...OPEN, "working_draft"] : OPEN);

/**
 * Cancel a message that has not gone out, or send it back to "awaiting approval" (which takes back every approval). Only a message that
 * is still a draft, waiting for a second approver or scheduled can be changed. A cancelled message stays cancelled.
 */
export const setCampaignStatus = defineCommand<CampaignStatusInput, CampaignStatusData>({
  key: "messages.set_campaign_status",
  title: "Cancel a message or send it back for approval",
  description:
    "Stop a newsletter or announcement that has not gone out (cancel it for good), or take back its approvals and send it back to awaiting approval. " +
    "Use messages.campaigns to find the campaign_id. This asks the person to confirm first. It cannot touch a message that has already gone out, and a cancelled message cannot be brought back.",
  level: "confirm",
  permission: "commsSend",
  module: "comms",
  // Off until the owner switches it on in the community's settings (assistant.tools.messages.set_campaign_status).
  enabledByDefault: false,
  covers: ["src/app/(app)/comms/actions.ts#setCampaignStatusAction"],
  input,
  async preview(ctx, { campaign_id, decision }): Promise<CommandPreview> {
    const doing = doingFor(decision);
    const c = must(await ctx.session.db.from("comms_campaigns").select("name, title, status").eq("id", campaign_id).maybeSingle(), `read the message`) as { name: string | null; title: string; status: string } | null;
    if (!c) throw new CommandError(`Could not ${doing} — it has already gone out or was cancelled.`);
    if (c.status === "working_draft" && decision === "draft") {
      throw new CommandError(`Could not ${doing} — it is a draft that has not been sent for approval yet, so there is nothing to take back.`);
    }
    if (!openFor(decision).includes(c.status)) throw new CommandError(`Could not ${doing} — it has already gone out or was cancelled.`);
    const label = c.name || c.title;
    const warnings = [NOTHING_SENT_BY_NIVA];
    if (decision === "cancelled") warnings.unshift("A cancelled message cannot be brought back. You would write a new one.");
    else warnings.unshift("Every approval it has is taken back, and it has to be approved again.");
    return {
      summary: decision === "cancelled" ? `Cancel "${label}".` : `Send "${label}" back to awaiting approval.`,
      lines: [{ label: "Now", before: campaignStatusLabel(c.status), after: decision === "cancelled" ? "Cancelled" : campaignStatusLabel("draft") }],
      warnings,
    };
  },
  confirmText: (input_) => (input_.decision === "cancelled" ? "Yes, cancel it" : "Yes, send it back for approval"),
  async execute(ctx, { campaign_id: id, decision: to }) {
    const doing = doingFor(to);
    const patch: TablesUpdate<"comms_campaigns"> = to === "draft" ? { status: "draft", approved_by: null, second_approver: null } : { status: "cancelled" };
    const { data, error } = await ctx.session.db.from("comms_campaigns").update(patch).eq("id", id).in("status", [...openFor(to)]).select("id");
    if (error) return dbFail(`Could not ${doing}`, error);
    if (!data?.length) return { ok: false, error: `Could not ${doing} — it has already gone out or was cancelled.` };
    revalidateAfterCommand(["/comms", "/"]);
    return { ok: true, data: { campaign: { id, name: null }, now: to === "draft" ? "awaiting_approval" : "cancelled" }, message: to === "draft" ? "Back to awaiting approval." : "Cancelled." };
  },
});
