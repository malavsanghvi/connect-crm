// Reads a finished website read (the job result of worker site.crawl, shaped like worker/src/web/site/report.ts) into
// the small typed pieces the draft generator needs. Nothing here trusts the report: every field is checked and the
// ones that are not what was expected are left out.
//
// COPYRIGHT (plan section 6): a website the organization LIKES is read by readReferenceHints, which keeps only fixed
// words (a section kind, a hero style, a density), colours and font names. It has no field a sentence, a page address
// or an image address could be copied into, so no text or picture of another website can reach a draft whatever the
// report held. The organization's OWN website is read by readOwnCrawl, which keeps its words and pictures.

import { arr, fontName, hex, num, rec, str, strs, webAddress } from "../site-found";
import type { Density, HeroStyleName } from "./types";
import { DENSITIES, HERO_STYLES } from "./types";

// Kept in step with worker/src/web/site/types.ts (a test compares them).
export const CRAWL_PAGE_KINDS = ["home", "about", "events", "calendar", "donate", "contact", "school", "gallery", "news", "leadership", "membership", "other"] as const;
export type CrawlPageKind = (typeof CRAWL_PAGE_KINDS)[number];
export const CRAWL_BLOCK_KINDS = ["header", "hero", "about", "events", "gallery", "donate", "news", "contact", "newsletter", "leaders", "programs", "sponsors", "testimonials", "map", "cta", "content", "footer"] as const;
export type CrawlBlockKind = (typeof CRAWL_BLOCK_KINDS)[number];

const PALETTE_ROLES = ["primary", "secondary", "accent", "background", "text", "neutral"] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];
export type PaletteEntry = { hex: string; role: PaletteRole };

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

export type OwnPage = {
  url: string;
  path: string;
  kind: CrawlPageKind;
  /** 0 to 1. Under 0.5 the page is best checked by a person, so its words are not kept. */
  confidence: number;
  title: string;
  sections: { heading: string; excerpt: string }[];
  images: { src: string; alt: string; role: string }[];
  eventCount: number;
  builtByScripts: boolean;
};

export type OwnCrawl = {
  site: string;
  startUrl: string;
  name: string | null;
  description: string;
  contact: { emails: string[]; phones: string[]; addresses: string[] };
  social: { network: string; url: string }[];
  palette: PaletteEntry[];
  fonts: { heading: string | null; body: string | null };
  logos: { url: string; alt: string; source: string }[];
  homePattern: CrawlBlockKind[];
  heroStyle: HeroStyleName | null;
  /** The words of the site's menu, so they can be taken off the front of a page's text. */
  menu: string[];
  pages: OwnPage[];
};

export type ReferenceHints = {
  homePattern: CrawlBlockKind[];
  heroStyle: HeroStyleName | null;
  palette: PaletteEntry[];
  fonts: { heading: string | null; body: string | null };
  density: Density | null;
};

function paletteOf(look: unknown): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const raw of arr(rec(rec(look)?.palette)?.colors)) {
    const c = rec(raw);
    const h = hex(c?.hex);
    const role = oneOf(PALETTE_ROLES, c?.role);
    if (h && role && out.length < 8) out.push({ hex: h, role });
  }
  return out;
}

function fontsOf(look: unknown): { heading: string | null; body: string | null } {
  const f = rec(rec(look)?.fonts);
  return { heading: fontName(f?.heading), body: fontName(f?.body) };
}

function patternOf(structure: unknown): CrawlBlockKind[] {
  return arr(rec(structure)?.home_pattern)
    .map((k) => oneOf(CRAWL_BLOCK_KINDS, k))
    .filter((k): k is CrawlBlockKind => k !== null)
    .slice(0, 20);
}

/** The organization's own website, from a finished read in "own" mode. Null when it is not one. */
export function readOwnCrawl(result: unknown): OwnCrawl | null {
  const r = rec(result);
  if (!r || r.mode !== "own") return null;
  const org = rec(r.organization) ?? {};
  const contact = rec(org.contact) ?? {};
  const look = rec(r.look) ?? {};
  const structure = rec(r.structure) ?? {};

  const pages: OwnPage[] = [];
  for (const raw of arr(r.pages).slice(0, 80)) {
    const p = rec(raw);
    const kind = oneOf(CRAWL_PAGE_KINDS, p?.kind);
    const url = webAddress(p?.url);
    if (!p || !kind || !url) continue;
    pages.push({
      url,
      path: str(p.path, 300),
      kind,
      confidence: Math.min(1, Math.max(0, num(p.confidence))),
      title: str(p.title, 160),
      sections: arr(p.sections)
        .slice(0, 12)
        .map((s) => ({ heading: str(rec(s)?.heading, 160), excerpt: str(rec(s)?.excerpt, 1500) }))
        .filter((s) => s.excerpt !== ""),
      images: arr(p.images)
        .slice(0, 40)
        .map((i) => ({ src: webAddress(rec(i)?.src) ?? "", alt: str(rec(i)?.alt, 200), role: str(rec(i)?.role, 20) }))
        .filter((i) => i.src !== ""),
      eventCount: Math.max(0, Math.round(num(p.event_count))),
      builtByScripts: p.built_by_scripts === true,
    });
  }

  return {
    site: str(r.site, 120),
    startUrl: webAddress(r.start_url) ?? "",
    name: str(org.name, 160) || null,
    description: str(org.description, 400),
    contact: { emails: strs(contact.emails, 120, 5), phones: strs(contact.phones, 40, 5), addresses: strs(contact.addresses, 200, 3) },
    social: arr(org.social)
      .slice(0, 8)
      .map((s) => ({ network: str(rec(s)?.network, 30).toLowerCase(), url: webAddress(rec(s)?.url) ?? "" }))
      .filter((s) => s.network !== "" && s.url !== ""),
    palette: paletteOf(look),
    fonts: fontsOf(look),
    logos: arr(look.logo_candidates)
      .slice(0, 6)
      .map((l) => ({ url: webAddress(rec(l)?.url) ?? "", alt: str(rec(l)?.alt, 120), source: str(rec(l)?.source, 30) }))
      .filter((l) => l.url !== ""),
    homePattern: patternOf(structure),
    heroStyle: oneOf(HERO_STYLES, rec(structure.hero)?.style),
    menu: menuLabels(rec(structure.nav)?.items),
    pages,
  };
}

function menuLabels(items: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const raw of arr(items).slice(0, 40)) {
    const label = str(rec(raw)?.label, 60);
    if (label !== "") out.push(label);
    out.push(...menuLabels(rec(raw)?.children, depth + 1));
  }
  return out.slice(0, 120);
}

/**
 * Layout patterns and colours from a website the organization likes, from a finished read in "reference" mode. Null when it
 * is not one. Only fixed words, colours and font names are taken: there is nowhere in the result for a sentence or an
 * address, whatever the report held.
 */
export function readReferenceHints(result: unknown): ReferenceHints | null {
  const r = rec(result);
  if (!r || r.mode !== "reference") return null;
  const structure = rec(r.structure) ?? {};
  return {
    homePattern: patternOf(structure),
    heroStyle: oneOf(HERO_STYLES, rec(structure.hero)?.style),
    palette: paletteOf(r.look),
    fonts: fontsOf(r.look),
    density: oneOf(DENSITIES, rec(r.density)?.text),
  };
}
