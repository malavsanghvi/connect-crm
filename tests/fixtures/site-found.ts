// What the site crawl (worker job site.crawl, B92 W1) saves in app.jobs.result, in the two modes, for the Setup › Your
// website tests. Shaped like worker/src/web/site/report.ts (OwnReport, ReferenceReport); the strings are made up.

const crawl = {
  pages_fetched: 7,
  pages_in_sitemap: 9,
  sitemap_used: true,
  stopped_by: "max_pages",
  bytes: 123456,
  elapsed_ms: 2300,
  skipped: { robots: 0, off_site: 2, off_site_redirect: 0, files: 1, errors: 0 },
  css_files_read: 2,
};

const page = (kind: string, path: string, title: string, confidence: number, extra: Record<string, unknown> = {}) => ({
  url: `https://www.jsh.example.org${path}`,
  path,
  kind,
  confidence,
  runner_up: null,
  reasons: [`path:${kind}`],
  title,
  description: "",
  headings: [],
  sections: [{ heading: "Welcome", excerpt: "OWN-SITE-SENTENCE: everyone is welcome at our temple.", chars: 52 }],
  section_count: 1,
  words: 320,
  images: [{ src: "https://www.jsh.example.org/img/hall.jpg", alt: "The hall", width: 800, height: 600, role: "photo" }],
  image_count: 1,
  events: [],
  event_count: 0,
  donate_links: [],
  layout: ["header", "content", "footer"],
  built_by_scripts: false,
  ...extra,
});

/** The organization's own website (mode "own"). */
export const ownResult = {
  schema: 1,
  mode: "own",
  site: "jsh.example.org",
  start_url: "https://www.jsh.example.org",
  crawl,
  notes: [
    { code: "scripts_built", count: 1 },
    { code: "page_limit", count: 1 },
  ],
  organization: {
    name: "Jain Society of Houston",
    name_candidates: ["Jain Society of Houston"],
    description: "A community of families who gather for worship, school and festivals.",
    languages: ["en", "gu"],
    contact: { emails: ["office@jsh.example.org"], phones: ["+1 713 555 0100"], addresses: ["8232 Roos Rd, Houston, TX 77036"] },
    social: [
      { network: "facebook", url: "https://www.facebook.com/jshouston" },
      { network: "javascript", url: "javascript:alert(1)" },
    ],
    donate_links: [{ label: "Donate", url: "https://www.jsh.example.org/give", external: false }],
  },
  look: {
    palette: {
      colors: [
        { hex: "#8C1C13", score: 9, share: 0.42, role: "primary" },
        { hex: "#F4A300", score: 5, share: 0.2, role: "secondary" },
        { hex: "#FFFFFF", score: 4, share: 0.3, role: "background" },
        { hex: "#222222", score: 3, share: 0.08, role: "text" },
        { hex: "not-a-colour", score: 1, share: 0.01, role: "accent" },
      ],
      theme_color: "#8c1c13",
      contrast: [
        { pair: ["#ffffff", "#8c1c13"], ratio: 8.9, passes_aa: true, note: "White on the main colour: 8.9:1, easy to read at any size." },
        { pair: ["#ffffff", "#f4a300"], ratio: 2.1, passes_aa: false, note: "White on the second colour: 2.1:1, too faint for text; use it for decoration only." },
      ],
      sources: { theme_meta: 1, variables: 2, css_values: 9 },
    },
    fonts: {
      fonts: [
        { name: "Playfair Display", uses: 5, source: "google", role: "heading" },
        { name: "Open Sans", uses: 9, source: "google", role: "body" },
        { name: "Noto Sans Gujarati", uses: 2, source: "css", role: "unknown" },
      ],
      heading: "Playfair Display",
      body: "Open Sans",
    },
    logo_candidates: [
      { url: "https://www.jsh.example.org/wp-content/logo.png", source: "header-image", score: 9, alt: "JSH logo", width: 240, height: 80 },
      { url: "https://cdn.somewhere-else.net/shared/logo.png", source: "og-image", score: 4, alt: "", width: null, height: null },
    ],
  },
  structure: {
    nav: {
      items: [
        {
          label: "About",
          href: "/about",
          internal: true,
          children: [
            { label: "Our history", href: "/history", internal: true, children: [] },
            { label: "Leaders", href: "/leaders", internal: true, children: [] },
          ],
        },
        { label: "Events", href: "/events", internal: true, children: [] },
        { label: "Donate", href: "/give", internal: true, children: [] },
      ],
      depth: 2,
      top_level_count: 3,
      total_links: 5,
      has_dropdowns: true,
      mobile_toggle: true,
      cta: "Donate",
    },
    footer: { links: [], link_count: 12, columns: 3, has_social: true, has_newsletter: false, has_address: true, has_copyright: true },
    home_pattern: ["header", "hero", "about", "events", "donate", "newsletter", "footer", "not-a-block"],
    hero: { style: "slider", has_cta: true, tall: true, has_heading: true },
    has_search: true,
    page_kinds: { home: 1, about: 2, events: 2, donate: 1, other: 1 },
  },
  pages: [
    page("home", "/", "Home", 0.92),
    page("about", "/about", "About us", 0.81),
    page("about", "/history", "Our history", 0.55),
    page("events", "/events", "Events", 0.76),
    page("events", "/spring-fair", "Spring fair", 0.4),
    page("donate", "/give", "Give", 0.9),
    page("other", "/app/portal", "Member portal", 0.2, { built_by_scripts: true, words: 12 }),
  ],
  trimmed: 0,
};

