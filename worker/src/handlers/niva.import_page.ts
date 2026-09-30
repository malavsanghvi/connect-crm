// niva.import_page: read one public web page and save it as DRAFT Niva sources.
// Queued by app.niva_import_pages (Content › Niva › Import from a web page) with { url }.
// The page is fetched safely (worker/src/web/fetch_page.ts), reduced to readable text and
// split into sections (worker/src/web/page_text.ts), and saved through
// app.niva_worker_save_import as draft niva_source items carrying their page address.
// Nothing is published here: an administrator still approves each section in the
// approval queue, and Niva answers only from approved ones. Running it again for the
// same page refreshes its draft sections and leaves approved ones untouched.

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";
import { fetchPage } from "../web/fetch_page";
import { htmlToBlocks, sectionize } from "../web/page_text";

export const kind = "niva.import_page";

export async function run(job: Job, ctx: JobContext) {
  const url = typeof job.payload?.url === "string" ? job.payload.url.trim() : "";
  if (!url) throw new PermanentError("The import job does not say which web page to read.");
  if (!job.center_id) throw new PermanentError("The import job does not say which community it is for.");

  const { html, finalUrl } = await fetchPage(ctx.http, url, { allowPrivate: ctx.env.NIVA_IMPORT_ALLOW_PRIVATE === "1" });
  const page = htmlToBlocks(html);
  const { pageTitle, sections, truncated, chars } = sectionize(page);
  if (sections.length === 0) {
    throw new PermanentError(`No readable text was found on ${url}. The page may be built with scripts the importer cannot run, or be mostly images; paste its text in by hand instead.`);
  }

  const rows = await ctx.db.query<{ r: Record<string, unknown> }>("select app.niva_worker_save_import($1::uuid, $2, $3, $4::jsonb, $5::uuid) as r", [
    job.center_id,
    url,
    pageTitle,
    JSON.stringify(sections),
    job.created_by,
  ]);
  const saved = rows[0]?.r ?? {};
  ctx.log.info("niva page imported", { url, sections: sections.length, chars, truncated });
  return { url, ...(finalUrl !== url ? { final_url: finalUrl } : {}), page_title: pageTitle, chars, truncated, ...saved };
}
