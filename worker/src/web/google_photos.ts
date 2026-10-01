// Reading a PUBLIC Google Photos shared album (photos.import_album).
//
// Google offers no API for listing an album you do not own, so this reads the same public page a
// browser shows for a share link (https://photos.app.goo.gl/<id>, which redirects to
// https://photos.google.com/share/<album>?key=<key>). No sign-in, cookies or Google account are used.
//
//   1. The page's HTML carries the first 300 photos in an `AF_initDataCallback({key: 'ds:1', data: [...]})`
//      script. data[1] is the list of items, data[2] a continuation token ("" or null at the end),
//      data[3] the album's details (its id, title). Each item is
//      [mediaKey, [baseUrl, width, height, ...], takenAtMs, ..., {metadata}]; a VIDEO carries the key
//      "76647426" in that metadata object (a photo does not).
//   2. The rest of a large album comes from the page's own paging call: POST
//      /_/PhotosUi/data/batchexecute  rpcids=snAcKc  with args [albumKey, token, null, authKey]
//      (the album id, the continuation token and the share key). Each answer carries up to 300 more
//      items and the next token.
//   3. A base URL (https://lh3.googleusercontent.com/pw/<token>) loads with no cookies and no Referer; a
//      size suffix chooses the picture: "=w480-h480-c" for a grid thumbnail, "=w1600" for a full view.
//      It does not expire. Only the base URL is kept (the app adds the suffix it needs).
//
// This is unofficial: Google can change the page at any time. Everything here is defensive (any shape
// that is not recognised is skipped, never guessed) and failures are plain-English messages.
//
// Politeness and safety: an honest user agent, one album at a time, a pause between page requests, the
// site's robots.txt is honoured, only photos.app.goo.gl and photos.google.com are ever contacted (every
// redirect hop is checked against that list and against the public-address rule the other web importers
// use), pages over 4 MB are refused, and at most 15 pages / 4,000 photos are read per run.

import { PermanentError } from "../errors";
import type { Http } from "../http";
import { assertPublicPage, type FetchOpts } from "./fetch_page";
import { parseRobots, robotsAllows } from "./robots";

export const PHOTO_IMPORT_AGENT = "CommunityConnect-PhotoImport/1.0";
export const MAX_ALBUM_PAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PAGES = 15;
export const MAX_PHOTOS_READ = 4000;
export const DEFAULT_PAGE_DELAY_MS = 1500;

const MAX_REDIRECTS = 5;
const ALBUM_HOSTS = new Set(["photos.app.goo.gl", "photos.google.com"]);
const RPC_PATH = "/_/PhotosUi/data/batchexecute";
const VIDEO_KEY = "76647426";

export const MSG_NOT_AN_ALBUM = "That link is not a shared Google Photos album.";
export const MSG_NO_PAGE = "Google did not return the album page; try again later.";
export const MSG_NO_PHOTOS = "No photos were found — the album may be private, empty, or Google changed its page.";

