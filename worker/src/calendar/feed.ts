// Fetching a subscribed calendar (ICS link) and applying it to its layer.
//
// Only public addresses are fetched: the host must resolve to public IP
// addresses (no loopback, private, link-local or carrier-grade NAT ranges),
// redirects are followed by hand (at most 5) and each hop is checked again,
// every request has a timeout, and a feed larger than 5 MB is refused. Local
// stacks and end-to-end tests serve their feeds on localhost; they set
// CALENDAR_FEEDS_ALLOW_PRIVATE=1 on the background service. Production never
// sets it.

import { lookup } from "node:dns/promises";
import net from "node:net";

import type { Env } from "../config";
import { PermanentError } from "../errors";
import type { Http } from "../http";
import type { JobContext } from "../types";
import { expandCalendar, feedWindow, parseIcs, todayIn } from "./ics";

export const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type Resolve = (host: string) => Promise<string[]>;

const defaultResolve: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** webcal:// is how calendar apps spell https:// for a feed. */
export function normalizeFeedUrl(raw: string): string {
  const v = raw.trim();
  return /^webcals?:\/\//i.test(v) ? v.replace(/^webcals?:\/\//i, "https://") : v;
}

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Whether an IP address is not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Private(ip);
  if (!net.isIPv6(ip)) return true;
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return ipv4Private(mapped[1]!);
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") ||
    v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff") || v.startsWith("64:ff9b:");
}

/** Refuses anything but a public http(s) address. Throws PermanentError with a plain-English reason. */
export async function assertPublicUrl(raw: string, opts: { allowPrivate: boolean; resolve?: Resolve }): Promise<URL> {
  let url: URL;
  try {
    url = new URL(normalizeFeedUrl(raw));
  } catch {
    throw new PermanentError("The calendar link is not a valid web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PermanentError("The calendar link must start with https:// (or webcal://).");
  if (url.username || url.password) throw new PermanentError("The calendar link must not contain a user name or password.");
  if (opts.allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new PermanentError("The calendar link points to a private address; only public calendar links can be subscribed to.");
  }
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try {
      addrs = await (opts.resolve ?? defaultResolve)(host);
    } catch (err) {
      throw new Error(`Could not find the calendar's server (${host}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) {
    throw new PermanentError("The calendar link points to a private address; only public calendar links can be subscribed to.");
  }
  return url;
}

/** GET a feed: public addresses only, redirects re-checked, size-limited. */
export async function fetchFeed(http: Http, raw: string, opts: { allowPrivate: boolean; resolve?: Resolve }): Promise<string> {
  let url = await assertPublicUrl(raw, opts);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await http.request(url.toString(), {
      headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.1", "user-agent": "CommunityConnect-Calendar/1.0" },
      timeoutMs: 20000,
      retries: 1,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get("location");
      if (!to) throw new Error(`The calendar's server answered ${res.status} without saying where the calendar moved.`);
      url = await assertPublicUrl(new URL(to, url).toString(), opts);
      continue;
    }
    if (res.status === 404 || res.status === 410) throw new PermanentError(`The calendar link was not found (the server answered ${res.status}). Check the link, or ask whoever publishes the calendar.`);
    if (res.status === 401 || res.status === 403) throw new PermanentError(`The calendar is not public (the server answered ${res.status}). Use the calendar's public ICS address.`);
    if (!res.ok) throw new Error(`The calendar's server answered ${res.status}.`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_FEED_BYTES || Buffer.byteLength(res.text, "utf8") > MAX_FEED_BYTES) throw new PermanentError("The calendar is larger than 5 MB, which is more than a subscription takes.");
    if (!/BEGIN:VCALENDAR/i.test(res.text)) throw new PermanentError("The link does not return a calendar (ICS) file. Use the calendar's ICS or iCal address.");
    return res.text;
  }
  throw new Error(`The calendar link redirected more than ${MAX_REDIRECTS} times.`);
}

export function allowPrivateFeeds(env: Env): boolean {
  return env.CALENDAR_FEEDS_ALLOW_PRIVATE === "1";
}

export type FeedLayer = { layer_id: string; center_id: string | null; source_url: string; time_zone: string | null; name: string };

export type SyncResult = { layer_id: string; name: string; entries: number; skipped: number; result: unknown };

/** Fetch, parse, expand and apply one layer's feed (app.worker_calendar_feed_import upserts by UID). */
export async function syncLayer(layer: FeedLayer, ctx: Pick<JobContext, "db" | "http" | "env" | "log">, now: Date = new Date(), resolve?: Resolve): Promise<SyncResult> {
  const tz = layer.time_zone || "America/Chicago";
  const text = await fetchFeed(ctx.http, layer.source_url, { allowPrivate: allowPrivateFeeds(ctx.env), resolve });
  const cal = parseIcs(text);
  const window = feedWindow(todayIn(tz, now));
  const { entries, skipped } = expandCalendar(cal, { displayZone: tz, window });
  const rows = await ctx.db.query<{ result: unknown }>("select app.worker_calendar_feed_import($1::uuid, $2::jsonb, $3::date, $4::jsonb) as result", [
    layer.layer_id,
    JSON.stringify(entries),
    window.recurFrom,
    JSON.stringify({ calendar_name: cal.name, events_in_feed: cal.events.length, skipped: skipped.slice(0, 20), skipped_count: skipped.length, window }),
  ]);
  const result = rows[0]?.result ?? null;
  ctx.log.info("calendar feed applied", { layer: layer.layer_id, entries: entries.length, skipped: skipped.length });
  return { layer_id: layer.layer_id, name: layer.name, entries: entries.length, skipped: skipped.length, result };
}

/** Record a failed refresh on the layer, so Calendar › Layers shows it. Never throws. */
export async function recordFailure(ctx: Pick<JobContext, "db" | "log">, layerId: string, message: string): Promise<void> {
  try {
    await ctx.db.query("select app.worker_calendar_feed_failed($1::uuid, $2)", [layerId, message.slice(0, 500)]);
  } catch (err) {
    ctx.log.error("could not record the calendar feed failure on the layer", { layer: layerId, error: err, feedError: message });
  }
}
