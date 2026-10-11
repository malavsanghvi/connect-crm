// The "what we found" report: the pages the crawl read, folded into one site-level result.
//
// COPYRIGHT (plan section 6): the mode decides what survives.
//   own        text excerpts, image addresses, contact details: the organization's own content, kept for drafting.
//   reference  layout patterns only: section order, menu depth, hero style, palette, font names, density, page kinds.
//              No sentence of the site's text and no image or page address is ever put in the result; every field is
//              a number, a yes/no, a colour, a font name or a short code (findContentLeaks re-checks it, and the
//              handler refuses to save a reference result that fails the check).
//
// The result is stored in app.jobs.result (jsonb) and kept under about 400 KB (fitBudget).

import { siteOf } from "../sitemap";
import { kindOfLabel } from "./classify";
import { extractFonts, extractPalette } from "./style";
import { PAGE_KINDS } from "./types";
import type { BlockKind, Contact, CrawlStats, DonateLink, FontSet, FooterFacts, Heading, HeroHints, ImageFact, LogoCandidate, Nav, Note, Palette, PageFacts, PageKind, SectionExcerpt, SocialLink, EventBlock, Mode } from "./types";
import { unique } from "./util";

export const RESULT_BUDGET_BYTES = 380_000;

export type OwnPage = {
  url: string;
  path: string;
  kind: PageKind;
  confidence: number;
  runner_up: PageKind | null;
  reasons: string[];
  title: string;
  description: string;
  headings: Heading[];
  sections: SectionExcerpt[];
  section_count: number;
  words: number;
  images: ImageFact[];
  image_count: number;
  events: EventBlock[];
  event_count: number;
  donate_links: DonateLink[];
  layout: BlockKind[];
  built_by_scripts: boolean;
};

export type OwnReport = {
  schema: 1;
  mode: "own";
  site: string;
  start_url: string;
  crawl: CrawlStats;
  notes: Note[];
  organization: { name: string | null; name_candidates: string[]; description: string; languages: string[]; contact: Contact; social: SocialLink[]; donate_links: DonateLink[] };
  look: { palette: Palette; fonts: FontSet; logo_candidates: LogoCandidate[] };
  structure: { nav: Nav | null; footer: FooterFacts | null; home_pattern: BlockKind[]; hero: HeroHints | null; has_search: boolean; page_kinds: Partial<Record<PageKind, number>> };
  pages: OwnPage[];
  /** 0 = nothing was cut; higher = more excerpts, images and events were dropped to fit the size limit. */
  trimmed: number;
};

export type Bucket = "few" | "some" | "many";
export type ReferenceReport = {
  schema: 1;
  mode: "reference";
  site: string;
  crawl: { pages_fetched: number; pages_in_sitemap: number; stopped_by: CrawlStats["stopped_by"] };
  notes: Note[];
  look: {
    palette: { colors: { hex: string; share: number; role: string }[]; contrast: { ratio: number; passes_aa: boolean }[] };
    fonts: { heading: string | null; body: string | null; names: string[] };
  };
  structure: {
    nav: { top_level_count: number; depth: number; has_dropdowns: boolean; mobile_toggle: boolean; has_cta: boolean; has_search: boolean; items_by_kind: Partial<Record<PageKind, number>> } | null;
    footer: { columns: number; link_count: number; has_social: boolean; has_newsletter: boolean; has_address: boolean } | null;
    home_pattern: BlockKind[];
    hero: { style: string; has_cta: boolean; tall: boolean } | null;
    logo: { present: boolean; in_header: boolean };
    page_kinds: Partial<Record<PageKind, number>>;
  };
  density: { text: "sparse" | "medium" | "dense"; avg_words: number; avg_images: number; avg_sections: number; avg_links: number; imagery: "text-led" | "balanced" | "image-led" };
  pages: { kind: PageKind; confidence: number; depth: number; layout: BlockKind[]; words: Bucket; images: Bucket; headings: number; has_form: boolean; has_events: boolean; has_donate: boolean }[];
};

export type SiteReport = OwnReport | ReferenceReport;

