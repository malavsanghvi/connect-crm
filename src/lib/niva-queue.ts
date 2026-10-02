// Pure helpers for the approval queue's imported Niva pages and for the rules a Niva source's text
// follows (Content › Approval queue, Content › Niva). No server imports: the queue page, its review
// drawer, the content item form and the Server Actions all use them, and tests/niva-queue.test.ts
// checks them.

// ---------------------------------------------------------------------------
// A Niva source's text
// ---------------------------------------------------------------------------

/**
 * The most a hand-written Niva source may hold. Niva's search (0573) hands the model a source of up to
 * 4,000 characters in full; a longer one only as its opening and a few excerpts. Imported sections are
 * 3,600 characters at most (worker/src/web/page_text.ts), so imports always fit.
 */
export const NIVA_SOURCE_MAX_CHARS = 4000;

const fmt = (n: number) => n.toLocaleString("en-US");

/** The text as it is saved: Windows line endings made plain, surrounding blank space removed. */
export function cleanNivaBody(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

/** Characters as the database counts them (char_length counts code points, not UTF-16 units). */
export function nivaBodyLength(raw: string | null | undefined): number {
  return Array.from(cleanNivaBody(raw)).length;
}

/**
 * Why a Niva source's text cannot be saved (or sent for approval), or null when it is fine. The
 * sentence follows "Could not save the item — " / "Could not send the item for approval — ".
 * An empty text may be kept as a draft, but is never sent for approval.
 */
export function nivaBodyProblem(raw: string | null | undefined, sending: boolean): string | null {
  const n = nivaBodyLength(raw);
  if (n === 0) {
    return sending ? "a Niva source needs its text before it is sent for approval. Write the text Niva may answer from, then send it again." : null;
  }
  if (n > NIVA_SOURCE_MAX_CHARS) {
    return `the text is ${fmt(n)} characters, ${fmt(n - NIVA_SOURCE_MAX_CHARS)} more than a source holds. Split it into two sources — Niva reads a source in full only up to ${fmt(NIVA_SOURCE_MAX_CHARS)} characters.`;
  }
  return null;
}

/** The live counter under the text box: "1,234 of 4,000 characters", red once it is too long. */
export function nivaBodyCounter(raw: string | null | undefined): { label: string; tone: "ok" | "warn" | "bad" } {
  const n = nivaBodyLength(raw);
  const base = `${fmt(n)} of ${fmt(NIVA_SOURCE_MAX_CHARS)} characters`;
  if (n === 0) return { label: `${base} — add the text before sending it for approval`, tone: "warn" };
  if (n > NIVA_SOURCE_MAX_CHARS) return { label: `${base} — ${fmt(n - NIVA_SOURCE_MAX_CHARS)} too many; split it into two sources`, tone: "bad" };
  return { label: base, tone: "ok" };
}

// ---------------------------------------------------------------------------
// The approval queue: one row per imported page
// ---------------------------------------------------------------------------

/** One in-review content item as the queue reads it (no text: that is fetched for the shown page only). */
export type QueueSourceRow = {
  id: string;
  title: string;
  kind: string;
  created_by: string | null;
  updated_at: string;
  metadata: unknown;
};

export type QueueSection = { id: string; title: string; heading: string; section: number | null; by: string | null };

export type QueueEntry =
  | { kind: "item"; id: string; title: string; itemKind: string; by: string | null; at: string }
  | { kind: "page"; url: string; title: string; sections: QueueSection[]; by: (string | null)[]; at: string };

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The page an imported Niva source came from (metadata.source_url, 0540), or null for anything else. */
export function importedSourceUrl(kind: string, metadata: unknown): string | null {
  if (kind !== "niva_source") return null;
  const url = record(metadata).source_url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/** "jsh.org/about/timings" for "https://jsh.org/about/timings/" (falls back to the address as given). */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
    return `${u.host}${path}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * The page's title: metadata.page_title of any section; else the "<page title>: " that imported
 * section titles start with (worker/src/web/page_text.ts); else the address.
 */
export function pageTitleOf(rows: { title: string; metadata: unknown }[], url: string): string {
  for (const r of rows) {
    const t = record(r.metadata).page_title;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  const first = rows[0]?.title ?? "";
  const cut = first.indexOf(": ");
  if (cut > 0) return first.slice(0, cut).trim();
  return displayUrl(url);
}

/** A section's own heading: its title without the "<page title>: " in front. */
export function sectionHeading(title: string, pageTitle: string): string {
  const prefix = `${pageTitle}: `;
  return pageTitle && title.startsWith(prefix) && title.length > prefix.length ? title.slice(prefix.length) : title;
}

function sectionNumber(metadata: unknown): number | null {
  const n = record(metadata).section;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Group the queue's items: every in-review imported Niva source of one page (same metadata.source_url)
 * becomes one row, its sections in page order; everything else stays one row per item. Rows keep the
 * order they arrive in (oldest first); a page sits where its oldest section would.
 */
export function groupQueueItems(rows: QueueSourceRow[]): QueueEntry[] {
  const out: QueueEntry[] = [];
  const pages = new Map<string, { entry: Extract<QueueEntry, { kind: "page" }>; rows: QueueSourceRow[] }>();
  for (const r of rows) {
    const url = importedSourceUrl(r.kind, r.metadata);
    if (!url) {
      out.push({ kind: "item", id: r.id, title: r.title, itemKind: r.kind, by: r.created_by, at: r.updated_at });
      continue;
    }
    let page = pages.get(url);
    if (!page) {
      page = { entry: { kind: "page", url, title: "", sections: [], by: [], at: r.updated_at }, rows: [] };
      pages.set(url, page);
      out.push(page.entry);
    }
    page.rows.push(r);
    if (r.updated_at < page.entry.at) page.entry.at = r.updated_at;
  }
  for (const { entry, rows: list } of pages.values()) {
    entry.title = pageTitleOf(list, entry.url);
    entry.sections = list
      .map((r) => ({ id: r.id, title: r.title, heading: sectionHeading(r.title, entry.title), section: sectionNumber(r.metadata), by: r.created_by }))
      .sort((a, b) => (a.section ?? Number.MAX_SAFE_INTEGER) - (b.section ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title));
    entry.by = [...new Set(list.map((r) => r.created_by))];
  }
  return out;
}

export function sectionCount(n: number): string {
  return `${fmt(n)} section${n === 1 ? "" : "s"}`;
}

/** The queue row of a page: "<page title> · N sections · <address>". */
export function pageRowLabel(page: { title: string; url: string; sections: unknown[] }): string {
  return `${page.title} · ${sectionCount(page.sections.length)} · ${page.url}`;
}

// ---------------------------------------------------------------------------
// Pages of the queue
// ---------------------------------------------------------------------------

/** About this many items per page of the queue (a page's sections each count; a page is never split). */
export const QUEUE_PAGE_SIZE = 200;

export type QueuePage<T> = {
  rows: T[];
  /** 1-based, clamped to the pages that exist. */
  page: number;
  pages: number;
  /** Items waiting in all (a page's sections each count as one). */
  total: number;
  /** The items this page shows, as "from–to" of total (0–0 when the queue is empty). */
  from: number;
  to: number;
  /** Items waiting on the pages after this one. */
  after: number;
};

/**
 * Cut the queue into pages of about `size` items. A row weighs its items (a page's sections, or 1);
 * rows are never split, so a page with many sections may make its page of the queue a little longer.
 */
export function paginateQueue<T>(rows: T[], weightOf: (row: T) => number, page: number, size = QUEUE_PAGE_SIZE): QueuePage<T> {
  const cuts: { start: number; end: number; weight: number }[] = [];
  let start = 0;
  let weight = 0;
  rows.forEach((row, i) => {
    const w = Math.max(1, weightOf(row));
    if (weight > 0 && weight + w > size) {
      cuts.push({ start, end: i, weight });
      start = i;
      weight = 0;
    }
    weight += w;
  });
  if (weight > 0) cuts.push({ start, end: rows.length, weight });
  const total = cuts.reduce((s, c) => s + c.weight, 0);
  const pages = Math.max(1, cuts.length);
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const cut = cuts[p - 1];
  if (!cut) return { rows: [], page: 1, pages: 1, total: 0, from: 0, to: 0, after: 0 };
  const before = cuts.slice(0, p - 1).reduce((s, c) => s + c.weight, 0);
  return { rows: rows.slice(cut.start, cut.end), page: p, pages, total, from: before + 1, to: before + cut.weight, after: total - before - cut.weight };
}

/** "Showing 201–400 of 523 waiting. 123 more are waiting after this page." */
export function queuePageSummary(p: Pick<QueuePage<unknown>, "from" | "to" | "total" | "after">): string {
  const shown = `Showing ${fmt(p.from)}–${fmt(p.to)} of ${fmt(p.total)} waiting.`;
  if (p.after <= 0) return shown;
  return `${shown} ${fmt(p.after)} more ${p.after === 1 ? "is" : "are"} waiting after this page.`;
}

// ---------------------------------------------------------------------------
// Publishing to Niva: the confirmation and the result
// ---------------------------------------------------------------------------

/**
 * How many unanswered questions a publish queues again at most: app.niva_retry_unanswered's own default
 * (0572). Each one may ask the model again, and a run of publishes repeats it, so a publish stays at the
 * default; only the explicit "Try the questions again" asks for the function's ceiling.
 */
export const NIVA_AUTO_RETRY_LIMIT = 100;
/** app.niva_retry_unanswered's ceiling (0572): "Try the questions again" in the queue's banner. */
export const NIVA_RETRY_MAX = 150;

export function publishPageConfirm(n: number): string {
  return n === 1
    ? "Publish the one section of this page to Niva? Niva repeats whatever is approved."
    : `Publish all ${fmt(n)} sections of this page to Niva? Niva repeats whatever is approved.`;
}

/**
 * The question comes first: the confirmation modal takes everything up to the first "?" as its title
 * (splitConfirmMessage), and a source's title is often a question itself.
 */
export function publishSourceConfirm(title: string): string {
  return `Publish this source to Niva? “${title}” — Niva repeats whatever is approved.`;
}

/**
 * What happens to Niva's unanswered questions after a source is published. `retried` is what
 * app.niva_retry_unanswered returned, or null when the Niva module is switched off (nothing to try);
 * `limit` is the p_limit it was called with.
 */
export function retrySentence(retried: number | null, limit: number): string {
  if (retried === null) return "";
  if (retried <= 0) return "No unanswered questions were waiting.";
  if (retried >= limit) {
    return `${fmt(retried)} unanswered questions will be tried again, the most at one time; any others are tried the next time a source is published.`;
  }
  return `${fmt(retried)} unanswered question${retried === 1 ? "" : "s"} will be tried again.`;
}

/**
 * The words of the error when a source was published but Niva's unanswered questions could not be queued
 * again (the publish stands). The queue's banner then offers "Try the questions again".
 */
export const NIVA_RETRY_FAILED = "Niva could not try its unanswered questions again";

export function isNivaRetryFailure(error: string | null | undefined): boolean {
  return typeof error === "string" && error.includes(NIVA_RETRY_FAILED);
}

/** The context of that error: `"Timings" was published, but Niva could not try …` (failure() adds the reason). */
export function retryFailedContext(what: string, one: boolean): string {
  return `${what} ${one ? "was" : "were"} published, but ${NIVA_RETRY_FAILED}`;
}

/** `"Timings" published. 3 unanswered questions will be tried again.` */
export function publishedMessage(what: string, retried: number | null, limit = NIVA_AUTO_RETRY_LIMIT): string {
  const tail = retrySentence(retried, limit);
  return tail ? `${what} published. ${tail}` : `${what} published.`;
}

/**
 * What a page publish (or return) did, given how many sections it changed of how many were shown. The
 * phrase is plural unless it is "The one section of …". A section the decision left alone was changed
 * after the queue showed it (so it was not what the approver read), or had already been decided.
 */
export function pageDecisionWhat(changed: number, shown: number, title: string): string {
  if (changed >= shown) return shown === 1 ? `The one section of “${title}”` : `All ${fmt(shown)} sections of “${title}”`;
  const left = shown - changed;
  return `${fmt(changed)} of the ${fmt(shown)} sections of “${title}” (the other ${fmt(left)} ${left === 1 ? "was" : "were"} changed after you opened the queue or no longer waiting; reload the queue to read ${left === 1 ? "it" : "them"} again)`;
}

// ---------------------------------------------------------------------------
// What the approver read: each row's updated_at when its text was shown
// ---------------------------------------------------------------------------

/** A timestamp as PostgREST writes one: "2026-10-01T10:00:00.123456+00:00". */
const DB_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Whole seconds (as epoch milliseconds) and the microseconds after them; Date alone keeps only milliseconds. */
function instantOf(ts: string): { ms: number; micro: number } | null {
  const m = DB_TIMESTAMP.exec(ts);
  if (!m) return null;
  const off = m[4];
  const zone = off === "Z" ? "Z" : off.length === 3 ? `${off}:00` : off.includes(":") ? off : `${off.slice(0, 3)}:${off.slice(3)}`;
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (!Number.isFinite(ms)) return null;
  return { ms, micro: Number((m[3] ?? "").padEnd(6, "0")) };
}

/**
 * A row's updated_at as the queue showed it, checked before it goes into a filter; null when it is not
 * a timestamp. content_items.updated_at moves on every edit (touch_updated_at, 0007), so "updated_at is
 * still what the approver saw" means "the text is still what the approver read".
 */
export function parseSeen(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  return instantOf(s) ? s : null;
}

/** The latest of the timestamps, exactly as written (no precision lost), or null when there is none. */
export function latestTimestamp(list: readonly (string | null | undefined)[]): string | null {
  let best: { ts: string; ms: number; micro: number } | null = null;
  for (const ts of list) {
    const at = ts ? instantOf(ts) : null;
    if (ts && at && (!best || at.ms > best.ms || (at.ms === best.ms && at.micro > best.micro))) best = { ts, ...at };
  }
  return best?.ts ?? null;
}
