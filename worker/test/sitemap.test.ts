import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import { run } from "../src/handlers/niva.discover_site";
import type { Http, HttpResponse } from "../src/http";
import { parseSitemaps } from "../src/web/robots";
import {
  discoverPages,
  isFileAddress,
  MAX_CHILD_SITEMAPS,
  MAX_DISCOVERED_PAGES,
  MAX_SITEMAP_BYTES,
  pageAddress,
  pageKey,
  parseSitemap,
  siteOf,
} from "../src/web/sitemap";
import { captureLog, fakeDb, job } from "./helpers";

// ── robots.txt Sitemap lines ──────────────────────────────────────────────────
describe("parseSitemaps", () => {
  it("returns every Sitemap: line in file order, each once, whatever group it sits in", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /members-area",
      "Sitemap: https://www.example.org/sitemap.xml",
      "",
      "User-agent: Googlebot",
      "sitemap:https://www.example.org/news-sitemap.xml   # news",
      "SITEMAP : https://www.example.org/sitemap.xml#again",
      "Sitemap: /relative-sitemap.xml",
      "Sitemap: ftp://example.org/sitemap.xml",
      "Sitemap:",
    ].join("\r\n");
    expect(parseSitemaps(robots)).toEqual(["https://www.example.org/sitemap.xml", "https://www.example.org/news-sitemap.xml"]);
  });
  it("finds nothing in a file without Sitemap lines", () => {
    expect(parseSitemaps("User-agent: *\nDisallow:")).toEqual([]);
    expect(parseSitemaps("<html>not a robots file</html>")).toEqual([]);
  });
});

// ── One way to write an address (the same cases as supabase/tests/63) ─────────
describe("pageAddress / pageKey (mirror app.niva_page_address / niva_page_key)", () => {
  it("writes an address one way: lower-case scheme and host, no default port, trailing slash, tracking or #fragment", () => {
    expect(pageAddress("HTTPS://WWW.Example.ORG:443/FAQ/?utm_source=x&id=7&UTM_Medium=y&gclid=1#top")).toBe("https://www.example.org/FAQ?id=7");
    expect(pageAddress("https://example.org/")).toBe("https://example.org");
    expect(pageAddress("http://example.org:80/a//")).toBe("http://example.org/a");
    expect(pageAddress("https://Example.org./x/?fbclid=abc")).toBe("https://example.org/x");
    expect(pageAddress("https://example.org:8443/x")).toBe("https://example.org:8443/x");
    expect(pageAddress("  ")).toBeNull();
    expect(pageAddress("ftp://example.org/x")).toBeNull();
    expect(pageAddress("not an address")).toBeNull();
  });
  it("treats the apex and www forms (and http and https) as one page, and nothing else", () => {
    expect(pageKey("https://www.example.org/faq/")).toBe("example.org/faq");
    expect(pageKey("http://example.org/faq?utm_campaign=z")).toBe("example.org/faq");
    expect(pageKey("https://example.org/FAQ")).not.toBe(pageKey("https://example.org/faq"));
    expect(pageKey("https://news.example.org/faq")).not.toBe(pageKey("https://example.org/faq"));
    expect(pageKey("https://example.org/faq?id=1")).not.toBe(pageKey("https://example.org/faq?id=2"));
    expect(siteOf("https://WWW.example.org/a/b?c=1")).toBe("example.org");
    expect(siteOf("http://localhost:3000/x")).toBe("localhost:3000");
  });
});

