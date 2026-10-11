import { describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import { run } from "../src/handlers/site.crawl";
import type { Http, HttpResponse } from "../src/http";
import { clampPages, crawlSite, DEFAULT_MAX_PAGES, HARD_MAX_PAGES, type CrawlLimits } from "../src/web/site/crawl";
import { makeDeps } from "../src/web/site/deps";
import { findContentLeaks, type OwnReport, type ReferenceReport } from "../src/web/site/report";
import { captureLog, job } from "./helpers";
import { fixtureHtml, ordinaryPages } from "./site-fixtures";

// ── A pretend internet and a pretend clock ─────────────────────────────────────────────────────────────────────
type Route = { status?: number; type?: string; body?: string; location?: string; length?: number };
type Routes = Record<string, Route>;

function clock(latencyMs = 0) {
  const c = { t: 0, sleeps: [] as number[], latencyMs };
  return c;
}
function fakeHttp(routes: Routes, c = clock()): Http & { seen: string[]; at: number[] } {
  const seen: string[] = [];
  const at: number[] = [];
  return {
    seen,
    at,
    async request(url) {
      seen.push(url);
      at.push(c.t);
      c.t += c.latencyMs;
      const r = routes[url];
      const status = r ? (r.status ?? 200) : 404;
      const bytes = new TextEncoder().encode(r ? (r.body ?? "") : "Not found");
      const headers = new Headers({ "content-type": r?.type ?? (r ? "text/html; charset=utf-8" : "text/plain") });
      if (r?.location) headers.set("location", r.location);
      if (r?.length !== undefined) headers.set("content-length", String(r.length));
      const text = new TextDecoder().decode(bytes);
      return { status, ok: status < 400, headers, text, json: () => JSON.parse(text), bytes: () => bytes } satisfies HttpResponse;
    },
  };
}
const limitsFor = (c: ReturnType<typeof clock>, over: Partial<CrawlLimits> = {}): CrawlLimits => ({
  maxBytes: 30 * 1024 * 1024, deadlineMs: 8 * 60_000, minDelayMs: 0, now: () => c.t, sleep: async (ms) => { c.sleeps.push(ms); c.t += ms; }, ...over,
});
const OK = { allowPrivate: false, resolve: async () => ["93.184.216.34"] };
const W = "https://www.example.org";

/** A name made of letters only for the n-th page: a number in an address is what the calendar-trap rule looks at. */
const word = (n: number) => {
  let s = "";
  for (let x = n; x > 0 || s === ""; x = Math.floor(x / 26)) s = String.fromCharCode(97 + (x % 26)) + s;
  return "pg" + s;
};

const page = (title: string, links: string[] = [], nav: string[] = [], extra = "") =>
  `<!doctype html><html><head><title>${title}</title>${extra}</head><body>${nav.length ? `<header><nav><ul>${nav.map((h) => `<li><a href="${h}">${h.replace(/\W+/g, " ")}</a></li>`).join("")}</ul></nav></header>` : ""}<main><h1>${title}</h1><p>This page tells visitors about ${title} in a few plain sentences so that it has some real text on it.</p>${links.map((h) => `<p><a href="${h}">more</a></p>`).join("")}</main></body></html>`;
const robotsRoute = (extra = "", sitemap = "") => ({ [`${W}/robots.txt`]: { type: "text/plain", body: `User-agent: *\n${extra}\n${sitemap ? `Sitemap: ${sitemap}` : ""}` } });
const urlset = (paths: string[], base = W) => ({ type: "application/xml", body: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${base}${p}</loc></url>`).join("")}</urlset>` });
const pathsSeen = (http: { seen: string[] }) => http.seen.filter((u) => u.startsWith(W) && !/robots\.txt|sitemap|\.css$/.test(u)).map((u) => u.slice(W.length) || "/");

async function crawl(routes: Routes, input: Partial<Parameters<typeof crawlSite>[1]> = {}, over: Partial<CrawlLimits> = {}, c = clock()) {
  const http = fakeHttp(routes, c);
  const out = await crawlSite(makeDeps(http, OK, limitsFor(c, over)), { start_url: `${W}/`, mode: "own", ...input });
  return { ...out, http, c };
}

describe("the order of the pages: the menu, then the sitemap, then the other links", () => {
  const routes: Routes = {
    ...robotsRoute("", `${W}/sitemap.xml`),
    [`${W}/sitemap.xml`]: urlset(["/s1", "/s2", "/about"]),
    [`${W}/`]: { body: page("Home", ["/z-body-link", "/s1"], ["/about", "/events"]) },
    [`${W}/about`]: { body: page("About") }, [`${W}/events`]: { body: page("Events") }, [`${W}/s1`]: { body: page("S1") }, [`${W}/s2`]: { body: page("S2") }, [`${W}/z-body-link`]: { body: page("Z") },
  };
  it("reads the start page, the pages of its menu, the sitemap's pages, then the links in the text", async () => {
    const { http, stats } = await crawl(routes);
    expect(pathsSeen(http)).toEqual(["/", "/about", "/events", "/s1", "/s2", "/z-body-link"]);
    expect(stats).toMatchObject({ pages_fetched: 6, pages_in_sitemap: 3, sitemap_used: true, stopped_by: "done" });
  });
  it("without a sitemap follows the links breadth-first and says there was no sitemap", async () => {
    const { http, notes } = await crawl({
      ...robotsRoute(),
      [`${W}/`]: { body: page("Home", ["/a", "/b"]) }, [`${W}/a`]: { body: page("A", ["/a1"]) }, [`${W}/b`]: { body: page("B", ["/b1"]) }, [`${W}/a1`]: { body: page("A1") }, [`${W}/b1`]: { body: page("B1") },
    });
    expect(pathsSeen(http)).toEqual(["/", "/a", "/b", "/a1", "/b1"]);
    expect(notes).toContainEqual({ code: "no_sitemap", count: 1 });
  });
  it("reads a few pages from each part of the site before any part gets more", async () => {
    const blog = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"].map((s) => `/blog/${s}`);
    const r: Routes = { ...robotsRoute("", `${W}/sitemap.xml`), [`${W}/sitemap.xml`]: urlset([...blog, "/about", "/contact", "/events", "/give"]), [`${W}/`]: { body: page("Home") } };
    for (const p of [...blog, "/about", "/contact", "/events", "/give"]) r[W + p] = { body: page(p) };
    const { http } = await crawl(r, { max_pages: 8 });
    const got = pathsSeen(http);
    for (const p of ["/about", "/contact", "/events", "/give"]) expect(got).toContain(p);
    expect(got.filter((p) => p.startsWith("/blog/"))).toHaveLength(3);
  });
  it("reads only a few pages that differ by a number (a calendar's days)", async () => {
    const days = Array.from({ length: 30 }, (_, i) => `/cal/2026/10/${String(i + 1).padStart(2, "0")}`);
    const r: Routes = { ...robotsRoute(), [`${W}/`]: { body: page("Home", [...days, "/about"]) }, [`${W}/about`]: { body: page("About") } };
    for (const d of days) r[W + d] = { body: page(d) };
    const { http } = await crawl(r);
    const got = pathsSeen(http);
    expect(got.filter((p) => p.startsWith("/cal/"))).toHaveLength(3);
    expect(got).toContain("/about");
  });
  it("counts an address once however it is written (www, http, trailing slash, #fragment, tracking)", async () => {
    const { http } = await crawl({ ...robotsRoute(), [`${W}/`]: { body: page("Home", ["/a", "/a/", "http://www.example.org/a", "https://example.org/a#top", "/a?utm_source=x"]) }, [`${W}/a`]: { body: page("A") } });
    expect(pathsSeen(http)).toEqual(["/", "/a"]);
  });
});

describe("the page limit", () => {
  const many = (n: number): Routes => {
    const paths = Array.from({ length: n }, (_, i) => `/${word(i)}`);
    const r: Routes = { ...robotsRoute("", `${W}/sitemap.xml`), [`${W}/sitemap.xml`]: urlset(paths), [`${W}/`]: { body: page("Home") } };
    for (const p of paths) r[W + p] = { body: page(p) };
    return r;
  };
  it("clamps the limit: 40 by default, at least 1, never above 80", () => {
    expect([clampPages(undefined), clampPages(0), clampPages(-5), clampPages(7), clampPages(500), clampPages("20"), clampPages(NaN), clampPages(12.9)]).toEqual([DEFAULT_MAX_PAGES, 1, 1, 7, HARD_MAX_PAGES, DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES, 12]);
  });
  it("stops at 40 pages by default and says the site has more", async () => {
    const { stats, notes, pages } = await crawl(many(120));
    expect(pages).toHaveLength(40);
    expect(stats.stopped_by).toBe("max_pages");
    expect(notes).toContainEqual({ code: "page_limit", count: 1 });
  });
  it("never reads more than 80 pages, whatever was asked", async () => {
    const { pages } = await crawl(many(300), { max_pages: 5000 });
    expect(pages).toHaveLength(80);
  });
  it("honours a smaller limit", async () => {
    expect((await crawl(many(50), { max_pages: 5 })).pages).toHaveLength(5);
  });
});

describe("robots.txt, private networks and leaving the site", () => {
  it("does not read a page robots.txt closes, and counts it", async () => {
    const { http, stats, notes } = await crawl({
      ...robotsRoute("Disallow: /private\nDisallow: /cal*"), [`${W}/`]: { body: page("Home", ["/private/x", "/ok", "/calendar/2026"]) }, [`${W}/ok`]: { body: page("Ok") }, [`${W}/private/x`]: { body: page("No") }, [`${W}/calendar/2026`]: { body: page("No") },
    });
    expect(pathsSeen(http)).toEqual(["/", "/ok"]);
    expect(stats.skipped.robots).toBe(2);
    expect(notes).toContainEqual({ code: "robots_skipped", count: 2 });
  });
  it("refuses a start page robots.txt closes", async () => {
    await expect(crawl({ ...robotsRoute("Disallow: /"), [`${W}/`]: { body: page("Home") } })).rejects.toThrow(/asks robots not to read/);
  });
  it("refuses private networks: an address, localhost, a name that points inside", async () => {
    for (const u of ["http://192.168.0.10/", "http://127.0.0.1:8080/", "http://localhost/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/"]) {
      const http = fakeHttp({});
      await expect(crawlSite(makeDeps(http, OK, limitsFor(clock())), { start_url: u, mode: "own" }), u).rejects.toBeInstanceOf(PermanentError);
      expect(http.seen).toEqual([]);
    }
    const http = fakeHttp({});
    const inside = { allowPrivate: false, resolve: async () => ["10.0.0.5"] };
    await expect(crawlSite(makeDeps(http, inside, limitsFor(clock())), { start_url: "https://intranet.example.org/", mode: "own" })).rejects.toThrow(/private network/);
    expect(http.seen).toEqual([]);
  });
  it("never follows a link to another website", async () => {
    const { http } = await crawl({ ...robotsRoute(), [`${W}/`]: { body: page("Home", ["https://other.example/x", "http://10.0.0.1/admin", "https://www.example.org.evil.example/y", "/ok"]) }, [`${W}/ok`]: { body: page("Ok") } });
    expect(http.seen.some((u) => /other\.example|10\.0\.0\.1|evil\.example/.test(u))).toBe(false);
    expect(pathsSeen(http)).toEqual(["/", "/ok"]);
  });
  it("stops at a redirect that leaves the site: the other site is never requested", async () => {
    const { http, stats, notes } = await crawl({
      ...robotsRoute(), [`${W}/`]: { body: page("Home", ["/moved", "/ok"]) }, [`${W}/moved`]: { status: 301, location: "https://other.example/landing" }, [`${W}/ok`]: { body: page("Ok") }, "https://other.example/landing": { body: page("Elsewhere") },
    });
    expect(http.seen).not.toContain("https://other.example/landing");
    expect(pathsSeen(http)).toEqual(["/", "/moved", "/ok"]);
    expect(stats.skipped.off_site_redirect).toBe(1);
    expect(notes).toContainEqual({ code: "off_site_redirect", count: 1 });
  });
  it("ends the crawl when the start address sends visitors to another website", async () => {
    const routes: Routes = { "https://old.example/robots.txt": { type: "text/plain", body: "" }, "https://old.example/": { status: 302, location: "https://new.example/" }, "https://new.example/": { body: page("New") } };
    const http = fakeHttp(routes);
    await expect(crawlSite(makeDeps(http, OK, limitsFor(clock())), { start_url: "https://old.example/", mode: "own" })).rejects.toThrow(/sends visitors to another website \(new\.example\)/);
    expect(http.seen).not.toContain("https://new.example/");
    const moved = fakeHttp({ "https://old.example/robots.txt": { status: 301, location: "https://new.example/robots.txt" }, "https://new.example/robots.txt": { type: "text/plain", body: "" } });
    await expect(crawlSite(makeDeps(moved, OK, limitsFor(clock())), { start_url: "https://old.example/", mode: "own" })).rejects.toThrow(/another website/);
  });
  it("follows the plain move to www, which is the same site", async () => {
    const routes: Routes = {
      "https://example.org/robots.txt": { status: 301, location: `${W}/robots.txt` }, ...robotsRoute(), "https://example.org/": { status: 301, location: `${W}/` }, [`${W}/`]: { body: page("Home", ["/a"]) }, [`${W}/a`]: { body: page("A") },
    };
    const { pages } = await crawl(routes, { start_url: "https://example.org/" });
    expect(pages.map((p) => p.url)).toEqual([`${W}/`, `${W}/a`]);
  });
});

describe("politeness and the caps on time and size", () => {
  // A start page that links to n pages (the crawl does not go deeper than 4 links from the start page).
  const chain = (n: number): Routes => {
    const r: Routes = { ...robotsRoute(), [`${W}/`]: { body: page("Home", Array.from({ length: n }, (_, i) => `/${word(i + 1)}`)) } };
    for (let i = 1; i <= n; i++) r[`${W}/${word(i)}`] = { body: page("N" + i) };
    return r;
  };
  it("waits between requests to one host", async () => {
    const c = clock();
    const { http } = await crawl(chain(5), { max_pages: 5 }, { minDelayMs: 750 }, c);
    const pageAt = http.at.filter((_, i) => !/robots\.txt|sitemap|\.css$/.test(http.seen[i]!));
    expect(pageAt.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < pageAt.length; i++) expect(pageAt[i]! - pageAt[i - 1]!, `gap ${i}`).toBeGreaterThanOrEqual(750);
    expect(c.sleeps.every((s) => s <= 750)).toBe(true);
  });
  it("stops at the time limit and keeps what it read", async () => {
    const c = clock(400);
    const { stats, notes, pages } = await crawl(chain(30), {}, { deadlineMs: 3000 }, c);
    expect(stats.stopped_by).toBe("time");
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThan(10);
    expect(notes).toContainEqual({ code: "time_limit", count: 1 });
  });
  it("stops at the size limit", async () => {
    const { stats, pages, notes } = await crawl(chain(30), {}, { maxBytes: 2500 });
    expect(stats.stopped_by).toBe("bytes");
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages.length).toBeLessThan(10);
    expect(notes).toContainEqual({ code: "byte_limit", count: 1 });
  });
  it("skips a page over 2 MB (by its header or its size) and carries on", async () => {
    const { pages, notes } = await crawl({ ...robotsRoute(), [`${W}/`]: { body: page("Home", ["/huge", "/ok"]) }, [`${W}/huge`]: { body: page("Huge"), length: 3 * 1024 * 1024 }, [`${W}/ok`]: { body: page("Ok") } });
    expect(pages.map((p) => p.url)).toEqual([`${W}/`, `${W}/ok`]);
    expect(notes).toContainEqual({ code: "page_too_large", count: 1 });
  });
});

