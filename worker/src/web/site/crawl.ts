// The crawl planner (job site.crawl): which pages of a site to read, in what order, and when to stop.
//
// It owns the rules and none of the network: every request goes through CrawlDeps, so the tests run it with a fake
// fetcher and the handler wires the real, safe one (worker/src/web/fetch_page.ts: public addresses only, redirects
// re-checked, timeouts).
//
// Order: the start page; then the pages its menu lists (the site's own statement of its main pages); then the pages
// its sitemap lists (B20, worker/src/web/sitemap.ts), a few from each part of the site before any part gets more;
// then the other same-site links, breadth-first. Rules: robots.txt honoured (one read, kept), private networks
// refused, one request at a time with a pause between requests to a host, caps on pages (default 40, never above 80),
// total bytes and total time, a redirect that leaves the site is not followed (and ends the crawl when it is the
// start page), and no page that only repeats a calendar (the same address shape with other numbers) more than 3 times.

import { PermanentError } from "../../errors";
import { MAX_PAGE_BYTES, type Got, type Robots } from "../fetch_page";
import { isFileAddress, pageAddress, pageKey, siteOf, type Discovery } from "../sitemap";
import { robotsAllows, type RobotsRule } from "../robots";
import { extractPage } from "./extract";
import { buildReport, type SiteReport } from "./report";
import type { CrawlStats, Mode, Note, NoteCode, PageFacts } from "./types";
import { isInternal } from "./util";

export const DEFAULT_MAX_PAGES = 40;
export const HARD_MAX_PAGES = 80;
const GROUP_QUOTA = 3;
const SHAPE_QUOTA = 3;
const MAX_DEPTH = 4;
const MAX_CSS_FILES = 4;
export const MAX_CSS_BYTES = 512 * 1024;

export type CrawlLimits = {
  /** All page bytes read, in total. */
  maxBytes: number;
  /** No request starts after this many milliseconds. */
  deadlineMs: number;
  /** The least time between two requests to one host. */
  minDelayMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export const CRAWL_LIMITS: CrawlLimits = {
  maxBytes: 30 * 1024 * 1024,
  deadlineMs: 8 * 60_000,
  minDelayMs: 750,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Thrown by the redirect guard: the page moved to another website. */
export class OffSiteRedirect extends Error {
  override name = "OffSiteRedirect";
  constructor(readonly to: URL) {
    super(`The page redirects to another website (${to.hostname}).`);
  }
}

export type CrawlDeps = {
  /** Refuses anything but a public http(s) address (PermanentError, plain English). */
  assertPublic(raw: string): Promise<URL>;
  readRobots(start: URL): Promise<Robots>;
  /** The sitemap's pages (B20). Throws PermanentError when the site has none; any other error is "not readable now". */
  discover(start: string): Promise<Discovery>;
  /** GET an HTML page; `guard` is called with every redirect target and may throw (OffSiteRedirect). */
  getPage(url: URL, guard: (from: URL, to: URL) => void): Promise<Got>;
  /** GET a stylesheet (same rules, text/css). */
  getCss(url: URL): Promise<Got>;
  limits: CrawlLimits;
};

export type CrawlInput = { start_url: string; mode: Mode; max_pages?: number };

export function clampPages(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : DEFAULT_MAX_PAGES;
  return Math.min(HARD_MAX_PAGES, Math.max(1, v));
}

type Candidate = { url: string; key: string; depth: number; source: "start" | "nav" | "sitemap" | "link"; seq: number; group: string; shape: string };

/** The first folder of the address: pages of one part of the site ("/events/...") share it. */
function groupOf(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}
/** The address with its numbers folded: /events/2026/10/14 and /events/2026/10/15 have one shape (calendar traps). */
function shapeOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\d+/g, "#") + (u.search ? "?" + [...u.searchParams.keys()].sort().join("&") : "");
  } catch {
    return url;
  }
}

const NOT_A_PAGE_QUERY = /(^|&)(replytocom|share|print|ical|outlook-ical|format=(ics|feed|rss)|action=(download|print)|do=|attachment_id)/i;

export type CrawlResult = { report: SiteReport; pages: PageFacts[]; stats: CrawlStats; notes: Note[] };

