import type { Metadata } from "next";
import Link from "next/link";

import { DrawerForm } from "@/components/drawer-form";
import { Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { ALBUM_VISIBILITY_LABEL } from "@/lib/content";
import { fetchAll } from "@/lib/data/fetch-all";
import { formatDate } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { createAlbumAction } from "../actions";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Photo albums" };

const SUB = "Albums shown under Events › Photos · member uploads wait for moderation";

export default async function PhotoAlbumsPage() {
  const session = await getSession();
  const gate = contentGate(session, SUB);
  if (gate) return gate;
  const { db, center } = session;
  const tz = center.time_zone;
  const canManage = canAccess(session, "contentManage");

  const [albums, photos, events] = await Promise.all([
    db.from("photo_albums").select("*").eq("center_id", center.id).order("created_at", { ascending: false }),
    fetchAll((f, t) => db.from("photos").select("id, album_id, status").eq("center_id", center.id).order("id").range(f, t)),
    db.from("events").select("id, name, starts_at, ends_at").eq("center_id", center.id).order("starts_at", { ascending: false, nullsFirst: true }).limit(200),
  ]);
  const eventById = new Map((events.data ?? []).map((e) => [e.id, e]));
  const counts = new Map<string, { total: number; pending: number }>();
  for (const p of photos.data) {
    const c = counts.get(p.album_id) ?? { total: 0, pending: 0 };
    if (p.status !== "rejected" && p.status !== "removed") c.total += 1;
    if (p.status === "pending") c.pending += 1;
    counts.set(p.album_id, c);
  }

  return (
    <>
      <ContentHeader
        sub={SUB}
        actions={
          canManage ? (
            <DrawerForm label="New album" kicker="Photo albums" title="New album" subtitle="Album linked to an event; photos upload from the ops app or web" action={createAlbumAction} submitLabel="Create album">
              <div>
                <label htmlFor="al-title" className="crm-label">
                  Album
                </label>
                <input id="al-title" name="title" required className="crm-input" placeholder="Mahavir Janma Vanchan 2026" />
              </div>
              <div>
                <label htmlFor="al-event" className="crm-label">
                  Event
                </label>
                <select id="al-event" name="event_id" defaultValue="" className="crm-input">
                  <option value="">Not linked to an event</option>
                  {(events.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.starts_at ? ` — ${formatDate(e.starts_at, tz)}` : ""}
                    </option>
                  ))}
                </select>
                {events.error ? <p className="crm-hint text-danger">The event list could not be loaded; the album can still be created without one.</p> : null}
              </div>
              <div>
                <label htmlFor="al-vis" className="crm-label">
                  Visible to
                </label>
                <select id="al-vis" name="visibility" defaultValue="members" className="crm-input">
                  <option value="members">Members</option>
                  <option value="public">Everyone (public)</option>
                  <option value="private">Staff only</option>
                </select>
              </div>
              <div>
                <label htmlFor="al-url" className="crm-label">
                  External album link (optional)
                </label>
                <input id="al-url" name="external_url" placeholder="https://" className="crm-input" />
              </div>
            </DrawerForm>
          ) : null
        }
      />
      <Card title="Albums" padded={false} className="mb-4">
        {albums.error || photos.error ? (
          <div className="p-4">
            <QueryError what="the photo albums" error={albums.error ?? photos.error} retryHref="/content/photos" />
          </div>
        ) : null}
        {photos.truncated ? <p className="px-4 pt-2 text-[13px] text-brown">Counts use the first 50,000 photos only.</p> : null}
        {(albums.data ?? []).length === 0 && !albums.error ? (
          <EmptyState title="No albums yet" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Album</th>
                  <th>Date</th>
                  <th className="num">Items</th>
                  <th>Moderation</th>
                  <th>Visible to</th>
                </tr>
              </thead>
              <tbody>
                {(albums.data ?? []).map((a) => {
                  const c = counts.get(a.id) ?? { total: 0, pending: 0 };
                  const ev = a.event_id ? eventById.get(a.event_id) : undefined;
                  return (
                    <tr key={a.id}>
                      <td className="font-bold">
                        <Link href={`/content/photos/${a.id}`} className="crm-link">
                          {a.title}
                        </Link>
                        {ev ? <div className="text-xs font-normal text-muted">{ev.name}</div> : null}
                      </td>
                      <td className="whitespace-nowrap">{formatDate(ev?.starts_at ?? a.created_at, tz)}</td>
                      <td className="num">{a.external_url && c.total === 0 ? "Link" : c.total}</td>
                      <td>
                        {!canManage ? (
                          <span className="text-muted">—</span>
                        ) : c.pending > 0 ? (
                          <Link href={`/content/photos/${a.id}?status=pending`} className="cc-status-warn hover:underline">
                            {c.pending} member upload{c.pending === 1 ? "" : "s"} waiting
                          </Link>
                        ) : (
                          <StatusText tone="ok">Clear</StatusText>
                        )}
                      </td>
                      <td>{ALBUM_VISIBILITY_LABEL[a.visibility] ?? a.visibility}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {!canManage ? <p className="px-4 pb-3 pt-1 text-xs text-muted">Waiting uploads are visible to content managers (content.manage) only.</p> : null}
      </Card>
      <Card title="Rules">
        <p className="text-[13px] text-ink-2">
          Photos with children appear only after approval and only for families who opted in to photos at onboarding. Members can ask for a photo of their family to be removed.
        </p>
      </Card>
    </>
  );
}
