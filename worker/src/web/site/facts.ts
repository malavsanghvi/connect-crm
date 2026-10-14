// Facts read from one page's tree: images (and which look like a logo, a hero photo, a photo or decoration), social
// links, contact details, event-like blocks, donate links, JSON-LD, forms, maps and calendar embeds.
// All of it is data read from the page; nothing here follows a link or runs anything.

import { findInternationalAddresses, findPhones } from "../../../../src/lib/onboarding/intl/contact-text";
import { closest, elements, findAll, findFirst, hasAncestorTag, isHidden, kids, names, textOf, type El } from "./dom";
import type { Contact, DonateLink, EventBlock, ImageFact, ImageRole, LogoCandidate, SocialLink } from "./types";
import { firstDate, firstTime, isInternal, resolveHref, shorten, unique } from "./util";

// ── Images ───────────────────────────────────────────────────────────────────────────────────────────────────────
const MAX_IMAGES = 60;
const LAZY = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-orig-file"];
const HERO_WORDS = /hero|banner|slider|carousel|jumbotron|masthead|cover|splash|billboard|swiper|slideshow|featured-image|page-header/;
const LOGO_WORDS = /logo|wordmark|crest|emblem|site-?title|brand(?!-?color)/;
const DECOR_WORDS = /spacer|pixel|blank|1x1|sprite|divider|separator|bullet|arrow|chevron|caret|\bicon\b|icon-|-icon|emoji|shape|wave|pattern|texture|ornament|flourish/;

function px(v: string | undefined): number | null {
  if (!v || /%|auto/.test(v)) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n < 20000 ? n : null;
}

function srcOf(img: El, base: string): string | null {
  const direct = img.attrs["src"];
  const cands: (string | undefined)[] = [direct && !direct.startsWith("data:") ? direct : undefined, ...LAZY.map((k) => img.attrs[k])];
  const set = img.attrs["srcset"] || img.attrs["data-srcset"] || img.attrs["data-lazy-srcset"];
  if (set) cands.push(set.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop());
  for (const c of cands) {
    const r = resolveHref(c, base);
    if (r) return r;
  }
  return null;
}

function bgUrls(el: El, base: string): string[] {
  const out: string[] = [];
  for (const raw of [el.attrs["style"], el.attrs["data-bg"], el.attrs["data-background-image"], el.attrs["data-background"]]) {
    if (!raw) continue;
    for (const m of raw.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const r = resolveHref(m[1], base);
      if (r) out.push(r);
    }
    const bare = resolveHref(raw.trim(), base);
    if (bare && !raw.includes("(") && /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(bare)) out.push(bare);
  }
  return out;
}

function fileName(src: string): string {
  try {
    return decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "").toLowerCase();
  } catch {
    return src.toLowerCase();
  }
}

export function roleOfImage(img: El | null, src: string, alt: string, w: number | null, h: number | null, ctx: { inHeader: boolean; homeLink: boolean; heroish: boolean; explicitEmptyAlt: boolean; first: boolean }): ImageRole {
  const own = `${img ? names(img) : ""} ${img?.parent ? names(img.parent) : ""} ${fileName(src)} ${alt.toLowerCase()}`;
  if (LOGO_WORDS.test(own) && (ctx.inHeader || ctx.homeLink || /logo/.test(own)) && !/sponsor|partner|supporter|member/.test(own)) return "logo";
  if (ctx.inHeader && ctx.homeLink) return "logo";
  const tiny = (w !== null && w <= 48) || (h !== null && h <= 48);
  if (tiny || (img && ((img.attrs["role"] ?? "") === "presentation" || (img.attrs["role"] ?? "") === "none" || img.attrs["aria-hidden"] === "true")) || /doubleclick|facebook\.com\/tr|google-analytics|pixel\./i.test(src)) return "decorative";
  if (DECOR_WORDS.test(fileName(src)) && alt === "") return "decorative";
  if (ctx.heroish || (w !== null && w >= 1000) || (ctx.first && w === null && alt !== "" && !ctx.inHeader)) return "hero";
  if (ctx.explicitEmptyAlt && (w === null || w < 300)) return "decorative";
  return "photo";
}

