import { describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import type { Http, HttpResponse } from "../src/http";
import { run } from "../src/handlers/photos.import_album";
import {
  isGooglePhotosAlbumUrl,
  MAX_ALBUM_PAGE_BYTES,
  MSG_NO_PAGE,
  MSG_NO_PHOTOS,
  MSG_NOT_AN_ALBUM,
  normaliseAlbumUrl,
  parseAlbumPage,
  parseDataBlocks,
  parsePageResponse,
  PHOTO_IMPORT_AGENT,
  readAlbum,
  readItems,
} from "../src/web/google_photos";
import { captureLog, fakeDb, job } from "./helpers";

// ── A SYNTHETIC share page: the same structure Google serves, with made-up ids ──────────────────
// Nothing here is a real album, photo or person: every id and address is invented.
const ALBUM_KEY = "AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKEALBUMKEY00";
const SHARE_KEY = "FAKESHAREKEYFAKESHAREKEY00";
const SHORT = "https://photos.app.goo.gl/FakeShortId12345";
const LONG = `https://photos.google.com/share/${ALBUM_KEY}?key=${SHARE_KEY}`;

const base = (n: number) => `https://lh3.googleusercontent.com/pw/FAKEPHOTO${String(n).padStart(4, "0")}${"x".repeat(60)}`;
const photoItem = (n: number, suffix = "") => [`AF1QipPHOTO${n}`, [base(n) + suffix, 4032, 3024, null, null, null, null, null, [null, null, 1], [123456]], 1560991131000 + n, `hash${n}`, -18000000, 1562530338513, ["AF1QipOWNER"], [[2]], 2, { "15": 100, "101428965": [0, "vde"], "525000002": [[ALBUM_KEY]] }];
const videoItem = (n: number) => [`AF1QipVIDEO${n}`, [base(n), 1920, 1080, null, null, null, null, null, [null, null, 1]], 1560991131000 + n, `vhash${n}`, -18000000, 1562530338513, ["AF1QipOWNER"], [[2]], 2, { "15": 100, "76647426": [4064, null, 1920, 1080, null, 4, 134], "525000002": [[ALBUM_KEY]] }];

function sharePage(opts: { title?: string; items: unknown[]; next?: string | null; sid?: string | null; bl?: string | null; withAlbum?: boolean }): string {
  const meta = [ALBUM_KEY, opts.title ?? "Fake Album", [1549736714000, 1756817489000], null, [base(0), 100, 100], [], [], ALBUM_KEY, 1];
  const ds1 = opts.withAlbum === false ? [null, opts.items, opts.next ?? null, null, null, 0] : [null, opts.items, opts.next ?? null, meta, null, 0];
  const wiz = `{"AfY8Hf":true,"FdrFJe":${opts.sid === null ? "null" : `"${opts.sid ?? "2162685716719833104"}"`},"cfb2h":${opts.bl === null ? "null" : `"${opts.bl ?? "boq_photosuiserver_20260929.05_p0"}"`},"note":"a ] bracket and a \\" quote"}`;
  return (
    `<!doctype html><html><head><title>${opts.title ?? "Fake Album"} - Google Photos</title></head><body>` +
    `<script nonce="abc">window.WIZ_global_data = ${wiz};</script>` +
    `<script nonce="abc">AF_initDataCallback({key: 'ds:0', hash: '1', data:[[["x]"],"y\\"]"]], sideChannel: {}});</script>` +
    `<script nonce="abc">AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify(ds1)}, sideChannel: {}});</script>` +
    `</body></html>`
  );
}

function pageResponse(items: unknown[], next: string): string {
  const inner = JSON.stringify([null, items, next, [ALBUM_KEY, "Fake Album"], null, 0]);
  const payload = JSON.stringify([["wrb.fr", "snAcKc", inner, null, null, null, "generic"], ["di", 55], ["af.httprm", 55, "-123", 7]]);
  return `)]}'\n\n${payload.length}\n${payload}\n25\n[["e",4,null,null,300]]`;
}

// ── A fake network ──────────────────────────────────────────────────────────────────────────────
type Reply = { status?: number; type?: string; body?: string; location?: string };
type Seen = { method: string; url: string; body: unknown; agent: string | undefined };
function reply(status: number, type: string, text: string, headers: Record<string, string> = {}): HttpResponse {
  return { status, ok: status < 400, headers: new Headers({ "content-type": type, ...headers }), text, json: () => JSON.parse(text), bytes: () => new TextEncoder().encode(text) };
}
function fakeHttp(routes: Record<string, Reply | ((s: Seen) => Reply)>): Http & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    async request(url, opts) {
      const s: Seen = { method: opts?.method ?? "GET", url, body: opts?.body, agent: opts?.headers?.["user-agent"] };
      seen.push(s);
      const key = `${s.method} ${url.split("?")[0]}`;
      const r0 = routes[key];
      if (!r0) return reply(404, "text/plain", "");
      const r = typeof r0 === "function" ? r0(s) : r0;
      return reply(r.status ?? 200, r.type ?? "text/html", r.body ?? "", r.location ? { location: r.location } : {});
    },
  };
}
const PUBLIC = async () => ["142.250.80.46"];
const ok = { allowPrivate: false, resolve: PUBLIC };
const ROBOTS = "GET https://photos.google.com/robots.txt";
const robotsOk: Reply = { type: "text/plain", body: "User-agent: *\nDisallow: /albums\nDisallow: /shared\nDisallow: /sharing\n" };
const SHARE_ROUTE = `GET https://photos.google.com/share/${ALBUM_KEY}`;
const RPC = "POST https://photos.google.com/_/PhotosUi/data/batchexecute";
const shortRoute: Reply = { status: 302, location: LONG };

