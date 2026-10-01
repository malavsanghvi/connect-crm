// photos.import_album: bring the photos of an album's Google Photos link into Community Connect.
// Queued by app.import_external_album (Content › Photos › the album › Import photos from Google Photos)
// with { album_id, url }. The public share page is read safely (worker/src/web/google_photos.ts: honest
// user agent, one album at a time, a pause between pages, robots.txt honoured, only Google's own hosts)
// and the photos are saved through app.photos_worker_save_import as rows of app.photos whose
// storage_path is the image's base address: no file is copied or hosted here. Every imported photo
// arrives PENDING: a content manager approves them (the album page has a bulk "Approve all"), exactly like
// a member upload, and anything already in the album, including a photo rejected or removed earlier, is
// skipped, so running it again only adds what is new. A failure is recorded on the album in plain
// English (app.photos_worker_record_failure) as well as on the job.

import { messageOf, PermanentError } from "../errors";
import type { Job, JobContext } from "../types";
import { DEFAULT_PAGE_DELAY_MS, isGooglePhotosAlbumUrl, MSG_NOT_AN_ALBUM, readAlbum } from "../web/google_photos";

export const kind = "photos.import_album";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One album at a time in this service, however many import jobs are due: Google is asked politely.
let tail: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const p = tail.then(fn, fn);
  tail = p.catch(() => undefined);
  return p;
}

export async function run(job: Job, ctx: JobContext) {
  const albumId = typeof job.payload?.album_id === "string" ? job.payload.album_id.trim() : "";
  const url = typeof job.payload?.url === "string" ? job.payload.url.trim() : "";
  if (!UUID.test(albumId)) throw new PermanentError("The import job does not say which album it is for.");
  if (!job.center_id) throw new PermanentError("The import job does not say which community it is for.");
  const centerId = job.center_id;

  const recordFailure = async (message: string) => {
    try {
      await ctx.db.query("select app.photos_worker_record_failure($1::uuid, $2::uuid, $3)", [centerId, albumId, message.slice(0, 500)]);
    } catch (err) {
      ctx.log.warn("could not record the album import failure", { error: messageOf(err) });
    }
  };

  try {
    if (!isGooglePhotosAlbumUrl(url)) throw new PermanentError(MSG_NOT_AN_ALBUM);
    const configured = ctx.env.PHOTO_IMPORT_DELAY_MS;
    const delayMs = configured !== undefined && configured.trim() !== "" && Number.isFinite(Number(configured)) ? Number(configured) : DEFAULT_PAGE_DELAY_MS;
    const album = await oneAtATime(() =>
      readAlbum(ctx.http, url, {
        allowPrivate: ctx.env.NIVA_IMPORT_ALLOW_PRIVATE === "1",
        delayMs,
      }),
    );
    const rows = await ctx.db.query<{ r: Record<string, unknown> }>("select app.photos_worker_save_import($1::uuid, $2::uuid, $3::jsonb, $4::int, $5::int, $6) as r", [
      centerId,
      albumId,
      JSON.stringify(album.photos.map((p) => p.base)),
      album.photos.length,
      album.videos,
      album.note,
    ]);
    const saved = rows[0]?.r ?? {};
    ctx.log.info("album photos imported", { album: albumId, pages: album.pages, found: album.photos.length, videos: album.videos });
    return { album_id: albumId, album_title: album.title, pages: album.pages, found: album.photos.length, videos_skipped: album.videos, unreadable: album.skipped, ...saved };
  } catch (err) {
    await recordFailure(messageOf(err));
    throw err;
  }
}
