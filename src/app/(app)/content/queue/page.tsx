import type { Metadata } from "next";
import Link from "next/link";

import { RowActions } from "@/components/row-actions";
import { Card, EmptyState, QueryError, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { contentKindLabel } from "@/lib/content";
import { refCode } from "@/lib/comms";
import { userNames } from "@/lib/data/lookups";
import { can, canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { decideAlbumPhotosAction, decideContentAction } from "../actions";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Approval queue" };

const SUB = "Religious text needs an approver; photos with children are moderated before showing";

type QueueRow =
  | { kind: "item"; id: string; title: string; type: string; by: string | null; at: string }
  | { kind: "photos"; id: string; title: string; count: number; children: boolean; by: (string | null)[]; at: string };

export default async function ApprovalQueuePage() {
  const session = await getSession();
  const gate = contentGate(session, SUB);
  if (gate) return gate;
  const { db, center } = session;
  const canApprove = canAccess(session, "contentApprove") && can(session, "content.manage");
  const canModerate = canAccess(session, "contentManage");

  const [items, photos] = await Promise.all([
    db
      .from("content_items")
      .select("id, title, kind, created_by, created_at, updated_at")
      .eq("center_id", center.id)
      .eq("status", "in_review")
      .order("updated_at")
      .limit(200),
    canModerate
      ? db.from("photos").select("id, album_id, uploaded_by, contains_children, created_at").eq("center_id", center.id).eq("status", "pending").order("created_at").limit(1000)
      : null,
  ]);
  const albumIds = [...new Set((photos?.data ?? []).map((p) => p.album_id))];
  const albums = albumIds.length ? await db.from("photo_albums").select("id, title").in("id", albumIds) : null;
  const albumTitle = new Map((albums?.data ?? []).map((a) => [a.id, a.title]));

  const rows: QueueRow[] = [
    ...(items.data ?? []).map((c) => ({ kind: "item" as const, id: c.id, title: c.title, type: contentKindLabel(c.kind), by: c.created_by, at: c.updated_at })),
    ...albumIds.map((aid) => {
      const list = (photos?.data ?? []).filter((p) => p.album_id === aid);
      return {
        kind: "photos" as const,
        id: aid,
        title: `${list.length} photo${list.length === 1 ? "" : "s"} · ${albumTitle.get(aid) ?? "Album"} (member upload)`,
        count: list.length,
        children: list.some((p) => p.contains_children),
        by: [...new Set(list.map((p) => p.uploaded_by))],
        at: list[0]?.created_at ?? "",
      };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const people = await userNames(db, center.id, rows.flatMap((r) => (r.kind === "item" ? [r.by] : r.by)));
  const who = (uid: string | null) => (uid === session.userId ? "You" : uid ? (people.get(uid)?.name ?? "Staff") : "—");
  const byLabel = (r: QueueRow) => {
    if (r.kind === "item") return who(r.by);
    const named = r.by.filter(Boolean).map((u) => (u === session.userId ? "You" : (people.get(u as string)?.name ?? null)));
    const first = named.find(Boolean);
    if (!first) return r.by.length > 1 ? `${r.by.length} members` : "Member";
    return r.by.length > 1 ? `${first} and ${r.by.length - 1} other${r.by.length === 2 ? "" : "s"}` : first;
  };
  const error = items.error ?? photos?.error ?? albums?.error ?? null;

  return (
    <>
      <ContentHeader sub={SUB} />
      <Card padded={false}>
        {error ? (
          <div className="p-4">
            <QueryError what="the approval queue" error={error} retryHref="/content/queue" />
          </div>
        ) : null}
        {!canModerate ? (
          <p className="px-4 pt-3 text-[13px] text-muted">Member photos need content.manage to review, so they are not listed for your role.</p>
        ) : null}
        {rows.length === 0 && !error ? (
          <EmptyState title="Nothing is awaiting approval">Items sent for approval from the Library, Niva or Today tabs, and member photo uploads, appear here.</EmptyState>
        ) : rows.length > 0 ? (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Item</th>
                  <th>Type</th>
                  <th>By</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td className="font-mono whitespace-nowrap">{refCode(r.kind === "item" ? "CT" : "PH", r.id)}</td>
                    <td className="font-bold">{r.title}</td>
                    <td>{r.kind === "item" ? r.type : r.children ? "Photos (children present)" : "Photos"}</td>
                    <td>{byLabel(r)}</td>
                    <td>
                      <StatusText tone="warn">Awaiting approval</StatusText>
                    </td>
                    <td className="text-right">
                      {r.kind === "item" && canApprove ? (
                        <RowActions
                          action={decideContentAction}
                          fields={{ id: r.id }}
                          buttons={[
                            { label: "Return", value: "return", variant: "bad" },
                            { label: "Approve", value: "approve", variant: "ok" },
                          ]}
                        />
                      ) : null}
                      {r.kind === "photos" && canModerate ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Link href={`/content/photos/${r.id}?status=pending`} className={buttonClass("ghost", "xs")}>
                            Review
                          </Link>
                          <RowActions
                            action={decideAlbumPhotosAction}
                            fields={{ album_id: r.id }}
                            buttons={[
                              { label: "Return", value: "return", variant: "bad", confirm: `Reject all ${r.count} waiting photos? Members will not see them.` },
                              {
                                label: "Approve",
                                value: "approve",
                                variant: "ok",
                                confirm: r.children
                                  ? `Approve all ${r.count} waiting photos? Some show children — they appear only for families who opted in to photos. Review them one by one if unsure.`
                                  : `Approve all ${r.count} waiting photos? Members will see them in the album.`,
                              },
                            ]}
                          />
                        </div>
                      ) : null}
                      {r.kind === "item" && !canApprove ? <span className="text-xs text-muted">Needs an approver</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </Card>
    </>
  );
}
