import { refCode } from "@/lib/comms";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandPreview } from "../../types";
import { must } from "../db";
import { dbFail } from "../people/shared";

import { maskAddress } from "./pure";
import { adultsAmong, cardOfPerson, childGuard } from "./shared";

export const WHATSAPP_DECISIONS = ["approved", "added", "declined"] as const;
export type WhatsappDecision = (typeof WHATSAPP_DECISIONS)[number];

const input = object({
  request_id: f.uuid("The group request (its request_id, from messages.inbox_triage)."),
  decision: f.enum("approved: they may join, someone adds them next. added: they have been added to the group. declined: not this time.", WHATSAPP_DECISIONS),
});
export type WhatsappInput = Infer<typeof input>;
export type WhatsappData = { request: { id: string; ref: string }; decision: WhatsappDecision };

export const whatsappDoing = (decision: string): string => (decision === "added" ? "mark the member added" : decision === "declined" ? "decline the request" : "approve the request");
const DONE: Record<WhatsappDecision, string> = {
  added: "Marked as added to the group.",
  approved: "Approved — add them in WhatsApp, then mark added.",
  declined: "Declined.",
};

type Row = { id: string; group_id: string; person_id: string; phone_e164: string; status: string; created_at: string };

/** Decide a request to join a WhatsApp group: approve it, mark the person added once someone has added them, or decline. */
export const handleWhatsappRequest = defineCommand<WhatsappInput, WhatsappData>({
  key: "messages.handle_whatsapp_request",
  title: "Decide a WhatsApp group request",
  description:
    "Answer a member's request to join a WhatsApp group: approve it (then someone adds them in WhatsApp), mark them added once they are in the group, or decline. " +
    "This asks the person to confirm first, showing the group and the household. Weaver does not add anyone to WhatsApp itself. Use messages.inbox_triage to find the request_id. " +
    "A request from a child cannot be handled through Niva.",
  level: "confirm",
  permission: "commsSend",
  module: "comms",
  // Off until the owner switches it on in the community's settings (assistant.tools.messages.handle_whatsapp_request).
  enabledByDefault: false,
  covers: ["src/app/(app)/comms/actions.ts#handleJoinRequestAction"],
  input,
  async preview(ctx, { request_id, decision }): Promise<CommandPreview> {
    const doing = whatsappDoing(decision);
    const { db } = ctx.session;
    const r = must(await db.from("whatsapp_join_requests").select("id, group_id, person_id, phone_e164, status, created_at").eq("id", request_id).maybeSingle(), "read the request") as Row | null;
    if (!r) throw new CommandError(`Could not ${doing} — the request no longer exists.`);
    const guard = await childGuard(ctx);
    if (guard.active) {
      const adult = await adultsAmong(ctx, [r.person_id]);
      if (adult.get(r.person_id) !== true) throw new CommandError("Niva does not work with children's requests. Please do this on the WhatsApp page.");
    }
    const group = must(await db.from("whatsapp_groups").select("name").eq("id", r.group_id).maybeSingle(), "read the group") as { name: string } | null;
    const card = await cardOfPerson(ctx, r.person_id);
    return {
      summary: `${decision === "added" ? "Mark as added to" : decision === "declined" ? "Decline the request to join" : "Approve the request to join"} ${group?.name ?? "the WhatsApp group"} (${refCode("W", r.id)}).`,
      lines: [
        { label: "Group", value: group?.name ?? "a group" },
        { label: "Phone", value: maskAddress(r.phone_e164) ?? "on file" },
        { label: "Request", before: r.status, after: decision },
      ],
      ...(card ? { households: [card] } : {}),
      warnings: decision === "approved" ? ["Weaver does not add them to the group: someone does that in WhatsApp, then marks them added."] : [],
    };
  },
  confirmText: (input_) => (input_.decision === "added" ? "Yes, mark them added" : input_.decision === "declined" ? "Yes, decline the request" : "Yes, approve the request"),
  async execute(ctx, { request_id: id, decision: status }) {
    const doing = whatsappDoing(status);
    const { data, error } = await ctx.session.db
      .from("whatsapp_join_requests")
      .update({ status, handled_by: ctx.session.userId, handled_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) return dbFail(`Could not ${doing}`, error);
    if (!data?.length) return { ok: false, error: `Could not ${doing} — the request no longer exists.` };
    revalidateAfterCommand(["/comms", "/"]);
    return { ok: true, data: { request: { id, ref: refCode("W", id) }, decision: status }, message: DONE[status] };
  },
});
