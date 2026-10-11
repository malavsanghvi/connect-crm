// The first draft of an organization's website, as data (B92 phase W3; the site model of B55).
//
// A site is a few pages, and a page is a list of blocks. Every block says where its words came from:
//   own_site     the organization's own old website. The words are theirs, kept as they were, with the old page shown.
//   weaver_data  Weaver's own records of the organization (events, giving, leaders, contact details …).
//   written      a short neutral stand-in Weaver wrote because nothing else was there. It is marked, and the person is
//                meant to replace it (needs_text). No date, number or name is ever invented in one.
// Websites the organization LIKES never appear here as words: they only steer the order of sections and the colours.
//
// Plain data only (JSON), so it is stored as jsonb (migration 0642) and read back field by field (parse.ts).

export const BLOCK_TYPES = ["hero", "text", "events_list", "giving_cta", "gallery", "leaders", "contact", "map", "faq", "footer"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_SOURCES = ["own_site", "weaver_data", "written"] as const;
export type BlockSource = (typeof BLOCK_SOURCES)[number];

export const SITE_PAGE_KINDS = ["home", "about", "events", "give", "contact", "school", "gallery"] as const;
export type SitePageKind = (typeof SITE_PAGE_KINDS)[number];

export const PAGE_STATUSES = ["draft", "approved"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export const HERO_STYLES = ["image", "slider", "video", "text"] as const;
export type HeroStyleName = (typeof HERO_STYLES)[number];

export const DENSITIES = ["sparse", "medium", "dense"] as const;
export type Density = (typeof DENSITIES)[number];

/** Limits the database repeats (migration 0642): a draft is small. */
export const MAX_PAGES = 12;
export const MAX_BLOCKS_PER_PAGE = 30;

// ── Blocks ───────────────────────────────────────────────────────────────────
export type Img = { src: string; alt: string };
export type PageLink = { label: string; page: string };

export type HeroContent = { eyebrow: string | null; heading: string; subheading: string | null; image: Img | null; cta: PageLink | null };
export type TextContent = { heading: string; paragraphs: string[] };
export type EventItem = { title: string; starts_at: string; ends_at: string | null; venue: string | null; description: string | null };
export type EventsContent = { heading: string; time_zone: string | null; events: EventItem[]; empty: string | null };
export type GivingItem = { name: string; description: string | null };
export type GivingContent = { heading: string; body: string | null; items: GivingItem[]; cta: { label: string } | null };
export type AlbumItem = { title: string; photos: number };
export type GalleryContent = { heading: string; albums: AlbumItem[]; images: Img[]; licence_unchecked: boolean };
export type PersonItem = { name: string; title: string };
export type LeadersContent = { heading: string; people: PersonItem[] };
export type SocialItem = { network: string; url: string };
export type ContactContent = { heading: string; emails: string[]; phones: string[]; addresses: string[]; hours: string | null; today: string | null; social: SocialItem[]; note: string | null };
export type MapContent = { heading: string; address: string | null; latitude: number | null; longitude: number | null };
export type FaqContent = { heading: string; items: { question: string; answer: string }[] };
export type FooterContent = { name: string; lines: string[]; links: PageLink[]; social: SocialItem[] };

export type ContentOf = {
  hero: HeroContent;
  text: TextContent;
  events_list: EventsContent;
  giving_cta: GivingContent;
  gallery: GalleryContent;
  leaders: LeadersContent;
  contact: ContactContent;
  map: MapContent;
  faq: FaqContent;
  footer: FooterContent;
};

type BlockOf<T extends BlockType> = {
  type: T;
  content: ContentOf[T];
  source: BlockSource;
  /** The old page this block was kept from (a web address); set exactly when source is own_site. */
  source_page: string | null;
  /** A stand-in the person should replace. Always true when source is written. */
  needs_text: boolean;
};
export type DraftBlock = { [T in BlockType]: BlockOf<T> }[BlockType];

// ── Pages, theme, the draft ──────────────────────────────────────────────────
export type DraftPage = {
  slug: string;
  title: string;
  kind: SitePageKind;
  /** The path of the old page this one grew from, when there was one. */
  source_path: string | null;
  blocks: DraftBlock[];
};

export type SiteTheme = {
  palette: { primary: string; secondary: string; accent: string; background: string; text: string; on_primary: string };
  fonts: { heading: string | null; body: string | null };
  logo: Img | null;
  hero_style: HeroStyleName;
  density: Density;
  /** Where each part came from: the old website, only a hint from a website the organization likes, or Weaver's default. */
  from: { palette: "own_site" | "reference_hint" | "default"; fonts: "own_site" | "reference_hint" | "default"; layout: "own_site" | "reference_hint" | "default"; logo: "own_site" | "none" };
};

export type SiteDraft = {
  name: string;
  theme: SiteTheme;
  pages: DraftPage[];
};

/** What the preview and the setup screen read back from the database (site_draft_get). */
export type StoredBlock = DraftBlock & { id: string };
export type StoredPage = Omit<DraftPage, "blocks"> & { id: string; status: PageStatus; approved_at: string | null; blocks: StoredBlock[]; block_count: number; stand_ins: number };
export type StoredDraft = {
  name: string;
  draft_version: number;
  built_at: string | null;
  theme: SiteTheme;
  pages: StoredPage[];
};

/** One line per page for the setup screen (no blocks). */
export type DraftSummary = {
  draftVersion: number;
  builtAt: string | null;
  pages: { id: string; slug: string; title: string; kind: SitePageKind; status: PageStatus; blocks: number; standIns: number }[];
};
