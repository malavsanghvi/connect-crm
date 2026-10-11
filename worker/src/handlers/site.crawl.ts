// site.crawl: read an organization's website (or a site it likes) and report "what we found". B92, phase W1: the first
// step toward drafting a personalised website automatically. Nothing is written to the database here and nothing is
// published; the report is the job's result (app.jobs.result), for the later phases to read.
//
// payload: { start_url, mode: "own" | "reference", max_pages?: 40 (never above 80) }
//   own        the organization's current website: text excerpts, image addresses, contact details, menu, palette,
//              fonts, logo candidates, page kinds. The organization owns this content.
//   reference  a website it likes: layout patterns only (section order, menu depth, hero style, palette, font names,
//              density). Never a sentence of its text or an image or page address (copyright): the report is checked
//              before it is saved, and a report that fails the check is refused.
//
// The pages are read the safe way (worker/src/web/fetch_page.ts, as niva.import_page does): public addresses only,
// robots.txt honoured, redirects re-checked and never allowed to leave the site, timeouts, size caps. No script runs.
// The planner, the extractors and the report are plain functions under worker/src/web/site/ (fixture-tested).

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";
import type { FetchOpts } from "../web/fetch_page";
import { clampPages, crawlSite, CRAWL_LIMITS, type CrawlLimits } from "../web/site/crawl";
import { makeDeps } from "../web/site/deps";
import { findContentLeaks, RESULT_BUDGET_BYTES, sizeOf } from "../web/site/report";
import type { Mode } from "../web/site/types";

export const kind = "site.crawl";
/** Two crawls at once at most: each one is a slow, polite, one-request-at-a-time read of somebody's website. */
export const maxInFlight = 2;

export async function run(job: Job, ctx: JobContext, limits: CrawlLimits = CRAWL_LIMITS) {
  const p = job.payload ?? {};
  const startUrl = typeof p.start_url === "string" ? p.start_url.trim() : "";
  if (!startUrl) throw new PermanentError("The crawl does not say which website to read.");
  const mode = p.mode;
  if (mode !== "own" && mode !== "reference") throw new PermanentError('The crawl must say whether this is the organization\'s own website ("own") or one it likes ("reference").');
  if (!job.center_id) throw new PermanentError("The crawl does not say which community it is for.");

  const base: FetchOpts = { allowPrivate: ctx.env.NIVA_IMPORT_ALLOW_PRIVATE === "1" };
  const { report, stats } = await crawlSite(makeDeps(ctx.http, base, limits), { start_url: startUrl, mode: mode as Mode, max_pages: clampPages(p.max_pages) });

  // Copyright check, last thing before saving: a reference report carries no text and no addresses.
  if (report.mode === "reference") {
    const leaks = findContentLeaks(report);
    if (leaks.length > 0) {
      ctx.log.error("site crawl: reference report held page content, not saved", { count: leaks.length });
      throw new PermanentError("The report on the reference website held text or addresses from it, so it was not saved. Nothing was kept.");
    }
  }
  if (sizeOf(report) > RESULT_BUDGET_BYTES + 20_000) throw new PermanentError("The report is larger than the job result allows.");

  ctx.log.info("site crawled", { site: report.site, mode, pages: stats.pages_fetched, in_sitemap: stats.pages_in_sitemap, stopped_by: stats.stopped_by, bytes: stats.bytes, elapsed_ms: stats.elapsed_ms });
  return report;
}
