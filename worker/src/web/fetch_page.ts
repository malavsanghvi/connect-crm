// Fetching one web page for Niva to learn from (niva.import_page), and the same safe GET for a
// site's robots.txt and sitemaps (niva.discover_site, worker/src/web/sitemap.ts).
//
// Only public pages are read: the host must resolve to public IP addresses (the same
// rule calendar subscriptions use: no loopback, private, link-local or carrier-grade NAT
// ranges), redirects are followed by hand (at most 5) and every hop is checked again,
// every request has a timeout, a page over 2 MB is refused, and robots.txt is honoured
// (a page the site asks robots not to fetch is not fetched). Local stacks and tests serve
// pages on localhost; they set NIVA_IMPORT_ALLOW_PRIVATE=1 on the background service.
// Production never sets it. Plain-English messages: they reach the staff member on
// Content › Niva when an import fails.

import { lookup } from "node:dns/promises";
import net from "node:net";

import { isPrivateAddress, type Resolve } from "../calendar/feed";
import { PermanentError } from "../errors";
import type { Http } from "../http";
import { parseRobots, parseSitemaps, robotsAllows, type RobotsRule } from "./robots";

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const IMPORT_AGENT = "CommunityConnect-Niva/1.0";
const MAX_REDIRECTS = 5;

export type FetchOpts = { allowPrivate: boolean; resolve?: Resolve };

const defaultResolve: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Refuses anything but a public http(s) page address. Throws PermanentError with a plain-English reason. */
export async function assertPublicPage(raw: string, opts: FetchOpts): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PermanentError(`"${raw.slice(0, 120)}" is not a web page address.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PermanentError("A page address must start with https:// (or http://).");
  if (url.username || url.password) throw new PermanentError("A page address must not contain a user name or password.");
  if (opts.allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new PermanentError("That address points to a private network; only public web pages can be imported.");
  }
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try {
      addrs = await (opts.resolve ?? defaultResolve)(host);
    } catch (err) {
      throw new Error(`Could not find the website's server (${host}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) {
    throw new PermanentError("That address points to a private network; only public web pages can be imported.");
  }
  return url;
}

export type Got = { status: number; headers: Headers; text: string; bytes(): Uint8Array; url: URL };

/** What a sitemap request asks for (niva.discover_site, worker/src/web/sitemap.ts). */
export const XML_ACCEPT = "application/xml, text/xml;q=0.9, application/x-gzip;q=0.5, */*;q=0.1";

/**
 * GET one address the safe way: redirects followed by hand (at most 5), every hop checked to be a public address
 * again, a timeout and one retry per request. `accept` is the request's Accept header (HTML for a page, XML_ACCEPT
 * for a sitemap). The caller reads the status: anything but a redirect comes back as it is.
 */
export async function get(http: Http, first: URL, accept: string, opts: FetchOpts): Promise<Got> {
  let url = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await http.request(url.toString(), { headers: { accept, "user-agent": IMPORT_AGENT }, timeoutMs: 20000, retries: 1, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get("location");
      if (!to) throw new Error(`The website answered ${res.status} without saying where the page moved.`);
      url = await assertPublicPage(new URL(to, url).toString(), opts);
      continue;
    }
    return { status: res.status, headers: res.headers, text: res.text, bytes: () => res.bytes(), url };
  }
  throw new Error(`The page redirected more than ${MAX_REDIRECTS} times.`);
}

/** `origin`: where robots.txt was read in the end (after redirects): a site that moved to www or to a new domain says so here. */
export type Robots = { rules: RobotsRule[]; sitemaps: string[]; origin: string };

/**
 * The site's robots.txt: the rules for our agent and the sitemaps it lists. A missing (or unreadable) robots.txt
 * allows everything and lists nothing; one the site cannot serve right now (5xx, 429, no connection) is a
 * try-again error, never a "yes".
 */
export async function readRobots(http: Http, url: URL, opts: FetchOpts): Promise<Robots> {
  let res: Got;
  try {
    res = await get(http, new URL("/robots.txt", url.origin), "text/plain, */*;q=0.1", opts);
  } catch (err) {
    if (err instanceof PermanentError) throw err;
    throw new Error(`Could not read the website's robots.txt (${err instanceof Error ? err.message : String(err)}); it will be tried again.`);
  }
  if (res.status >= 500 || res.status === 429) throw new Error(`The website's robots.txt is unavailable right now (${res.status}); it will be tried again.`);
  if (res.status !== 200) return { rules: [], sitemaps: [], origin: res.url.origin };
  return { rules: parseRobots(res.text, IMPORT_AGENT), sitemaps: parseSitemaps(res.text), origin: res.url.origin };
}

/** Whether the site's robots.txt lets us fetch this address. A missing robots.txt allows it. */
async function robotsAllowsUrl(http: Http, url: URL, opts: FetchOpts): Promise<boolean> {
  const { rules } = await readRobots(http, url, opts);
  return robotsAllows(rules, url.pathname + url.search);
}

/** GET a page's HTML: public addresses only, robots.txt honoured, redirects re-checked, size-limited. */
export async function fetchPage(http: Http, raw: string, opts: FetchOpts): Promise<{ html: string; finalUrl: string }> {
  const start = await assertPublicPage(raw, opts);
  if (!(await robotsAllowsUrl(http, start, opts))) {
    throw new PermanentError(`${start.hostname} asks robots not to read this page (its robots.txt disallows ${start.pathname}), so it was not imported.`);
  }
  const res = await get(http, start, "text/html, application/xhtml+xml;q=0.9, */*;q=0.1", opts);
  if (res.url.origin !== start.origin && !(await robotsAllowsUrl(http, res.url, opts))) {
    throw new PermanentError(`${res.url.hostname} asks robots not to read this page, so it was not imported.`);
  }
  if (res.status === 404 || res.status === 410) throw new PermanentError(`The page was not found (the website answered ${res.status}). Check the address.`);
  if (res.status === 401 || res.status === 403) throw new PermanentError(`The website would not let the importer read this page (it answered ${res.status}). It may need a sign-in or block automated readers; paste the text in by hand instead.`);
  if (res.status !== 200) throw new Error(`The website answered ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  if (!/html|xml/i.test(type)) throw new PermanentError(`That address is not a web page (the website says it is "${type.split(";")[0] || "unknown"}"). PDFs and files are not imported yet.`);
  if (Number(res.headers.get("content-length") ?? "0") > MAX_PAGE_BYTES || Buffer.byteLength(res.text, "utf8") > MAX_PAGE_BYTES) {
    throw new PermanentError("The page is larger than 2 MB, which is more than the importer reads.");
  }
  return { html: res.text, finalUrl: res.url.toString() };
}
