// The crawl planner's real network, built from the worker's safe fetcher (worker/src/web/fetch_page.ts): public
// addresses only, every redirect re-checked, timeouts and one retry per request. The handler and the tests use the
// same wiring; the tests only swap the Http underneath.

import type { Http } from "../../http";
import { assertPublicPage, get, readRobots, type FetchOpts } from "../fetch_page";
import { discoverPages, siteOf } from "../sitemap";
import { OffSiteRedirect, type CrawlDeps, type CrawlLimits } from "./crawl";

/** A smaller budget than the "find a website's pages" search: the sitemap is only the start of a crawl. */
export const CRAWL_DISCOVERY = { fetches: 8, bytes: 10 * 1024 * 1024, deadlineMs: 60_000 };

export function makeDeps(http: Http, base: FetchOpts, limits: CrawlLimits): CrawlDeps {
  const sameSite = (from: URL, to: URL) => {
    if (siteOf(to.toString()) !== siteOf(from.toString())) throw new OffSiteRedirect(to);
  };
  return {
    assertPublic: (raw) => assertPublicPage(raw, base),
    readRobots: (u) => readRobots(http, u, base),
    discover: (u) => discoverPages(http, u, base, { ...CRAWL_DISCOVERY, now: limits.now }),
    getPage: (u, guard) => get(http, u, "text/html, application/xhtml+xml;q=0.9, */*;q=0.1", { ...base, beforeRedirect: guard }),
    getCss: (u) => get(http, u, "text/css, */*;q=0.1", { ...base, beforeRedirect: sameSite }),
    limits,
  };
}
