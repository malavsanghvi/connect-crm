// Setup › Your website (B92, phase W2): what the organization gives (its own website and up to three it likes), how the
// reads are doing, and "What we found" built from the finished reads (the job result of worker/src/handlers/site.crawl.ts).
//
// Plain functions only (no database, no React), so every rule here is tested on its own (tests/site-found.test.ts).
// Nothing in this file trusts the shape of a report: a read is parsed field by field into a small view, and a field that
// is not what was expected is left out. COPYRIGHT (plan §6): the view of a website the organization LIKES carries layout
// patterns only (section order, menu depth, colours, font names, density); it is built from a whitelist of numbers, yes/no
// values, colours, font names and fixed words, so no sentence of that site's text and no image or page address can reach
// the screen, whatever the report held.

export const MAX_REFERENCES = 3;
export const MAX_READS_PER_HOUR = 8;

export const SLOTS = ["own", "ref1", "ref2", "ref3"] as const;
export type Slot = (typeof SLOTS)[number];
export const isSlot = (v: unknown): v is Slot => typeof v === "string" && (SLOTS as readonly string[]).includes(v);
export const slotLabel = (slot: Slot): string => (slot === "own" ? "Your website" : `A website you like (${slot.slice(3)})`);

// ── One website address ──────────────────────────────────────────────────────
// The database (app.site_clean_address, migration 0640) is the judge and writes the address; this check gives the same
// answers before anything is sent, in the same words, and is what the tests pin down.
export type Clean = { ok: true; address: string | null } | { ok: false; error: string };