export type ReportInput = {
  mode: Mode;
  startUrl: string;
  pages: PageFacts[];
  /** CSS files read from the site itself (the palette and fonts are read from them too). */
  css: string[];
  stats: CrawlStats;
  notes: Note[];
};

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
const bucket = (n: number, few: number, many: number): Bucket => (n < few ? "few" : n >= many ? "many" : "some");

/** Counted across pages, most common first: a phone number in every page's footer beats one in a single page. */
function ranked<T>(lists: T[][], key: (t: T) => string, n: number): T[] {
  const count = new Map<string, { item: T; n: number; order: number }>();
  let order = 0;
  for (const list of lists) for (const it of list) {
    const k = key(it);
    const c = count.get(k);
    if (c) c.n++;
    else count.set(k, { item: it, n: 1, order: order++ });
  }
  return [...count.values()].sort((a, b) => b.n - a.n || a.order - b.order).slice(0, n).map((c) => c.item);
}

function homeOf(pages: PageFacts[]): PageFacts | null {
  return pages.find((p) => p.classification.kind === "home") ?? pages[0] ?? null;
}

function kindCounts(pages: PageFacts[]): Partial<Record<PageKind, number>> {
  const out: Partial<Record<PageKind, number>> = {};
  for (const k of PAGE_KINDS) {
    const n = pages.filter((p) => p.classification.kind === k).length;
    if (n > 0) out[k] = n;
  }
  return out;
}