export async function crawlSite(deps: CrawlDeps, input: CrawlInput): Promise<CrawlResult> {
  const { limits } = deps;
  const started = limits.now();
  const maxPages = clampPages(input.max_pages);
  const start = await deps.assertPublic(input.start_url);
  const robots = await deps.readRobots(start);
  const site = siteOf(start.toString()) ?? start.hostname;
  // The whole address moved to another website (not just to www): say so instead of reading somebody else's site.
  if (siteOf(robots.origin) !== site) {
    throw new PermanentError(`${start.hostname} sends visitors to another website (${new URL(robots.origin).hostname}). Use that website's address instead.`);
  }
  const rules: RobotsRule[] = robots.rules;
  const allowed = (u: URL) => robotsAllows(rules, u.pathname + u.search);
  if (!allowed(start)) {
    throw new PermanentError(`${start.hostname} asks robots not to read this page (its robots.txt disallows ${start.pathname}), so it was not read.`);
  }

  const skipped = { robots: 0, off_site: 0, off_site_redirect: 0, files: 0, errors: 0 };
  const counts: Partial<Record<NoteCode, number>> = {};
  const note = (code: NoteCode, n = 1) => {
    counts[code] = (counts[code] ?? 0) + n;
  };

  // 1. The sitemap (B20). A site without one, or one that cannot be read right now, is crawled by its links.
  let sitemapPages: string[] = [];
  let inSitemap = 0;
  try {
    const found = await deps.discover(start.toString());
    sitemapPages = found.pages.map((p) => p.url);
    inSitemap = found.pages.length;
    skipped.off_site += found.skipped.other_site;
    skipped.files += found.skipped.files;
    skipped.robots += found.skipped.robots;
    if (found.unreadable.length > 0) note("sitemap_unreadable");
  } catch (err) {
    note(err instanceof PermanentError ? "no_sitemap" : "sitemap_unreadable");
  }

  // 2. The frontier.
  let seq = 0;
  const known = new Map<string, Candidate>();
  const frontier: Candidate[] = [];
  const add = (raw: string, depth: number, source: Candidate["source"]) => {
    const address = pageAddress(raw);
    if (!address) return;
    const key = pageKey(address);
    if (!key) return;
    const seen = known.get(key);
    if (seen) {
      // The start page's menu is the site's own list of its main pages: one the sitemap also lists is read as a menu page.
      if (source === "nav" && (seen.source === "sitemap" || seen.source === "link") && frontier.includes(seen)) seen.source = "nav";
      return;
    }
    let u: URL;
    try {
      u = new URL(address);
    } catch {
      return;
    }
    if (siteOf(address) !== site) {
      skipped.off_site++;
      return;
    }
    if (isFileAddress(u)) {
      skipped.files++;
      return;
    }
    if (NOT_A_PAGE_QUERY.test(u.search.slice(1)) || depth > MAX_DEPTH) return;
    if (!allowed(u)) {
      skipped.robots++;
      return;
    }
    const c: Candidate = { url: address, key, depth, source, seq: seq++, group: groupOf(address), shape: shapeOf(address) };
    known.set(key, c);
    frontier.push(c);
  };
  add(start.toString(), 0, "start");
  for (const u of sitemapPages) add(u, 1, "sitemap");

  const visitedGroups = new Map<string, number>();
  const visitedShapes = new Map<string, number>();
  const tier = (c: Candidate) =>
    (c.source === "start" ? 0 : c.source === "nav" ? 1 : c.source === "sitemap" ? 2 : 3) +
    ((visitedGroups.get(c.group) ?? 0) >= GROUP_QUOTA ? 10 : 0) +
    ((visitedShapes.get(c.shape) ?? 0) >= SHAPE_QUOTA ? 100 : 0);
  const pickNext = (): Candidate | null => {
    for (;;) {
      let best = -1;
      for (let i = 0; i < frontier.length; i++) {
        if (best === -1) best = i;
        else {
          const x = frontier[i]!, y = frontier[best]!;
          const tx = tier(x), ty = tier(y);
          if (tx < ty || (tx === ty && x.seq < y.seq)) best = i;
        }
      }
      if (best === -1) return null;
      const [c] = frontier.splice(best, 1);
      if (!c) return null;
      // The same address shape with other numbers (a calendar's days, a gallery's pages) is read a few times, not all.
      if ((visitedShapes.get(c.shape) ?? 0) >= SHAPE_QUOTA) continue;
      return c;
    }
  };

  // 3. Read pages.
  const pages: PageFacts[] = [];
  const lastAt = new Map<string, number>();
  const visitedKeys = new Set<string>();
  let bytes = 0;
  let stoppedBy: CrawlStats["stopped_by"] = "done";
  let transient: string | null = null;
  let attempts = 0;
  const pause = async (host: string) => {
    const wait = (lastAt.get(host) ?? -Infinity) + limits.minDelayMs - limits.now();
    if (wait > 0) await limits.sleep(wait);
    lastAt.set(host, limits.now());
  };

  while (pages.length < maxPages) {
    if (limits.now() - started >= limits.deadlineMs) {
      stoppedBy = "time";
      break;
    }
    if (bytes >= limits.maxBytes) {
      stoppedBy = "bytes";
      break;
    }
    if (attempts >= maxPages * 2 + 6) break;
    const next = pickNext();
    if (!next) break;
    attempts++;
    const isStart = next.source === "start";
    const url = new URL(next.url);
    await pause(url.hostname);
    let got: Got;
    try {
      // www.example.org and example.org are one site but two names: each page's own name is checked to be public again.
      await deps.assertPublic(url.toString());
      got = await deps.getPage(url, (_from, to) => {
        if (siteOf(to.toString()) !== site) throw new OffSiteRedirect(to);
      });
    } catch (err) {
      if (err instanceof OffSiteRedirect) {
        skipped.off_site_redirect++;
        note("off_site_redirect");
        if (isStart) throw new PermanentError(`${start.hostname} sends visitors to another website (${err.to.hostname}). Use that website's address instead.`);
        continue;
      }
      if (isStart && err instanceof PermanentError) throw err;
      skipped.errors++;
      note("page_errors");
      if (!(err instanceof PermanentError)) transient = err instanceof Error ? err.message : String(err);
      continue;
    }
    visitedKeys.add(next.key);
    if (got.status >= 500 || got.status === 429) {
      skipped.errors++;
      note("page_errors");
      transient = `The website answered ${got.status}.`;
      continue;
    }
    if (got.status !== 200) {
      skipped.errors++;
      note("page_errors");
      if (isStart) throw new PermanentError(got.status === 404 || got.status === 410 ? `The page was not found (the website answered ${got.status}). Check the address.` : `The website would not let the crawler read the start page (it answered ${got.status}).`);
      continue;
    }
    const type = got.headers.get("content-type") ?? "";
    if (!/html|xml/i.test(type)) {
      note("not_html");
      if (isStart) throw new PermanentError(`That address is not a web page (the website says it is "${type.split(";")[0] || "unknown"}").`);
      continue;
    }
    if (Number(got.headers.get("content-length") ?? "0") > MAX_PAGE_BYTES || Buffer.byteLength(got.text, "utf8") > MAX_PAGE_BYTES) {
      note("page_too_large");
      continue;
    }
    // A redirect inside the site can land on a page that is already read, or one robots.txt closes.
    const finalKey = pageKey(got.url.toString());
    if (finalKey && finalKey !== next.key) {
      if (visitedKeys.has(finalKey) && pages.some((p) => pageKey(p.url) === finalKey)) continue;
      visitedKeys.add(finalKey);
      known.set(finalKey, next);
    }
    if (!allowed(got.url)) {
      skipped.robots++;
      continue;
    }
    bytes += Buffer.byteLength(got.text, "utf8");
    let facts: PageFacts;
    try {
      facts = extractPage(got.text, got.url.toString(), { isStart: isStart || pages.length === 0 });
    } catch (err) {
      // A page the extractors cannot read is one page lost, not a failed crawl.
      if (isStart) throw new PermanentError(`The start page could not be read (${err instanceof Error ? err.message : String(err)}).`);
      skipped.errors++;
      note("page_errors");
      continue;
    }
    pages.push(facts);
    visitedGroups.set(next.group, (visitedGroups.get(next.group) ?? 0) + 1);
    visitedShapes.set(next.shape, (visitedShapes.get(next.shape) ?? 0) + 1);
    if (facts.built_by_scripts) note("scripts_built");

    // New links. The first page's menu is read before its sitemap neighbours; later pages' links go to the back.
    const navHrefs = new Set((facts.nav?.items ?? []).flatMap((i) => [i.href, ...i.children.map((c) => c.href)]).filter((h): h is string => !!h));
    for (const link of facts.links) {
      if (!isInternal(link, site)) continue;
      add(link, next.depth + 1, isStart && navHrefs.has(link) ? "nav" : "link");
    }
  }

  if (pages.length === 0) {
    if (transient) throw new Error(`${transient} The crawl will be tried again.`);
    throw new PermanentError(`No page of ${start.hostname} could be read.`);
  }
  if (stoppedBy === "done" && pages.length >= maxPages && frontier.length > 0) {
    stoppedBy = "max_pages";
    note("page_limit");
  }
  if (stoppedBy === "time") note("time_limit");
  if (stoppedBy === "bytes") note("byte_limit");
  if (skipped.robots > 0) note("robots_skipped", skipped.robots);

  // 4. The site's own stylesheets (a few): colours and fonts live there.
  const css: string[] = [];
  let cssRead = 0;
  for (const href of [...new Set(pages.slice(0, 3).flatMap((p) => p.css_links))]) {
    if (cssRead >= MAX_CSS_FILES) break;
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    if (!isInternal(href, site)) {
      note("css_skipped_other_host");
      continue;
    }
    if (!allowed(u)) continue;
    if (limits.now() - started >= limits.deadlineMs) break;
    await pause(u.hostname);
    try {
      await deps.assertPublic(u.toString());
      const res = await deps.getCss(u);
      cssRead++;
      if (res.status === 200 && Buffer.byteLength(res.text, "utf8") <= MAX_CSS_BYTES) css.push(res.text);
      else note("css_unreadable");
    } catch {
      note("css_unreadable");
    }
  }

  const notes: Note[] = (Object.entries(counts) as [NoteCode, number][]).filter(([, n]) => n > 0).map(([code, count]) => ({ code, count }));
  const stats: CrawlStats = {
    pages_fetched: pages.length,
    pages_in_sitemap: inSitemap,
    sitemap_used: inSitemap > 0,
    stopped_by: stoppedBy,
    bytes,
    elapsed_ms: limits.now() - started,
    skipped,
    css_files_read: css.length,
  };
  const report = buildReport({ mode: input.mode, startUrl: start.toString(), pages, css, stats, notes });
  return { report, pages, stats, notes };
}
