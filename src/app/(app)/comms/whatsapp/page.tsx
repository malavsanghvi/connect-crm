import type { Metadata } from "next";

import { RowActions } from "@/components/row-actions";
import { Card, ChipLinks, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatPhone, refCode } from "@/lib/comms";
import { personNames } from "@/lib/data/content-comms";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { handleJoinRequestAction } from "../actions";
import { CommsHeader, commsGate } from "../shared";

export const metadata: Metadata = { title: "Communications · WhatsApp queue" };

const SUB = "WhatsApp does not let apps add people automatically, so admins add from this queue";
const STATUS_LABEL: Record<string, string> = { pending: "Pending", approved: "Approved", added: "Added", declined: "Declined" };

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const gate = commsGate(session, "comms", SUB);
  if (gate) return gate;
  const sp = await searchParams;
  const show = param(sp, "show") === "all" ? "all" : "queue";
  const { db, center } = session;
  const canSend = canAccess(session, "commsSend");

  let q = db.from("whatsapp_join_requests").select("*").eq("center_id", center.id).order("created_at", { ascending: false }).limit(300);
  // The queue keeps recently added people visible (prototype), plus everything still waiting.
  if (show === "queue") q = q.in("status", ["pending", "approved", "added"]);
  const [requests, groups] = await Promise.all([q, db.from("whatsapp_groups").select("id, name").eq("center_id", center.id)]);
  let list = requests.data ?? [];
  if (show === "queue") {
    const recent = new Date(new Date().getTime() - 14 * 86_400_000).toISOString();
    list = list.filter((r) => r.status !== "added" || (r.handled_at ?? r.created_at) >= recent);
  }
  const people = await personNames(db, list.map((r) => r.person_id));
  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));
  const error = requests.error ?? groups.error;

  return (
    <>
      <CommsHeader sub={SUB} />
      <ChipLinks
        label="Requests"
        active={show}
        items={[
          { key: "queue", label: "Queue (added in the last 14 days stay visible)", href: "/comms/whatsapp" },
          { key: "all", label: "All requests", href: "/comms/whatsapp?show=all" },
        ]}
      />
      <Card padded={false}>
        {error ? (
          <div className="p-4">
            <QueryError what="the WhatsApp queue" error={error} retryHref="/comms/whatsapp" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="No join requests" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Person</th>
                  <th>Group</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono whitespace-nowrap">{refCode("WA", r.id)}</td>
                    <td className="font-bold">{people.get(r.person_id) ?? "Member"}</td>
                    <td>{groupName.get(r.group_id) ?? "Group"}</td>
                    <td className="whitespace-nowrap">{formatPhone(r.phone_e164)}</td>
                    <td>
                      <StatusText tone={r.status === "added" ? "ok" : r.status === "declined" ? "bad" : "warn"}>{STATUS_LABEL[r.status] ?? r.status}</StatusText>
                    </td>
                    <td className="text-right">
                      {canSend && (r.status === "pending" || r.status === "approved") ? (
                        <RowActions
                          action={handleJoinRequestAction}
                          fields={{ id: r.id }}
                          buttons={[
                            { label: "Decline", value: "declined", variant: "bad", confirm: "Decline this request? It leaves the queue." },
                            { label: "Mark added", value: "added", variant: "ok" },
                          ]}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {!canSend ? <p className="px-4 pb-3 pt-1 text-xs text-muted">Marking people added needs comms.send.</p> : null}
      </Card>
    </>
  );
}
