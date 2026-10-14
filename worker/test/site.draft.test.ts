// The first draft of a website (B92 W3, src/lib/site-draft) on the four invented websites of test/fixtures/sites, read by the real extractors
// and report builder of this service, with made-up Weaver records. The shared helpers are in tests/fixtures/site-draft.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CRAWL_BLOCK_KINDS, CRAWL_PAGE_KINDS, readOwnCrawl, readReferenceHints, type OwnCrawl, type ReferenceHints } from "../../src/lib/site-draft/crawl";
import { generateDraft } from "../../src/lib/site-draft/generate";
import { parseContent, parseTheme } from "../../src/lib/site-draft/parse";
import { contrast } from "../../src/lib/site-draft/theme";
import { MAX_BLOCKS_PER_PAGE, MAX_PAGES } from "../../src/lib/site-draft/types";
import { NO_EVENTS, STAND_IN, ownWordsOf } from "../../src/lib/site-draft/wording";
import { MONTHS, FAITH, CHAMBER, SECULAR, JAIN, JAIN_WORDS, KIND_OF, blocksOf, emptyWeaver, readable, shingles, squash, weaver, weaverJson } from "../../tests/fixtures/site-draft";
import { extractPage } from "../src/web/site/extract";
import { buildReport, type OwnReport, type ReferenceReport } from "../src/web/site/report";
import { BLOCK_KINDS, PAGE_KINDS, type CrawlStats } from "../src/web/site/types";
import { fixtureFiles, fixtureHtml, ordinaryPages, SITES, siteBase } from "./site-fixtures";

import type { KindProfile } from "../../src/lib/kind";

// ── The four invented websites, read the way the background service reads them ───────────────────────────────────
const stats: CrawlStats = { pages_fetched: 0, pages_in_sitemap: 0, sitemap_used: false, stopped_by: "done", bytes: 0, elapsed_ms: 0, skipped: { robots: 0, off_site: 0, off_site_redirect: 0, files: 0, errors: 0 }, css_files_read: 0 };
const result = (site: string, mode: "own" | "reference"): OwnReport | ReferenceReport =>
  buildReport({ mode, startUrl: siteBase(site) + "/", pages: ordinaryPages(site).map((p) => extractPage(p.html, p.url, { isStart: p.path === "/" })), css: [], stats, notes: [] }) as OwnReport | ReferenceReport;
const ownOf = (site: string): OwnCrawl => readOwnCrawl(JSON.parse(JSON.stringify(result(site, "own"))))!;
const hintsOf = (site: string): ReferenceHints => readReferenceHints(JSON.parse(JSON.stringify(result(site, "reference"))))!;

const pageText = (site: string): string => fixtureFiles(site).filter((f) => f.endsWith(".html")).map((f) => fixtureHtml(site, f).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).join(" ");

describe("the readers", () => {
  it("know the same page and section kinds as the background service", () => {
    expect([...CRAWL_PAGE_KINDS]).toEqual([...PAGE_KINDS]);
    expect([...CRAWL_BLOCK_KINDS]).toEqual([...BLOCK_KINDS]);
  });

  it("read the organization's own website with its words, and refuse a report of another mode", () => {
    const own = ownOf("temple");
    expect(own.name).toBe("Riverbend Hindu Temple");
    expect(own.pages.find((p) => p.kind === "about")!.sections[0]!.excerpt.length).toBeGreaterThan(40);
    expect(own.palette[0]).toEqual({ hex: "#8c1c13", role: "primary" });
    expect(readOwnCrawl(JSON.parse(JSON.stringify(result("temple", "reference"))))).toBeNull();
    expect(readOwnCrawl(null)).toBeNull();
    expect(readOwnCrawl("nonsense")).toBeNull();
  });

  it("read a website the organization likes as hints only, whatever the report holds", () => {
    const hostile = {
      mode: "reference",
      look: { palette: { colors: [{ hex: "#112233", role: "primary" }, { hex: "javascript:alert(1)", role: "accent" }, { hex: "#445566", role: "SECRET SENTENCE FROM THE SITE" }] }, fonts: { heading: "Buy our tickets today and save a lot", body: "Lora" } },
      structure: { home_pattern: ["hero", "A SENTENCE THAT IS NOT A SECTION KIND", "events"], hero: { style: "https://other.example/hero.jpg" } },
      density: { text: "Welcome to the other site" },
      pages: [{ url: "https://other.example/about", sections: [{ excerpt: "COPIED WORDS" }] }],
      organization: { name: "Other Site", description: "COPIED DESCRIPTION" },
    };
    const hints = readReferenceHints(hostile)!;
    expect(hints).toEqual({ homePattern: ["hero", "events"], heroStyle: null, palette: [{ hex: "#112233", role: "primary" }], fonts: { heading: null, body: "Lora" }, density: null });
    expect(JSON.stringify(hints)).not.toMatch(/SECRET|COPIED|other\.example|Buy our|Welcome to/);
    expect(readReferenceHints(JSON.parse(JSON.stringify(result("temple", "own"))))).toBeNull();
  });
});


