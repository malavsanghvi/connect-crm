import { refCode } from "@/lib/comms";
import type { TablesUpdate } from "@/lib/database.types";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandPreview } from "../../types";
import { must } from "../db";
import { dbFail } from "../people/shared";

import { adultsAmong, cardOfPerson, childGuard, loadThread, requireInbox } from "./shared";

const DOING = "send the reply";

const input = object({
  thread_id: f.uuid("The conversation to answer (its id, from messages.inbox_triage)."),
  body: f.string("The reply, exactly as the member will read it.", { min: 0, max: 20_000 }),
  close: f.withDefault(f.boolean("Close the conversation after replying."), false),
});
export type ReplyInput = Infer<typeof input>;
export type ReplyData = { thread: { id: string; ref: string }; closed: boolean };

function checkBody(body: string): void {
  if (!body.trim()) throw new CommandError(`Could not ${DOING} — write something first.`);
}

/**
 * Reply to a member in an inbox conversation. The reply is saved in the conversation (the member reads it in the app) and comes from
 * the inbox, never a personal number. The reply form's button runs this same code.
 */
export const replyToThread = defineCommand<ReplyInput, ReplyData>({
  key: "messages.reply_to_thread",
  title: "Reply to a conversation in the inbox",
  description:
    "Send a reply to a member's conversation in a shared inbox, optionally closing it. The reply comes from the inbox, not a personal number, and the member reads it in the app. " +
    "This is a message to a member, so it asks the person to confirm first, showing who it goes to and the exact words. Niva never sends it by itself. " +
    "Prepare the words with messages.draft_reply (approved answers only) and let the person edit them. A conversation that is by a child or mentions a child cannot be answered through Niva.",
  level: "confirm",
  permission: "commsInbox",
  module: "comms",
  // Off until the owner switches it on in the community's settings (assistant.tools.messages.reply_to_thread).
  enabledByDefault: false,
  covers: ["src/app/(app)/comms/actions.ts#replyToThreadAction"],
  input,
  async preview(ctx, { thread_id, body, close }): Promise<CommandPreview> {
    requireInbox(ctx, DOING);
    checkBody(body);
    const thread = await loadThread(ctx, thread_id);
    if (!thread) throw new CommandError(`Could not ${DOING} — the conversation no longer exists, or it is not in an inbox you handle.`);
    const guard = await childGuard(ctx);
    const subject = thread.subject;
    if (guard.active) {
      const adult = await adultsAmong(ctx, [thread.from_person_id]);
      const about = (thread.from_person_id !== null && adult.get(thread.from_person_id) !== true) || guard.mentions(thread.subject);
      if (about) {
        // Niva has not read it and cannot say who it goes to, so it will not send it either: the person replies on the screen.
        throw new CommandError("This conversation is by a child or mentions one, so Niva can't reply to it. Please reply on the Inbox page.");
      }
    }
    const card = await cardOfPerson(ctx, thread.from_person_id);
    const inbox = must(await ctx.session.db.from("inboxes").select("name").eq("id", thread.inbox_id).maybeSingle(), "read the inbox") as { name: string } | null;
    return {
      summary: `Reply to ${refCode("Q", thread.id)}${subject ? ` ("${subject}")` : ""} from the ${inbox?.name ?? "inbox"} inbox${close ? " and close it" : ""}.`,
      lines: [
        { label: "Goes to", value: thread.from_person_id ? (card ? "The member in the household below" : "The member who wrote") : `A guest${thread.from_guest_contact ? ` (${thread.from_guest_contact})` : ""}` },
        { label: "Reply", value: body.trim() },
        { label: "Then", value: close ? "The conversation is closed" : "The conversation stays open, waiting for the member" },
      ],
      ...(card ? { households: [card] } : {}),
      warnings: ["It comes from the inbox, not your personal number. The member reads it in the app.", "Niva does not send this by itself: it is sent when you confirm."],
    };
  },
  confirmText: (_input, preview) => (preview.summary.endsWith("and close it.") ? "Yes, send the reply and close it" : "Yes, send the reply"),
  async execute(ctx, { thread_id: id, body: raw, close }) {
    requireInbox(ctx, DOING);
    const { db, userId, center } = ctx.session;
    const body = raw.trim();
    checkBody(body);
    const t = await db.from("threads").select("first_response_at").eq("id", id).maybeSingle();
    if (t.error) return dbFail(`Could not ${DOING}`, t.error);
    if (!t.data) return { ok: false, error: `Could not ${DOING} — the conversation no longer exists, or it is not in an inbox you handle.` };
    const ins = await db.from("thread_messages").insert({ center_id: center.id, thread_id: id, author_user: userId, from_role: true, body });
    if (ins.error) return dbFail(`Could not ${DOING}`, ins.error);
    const now = new Date().toISOString();
    const patch: TablesUpdate<"threads"> = { status: close ? "closed" : "waiting" };
    if (!t.data.first_response_at) patch.first_response_at = now;
    if (close) patch.closed_at = now;
    const { error } = await db.from("threads").update(patch).eq("id", id);
    if (error) return dbFail("The reply was saved, but the conversation's status could not be updated", error);
    revalidateAfterCommand(["/comms", "/"]);
    return { ok: true, data: { thread: { id, ref: refCode("Q", id) }, closed: close }, message: close ? "Replied and closed." : "Reply sent from the inbox, not your personal number." };
  },
});
