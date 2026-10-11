import { refCode } from "@/lib/comms";
import { formatDateTime } from "@/lib/dates";
import { nivaAnswerFrom } from "@/lib/niva";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type HouseholdCard } from "../../types";
import { must } from "../db";

import { ageHours, composeReply, rankSources, waitedWords, WITHHELD_FOR_CHILD, type SourceRow } from "./pure";
import { adultsAmong, cardOfPerson, childGuard, loadThread, requireInbox, THREAD_GONE } from "./shared";

const SHOWN_MESSAGES = 6;

export type DraftReplyData = {
  thread: { id: string; ref: string; inbox: string; status: string; waited: string; subject: string | null; from: "a member" | "a guest"; held_by: "you" | "a colleague" | "nobody" };
  household: HouseholdCard | null;
  conversation: { from: "the member" | "our inbox"; when: string; text: string }[];
  /** The approved (published) answers the draft is built from. Nothing else is ever used. */
  sources: { id: string; title: string; kind: string; matched_words: string[] }[];
  draft: string | null;
  sent: false;
  /** True when Niva may not read this conversation (it is by a child or names one); the person reads it on the screen. */
  withheld: boolean;
  notes: string[];
};

const input = object({
  thread_id: f.uuid("The conversation to answer (its id, from messages.inbox_triage)."),
});

type ContentRow = { id: string; kind: string; title: string; body_md: string | null; metadata: unknown; center_id: string | null; tradition: string | null };

/** Published answers only: the community's approved Niva sources, plus its FAQ and public Guide sections when Niva answers from them. */
export async function approvedSources(ctx: CommandContext): Promise<SourceRow[]> {
  const { db, center } = ctx.session;
  const from = nivaAnswerFrom(center.rules);
  const kinds = from.faq ? ["niva_source", "faq"] : ["niva_source"];
  const rows = (must(
    await db
      .from("content_items")
      .select("id, kind, title, body_md, metadata, center_id, tradition")
      .eq("status", "published")
      .in("kind", kinds)
      .or(`center_id.eq.${center.id},and(center_id.is.null,tradition.is.null)`)
      .limit(300),
    "read the approved answers",
  ) ?? []) as ContentRow[];
  const out: SourceRow[] = rows
    .filter((r) => r.center_id === center.id || (r.center_id === null && r.tradition === null))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body_md: r.body_md,
      source_url: r.metadata && typeof r.metadata === "object" && typeof (r.metadata as Record<string, unknown>).source_url === "string" ? ((r.metadata as Record<string, unknown>).source_url as string) : null,
    }));
  if (from.guide) {
    const sections = (must(await db.from("guide_sections").select("id, title, body_md").eq("center_id", center.id).eq("public", true).limit(200), "read the Guide") ?? []) as { id: string; title: string; body_md: string }[];
    for (const s of sections) out.push({ id: `guide_section:${s.id}`, kind: "guide_section", title: s.title, body_md: s.body_md, source_url: null });
  }
  return out;
}

/**
 * A reply to one conversation, written from the community's APPROVED answers and nothing else. If no approved answer covers what was
 * asked, there is no draft and it says so. The draft is wording for the person to read and edit; this command never sends anything.
 */