// ── Links ───────────────────────────────────────────────────────────────────────────────────────
describe("isGooglePhotosAlbumUrl / normaliseAlbumUrl", () => {
  it("accepts shared-album links, short and long", () => {
    expect(isGooglePhotosAlbumUrl(SHORT)).toBe(true);
    expect(isGooglePhotosAlbumUrl(`  ${LONG}  `)).toBe(true);
    expect(isGooglePhotosAlbumUrl(`https://photos.google.com/u/2/share/${ALBUM_KEY}?key=${SHARE_KEY}&pli=1`)).toBe(true);
    expect(isGooglePhotosAlbumUrl("http://photos.app.goo.gl/FakeShortId12345")).toBe(true);
    expect(normaliseAlbumUrl("http://photos.app.goo.gl/FakeShortId12345#top")!.toString()).toBe("https://photos.app.goo.gl/FakeShortId12345");
  });
  it("refuses everything else", () => {
    for (const bad of [
      "",
      "not a link",
      "https://example.com/FakeShortId12345",
      "https://photos.app.goo.gl.evil.example/FakeShortId12345",
      "https://evilphotos.google.com/share/" + ALBUM_KEY,
      "https://photos.google.com/photo/AF1QipFAKEFAKEFAKEFAKEFAKEFAKE",
      "https://photos.google.com/albums/AF1QipFAKEFAKEFAKEFAKEFAKEFAKE",
      "https://photos.app.goo.gl/",
      "https://photos.app.goo.gl/short",
      "ftp://photos.app.goo.gl/FakeShortId12345",
      "https://user@photos.app.goo.gl/FakeShortId12345",
      "javascript:alert(1)//photos.app.goo.gl/FakeShortId12345",
    ]) {
      expect(isGooglePhotosAlbumUrl(bad), bad).toBe(false);
      expect(normaliseAlbumUrl(bad), bad).toBeNull();
    }
  });
});

