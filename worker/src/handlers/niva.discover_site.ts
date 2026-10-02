// niva.discover_site: list a website's pages from its sitemap, so content staff can choose which ones Niva
// learns from (Content › Niva › Find a website's pages). Queued by app.niva_discover_site with { url }.
// The site's robots.txt and sitemaps are read safely (worker/src/web/sitemap.ts) and the list is saved
// through app.niva_worker_save_discovery into app.niva_site_pages (0576), which content staff read.
// When some of the site's sitemaps cannot be read right now, the search is tried again; on its last try (or
// when it stopped at its limits) the list is saved as incomplete, so pages already listed are not removed,
// and the result says how many sitemaps were missed (shown on the screen, src/lib/niva-site.ts).
// Nothing is imported here: staff tick the pages they want and those are queued as niva.import_page jobs,
// whose sections still arrive as drafts for the approval queue.

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";
import { discoverPages } from "../web/sitemap";

export const kind = "niva.discover_site";

export async function run(job: Job, ctx: JobContext) {
  const url = typeof job.payload?.url === "string" ? job.payload.url.trim() : "";
  if (!url) throw new PermanentError("The search does not say which website to look at.");
  if (!job.center_id) throw new PermanentError("The search does not say which community it is for.");

  const found = await discoverPages(ctx.http, url, { allowPrivate: ctx.env.NIVA_IMPORT_ALLOW_PRIVATE === "1" });
  const unreadable = found.unreadable.length;
  // Some sitemaps could not be read right now while others could: try the whole search again while tries are left,
  // rather than saving a list that quietly misses their pages.
  if (unreadable > 0 && job.attempts < job.max_attempts) {
    throw new Error(
      `Could not read ${unreadable} of ${new URL(found.root).hostname}'s sitemaps right now (${found.unreadable[0]}); the search will be tried again.`,
    );
  }
  // On the last try, or when the search stopped at its limits, the list is saved as incomplete: pages already on it
  // that this search did not see are kept, not removed.
  const complete = unreadable === 0 && !found.stopped;
  const rows = await ctx.db.query<{ r: Record<string, unknown> }>("select app.niva_worker_save_discovery($1::uuid, $2, $3::jsonb, $4::boolean) as r", [
    job.center_id,
    found.root,
    JSON.stringify(found.pages),
    complete,
  ]);
  const saved = rows[0]?.r ?? {};
  ctx.log.info("niva site pages found", {
    site: found.site,
    pages: found.pages.length,
    sitemaps: found.sitemaps.length,
    truncated: found.truncated,
    unreadable,
    stopped: found.stopped,
  });
  return {
    url,
    root: found.root,
    sitemaps: found.sitemaps,
    found: found.pages.length,
    truncated: found.truncated,
    skipped: found.skipped,
    complete,
    unreadable,
    ...(unreadable > 0 ? { unreadable_detail: found.unreadable.slice(0, 3) } : {}),
    stopped: found.stopped,
    too_big: found.tooBig,
    ...saved,
  };
}