/** A base image address: no size suffix. The database accepts the same shape and nothing else. */
const IMAGE_BASE = /^https:\/\/lh[3-6]\.googleusercontent\.com\/[A-Za-z0-9_/-]{40,255}$/;
const SHORT_LINK = /^https?:\/\/photos\.app\.goo\.gl\/[A-Za-z0-9_-]{8,64}\/?(?:[?#]\S*)?$/i;
const LONG_LINK = /^https?:\/\/photos\.google\.com\/(?:u\/\d{1,2}\/)?share\/[A-Za-z0-9_-]{20,200}\/?(?:[?#]\S*)?$/i;

/** Whether this looks like a Google Photos shared-album link (the same rule app.import_external_album applies). */
export function isGooglePhotosAlbumUrl(raw: string): boolean {
  const s = raw.trim();
  return s.length > 0 && s.length <= 2000 && (SHORT_LINK.test(s) || LONG_LINK.test(s));
}

export type AlbumPhoto = { base: string; width: number | null; height: number | null };

export type AlbumPage = {
  albumKey: string;
  title: string;
  /** The raw item list of this page (see readItems). */
  items: unknown;
  /** The continuation token for the next page; null on the last page. */
  next: string | null;
};

// ── Parsing ────────────────────────────────────────────────────────────────────

/** The JSON array that starts at `from` (after whitespace), found by matching brackets outside strings. */
function readArray(src: string, from: number): string | null {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (src[i] !== "[") return null;
  const start = i;
  let depth = 0;
  let inString = false;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

/** Every `AF_initDataCallback({key: 'ds:N', ..., data: [...]})` payload on the page that is a JSON array. */
export function parseDataBlocks(html: string): unknown[][] {
  const blocks: unknown[][] = [];
  let pos = 0;
  for (;;) {
    const at = html.indexOf("AF_initDataCallback(", pos);
    if (at < 0) break;
    pos = at + "AF_initDataCallback(".length;
    const dataAt = html.indexOf("data:", pos);
    if (dataAt < 0) break;
    if (dataAt - pos > 160) continue; // not the callback shape this reader knows
    const raw = readArray(html, dataAt + "data:".length);
    if (!raw) continue;
    try {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) blocks.push(v);
    } catch {
      // not JSON: skip it
    }
    pos = dataAt + 5;
  }
  return blocks;
}

function nextToken(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The first page of a share page: the album, its first items and the continuation token. Null when it is not an album page. */
export function parseAlbumPage(html: string): AlbumPage | null {
  for (const b of parseDataBlocks(html)) {
    const meta = b[3];
    if (!Array.isArray(meta) || typeof meta[0] !== "string" || !meta[0].startsWith("AF1Q")) continue;
    return { albumKey: meta[0], title: typeof meta[1] === "string" ? meta[1] : "", items: b[1], next: nextToken(b[2]) };
  }
  return null;
}

/** One answer of the paging call (a `)]}'` prefix, then length-prefixed JSON lines). Null when it carries no page. */
export function parsePageResponse(text: string): { items: unknown; next: string | null } | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith("[")) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!Array.isArray(row) || row[0] !== "wrb.fr" || row[1] !== "snAcKc" || typeof row[2] !== "string") continue;
      try {
        const inner: unknown = JSON.parse(row[2]);
        if (Array.isArray(inner)) return { items: inner[1], next: nextToken(inner[2]) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isVideoMeta(x: unknown): boolean {
  return typeof x === "object" && x !== null && !Array.isArray(x) && VIDEO_KEY in x;
}

/** Photos (one base address each), plus how many items were videos and how many were not understood. */
export function readItems(items: unknown): { photos: AlbumPhoto[]; videos: number; skipped: number } {
  const photos: AlbumPhoto[] = [];
  let videos = 0;
  let skipped = 0;
  if (!Array.isArray(items)) return { photos, videos, skipped };
  for (const it of items) {
    const media = Array.isArray(it) ? it[1] : null;
    if (!Array.isArray(it) || !Array.isArray(media) || typeof media[0] !== "string") {
      skipped++;
      continue;
    }
    if (it.some(isVideoMeta)) {
      videos++;
      continue;
    }
    const base = media[0].split("=")[0]!;
    if (!IMAGE_BASE.test(base)) {
      skipped++;
      continue;
    }
    photos.push({ base, width: typeof media[1] === "number" ? media[1] : null, height: typeof media[2] === "number" ? media[2] : null });
  }
  return { photos, videos, skipped };
}

// ── Fetching ───────────────────────────────────────────────────────────────────

/** The album link as an https address, or null when it is not a Google Photos shared-album link. */
export function normaliseAlbumUrl(raw: string): URL | null {
  if (!isGooglePhotosAlbumUrl(raw)) return null;
  try {
    const url = new URL(raw.trim().replace(/^http:/i, "https:"));
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export type ReadOpts = FetchOpts & {
  /** Pause between page requests (default 1500 ms). */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxPages?: number;
  maxPhotos?: number;
};

type Got = { status: number; text: string; url: URL; bytes: number };

async function checkHop(raw: string, opts: FetchOpts): Promise<URL> {
  const url = await assertPublicPage(raw, opts);
  if (url.protocol !== "https:" || !ALBUM_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(MSG_NO_PAGE);
  }
  return url;
}

async function getPage(http: Http, first: URL, accept: string, opts: FetchOpts): Promise<Got> {
  let url = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await http.request(url.toString(), { headers: { accept, "user-agent": PHOTO_IMPORT_AGENT }, timeoutMs: 30000, retries: 1, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get("location");
      if (!to) throw new Error(MSG_NO_PAGE);
      url = await checkHop(new URL(to, url).toString(), opts);
      continue;
    }
    return { status: res.status, text: res.text, url, bytes: Buffer.byteLength(res.text, "utf8") };
  }
  throw new Error(MSG_NO_PAGE);
}

/** Google's robots.txt must allow reading a share page and the paging call. A missing file allows both. */
async function assertRobotsAllow(http: Http, opts: FetchOpts): Promise<void> {
  const origin = await checkHop("https://photos.google.com/robots.txt", opts);
  let res: Got;
  try {
    res = await getPage(http, origin, "text/plain, */*;q=0.1", opts);
  } catch (err) {
    if (err instanceof PermanentError) throw err;
    throw new Error(MSG_NO_PAGE);
  }
  if (res.status >= 500 || res.status === 429) throw new Error(MSG_NO_PAGE);
  if (res.status !== 200) return;
  const rules = parseRobots(res.text, PHOTO_IMPORT_AGENT);
  if (!robotsAllows(rules, "/share/x") || !robotsAllows(rules, RPC_PATH)) {
    throw new PermanentError("Google asks automated readers not to read shared albums (its robots.txt), so the photos were not imported.");
  }
}

export type AlbumResult = {
  title: string;
  photos: AlbumPhoto[];
  videos: number;
  skipped: number;
  pages: number;
  /** A caution to show beside the result (a partial read), or null. */
  note: string | null;
};

/** Reads a shared album: every photo's base address, in the album's order, one polite request at a time. */
export async function readAlbum(http: Http, rawUrl: string, opts: ReadOpts): Promise<AlbumResult> {
  const start = normaliseAlbumUrl(rawUrl);
  if (!start) throw new PermanentError(MSG_NOT_AN_ALBUM);
  const delayMs = opts.delayMs ?? DEFAULT_PAGE_DELAY_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const maxPhotos = opts.maxPhotos ?? MAX_PHOTOS_READ;

  await checkHop(start.toString(), opts);
  await assertRobotsAllow(http, opts);

  const res = await getPage(http, start, "text/html, application/xhtml+xml;q=0.9, */*;q=0.1", opts);
  if (res.status === 404 || res.status === 410 || res.status === 400) {
    throw new PermanentError("Google says that album link does not exist. It may have been deleted or its sharing turned off; check the link in Google Photos.");
  }
  if (res.status !== 200 || res.url.hostname.toLowerCase() !== "photos.google.com" || !res.url.pathname.includes("/share/")) throw new Error(MSG_NO_PAGE);
  if (res.bytes > MAX_ALBUM_PAGE_BYTES) throw new PermanentError("Google's album page is larger than the importer reads (4 MB).");
  const first = parseAlbumPage(res.text);
  if (!first) throw new PermanentError(MSG_NO_PHOTOS);

  const sid = /"FdrFJe":"(-?\d+)"/.exec(res.text)?.[1] ?? null;
  const bl = /"cfb2h":"([^"]+)"/.exec(res.text)?.[1] ?? null;
  const authKey = res.url.searchParams.get("key");

  const photos: AlbumPhoto[] = [];
  const seen = new Set<string>();
  let videos = 0;
  let skipped = 0;
  const take = (items: unknown) => {
    const r = readItems(items);
    videos += r.videos;
    skipped += r.skipped;
    for (const p of r.photos) {
      if (seen.has(p.base)) continue;
      seen.add(p.base);
      photos.push(p);
    }
  };

  take(first.items);
  let pages = 1;
  let token = first.next;
  let note: string | null = null;

  while (token) {
    if (photos.length >= maxPhotos || pages >= maxPages) {
      note = `The album is bigger than one run reads (${photos.length.toLocaleString("en-US")} photos were read). Run the import again after approving these to bring in more.`;
      break;
    }
    if (!sid || !bl || !authKey) {
      note = `Only the first ${photos.length.toLocaleString("en-US")} photos could be read: Google's page no longer shows how to load the rest.`;
      break;
    }
    if (delayMs > 0) await sleep(delayMs);
    let more: { items: unknown; next: string | null } | null = null;
    try {
      const url =
        `https://photos.google.com${RPC_PATH}?rpcids=snAcKc&source-path=${encodeURIComponent(`/share/${first.albumKey}`)}` +
        `&f.sid=${sid}&bl=${encodeURIComponent(bl)}&hl=en&soc-app=165&soc-platform=1&soc-device=1&_reqid=${100000 + pages * 100000}&rt=c`;
      await checkHop(url, opts);
      const body = "f.req=" + encodeURIComponent(JSON.stringify([[["snAcKc", JSON.stringify([first.albumKey, token, null, authKey]), null, "generic"]]])) + "&";
      const r = await http.request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": PHOTO_IMPORT_AGENT },
        body,
        timeoutMs: 30000,
        retries: 1,
      });
      if (r.status === 200 && Buffer.byteLength(r.text, "utf8") <= MAX_ALBUM_PAGE_BYTES) more = parsePageResponse(r.text);
    } catch (err) {
      if (err instanceof PermanentError) throw err;
    }
    if (!more) {
      note = `Google stopped answering after ${photos.length.toLocaleString("en-US")} photos. Run the import again to bring in the rest.`;
      break;
    }
    pages++;
    take(more.items);
    token = more.next;
  }

  if (photos.length === 0) throw new PermanentError(MSG_NO_PHOTOS);
  return { title: first.title, photos, videos, skipped, pages, note };
}
