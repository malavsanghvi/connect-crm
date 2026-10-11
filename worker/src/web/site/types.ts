// What the site crawl (job site.crawl) finds, in the shapes the later phases read (B92 W2 to W5: the site model, the
// draft, the preview). Plain data only, so it fits in app.jobs.result (jsonb).
//
// Two modes (COPYRIGHT, plan section 6):
//   own        the organization's own website: its text excerpts and image addresses are kept for drafting.
//   reference  a site the organization likes: layout patterns only (section order, menu depth, hero style, palette,
//              font names, density). No sentence of its text and no image or page address is ever stored.

export type Mode = "own" | "reference";

export const PAGE_KINDS = ["home", "about", "events", "calendar", "donate", "contact", "school", "gallery", "news", "leadership", "membership", "other"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export type Classification = {
  kind: PageKind;
  /** 0 to 1: how far ahead of the next-best guess the winner is. Under 0.5 the page is best checked by a person. */
  confidence: number;
  runner_up: PageKind | null;
  /** Short signal names ("path:events", "h1:calendar"), never page text. */
  reasons: string[];
};

export type Heading = { level: number; text: string; children: Heading[] };
export type NavItem = { label: string; href: string | null; internal: boolean; children: NavItem[] };
export type Nav = {
  items: NavItem[];
  /** 1 = a flat menu; 2 = it has dropdowns; and so on. */
  depth: number;
  top_level_count: number;
  total_links: number;
  has_dropdowns: boolean;
  mobile_toggle: boolean;
  /** The label of a menu item styled as a button ("Donate"), if there is one. */
  cta: string | null;
};
export type FooterFacts = {
  links: { label: string; href: string; internal: boolean }[];
  link_count: number;
  columns: number;
  has_social: boolean;
  has_newsletter: boolean;
  has_address: boolean;
  has_copyright: boolean;
};

export type ImageRole = "logo" | "hero" | "photo" | "decorative";
export type ImageFact = { src: string; alt: string; width: number | null; height: number | null; role: ImageRole };
export type SocialLink = { network: string; url: string };
export type Contact = { emails: string[]; phones: string[]; addresses: string[] };
export type EventBlock = { title: string; date_text: string; time_text: string | null; url: string | null };
export type DonateLink = { label: string; url: string; external: boolean };

export const BLOCK_KINDS = ["header", "hero", "about", "events", "gallery", "donate", "news", "contact", "newsletter", "leaders", "programs", "sponsors", "testimonials", "map", "cta", "content", "footer"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export type HeroStyle = "image" | "slider" | "video" | "text";
export type HeroHints = { style: HeroStyle; has_cta: boolean; tall: boolean; has_heading: boolean };

export type SectionExcerpt = { heading: string; excerpt: string; chars: number };

/** Everything the extractors read from one page, before the mode decides what is kept. */
export type PageFacts = {
  url: string;
  path: string;
  title: string;
  short_title: string;
  description: string;
  lang: string;
  site_name: string;
  headings: Heading[];
  heading_count: number;
  sections: SectionExcerpt[];
  section_count: number;
  words: number;
  nav: Nav | null;
  footer: FooterFacts | null;
  images: ImageFact[];
  image_count: number;
  social: SocialLink[];
  contact: Contact;
  events: EventBlock[];
  event_count: number;
  donate_links: DonateLink[];
  layout: BlockKind[];
  hero: HeroHints | null;
  forms: number;
  has_map: boolean;
  has_calendar_embed: boolean;
  has_search: boolean;
  /** Little text found: the page is built by scripts (a browser would be needed to read it). */
  built_by_scripts: boolean;
  classification: Classification;
  /** Same-site links, in page order, for the crawl planner. Not part of any result. */
  links: string[];
  json_ld_types: string[];
  /** Stylesheet addresses and inline CSS, for the palette and fonts (site level). */
  css_links: string[];
  inline_css: string;
  style_attrs: string[];
  ld_description: string;
  fonts_links: string[];
  theme_colors: string[];
  logo_candidates: LogoCandidate[];
  org_name_hints: string[];
};

export type LogoCandidate = { url: string; source: "header-image" | "named-logo" | "json-ld" | "apple-touch-icon" | "icon" | "og-image"; score: number; alt: string; width: number | null; height: number | null };

// ── Site level ───────────────────────────────────────────────────────────────────────────────────────────────────
export type PaletteColor = { hex: string; score: number; share: number; role: "primary" | "secondary" | "accent" | "background" | "text" | "neutral" };
export type ContrastNote = { pair: [string, string]; ratio: number; passes_aa: boolean; note: string };
export type Palette = { colors: PaletteColor[]; theme_color: string | null; contrast: ContrastNote[]; sources: { theme_meta: number; variables: number; css_values: number } };
export type FontFact = { name: string; uses: number; source: "google" | "typekit" | "font-face" | "css"; role: "heading" | "body" | "unknown" };
export type FontSet = { fonts: FontFact[]; heading: string | null; body: string | null };

/** What the crawl did, in codes a screen can word in plain English (describeNotes). Never page text. */
export type NoteCode = "no_sitemap" | "sitemap_unreadable" | "scripts_built" | "off_site_redirect" | "robots_skipped" | "page_errors" | "time_limit" | "byte_limit" | "page_limit" | "css_skipped_other_host" | "css_unreadable" | "page_too_large" | "not_html";
export type Note = { code: NoteCode; count: number };

export type CrawlStats = {
  pages_fetched: number;
  pages_in_sitemap: number;
  sitemap_used: boolean;
  stopped_by: "done" | "max_pages" | "time" | "bytes";
  bytes: number;
  elapsed_ms: number;
  skipped: { robots: number; off_site: number; off_site_redirect: number; files: number; errors: number };
  css_files_read: number;
};