describe("pages that fail", () => {
  it("counts a missing page or a failing server, carries on, and says how many", async () => {
    const { pages, stats, notes } = await crawl({ ...robotsRoute(), [`${W}/`]: { body: page("Home", ["/gone", "/flaky", "/ok", "/forbidden"]) }, [`${W}/gone`]: { status: 404 }, [`${W}/flaky`]: { status: 503 }, [`${W}/forbidden`]: { status: 403 }, [`${W}/ok`]: { body: page("Ok") } });
    expect(pages.map((p) => p.path)).toEqual(["/", "/ok"]);
    expect(stats.skipped.errors).toBe(3);
    expect(notes).toContainEqual({ code: "page_errors", count: 3 });
  });
  it("skips an address that is not a web page", async () => {
    const { pages, notes } = await crawl({ ...robotsRoute(), [`${W}/`]: { body: page("Home", ["/download", "/ok", "/brochure.pdf"]) }, [`${W}/download`]: { type: "application/pdf", body: "%PDF-1.4" }, [`${W}/ok`]: { body: page("Ok") } });
    expect(pages).toHaveLength(2);
    expect(notes).toContainEqual({ code: "not_html", count: 1 });
  });
  it("fails the start page plainly: a permanent error when it cannot work, a retry when it might", async () => {
    await expect(crawl({ ...robotsRoute() })).rejects.toThrow(/not found/);
    await expect(crawl({ ...robotsRoute(), [`${W}/`]: { status: 403 } })).rejects.toThrow(/would not let the crawler read/);
    await expect(crawl({ ...robotsRoute(), [`${W}/`]: { type: "application/pdf", body: "x" } })).rejects.toThrow(/not a web page/);
    const err = await crawl({ ...robotsRoute(), [`${W}/`]: { status: 503 } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentError);
    expect(String((err as Error).message)).toMatch(/tried again/);
  });
  it("reports a site whose robots.txt fails right now as a retry, not as permission", async () => {
    const err = await crawl({ [`${W}/robots.txt`]: { status: 503 }, [`${W}/`]: { body: page("Home") } }).catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/tried again/);
  });
  it("notes a page built by scripts", async () => {
    const spa = `<!doctype html><html><head><script src="/a.js"></script></head><body><div id="root"></div></body></html>`;
    const { notes, pages } = await crawl({ ...robotsRoute(), [`${W}/`]: { body: page("Home", ["/app"]) }, [`${W}/app`]: { body: spa } });
    expect(pages[1]!.built_by_scripts).toBe(true);
    expect(notes).toContainEqual({ code: "scripts_built", count: 1 });
  });
});