export function extractImages(body: El, base: string): { images: ImageFact[]; total: number } {
  const seen = new Set<string>();
  const out: ImageFact[] = [];
  let total = 0;
  let first = true;
  const add = (src: string, alt: string, w: number | null, h: number | null, el: El, img: El | null) => {
    if (seen.has(src)) return;
    seen.add(src);
    total++;
    if (out.length >= MAX_IMAGES) return;
    const inHeader = closest(el, (p) => p.tag === "header" || p.tag === "nav" || (p.attrs["role"] ?? "") === "banner") !== null;
    const link = closest(el, (p) => p.tag === "a");
    const homeLink = link !== null && /^(\/|\.\/|index\.\w+|https?:\/\/[^/]+\/?)$/.test((link.attrs["href"] ?? "").trim());
    const heroish = closest(el, (p) => HERO_WORDS.test(names(p))) !== null || HERO_WORDS.test(names(el));
    const role = roleOfImage(img, src, alt, w, h, { inHeader, homeLink, heroish, explicitEmptyAlt: img !== null && img.attrs["alt"] === "", first });
    if (role !== "decorative" && role !== "logo") first = false;
    out.push({ src, alt: shorten(alt, 160), width: w, height: h, role });
  };
  for (const el of elements(body)) {
    if (isHiddenImageContext(el)) continue;
    if (el.tag === "img") {
      const src = srcOf(el, base);
      if (src) add(src, el.attrs["alt"] ?? el.attrs["title"] ?? "", px(el.attrs["width"]), px(el.attrs["height"]), el, el);
    } else if (el.tag === "video" && el.attrs["poster"]) {
      const src = resolveHref(el.attrs["poster"], base);
      if (src) add(src, "", null, null, el, null);
    }
    for (const src of bgUrls(el, base)) add(src, "", null, null, el, null);
  }
  return { images: out, total };
}

function isHiddenImageContext(el: El): boolean {
  return el.tag === "script" || el.tag === "style" || (el.tag === "template") || isHidden(el) && !/slide|carousel|tab/.test(names(el));
}

// ── Logo candidates (from the page head and header) ──────────────────────────────────────────────────────────────
export function logoCandidates(head: El | null, images: ImageFact[], base: string, jsonLdLogo: string[], ogImage: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  for (const i of images) {
    if (i.role === "logo") out.push({ url: i.src, source: /logo/.test(fileName(i.src) + i.alt.toLowerCase()) ? "named-logo" : "header-image", score: /logo/.test(fileName(i.src) + i.alt.toLowerCase()) ? 10 : 8, alt: i.alt, width: i.width, height: i.height });
  }
  for (const l of jsonLdLogo) {
    const u = resolveHref(l, base);
    if (u) out.push({ url: u, source: "json-ld", score: 9, alt: "", width: null, height: null });
  }
  if (head) {
    for (const link of findAll(head, "link")) {
      const rel = (link.attrs["rel"] ?? "").toLowerCase();
      const u = resolveHref(link.attrs["href"], base);
      if (!u) continue;
      const size = px((link.attrs["sizes"] ?? "").split("x")[0]);
      if (rel.includes("apple-touch-icon")) out.push({ url: u, source: "apple-touch-icon", score: 5, alt: "", width: size, height: size });
      else if (rel === "icon" || rel === "shortcut icon") out.push({ url: u, source: "icon", score: 3, alt: "", width: size, height: size });
    }
  }
  const og = resolveHref(ogImage, base);
  if (og) out.push({ url: og, source: "og-image", score: 2, alt: "", width: null, height: null });
  return unique(out.sort((a, b) => b.score - a.score), (c) => c.url, 8);
}