// ── Parsing ─────────────────────────────────────────────────────────────────────────────────────
describe("parsing the share page", () => {
  it("finds every data block, including strings that hold brackets and quotes, and skips junk", () => {
    const html = sharePage({ items: [photoItem(1)] }) + `<script>AF_initDataCallback({key: 'ds:9', data:[[1,2}, sideChannel: {}});</script><script>AF_initDataCallback({key:'ds:8', data:"nope"});</script>`;
    const blocks = parseDataBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual([[["x]"], 'y"]']]);
  });
  it("reads the album, its first items and the continuation token", () => {
    const page = parseAlbumPage(sharePage({ title: "Fake Album", items: [photoItem(1), photoItem(2)], next: "AH_FAKETOKEN" }))!;
    expect(page).toMatchObject({ albumKey: ALBUM_KEY, title: "Fake Album", next: "AH_FAKETOKEN" });
    expect(readItems(page.items).photos.map((p) => p.base)).toEqual([base(1), base(2)]);
    expect(parseAlbumPage(sharePage({ items: [], next: "" }))!.next).toBeNull();
  });
  it("is not fooled by a page that is not an album", () => {
    expect(parseAlbumPage("<html><body>Sign in to continue</body></html>")).toBeNull();
    expect(parseAlbumPage(sharePage({ items: [photoItem(1)], withAlbum: false }))).toBeNull();
  });
  it("keeps photos (width, height, base address without a size suffix) and counts videos and unreadable items apart", () => {
    const r = readItems([
      photoItem(1, "=w600-h400"),
      videoItem(2),
      ["AF1QipBAD", ["https://evil.example/pw/" + "a".repeat(80), 1, 1]],
      ["AF1QipBAD2", ["https://lh3.googleusercontent.com/pw/short", 1, 1]],
      ["AF1QipBAD3", []],
      "garbage",
      null,
      photoItem(3),
    ]);
    expect(r.photos).toEqual([
      { base: base(1), width: 4032, height: 3024 },
      { base: base(3), width: 4032, height: 3024 },
    ]);
    expect(r.videos).toBe(1);
    expect(r.skipped).toBe(5);
    expect(readItems(null)).toEqual({ photos: [], videos: 0, skipped: 0 });
  });
  it("reads the paging call's answer and returns null for anything that is not one", () => {
    expect(parsePageResponse(pageResponse([photoItem(4)], "AH_NEXT"))).toMatchObject({ next: "AH_NEXT" });
    expect(parsePageResponse(pageResponse([photoItem(4)], ""))!.next).toBeNull();
    expect(parsePageResponse("<html>error</html>")).toBeNull();
    expect(parsePageResponse(`)]}'\n\n9\n[["wrb.fr","snAcKc",null,null,null,[3]]]`)).toBeNull();
    expect(parsePageResponse(`)]}'\n\n9\n[["wrb.fr","snAcKc","not json"]]`)).toBeNull();
  });
});