describe("the site's own stylesheets", () => {
  const link = `<link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="https://cdn.other.example/x.css"><link rel="stylesheet" href="/private/hidden.css">`;
  const routes: Routes = {
    ...robotsRoute("Disallow: /private"),
    [`${W}/`]: { body: page("Home", [], [], link) },
    [`${W}/css/site.css`]: { type: "text/css", body: ":root{--primary:#7a1f5c}.btn{background:#7a1f5c;color:#fff}" },
    "https://cdn.other.example/x.css": { type: "text/css", body: ".a{color:#00ff00}" },
  };
  it("reads the site's own stylesheet for the palette, and not another host's or one robots.txt closes", async () => {
    const { http, report, notes } = await crawl(routes);
    expect(http.seen).toContain(`${W}/css/site.css`);
    expect(http.seen.some((u) => u.includes("cdn.other.example") || u.includes("hidden.css"))).toBe(false);
    expect((report as OwnReport).look.palette.colors[0]).toMatchObject({ hex: "#7a1f5c", role: "primary" });
    expect(notes).toContainEqual({ code: "css_skipped_other_host", count: 1 });
  });
  it("carries on when a stylesheet cannot be read", async () => {
    const { notes, report } = await crawl({ ...routes, [`${W}/css/site.css`]: { status: 500 } });
    expect(notes).toContainEqual({ code: "css_unreadable", count: 1 });
    expect(report.mode).toBe("own");
  });
});

