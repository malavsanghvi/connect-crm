import { describe, expect, it } from "vitest";

import {
  DISCOVERY_STALE_MS,
  IMPORT_BATCH,
  discoveryBusy,
  discoveryJobLine,
  discoveryStale,
  importBatches,
  junkReason,
  parseDiscoveryStatus,
  shortAddress,
  sitePageLine,
  type SitePage,
} from "@/lib/niva-site";

// app.niva_discovery_status (0576) as the database returns it.
const STATUS = {
  job: {
    id: 41,
    url: "https://www.jainsocietyhouston.org",
    status: "done",
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    result: { found: 48, sitemaps: ["https://www.jainsocietyhouston.org/sitemap.xml", "https://www.jainsocietyhouston.org/pages-sitemap.xml"], removed: 0, truncated: false },
    created_at: "2026-10-02T14:00:00Z",
    finished_at: "2026-10-02T14:00:20Z",
  },
  pages: [
    {
      url: "https://www.jainsocietyhouston.org/relocationfaq",
      lastmod: "2026-09-18T05:00:00+00:00",
      discovered_at: "2026-10-02T14:00:20Z",
      sections: 2,
      included: 1,
      changed: 1,
      orphaned: 0,
      changed_titles: ["JSH Relocation FAQs", 7],
      orphaned_titles: [],
      imported_at: "2026-09-30T12:00:00Z",
      import_status: "done",
      import_error: null,
    },
    { url: "https://www.jainsocietyhouston.org/copy-of-about-us", lastmod: null, sections: 0, included: 0, changed: 0, imported_at: null, import_status: null, import_error: null },
    { nope: true },
  ],
};

const page = (over: Partial<SitePage> = {}): SitePage => ({
  url: "https://www.example.org/a",
  lastmod: null,
  sections: 0,
  included: 0,
  changed: 0,
  orphaned: 0,
  changedTitles: [],
  orphanedTitles: [],
  importedAt: null,
  importStatus: null,
  importError: null,
  ...over,
});
// A minute after the search in STATUS was queued.
const NOW = new Date("2026-10-02T14:01:00Z");

describe("parseDiscoveryStatus", () => {
  it("reads the latest search and the list, skipping rows without an address", () => {
    const s = parseDiscoveryStatus(STATUS)!;
    expect(s.job).toMatchObject({ id: 41, status: "done", maxAttempts: 3, lastError: null, finishedAt: "2026-10-02T14:00:20Z" });
    expect(s.pages).toHaveLength(2);
    expect(s.pages[0]).toEqual({
      url: "https://www.jainsocietyhouston.org/relocationfaq",
      lastmod: "2026-09-18T05:00:00+00:00",
      sections: 2,
      included: 1,
      changed: 1,
      orphaned: 0,
      changedTitles: ["JSH Relocation FAQs"],
      orphanedTitles: [],
      importedAt: "2026-09-30T12:00:00Z",
      importStatus: "done",
      importError: null,
    });
  });
  it("reads a community that never searched, and refuses a shape it does not know", () => {
    expect(parseDiscoveryStatus({ job: null, pages: [] })).toEqual({ job: null, pages: [] });
    expect(parseDiscoveryStatus(null)).toBeNull();
    expect(parseDiscoveryStatus({ job: null })).toBeNull();
    expect(parseDiscoveryStatus([])).toBeNull();
  });
});