// ── Reading a whole album ───────────────────────────────────────────────────────────────────────
describe("readAlbum", () => {
  const twoPages = () =>
    fakeHttp({
      [ROBOTS]: robotsOk,
      "GET https://photos.app.goo.gl/FakeShortId12345": shortRoute,
      [SHARE_ROUTE]: { body: sharePage({ items: [photoItem(1), videoItem(2), photoItem(3)], next: "AH_TOKEN_ONE" }) },
      [RPC]: (s) => ({ type: "application/json", body: String(s.body).includes(encodeURIComponent("AH_TOKEN_ONE")) ? pageResponse([photoItem(3), photoItem(4), photoItem(5)], "") : pageResponse([], "") }),
    });

  it("follows the short link, pages through the album politely and returns photos in album order", async () => {
    const http = twoPages();
    const sleeps: number[] = [];
    const out = await readAlbum(http, SHORT, { ...ok, sleep: async (ms) => void sleeps.push(ms) });
    expect(out.title).toBe("Fake Album");
    expect(out.photos.map((p) => p.base)).toEqual([base(1), base(3), base(4), base(5)]); // photo 3 appears on both pages once
    expect(out.videos).toBe(1);
    expect(out.pages).toBe(2);
    expect(out.note).toBeNull();
    expect(http.seen.map((s) => `${s.method} ${s.url.split("?")[0]}`)).toEqual([
      ROBOTS,
      "GET https://photos.app.goo.gl/FakeShortId12345",
      `GET https://photos.google.com/share/${ALBUM_KEY}`,
      RPC,
    ]);
    expect(sleeps).toEqual([1500]); // one pause, before the second page
    expect(new Set(http.seen.map((s) => s.agent))).toEqual(new Set([PHOTO_IMPORT_AGENT]));
  });
  it("sends the paging call the album, the token and the share key, as Google's own page does", async () => {
    const http = twoPages();
    await readAlbum(http, SHORT, { ...ok, delayMs: 0 });
    const rpc = http.seen.find((s) => s.method === "POST")!;
    expect(rpc.url).toContain("rpcids=snAcKc");
    expect(rpc.url).toContain("f.sid=2162685716719833104");
    expect(rpc.url).toContain("bl=boq_photosuiserver_20260929.05_p0");
    const form = new URLSearchParams(String(rpc.body));
    const call = JSON.parse(form.get("f.req")!) as [[[string, string, null, string]]];
    expect(call[0][0][0]).toBe("snAcKc");
    expect(JSON.parse(call[0][0][1])).toEqual([ALBUM_KEY, "AH_TOKEN_ONE", null, SHARE_KEY]);
  });
  it("reads a long link without the redirect", async () => {
    const http = fakeHttp({ [ROBOTS]: robotsOk, [SHARE_ROUTE]: { body: sharePage({ items: [photoItem(1), photoItem(2)] }) } });
    const out = await readAlbum(http, LONG, { ...ok, delayMs: 0 });
    expect(out.photos).toHaveLength(2);
    expect(http.seen.filter((s) => s.method === "POST")).toHaveLength(0);
  });
  it("stops at its page and photo limits and says so", async () => {
    const forever = (s: Seen) => ({ type: "application/json", body: pageResponse([photoItem(100 + String(s.url).length), photoItem(500 + Math.floor(Math.random() * 1e6))], "AH_MORE") });
    const http = fakeHttp({
      [ROBOTS]: robotsOk,
      [SHARE_ROUTE]: { body: sharePage({ items: [photoItem(1)], next: "AH_MORE" }) },
      [RPC]: forever,
    });
    const out = await readAlbum(http, LONG, { ...ok, delayMs: 0, maxPages: 3 });
    expect(out.pages).toBe(3);
    expect(out.note).toMatch(/bigger than one run reads/);
    const capped = await readAlbum(http, LONG, { ...ok, delayMs: 0, maxPhotos: 2 });
    expect(capped.note).toMatch(/bigger than one run reads/);
  });
  it("keeps what it read and says so when Google stops answering partway", async () => {
    const http = fakeHttp({
      [ROBOTS]: robotsOk,
      [SHARE_ROUTE]: { body: sharePage({ items: [photoItem(1), photoItem(2)], next: "AH_TOKEN_ONE" }) },
      [RPC]: { status: 429, type: "text/plain", body: "slow down" },
    });
    const out = await readAlbum(http, LONG, { ...ok, delayMs: 0 });
    expect(out.photos).toHaveLength(2);
    expect(out.note).toMatch(/Google stopped answering after 2 photos.*Run the import again/);
  });
  it("keeps the first page and says so when the page no longer shows how to load more", async () => {
    const http = fakeHttp({ [ROBOTS]: robotsOk, [SHARE_ROUTE]: { body: sharePage({ items: [photoItem(1)], next: "AH_TOKEN_ONE", sid: null }) } });
    const out = await readAlbum(http, LONG, { ...ok, delayMs: 0 });
    expect(out.photos).toHaveLength(1);
    expect(out.note).toMatch(/Only the first 1 photos could be read/);
  });

  it("refuses a link that is not a Google Photos album, before any request", async () => {
    const http = fakeHttp({});
    const err = await readAlbum(http, "https://example.com/album", ok).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toBe(MSG_NOT_AN_ALBUM);
    expect(http.seen).toHaveLength(0);
  });
  it("says plainly when the link does not exist", async () => {
    const http = fakeHttp({ [ROBOTS]: robotsOk, "GET https://photos.app.goo.gl/FakeShortId12345": { status: 404, body: "Dynamic Link Not Found" } });
    const err = await readAlbum(http, SHORT, ok).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/album link does not exist.*sharing turned off/);
  });
  it("treats a Google outage as try-again, never as permanent", async () => {
    const down = fakeHttp({ [ROBOTS]: robotsOk, "GET https://photos.app.goo.gl/FakeShortId12345": { status: 503 } });
    const e1 = await readAlbum(down, SHORT, ok).catch((e: unknown) => e);
    expect(e1).not.toBeInstanceOf(PermanentError);
    expect((e1 as Error).message).toBe(MSG_NO_PAGE);
    const robotsDown = fakeHttp({ [ROBOTS]: { status: 503 } });
    const e2 = await readAlbum(robotsDown, SHORT, ok).catch((e: unknown) => e);
    expect(e2).not.toBeInstanceOf(PermanentError);
    expect((e2 as Error).message).toBe(MSG_NO_PAGE);
  });
  it("never follows a redirect off Google's two album hosts (a consent page, a private address)", async () => {
    for (const to of ["https://consent.google.com/ml?continue=x", "http://169.254.169.254/latest", "https://evil.example.org/x"]) {
      const http = fakeHttp({ [ROBOTS]: robotsOk, "GET https://photos.app.goo.gl/FakeShortId12345": { status: 302, location: to } });
      const err = await readAlbum(http, SHORT, ok).catch((e: unknown) => e);
      expect((err as Error).message, to).toMatch(/Google did not return the album page|private network/);
      expect(http.seen.map((s) => s.url), to).not.toContain(to);
    }
  });
  it("refuses a page that resolves to a private address", async () => {
    const http = fakeHttp({});
    await expect(readAlbum(http, SHORT, { allowPrivate: false, resolve: async () => ["10.0.0.5"] })).rejects.toThrow(/private network/);
    expect(http.seen).toHaveLength(0);
  });
  it("does not read when Google's robots.txt asks automated readers not to", async () => {
    const http = fakeHttp({ [ROBOTS]: { type: "text/plain", body: "User-agent: *\nDisallow: /share" }, "GET https://photos.app.goo.gl/FakeShortId12345": shortRoute });
    const err = await readAlbum(http, SHORT, ok).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/robots\.txt/);
    expect(http.seen.map((s) => s.url)).toEqual(["https://photos.google.com/robots.txt"]);
  });
  it("says there were no photos when the page is not an album, the album is empty, or it holds only videos", async () => {
    for (const body of ["<html>Sign in to Google</html>", sharePage({ items: [] }), sharePage({ items: [videoItem(1), videoItem(2)] })]) {
      const http = fakeHttp({ [ROBOTS]: robotsOk, [SHARE_ROUTE]: { body } });
      const err = await readAlbum(http, LONG, { ...ok, delayMs: 0 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PermanentError);
      expect((err as Error).message).toBe(MSG_NO_PHOTOS);
    }
  });
  it("refuses a page larger than the importer reads", async () => {
    const http = fakeHttp({ [ROBOTS]: robotsOk, [SHARE_ROUTE]: { body: "x".repeat(MAX_ALBUM_PAGE_BYTES + 1) } });
    await expect(readAlbum(http, LONG, ok)).rejects.toBeInstanceOf(PermanentError);
  });
});

