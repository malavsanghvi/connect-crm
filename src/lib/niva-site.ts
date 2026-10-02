// Content › Niva › Find a website's pages (B20, migration 0576): the plain helpers behind
// src/app/(app)/content/niva/discover-form.tsx, kept free of React and Supabase so they are tested
// (tests/niva-site.test.ts).
//
// The background service reads a site's sitemap (worker/src/handlers/niva.discover_site.ts) and saves
// the list in app.niva_site_pages; app.niva_discovery_status returns the latest search and that list.
// Staff tick the pages Niva should learn from and they are queued 50 at a time through
// app.niva_import_pages, whose sections still arrive as drafts for the approval queue.

/** app.niva_import_pages takes at most 50 addresses per call. */
export const IMPORT_BATCH = 50;

/**
 * app.niva_discover_site lets a new search start once the last one was queued this long ago and never finished
 * (the background service was down); the screen stops waiting for it at the same point.
 */
export const DISCOVERY_STALE_MS = 15 * 60_000;

export type SiteJob = {
  id: number;
  url: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  result: Record<string, unknown> | null;
  createdAt: string | null;
  finishedAt: string | null;
};

export type SitePage = {
  url: string;
  lastmod: string | null;
  /** Sections Niva has from this page (any form of its address), retired ones aside. */
  sections: number;
  /** Of those, published: what Niva answers from. */
  included: number;
  /** In review or published sections whose text the page has changed since (metadata.page_changed). */
  changed: number;
  /** In review or published sections the page no longer has (metadata.orphaned): Niva may still answer from them. */
  orphaned: number;
  /** Up to 5 titles of each, to find them under Sources. */
  changedTitles: string[];
  orphanedTitles: string[];
  importedAt: string | null;
  importStatus: string | null;
  importError: string | null;
};

export type DiscoveryStatus = { job: SiteJob | null; pages: SitePage[] };

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}
function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** app.niva_discovery_status's answer, or null when it is not the shape this screen expects. */
export function parseDiscoveryStatus(data: unknown): DiscoveryStatus | null {
  const root = rec(data);
  if (!root || !Array.isArray(root.pages)) return null;
  const j = rec(root.job);
  const job: SiteJob | null =
    j && str(j.status)
      ? {
          id: num(j.id),
          url: str(j.url) ?? "",
          status: str(j.status)!,
          attempts: num(j.attempts),
          maxAttempts: num(j.max_attempts),
          lastError: str(j.last_error),
          result: rec(j.result),
          createdAt: str(j.created_at),
          finishedAt: str(j.finished_at),
        }
      : null;
  const pages: SitePage[] = [];
  for (const raw of root.pages) {
    const p = rec(raw);
    const url = p ? str(p.url) : null;
    if (!p || !url) continue;
    pages.push({
      url,
      lastmod: str(p.lastmod),
      sections: num(p.sections),
      included: num(p.included),
      changed: num(p.changed),
      orphaned: num(p.orphaned),
      changedTitles: strs(p.changed_titles),
      orphanedTitles: strs(p.orphaned_titles),
      importedAt: str(p.imported_at),
      importStatus: str(p.import_status),
      importError: str(p.import_error),
    });
  }
  return { job, pages };
}

/**
 * A search that was queued more than 15 minutes ago and is still not finished: the background service never got
 * to it (or stopped). The database lets a new search start then, so the screen does too.
 */
export function discoveryStale(job: SiteJob | null, now: Date = new Date()): boolean {
  if (job === null || (job.status !== "queued" && job.status !== "running") || !job.createdAt) return false;
  const created = Date.parse(job.createdAt);
  return Number.isFinite(created) && now.getTime() - created >= DISCOVERY_STALE_MS;
}