// ── Social links ─────────────────────────────────────────────────────────────────────────────────────────────────
const NETWORKS: [string, RegExp][] = [
  ["facebook", /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["x", /(^|\.)twitter\.com$|(^|\.)x\.com$/],
  ["youtube", /(^|\.)youtube\.com$|(^|\.)youtu\.be$/],
  ["linkedin", /(^|\.)linkedin\.com$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["whatsapp", /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/],
  ["pinterest", /(^|\.)pinterest\.[a-z.]+$/],
  ["threads", /(^|\.)threads\.net$/],
  ["telegram", /(^|\.)t\.me$/],
  ["flickr", /(^|\.)flickr\.com$/],
  ["vimeo", /(^|\.)vimeo\.com$/],
];
const SHARE = /sharer|share\?|\/share|intent\/|dialog\/|plugins\/|\/tr\?|login|\/hashtag\//i;

export function networkOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (SHARE.test(u.pathname + u.search) || u.pathname.replace(/\//g, "") === "") return null;
    for (const [n, re] of NETWORKS) if (re.test(u.hostname.toLowerCase())) return n;
  } catch {
    // not an address
  }
  return null;
}

export function socialLinks(body: El, base: string, extra: string[] = []): SocialLink[] {
  const found: SocialLink[] = [];
  for (const a of findAll(body, "a")) {
    const u = resolveHref(a.attrs["href"], base);
    const n = u ? networkOf(u) : null;
    if (u && n) found.push({ network: n, url: u });
  }
  for (const e of extra) {
    const u = resolveHref(e, base);
    const n = u ? networkOf(u) : null;
    if (u && n) found.push({ network: n, url: u });
  }
  return unique(found, (s) => s.network + "|" + s.url.replace(/\/$/, "").toLowerCase(), 12);
}

// ── Contact details ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Email addresses in a text. Looks around each @ only (at most 64 characters before it and 255 after), so a huge page
 * with no @ in it, or one long run of letters, costs one pass and never a quadratic search.
 */
export function findEmails(text: string): string[] {
  const out: string[] = [];
  let at = text.indexOf("@");
  for (let n = 0; at !== -1 && n < 400; n++, at = text.indexOf("@", at + 1)) {
    const local = /[A-Za-z0-9._%+-]+$/.exec(text.slice(Math.max(0, at - 64), at));
    const domain = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.exec(text.slice(at + 1, at + 256));
    if (local && domain) out.push(`${local[0]}@${domain[0]}`);
  }
  return out;
}
const US_ADDRESS = /\b\d{1,6}\s+(?:[A-Z0-9][A-Za-z0-9.'-]*\s+){1,4}?(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Highway|Hwy|Parkway|Pkwy|Place|Pl|Circle|Cir|Freeway|Fwy)\b\.?(?:,?\s*(?:Suite|Ste|Unit|Apt|Building|Bldg|#)\.?\s*[\w-]+)?,?\s+[A-Z][A-Za-z.'-]+(?:\s[A-Z][A-Za-z.'-]+){0,2},?\s+[A-Z]{2}\.?\s+\d{5}(?:-\d{4})?/g;

export function contactDetails(body: El, jsonLdAddresses: string[], jsonLdPhones: string[], jsonLdEmails: string[]): Contact {
  const emails: string[] = [...jsonLdEmails];
  const phones: string[] = [...jsonLdPhones];
  const addresses: string[] = [...jsonLdAddresses];
  for (const a of findAll(body, "a")) {
    const h = (a.attrs["href"] ?? "").trim();
    if (/^mailto:/i.test(h)) emails.push(decodeURIComponent(h.slice(7)).split("?")[0]!.trim());
    else if (/^tel:/i.test(h)) phones.push(textOf(a, 60) || h.slice(4));
  }
  const text = textOf(body, 200_000);
  emails.push(...findEmails(text));
  // North American, international (+44 ...) and labelled ("Tel: 020 ...") numbers, from the same helper the onboarding engine uses.
  phones.push(...findPhones(text));
  for (const el of findAll(body, "address")) {
    const t = textOf(el, 400);
    if (t.length >= 8) addresses.push(shorten(t, 200));
  }
  for (const m of text.matchAll(US_ADDRESS)) addresses.push(m[0].replace(/\s+/g, " ").trim());
  addresses.push(...findInternationalAddresses(text));
  const goodEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(e) && !/^(sentry|noreply|no-reply|example|user|you|name|email)@|@(example|sentry|domain|yourdomain|email)\./i.test(e);
  return {
    emails: unique(emails.map((e) => e.toLowerCase()).filter(goodEmail), (e) => e, 5),
    phones: unique(phones.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.replace(/\D/g, "").length >= 7), (p) => p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""), 5),
    addresses: unique(addresses, (a) => a.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40), 3),
  };
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────────────────────
const EVENT_TAGS = new Set(["li", "article", "tr", "div", "section", "p", "dl", "dd"]);
const EVENT_NAMES = /event|tribe|calendar|upcoming|program|ai1ec|fc-|agenda|occasion|festival/;
const POST_NAMES = /\b(post|article|blog|news|entry|story)\b/;
const POSTED = /\b(posted|published|updated|written|last modified)\b/i;
const BY_AUTHOR = /\bby [A-Z][a-z]+/;

export function eventBlocks(body: El, base: string, site: string): { events: EventBlock[]; total: number } {
  const hits: El[] = [];
  const qualifies = (el: El): boolean => {
    if (!EVENT_TAGS.has(el.tag) || isHidden(el)) return false;
    const t = textOf(el, 500);
    if (t.length < 12 || t.length > 320) return false;
    if (!firstDate(t) && !findFirst(el, (e) => e.tag === "time" && !!e.attrs["datetime"])) return false;
    if (hasAncestorTag(el, ["nav", "footer", "header"]) && !EVENT_NAMES.test(names(el))) return false;
    const nm = names(el);
    const timed = firstTime(t) !== null;
    if ((POSTED.test(t) || BY_AUTHOR.test(t)) && !timed) return false;
    if (POST_NAMES.test(nm) && !EVENT_NAMES.test(nm) && !timed) return false;
    return true;
  };
  for (const el of elements(body)) if (qualifies(el)) hits.push(el);
  // Keep the smallest: drop a block that holds another qualifying block (a list around its items).
  const set = new Set(hits);
  const smallest = hits.filter((el) => !findFirst(el, (e) => set.has(e)));
  const events: EventBlock[] = [];
  for (const el of smallest) {
    const text = textOf(el, 500);
    const timeEl = findFirst(el, (e) => e.tag === "time" && !!e.attrs["datetime"]);
    const date = firstDate(text) ?? (timeEl ? timeEl.attrs["datetime"]!.slice(0, 10) : null);
    if (!date) continue;
    const headEl = findFirst(el, (e) => /^h[1-6]$/.test(e.tag)) ?? findFirst(el, (e) => e.tag === "a" && textOf(e, 200).length >= 4 && !firstDate(textOf(e, 200))) ?? findFirst(el, (e) => (e.tag === "strong" || e.tag === "b") && textOf(e, 200).length >= 4 && textOf(e, 200) !== date);
    let title = headEl ? textOf(headEl, 300) : text.replace(date, " ").replace(/\b\d{1,2}(:\d{2})?\s*[ap]\.?m\.?/gi, " ").replace(/\s+/g, " ").trim();
    if (!title || firstDate(title) === title || title.length < 3) title = text.replace(date, " ").replace(/\s+/g, " ").trim();
    title = shorten(title, 120);
    if (title.length < 3) continue;
    const link = findFirst(el, "a");
    const href = link ? resolveHref(link.attrs["href"], base) : null;
    events.push({ title, date_text: date, time_text: firstTime(text), url: href && isInternal(href, site) ? href : href });
  }
  const list = unique(events, (e) => e.title.toLowerCase() + "|" + e.date_text, 30);
  return { events: list, total: events.length };
}

// ── Donate links ─────────────────────────────────────────────────────────────────────────────────────────────────
const DONATE_HREF = /donat|\/giving|\/give(\b|[-/_])|contribut|sponsor|pledge|tithe|support-us|zeffy\.com|givebutter|paypal\.(com|me)\/|buy\.stripe\.com|donate\.stripe|classy\.org|gofundme|donorbox|churchcenter\.com\/giving|tithe\.ly|pushpay|onlinegiving|givelify|bloomerang|networkforgood|givesmart|qgiv|keela|\.givingfuel|gives\.|virtuous/i;
const DONATE_TEXT = /^(donate|give|give now|donate now|support( us)?|make a gift|ways to give|giving|contribute|sponsor|become a sponsor|pledge|online giving|give online|tithe|donations?)\b/i;

export function donateLinks(body: El, base: string, site: string): DonateLink[] {
  const out: DonateLink[] = [];
  for (const a of findAll(body, "a")) {
    const url = resolveHref(a.attrs["href"], base);
    if (!url) continue;
    const label = shorten(textOf(a, 200) || a.attrs["aria-label"] || a.attrs["title"] || "", 80);
    if (DONATE_HREF.test(url) || DONATE_TEXT.test(label)) out.push({ label, url, external: !isInternal(url, site) });
  }
  return unique(out, (d) => d.url, 10);
}

// ── Other signals ────────────────────────────────────────────────────────────────────────────────────────────────
export function countForms(body: El): number {
  return findAll(body, (e) => e.tag === "form" && !((e.attrs["role"] ?? "") === "search" || /search/.test(names(e)) || findFirst(e, (i) => i.tag === "input" && (i.attrs["type"] ?? "") === "search"))).length;
}

export function hasMapEmbed(body: El): boolean {
  return findFirst(body, (e) => (e.tag === "iframe" && /google\.[a-z.]+\/maps|maps\.google|openstreetmap|mapbox|bing\.com\/maps/i.test(e.attrs["src"] ?? e.attrs["data-src"] ?? "")) || /\b(google-?map|gmap|map-canvas|map-embed|leaflet)\b/.test(names(e))) !== null;
}

export function hasCalendarEmbed(body: El): boolean {
  return findFirst(body, (e) => (e.tag === "iframe" && /calendar\.google|calendly|\/calendar\/embed|eventbrite|addevent|teamup|timely\.fun|localendar|trumba|planningcenter|churchcenter\.com\/calendar/i.test(e.attrs["src"] ?? e.attrs["data-src"] ?? "")) || /\b(fc-|fullcalendar|tribe-events-calendar|calendar-grid|calendar-table|ai1ec|ec-calendar|monthly-calendar|calendar-view)/.test(names(e))) !== null;
}

const ROLE_WORDS = /\b(president|vice|secretary|treasurer|chair(man|woman|person)?|director|trustee|pastor|priest|rev\.?|reverend|father|deacon|elder|board|coordinator|manager|teacher|officer|minister|pandit|swami|ceo|founder|principal|chief)\b/i;

/** Cards that look like a person (a photo, a short name, a role): a leadership page is a row of them. */
export function personBlocks(body: El): number {
  let n = 0;
  for (const el of elements(body)) {
    if (!(el.tag === "li" || el.tag === "article" || el.tag === "div" || el.tag === "figure")) continue;
    if (!findFirst(el, "img") || kids(el).length > 8) continue;
    const t = textOf(el, 400);
    if (t.length < 8 || t.length > 260 || !ROLE_WORDS.test(t)) continue;
    // The smallest card only.
    if (findFirst(el, (e) => (e.tag === "li" || e.tag === "article" || e.tag === "div" || e.tag === "figure") && !!findFirst(e, "img") && ROLE_WORDS.test(textOf(e, 400)) && textOf(e, 400).length < t.length)) continue;
    n++;
  }
  return n;
}

export function amountMentions(text: string): number {
  return (text.match(/\$\s?\d[\d,]*(?:\.\d\d)?/g) ?? []).length;
}

// ── JSON-LD ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type JsonLd = { types: string[]; names: string[]; logos: string[]; sameAs: string[]; addresses: string[]; phones: string[]; emails: string[]; description: string };

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return strings(o["url"] ?? o["@id"] ?? o["contentUrl"]);
  }
  return [];
}

export function readJsonLd(head: El | null, body: El): JsonLd {
  const out: JsonLd = { types: [], names: [], logos: [], sameAs: [], addresses: [], phones: [], emails: [], description: "" };
  const scripts = [...(head ? findAll(head, "script") : []), ...findAll(body, "script")].filter((s) => /ld\+json/i.test(s.attrs["type"] ?? ""));
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) {
      for (const n of node.slice(0, 50)) visit(n, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    const types = strings(o["@type"]);
    out.types.push(...types);
    const isOrg = types.some((t) => /organization|place|church|temple|place ?of ?worship|localbusiness|school|nonprofit|ngo|event ?venue|religiousorganization|library|club|chamber/i.test(t));
    if (isOrg) {
      if (typeof o["name"] === "string") out.names.push(o["name"]);
      out.logos.push(...strings(o["logo"]), ...strings(o["image"]).slice(0, 1));
      out.sameAs.push(...strings(o["sameAs"]));
      if (typeof o["telephone"] === "string") out.phones.push(o["telephone"]);
      if (typeof o["email"] === "string") out.emails.push(o["email"].replace(/^mailto:/i, ""));
      if (typeof o["description"] === "string" && !out.description) out.description = o["description"];
      const adr = o["address"];
      if (typeof adr === "string") out.addresses.push(adr);
      else if (adr && typeof adr === "object" && !Array.isArray(adr)) {
        const a = adr as Record<string, unknown>;
        const line = [a["streetAddress"], a["addressLocality"], [a["addressRegion"], a["postalCode"]].filter((x) => typeof x === "string" && x).join(" ")].filter((x) => typeof x === "string" && x).join(", ");
        if (line) out.addresses.push(line);
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") visit(v, depth + 1);
  };
  for (const s of scripts) {
    try {
      visit(JSON.parse((s.raw ?? "").trim()), 0);
    } catch {
      // not valid JSON: ignored
    }
  }
  out.types = unique(out.types, (t) => t, 20);
  return out;
}