describe("a whole invented site, both ways", () => {
  const temple = ordinaryPages("temple");
  const routes = (): Routes => {
    const r: Routes = { ...robotsRoute("Disallow: /search", `${W}/sitemap.xml`), [`${W}/sitemap.xml`]: urlset(temple.map((p) => p.path).filter((p) => p !== "/")), [`${W}/css/site.css`]: { type: "text/css", body: "h1{color:#8c1c13}" } };
    for (const p of temple) r[W + (p.path === "/" ? "/" : p.path)] = { body: p.html.replaceAll("https://www.riverbendtemple.example", W) };
    r[`${W}/app`] = { body: fixtureHtml("temple", "script-built.html") };
    return r;
  };
  it("own: finds every page, classifies them, keeps the text, and reports the page built by scripts", async () => {
    const { report, stats } = await crawl({ ...routes(), [`${W}/sitemap.xml`]: urlset([...temple.map((p) => p.path).filter((p) => p !== "/"), "/app"]) });
    const r = report as OwnReport;
    expect(stats.pages_fetched).toBe(temple.length + 1);
    expect(r.pages.find((p) => p.path === "/events")).toMatchObject({ kind: "events" });
    expect(r.pages.find((p) => p.path === "/give")).toMatchObject({ kind: "donate" });
    expect(r.pages.find((p) => p.path === "/app")).toMatchObject({ built_by_scripts: true });
    expect(r.notes).toContainEqual({ code: "scripts_built", count: 1 });
    expect(r.pages[0]!.sections.length).toBeGreaterThan(0);
    expect(r.crawl.sitemap_used).toBe(true);
  });
  it("reference: the same crawl keeps the layout and none of the content", async () => {
    const { report } = await crawl(routes(), { mode: "reference" });
    const r = report as ReferenceReport;
    expect(r.structure.home_pattern.slice(0, 3)).toEqual(["header", "hero", "about"]);
    expect(findContentLeaks(r)).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/riverbend|hero-temple|office@/i);
  });
});

