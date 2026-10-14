// One page's HTML to PageFacts: everything the site crawl learns from a page, before the mode decides what is kept.
// Pure: HTML text in, plain data out. No network, no scripts run (a page built by scripts is reported as such).
// Text is data, never instructions: whatever a page says to "ignore previous instructions" is just a sentence in a
// section excerpt (own mode) or nothing at all (reference mode).

import { decodeEntities, htmlToBlocks, pageTitleOf, sectionize } from "../page_text";
import { siteOf } from "../sitemap";
import { classifyPage } from "./classify";
import { findAll, findFirst, hasAncestorTag, isHidden, meta, parseHtml, parts, stripHtmlComments, textOf, withoutChrome, type El } from "./dom";
import { amountMentions, contactDetails, countForms, donateLinks, eventBlocks, extractImages, hasCalendarEmbed, hasMapEmbed, logoCandidates, personBlocks, readJsonLd, socialLinks } from "./facts";
import { layoutOf } from "./layout";
import { extractNav } from "./nav";
import type { Heading, PageFacts } from "./types";
import { isInternal, pathOf, resolveHref, shorten, unique, wordCount } from "./util";

const MAX_HEADINGS = 60;
const MAX_SECTIONS = 20;
const MAX_EXCERPT = 1200;
const MAX_LINKS = 400;
const MAX_INLINE_CSS = 400_000;

