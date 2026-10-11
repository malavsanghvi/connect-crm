// A page's layout as a plain list: header, hero, about, events, gallery, donate ... footer. The "section order of the
// home page" pattern is the heart of what the reference mode keeps, and what the own mode uses to rebuild the page in
// the same order. Blocks are the top-level pieces of the page's main area (page builders wrap them in one or two
// divs, which are looked through); each is named by what it says about itself (class, id, heading, buttons) and what
// is inside it (dates, photos, a form, a map).

import { elements, findAll, findFirst, isChrome, kids, names, textOf, type El } from "./dom";
import type { BlockKind, HeroHints } from "./types";
import { countDates } from "./util";

const SKIP_TAGS = new Set(["script", "style", "noscript", "link", "meta", "template", "svg", "br", "hr"]);
const LOOSE = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "img", "figure", "table", "blockquote", "span", "a", "picture", "video", "iframe", "form", "dl", "pre"]);
const WRAPPERS = new Set(["div", "main", "article", "section"]);
const SLIDER = /slider|carousel|swiper|slick|owl|flexslider|slideshow|splide|glide/;
const HERO = /hero|banner|jumbotron|masthead|splash|billboard|cover|page-header|intro|welcome-banner|home-header|featured/;

type Rule = { kind: BlockKind; heading: RegExp; names?: RegExp };
// Checked in this order; the first whose words appear in the block's heading or class names wins (structure decides ties).
const RULES: Rule[] = [
  { kind: "newsletter", heading: /newsletter|subscribe|sign up for|stay (connected|in touch|updated)|mailing list|join our list/, names: /newsletter|subscribe|mailchimp|mc4wp/ },
  { kind: "sponsors", heading: /sponsors?|partners|supporters|our members|member (businesses|spotlight)|business partners/, names: /sponsor|partner|supporter/ },
  { kind: "testimonials", heading: /testimonials?|what (people|members|they|our \w+) say|reviews|kind words/, names: /testimonial|review|quote/ },
  { kind: "leaders", heading: /leadership|leaders|board|trustees|our team|meet (our|the)|clergy|pastors?|priests?|staff|officers|elders/, names: /leader|board|team|staff|people|clergy/ },
  { kind: "donate", heading: /donat|giv(e|ing)\b|support (us|our)|contribut|sponsor(ship)?s? (a|an|the)|fundrais|pledge|make a gift/, names: /donat|giving|\bgive\b|fundrais|pledge/ },
  { kind: "events", heading: /events?|upcoming|calendar|what'?s on|happenings|schedule|festivals?|celebrations?|programs? and events|this (week|month)/, names: /event|tribe|calendar|upcoming|agenda|schedule/ },
  { kind: "gallery", heading: /gallery|photos?|instagram|moments|memories|snapshots|pictures/, names: /gallery|photos?|instagram|masonry|lightbox|portfolio/ },
  { kind: "news", heading: /news|blog|announcements?|latest|updates|bulletin|stories|posts/, names: /\b(news|blog|posts?|announcements?|articles?)\b/ },
  { kind: "contact", heading: /contact|visit us|find us|get in touch|hours|location|directions|address|reach us|come and see/, names: /contact|location|visit|directions|address/ },
  { kind: "about", heading: /about|welcome|who we are|our (story|mission|history|community|purpose)|mission|vision|we are|since \d{4}|who is/, names: /\babout|welcome|intro|mission|story/ },
  { kind: "programs", heading: /programs?|ministries|classes|school|pathshala|youth|children|services|what we (do|offer)|initiatives|get involved|join us|membership|become a member|resources/, names: /program|ministr|service|class|school|youth|offer/ },
];

function headingTexts(el: El, n = 4): string {
  return findAll(el, (e) => /^h[1-6]$/.test(e.tag)).slice(0, n).map((h) => textOf(h, 200)).join(" | ").toLowerCase();
}

function unwrap(container: El, skipChrome: boolean): El[] {
  const keep = (c: El) => !SKIP_TAGS.has(c.tag) && !(skipChrome && isChrome(c));
  let cur = container;
  for (let i = 0; i < 4; i++) {
    const children = kids(cur).filter(keep);
    if (children.length === 1 && WRAPPERS.has(children[0]!.tag) && kids(children[0]!).length > 0 && !SLIDER.test(names(children[0]!))) cur = children[0]!;
    else return children;
  }
  return kids(cur).filter(keep);
}

/** Pieces of the main area: a section-like element is one block; loose paragraphs, headings and lists between them make one. */
function blocksOf(container: El, skipChrome: boolean): El[] {
  const out: El[] = [];
  let loose: El[] = [];
  const flush = () => {
    if (loose.length === 0) return;
    out.push({ kind: "el", tag: "div", attrs: { class: "loose" }, children: loose, parent: container });
    loose = [];
  };
  for (const c of unwrap(container, skipChrome)) {
    if (LOOSE.has(c.tag)) loose.push(c);
    else {
      flush();
      out.push(c);
    }
  }
  flush();
  return out;
}

type Signals = { text: string; chars: number; images: number; dates: number; hasForm: boolean; emailInput: boolean; map: boolean; buttons: string; heads: string; nm: string; hasHeading: boolean };

function signalsOf(el: El): Signals {
  const text = textOf(el, 3000);
  const buttons = findAll(el, (e) => e.tag === "a" || e.tag === "button").filter((e) => /\b(btn|button|cta)\b/.test(names(e)) || e.tag === "button").map((e) => textOf(e, 100)).join(" | ").toLowerCase();
  return {
    text: text.toLowerCase(),
    chars: text.length,
    images: findAll(el, "img").length,
    dates: countDates(text),
    hasForm: findFirst(el, "form") !== null || findFirst(el, "textarea") !== null,
    emailInput: findFirst(el, (e) => e.tag === "input" && /email/i.test(e.attrs["type"] ?? e.attrs["name"] ?? "")) !== null,
    map: findFirst(el, (e) => e.tag === "iframe" && /maps|openstreetmap/i.test(e.attrs["src"] ?? e.attrs["data-src"] ?? "")) !== null,
    buttons,
    heads: headingTexts(el),
    nm: [names(el), ...kids(el).slice(0, 2).map(names)].join(" "),
    hasHeading: findFirst(el, (e) => /^h[1-6]$/.test(e.tag)) !== null,
  };
}

/** A link that asks for money: its address or its words say donate, give, support, sponsor, pledge. */
function donateish(el: El): boolean {
  return findFirst(el, (e) => e.tag === "a" && (/donat|\/giv(e|ing)|support|sponsor|pledge/i.test(e.attrs["href"] ?? "") || /^(donate|give|support|sponsor|pledge)\b/i.test(textOf(e, 80)))) !== null;
}

export function classifyBlock(el: El, index: number, isHome = true): BlockKind {
  const s = signalsOf(el);
  const first = index === 0;
  if (first && (HERO.test(s.nm) || SLIDER.test(s.nm))) return "hero";
  if (first && findFirst(el, "h1") && (s.images > 0 || /background(-image)?\s*:[^;]*url\(/i.test(el.attrs["style"] ?? "") || findFirst(el, "video"))) return "hero";
  if (s.map && s.chars < 400) return "map";
  for (const r of RULES) {
    const byHead = r.heading.test(s.heads);
    const byName = r.names ? r.names.test(s.nm) : false;
    if (!byHead && !byName) continue;
    if (r.kind === "newsletter" && !s.emailInput && !byName) continue;
    if (r.kind === "events" && s.dates === 0 && !byName && !/events?|upcoming|calendar/.test(s.heads)) continue;
    return r.kind;
  }
  if (s.emailInput && s.chars < 400) return "newsletter";
  if (s.dates >= 2) return "events";
  if (s.images >= 4 && s.chars / s.images < 90) return "gallery";
  if (s.hasForm && s.chars < 800) return "contact";
  if (donateish(el) && s.chars < 500) return "donate";
  if (s.buttons !== "" && s.chars < 260) return "cta";
  // A big heading and a few words, with nothing else, opens a home page; on any other page it is just a short page.
  if (isHome && first && findFirst(el, "h1") && s.chars < 400) return "hero";
  return "content";
}

export function heroHints(el: El): HeroHints {
  const s = signalsOf(el);
  const style = findFirst(el, "video") || findFirst(el, (e) => e.tag === "iframe" && /youtube|vimeo/i.test(e.attrs["src"] ?? "")) ? "video" : SLIDER.test(s.nm) || s.images >= 3 ? "slider" : s.images > 0 || /url\(/i.test(el.attrs["style"] ?? "") || [...elements(el)].some((e) => /url\(/i.test(e.attrs["style"] ?? "")) ? "image" : "text";
  const tall = /min-height\s*:\s*(\d{3,}px|[5-9]\d\s*vh|100\s*vh)|height\s*:\s*(\d{3,}px|[6-9]\d\s*vh|100\s*vh)/i.test(el.attrs["style"] ?? "") || /full-?(height|screen)|tall|vh-?\d{2}/.test(s.nm);
  return { style, has_cta: s.buttons !== "" || findFirst(el, (e) => e.tag === "a" && /^(donate|give|join|learn more|register|visit|get started|explore|plan your visit|read more|view|rsvp|sign up)/i.test(textOf(e, 80))) !== null, tall, has_heading: s.hasHeading };
}

export type Layout = { kinds: BlockKind[]; hero: HeroHints | null };

export function layoutOf(body: El, hasNav = false, isHome = true): Layout {
  const main = findFirst(body, (e) => e.tag === "main" || (e.attrs["role"] ?? "") === "main") ?? findFirst(body, (e) => e.tag === "div" && /^(content|main|primary|page|main-content|site-content|wrapper)$/.test(e.attrs["id"] ?? ""));
  const container = main ?? body;
  const header = findFirst(body, (e) => e.tag === "header" || (e.attrs["role"] ?? "") === "banner");
  const footer = [...elements(body)].reverse().find((e) => e.tag === "footer" || (e.attrs["role"] ?? "") === "contentinfo") ?? null;

  const kinds: BlockKind[] = [];
  let hero: HeroHints | null = null;
  const headerHasNav = header !== undefined && header !== null && (findFirst(header, "nav") !== null || findFirst(header, "ul") !== null || findFirst(header, "a") !== null);
  if (headerHasNav || hasNav || findFirst(body, "nav")) kinds.push("header");

  // A header that also carries the big heading and a picture is the hero.
  let blocks = blocksOf(container, container === body);
  if (header && findFirst(header, "h1") && (HERO.test(names(header)) || findAll(header, "img").length > 1 || /url\(/i.test(header.attrs["style"] ?? ""))) {
    kinds.push("hero");
    hero = heroHints(header);
    blocks = blocks.filter((b) => b !== header);
  }
  blocks.forEach((b, i) => {
    const kind = classifyBlock(b, hero ? i + 1 : i, isHome);
    if (kind === "hero" && hero === null) hero = heroHints(b);
    if (kind === "hero" && kinds.includes("hero")) kinds.push("content");
    else kinds.push(kind);
  });
  if (footer || findFirst(body, (e) => /\bfooter\b/.test(names(e)))) kinds.push("footer");
  // Collapse repeats: a long page of paragraphs, or a heading above its photos, is one block of the pattern.
  const collapsed = kinds.filter((k, i) => k !== kinds[i - 1]);
  return { kinds: collapsed, hero };
}
