import { refCode } from "@/lib/comms";
import type { TablesUpdate } from "@/lib/database.types";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandPreview } from "../../types";
import { must } from "../db";
import { dbFail } from "../people/shared";

import { adultsAmong, childGuard, loadThread, requireInbox } from "./shared";

export const THREAD_ACTIONS = ["assign_me", "unassign", "close", "reopen"] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];

const input = object({
  thread_id: f.uuid("The conversation (its id, from messages.inbox_triage)."),
  action: f.enum("assign_me: take it. unassign: hand it back to the inbox. close: close it. reopen: open a closed one again.", THREAD_ACTIONS),
});
export type ThreadInput = Infer<typeof input>;
export type ThreadData = { thread: { id: string; ref: string }; action: ThreadAction };

export const THREAD_DOING: Record<ThreadAction, string> = {
  assign_me: "take the conversation",
  unassign: "unassign the conversation",
  close: "close the conversation",
  reopen: "reopen the conversation",
};
const DONE: Record<ThreadAction, string> = { assign_me: "It's yours now.", unassign: "Unassigned.", close: "Closed.", reopen: "Reopened." };
const WORDS: Record<ThreadAction, string> = { assign_me: "Take", unassign: "Hand back", close: "Close", reopen: "Reopen" };

/** Take a conversation, hand it back, close it or open it again. Nothing is said to the member. */
export const setThread = defineCommand<ThreadInput, ThreadData>({
  key: "messages.set_thread",
  title: "Take, hand back, close or reopen a conversation",
  description:
    "Change who has an inbox conversation or whether it is open: take it for yourself, hand it back to the inbox, close it, or open a closed one again. " +
    "Nothing is said to the member. This asks the person to confirm first. Use messages.inbox_triage to find the conversation. " +
    "A conversation that is by a child or mentions a child cannot be changed through Niva.",
  level: "confirm",
  permission: "commsInbox",
  module: "comms",
  // Off until the owner switches it on in the community's settings (assistant.tools.messages.set_thread).
  enabledByDefault: false,
  covers: ["src/app/(app)/comms/actions.ts#setThreadAction"],
  input,
  async preview(ctx, { thread_id, action }): Promise<CommandPreview> {
    const doing = THREAD_DOING[action];
    requireInbox(ctx, doing);
    const thread = await loadThread(ctx, thread_id);
    if (!thread) throw new CommandError(`Could not ${doing} — it no longer exists, or it is not in an inbox you handle.`);
    const guard = await childGuard(ctx);
    if (guard.active) {
      const adult = await adultsAmong(ctx, [thread.from_person_id]);
      if ((thread.from_person_id !== null && adult.get(thread.from_person_id) !== true) || guard.mentions(thread.subject)) {
        throw new CommandError("This conversation is by a child or mentions one, so Niva can't change it. Please do this on the Inbox page.");
      }
    }
    const inbox = must(await ctx.session.db.from("inboxes").select("name").eq("id", thread.inbox_id).maybeSingle(), "read the inbox") as { name: string } | null;
    const now = action === "close" ? "Closed" : action === "reopen" ? "Open" : action === "assign_me" ? "Yours" : "Unassigned";
    return {
      summary: `${WORDS[action]} ${refCode("Q", thread.id)}${thread.subject ? ` ("${thread.subject}")` : ""} in the ${inbox?.name ?? "inbox"} inbox.`,
      lines: [{ label: "Conversation", before: thread.status === "closed" ? "Closed" : thread.assignee_user ? (thread.assignee_user === ctx.session.userId ? "Yours" : "A colleague has it") : "Unassigned", after: now }],
      warnings: ["Nothing is sent to the member."],
    };
  },
  confirmText: (input_) => `Yes, ${WORDS[input_.action].toLowerCase()} it`,
  async execute(ctx, { thread_id: id, action }) {
    const doing = THREAD_DOING[action];
    requireInbox(ctx, doing);
    const { db, userId } = ctx.session;
    const patch: TablesUpdate<"threads"> =
      action === "assign_me"
        ? { assignee_user: userId, status: "assigned" }
        : action === "unassign"
          ? { assignee_user: null, status: "open" }
          : action === "close"
            ? { status: "closed", closed_at: new Date().toISOString() }
            : { status: "open", closed_at: null };
    const { data, error } = await db.from("threads").update(patch).eq("id", id).select("id");
    if (error) return dbFail(`Could not ${doing}`, error);
    if (!data?.length) return { ok: false, error: `Could not ${doing} — it no longer exists, or it is not in an inbox you handle.` };
    revalidateAfterCommand(["/comms", "/"]);
    return { ok: true, data: { thread: { id, ref: refCode("Q", id) }, action }, message: DONE[action] };
  },
});
