import { describe, expect, it } from "vitest";

import { PAGE_KINDS, type CrawlStats, type PageFacts } from "../src/web/site/types";
import { extractPage } from "../src/web/site/extract";
import { buildReport, describeNotes, findContentLeaks, fitBudget, RESULT_BUDGET_BYTES, sizeOf, type OwnReport, type ReferenceReport } from "../src/web/site/report";
import { fixtureHtml, ordinaryPages, SITES, siteBase } from "./site-fixtures";

const stats: CrawlStats = { pages_fetched: 0, pages_in_sitemap: 0, sitemap_used: false, stopped_by: "done", bytes: 0, elapsed_ms: 0, skipped: { robots: 0, off_site: 0, off_site_redirect: 0, files: 0, errors: 0 }, css_files_read: 0 };
const facts = (site: string) => ordinaryPages(site).map((p) => extractPage(p.html, p.url, { isStart: p.path === "/" }));
const report = (site: string, mode: "own" | "reference", css: string[] = []) => buildReport({ mode, startUrl: siteBase(site) + "/", pages: facts(site), css, stats, notes: [] });

/** Every string in a value, with where it is (written here on purpose, apart from the product's own check). */
function strings(v: unknown, path = "$"): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => strings(x, `${path}.${k}`));
  return [];
}

describe("own mode: the organization's own content is kept", () => {
  const r = report("temple", "own") as OwnReport;
  it("keeps text excerpts, image addresses, contact details, menu, palette, fonts and logo candidates", () => {
    expect(r.mode).toBe("own");
    expect(r.organization.name).toBe("Riverbend Hindu Temple");
    expect(r.organization.contact).toMatchObject({ emails: ["office@riverbendtemple.example"], phones: ["(281) 555-0142"] });
    expect(r.organization.social.map((s) => s.network)).toEqual(["facebook", "instagram", "youtube"]);
    const home = r.pages.find((p) => p.kind === "home")!;
    expect(home.sections[0]!.excerpt).toMatch(/A home for worship/);
    expect(home.images.some((i) => i.src === "https://www.riverbendtemple.example/img/hero-temple.jpg" && i.role === "hero")).toBe(true);
    expect(r.look.palette.colors[0]!.hex).toBe("#8c1c13");
    expect(r.look.logo_candidates[0]!.url).toContain("logo-temple.svg");
    expect(r.structure.nav!.top_level_count).toBe(8);
    expect(r.structure.home_pattern).toEqual(["header", "hero", "about", "events", "gallery", "donate", "footer"]);
    expect(r.structure.page_kinds["events"]).toBe(1);
  });
  it("keeps the donate links of the whole site once, most common first", () => {
    expect(r.organization.donate_links.map((d) => d.url)).toContain("https://www.riverbendtemple.example/give");
    expect(new Set(r.organization.donate_links.map((d) => d.url)).size).toBe(r.organization.donate_links.length);
  });
  it("fits the job result well under 400 KB for each of the four sites", () => {
    for (const site of SITES) {
      const o = report(site, "own") as OwnReport;
      expect(sizeOf(o), site).toBeLessThan(RESULT_BUDGET_BYTES);
      expect(o.trimmed).toBe(0);
    }
  });
});

