// niva.discover_site: list a website's pages from its sitemap, so content staff can choose which ones Niva
// learns from (Content › Niva › Find a website's pages). Queued by app.niva_discover_site with { url }.
// The site's robots.txt and sitemaps are read safely (worker/src/web/sitemap.ts) and the list is saved
// through app.niva_worker_save_discovery into app.niva_site_pages (0576), which content staff read.
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
  const rows = await ctx.db.query<{ r: Record<string, unknown> }>("select app.niva_worker_save_discovery($1::uuid, $2, $3::jsonb) as r", [
    job.center_id,
    found.root,
    JSON.stringify(found.pages),
  ]);
  const saved = rows[0]?.r ?? {};
  ctx.log.info("niva site pages found", { site: found.site, pages: found.pages.length, sitemaps: found.sitemaps.length, truncated: found.truncated });
  return {
    url,
    root: found.root,
    sitemaps: found.sitemaps,
    found: found.pages.length,
    truncated: found.truncated,
    skipped: found.skipped,
    ...saved,
  };
}
