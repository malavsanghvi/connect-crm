import { refCode } from "@/lib/comms";
import { canAccess } from "@/lib/permissions";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";
import { must } from "../db";

import { ageHours, triageCounts, waitedWords, WITHHELD_FOR_CHILD, type InboxRow, type ThreadRow } from "./pure";
import { adultsAmong, childGuard, inboxAllowed } from "./shared";

const LIST = 10;
const MAX_THREADS = 500;

export type InboxTriageData = {
  as_of: string;
  open: number;
  waiting_on_us: number;
  waiting_on_member: number;
  unassigned: number;
  no_first_reply: number;
  past_target: number;
  by_age: { label: string; count: number }[];
  by_inbox: { inbox_id: string; name: string; open: number; waiting_on_us: number; waiting_on_member: number; unassigned: number; no_first_reply: number; past_target: number; oldest_waiting: string | null }[];
  /** The conversations that have waited longest for us, oldest first. No names: a reference, the inbox, how long and who has it. */
  oldest: {
    thread_id: string;
    ref: string;
    inbox: string;
    waited: string;
    held_by: "you" | "a colleague" | "nobody";
    from: "a member" | "a guest";
    needs_first_reply: boolean;
    subject: string | null;
  }[];
  /** People who asked to join a WhatsApp group; null when the role cannot see the queue. */
  whatsapp: { waiting: number; requests: { request_id: string; group: string; status: string; waited: string }[] } | null;
  truncated: boolean;
  notes: string[];
};

const input = object({
  inbox_id: f.optional(f.uuid("Only this inbox (its id, from an earlier answer). Leave out to look at every inbox the person handles.")),
});

/**
 * What is waiting in the shared inboxes, by inbox and by how long, plus the WhatsApp group requests. It reads the same rows the
 * Inbox page does, so a person only ever sees the inboxes they handle.
 */
export const inboxTriage = defineCommand<Infer<typeof input>, InboxTriageData>({
  key: "messages.inbox_triage",
  title: "See what is waiting in the inbox",
  description:
    "What is waiting in the shared inboxes: how many conversations wait for a reply, how long they have waited, which have nobody on them and which are past their inbox's reply target, " +
    "by inbox and by age, plus the oldest few (with a short reference, no names) and the WhatsApp group requests waiting. Use it to start an inbox session or to answer 'what needs me?'. " +
    "Only the inboxes the person handles are counted. It changes nothing and sends nothing. Use messages.draft_reply on one conversation to prepare an answer from approved sources. " +
    "A conversation that mentions a child is listed without its subject: say the person can read it on the screen.",
  level: "read",
  permission: "commsInbox",
  module: "comms",
  input,
  async execute(ctx, { inbox_id }) {
    const { db, center } = ctx.session;
    if (!inboxAllowed(ctx.session)) throw new CommandError("You don't handle any inbox (needs comms.inbox or a zone lead role).");
    const now = ctx.now?.() ?? new Date();

    const inboxes = (must(await db.from("inboxes").select("id, name, zone_id, response_target_hours").eq("center_id", center.id).order("name"), "read the inboxes") ?? []) as InboxRow[];
    const found = (must(
      await db
        .from("threads")
        .select("id, inbox_id, status, assignee_user, first_response_at, created_at, subject, from_person_id")
        .eq("center_id", center.id)
        .neq("status", "closed")
        .order("created_at", { ascending: true })
        .limit(MAX_THREADS + 1),
      "read the conversations",
    ) ?? []) as ThreadRow[];
    const truncated = found.length > MAX_THREADS;
    const threads = found.slice(0, MAX_THREADS).filter((t) => !inbox_id || t.inbox_id === inbox_id);
    if (inbox_id && !inboxes.some((i) => i.id === inbox_id)) throw new CommandError("That inbox was not found, or you don't handle it.");

    const counts = triageCounts(threads, inboxes, now);
    const names = new Map(inboxes.map((i) => [i.id, i.name]));

    // The oldest conversations waiting on us. For Niva a conversation by a child, or one that names a child, loses its subject.
    const waiting = threads
      .filter((t) => t.status === "open" || t.status === "assigned")
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
      .slice(0, LIST);
    const guard = await childGuard(ctx);
    const adult = guard.active ? await adultsAmong(ctx, waiting.map((t) => t.from_person_id)) : new Map<string, boolean>();
    const oldest = waiting.map((t) => {
      const hidden = guard.active && ((t.from_person_id !== null && adult.get(t.from_person_id) !== true) || guard.mentions(t.subject));
      return {
        thread_id: t.id,
        ref: refCode("Q", t.id),
        inbox: names.get(t.inbox_id) ?? "Inbox",
        waited: waitedWords(ageHours(t.created_at, now)),
        held_by: (t.assignee_user ? (t.assignee_user === ctx.session.userId ? "you" : "a colleague") : "nobody") as "you" | "a colleague" | "nobody",
        from: (t.from_person_id ? "a member" : "a guest") as "a member" | "a guest",
        needs_first_reply: !t.first_response_at,
        subject: hidden ? WITHHELD_FOR_CHILD : t.subject,
      };
    });

    const notes: string[] = [];
    if (truncated) notes.push(`More than ${MAX_THREADS} conversations are open; the oldest ${MAX_THREADS} are counted.`);

    // WhatsApp group requests: the queue is for comms.view / comms.send holders, so an inbox-only role is told, not shown zero.
    let whatsapp: InboxTriageData["whatsapp"] = null;
    if (canAccess(ctx.session, "comms")) {
      const reqs = (must(
        await db.from("whatsapp_join_requests").select("id, group_id, status, created_at").eq("center_id", center.id).in("status", ["pending", "approved"]).order("created_at", { ascending: true }).limit(50),
        "read the WhatsApp requests",
      ) ?? []) as { id: string; group_id: string; status: string; created_at: string }[];
      const groups = (must(await db.from("whatsapp_groups").select("id, name").eq("center_id", center.id), "read the WhatsApp groups") ?? []) as { id: string; name: string }[];
      const groupName = new Map(groups.map((g) => [g.id, g.name]));
      whatsapp = {
        waiting: reqs.length,
        requests: reqs.slice(0, LIST).map((r) => ({ request_id: r.id, group: groupName.get(r.group_id) ?? "a group", status: r.status, waited: waitedWords(ageHours(r.created_at, now)) })),
      };
    } else {
      notes.push("Your role can't see the WhatsApp group requests, so they are not counted here.");
    }

    return {
      ok: true,
      data: {
        as_of: now.toISOString(),
        open: counts.open,
        waiting_on_us: counts.waiting_on_us,
        waiting_on_member: counts.waiting_on_member,
        unassigned: counts.unassigned,
        no_first_reply: counts.no_first_reply,
        past_target: counts.past_target,
        by_age: counts.by_age.map(({ label, count }) => ({ label, count })),
        by_inbox: counts.by_inbox,
        oldest,
        whatsapp,
        truncated,
        notes,
      },
    };
  },
});
