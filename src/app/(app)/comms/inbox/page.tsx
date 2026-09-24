import type { Metadata } from "next";
import Link from "next/link";

import { RowActions } from "@/components/row-actions";
import { Card, ChipLinks, EmptyState, NoAccess, QueryError, TableWrap } from "@/components/ui";
import { ageLabel, refCode } from "@/lib/comms";
import { personNames } from "@/lib/data/content-comms";
import { userNames } from "@/lib/data/lookups";
import { can } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { setThreadAction } from "../actions";
import { CommsHeader } from "../shared";

export const metadata: Metadata = { title: "Communications · Inbox" };

const SUB = "Questions and zone messages land here, never on personal phones";

export default async function InboxPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const all = can(session, "comms.inbox");
  const zoneLead = session.roles.some((r) => r.key === "zone_lead");
  if (!all && !zoneLead) {
    return (
      <>
        <CommsHeader sub={SUB} />
        <NoAccess area="The inbox" access="commsInbox" extra="Zone leads also see their zone's inbox." />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const inboxId = param(sp, "inbox");
  const show = param(sp, "show") === "closed" ? "closed" : "open";

  const inboxes = await db.from("inboxes").select("id, name, zone_id, response_target_hours").eq("center_id", center.id).order("name");
  let q = db.from("threads").select("*").eq("center_id", center.id).order("created_at").limit(300);
  q = show === "closed" ? q.eq("status", "closed") : q.neq("status", "closed");
  const threads = await q;
  // RLS returns only the threads this user may handle (all, or their zone's).
  const list = (threads.data ?? []).filter((t) => !inboxId || t.inbox_id === inboxId);
  const firstMessages = list.length
    ? await db.from("thread_messages").select("thread_id, body, created_at").in("thread_id", list.map((t) => t.id)).eq("from_role", false).order("created_at")
    : null;
  const preview = new Map<string, string>();
  for (const m of firstMessages?.data ?? []) if (!preview.has(m.thread_id)) preview.set(m.thread_id, m.body);
  const [senders, assignees] = await Promise.all([
    personNames(db, list.map((t) => t.from_person_id)),
    userNames(db, center.id, list.map((t) => t.assignee_user)),
  ]);
  const inboxName = new Map((inboxes.data ?? []).map((i) => [i.id, i.name]));
  const visibleInboxIds = new Set((threads.data ?? []).map((t) => t.inbox_id));
  const chipInboxes = (inboxes.data ?? []).filter((i) => all || visibleInboxIds.has(i.id) || i.zone_id);
  const now = new Date();
  const countFor = (id?: string) => (threads.data ?? []).filter((t) => !id || t.inbox_id === id).length;
  const error = inboxes.error ?? threads.error ?? firstMessages?.error ?? null;

  return (
    <>
      <CommsHeader sub={SUB} />
      <ChipLinks
        label="Inboxes"
        active={inboxId ?? "all"}
        items={[
          { key: "all", label: `All inboxes (${countFor()})`, href: `/comms/inbox${show === "closed" ? "?show=closed" : ""}` },
          ...chipInboxes
            .filter((i) => all || countFor(i.id) > 0)
            .map((i) => ({ key: i.id, label: `${i.name} (${countFor(i.id)})`, href: `/comms/inbox?inbox=${i.id}${show === "closed" ? "&show=closed" : ""}` })),
        ]}
      />
      <Card
        padded={false}
        actions={
          <Link href={`/comms/inbox?${new URLSearchParams({ ...(inboxId ? { inbox: inboxId } : {}), ...(show === "open" ? { show: "closed" } : {}) }).toString()}`} className="crm-link text-[13px]">
            {show === "open" ? "Show closed conversations" : "Show open conversations"}
          </Link>
        }
        title={show === "open" ? "Open conversations" : "Closed conversations"}
      >
        {error ? (
          <div className="p-4">
            <QueryError what="the inbox" error={error} retryHref="/comms/inbox" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title={show === "open" ? "Nothing waiting" : "No closed conversations"} />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>From</th>
                  <th>Topic</th>
                  <th>Message</th>
                  <th>Age</th>
                  <th>Assignee</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const from = t.from_person_id ? (senders.get(t.from_person_id) ?? "Member") : `Guest${t.from_guest_contact ? ` · ${t.from_guest_contact}` : ""}`;
                  const msg = t.subject ?? preview.get(t.id) ?? "(no message)";
                  return (
                    <tr key={t.id}>
                      <td className="font-mono whitespace-nowrap">{refCode("Q", t.id)}</td>
                      <td className="font-bold">{from}</td>
                      <td>{inboxName.get(t.inbox_id) ?? "Inbox"}</td>
                      <td className="max-w-[28rem]">
                        <Link href={`/comms/threads/${t.id}`} className="crm-link line-clamp-2">
                          {msg}
                        </Link>
                        {!t.first_response_at && show === "open" ? <div className="text-xs font-bold text-brown">Needs a reply</div> : null}
                      </td>
                      <td className="whitespace-nowrap">{ageLabel(t.created_at, now)}</td>
                      <td>
                        {t.assignee_user ? (
                          <span className="font-semibold">{t.assignee_user === session.userId ? "You" : (assignees.get(t.assignee_user)?.name ?? "Assigned")}</span>
                        ) : (
                          <span className="font-semibold text-danger">Unassigned</span>
                        )}
                      </td>
                      <td className="text-right">
                        {!t.assignee_user && show === "open" ? (
                          <RowActions action={setThreadAction} fields={{ id: t.id }} buttons={[{ label: "Take it", value: "assign_me", variant: "primary" }]} />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