describe("the job", () => {
  const ctx = (http: Http) => ({ db: { query: async () => [] }, http, log: captureLog().log, env: { NIVA_IMPORT_ALLOW_PRIVATE: "1" }, workerId: "w", secret: async () => null, storeSecret: async () => ({ fingerprint: "" }), removeOauthCode: async () => false }) as never;
  const c = clock();
  const lim = limitsFor(c);
  it("says in plain words what is wrong with its input", async () => {
    const http = fakeHttp({});
    await expect(run(job({ payload: {} }), ctx(http), lim)).rejects.toThrow(/does not say which website/);
    await expect(run(job({ payload: { start_url: W } }), ctx(http), lim)).rejects.toThrow(/own.*reference/);
    await expect(run(job({ payload: { start_url: W, mode: "mine" } }), ctx(http), lim)).rejects.toBeInstanceOf(PermanentError);
    await expect(run(job({ center_id: null, payload: { start_url: W, mode: "own" } }), ctx(http), lim)).rejects.toThrow(/which community/);
    expect(http.seen).toEqual([]);
  });
  it("returns the report as the job result", async () => {
    const http = fakeHttp({ ...robotsRoute(), [`${W}/`]: { body: page("Home", ["/a"]) }, [`${W}/a`]: { body: page("A") } }, c);
    const out = (await run(job({ kind: "site.crawl", payload: { start_url: `${W}/`, mode: "own", max_pages: 10 } }), ctx(http), lim)) as OwnReport;
    expect(out).toMatchObject({ schema: 1, mode: "own", site: "example.org" });
    expect(out.pages).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
  it("refuses to save a reference report that would hold text (the last check)", async () => {
    const sentence = "A whole sentence of the site's own words";
    const css = `<style>body{font-family:"${sentence.slice(0, 38)}", serif}</style>`;
    const http = fakeHttp({ ...robotsRoute(), [`${W}/`]: { body: page("Home", [], [], css) } }, c);
    await expect(run(job({ payload: { start_url: `${W}/`, mode: "reference" } }), ctx(http), lim)).rejects.toThrow(/held text or addresses/);
  });
});