describe("reference mode: layout patterns only (copyright)", () => {
  for (const site of SITES) {
    it(`${site}: the result holds no sentence of the site's text and no image or page address`, () => {
      const r = report(site, "reference") as ReferenceReport;
      expect(r.mode).toBe("reference");
      const all = strings(r);
      for (const [path, s] of all) {
        expect(s.split(/\s+/).filter(Boolean).length, `${path}: ${s}`).toBeLessThan(4);
        expect(s, path).not.toMatch(/:\/\/|^\/\/|www\./i);
        expect(s, path).not.toMatch(/\.(jpe?g|png|gif|webp|svg|avif|ico)\b/i);
        expect(s.length, path).toBeLessThanOrEqual(60);
      }
      // Nothing from the pages themselves: no sentence of any paragraph, no image file name, no menu label, no address, no name.
      const json = JSON.stringify(r).toLowerCase();
      for (const p of ordinaryPages(site)) {
        for (const para of p.html.match(/<(p|li|h[1-6])[^>]*>[^<]{25,}/g) ?? []) {
          const sentence = para.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim().toLowerCase();
          expect(json, `sentence of ${p.file}: ${sentence}`).not.toContain(sentence.slice(0, 25));
        }
        for (const src of p.html.match(/(?:src|href)="[^"]*\.(?:jpg|png|svg)"/g) ?? []) expect(json).not.toContain(src.replace(/^(?:src|href)="/, "").replace(/"$/, "").toLowerCase());
      }
      for (const word of ["@", "555-", "maple ridge", "lotus grove", "water street", "harbor light, me"]) expect(json, word).not.toContain(word);
      expect(findContentLeaks(r)).toEqual([]);
    });
  }
  it("keeps what is useful: section order, menu depth, hero style, palette, font names, density, page kinds", () => {
    const r = report("temple", "reference", [".x{color:#8c1c13}"]) as ReferenceReport;
    expect(r.structure.home_pattern).toEqual(["header", "hero", "about", "events", "gallery", "donate", "footer"]);
    expect(r.structure.nav).toMatchObject({ top_level_count: 8, depth: 2, has_dropdowns: true, mobile_toggle: true, has_cta: true, has_search: true });
    expect(r.structure.nav!.items_by_kind).toMatchObject({ home: 1, about: 1, events: 1, school: 1, news: 1, membership: 1, contact: 1, donate: 1 });
    expect(r.structure.hero).toEqual({ style: "image", has_cta: true, tall: true });
    expect(r.structure.footer).toMatchObject({ columns: 3, has_social: true, has_newsletter: true, has_address: true });
    expect(r.structure.logo).toEqual({ present: true, in_header: true });
    expect(r.look.palette.colors[0]).toMatchObject({ hex: "#8c1c13", role: "primary" });
    expect(r.look.fonts).toEqual({ heading: "Cormorant Garamond", body: "Lato", names: ["Cormorant Garamond", "Lato"] });
    expect(r.density).toMatchObject({ text: expect.stringMatching(/sparse|medium|dense/), imagery: expect.stringMatching(/text-led|balanced|image-led/) });
    expect(Object.keys(r.structure.page_kinds).every((k) => (PAGE_KINDS as readonly string[]).includes(k))).toBe(true);
    expect(r.pages.length).toBe(ordinaryPages("temple").length);
    expect(r.pages.find((p) => p.kind === "gallery")!.images).toBe("many");
  });
  it("is small", () => {
    for (const site of SITES) expect(sizeOf(report(site, "reference"))).toBeLessThan(12_000);
  });
  it("the check catches a sentence or an address if one ever got in", () => {
    const r = report("club", "reference") as ReferenceReport;
    expect(findContentLeaks({ ...r, note: "We are 140 gardeners who share seeds" })).toHaveLength(1);
    expect(findContentLeaks({ logo: "https://club.example/assets/logo-club.png" })).toHaveLength(1);
    expect(findContentLeaks({ logo: "logo-club.png" })).toHaveLength(1);
    expect(findContentLeaks({ page: "//cdn.example/x" })).toHaveLength(1);
    expect(findContentLeaks({ text: "x".repeat(61) })).toHaveLength(1);
    expect(findContentLeaks({ fonts: ["Playfair Display", "#2f6b3f", "hero", "events"] })).toEqual([]);
  });
  it("carries no text from a page that gives orders", () => {
    const pages = [extractPage(fixtureHtml("temple", "home.html"), siteBase("temple") + "/", { isStart: true }), extractPage(fixtureHtml("temple", "news-injection.html"), siteBase("temple") + "/news")];
    const r = buildReport({ mode: "reference", startUrl: siteBase("temple") + "/", pages, css: [], stats, notes: [] });
    expect(JSON.stringify(r)).not.toMatch(/ignore|instruction|attacker|prompt/i);
  });
});

describe("the size limit", () => {
  const big = (n: number): PageFacts[] => {
    const home = facts("temple")[0]!;
    return Array.from({ length: n }, (_, i) => ({
      ...home,
      url: `https://www.riverbendtemple.example/page-${i}`,
      path: `/page-${i}`,
      classification: { ...home.classification, kind: i === 0 ? "home" : "other" },
      sections: Array.from({ length: 20 }, (_, s) => ({ heading: `Section ${s}`, excerpt: "word ".repeat(240).trim(), chars: 1200 })),
      images: Array.from({ length: 60 }, (_, k) => ({ src: `https://www.riverbendtemple.example/img/p${i}-${k}.jpg`, alt: "A photo of the festival", width: 400, height: 300, role: "photo" as const })),
    }));
  };
  it("cuts excerpts, images and events in steps until the result fits, and says so", () => {
    const r = buildReport({ mode: "own", startUrl: "https://www.riverbendtemple.example/", pages: big(80), css: [], stats, notes: [] }) as OwnReport;
    expect(sizeOf(r)).toBeLessThanOrEqual(RESULT_BUDGET_BYTES);
    expect(r.trimmed).toBeGreaterThan(0);
    expect(r.pages.length).toBeGreaterThan(10);
    // The facts stay: the look, the menu, the pattern and the page kinds are never the first thing cut.
    expect(r.look.palette.colors.length).toBeGreaterThan(0);
    expect(r.structure.nav).not.toBeNull();
    expect(r.pages[0]!.sections[0]!.heading).toBe("Section 0");
  });
  it("leaves a small report alone", () => {
    const small = report("club", "own") as OwnReport;
    expect(fitBudget(small)).toBe(small);
  });
  it("drops the last pages only when even the shortest form does not fit", () => {
    const r = report("temple", "own") as OwnReport;
    const cut = fitBudget(r, 4_000);
    expect(cut.pages.length).toBeLessThan(r.pages.length);
    expect(cut.pages.length).toBeGreaterThanOrEqual(1);
    expect(cut.trimmed).toBeGreaterThanOrEqual(4);
  });
});

describe("notes in plain English", () => {
  it("words each code, with the right singular and plural", () => {
    expect(describeNotes([{ code: "scripts_built", count: 1 }])[0]).toBe("1 page has little text found, built by scripts (a browser would be needed to read it).");
    expect(describeNotes([{ code: "scripts_built", count: 3 }])[0]).toMatch(/^3 pages have little text found, built by scripts/);
    expect(describeNotes([{ code: "robots_skipped", count: 2 }, { code: "no_sitemap", count: 1 }, { code: "page_limit", count: 1 }])).toEqual([
      "2 pages were skipped because the site asks robots not to read them.",
      "The site has no sitemap, so its pages were found by following links.",
      "The crawl stopped at the page limit; the site has more pages than were read.",
    ]);
  });
});