/** A website the organization likes (mode "reference"): layout patterns only. */
export const referenceResult = {
  schema: 1,
  mode: "reference",
  site: "lovely-temple.example.net",
  crawl: { pages_fetched: 5, pages_in_sitemap: 0, stopped_by: "done" },
  notes: [{ code: "no_sitemap", count: 1 }],
  look: {
    palette: {
      colors: [
        { hex: "#1b4d3e", share: 0.5, role: "primary" },
        { hex: "#f7f3ea", share: 0.35, role: "background" },
        { hex: "#d9a441", share: 0.15, role: "accent" },
      ],
      contrast: [{ ratio: 9.4, passes_aa: true }, { ratio: 2.4, passes_aa: false }],
    },
    fonts: { heading: "Cormorant Garamond", body: "Lato", names: ["Cormorant Garamond", "Lato"] },
  },
  structure: {
    nav: { top_level_count: 6, depth: 2, has_dropdowns: true, mobile_toggle: true, has_cta: true, has_search: false, items_by_kind: { about: 1, events: 1, donate: 1 } },
    footer: { columns: 4, link_count: 18, has_social: true, has_newsletter: true, has_address: true },
    home_pattern: ["header", "hero", "about", "events", "gallery", "donate", "footer"],
    hero: { style: "video", has_cta: false, tall: true },
    logo: { present: true, in_header: true },
    page_kinds: { home: 1, about: 1, events: 2, donate: 1 },
  },
  density: { text: "sparse", avg_words: 140, avg_images: 5.5, avg_sections: 6, avg_links: 30, imagery: "image-led" },
  pages: [{ kind: "home", confidence: 0.9, depth: 0, layout: ["header", "hero", "footer"], words: "some", images: "many", headings: 6, has_form: false, has_events: true, has_donate: true }],
};

/**
 * A reference report that holds what it never should (a sentence, a page address, an image address, a logo, contact
 * details, a sentence posing as a font name, a made-up kind). Only a faulty crawl could save this; the screen must
 * still show none of it.
 */
export const hostileReferenceResult = {
  ...referenceResult,
  site: "lovely-temple.example.net",
  start_url: "https://lovely-temple.example.net/secret-start",
  title: "HOSTILE-TITLE Lovely Temple",
  organization: { name: "HOSTILE-NAME", description: "HOSTILE-SENTENCE we welcome every family to our temple each week", contact: { emails: ["hostile@lovely-temple.example.net"] } },
  look: {
    ...referenceResult.look,
    fonts: { heading: "Cormorant Garamond", body: "Lato", names: ["Cormorant Garamond", "HOSTILE-SENTENCE we welcome every family to our temple each week", "Lato"] },
    logo_candidates: [{ url: "https://lovely-temple.example.net/HOSTILE-LOGO.png", alt: "HOSTILE-ALT", source: "header-image" }],
  },
  pages: [
    {
      ...referenceResult.pages[0],
      url: "https://lovely-temple.example.net/HOSTILE-PAGE-URL",
      title: "HOSTILE-PAGE-TITLE",
      sections: [{ heading: "HOSTILE-HEADING", excerpt: "HOSTILE-EXCERPT a paragraph of somebody else's writing", chars: 50 }],
      images: [{ src: "https://lovely-temple.example.net/img/HOSTILE-IMAGE.jpg", alt: "HOSTILE-ALT", role: "photo" }],
    },
  ],
  notes: [
    { code: "no_sitemap", count: 1 },
    { code: "HOSTILE-CODE we welcome you", count: 3 },
  ],
};