describe.each(SITES)("the first draft from the %s website and Weaver's records", (site) => {
  const k = KIND_OF[site]!;
  const own = ownOf(site);
  const draft = generateDraft({ own, references: [], weaver: weaver(), kind: k });

  it("has the pages every organization needs, in menu order, and one footer at the end of each", () => {
    const kinds = draft.pages.map((p) => p.kind);
    for (const must of ["home", "about", "events", "give", "contact"] as const) expect(kinds, must).toContain(must);
    expect(kinds[0]).toBe("home");
    expect(kinds[kinds.length - 1]).toBe("contact");
    expect(new Set(draft.pages.map((p) => p.slug)).size).toBe(draft.pages.length);
    for (const p of draft.pages) {
      expect(p.blocks[p.blocks.length - 1]!.type, p.slug).toBe("footer");
      expect(p.blocks.filter((b) => b.type === "footer"), p.slug).toHaveLength(1);
    }
    expect(draft.pages[0]!.blocks[0]!.type).toBe("hero");
    // Classes and photos come with the organization's records (the made-up ones have both).
    expect(kinds).toContain("school");
    expect(kinds).toContain("gallery");
    expect(draft.name).toBe("Maple Hall Community");
  });

  it("keeps the old website's words as the organization's own, with the old page named, and every word is from that website", () => {
    const corpus = squash(JSON.stringify(own)).toLowerCase();
    const kept = blocksOf(draft).filter((b) => b.source === "own_site");
    expect(kept.length).toBeGreaterThan(0);
    for (const b of kept) {
      expect(b.source_page, b.type).toMatch(new RegExp(`^${siteBase(site).replace(/[.]/g, "\\.")}`));
      expect(b.needs_text).toBe(false);
      for (const s of readable(b)) {
        // Weaver's own headings, the organization's name and the kind's greeting are not the old website's words.
        if (ownWordsOf(k).includes(s) || s === weaver().name) continue;
        const bare = squash(s).replace(/…$/, "").trim().toLowerCase();
        if (bare !== "") expect(corpus.includes(bare), `${b.type}: ${s}`).toBe(true);
      }
    }
  });

  it("marks every stand-in, and a stand-in says nothing about the organization (no digit, no date, no name)", () => {
    const empty = generateDraft({ own: null, references: [], weaver: emptyWeaver(), kind: k });
    const standIns = blocksOf(empty).filter((b) => b.source === "written");
    expect(standIns.length).toBeGreaterThanOrEqual(4); // welcome, about, giving, contact
    for (const b of blocksOf(empty)) expect(b.needs_text, b.type).toBe(b.source === "written");
    for (const b of standIns) {
      for (const s of readable(b)) {
        expect(s, `${b.type}: ${s}`).not.toMatch(/\d/);
        expect(ownWordsOf(k).includes(s) || s === weaver().name, `${b.type}: "${s}" is not one of Weaver's own words`).toBe(true);
      }
      expect(b.source_page).toBeNull();
    }
    const texts = standIns.flatMap(readable);
    for (const s of [STAND_IN.welcome, STAND_IN.about, STAND_IN.give, STAND_IN.contact]) expect(texts).toContain(s);
  });

  it("states no fact that is not in the data: every number and name in Weaver's blocks is in Weaver's records or in its own wording", () => {
    const corpus = JSON.stringify(weaverJson());
    // The phone number is written (281) 555-0199 from +12815550199; every other number is written as it was saved.
    // Times are written on a 12-hour clock (20:00 as 8:00 PM).
    const hours = [...corpus.matchAll(/"(\d{2}):\d{2}"/g)].map((m) => Number(m[1]) % 12 || 12);
    const numbers = new Set([...(corpus.match(/\d+/g) ?? []).map(Number), 281, 555, 199, ...hours]);
    const names = new Set(corpus.match(/[A-Z][a-z]+/g) ?? []);
    const owned = new Set(ownWordsOf(k).flatMap((s) => s.match(/[A-Z][a-z]+/g) ?? []));
    const titles = draft.pages.flatMap((p) => p.title.match(/[A-Z][a-z]+/g) ?? []);
    const allowed = new Set([...MONTHS, "AM", "PM", "Open", "Items", "Levels", ...owned, ...titles]);
    for (const b of blocksOf(draft).filter((x) => x.source === "weaver_data")) {
      for (const s of readable(b)) {
        for (const n of s.match(/\d+/g) ?? []) expect(numbers.has(Number(n)), `${b.type}: the number ${n} in "${s}"`).toBe(true);
        for (const w of s.match(/[A-Z][a-z]+/g) ?? []) expect(names.has(w) || allowed.has(w), `${b.type}: the word ${w} in "${s}"`).toBe(true);
      }
    }
  });

  it("gives the home page the events, giving and photos that Weaver has, and never past what the data holds", () => {
    const home = draft.pages[0]!;
    const events = home.blocks.find((b) => b.type === "events_list");
    expect(events?.type === "events_list" && events.content.events.map((e) => e.title)).toEqual(["Harvest Supper", "Winter Concert"]);
    expect(events?.source).toBe("weaver_data");
    const give = draft.pages.find((p) => p.kind === "give")!;
    const cta = give.blocks.find((b) => b.type === "giving_cta");
    expect(cta?.type === "giving_cta" && cta.content.items.map((i) => i.name)).toEqual(["Roof Fund", "Sponsor a beam"]);
    const contact = draft.pages.find((p) => p.kind === "contact")!.blocks.find((b) => b.type === "contact");
    expect(contact?.type === "contact" && contact.content).toMatchObject({ emails: ["hello@maplehall.example.org"], phones: ["(281) 555-0199"], hours: "Weekdays, ten to four" });
    expect(contact?.source).toBe("weaver_data");
  });

  it("fits what the database accepts, and every block reads back as it was written", () => {
    expect(draft.pages.length).toBeLessThanOrEqual(MAX_PAGES);
    for (const p of draft.pages) {
      expect(p.blocks.length).toBeLessThanOrEqual(MAX_BLOCKS_PER_PAGE);
      for (const b of p.blocks) {
        expect(JSON.stringify(b.content).length).toBeLessThan(30_000);
        expect(parseContent(b.type, b.content), `${p.slug} ${b.type}`).toEqual(b.content);
      }
    }
    expect(JSON.stringify(draft).length).toBeLessThan(120_000);
    expect(parseTheme(JSON.parse(JSON.stringify(draft.theme)))).toEqual(draft.theme);
  });

  it("has a theme that reads well: the old website's colours, adjusted so text and buttons are easy to read", () => {
    const t = draft.theme;
    expect(contrast(t.palette.text, t.palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.palette.on_primary, t.palette.primary)).toBeGreaterThanOrEqual(4.5);
    expect(t.from.palette).toBe("own_site");
    expect(t.palette.primary).toBe(own.palette.find((p) => p.role === "primary")!.hex);
    for (const f of [t.fonts.heading, t.fonts.body]) expect(f === null || /^[\p{L}\p{N}][\p{L}\p{N} _'-]{0,39}$/u.test(f)).toBe(true);
  });
});

describe("what the draft keeps from the old website", () => {
  it("keeps the temple's about page words and names the old page", () => {
    const draft = generateDraft({ own: ownOf("temple"), references: [], weaver: weaver(), kind: JAIN });
    const about = draft.pages.find((p) => p.kind === "about")!;
    const first = about.blocks[0]!;
    expect(first.source).toBe("own_site");
    expect(first.source_page).toBe("https://www.riverbendtemple.example/about-us");
    expect(about.source_path).toBe("/about-us");
    expect(readable(first).join(" ")).toMatch(/welcomes families|temple/i);
  });

  it("uses the old page's own title for the classes page, else the kind's word, else a plain one", () => {
    const temple = generateDraft({ own: ownOf("temple"), references: [], weaver: weaver(), kind: JAIN });
    expect(temple.pages.find((p) => p.kind === "school")!.title).toBe("Pathshala");
    const faith = generateDraft({ own: null, references: [], weaver: weaver(), kind: FAITH });
    expect(faith.pages.find((p) => p.kind === "school")!.title).toBe("Religious school");
    const club = generateDraft({ own: null, references: [], weaver: weaver(), kind: SECULAR });
    expect(club.pages.find((p) => p.kind === "school")!.title).toBe("Learning");
  });

  it("does not keep an old events page that was a list of dates: Weaver's list replaces it", () => {
    const draft = generateDraft({ own: ownOf("temple"), references: [], weaver: weaver(), kind: JAIN });
    const events = draft.pages.find((p) => p.kind === "events")!;
    expect(events.blocks.map((b) => b.type)).toEqual(["events_list", "footer"]);
  });

  it("does not keep words from a page the reader was unsure of or could not read", () => {
    const own = ownOf("temple");
    const unsure: OwnCrawl = { ...own, pages: own.pages.map((p) => (p.kind === "about" ? { ...p, confidence: 0.3 } : p)) };
    const draft = generateDraft({ own: unsure, references: [], weaver: weaver({ profile: {} }), kind: JAIN });
    const about = draft.pages.find((p) => p.kind === "about")!;
    expect(about.blocks[0]!.source).toBe("written");
    const scripts: OwnCrawl = { ...own, pages: own.pages.map((p) => (p.kind === "about" ? { ...p, builtByScripts: true } : p)) };
    expect(generateDraft({ own: scripts, references: [], weaver: weaver({ profile: {} }), kind: JAIN }).pages.find((p) => p.kind === "about")!.blocks[0]!.source).toBe("written");
  });

  it("uses the old website's contact details only when Weaver has none of its own", () => {
    const own = ownOf("temple");
    const draft = generateDraft({ own, references: [], weaver: weaver({ profile: {} }), kind: JAIN });
    const contact = draft.pages.find((p) => p.kind === "contact")!.blocks[0]!;
    expect(contact.source).toBe("own_site");
    expect(contact.type === "contact" && contact.content.emails).toEqual(["office@riverbendtemple.example"]);
    expect(contact.source_page).toMatch(/riverbendtemple\.example/);
    expect(draft.pages.every((p) => p.blocks[p.blocks.length - 1]!.source === "own_site")).toBe(true);
  });

  it("builds a draft from Weaver's records alone when there is no old website", () => {
    const draft = generateDraft({ own: null, references: [], weaver: weaver(), kind: SECULAR });
    expect(blocksOf(draft).some((b) => b.source === "own_site")).toBe(false);
    expect(draft.theme.from).toMatchObject({ palette: "default", fonts: "default", layout: "default", logo: "none" });
    expect(draft.pages.map((p) => p.kind)).toEqual(["home", "about", "events", "give", "school", "gallery", "contact"]);
  });

  it("leaves out the pages an organization has nothing for", () => {
    const draft = generateDraft({ own: null, references: [], weaver: emptyWeaver(), kind: CHAMBER });
    expect(draft.pages.map((p) => p.kind)).toEqual(["home", "about", "events", "give", "contact"]);
    expect(draft.pages.find((p) => p.kind === "events")!.blocks[0]!.type === "events_list" && draft.pages.find((p) => p.kind === "events")!.blocks[0]!.content).toMatchObject({ events: [], empty: NO_EVENTS });
  });
});

describe("websites the organization likes give layout and colours only", () => {
  const ownTemple = ownOf("temple");

  it("never put a word of the other website into the draft", () => {
    const ownText = pageText("temple");
    for (const refSite of ["church", "club", "chamber"]) {
      const draft = generateDraft({ own: ownTemple, references: [hintsOf(refSite)], weaver: weaver(), kind: JAIN });
      const refShingles = shingles(pageText(refSite));
      const allowed = new Set([...shingles(ownText), ...shingles(JSON.stringify(weaverJson())), ...ownWordsOf(JAIN).flatMap((s) => [...shingles(s)])]);
      const mine = new Set(blocksOf(draft).flatMap((b) => readable(b).flatMap((s) => [...shingles(s)])));
      const copied = [...mine].filter((s) => refShingles.has(s) && !allowed.has(s));
      expect(copied, `${refSite}: ${copied.join(" | ")}`).toEqual([]);
      // Nor a distinctive word of its name.
      expect(JSON.stringify(draft).toLowerCase()).not.toContain(refSite === "church" ? "grace" : "zzz");
    }
  });

  it("change nothing about the words: the pages and blocks are the same with or without them", () => {
    const without = generateDraft({ own: ownTemple, references: [], weaver: weaver(), kind: JAIN });
    const withRef = generateDraft({ own: ownTemple, references: [hintsOf("church"), hintsOf("club")], weaver: weaver(), kind: JAIN });
    expect(withRef.pages).toEqual(without.pages);
    expect(withRef.theme.palette).toEqual(without.theme.palette);
  });

  it("fill only what the old website did not give: the order of the home page and the colours", () => {
    const bare: OwnCrawl = { ...ownTemple, homePattern: [], palette: [], fonts: { heading: null, body: null }, heroStyle: null };
    const ref = hintsOf("church");
    const draft = generateDraft({ own: bare, references: [ref], weaver: weaver(), kind: FAITH });
    expect(draft.theme.from).toMatchObject({ palette: "reference_hint", layout: "reference_hint" });
    expect(draft.theme.palette.primary).toBe(ref.palette.find((p) => p.role === "primary")!.hex);
    const order = draft.pages[0]!.blocks.map((b) => b.type).filter((t) => t !== "hero" && t !== "footer");
    expect(order.length).toBeGreaterThan(1);
    // The same draft with no reference falls back to Weaver's own order and colours.
    const plain = generateDraft({ own: bare, references: [], weaver: weaver(), kind: FAITH });
    expect(plain.theme.from).toMatchObject({ palette: "default", layout: "default" });
    expect(plain.theme.palette.primary).toBe("#1b2c5c");
    expect(plain.pages[0]!.blocks.map((b) => b.type)).toEqual(["hero", "text", "events_list", "giving_cta", "gallery", "footer"]);
  });

  it("follow the old website's own order of sections on the home page", () => {
    const draft = generateDraft({ own: ownTemple, references: [], weaver: weaver(), kind: JAIN });
    // header, hero, about, events, gallery, donate, footer
    expect(draft.pages[0]!.blocks.map((b) => b.type)).toEqual(["hero", "text", "events_list", "gallery", "giving_cta", "footer"]);
    expect(draft.theme.from.layout).toBe("own_site");
  });
});

describe("wording follows the organization's kind", () => {
  it("never meets a Jain word for a kind without a tradition, in anything Weaver writes", () => {
    for (const site of SITES) {
      const k = KIND_OF[site]!;
      if (k.usesTradition) continue;
      for (const w of [weaver(), emptyWeaver()]) {
        const draft = generateDraft({ own: ownOf(site), references: [hintsOf("temple")], weaver: w, kind: k });
        // The organization's own old words are theirs; Weaver's records here are made up without such words; the rest is Weaver's.
        for (const b of blocksOf(draft).filter((x) => x.source !== "own_site")) for (const s of readable(b)) expect(s, `${site} ${b.type}`).not.toMatch(JAIN_WORDS);
        for (const p of draft.pages) expect(p.title, p.slug).not.toMatch(JAIN_WORDS);
      }
      expect(ownWordsOf(k).join(" ")).not.toMatch(JAIN_WORDS);
    }
  });

  it("uses the kind's own words: the greeting, what giving is called, the store, the classes", () => {
    const jain = generateDraft({ own: null, references: [], weaver: weaver(), kind: JAIN });
    const hero = jain.pages[0]!.blocks[0]!;
    expect(hero.type === "hero" && hero.content.eyebrow).toBe("Jai Jinendra");
    expect(jain.pages.find((p) => p.kind === "events")!.blocks[0]!.type === "events_list" && (jain.pages.find((p) => p.kind === "events")!.blocks[0]!.content as { heading: string }).heading).toBe("Events and festivals");
    expect(jain.pages.find((p) => p.kind === "give")!.blocks.some((b) => b.type === "text" && b.content.heading === "My Store")).toBe(true);

    const chamber = generateDraft({ own: null, references: [], weaver: weaver(), kind: CHAMBER });
    expect(chamber.pages.find((p) => p.kind === "give")!.title).toBe("Pay");
    expect(chamber.pages.find((p) => p.kind === "give")!.blocks.some((b) => b.type === "text" && b.content.heading === "Store")).toBe(true);
    const eventsBlock = chamber.pages.find((p) => p.kind === "events")!.blocks[0]!;
    expect(eventsBlock.type === "events_list" && eventsBlock.content.heading).toBe("Upcoming events");
  });

  it("shows the daily opening times only for a kind that keeps a tradition", () => {
    const line = (k: KindProfile) => {
      const c = generateDraft({ own: null, references: [], weaver: weaver(), kind: k }).pages.find((p) => p.kind === "contact")!.blocks[0]!;
      return c.type === "contact" ? c.content.today : "wrong block";
    };
    expect(line(JAIN)).toBe("Open 6:00 AM to 8:00 PM on October 11, 2026");
    expect(line(CHAMBER)).toBeNull();
  });
});


describe("the fixture itself", () => {
  it("has the pages these tests rely on", () => {
    const expected = JSON.parse(readFileSync(join(__dirname, "fixtures", "sites", "expected.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(expected).sort()).toEqual([...SITES].sort());
  });
});