export const draftReply = defineCommand<Infer<typeof input>, DraftReplyData>({
  key: "messages.draft_reply",
  title: "Draft a reply from approved answers",
  description:
    "Prepare a reply to one inbox conversation using ONLY the community's approved, published answers (Content > Niva sources, and the FAQ and public Guide when the community uses them). " +
    "It returns the conversation, the approved answers that match, and a draft built from the best match. If no approved answer covers the question it returns no draft: say so, and never make up an answer. " +
    "This only prepares text: nothing is sent. Show the draft as a draft and let the person edit it; to send it, use messages.reply_to_thread, which asks them to confirm. " +
    "A conversation that is by a child or mentions a child is withheld: tell the person to read it on the screen.",
  level: "draft",
  permission: "commsInbox",
  module: "comms",
  input,
  async execute(ctx, { thread_id }) {
    requireInbox(ctx, "draft the reply");
    const { db, center } = ctx.session;
    const now = ctx.now?.() ?? new Date();
    const tz = center.time_zone;
    const thread = await loadThread(ctx, thread_id);
    if (!thread) throw new CommandError(THREAD_GONE);
    const inbox = must(await db.from("inboxes").select("name").eq("id", thread.inbox_id).maybeSingle(), "read the inbox") as { name: string } | null;
    const messages = (must(
      await db.from("thread_messages").select("id, from_role, body, created_at").eq("thread_id", thread_id).eq("center_id", center.id).order("created_at"),
      "read the conversation's messages",
    ) ?? []) as { id: string; from_role: boolean; body: string; created_at: string }[];

    const head = {
      id: thread.id,
      ref: refCode("Q", thread.id),
      inbox: inbox?.name ?? "Inbox",
      status: thread.status,
      waited: waitedWords(ageHours(thread.created_at, now)),
      from: (thread.from_person_id ? "a member" : "a guest") as "a member" | "a guest",
      held_by: (thread.assignee_user ? (thread.assignee_user === ctx.session.userId ? "you" : "a colleague") : "nobody") as "you" | "a colleague" | "nobody",
    };

    // D2: Niva does not read a conversation by a child, or one that uses a child's name.
    const guard = await childGuard(ctx);
    if (guard.active) {
      const adult = await adultsAmong(ctx, [thread.from_person_id]);
      const blocked = (thread.from_person_id !== null && adult.get(thread.from_person_id) !== true) || guard.mentions(thread.subject) || messages.some((m) => guard.mentions(m.body));
      if (blocked) {
        return {
          ok: true,
          data: { thread: { ...head, subject: null }, household: null, conversation: [], sources: [], draft: null, sent: false, withheld: true, notes: [WITHHELD_FOR_CHILD] },
          message: "This conversation is not shown to Niva. Nothing has been drafted or sent.",
        };
      }
    }

    const notes: string[] = [];
    const memberTexts = messages.filter((m) => !m.from_role).map((m) => m.body);
    const question = [thread.subject ?? "", ...memberTexts.slice(-2)].join("\n").trim();
    const household = await cardOfPerson(ctx, thread.from_person_id);
    let firstName: string | null = null;
    if (thread.from_person_id) {
      const p = must(await db.from("people").select("first_name, preferred_name").eq("id", thread.from_person_id).maybeSingle(), "read the sender") as { first_name: string; preferred_name: string | null } | null;
      firstName = p ? ((p.preferred_name ?? "").trim() || p.first_name) : null;
    }

    const sources = await approvedSources(ctx);
    const ranked = memberTexts.length === 0 ? [] : rankSources(question, sources, 3);
    const draft = composeReply({ firstName, community: center.name, inbox: inbox?.name ?? "Inbox", best: ranked[0] ?? null });
    if (memberTexts.length === 0) notes.push("There is no message from the member yet, so there is nothing to answer.");
    else if (sources.length === 0) notes.push("The community has no approved answers yet. Add some in Content > Niva, or write the reply yourself.");
    else if (!draft) notes.push("No approved answer covers this question, so there is no draft. Write the reply yourself, or add an approved answer in Content > Niva.");
    if (draft) notes.push("Built only from the approved answers listed. Read it and change it before you send it. Nothing has been sent.");

    return {
      ok: true,
      data: {
        thread: { ...head, subject: thread.subject },
        household,
        conversation: messages.slice(-SHOWN_MESSAGES).map((m) => ({ from: (m.from_role ? "our inbox" : "the member") as "the member" | "our inbox", when: formatDateTime(m.created_at, tz), text: m.body })),
        sources: ranked.map((s) => ({ id: s.id, title: s.title, kind: s.kind, matched_words: s.matched })),
        draft,
        sent: false,
        withheld: false,
        notes,
      },
      message: "This is a draft. Nothing has been sent.",
    };
  },
});