export function buildReport(input: ReportInput): SiteReport {
  const { pages, mode } = input;
  const home = homeOf(pages);
  const site = siteOf(input.startUrl) ?? "";
  const themeColors = unique([...(home?.theme_colors ?? []), ...pages.flatMap((p) => p.theme_colors)], (c) => c.toLowerCase(), 4);
  // The home page's own CSS first, then the other pages' <style> blocks (a few are enough to see the palette).
  const css = [...input.css, ...(home ? [home.inline_css] : []), ...pages.filter((p) => p !== home).slice(0, 5).map((p) => p.inline_css)].filter(Boolean);
  const inline = pages.flatMap((p) => p.style_attrs);
  const palette = extractPalette({ themeColors, css, inline });
  const fonts = extractFonts({ css, inline, links: unique(pages.flatMap((p) => p.fonts_links), (l) => l, 8) });
  const homePattern = home?.layout ?? [];
  const hero = home?.hero ?? null;

  if (mode === "reference") {
    const withNav = home?.nav ?? pages.find((p) => p.nav)?.nav ?? null;
    const itemKinds: Partial<Record<PageKind, number>> = {};
    for (const it of withNav?.items ?? []) {
      const k = kindOfLabel(it.label);
      itemKinds[k] = (itemKinds[k] ?? 0) + 1;
    }
    const foot = home?.footer ?? pages.find((p) => p.footer)?.footer ?? null;
    const avgWords = avg(pages.map((p) => p.words));
    const avgImages = avg(pages.map((p) => p.image_count));
    const ref: ReferenceReport = {
      schema: 1,
      mode: "reference",
      site,
      crawl: { pages_fetched: input.stats.pages_fetched, pages_in_sitemap: input.stats.pages_in_sitemap, stopped_by: input.stats.stopped_by },
      notes: input.notes,
      look: {
        palette: { colors: palette.colors.map((c) => ({ hex: c.hex, share: c.share, role: c.role })), contrast: palette.contrast.map((c) => ({ ratio: c.ratio, passes_aa: c.passes_aa })) },
        fonts: { heading: fonts.heading, body: fonts.body, names: fonts.fonts.map((f) => f.name) },
      },
      structure: {
        nav: withNav ? { top_level_count: withNav.top_level_count, depth: withNav.depth, has_dropdowns: withNav.has_dropdowns, mobile_toggle: withNav.mobile_toggle, has_cta: withNav.cta !== null, has_search: pages.some((p) => p.has_search), items_by_kind: itemKinds } : null,
        footer: foot ? { columns: foot.columns, link_count: foot.link_count, has_social: foot.has_social, has_newsletter: foot.has_newsletter, has_address: foot.has_address } : null,
        home_pattern: homePattern,
        hero: hero ? { style: hero.style, has_cta: hero.has_cta, tall: hero.tall } : null,
        logo: { present: pages.some((p) => p.logo_candidates.some((l) => l.score >= 7)), in_header: pages.some((p) => p.images.some((i) => i.role === "logo")) },
        page_kinds: kindCounts(pages),
      },
      density: {
        text: avgWords < 150 ? "sparse" : avgWords > 450 ? "dense" : "medium",
        avg_words: Math.round(avgWords),
        avg_images: avgImages,
        avg_sections: avg(pages.map((p) => p.section_count)),
        avg_links: avg(pages.map((p) => p.links.length)),
        imagery: avgImages / Math.max(1, avgWords / 100) > 3 ? "image-led" : avgImages / Math.max(1, avgWords / 100) < 1 ? "text-led" : "balanced",
      },
      pages: pages.slice(0, 80).map((p) => ({
        kind: p.classification.kind,
        confidence: p.classification.confidence,
        depth: p.path.split("?")[0]!.split("/").filter(Boolean).length,
        layout: p.layout,
        words: bucket(p.words, 120, 450),
        images: bucket(p.image_count, 3, 12),
        headings: p.heading_count,
        has_form: p.forms > 0,
        has_events: p.event_count > 0,
        has_donate: p.donate_links.length > 0,
      })),
    };
    return ref;
  }

  const contactLists = pages.map((p) => p.contact);
  const names = ranked(pages.map((p) => p.org_name_hints), (s) => s.toLowerCase(), 5);
  const own: OwnReport = {
    schema: 1,
    mode: "own",
    site,
    start_url: input.startUrl,
    crawl: input.stats,
    notes: input.notes,
    organization: {
      name: names[0] ?? null,
      name_candidates: names,
      description: home?.description || home?.ld_description || "",
      languages: unique(pages.map((p) => p.lang).filter(Boolean), (l) => l, 4),
      contact: {
        emails: ranked(contactLists.map((c) => c.emails), (e) => e, 3),
        phones: ranked(contactLists.map((c) => c.phones), (p) => p.replace(/\D/g, "").slice(-10), 3),
        addresses: ranked(contactLists.map((c) => c.addresses), (a) => a.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40), 2),
      },
      social: ranked(pages.map((p) => p.social), (s) => s.network + "|" + s.url.toLowerCase().replace(/\/$/, ""), 8),
      donate_links: ranked(pages.map((p) => p.donate_links), (d) => d.url, 5),
    },
    look: { palette, fonts, logo_candidates: ranked(pages.map((p) => p.logo_candidates), (l) => l.url, 5) },
    structure: { nav: home?.nav ?? pages.find((p) => p.nav)?.nav ?? null, footer: home?.footer ?? pages.find((p) => p.footer)?.footer ?? null, home_pattern: homePattern, hero, has_search: pages.some((p) => p.has_search), page_kinds: kindCounts(pages) },
    pages: pages.map(
      (p): OwnPage => ({
        url: p.url,
        path: p.path,
        kind: p.classification.kind,
        confidence: p.classification.confidence,
        runner_up: p.classification.runner_up,
        reasons: p.classification.reasons,
        title: p.short_title || p.title,
        description: p.description,
        headings: p.headings,
        sections: p.sections,
        section_count: p.section_count,
        words: p.words,
        images: p.images,
        image_count: p.image_count,
        events: p.events,
        event_count: p.event_count,
        donate_links: p.donate_links,
        layout: p.layout,
        built_by_scripts: p.built_by_scripts,
      }),
    ),
    trimmed: 0,
  };
  return fitBudget(own);
}

// ── Keeping the result small ─────────────────────────────────────────────────────────────────────────────────────
const LADDER = [
  { excerpt: 1200, sections: 20, images: 60, events: 30, headings: 60 },
  { excerpt: 600, sections: 12, images: 30, events: 20, headings: 40 },
  { excerpt: 300, sections: 8, images: 15, events: 12, headings: 30 },
  { excerpt: 160, sections: 5, images: 8, events: 6, headings: 20 },
  { excerpt: 0, sections: 5, images: 4, events: 3, headings: 12 },
];

function cutHeadings(hs: Heading[], budget: { n: number }): Heading[] {
  const out: Heading[] = [];
  for (const h of hs) {
    if (budget.n <= 0) break;
    budget.n--;
    out.push({ ...h, children: cutHeadings(h.children, budget) });
  }
  return out;
}

