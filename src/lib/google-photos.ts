// Google Photos albums (migration 0564): is a link a shared Google Photos album, how an imported
// photo's address becomes a thumbnail or a full-size picture, and the import status the album page shows.
//
// An album's photos are imported from its external_url by the background service
// (worker/src/handlers/photos.import_album.ts). An imported photo is an ordinary row of app.photos whose
// storage_path is the image's BASE address, https://lh3.googleusercontent.com/pw/<token>, with no size
// suffix. Google serves any size from it, with no cookie or Referer, by appending a suffix.

/** photos.app.goo.gl/<id> or photos.google.com/share/<id>?key=..., the same rule as app.is_google_photos_album_url. */
const SHORT_LINK = /^https?:\/\/photos\.app\.goo\.gl\/[A-Za-z0-9_-]{8,64}\/?(?:[?#]\S*)?$/i;
const LONG_LINK = /^https?:\/\/photos\.google\.com\/(?:u\/\d{1,2}\/)?share\/[A-Za-z0-9_-]{20,200}\/?(?:[?#]\S*)?$/i;

/** Whether this looks like a Google Photos shared-album link. Another site, a single photo or a private album page is not. */
export function isGooglePhotosAlbumUrl(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  return s.length > 0 && s.length <= 2000 && (SHORT_LINK.test(s) || LONG_LINK.test(s));
}

/** A bare Google image address (no "=size" suffix): what an imported photo's storage_path holds. */
const GOOGLE_IMAGE_BASE = /^https:\/\/lh[3-6]\.googleusercontent\.com\/[A-Za-z0-9_/-]{40,255}$/;

export function isGoogleImageBase(url: string): boolean {
  return GOOGLE_IMAGE_BASE.test(url.trim());
}

/** The size suffixes verified to load without cookies or a Referer: a square-cropped grid thumbnail, and a full-screen view. */
export const GOOGLE_PHOTO_SUFFIX = { thumb: "=w480-h480-c", full: "=w1600" } as const;
export type GooglePhotoSize = keyof typeof GOOGLE_PHOTO_SUFFIX;

/**
 * The address to show for a photo. A bare Google image address gets the size suffix (without one Google
 * sends only a small default picture); any other address, including one that already has a suffix, is
 * returned as it is.
 */
export function googlePhotoUrl(url: string, size: GooglePhotoSize): string {
  const u = url.trim();
  return isGoogleImageBase(u) ? u + GOOGLE_PHOTO_SUFFIX[size] : url;
}

/** What app.photo_album_import_status returns, in the shape the album page uses. */
export type AlbumImportStatus = {
  hasLink: boolean;
  importing: boolean;
  /** When the queued or running import was requested. */
  since: string | null;
  /** When photos were last imported. */
  syncedAt: string | null;
  /** How many photos the last import found on the Google Photos album. */
  photoCount: number | null;
  /** Plain-English reason the last import failed or only partly worked. */
  error: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function parseImportStatus(v: unknown): AlbumImportStatus | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    hasLink: o.has_link === true,
    importing: o.importing === true,
    since: str(o.since),
    syncedAt: str(o.synced_at),
    photoCount: typeof o.photo_count === "number" ? o.photo_count : null,
    error: str(o.error),
  };
}

export type ImportLine = { tone: "info" | "ok" | "bad"; text: string };

/**
 * The one line under the import button. `when` formats a timestamp for the community's time zone.
 * While an import runs, its status is "importing"; otherwise the last error wins over the last success.
 */
export function importStatusLine(s: AlbumImportStatus, when: (iso: string) => string): ImportLine {
  const found = s.photoCount === null ? "" : ` Google Photos had ${s.photoCount.toLocaleString("en-US")} photo${s.photoCount === 1 ? "" : "s"}.`;
  if (s.importing) {
    return { tone: "info", text: `Importing… ${s.since ? `started ${when(s.since)}. ` : ""}This usually takes a minute or two. Reload this page to see how it went.` };
  }
  if (s.error) {
    return {
      tone: "bad",
      text: `${s.syncedAt ? "The last import did not finish cleanly" : "The import did not work"}: ${s.error}${/[.!?]$/.test(s.error) ? "" : "."}${s.syncedAt ? ` (Last good import: ${when(s.syncedAt)}.${found})` : ""}`,
    };
  }
  if (s.syncedAt) return { tone: "ok", text: `Last imported ${when(s.syncedAt)}.${found}` };
  return { tone: "info", text: "Nothing has been imported from this link yet." };
}