describe("discoveryJobLine / discoveryBusy", () => {
  const job = parseDiscoveryStatus(STATUS)!.job!;
  it("says what the latest search did, in plain English", () => {
    expect(discoveryJobLine(job, NOW)).toEqual({ tone: "ok", label: "Done", detail: "48 pages found in 2 sitemaps" });
    expect(discoveryJobLine({ ...job, result: { found: 500, sitemaps: ["x"], truncated: true, removed: 3 } }, NOW)!.detail).toBe(
      "500 pages found in 1 sitemap · the sitemap lists more; the first 500 are shown · 3 pages the sitemap no longer lists left the list",
    );
    expect(discoveryJobLine(null)).toBeNull();
  });
  it("says plainly when the list is incomplete: sitemaps unreadable right now, a search that hit its limits, a sitemap too big", () => {
    const partial = discoveryJobLine({ ...job, result: { found: 30, sitemaps: ["a", "b"], complete: false, unreadable: 1, stopped: false, too_big: 0, removed: 0 } }, NOW)!;
    expect(partial).toEqual({
      tone: "warn",
      label: "Done, list incomplete",
      detail:
        "30 pages found in 2 sitemaps · 1 sitemap could not be read right now. Some pages may be missing. Pages already on the list were kept. Press Find pages again later to complete the list.",
    });
    const limited = discoveryJobLine({ ...job, result: { found: 480, sitemaps: ["a"], complete: false, unreadable: 0, stopped: true, too_big: 2 } }, NOW)!;
    expect(limited.tone).toBe("warn");
    expect(limited.detail).toBe(
      "480 pages found in 1 sitemap · Niva stopped after reading as many sitemaps as one search may · 2 sitemaps larger than 5 MB were not read. Some pages may be missing. Pages already on the list were kept.",
    );
  });
  it("tells waiting, looking, trying again and failing apart", () => {
    expect(discoveryJobLine({ ...job, status: "queued", attempts: 0 }, NOW)).toMatchObject({ tone: "warn", label: "Waiting" });
    expect(discoveryJobLine({ ...job, status: "running" }, NOW)).toMatchObject({ tone: "warn", label: "Looking…" });
    expect(
      discoveryJobLine({ ...job, status: "queued", attempts: 1, lastError: "Could not read www.example.org's sitemap right now (/sitemap.xml answered 503); it will be tried again." }, NOW),
    ).toMatchObject({
      label: "Will try again",
      detail: expect.stringContaining("answered 503"),
    });
    expect(discoveryJobLine({ ...job, status: "failed", lastError: "No sitemap was found on example.org." }, NOW)).toEqual({ tone: "bad", label: "Could not list the pages", detail: "No sitemap was found on example.org." });
    expect(discoveryBusy({ ...job, status: "queued" }, NOW)).toBe(true);
    expect(discoveryBusy({ ...job, status: "running" }, NOW)).toBe(true);
    expect(discoveryBusy(job, NOW)).toBe(false);
    expect(discoveryBusy(null, NOW)).toBe(false);
  });
  it("stops waiting for a search the background service never picked up, and says what to do", () => {
    const later = new Date(Date.parse("2026-10-02T14:00:00Z") + DISCOVERY_STALE_MS);
    const waiting = { ...job, status: "queued", attempts: 0 };
    expect(discoveryStale(waiting, NOW)).toBe(false);
    expect(discoveryStale(waiting, later)).toBe(true);
    // Find pages works again (the database lets a new search start after the same 15 minutes) and polling stops.
    expect(discoveryBusy(waiting, later)).toBe(false);
    expect(discoveryJobLine(waiting, later)).toEqual({
      tone: "bad",
      label: "Not started",
      detail:
        "The background service has not picked up the search for https://www.jainsocietyhouston.org. Ask an administrator to check Settings › Integrations › Background service, then press Find pages again.",
    });
    expect(discoveryJobLine({ ...job, status: "running" }, later)).toMatchObject({ tone: "bad", label: "Did not finish" });
    // A finished search is never stale.
    expect(discoveryStale(job, later)).toBe(false);
    expect(discoveryJobLine(job, later)).toMatchObject({ label: "Done" });
  });
});

