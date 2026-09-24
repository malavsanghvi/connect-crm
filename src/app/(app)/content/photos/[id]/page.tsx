import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RowActions } from "@/components/row-actions";
import { ChipLinks, EmptyState, NoAccess, PageHeader, QueryError, StatusText, buttonClass } from "@/components/ui";
import { ALBUM_VISIBILITY_LABEL } from "@/lib/content";
import { signedPhotoUrls } from "@/lib/data/content-comms";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { decideAlbumPhotosAction, moderatePhotoAction } from "../../actions";

export const metadata: Metadata = { title: "Content · Album" };

const FILTERS = [
  { key: "pending", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
] as const;

export default async function AlbumPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const session = await getSession();
  const { db, center } = session;
  const tz = center.time_zone;
  if (!canAccess(session, "content")) {
    return (
      <>
        <PageHeader title="Content" />
        <NoAccess area="Content" access="content" />
      </>
    );
  }
  const canManage = canAccess(session, "contentManage");
  const status = FILTERS.find((f) => f.key === param(sp, "status"))?.key ?? (canManage ? "pending" : "approved");

  const album = await db.from("photo_albums").select("*").eq("id", id).maybeSingle();
  if (album.error) {
    return (
      <>
        <PageHeader title="Content" />
        <QueryError what="the album" error={album.error} retryHref={`/content/photos/${id}`} />
      </>
    );
  }
  if (!album.data) notFound();
  let q = db.from("photos").select("*").eq("album_id", id).order("created_at").limit(300);
  if (status !== "all") q = q.eq("status", status);
  const photos = await q;
  const list = photos.data ?? [];
  const [urls, uploaders] = await Promise.all([signedPhotoUrls(db, list), userNames(db, center.id, list.map((p) => p.uploaded_by))]);
  const pending = list.filter((p) => p.status === "pending");

  return (
    <>
      <PageHeader
        title={album.data.title}
        eyebrow={
          <Link href="/content/photos" className="crm-link">
            ← Photo albums
          </Link>
        }
        description={`Visible to ${ALBUM_VISIBILITY_LABEL[album.data.visibility] ?? album.data.visibility}. Photos with children appear only after approval and only for families who opted in to photos.`}
        actions={
          canManage && status === "pending" && pending.length > 1 ? (
            <RowActions
              action={decideAlbumPhotosAction}
              fields={{ album_id: id }}
              buttons={[
                {
                  label: `Approve all ${pending.length}`,
                  value: "approve",
                  variant: "ok",
                  confirm: `Approve all ${pending.length} waiting photos? Check any with children first.`,
                },
              ]}
            />
          ) : null
        }
      />
      <ChipLinks label="Photo status" active={status} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: `/content/photos/${id}?status=${f.key}` }))} />
      {photos.error ? <QueryError what="the photos" error={photos.error} retryHref={`/content/photos/${id}?status=${status}`} /> : null}
      {!canManage ? <p className="mb-3 text-[13px] text-muted">Moderation needs content.manage; you see approved photos only.</p> : null}
      {list.length === 0 && !photos.error ? (
        <EmptyState title={status === "pending" ? "Nothing waiting for review in this album" : "No photos here"} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((p) => {
            const u = urls.get(p.id);
            return (
              <li key={p.id} className="cc-card overflow-hidden">
                <div className="flex aspect-[4/3] items-center justify-center bg-[#F6F2EA]">
                  {u?.url ? (
                    // Signed Storage URLs are short-lived and vary per request, so next/image caching does not apply.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.url} alt={p.caption ?? "Member photo"} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <p className="px-4 text-center text-xs text-danger">{u?.problem ?? "Preview unavailable."}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1 p-3 text-[13px]">
                  {p.caption ? <p className="font-semibold text-ink">{p.caption}</p> : null}
                  <p className="text-xs text-muted">
                    {p.uploaded_by === session.userId ? "You" : (uploaders.get(p.uploaded_by ?? "")?.name ?? "Member")} · {formatDateTime(p.created_at, tz)}
                  </p>
                  <p>
                    {p.status === "pending" ? (
                      <StatusText tone="warn">Waiting</StatusText>
                    ) : p.status === "approved" ? (
                      <StatusText tone="ok">Approved</StatusText>
                    ) : (
                      <StatusText tone="bad">{p.status === "removed" ? "Removed" : "Rejected"}</StatusText>
                    )}
                    {p.contains_children ? <span className="ml-2 font-bold text-brown">Contains children</span> : null}
                  </p>
                  {canManage ? (
                    <div className="mt-1">
                      <RowActions
                        action={moderatePhotoAction}
                        fields={{ id: p.id }}
                        buttons={
                          p.status === "pending"
                            ? [
                                { label: "Reject", value: "rejected", variant: "bad" },
                                { label: "Approve", value: "approved", variant: "ok" },
                              ]
                            : p.status === "approved"
                              ? [{ label: "Remove", value: "removed", variant: "bad", confirm: "Remove this photo from the album? Members will no longer see it." }]
                              : [{ label: "Approve", value: "approved", variant: "ok" }]
                        }
                        fieldName="status"
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {album.data.external_url ? (
        <p className="mt-4 text-[13px]">
          <a href={album.data.external_url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
            Open the external album
          </a>
        </p>
      ) : null}
    </>
  );
}
