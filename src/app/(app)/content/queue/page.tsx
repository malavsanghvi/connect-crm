import type { Metadata } from "next";
import Link from "next/link";

import { DrawerForm } from "@/components/drawer-form";
import { RowActions } from "@/components/row-actions";
import { Card, EmptyState, QueryError, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { contentKindLabel } from "@/lib/content";
import { refCode } from "@/lib/comms";
import { userNames } from "@/lib/data/lookups";
import { groupQueueItems, pageRowLabel, paginateQueue, queuePageSummary, sectionCount, type QueueEntry, type QueueSourceRow } from "@/lib/niva-queue";
import { can, canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { decideAlbumPhotosAction, decideContentAction } from "../actions";
import { ContentHeader, contentGate } from "../shared";
import { ApproveItemButton, ItemTextButton, NivaPageReview, QueueResults } from "./page-review";

export const metadata: Metadata = { title: "Content · Approval queue" };

const SUB = "Religious text needs an approver; photos with children are moderated before showing";

/** PostgREST returns at most this many rows per request (supabase/config.toml max_rows). */
const FETCH_CHUNK = 1000;
/** The queue lists at most this many waiting items; the page says so when there are more. */
const FETCH_MAX = 5000;
/** Texts are read for the shown page only, this many ids per request (keeps the address short). */
const TEXT_CHUNK = 50;

type PhotoRow = { kind: "photos"; id: string; title: string; count: number; children: boolean; by: (string | null)[]; at: string };
type QueueRow = QueueEntry | PhotoRow;

export default async function ApprovalQueuePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const gate = contentGate(session, SUB);
  if (gate) return gate;
  const sp = await searchParams;
  const { db, center } = session;
  const canApprove = canAccess(session, "contentApprove") && can(session, "content.manage");
  const canModerate = canAccess(session, "contentManage");

  // Everything awaiting approval, oldest first (ties by id, so the chunks line up). Without the text:
  // that is read below for the items on the shown page only.
  const waiting = (withCount = false) =>
    db
      .from("content_items")
      .select("id, title, kind, created_by, updated_at, metadata", { count: withCount ? "exact" : undefined })
      .eq("center_id", center.id)
      .eq("status", "in_review")
      .order("updated_at")
      .order("id");
  const [items, photos] = await Promise.all([
    waiting(true).range(0, FETCH_CHUNK - 1),
    canModerate
      ? db.from("photos").select("id, album_id, uploaded_by, contains_children, created_at").eq("center_id", center.id).eq("status", "pending").order("created_at").limit(1000)
      : null,
  ]);
  const totalWaiting = items.count ?? items.data?.length ?? 0;
  const later: ReturnType<typeof waiting>[] = [];
  for (let from = FETCH_CHUNK; !items.error && from < Math.min(totalWaiting, FETCH_MAX); from += FETCH_CHUNK) later.push(waiting().range(from, from + FETCH_CHUNK - 1));
  const more = await Promise.all(later);
  const itemRows: QueueSourceRow[] = [...(items.data ?? []), ...more.flatMap((r) => r.data ?? [])];
  const notListed = items.error ? 0 : Math.max(0, totalWaiting - itemRows.length);

  const albumIds = [...new Set((photos?.data ?? []).map((p) => p.album_id))];
  const albums = albumIds.length ? await db.from("photo_albums").select("id, title").in("id", albumIds) : null;
  const albumTitle = new Map((albums?.data ?? []).map((a) => [a.id, a.title]));

  const all: QueueRow[] = [
    ...groupQueueItems(itemRows),
    ...albumIds.map((aid): PhotoRow => {
      const list = (photos?.data ?? []).filter((p) => p.album_id === aid);
      return {
        kind: "photos",
        id: aid,
        title: `${list.length} photo${list.length === 1 ? "" : "s"} · ${albumTitle.get(aid) ?? "Album"} (member upload)`,
        count: list.length,
        children: list.some((p) => p.contains_children),
        by: [...new Set(list.map((p) => p.uploaded_by))],
        at: list[0]?.created_at ?? "",
      };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));
  // About 200 a page; an imported page counts each of its sections and is never split across pages.
  const pg = paginateQueue(all, (r) => (r.kind === "page" ? r.sections.length : 1), pageParam(sp));
  const rows = pg.rows;

  // The full text of what this page shows, so nothing is approved unread.
  const shownIds = rows.flatMap((r) => (r.kind === "item" ? [r.id] : r.kind === "page" ? r.sections.map((s) => s.id) : []));
  const chunks: string[][] = [];
  for (let i = 0; i < shownIds.length; i += TEXT_CHUNK) chunks.push(shownIds.slice(i, i + TEXT_CHUNK));
  const texts = await Promise.all(chunks.map((ids) => db.from("content_items").select("id, body_md").in("id", ids)));
  const textError = texts.find((t) => t.error)?.error ?? null;
  const bodyOf = new Map(texts.flatMap((t) => t.data ?? []).map((t) => [t.id, t.body_md]));

  const people = await userNames(db, center.id, rows.flatMap((r) => (r.kind === "item" ? [r.by] : r.by)));
  const who = (uid: string | null) => (uid === session.userId ? "You" : uid ? (people.get(uid)?.name ?? "Staff") : "—");
  const byLabel = (r: QueueRow) => {
    if (r.kind === "item") return who(r.by);
    const named = r.by.filter(Boolean).map((u) => (u === session.userId ? "You" : (people.get(u as string)?.name ?? null)));
    const first = named.find(Boolean);
    if (!first) return r.kind === "page" ? who(r.by[0] ?? null) : r.by.length > 1 ? `${r.by.length} members` : "Member";
    return r.by.length > 1 ? `${first} and ${r.by.length - 1} other${r.by.length === 2 ? "" : "s"}` : first;
  };
  const error = items.error ?? more.find((r) => r.error)?.error ?? photos?.error ?? albums?.error ?? null;
  const pageHref = (n: number) => hrefWith("/content/queue", sp, { page: n > 1 ? n : undefined });

  return (
    <>
      <ContentHeader sub={SUB} />
      <QueueResults>
        <Card padded={false}>
          {error ? (
            <div className="p-4">
              <QueryError what="the approval queue" error={error} retryHref="/content/queue" />
            </div>
          ) : null}
          {textError ? (
            <div className="p-4">
              <QueryError what="the text of the waiting items, so they can't be read or published from here" error={textError} retryHref={pageHref(pg.page)} />
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
                    <tr key={`${r.kind}-${r.kind === "page" ? r.url : r.id}`}>
                      <td className="font-mono whitespace-nowrap">
                        {r.kind === "page"
                          ? `${refCode("CT", r.sections[0]?.id)}${r.sections.length > 1 ? ` +${r.sections.length - 1}` : ""}`
                          : refCode(r.kind === "item" ? "CT" : "PH", r.id)}
                      </td>
                      {r.kind === "page" ? (
                        <td title={pageRowLabel(r)}>
                          <span className="font-bold">{r.title}</span>
                          <span className="text-muted"> · {sectionCount(r.sections.length)} · </span>
                          <span className="break-all text-[12px] text-muted">{r.url}</span>
                        </td>
                      ) : (
                        <td className="font-bold">{r.title}</td>
                      )}
                      <td>
                        {r.kind === "item"
                          ? contentKindLabel(r.itemKind)
                          : r.kind === "page"
                            ? "Niva source · imported page"
                            : r.children
                              ? "Photos (children present)"
                              : "Photos"}
                      </td>
                      <td>{byLabel(r)}</td>
                      <td>
                        <StatusText tone="warn">Awaiting approval</StatusText>
                      </td>
                      <td className="text-right">
                        {r.kind === "page" ? (
                          textError ? (
                            <span className="text-xs text-muted">Text not loaded</span>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <NivaPageReview
                                canApprove={canApprove}
                                page={{
                                  url: r.url,
                                  title: r.title,
                                  sections: r.sections.map((s) => ({ id: s.id, heading: s.heading, title: s.title, body: bodyOf.get(s.id) ?? null })),
                                }}
                              />
                              {!canApprove ? <span className="text-xs text-muted">Needs an approver</span> : null}
                            </div>
                          )
                        ) : null}
                        {r.kind === "item" ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {!textError ? (
                              <ItemTextButton
                                id={r.id}
                                title={r.title}
                                kindLabel={contentKindLabel(r.itemKind)}
                                body={bodyOf.get(r.id) ?? null}
                                niva={r.itemKind === "niva_source"}
                                canApprove={canApprove}
                              />
                            ) : null}
                            {canApprove ? (
                              <>
                                <DrawerForm label="Return" variant="bad" size="xs" kicker={refCode("CT", r.id)} title={`Return “${r.title}”`} subtitle="It goes back to its author as a draft." action={decideContentAction} submitLabel="Return to author">
                                  <input type="hidden" name="id" value={r.id} />
                                  <input type="hidden" name="decision" value="return" />
                                  <label htmlFor={`ret-${r.id}`} className="crm-label">
                                    What should the author change?
                                  </label>
                                  <textarea id={`ret-${r.id}`} name="reason" required rows={3} className="crm-input" />
                                  <p className="crm-hint">Kept with the item&apos;s history.</p>
                                </DrawerForm>
                                <ApproveItemButton id={r.id} title={r.title} niva={r.itemKind === "niva_source"} />
                              </>
                            ) : (
                              <span className="text-xs text-muted">Needs an approver</span>
                            )}
                          </div>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
          {rows.length > 0 && (pg.pages > 1 || notListed > 0) ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-muted">
              <span>
                {queuePageSummary(pg)}
                {notListed > 0
                  ? ` ${notListed.toLocaleString("en-US")} more ${notListed === 1 ? "is" : "are"} waiting beyond the ${FETCH_MAX.toLocaleString("en-US")} listed here; approve or return some to see them.`
                  : ""}
              </span>
              <span className="flex gap-2">
                {pg.page > 1 ? (
                  <Link href={pageHref(pg.page - 1)} className={buttonClass("ghost", "xs")}>
                    Previous
                  </Link>
                ) : null}
                {pg.page < pg.pages ? (
                  <Link href={pageHref(pg.page + 1)} className={buttonClass("ghost", "xs")}>
                    Next
                  </Link>
                ) : null}
              </span>
            </div>
          ) : null}
        </Card>
      </QueueResults>
    </>
  );
}
