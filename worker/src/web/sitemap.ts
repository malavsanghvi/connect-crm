// Finding a website's pages for Niva (niva.discover_site, Content › Niva › Find a website's pages).
//
// Where the list comes from: the "Sitemap:" lines of the site's robots.txt (the first 10 of this site); when
// those give no pages, /sitemap.xml, /sitemap_index.xml and /wp-sitemap.xml (WordPress), in that order, until
// one does. A <sitemapindex> is followed one level down (at most 10 of its sitemaps); a gzipped sitemap
// (.xml.gz) is unpacked. Every request goes through fetch_page's get(): public addresses only, every redirect
// checked again, a timeout, and a sitemap over 5 MB is not read. One search reads at most 25 sitemaps and
// 20 MB, and starts none after 5 minutes (DISCOVERY_LIMITS), so it ends well inside the job's lease.
//
// A sitemap that cannot be read right now (5xx, 429, a timeout) while others could is not dropped quietly:
// Discovery.unreadable says so, the job tries again, and on its last try the list is saved as incomplete
// (pages already on it are kept; app.niva_worker_save_discovery's p_complete).
//
// What is kept: pages of the same site (the apex and www forms are one site, as in app.niva_page_key), that
// robots.txt lets us read, that are web pages (not PDFs, images, documents or media), each once, at most 500.
// Addresses are written one way, exactly as app.niva_page_address (0576) writes them, so the database and
// the background service agree on which page is which.
//
// Nothing is imported here: the list is saved for content staff, who choose the pages (niva.import_page).

import { gunzipSync } from "node:zlib";

import { PermanentError } from "../errors";
import type { Http } from "../http";
import { assertPublicPage, get, readRobots, XML_ACCEPT, type FetchOpts, type Got } from "./fetch_page";
import { decodeEntities } from "./page_text";
import { robotsAllows } from "./robots";

export const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
export const MAX_DISCOVERED_PAGES = 500;
export const MAX_CHILD_SITEMAPS = 10;
/** The first this many same-site "Sitemap:" lines of robots.txt are read; the rest are not. */
export const MAX_ROBOTS_SITEMAPS = 10;
export const FALLBACK_SITEMAPS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"];

/**
 * What one search may spend, so it always ends well inside the job's 15-minute lease (one sitemap request can take
 * about 40 seconds: a 20-second timeout and one retry): at most 25 sitemap files, 20 MB read in all, and no new
 * sitemap is started after 5 minutes. A search that stops early says so (Discovery.stopped).
 */
export type DiscoveryLimits = { fetches: number; bytes: number; deadlineMs: number; now: () => number };
export const DISCOVERY_LIMITS: DiscoveryLimits = { fetches: 25, bytes: 20 * 1024 * 1024, deadlineMs: 5 * 60_000, now: () => Date.now() };

// ── One way to write an address (mirrors app.niva_page_address / app.niva_page_key, 0576) ─────────────────────
const ADDRESS = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?]*)([^?]*)(?:\?(.*))?$/;
const TRACKING = /^(utm_.*|gclid|fbclid)$/;

/**
 * A page's address written one way: lower-case scheme and host, no default port, #fragment, trailing slash or
 * utm_* / gclid / fbclid parameters; the path keeps its case. null when it is not an http(s) address.
 */