/** Whether the latest search is still on its way (the screen keeps checking). */
export function discoveryBusy(job: SiteJob | null, now: Date = new Date()): boolean {
  return job !== null && (job.status === "queued" || job.status === "running") && !discoveryStale(job, now);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The latest search, in plain English. */
export function discoveryJobLine(job: SiteJob | null, now: Date = new Date()): { tone: "ok" | "warn" | "bad"; label: string; detail: string } | null {
  if (!job) return null;
  if (discoveryStale(job, now)) {
    return job.status === "queued" && job.attempts === 0
      ? {
          tone: "bad",
          label: "Not started",
          detail: `The background service has not picked up the search for ${job.url}. Ask an administrator to check Settings › Integrations › Background service, then press Find pages again.`,
        }
      : { tone: "bad", label: "Did not finish", detail: `The search for ${job.url} has not finished after 15 minutes. Press Find pages to start it again.` };
  }
  if (job.status === "running") return { tone: "warn", label: "Looking…", detail: `Reading ${job.url}'s sitemap.` };
  if (job.status === "queued" && job.attempts > 0) {
    return { tone: "warn", label: "Will try again", detail: job.lastError ?? "The last try did not finish; the background service tries again shortly." };
  }
  if (job.status === "queued") return { tone: "warn", label: "Waiting", detail: `Niva will look at ${job.url} in a moment.` };
  if (job.status === "failed") return { tone: "bad", label: "Could not list the pages", detail: job.lastError ?? "The website could not be read." };
  if (job.status === "done") {
    const r = job.result ?? {};
    const found = num(r.found ?? r.pages);
    const sitemaps = Array.isArray(r.sitemaps) ? r.sitemaps.length : 0;
    const parts = [`${plural(found, "page")} found${sitemaps ? ` in ${plural(sitemaps, "sitemap")}` : ""}`];
    if (r.truncated === true) parts.push("the sitemap lists more; the first 500 are shown");
    const removed = num(r.removed);
    if (removed > 0) parts.push(`${plural(removed, "page")} the sitemap no longer lists left the list`);
    // An incomplete search (worker niva.discover_site): say what is missing, and that nothing was taken off the list.
    const unreadable = num(r.unreadable);
    const tooBig = num(r.too_big);
    const missing: string[] = [];
    if (unreadable > 0) missing.push(`${plural(unreadable, "sitemap")} could not be read right now`);
    if (r.stopped === true) missing.push("Niva stopped after reading as many sitemaps as one search may");
    if (tooBig > 0) missing.push(`${plural(tooBig, "sitemap")} larger than 5 MB ${tooBig === 1 ? "was" : "were"} not read`);
    if (missing.length > 0) {
      const kept = r.complete === false ? " Pages already on the list were kept." : "";
      const again = unreadable > 0 ? " Press Find pages again later to complete the list." : "";
      return { tone: "warn", label: "Done, list incomplete", detail: `${parts.join(" · ")} · ${missing.join(" · ")}. Some pages may be missing.${kept}${again}` };
    }
    return { tone: "ok", label: "Done", detail: parts.join(" · ") };
  }
  return { tone: "warn", label: job.status, detail: "" };
}

/** What Niva already has from one listed page, in plain English. */
export function sitePageLine(p: SitePage): { tone: "ok" | "warn" | "bad" | "muted"; label: string; detail?: string } {
  if (p.importStatus === "running") return { tone: "warn", label: "Reading…" };
  if (p.importStatus === "queued") return p.importError ? { tone: "warn", label: "Will try again", detail: p.importError } : { tone: "warn", label: "Import waiting" };
  if (p.importStatus === "failed") return { tone: "bad", label: "Could not import", detail: p.importError ?? undefined };
  if (p.sections === 0) return { tone: "muted", label: "Not imported" };
  // Sections in review or published keep their text when the page changes; a person decides. Name them, and say
  // where to act: open the page to compare, then edit (or retire) the section under Sources.
  if (p.changed > 0 || p.orphaned > 0) {
    const labels: string[] = [];
    const named: string[] = [];
    if (p.changed > 0) {
      labels.push(`${plural(p.changed, "section")} in review or published ${p.changed === 1 ? "differs" : "differ"} from the page now`);
      named.push(`Changed: ${titleList(p.changedTitles, p.changed)}.`);
    }
    if (p.orphaned > 0) {
      labels.push(`${plural(p.orphaned, "section")} in review or published ${p.orphaned === 1 ? "is" : "are"} no longer on the page`);
      named.push(`No longer on the page: ${titleList(p.orphanedTitles, p.orphaned)}.`);
    }
    return {
      tone: "warn",
      label: labels.join(" · "),
      detail: `${named.join(" ")} Niva still answers from their approved text. Open the page to compare, then edit or retire them under Sources.`,
    };
  }
  if (p.included > 0) return { tone: "ok", label: `${p.included} of ${plural(p.sections, "section")} included` };
  return { tone: "muted", label: `${plural(p.sections, "section")}, none included yet` };
}

/** "“A”, “B” and 3 more": the titles the status sends (at most 5) and how many there are in all. */
function titleList(titles: readonly string[], count: number): string {
  if (titles.length === 0) return plural(count, "section");
  const shown = titles.map((t) => `“${t}”`).join(", ");
  return count > titles.length ? `${shown} and ${count - titles.length} more` : shown;
}

/**
 * Why a page is left unticked at first, or null. Copies, old versions, members-only and legal pages, event
 * pages (their dates go out of date) and pages named after a past year rarely hold what members ask Niva.
 * Staff can still tick any of them.
 */
export function junkReason(url: string, now: Date = new Date()): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname).toLowerCase();
  } catch {
    return "Not a web page address";
  }
  const segs = path.split("/").filter(Boolean);
  const any = (re: RegExp) => segs.some((s) => re.test(s));
  if (any(/^copy-of-/)) return "A copy of another page";
  if (any(/(^|-)old$/) || any(/^old-/)) return "An old version of a page";
  if (any(/^members?-(area|only|login)$|^(login|log-in|sign-?in|account|my-account)$/)) return "Members-only area";
  if (any(/privacy/)) return "Privacy policy";
  if (any(/^terms|terms-(of|and)-|-terms$/)) return "Terms of use";
  if (any(/^cookie/)) return "Cookie policy";
  if (any(/^event-details$|^event-info$|^events?$/) && segs.length > 1) return "An event page: its dates go out of date";
  const year = now.getUTCFullYear();
  for (const m of path.matchAll(/(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/g)) {
    const y = Number(m[1]);
    if (y < year - 1) return `Named after ${y}: probably out of date`;
  }
  return null;
}

/** Split the chosen pages into calls of at most 50. */
export function importBatches<T>(items: readonly T[], size: number = IMPORT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The address without "https://" and a leading "www.", for a compact list. */
export function shortAddress(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "") || url;
}