// ── Parsing ───────────────────────────────────────────────────────────────────
const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url><image:image><image:loc>https://static.example.org/a.jpg</image:loc></image:image><loc>https://www.example.org</loc><lastmod>2026-09-18</lastmod></url>
<url><loc> https://www.example.org/events?a=1&amp;b=2 </loc><lastmod>2026-09-01T10:00:00+00:00</lastmod></url>
<url><loc><![CDATA[https://www.example.org/relocationfaq]]></loc><lastmod>yesterday</lastmod></url>
<url><lastmod>2026-01-01</lastmod></url>
</urlset>`;

describe("parseSitemap", () => {
  it("reads <loc> and <lastmod> from a urlset (entities, CDATA, image extensions and bad dates handled)", () => {
    expect(parseSitemap(URLSET)).toEqual({
      kind: "urlset",
      entries: [
        { loc: "https://www.example.org", lastmod: "2026-09-18" },
        { loc: "https://www.example.org/events?a=1&b=2", lastmod: "2026-09-01T10:00:00+00:00" },
        { loc: "https://www.example.org/relocationfaq", lastmod: null },
      ],
    });
  });
  it("reads a sitemapindex (Wix's, as jainsocietyhouston.org serves it)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX">
<sitemap>
<loc>https://www.example.org/event-pages-sitemap.xml</loc>
<lastmod>2020-09-28</lastmod>
</sitemap>
<sitemap>
<loc>https://www.example.org/pages-sitemap.xml</loc>
<lastmod>2026-09-18</lastmod>
</sitemap>
</sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({
      kind: "index",
      entries: [
        { loc: "https://www.example.org/event-pages-sitemap.xml", lastmod: "2020-09-28" },
        { loc: "https://www.example.org/pages-sitemap.xml", lastmod: "2026-09-18" },
      ],
    });
  });
  it("reads a prefixed urlset and a plain-text sitemap, and nothing from an HTML page", () => {
    expect(parseSitemap('<sm:urlset xmlns:sm="x"><sm:url><sm:loc>https://e.org/a</sm:loc></sm:url></sm:urlset>').entries).toEqual([{ loc: "https://e.org/a", lastmod: null }]);
    expect(parseSitemap("﻿https://e.org/a\nhttps://e.org/b\n\nnot an address\n")).toEqual({
      kind: "text",
      entries: [
        { loc: "https://e.org/a", lastmod: null },
        { loc: "https://e.org/b", lastmod: null },
      ],
    });
    expect(parseSitemap("<!doctype html><html><body>Page not found</body></html>")).toEqual({ kind: "unknown", entries: [] });
    expect(parseSitemap("")).toEqual({ kind: "unknown", entries: [] });
  });
  it("knows files from web pages", () => {
    for (const f of ["/a.pdf", "/b/c.JPG", "/d.docx", "/e.mp4", "/f.zip", "/g.xml"]) expect(isFileAddress(new URL("https://e.org" + f))).toBe(true);
    for (const p of ["/", "/about-us", "/relocationfaq", "/v1.2/page", "/page.html", "/index.php?x=a.pdf"]) expect(isFileAddress(new URL("https://e.org" + p))).toBe(false);
  });
});

// ── Discovering a site ────────────────────────────────────────────────────────
type Route = { status?: number; type?: string; body?: string; bytes?: Uint8Array; location?: string; length?: number };
function fakeHttp(routes: Record<string, Route>): Http & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async request(url) {
      seen.push(url);
      const r = routes[url];
      if (!r) return response(404, "text/plain", new TextEncoder().encode("Not found"));
      const bytes = r.bytes ?? new TextEncoder().encode(r.body ?? "");
      const res = response(r.status ?? 200, r.type ?? "application/xml", bytes);
      if (r.location) res.headers.set("location", r.location);
      if (r.length !== undefined) res.headers.set("content-length", String(r.length));
      return res;
    },
  };
}
function response(status: number, type: string, bytes: Uint8Array): HttpResponse {
  const text = new TextDecoder().decode(bytes);
  return { status, ok: status < 400, headers: new Headers({ "content-type": type }), text, json: () => JSON.parse(text), bytes: () => bytes };
}
const ok = { allowPrivate: false, resolve: async () => ["93.184.216.34"] };
const urlset = (locs: string[]) => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const index = (locs: string[]) => `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;

describe("discoverPages", () => {
  const W = "https://www.example.org";
  const site = () =>
    fakeHttp({
      "https://example.org/robots.txt": { status: 301, location: `${W}/robots.txt` },
      [`${W}/robots.txt`]: { type: "text/plain", body: `User-agent: *\nDisallow: /members-area\nSitemap: ${W}/sitemap.xml` },
      [`${W}/sitemap.xml`]: { body: index([`${W}/event-pages-sitemap.xml`, `${W}/pages-sitemap.xml`, "https://elsewhere.example.net/sitemap.xml"]) },
      [`${W}/event-pages-sitemap.xml`]: { body: `<urlset><url><loc>${W}/event-details/diwali-2020</loc><lastmod>2020-09-28</lastmod></url></urlset>` },
      [`${W}/pages-sitemap.xml`]: {
        body: `<urlset>
          <url><loc>${W}</loc><lastmod>2026-09-18</lastmod></url>
          <url><loc>https://example.org/relocationfaq/</loc><lastmod>2026-09-01</lastmod></url>
          <url><loc>${W}/relocationfaq?utm_source=sitemap</loc></url>
          <url><loc>${W}/members-area/home</loc></url>
          <url><loc>${W}/files/2018-dues.pdf</loc></url>
          <url><loc>${W}/media/murti.jpg</loc></url>
          <url><loc>https://elsewhere.example.net/page</loc></url>
          <url><loc>${W}/copy-of-about-us</loc></url>
        </urlset>`,
      },
    });

  it("follows robots.txt to the sitemap index and one level down, keeping each page of the site once", async () => {
    const http = site();
    const d = await discoverPages(http, "https://example.org", ok);
    expect(d.root).toBe(W);
    expect(d.site).toBe("example.org");
    expect(d.sitemaps).toEqual([`${W}/sitemap.xml`, `${W}/event-pages-sitemap.xml`, `${W}/pages-sitemap.xml`]);
    expect(d.pages).toEqual([
      { url: `${W}/event-details/diwali-2020`, lastmod: "2020-09-28" },
      { url: W, lastmod: "2026-09-18" },
      { url: "https://example.org/relocationfaq", lastmod: "2026-09-01" },
      { url: `${W}/copy-of-about-us`, lastmod: null },
    ]);
    expect(d.skipped).toEqual({ other_site: 1, files: 2, robots: 1, duplicates: 1 });
    expect(d.truncated).toBe(false);
    // The other site's sitemap is never fetched, nor are the fallbacks once pages were found.
    expect(http.seen).not.toContain("https://elsewhere.example.net/sitemap.xml");
    expect(http.seen).not.toContain(`${W}/sitemap_index.xml`);
  });

  it("falls back to /sitemap.xml, /sitemap_index.xml and /wp-sitemap.xml in turn when robots.txt lists none", async () => {
    const http = fakeHttp({
      [`${W}/robots.txt`]: { type: "text/plain", body: "User-agent: *\nDisallow:" },
      [`${W}/sitemap_index.xml`]: { body: urlset([`${W}/about`]) },
      [`${W}/wp-sitemap.xml`]: { body: urlset([`${W}/never-read`]) },
    });
    const d = await discoverPages(http, W, ok);
    expect(d.pages.map((p) => p.url)).toEqual([`${W}/about`]);
    expect(http.seen).toEqual([`${W}/robots.txt`, `${W}/sitemap.xml`, `${W}/sitemap_index.xml`]);
  });

  it("unpacks a gzipped sitemap", async () => {
    const gz = gzipSync(Buffer.from(urlset([`${W}/a`, `${W}/b`])));
    const http = fakeHttp({
      [`${W}/robots.txt`]: { type: "text/plain", body: `Sitemap: ${W}/sitemap.xml.gz` },
      [`${W}/sitemap.xml.gz`]: { type: "application/x-gzip", bytes: new Uint8Array(gz) },
    });
    const d = await discoverPages(http, W, ok);
    expect(d.pages.map((p) => p.url)).toEqual([`${W}/a`, `${W}/b`]);
  });

  it(`follows at most ${MAX_CHILD_SITEMAPS} sitemaps of an index, and never an index inside an index`, async () => {
    const children = Array.from({ length: 12 }, (_, i) => `${W}/s${i}.xml`);
    const routes: Record<string, Route> = {
      [`${W}/robots.txt`]: { type: "text/plain", body: `Sitemap: ${W}/sitemap.xml` },
      [`${W}/sitemap.xml`]: { body: index(children) },
    };
    children.forEach((c, i) => (routes[c] = { body: i === 0 ? index([`${W}/deeper.xml`]) : urlset([`${W}/page-${i}`]) }));
    routes[`${W}/deeper.xml`] = { body: urlset([`${W}/too-deep`]) };
    const http = fakeHttp(routes);
    const d = await discoverPages(http, W, ok);
    expect(d.pages).toHaveLength(MAX_CHILD_SITEMAPS - 1);
    expect(http.seen).not.toContain(`${W}/s10.xml`);
    expect(http.seen).not.toContain(`${W}/deeper.xml`);
  });

  it(`keeps at most ${MAX_DISCOVERED_PAGES} pages and says the list was cut`, async () => {
    const locs = Array.from({ length: 620 }, (_, i) => `${W}/p${i}`);
    const http = fakeHttp({ [`${W}/robots.txt`]: { type: "text/plain", body: `Sitemap: ${W}/sitemap.xml` }, [`${W}/sitemap.xml`]: { body: urlset(locs) } });
    const d = await discoverPages(http, W, ok);
    expect(d.pages).toHaveLength(MAX_DISCOVERED_PAGES);
    expect(d.truncated).toBe(true);
  });

  it("does not read a sitemap over 5 MB", async () => {
    const http = fakeHttp({
      [`${W}/robots.txt`]: { type: "text/plain", body: `Sitemap: ${W}/big.xml` },
      [`${W}/big.xml`]: { body: urlset([`${W}/a`]), length: MAX_SITEMAP_BYTES + 1 },
    });
    await expect(discoverPages(http, W, ok)).rejects.toThrow(/www\.example\.org's sitemap is larger than 5 MB/);
  });

  it("says plainly when there is no sitemap at all (and does not retry)", async () => {
    const err = await discoverPages(fakeHttp({}), W, ok).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/No sitemap was found on www\.example\.org.*\/sitemap\.xml, \/sitemap_index\.xml, \/wp-sitemap\.xml.*Import from a web page/);
  });

  it("says plainly when the sitemap lists nothing Niva can read", async () => {
    const http = fakeHttp({
      [`${W}/robots.txt`]: { type: "text/plain", body: `Sitemap: ${W}/sitemap.xml` },
      [`${W}/sitemap.xml`]: { body: urlset([`${W}/a.pdf`, "https://other.example.net/x"]) },
    });
    const err = await discoverPages(http, W, ok).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/lists no web pages Niva can read \(it lists 1 on other websites, 1 files such as PDFs or images\)/);
  });

  it("tries again later when the sitemap is unavailable right now", async () => {
    const http = fakeHttp({ [`${W}/robots.txt`]: { type: "text/plain", body: `Sitemap: ${W}/sitemap.xml` }, [`${W}/sitemap.xml`]: { status: 503 } });
    const err = await discoverPages(http, W, ok).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/Could not read www\.example\.org's sitemap right now \(\/sitemap\.xml answered 503\); it will be tried again/);
  });

  it("refuses a private address and a robots.txt outage the same way page imports do", async () => {
    await expect(discoverPages(fakeHttp({}), "http://localhost/", ok)).rejects.toThrow(/private network/);
    const down = fakeHttp({ [`${W}/robots.txt`]: { status: 503 } });
    const err = await discoverPages(down, W, ok).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(PermanentError);
  });
});

// ── The job ───────────────────────────────────────────────────────────────────
function ctxWith(http: Http, db = fakeDb().db) {
  const { log } = captureLog();
  return { db, http, log, env: { NIVA_IMPORT_ALLOW_PRIVATE: "1" }, workerId: "w", secret: async () => null, storeSecret: async () => ({ fingerprint: "" }), removeOauthCode: async () => false } as never;
}

describe("niva.discover_site", () => {
  const W = "https://www.example.org";
  it("saves the list through the worker function and reports what it found", async () => {
    const f = fakeDb({ query: () => [{ r: { site: "example.org", pages: 2, added: 2, kept: 0, removed: 0, other_site: 0 } }] });
    const http = fakeHttp({ [`${W}/robots.txt`]: { type: "text/plain", body: `Sitemap: ${W}/sitemap.xml` }, [`${W}/sitemap.xml`]: { body: urlset([`${W}/a`, `${W}/b/`]) } });
    const out = (await run(job({ kind: "niva.discover_site", payload: { url: W } }), ctxWith(http, f.db))) as Record<string, unknown>;
    const call = f.calls.find((c) => c.fn === "query")!;
    expect(String(call.args[0])).toContain("app.niva_worker_save_discovery($1::uuid, $2, $3::jsonb)");
    const params = call.args[1] as unknown[];
    expect(params[0]).toBe("00000000-0000-4000-8000-000000000001");
    expect(params[1]).toBe(W);
    expect(JSON.parse(params[2] as string)).toEqual([
      { url: `${W}/a`, lastmod: null },
      { url: `${W}/b`, lastmod: null },
    ]);
    expect(out).toMatchObject({ url: W, root: W, found: 2, truncated: false, site: "example.org", added: 2, sitemaps: [`${W}/sitemap.xml`] });
  });
  it("fails permanently, in plain English, without a website or a community, and saves nothing when nothing is found", async () => {
    await expect(run(job({ payload: {} }), ctxWith(fakeHttp({})))).rejects.toThrow(/does not say which website/);
    await expect(run(job({ center_id: null, payload: { url: W } }), ctxWith(fakeHttp({})))).rejects.toThrow(/which community/);
    const f = fakeDb();
    await expect(run(job({ payload: { url: W } }), ctxWith(fakeHttp({}), f.db))).rejects.toBeInstanceOf(PermanentError);
    expect(f.calls.filter((c) => c.fn === "query")).toHaveLength(0);
  });
});
