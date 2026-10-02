import { describe, expect, it } from "vitest";

import {
  IMPORT_BATCH,
  discoveryBusy,
  discoveryJobLine,
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
    { url: "https://www.jainsocietyhouston.org/relocationfaq", lastmod: "2026-09-18T00:00:00+00:00", discovered_at: "2026-10-02T14:00:20Z", sections: 2, included: 1, changed: 0, imported_at: "2026-09-30T12:00:00Z", import_status: "done", import_error: null },
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
  importedAt: null,
  importStatus: null,
  importError: null,
  ...over,
});

describe("parseDiscoveryStatus", () => {
  it("reads the latest search and the list, skipping rows without an address", () => {
    const s = parseDiscoveryStatus(STATUS)!;
    expect(s.job).toMatchObject({ id: 41, status: "done", maxAttempts: 3, lastError: null, finishedAt: "2026-10-02T14:00:20Z" });
    expect(s.pages).toHaveLength(2);
    expect(s.pages[0]).toEqual({
      url: "https://www.jainsocietyhouston.org/relocationfaq",
      lastmod: "2026-09-18T00:00:00+00:00",
      sections: 2,
      included: 1,
      changed: 0,
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
    expect(discoveryJobLine(job)).toEqual({ tone: "ok", label: "Done", detail: "48 pages found in 2 sitemaps" });
    expect(discoveryJobLine({ ...job, result: { found: 500, sitemaps: ["x"], truncated: true, removed: 3 } })!.detail).toBe(
      "500 pages found in 1 sitemap · the sitemap lists more; the first 500 are shown · 3 pages the sitemap no longer lists left the list",
    );
    expect(discoveryJobLine(null)).toBeNull();
  });
  it("tells waiting, looking, trying again and failing apart", () => {
    expect(discoveryJobLine({ ...job, status: "queued", attempts: 0 })).toMatchObject({ tone: "warn", label: "Waiting" });
    expect(discoveryJobLine({ ...job, status: "running" })).toMatchObject({ tone: "warn", label: "Looking…" });
    expect(discoveryJobLine({ ...job, status: "queued", attempts: 1, lastError: "Could not read www.example.org's sitemap right now (/sitemap.xml answered 503); it will be tried again." })).toMatchObject({
      label: "Will try again",
      detail: expect.stringContaining("answered 503"),
    });
    expect(discoveryJobLine({ ...job, status: "failed", lastError: "No sitemap was found on example.org." })).toEqual({ tone: "bad", label: "Could not list the pages", detail: "No sitemap was found on example.org." });
    expect(discoveryBusy({ ...job, status: "queued" })).toBe(true);
    expect(discoveryBusy({ ...job, status: "running" })).toBe(true);
    expect(discoveryBusy(job)).toBe(false);
    expect(discoveryBusy(null)).toBe(false);
  });
});

describe("sitePageLine", () => {
  it("says what Niva already has from a page", () => {
    expect(sitePageLine(page())).toEqual({ tone: "muted", label: "Not imported" });
    expect(sitePageLine(page({ sections: 3 }))).toEqual({ tone: "muted", label: "3 sections, none included yet" });
    expect(sitePageLine(page({ sections: 3, included: 2 }))).toEqual({ tone: "ok", label: "2 of 3 sections included" });
    expect(sitePageLine(page({ sections: 3, included: 3, changed: 1 }))).toMatchObject({ tone: "warn", label: "1 approved section changed on the page" });
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
