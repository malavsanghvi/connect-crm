import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Toggle } from "@/components/controls";
import { RowActions, type RowButton } from "@/components/row-actions";
import { Card, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { refCode } from "@/lib/comms";
import { personNames } from "@/lib/data/content-comms";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { replyToThreadAction, setThreadAction } from "../../actions";

export const metadata: Metadata = { title: "Communications · Conversation" };

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await getSession();
  const back = (
    <Link href="/comms/inbox" className="crm-link">
      ← Inbox
    </Link>
  );
  if (!can(session, "comms.inbox") && !session.roles.some((r) => r.key === "zone_lead")) {
    return (
      <>
        <PageHeader title="Communications" eyebrow={back} />
        <NoAccess area="The inbox" access="commsInbox" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const t = await db.from("threads").select("*").eq("id", id).maybeSingle();
  if (t.error) {
    return (
      <>
        <PageHeader title="Communications" eyebrow={back} />
        <QueryError what="the conversation" error={t.error} retryHref={`/comms/threads/${id}`} />
      </>
    );
  }
  if (!t.data) notFound();
  const thread = t.data;
  const [inbox, messages] = await Promise.all([
    db.from("inboxes").select("name, response_target_hours").eq("id", thread.inbox_id).maybeSingle(),
    db.from("thread_messages").select("*").eq("thread_id", id).order("created_at"),
  ]);
  const list = messages.data ?? [];
  const [people, users] = await Promise.all([personNames(db, [thread.from_person_id]), userNames(db, center.id, [...list.map((m) => m.author_user), thread.assignee_user])]);
  const from = thread.from_person_id ? (people.get(thread.from_person_id) ?? "Member") : (thread.from_guest_contact ?? "Guest");
  const inboxName = inbox.data?.name ?? "Inbox";
  const buttons: RowButton[] = [];
  if (thread.assignee_user !== session.userId) buttons.push({ label: "Take it", value: "assign_me", variant: "primary" });
  if (thread.assignee_user) buttons.push({ label: "Unassign", value: "unassign", variant: "ghost" });
  buttons.push(thread.status === "closed" ? { label: "Reopen", value: "reopen", variant: "ghost" } : { label: "Close", value: "close", variant: "bad" });

  return (
    <>
      <PageHeader
        title={thread.subject ?? "(no subject)"}
        eyebrow={back}
        tabs={false}
        description={`${refCode("Q", thread.id)} · ${inboxName} · from ${from} · ${formatDateTime(thread.created_at, tz)} · ${
          thread.assignee_user ? `assigned to ${thread.assignee_user === session.userId ? "you" : (users.get(thread.assignee_user)?.name ?? "a colleague")}` : "unassigned"
        }${inbox.data ? ` · reply target ${inbox.data.response_target_hours} hours` : ""}`}
        actions={<RowActions action={setThreadAction} fields={{ id: thread.id }} buttons={buttons} />}
      />
      <Card>
        {messages.error ? <QueryError what="the messages" error={messages.error} retryHref={`/comms/threads/${id}`} /> : null}
        <ol className="flex flex-col gap-3">
          {list.map((m) => (
            <li key={m.id} className={`max-w-[85%] rounded-[12px] p-3 text-sm ${m.from_role ? "ml-auto bg-navy-50" : "bg-[#F6F2EA]"}`}>
              <p className="whitespace-pre-line">{m.body}</p>
              <p className="mt-1 text-xs text-muted">
                {m.from_role ? `${inboxName}${m.author_user ? ` (${m.author_user === session.userId ? "you" : (users.get(m.author_user)?.name ?? "staff")})` : ""}` : from} ·{" "}
                {formatDateTime(m.created_at, tz)}
              </p>
            </li>
          ))}
          {list.length === 0 && !messages.error ? <li className="text-sm text-muted">No messages.</li> : null}
        </ol>
        <div className="mt-4 border-t border-line pt-4">
          <ActionForm action={replyToThreadAction} submitLabel="Send reply" resetOnSuccess>
            <input type="hidden" name="id" value={thread.id} />
            <label htmlFor="reply" className="crm-label">
              Reply
            </label>
            <textarea id="reply" name="body" rows={4} required className="crm-input mb-2" placeholder="Replies go out from the inbox, never your personal number." />
            <div className="mb-3">
              <Toggle name="close" label="Close after replying" onNote="Close the conversation after replying" offNote="Keep it open" />
            </div>
          </ActionForm>
        </div>
      </Card>
    </>
  );
}