export function sizeOf(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v), "utf8");
}

/** The own-mode report cut down, step by step, until it fits RESULT_BUDGET_BYTES. Facts stay; bodies go first. */
export function fitBudget(report: OwnReport, budget = RESULT_BUDGET_BYTES): OwnReport {
  if (sizeOf(report) <= budget) return report;
  let out = report;
  for (let level = 1; level < LADDER.length; level++) {
    const l = LADDER[level]!;
    out = {
      ...report,
      trimmed: level,
      pages: report.pages.map((p) => ({
        ...p,
        sections: p.sections.slice(0, l.sections).map((s) => ({ ...s, excerpt: l.excerpt === 0 ? "" : s.excerpt.length > l.excerpt ? s.excerpt.slice(0, l.excerpt - 1).trimEnd() + "…" : s.excerpt })),
        images: p.images.slice(0, l.images),
        events: p.events.slice(0, l.events),
        headings: cutHeadings(p.headings, { n: l.headings }),
      })),
    };
    if (sizeOf(out) <= budget) return out;
  }
  // Still too big (a very long list of pages): keep the first pages that fit.
  const pages = [...out.pages];
  while (pages.length > 1 && sizeOf({ ...out, pages }) > budget) pages.pop();
  return { ...out, pages, trimmed: LADDER.length };
}

// ── The copyright check ──────────────────────────────────────────────────────────────────────────────────────────
const IMAGE_FILE = /\.(jpe?g|png|gif|webp|svg|avif|bmp|ico|tiff?)(\b|$)/i;

/** Strings in a reference result that look like page text or an address (empty when it is clean). */
export function findContentLeaks(value: unknown, path = "$"): string[] {
  if (typeof value === "string") {
    const words = value.trim().split(/\s+/).filter(Boolean).length;
    const bad = /:\/\/|^\/\/|\bwww\./i.test(value) || IMAGE_FILE.test(value) || words >= 4 || value.length > 60;
    return bad ? [`${path}: ${value.slice(0, 40)}`] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => findContentLeaks(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => findContentLeaks(v, `${path}.${k}`));
  return [];
}

// ── Plain English for the notes (the CLI and, later, the screen) ─────────────────────────────────────────────────
const NOTE_TEXT: Record<Note["code"], (n: number) => string> = {
  no_sitemap: () => "The site has no sitemap, so its pages were found by following links.",
  sitemap_unreadable: () => "The site's sitemap could not be read right now, so its pages were found by following links.",
  scripts_built: (n) => `${n} page${n === 1 ? " has" : "s have"} little text found, built by scripts (a browser would be needed to read ${n === 1 ? "it" : "them"}).`,
  off_site_redirect: (n) => `${n} link${n === 1 ? " was" : "s were"} not followed because ${n === 1 ? "it" : "they"} lead${n === 1 ? "s" : ""} to another website.`,
  robots_skipped: (n) => `${n} page${n === 1 ? " was" : "s were"} skipped because the site asks robots not to read ${n === 1 ? "it" : "them"}.`,
  page_errors: (n) => `${n} page${n === 1 ? "" : "s"} could not be read.`,
  time_limit: () => "The crawl stopped at its time limit; later pages were not read.",
  byte_limit: () => "The crawl stopped at its size limit; later pages were not read.",
  page_limit: () => "The crawl stopped at the page limit; the site has more pages than were read.",
  css_skipped_other_host: (n) => `${n} style file${n === 1 ? " is" : "s are"} hosted elsewhere and ${n === 1 ? "was" : "were"} not read, so the colours and fonts may be incomplete.`,
  css_unreadable: (n) => `${n} style file${n === 1 ? "" : "s"} could not be read.`,
  page_too_large: (n) => `${n} page${n === 1 ? " is" : "s are"} larger than 2 MB and ${n === 1 ? "was" : "were"} skipped.`,
  not_html: (n) => `${n} address${n === 1 ? " is" : "es are"} not a web page and ${n === 1 ? "was" : "were"} skipped.`,
};

export function describeNotes(notes: Note[]): string[] {
  return notes.map((n) => NOTE_TEXT[n.code](n.count));
}