function headingTree(flat: { level: number; text: string }[]): Heading[] {
  const roots: Heading[] = [];
  const stack: Heading[] = [];
  for (const h of flat) {
    const node: Heading = { level: h.level, text: h.text, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return roots;
}

const SPA_IDS = new Set(["root", "app", "__next", "__nuxt", "___gatsby", "svelte"]);
/** An empty <div id="root"> or <div id="app">: the page is filled in by scripts. Read from the tree, not by a search of the page text. */
const spaRoot = (doc: El) => findFirst(doc, (e) => e.tag === "div" && SPA_IDS.has(e.attrs["id"] ?? "") && e.children.every((c) => c.kind === "text" && c.text.trim() === "")) !== null;
const NEEDS_JS = /enable javascript|requires javascript|javascript is (required|disabled)|turn on javascript/i;

export function extractPage(rawHtml: string, url: string, opts: { isStart?: boolean } = {}): PageFacts {
  // Comments first, in one pass: a page of unfinished comments cannot slow the readers down.
  const html = stripHtmlComments(rawHtml);
  const doc = parseHtml(html);
  const { head, body } = parts(doc);
  const baseEl = findFirst(doc.root, "base");
  const base = resolveHref(baseEl?.attrs["href"], url) ?? url;
  const site = siteOf(url) ?? "";

  const titleEl = findFirst(doc.root, "title");
  const title = titleEl ? shorten(decodeEntities((titleEl.raw ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(), 200) : "";
  const shortTitle = pageTitleOf(html);
  const description = shorten(meta(doc, "description") || meta(doc, "og:description"), 300);
  const lang = (findFirst(doc.root, "html")?.attrs["lang"] ?? "").toLowerCase().slice(0, 12);

  // Headings, outside menus and footers and not hidden.
  const flatHeadings: { level: number; text: string }[] = [];
  for (const h of findAll(body, (e) => /^h[1-6]$/.test(e.tag))) {
    if (hasAncestorTag(h, ["nav", "footer"]) || isHidden(h)) continue;
    const text = shorten(textOf(h, 300), 120);
    if (text && flatHeadings.length < MAX_HEADINGS) flatHeadings.push({ level: Number(h.tag[1]), text });
  }
  const h1 = flatHeadings.find((h) => h.level === 1)?.text ?? "";

  // Text: the existing reader's blocks and sections (menus, footers and scripts already dropped).
  const blocks = htmlToBlocks(html);
  const secs = sectionize(blocks);
  const words = blocks.blocks.reduce((n, b) => n + wordCount(b.text), 0);
  const sections = secs.sections.slice(0, MAX_SECTIONS).map((s) => ({ heading: shorten(s.heading, 120), excerpt: shorten(s.body.replace(/\s*\n+\s*/g, " "), MAX_EXCERPT), chars: s.body.length }));

  const { nav, footer, hasSearch } = extractNav(body, base, site);
  const { images, total: imageCount } = extractImages(body, base);
  const ld = readJsonLd(head, body);
  const ogImage = meta(doc, "og:image");
  const social = socialLinks(body, base, ld.sameAs);
  const contact = contactDetails(body, ld.addresses, ld.phones, ld.emails);
  const ev = eventBlocks(body, base, site);
  const donate = donateLinks(body, base, site);
  const forms = countForms(body);
  const bodyText = textOf(body, 200_000);
  // What the page itself says, without the header, menus and footer that every page repeats.
  const content = withoutChrome(body);
  const contentText = textOf(content, 200_000);
  const contentContact = contactDetails(content, [], [], []);

  const links = unique(
    findAll(body, "a").map((a) => resolveHref(a.attrs["href"], base)).filter((u): u is string => u !== null && isInternal(u, site)),
    (u) => u,
    MAX_LINKS,
  );

  const scripts = findAll(doc.root, "script").length;
  const noscript = findAll(doc.root, "noscript").map((n) => textOf(n, 400)).join(" ");
  const builtByScripts = contentText.length < 200 && words < 40 && (spaRoot(doc.root) || NEEDS_JS.test(noscript) || NEEDS_JS.test(bodyText) || (scripts >= 3 && contentText.length < 60));

  const isPost = meta(doc, "og:type") === "article" || /\b(posted|published|written)\b[^.]{0,40}\b(by|on)\b/i.test(contentText.slice(0, 500)) || findFirst(content, (e) => e.tag === "article" && findFirst(e, "time") !== null) !== null;
  const path = pathOf(url);
  const classification = classifyPage({
    path,
    title: shortTitle || title,
    h1,
    headings: flatHeadings.filter((h) => h.level >= 2).map((h) => h.text),
    description,
    isStart: opts.isStart === true,
    eventCount: ev.total,
    donateLinkCount: donate.length,
    formCount: forms,
    hasCalendarEmbed: hasCalendarEmbed(body),
    imageCount,
    textChars: contentText.length,
    hasContactDetails: contentContact.emails.length + contentContact.phones.length + contentContact.addresses.length > 0,
    personBlocks: personBlocks(body),
    isPost,
    amountMentions: amountMentions(contentText),
    jsonLdTypes: ld.types,
  });
  const layout = layoutOf(body, nav !== null, classification.kind === "home");

  const themeColors = [meta(doc, "theme-color"), meta(doc, "msapplication-TileColor"), ...(head ? findAll(head, "link").filter((l) => /mask-icon/i.test(l.attrs["rel"] ?? "")).map((l) => l.attrs["color"] ?? "") : [])].filter(Boolean);
  const cssLinks = unique(
    findAll(doc.root, (e) => e.tag === "link" && /stylesheet/i.test(e.attrs["rel"] ?? "") && !!e.attrs["href"]).map((l) => resolveHref(l.attrs["href"], base)).filter((u): u is string => u !== null),
    (u) => u,
    12,
  );
  const fontsLinks = unique(
    findAll(doc.root, (e) => e.tag === "link" && /fonts\.(googleapis|bunny)\.|typekit\.net|fonts\.adobe\.com/i.test(e.attrs["href"] ?? "") && !/preconnect|dns-prefetch/i.test(e.attrs["rel"] ?? "")).map((l) => l.attrs["href"]!),
    (u) => u,
    8,
  );
  let inlineCss = findAll(doc.root, "style").map((s) => s.raw ?? "").join("\n");
  if (inlineCss.length > MAX_INLINE_CSS) inlineCss = inlineCss.slice(0, MAX_INLINE_CSS);
  const styleAttrs: string[] = [];
  const walkStyles = (el: El) => {
    for (const c of el.children) {
      if (c.kind !== "el" || styleAttrs.length >= 300) continue;
      if (c.attrs["style"]) styleAttrs.push(c.attrs["style"]);
      walkStyles(c);
    }
  };
  walkStyles(body);

  const siteNameHints = [...ld.names, meta(doc, "og:site_name"), meta(doc, "application-name"), ...(/\s[|–—-]\s/.test(title) ? [title.split(/\s+[|–—-]\s+/).pop() ?? ""] : [])]
    .map((n) => shorten(n, 80))
    .filter((n) => n.length >= 3);

  return {
    url,
    path,
    title,
    short_title: shortTitle,
    description,
    lang,
    site_name: siteNameHints[0] ?? "",
    headings: headingTree(flatHeadings),
    heading_count: flatHeadings.length,
    sections,
    section_count: secs.sections.length,
    words,
    nav,
    footer,
    images,
    image_count: imageCount,
    social,
    contact,
    events: ev.events,
    event_count: ev.total,
    donate_links: donate,
    layout: layout.kinds,
    hero: layout.hero,
    forms,
    has_map: hasMapEmbed(body),
    has_calendar_embed: hasCalendarEmbed(body),
    has_search: hasSearch,
    built_by_scripts: builtByScripts,
    classification,
    links,
    json_ld_types: ld.types,
    css_links: cssLinks,
    inline_css: inlineCss,
    style_attrs: styleAttrs,
    fonts_links: fontsLinks,
    theme_colors: themeColors,
    logo_candidates: logoCandidates(head, images, base, ld.logos, ogImage),
    org_name_hints: unique(siteNameHints, (n) => n.toLowerCase(), 5),
    ld_description: ld.description,
  };
}