describe("sitePageLine", () => {
  it("says what Niva already has from a page", () => {
    expect(sitePageLine(page())).toEqual({ tone: "muted", label: "Not imported" });
    expect(sitePageLine(page({ sections: 3 }))).toEqual({ tone: "muted", label: "3 sections, none included yet" });
    expect(sitePageLine(page({ sections: 3, included: 2 }))).toEqual({ tone: "ok", label: "2 of 3 sections included" });
  });
  it("names the sections in review or published that the page changed or dropped, and says where to act", () => {
    expect(sitePageLine(page({ sections: 3, included: 3, changed: 1, changedTitles: ["About: Timings"] }))).toEqual({
      tone: "warn",
      label: "1 section in review or published differs from the page now",
      detail: "Changed: “About: Timings”. Niva still answers from their approved text. Open the page to compare, then edit or retire them under Sources.",
    });
    const both = sitePageLine(page({ sections: 9, included: 9, changed: 7, changedTitles: ["A", "B", "C", "D", "E"], orphaned: 1, orphanedTitles: ["F"] }));
    expect(both.label).toBe("7 sections in review or published differ from the page now · 1 section in review or published is no longer on the page");
    expect(both.detail).toBe(
      "Changed: “A”, “B”, “C”, “D”, “E” and 2 more. No longer on the page: “F”. Niva still answers from their approved text. Open the page to compare, then edit or retire them under Sources.",
    );
    expect(sitePageLine(page({ sections: 2, included: 2, orphaned: 2 })).detail).toMatch(/^No longer on the page: 2 sections\./);
  });
  it("shows an import on its way or one that failed, with the reason", () => {
    expect(sitePageLine(page({ importStatus: "queued" }))).toEqual({ tone: "warn", label: "Import waiting" });
    expect(sitePageLine(page({ importStatus: "queued", importError: "The website answered 502." }))).toEqual({ tone: "warn", label: "Will try again", detail: "The website answered 502." });
    expect(sitePageLine(page({ importStatus: "running", sections: 2 }))).toEqual({ tone: "warn", label: "Reading…" });
    expect(sitePageLine(page({ importStatus: "failed", importError: "The page was not found (the website answered 404). Check the address." }))).toMatchObject({ tone: "bad", label: "Could not import" });
  });
});

describe("junkReason", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  it("leaves copies, old versions, members-only, legal, event and past-year pages unticked", () => {
    const W = "https://www.jainsocietyhouston.org";
    expect(junkReason(`${W}/copy-of-pathshala`, now)).toBe("A copy of another page");
    expect(junkReason(`${W}/pathshala-old`, now)).toBe("An old version of a page");
    expect(junkReason(`${W}/old-home`, now)).toBe("An old version of a page");
    expect(junkReason(`${W}/members-area/my-account`, now)).toBe("Members-only area");
    expect(junkReason(`${W}/account/login`, now)).toBe("Members-only area");
    expect(junkReason(`${W}/privacy-policy`, now)).toBe("Privacy policy");
    expect(junkReason(`${W}/terms-and-conditions`, now)).toBe("Terms of use");
    expect(junkReason(`${W}/event-details/diwali-celebration`, now)).toBe("An event page: its dates go out of date");
    expect(junkReason(`${W}/decoration2015`, now)).toBe("Named after 2015: probably out of date");
  });
  it("keeps ordinary pages ticked, this year's and last year's included", () => {
    const W = "https://www.jainsocietyhouston.org";
    for (const p of ["", "/relocationfaq", "/newtohouston", "/pathshala", "/events", "/paryushan-2026", "/annual-report-2025", "/folder/oldest-traditions", "/membership"]) {
      expect(junkReason(`${W}${p}`, now)).toBeNull();
    }
    expect(junkReason("not an address", now)).toBe("Not a web page address");
  });
});

describe("importBatches / shortAddress", () => {
  it("sends the chosen pages 50 at a time", () => {
    const urls = Array.from({ length: 123 }, (_, i) => `https://e.org/p${i}`);
    const b = importBatches(urls);
    expect(IMPORT_BATCH).toBe(50);
    expect(b.map((x) => x.length)).toEqual([50, 50, 23]);
    expect(b.flat()).toEqual(urls);
    expect(importBatches([])).toEqual([]);
  });
  it("writes an address compactly", () => {
    expect(shortAddress("https://www.jainsocietyhouston.org/relocationfaq")).toBe("jainsocietyhouston.org/relocationfaq");
    expect(shortAddress("http://example.org")).toBe("example.org");
  });
});