// ── The job ─────────────────────────────────────────────────────────────────────────────────────
function ctxWith(http: Http, db = fakeDb().db) {
  const { log } = captureLog();
  return { db, http, log, env: { NIVA_IMPORT_ALLOW_PRIVATE: "1", PHOTO_IMPORT_DELAY_MS: "0" }, workerId: "w", secret: async () => null, storeSecret: async () => ({ fingerprint: "" }), removeOauthCode: async () => false } as never;
}
const ALBUM_ID = "11111111-2222-4333-8444-555555555555";
const albumJob = (over: Record<string, unknown> = {}) => job({ kind: "photos.import_album", payload: { album_id: ALBUM_ID, url: SHORT, ...over }, created_by: "u-1" });

describe("photos.import_album", () => {
  const good = () =>
    fakeHttp({
      [ROBOTS]: robotsOk,
      "GET https://photos.app.goo.gl/FakeShortId12345": shortRoute,
      [SHARE_ROUTE]: { body: sharePage({ items: [photoItem(1), photoItem(2), videoItem(3)], next: "AH_TOKEN_ONE" }) },
      [RPC]: { type: "application/json", body: pageResponse([photoItem(4)], "") },
    });

  it("reads the album and saves the photos' base addresses through the worker function", async () => {
    const f = fakeDb({ query: () => [{ r: { added: 4, already_there: 0, over_cap: 0 } }] });
    const j = albumJob();
    const out = (await run(j, ctxWith(good(), f.db))) as Record<string, unknown>;
    expect(out).toMatchObject({ album_id: ALBUM_ID, found: 3, videos_skipped: 1, pages: 2, added: 4 });
    const call = f.calls.find((c) => c.fn === "query")!;
    expect(String(call.args[0])).toContain("app.photos_worker_save_import");
    const p = call.args[1] as unknown[];
    expect(p[0]).toBe(j.center_id);
    expect(p[1]).toBe(ALBUM_ID);
    expect(JSON.parse(p[2] as string)).toEqual([base(1), base(2), base(4)]);
    expect(p[3]).toBe(3);
    expect(p[4]).toBe(1);
    expect(p[5]).toBeNull();
  });
  it("passes the partial-read note along so the album shows it", async () => {
    const http = fakeHttp({ [ROBOTS]: robotsOk, "GET https://photos.app.goo.gl/FakeShortId12345": shortRoute, [SHARE_ROUTE]: { body: sharePage({ items: [photoItem(1)], next: "AH" }) }, [RPC]: { status: 500 } });
    const f = fakeDb({ query: () => [{ r: { added: 1 } }] });
    await run(albumJob(), ctxWith(http, f.db));
    const p = f.calls.find((c) => c.fn === "query")!.args[1] as unknown[];
    expect(String(p[5])).toMatch(/Google stopped answering after 1 photos/);
  });
  it("fails permanently, in plain English, without an album, a community, or a Google Photos link", async () => {
    await expect(run(job({ payload: {} }), ctxWith(fakeHttp({})))).rejects.toThrow(/does not say which album/);
    await expect(run(albumJob({ album_id: "nope" }), ctxWith(fakeHttp({})))).rejects.toThrow(/does not say which album/);
    await expect(run(job({ center_id: null, payload: { album_id: ALBUM_ID, url: SHORT } }), ctxWith(fakeHttp({})))).rejects.toThrow(/which community/);
    const f = fakeDb();
    const err = await run(albumJob({ url: "https://example.com/x" }), ctxWith(fakeHttp({}), f.db)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toBe(MSG_NOT_AN_ALBUM);
  });
  it("records the failure on the album (in plain English) and still fails the job", async () => {
    const f = fakeDb();
    const http = fakeHttp({ [ROBOTS]: robotsOk, "GET https://photos.app.goo.gl/FakeShortId12345": shortRoute, [SHARE_ROUTE]: { body: "<html>Sign in</html>" } });
    const err = await run(albumJob(), ctxWith(http, f.db)).catch((e: unknown) => e);
    expect((err as Error).message).toBe(MSG_NO_PHOTOS);
    const q = f.calls.filter((c) => c.fn === "query");
    expect(q).toHaveLength(1);
    expect(String(q[0]!.args[0])).toContain("app.photos_worker_record_failure");
    expect(q[0]!.args[1]).toEqual([albumJob().center_id, ALBUM_ID, MSG_NO_PHOTOS]);
  });
  it("saves nothing when the database refuses, and the failure is not lost", async () => {
    const f = fakeDb({
      query: (text) => {
        if (text.includes("photos_worker_save_import")) throw new Error("That album no longer exists.");
        return [];
      },
    });
    await expect(run(albumJob(), ctxWith(good(), f.db))).rejects.toThrow(/no longer exists/);
    expect(f.calls.some((c) => String(c.args[0]).includes("photos_worker_record_failure"))).toBe(true);
  });
});