export function pageAddress(raw: string): string | null {
  const v = raw.trim().replace(/#.*$/s, "");
  const m = ADDRESS.exec(v);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  if (scheme !== "https" && scheme !== "http") return null;
  let host = m[2]!.toLowerCase();
  if (scheme === "https") host = host.replace(/:443$/, "");
  else host = host.replace(/:80$/, "");
  host = host.replace(/\.$/, "");
  const path = (m[3] ?? "").replace(/\/+$/, "");
  const kept = (m[4] ?? "").split("&").filter((p) => p !== "" && !TRACKING.test(p.split("=")[0]!.toLowerCase()));
  return `${scheme}://${host}${path}${kept.length > 0 ? "?" + kept.join("&") : ""}`;
}

/** Which page an address is: pageAddress without the scheme and a leading "www." (the apex and www forms are one). */
export function pageKey(raw: string): string | null {
  const a = pageAddress(raw);
  return a === null ? null : a.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
}

/** The site an address belongs to: its host (and a port other than the default) without "www.". */
export function siteOf(raw: string): string | null {
  const k = pageKey(raw);
  return k === null ? null : k.replace(/[/?].*$/s, "");
}

// ── Reading a sitemap ─────────────────────────────────────────────────────────────────────────────────────────
export type SitemapEntry = { loc: string; lastmod: string | null };
export type ParsedSitemap = { kind: "urlset" | "index" | "text" | "unknown"; entries: SitemapEntry[] };

// Extensions that mark a <loc> inside a <url> that is not the page's own address (image, video and news sitemaps).
const EXTENSION_PREFIX = /^(image|video|news|xhtml)$/i;

function tagText(block: string, tag: string): string | null {
  const re = new RegExp(`<(?:([\\w-]+):)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}\\s*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    if (m[1] && EXTENSION_PREFIX.test(m[1])) continue;
    let v = m[2]!.trim();
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
    if (cdata) v = cdata[1]!.trim();
    v = decodeEntities(v).trim();
    return v || null;
  }
  return null;
}

/** A W3C date (2026-09-18, 2026-09-18T10:00:00+00:00) or nothing: anything else in <lastmod> is not shown. */
function lastmodOf(v: string | null): string | null {
  return v !== null && /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) ? v : null;
}

/** A sitemap file: a <urlset> of pages, a <sitemapindex> of sitemaps, or a plain list of addresses (one per line). */
export function parseSitemap(text: string): ParsedSitemap {
  const body = text.replace(/^﻿/, "");
  const index = /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(body);
  const urlset = /<(?:[\w-]+:)?urlset[\s>]/i.test(body);
  if (index || urlset) {
    const item = index ? "sitemap" : "url";
    const re = new RegExp(`<(?:[\\w-]+:)?${item}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${item}\\s*>`, "gi");
    const entries: SitemapEntry[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const loc = tagText(m[1]!, "loc");
      if (loc) entries.push({ loc, lastmod: lastmodOf(tagText(m[1]!, "lastmod")) });
    }
    return { kind: index ? "index" : "urlset", entries };
  }
  // The sitemap protocol also allows a text file of addresses, one per line.
  if (!/<[a-z?!]/i.test(body.slice(0, 4096))) {
    const entries = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\/\S+$/i.test(l))
      .map((loc) => ({ loc, lastmod: null }));
    if (entries.length > 0) return { kind: "text", entries };
  }
  return { kind: "unknown", entries: [] };
}

const FILE_EXT = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv", "epub", "ics", "json", "xml", "js", "css",
  "zip", "rar", "7z", "gz", "tar", "tgz", "exe", "dmg", "apk", "msi",
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tif", "tiff", "ico", "heic", "avif",
  "mp3", "wav", "m4a", "ogg", "flac", "aac", "mp4", "m4v", "mov", "avi", "wmv", "webm", "mkv",
]);

/** A PDF, image, document, archive or media file rather than a web page (the importer reads web pages only). */
export function isFileAddress(url: URL): boolean {
  const last = url.pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 && FILE_EXT.has(last.slice(dot + 1).toLowerCase());
}

// ── Finding the pages ─────────────────────────────────────────────────────────────────────────────────────────
export type DiscoveredPage = { url: string; lastmod: string | null };
export type Discovery = {
  /** The site's address as it was finally read (after a redirect to www or to a new domain). */
  root: string;
  /** Its host without "www.". */
  site: string;
  /** The sitemap files that were read. */
  sitemaps: string[];
  pages: DiscoveredPage[];
  /** The sitemaps list more than 500 pages; the first 500 are kept. */
  truncated: boolean;
  skipped: { other_site: number; files: number; robots: number; duplicates: number };
  /**
   * Sitemaps that could not be read right now (5xx, 429, a timeout), one line each. When there are any, the list is
   * not complete: the pages those sitemaps list are missing from it, and the search is worth running again.
   */
  unreadable: string[];
  /** The search stopped at its limits (DISCOVERY_LIMITS) before reading every sitemap: the list may be missing pages. */
  stopped: boolean;
  /** Sitemaps over 5 MB, which were not read. */
  tooBig: number;
};

/** Read a site's sitemaps and list its pages. Throws in plain English: PermanentError when there is nothing to find. */
export async function discoverPages(http: Http, root: string, opts: FetchOpts, limits: DiscoveryLimits = DISCOVERY_LIMITS): Promise<Discovery> {
  const started = limits.now();
  const start = await assertPublicPage(root, opts);
  const robots = await readRobots(http, start, opts);
  const origin = new URL(robots.origin);
  const site = siteOf(origin.toString())!;
  const host = origin.hostname;
  const sameSite = (u: URL) => siteOf(u.toString()) === site;

  const read: string[] = [];
  const tried = new Set<string>();
  const trouble: string[] = []; // temporary problems: worth trying again later
  let tooBig = 0;
  let fetches = 0;
  let bytesRead = 0;
  let stopped = false;
  const pages = new Map<string, DiscoveredPage>();
  const skipped = { other_site: 0, files: 0, robots: 0, duplicates: 0 };
  let truncated = false;

  const take = (entries: SitemapEntry[]) => {
    for (const e of entries) {
      let u: URL;
      try {
        u = new URL(e.loc);
      } catch {
        skipped.other_site++;
        continue;
      }
      if ((u.protocol !== "https:" && u.protocol !== "http:") || !sameSite(u)) {
        skipped.other_site++;
        continue;
      }
      if (isFileAddress(u)) {
        skipped.files++;
        continue;
      }
      if (!robotsAllows(robots.rules, u.pathname + u.search)) {
        skipped.robots++;
        continue;
      }
      const address = pageAddress(e.loc);
      const key = address === null ? null : pageKey(address);
      if (address === null || key === null) {
        skipped.other_site++;
        continue;
      }
      if (pages.has(key)) {
        skipped.duplicates++;
        continue;
      }
      if (pages.size >= MAX_DISCOVERED_PAGES) {
        truncated = true;
        return;
      }
      pages.set(key, { url: address, lastmod: e.lastmod });
    }
  };

  /** One sitemap file, or null when it is not there, not readable, not of this site or not allowed. */
  const spent = () => fetches >= limits.fetches || bytesRead >= limits.bytes || limits.now() - started >= limits.deadlineMs;
  const readOne = async (raw: string): Promise<ParsedSitemap | null> => {
    const asked = URL.canParse(raw) ? new URL(raw) : null;
    if (!asked || tried.has(asked.toString()) || !sameSite(asked)) return null;
    // Checked before the address is even looked up: a search that has spent its limits starts nothing new.
    if (spent()) {
      stopped = true;
      return null;
    }
    let url: URL;
    try {
      url = await assertPublicPage(raw, opts);
    } catch (err) {
      if (!(err instanceof PermanentError)) trouble.push(err instanceof Error ? err.message : String(err));
      return null;
    }
    const key = url.toString();
    if (tried.has(key) || !sameSite(url) || !robotsAllows(robots.rules, url.pathname + url.search)) return null;
    tried.add(key);
    fetches++;
    let res: Got;
    try {
      res = await get(http, url, XML_ACCEPT, opts);
    } catch (err) {
      if (!(err instanceof PermanentError)) trouble.push(`${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    if (res.status >= 500 || res.status === 429) {
      trouble.push(`${url.pathname} answered ${res.status}`);
      return null;
    }
    if (res.status !== 200) return null;
    const bytes = res.bytes();
    bytesRead += bytes.length;
    if (Number(res.headers.get("content-length") ?? "0") > MAX_SITEMAP_BYTES || bytes.length > MAX_SITEMAP_BYTES) {
      tooBig++;
      return null;
    }
    let text = res.text;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try {
        text = gunzipSync(bytes, { maxOutputLength: MAX_SITEMAP_BYTES }).toString("utf8");
        bytesRead += text.length;
      } catch (err) {
        // More than 5 MB unpacked, or a broken file.
        if ((err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") tooBig++;
        return null;
      }
    }
    const parsed = parseSitemap(text);
    if (parsed.kind === "unknown") return null;
    read.push(res.url.toString());
    return parsed;
  };

  const readList = async (list: string[], untilFound: boolean) => {
    for (const raw of list) {
      if (truncated || stopped || (untilFound && pages.size > 0)) return;
      const sm = await readOne(raw);
      if (!sm) continue;
      if (sm.kind !== "index") {
        take(sm.entries);
        continue;
      }
      // One level down: an index inside an index is not followed.
      let children = 0;
      for (const child of sm.entries) {
        if (children >= MAX_CHILD_SITEMAPS || truncated || stopped) break;
        const u = URL.canParse(child.loc) ? new URL(child.loc) : null;
        if (!u || !sameSite(u)) continue;
        children++;
        const inner = await readOne(child.loc);
        if (inner && inner.kind !== "index") take(inner.entries);
      }
    }
  };

  // Only this site's sitemaps count, and only the first few: a robots.txt can list hundreds.
  const listed = robots.sitemaps.filter((s) => URL.canParse(s) && sameSite(new URL(s))).slice(0, MAX_ROBOTS_SITEMAPS);
  await readList(listed, false);
  if (pages.size === 0) await readList(FALLBACK_SITEMAPS.map((p) => new URL(p, origin).toString()), true);

  if (pages.size === 0) {
    if (trouble.length > 0) {
      throw new Error(`Could not read ${host}'s sitemap right now (${trouble[0]}); it will be tried again.`);
    }
    if (read.length === 0 && tooBig > 0) {
      throw new PermanentError(`${host}'s sitemap is larger than 5 MB, which is more than Niva reads. Paste the page addresses into "Import from a web page" instead.`);
    }
    if (read.length === 0) {
      throw new PermanentError(
        `No sitemap was found on ${host}. Niva looked for the sitemaps its robots.txt lists and at ${FALLBACK_SITEMAPS.join(", ")}. Paste the page addresses into "Import from a web page" instead.`,
      );
    }
    const why = [
      skipped.other_site ? `${skipped.other_site} on other websites` : "",
      skipped.files ? `${skipped.files} files such as PDFs or images` : "",
      skipped.robots ? `${skipped.robots} that the site's robots.txt asks robots not to read` : "",
    ].filter(Boolean);
    throw new PermanentError(
      `${host}'s sitemap lists no web pages Niva can read${why.length ? ` (it lists ${why.join(", ")})` : ""}. Paste the page addresses into "Import from a web page" instead.`,
    );
  }
  return { root: origin.origin, site, sitemaps: read, pages: [...pages.values()], truncated, skipped, unreadable: trouble, stopped, tooBig };
}