const PRIVATE_SUFFIX = /(^|\.)(localhost|local|internal|lan|home|corp|intranet|test|example|invalid|arpa)$/;
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+(xn--[a-z0-9-]{2,59}|[a-z]{2,63})$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** The address as the crawl will be given it, null for a blank, or the plain sentence saying what is wrong. */
export function cleanSiteAddress(raw: string): Clean {
  let v = (raw ?? "").trim();
  if (v === "") return { ok: true, address: null };
  const shown = v.slice(0, 80);
  if (v.length > 2000) return { ok: false, error: `"${shown}…" is too long to be a website address.` };
  if (/\s/.test(v)) return { ok: false, error: `"${shown}" has a space in it. A website address has none, for example https://www.example.org.` };
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !SCHEME.test(v) && !/^[a-z0-9.-]+:[0-9]+([/?#]|$)/i.test(v)) {
    return { ok: false, error: `"${shown}" is not a website address. It must start with http:// or https://.` };
  }
  if (!SCHEME.test(v)) v = `https://${v}`; // "www.example.org" means https://www.example.org
  if (!/^https?:\/\//i.test(v)) return { ok: false, error: `"${shown}" is not a web address. It must start with http:// or https://.` };
  const m = /^https?:\/\/([^/?#]*)([/?#].*)?$/i.exec(v);
  if (!m || m[1] === "") return { ok: false, error: `"${shown}" is not a website address. Try something like https://www.example.org.` };
  const authority = m[1]!;
  if (authority.includes("@")) return { ok: false, error: `"${shown}" has a user name or password in it. Give only the website's address.` };
  const hp = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(authority);
  if (!hp) return { ok: false, error: `"${shown}" is not a website address. Use the website's name, for example https://www.example.org.` };
  const host = hp[1]!.toLowerCase().replace(/\.$/, "");
  if (hp[2] !== undefined && (Number(hp[2]) < 1 || Number(hp[2]) > 65535)) return { ok: false, error: `"${shown}" has a port number that does not exist.` };
  if (/^[0-9.]+$/.test(host) || !host.includes(".") || PRIVATE_SUFFIX.test(host)) {
    return {
      ok: false,
      error: `"${shown}" points to a private network or to something that is not a website name. Only public websites can be read, and they are given by name, for example https://www.example.org.`,
    };
  }
  if (!DOMAIN.test(host)) return { ok: false, error: `"${shown}" is not a website name. Try something like https://www.example.org.` };
  return { ok: true, address: v };
}

/** Which website an address is on: lower-case, no "www.", no page. Two addresses on one website share it. */
export function hostKey(address: string): string {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(address.trim());
  return (m ? m[1]! : address).toLowerCase().replace(/^www\./, "");
}

export type CheckedInputs = { ok: true; own: string; refs: string[] } | { ok: false; error: string };

/**
 * The organization's own website and the websites it likes, checked the way the database checks them: http(s) only, public
 * names only, at most 3 liked websites (repeats kept once), the organization's own website not listed as one it likes.
 * Returns the raw (trimmed) strings: the database writes the final form.
 */
export function checkSiteInputs(own: string, refs: readonly string[]): CheckedInputs {
  const ownClean = cleanSiteAddress(own ?? "");
  if (!ownClean.ok) return { ok: false, error: ownClean.error };
  const seen: string[] = [];
  const kept: string[] = [];
  for (const raw of refs ?? []) {
    const c = cleanSiteAddress(raw ?? "");
    if (!c.ok) return { ok: false, error: c.error };
    if (c.address === null) continue;
    const key = hostKey(c.address);
    if (ownClean.address !== null && key === hostKey(ownClean.address)) {
      return { ok: false, error: `"${raw.trim().slice(0, 80)}" is the organization's own website. List websites you like in the other boxes, or clear this one.` };
    }
    if (seen.includes(key)) continue;
    seen.push(key);
    kept.push(raw.trim());
  }
  if (kept.length > MAX_REFERENCES) {
    return { ok: false, error: `You can give at most ${MAX_REFERENCES} websites you like (this was ${kept.length}). Remove ${kept.length - MAX_REFERENCES} and save again.` };
  }
  return { ok: true, own: (own ?? "").trim(), refs: kept };
}

// ── Small readers for data of an unknown shape ───────────────────────────────
export type Rec = Record<string, unknown>;
export const rec = (v: unknown): Rec | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const bool = (v: unknown): boolean => v === true;
const HEX = /^#[0-9a-f]{6}$/i;
export const hex = (v: unknown): string | null => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null);
// A font name is short: letters, digits, spaces, hyphens, at most 40 characters and 4 words. Anything longer is not a font name.
const FONT = /^[\p{L}\p{N}][\p{L}\p{N} _'-]{0,39}$/u;
export const fontName = (v: unknown): string | null => (typeof v === "string" && FONT.test(v.trim()) && v.trim().split(/\s+/).length <= 4 ? v.trim() : null);
const HOST = /^[a-z0-9.-]{1,120}$/;
const hostOf = (v: unknown): string => (typeof v === "string" && HOST.test(v.toLowerCase()) ? v.toLowerCase() : "");
export const strs = (v: unknown, max = 300, limit = 20): string[] => arr(v).map((x) => str(x, max)).filter(Boolean).slice(0, limit);

/** An address that is safe to put in a link or an image: http or https, no user name. */
export function webAddress(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2000) return null;
  try {
    const u = new URL(v.trim());
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Is the address on the given website (or one of its own subdomains)? Images from anywhere else are not shown. */
export function onSite(address: string, site: string): boolean {
  const key = site.toLowerCase().replace(/^www\./, "");
  if (!key) return false;
  const host = hostKey(address);
  return host === key || host.endsWith(`.${key}`);
}

// ── Words ────────────────────────────────────────────────────────────────────
export const KIND_LABELS: Record<string, string> = {
  home: "Home page",
  about: "About us",
  events: "Events",
  calendar: "Calendar",
  donate: "Giving and donations",
  contact: "Contact",
  school: "School and classes",
  gallery: "Photos",
  news: "News",
  leadership: "Leaders and board",
  membership: "Membership",
  other: "Other pages",
};
export const KIND_ORDER = ["home", "about", "events", "calendar", "donate", "school", "membership", "leadership", "news", "gallery", "contact", "other"] as const;

export const BLOCK_LABELS: Record<string, string> = {
  header: "Top bar and menu",
  hero: "Big banner",
  about: "About us",
  events: "Events",
  gallery: "Photo gallery",
  donate: "Giving",
  news: "News",
  contact: "Contact details",
  newsletter: "Newsletter sign-up",
  leaders: "Leaders",
  programs: "Programs",
  sponsors: "Sponsors",
  testimonials: "Quotes from members",
  map: "Map",
  cta: "Call to action",
  content: "Text section",
  footer: "Footer",
};

const ROLE_LABELS: Record<string, string> = {
  primary: "Main colour",
  secondary: "Second colour",
  accent: "Accent",
  background: "Page background",
  text: "Text",
  neutral: "Neutral",
};

const SOURCE_LABELS: Record<string, string> = {
  "header-image": "Picture in the page header",
  "named-logo": "Image named as a logo",
  "json-ld": "Logo the site declares for search engines",
  "apple-touch-icon": "Home-screen icon",
  icon: "Browser tab icon",
  "og-image": "Picture used when the page is shared",
};

const HERO_STYLE: Record<string, string> = {
  image: "a big picture",
  slider: "a sliding set of pictures",
  video: "a video",
  text: "a heading and a few words",
};

/** How sure the page's kind is: under 0.5 is best checked by a person. */
export function confidenceWords(c: number): { label: string; level: "sure" | "probably" | "unsure" } {
  const pct = Math.round(Math.max(0, Math.min(1, c)) * 100);
  if (c >= 0.7) return { label: `Sure (${pct}%)`, level: "sure" };
  if (c >= 0.5) return { label: `Probably (${pct}%)`, level: "probably" };
  return { label: `Not sure (${pct}%) — please check`, level: "unsure" };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const NOTE_TEXT: Record<string, (n: number) => string> = {
  no_sitemap: () => "The site has no sitemap, so its pages were found by following links.",
  sitemap_unreadable: () => "The site's sitemap could not be read right now, so its pages were found by following links.",
  scripts_built: (n) => `${plural(n, "page")} ${n === 1 ? "has" : "have"} very little text because ${n === 1 ? "it is" : "they are"} built by scripts. A person should look at ${n === 1 ? "it" : "them"}.`,
  off_site_redirect: (n) => `${plural(n, "link")} ${n === 1 ? "was" : "were"} not followed because ${n === 1 ? "it leads" : "they lead"} to another website.`,
  robots_skipped: (n) => `${plural(n, "page")} ${n === 1 ? "was" : "were"} skipped because the site asks robots not to read ${n === 1 ? "it" : "them"}.`,
  page_errors: (n) => `${plural(n, "page")} could not be read.`,
  time_limit: () => "The read stopped at its time limit, so later pages were not read.",
  byte_limit: () => "The read stopped at its size limit, so later pages were not read.",
  page_limit: () => "The read stopped at the page limit; the site has more pages than were read.",
  css_skipped_other_host: (n) => `${plural(n, "style file")} ${n === 1 ? "is" : "are"} kept on another website and ${n === 1 ? "was" : "were"} not read, so the colours and fonts may be incomplete.`,
  css_unreadable: (n) => `${plural(n, "style file")} could not be read.`,
  page_too_large: (n) => `${plural(n, "page")} ${n === 1 ? "is" : "are"} larger than 2 MB and ${n === 1 ? "was" : "were"} skipped.`,
  not_html: (n) => `${plural(n, "address", "addresses")} ${n === 1 ? "is" : "are"} not a web page and ${n === 1 ? "was" : "were"} skipped.`,
};

/** The read's notes in plain English. Only codes this screen knows are worded; anything else is left out. */
export function describeNotes(notes: unknown): string[] {
  const out: string[] = [];
  for (const raw of arr(notes)) {
    const n = rec(raw);
    const code = n ? str(n.code, 40) : "";
    const f = NOTE_TEXT[code];
    if (f) out.push(f(Math.max(1, Math.round(num(n!.count)))));
  }
  return out;
}

const STOPPED: Record<string, string> = {
  max_pages: "It stopped at the page limit, so the site has more pages than were read.",
  time: "It stopped at its time limit, so later pages were not read.",
  bytes: "It stopped at its size limit, so later pages were not read.",
};

/** What a contrast ratio means for text, in words a committee can use. */
export function contrastWords(ratio: number): { ok: boolean; words: string } {
  if (ratio >= 7) return { ok: true, words: "easy to read at any size" };
  if (ratio >= 4.5) return { ok: true, words: "good for text" };
  if (ratio >= 3) return { ok: false, words: "fine for large headings and buttons, too faint for small text" };
  return { ok: false, words: "too faint for text; use it for decoration only" };
}

// ── The views ────────────────────────────────────────────────────────────────
export type PageLine = { title: string; path: string; confidence: number; sure: "sure" | "probably" | "unsure"; sureWords: string; scripts: boolean };
export type KindGroup = { kind: string; label: string; count: number; pages: PageLine[]; hiddenPages: number };
export type Swatch = { hex: string; role: string; roleLabel: string; percent: number };
export type ContrastLine = { foreground: string; background: string; ratio: number; ok: boolean; text: string };
export type MenuItem = { label: string; children: string[]; moreChildren: number };
export type MenuView = { depth: number; topLevel: number; totalLinks: number; dropdowns: boolean; mobileToggle: boolean; button: string | null; items: MenuItem[]; moreItems: number };
export type FooterView = { columns: number; linkCount: number; social: boolean; newsletter: boolean; address: boolean; copyright: boolean };
export type LogoView = { url: string; alt: string; width: number | null; height: number | null; source: string; shown: boolean };

export type OwnView = {
  mode: "own";
  site: string;
  pagesRead: number;
  pagesInSitemap: number;
  notes: string[];
  stopped: string | null;
  organization: {
    name: string | null;
    description: string;
    languages: string[];
    emails: string[];
    phones: string[];
    addresses: string[];
    social: { network: string; url: string }[];
    donate: { label: string; url: string }[];
  };
  groups: KindGroup[];
  notSure: number;
  homeSections: { kind: string; label: string }[];
  hero: string | null;
  swatches: Swatch[];
  themeColor: string | null;
  contrast: ContrastLine[];
  fonts: { heading: string | null; body: string | null; others: string[] };
  logos: LogoView[];
  menu: MenuView | null;
  footer: FooterView | null;
  hasSearch: boolean;
  scriptPages: { title: string; path: string }[];
  trimmed: boolean;
};

export type ReferenceView = {
  mode: "reference";
  site: string;
  pagesRead: number;
  notes: string[];
  stopped: string | null;
  homeSections: { kind: string; label: string }[];
  hero: string | null;
  menu: { depth: number; topLevel: number; dropdowns: boolean; mobileToggle: boolean; button: boolean; search: boolean } | null;
  footer: { columns: number; linkCount: number; social: boolean; newsletter: boolean; address: boolean } | null;
  swatches: Swatch[];
  contrast: { ratio: number; ok: boolean; words: string }[];
  fonts: { heading: string | null; body: string | null; others: string[] };
  density: { text: string; avgWords: number; avgImages: number; avgSections: number; imagery: string } | null;
  kinds: { kind: string; label: string; count: number }[];
  logoPresent: boolean;
};

export type FoundView = OwnView | ReferenceView;

function swatchesOf(colors: unknown, roleKey = "role"): Swatch[] {
  const out: Swatch[] = [];
  for (const raw of arr(colors)) {
    const c = rec(raw);
    const h = c ? hex(c.hex) : null;
    if (!c || !h) continue;
    const role = str(c[roleKey], 20);
    out.push({ hex: h, role, roleLabel: ROLE_LABELS[role] ?? "Colour", percent: Math.max(0, Math.min(100, Math.round(num(c.share) * 100))) });
  }
  return out.slice(0, 12);
}

function fontsOf(v: unknown, extra: unknown[] = []): { heading: string | null; body: string | null; others: string[] } {
  const f = rec(v);
  const heading = f ? fontName(f.heading) : null;
  const body = f ? fontName(f.body) : null;
  const names = [...arr(f?.names), ...extra].map(fontName).filter((x): x is string => x !== null);
  const others = [...new Set(names)].filter((n) => n !== heading && n !== body).slice(0, 8);
  return { heading, body, others };
}

function kindsOf(v: unknown): { kind: string; label: string; count: number }[] {
  const o = rec(v);
  if (!o) return [];
  return KIND_ORDER.filter((k) => num(o[k]) > 0).map((k) => ({ kind: k, label: KIND_LABELS[k]!, count: Math.round(num(o[k])) }));
}

function sectionsOf(v: unknown): { kind: string; label: string }[] {
  return arr(v)
    .map((x) => (typeof x === "string" && BLOCK_LABELS[x] ? x : null))
    .filter((x): x is string => x !== null)
    .slice(0, 30)
    .map((kind) => ({ kind, label: BLOCK_LABELS[kind]! }));
}

function heroWords(style: unknown, cta: boolean, tall: boolean): string | null {
  const s = typeof style === "string" ? HERO_STYLE[style] : undefined;
  if (!s) return null;
  return `A ${tall ? "tall " : ""}banner at the top with ${s}${cta ? " and a button" : ""}.`;
}

/** Why the read stopped early, unless one of the notes already says so. */
function stoppedWords(v: unknown, notes: unknown): string | null {
  if (arr(notes).some((n) => ["page_limit", "time_limit", "byte_limit"].includes(str(rec(n)?.code, 40)))) return null;
  return typeof v === "string" ? (STOPPED[v] ?? null) : null;
}

/** The own-website view: everything the organization may keep, grouped for reading. */
function ownView(r: Rec): OwnView {
  const site = hostOf(r.site);
  const crawl = rec(r.crawl) ?? {};
  const org = rec(r.organization) ?? {};
  const contact = rec(org.contact) ?? {};
  const look = rec(r.look) ?? {};
  const palette = rec(look.palette) ?? {};
  const structure = rec(r.structure) ?? {};

  const pages: (PageLine & { kind: string })[] = [];
  for (const raw of arr(r.pages)) {
    const p = rec(raw);
    if (!p) continue;
    const kind = typeof p.kind === "string" && KIND_LABELS[p.kind] ? p.kind : "other";
    const path = str(p.path, 200) || "/";
    const conf = Math.max(0, Math.min(1, num(p.confidence)));
    const w = confidenceWords(conf);
    pages.push({ kind, title: str(p.title, 120) || path, path, confidence: conf, sure: w.level, sureWords: w.label, scripts: bool(p.built_by_scripts) });
  }
  const groups: KindGroup[] = KIND_ORDER.flatMap((kind) => {
    const inKind = pages.filter((p) => p.kind === kind);
    if (inKind.length === 0) return [];
    const shown = inKind.slice(0, 40).map((p): PageLine => ({ title: p.title, path: p.path, confidence: p.confidence, sure: p.sure, sureWords: p.sureWords, scripts: p.scripts }));
    return [{ kind, label: KIND_LABELS[kind]!, count: inKind.length, pages: shown, hiddenPages: inKind.length - shown.length }];
  });

  const hero = rec(structure.hero);
  const navRaw = rec(structure.nav);
  const menu: MenuView | null = navRaw
    ? {
        depth: Math.max(1, Math.round(num(navRaw.depth))),
        topLevel: Math.round(num(navRaw.top_level_count)),
        totalLinks: Math.round(num(navRaw.total_links)),
        dropdowns: bool(navRaw.has_dropdowns),
        mobileToggle: bool(navRaw.mobile_toggle),
        button: str(navRaw.cta, 60) || null,
        items: arr(navRaw.items)
          .slice(0, 12)
          .map((x): MenuItem | null => {
            const it = rec(x);
            const label = it ? str(it.label, 60) : "";
            if (!it || !label) return null;
            const kids = arr(it.children).map((k) => str(rec(k)?.label, 60)).filter(Boolean);
            return { label, children: kids.slice(0, 8), moreChildren: Math.max(0, kids.length - 8) };
          })
          .filter((x): x is MenuItem => x !== null),
        moreItems: Math.max(0, arr(navRaw.items).length - 12),
      }
    : null;
  const f = rec(structure.footer);
  const footer: FooterView | null = f
    ? { columns: Math.round(num(f.columns)), linkCount: Math.round(num(f.link_count)), social: bool(f.has_social), newsletter: bool(f.has_newsletter), address: bool(f.has_address), copyright: bool(f.has_copyright) }
    : null;

  const logos: LogoView[] = [];
  for (const raw of arr(look.logo_candidates)) {
    const l = rec(raw);
    const url = l ? webAddress(l.url) : null;
    if (!l || !url) continue;
    const w = num(l.width);
    const h = num(l.height);
    logos.push({ url, alt: str(l.alt, 120), width: w > 0 ? w : null, height: h > 0 ? h : null, source: SOURCE_LABELS[str(l.source, 30)] ?? "Picture on the site", shown: onSite(url, site) });
  }

  const contrast: ContrastLine[] = [];
  for (const raw of arr(palette.contrast)) {
    const c = rec(raw);
    const pair = arr(c?.pair);
    const fg = hex(pair[0]);
    const bg = hex(pair[1]);
    if (!c || !fg || !bg) continue;
    const ratio = Math.round(num(c.ratio) * 10) / 10;
    const note = str(c.note, 160);
    contrast.push({ foreground: fg, background: bg, ratio, ok: bool(c.passes_aa), text: /^[A-Za-z0-9 ,.:;%-]{1,160}$/.test(note) ? note : `${ratio}:1, ${contrastWords(ratio).words}.` });
  }

  const social: { network: string; url: string }[] = [];
  for (const raw of arr(org.social)) {
    const s = rec(raw);
    const url = s ? webAddress(s.url) : null;
    if (s && url) social.push({ network: str(s.network, 30) || "Link", url });
  }
  const donate: { label: string; url: string }[] = [];
  for (const raw of arr(org.donate_links)) {
    const d = rec(raw);
    const url = d ? webAddress(d.url) : null;
    if (d && url) donate.push({ label: str(d.label, 60) || "Give", url });
  }

  const hasHero = hero ? heroWords(hero.style, bool(hero.has_cta), bool(hero.tall)) : null;
  return {
    mode: "own",
    site,
    pagesRead: Math.round(num(crawl.pages_fetched)),
    pagesInSitemap: Math.round(num(crawl.pages_in_sitemap)),
    notes: describeNotes(r.notes),
    stopped: stoppedWords(crawl.stopped_by, r.notes),
    organization: {
      name: str(org.name, 120) || null,
      description: str(org.description, 400),
      languages: strs(org.languages, 20, 4),
      emails: strs(contact.emails, 120, 3),
      phones: strs(contact.phones, 40, 3),
      addresses: strs(contact.addresses, 200, 2),
      social: social.slice(0, 8),
      donate: donate.slice(0, 5),
    },
    groups,
    notSure: pages.filter((p) => p.sure === "unsure").length,
    homeSections: sectionsOf(structure.home_pattern),
    hero: hasHero,
    swatches: swatchesOf(palette.colors),
    themeColor: hex(palette.theme_color),
    contrast,
    fonts: fontsOf(look.fonts, arr(rec(look.fonts)?.fonts).map((x) => rec(x)?.name)),
    logos: logos.slice(0, 6),
    menu,
    footer,
    hasSearch: bool(structure.has_search),
    scriptPages: pages.filter((p) => p.scripts).slice(0, 20).map((p) => ({ title: p.title, path: p.path })),
    trimmed: num(r.trimmed) > 0,
  };
}

const TEXT_DENSITY: Record<string, string> = {
  sparse: "short pages with little text",
  medium: "a moderate amount of text on each page",
  dense: "text-heavy pages",
};
const IMAGERY: Record<string, string> = { "text-led": "led by words more than pictures", balanced: "a balance of words and pictures", "image-led": "led by pictures more than words" };

/**
 * The view of a website the organization LIKES: patterns only. Built from a whitelist: counts, yes/no values, colours,
 * font names and fixed words. The report's pages (kinds and layouts per page) are not used here; neither is any string
 * other than a font name and the site's name, so no sentence or address of that site can appear.
 */
function referenceView(r: Rec): ReferenceView {
  const crawl = rec(r.crawl) ?? {};
  const look = rec(r.look) ?? {};
  const palette = rec(look.palette) ?? {};
  const structure = rec(r.structure) ?? {};
  const nav = rec(structure.nav);
  const foot = rec(structure.footer);
  const hero = rec(structure.hero);
  const dens = rec(r.density);
  const logo = rec(structure.logo);

  const contrast: { ratio: number; ok: boolean; words: string }[] = [];
  for (const raw of arr(palette.contrast)) {
    const c = rec(raw);
    if (!c) continue;
    const ratio = Math.round(num(c.ratio) * 10) / 10;
    contrast.push({ ratio, ok: bool(c.passes_aa), words: contrastWords(ratio).words });
  }
  const textKey = dens && typeof dens.text === "string" ? dens.text : "";
  const imageryKey = dens && typeof dens.imagery === "string" ? dens.imagery : "";
  return {
    mode: "reference",
    site: hostOf(r.site),
    pagesRead: Math.round(num(crawl.pages_fetched)),
    notes: describeNotes(r.notes),
    stopped: stoppedWords(crawl.stopped_by, r.notes),
    homeSections: sectionsOf(structure.home_pattern),
    hero: hero ? heroWords(hero.style, bool(hero.has_cta), bool(hero.tall)) : null,
    menu: nav
      ? { depth: Math.max(1, Math.round(num(nav.depth))), topLevel: Math.round(num(nav.top_level_count)), dropdowns: bool(nav.has_dropdowns), mobileToggle: bool(nav.mobile_toggle), button: bool(nav.has_cta), search: bool(nav.has_search) }
      : null,
    footer: foot ? { columns: Math.round(num(foot.columns)), linkCount: Math.round(num(foot.link_count)), social: bool(foot.has_social), newsletter: bool(foot.has_newsletter), address: bool(foot.has_address) } : null,
    swatches: swatchesOf(palette.colors),
    contrast: contrast.slice(0, 6),
    fonts: fontsOf(look.fonts),
    density:
      dens && TEXT_DENSITY[textKey]
        ? {
            text: TEXT_DENSITY[textKey]!,
            avgWords: Math.round(num(dens.avg_words)),
            avgImages: Math.round(num(dens.avg_images) * 10) / 10,
            avgSections: Math.round(num(dens.avg_sections) * 10) / 10,
            imagery: IMAGERY[imageryKey] ?? "a balance of words and pictures",
          }
        : null,
    kinds: kindsOf(structure.page_kinds),
    logoPresent: logo ? bool(logo.present) : false,
  };
}

/** A finished read (the job result) as a view, or null when it is not a report this screen understands. */
export function buildFoundView(result: unknown): FoundView | null {
  const r = rec(result);
  if (!r || r.schema !== 1) return null;
  if (r.mode === "own") return ownView(r);
  if (r.mode === "reference") return referenceView(r);
  return null;
}

// ── The saved addresses and how the reads are doing ──────────────────────────
export type SiteJob = {
  id: number;
  slot: Slot;
  mode: "own" | "reference";
  url: string;
  run: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  pagesRead: number | null;
};
export type SiteStatus = {
  ownUrl: string | null;
  referenceUrls: string[];
  savedAt: string | null;
  profileWebsite: string | null;
  jobs: SiteJob[];
  readsLastHour: number;
  maxReadsPerHour: number;
};

/** app.site_found_status's answer, or null when it is not the shape this screen expects. */
export function parseSiteStatus(data: unknown): SiteStatus | null {
  const root = rec(data);
  if (!root || !Array.isArray(root.jobs) || !Array.isArray(root.reference_urls)) return null;
  const jobs: SiteJob[] = [];
  for (const raw of root.jobs) {
    const j = rec(raw);
    if (!j || !isSlot(j.slot) || typeof j.status !== "string" || num(j.id) <= 0) continue;
    jobs.push({
      id: num(j.id),
      slot: j.slot,
      mode: j.mode === "own" ? "own" : "reference",
      url: str(j.url, 2000),
      run: str(j.run, 80) || null,
      status: j.status,
      attempts: num(j.attempts),
      maxAttempts: num(j.max_attempts),
      lastError: str(j.last_error, 500) || null,
      createdAt: str(j.created_at, 40) || null,
      finishedAt: str(j.finished_at, 40) || null,
      pagesRead: j.pages_read === null || j.pages_read === undefined ? null : Math.round(num(j.pages_read)),
    });
  }
  return {
    ownUrl: str(root.own_url, 2000) || null,
    referenceUrls: strs(root.reference_urls, 2000, MAX_REFERENCES),
    savedAt: str(root.saved_at, 40) || null,
    profileWebsite: str(root.profile_website, 2000) || null,
    jobs,
    readsLastHour: Math.round(num(root.reads_last_hour)),
    maxReadsPerHour: Math.round(num(root.max_reads_per_hour)) || MAX_READS_PER_HOUR,
  };
}

/** The address saved for a slot (null when none). */
export function addressOfSlot(status: Pick<SiteStatus, "ownUrl" | "referenceUrls">, slot: Slot): string | null {
  return slot === "own" ? status.ownUrl : (status.referenceUrls[Number(slot.slice(3)) - 1] ?? null);
}

/** The slots that have an address saved, in order. */
export function savedSlots(status: Pick<SiteStatus, "ownUrl" | "referenceUrls">): Slot[] {
  return SLOTS.filter((s) => addressOfSlot(status, s) !== null);
}

export const STALE_MS = 15 * 60_000;

export type Phase = "waiting" | "reading" | "done" | "failed" | "stale" | "cancelled";
export type JobLine = { phase: Phase; tone: "ok" | "warn" | "bad" | "muted"; label: string; detail: string };

/** One website's read, in plain English. A read queued more than 15 minutes ago and never finished is "stale". */
export function jobLine(job: SiteJob, now: Date = new Date()): JobLine {
  const created = job.createdAt ? Date.parse(job.createdAt) : NaN;
  const age = Number.isFinite(created) ? now.getTime() - created : 0;
  if (job.status === "done") {
    const n = job.pagesRead;
    return { phase: "done", tone: "ok", label: "Read", detail: n !== null ? `${plural(n, "page")} read.` : "" };
  }
  if (job.status === "failed") {
    return { phase: "failed", tone: "bad", label: "Could not read this website", detail: job.lastError ?? "Weaver could not read it, and did not say why." };
  }
  if (job.status === "cancelled") return { phase: "cancelled", tone: "muted", label: "Cancelled", detail: "" };
  if ((job.status === "queued" || job.status === "running") && age >= STALE_MS) {
    return { phase: "stale", tone: "warn", label: "Weaver did not get to this one", detail: "The background service may be busy or stopped. Try again in a few minutes." };
  }
  if (job.status === "running") return { phase: "reading", tone: "warn", label: "Reading the website…", detail: "This usually takes one to three minutes." };
  const again = job.attempts > 0 && job.lastError;
  return { phase: "waiting", tone: "warn", label: again ? "Trying again…" : "Waiting to start…", detail: again ? `The first try failed: ${job.lastError}` : "" };
}

export const isBusy = (line: JobLine): boolean => line.phase === "waiting" || line.phase === "reading";

/** Is the read of this slot a read of the address saved now? (If the address was changed since, the read is of the old one.) */
export function readIsCurrent(job: SiteJob, status: Pick<SiteStatus, "ownUrl" | "referenceUrls">): boolean {
  const saved = addressOfSlot(status, job.slot);
  return saved !== null && hostKey(saved) === hostKey(job.url);
}

/**
 * How long to wait before asking again, politely: quick at first, then slower, never faster than every 3 seconds.
 * `polls` is how many times it has already asked for this wait.
 */
export function nextPollDelay(polls: number): number {
  if (polls < 5) return 3000;
  if (polls < 15) return 6000;
  return 12000;
}
/** The screen stops asking after this long (a read that is still not done is "taking longer than usual"). */
export const GIVE_UP_AFTER_MS = 10 * 60_000;
