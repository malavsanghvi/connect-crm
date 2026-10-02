// From a web page's HTML to readable sections of text, with no HTML library.
//
// What is kept: the text inside <main> when the page has one, else the whole
// body minus site furniture (<nav>, <header>, <footer>, <aside>, forms, buttons,
// scripts, styles, hidden elements). A collapsed accordion or tab panel is not
// furniture: FAQ answers often sit in one (hidden, aria-hidden or display:none
// until a visitor opens it), so its text is kept (isPanel, inside a <details> or
// an accordion/FAQ/tabs container). Paragraphs, list items and headings become
// blocks; blocks are grouped into sections of a size Niva can search and cite
// (its search reads the first 4000 characters of a source, so sections stay under
// that). A page that has no readable text yields no sections: the caller says
// so plainly instead of saving an empty source.

export type Block = { text: string; heading: boolean; list: boolean };
export type PageText = { title: string; blocks: Block[] };
/**
 * title: "<page title>: <heading>" (what staff and Niva see). heading: the section's own heading (or its first
 * line), without the page title: app.niva_worker_save_import (0576) finds a section again by page + heading, so a
 * changed page title or a heading added above does not move text between sections.
 */
export type Section = { title: string; body: string; heading: string };
export type Sections = { pageTitle: string; sections: Section[]; truncated: boolean; chars: number };

export const MAX_SECTION_CHARS = 3600;
export const MAX_SECTIONS = 40;
const MIN_SECTION_CHARS = 400;

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "head", "nav", "header", "footer", "aside", "form", "select", "button", "dialog", "canvas", "object", "embed", "textarea"]);
const BLOCK = new Set(["p", "div", "li", "ul", "ol", "tr", "td", "th", "table", "section", "article", "main", "blockquote", "pre", "dt", "dd", "dl", "figure", "figcaption", "address", "details", "summary", "fieldset", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr"]);
const HEADING = /^h[1-6]$/;

// Collapsed panels: an accordion or tab panel is hidden until a visitor opens it, but its text is the page's content.
const PANEL_ROLE = /\brole\s*=\s*["']?(?:tabpanel|region)\b/i;
const PANEL_WORDS = /accordion|collaps|tab-?pane|tabpanel|tab-?content|faq|answer|disclosure|expand|toggle/i;
const CONTAINER_WORDS = /accordion|collaps|faq|disclosure|\btabs?\b|tabset|tab-?content/i;

/** class, id and data-hook / data-testid values (Wix names its FAQ parts in data-hook). */
function namesOf(attrs: string): string {
  const out: string[] = [];
  const re = /\b(?:class|id|data-hook|data-testid)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) out.push(m[1]!.replace(/^["']|["']$/g, ""));
  return out.join(" ");
}

/** An accordion or tab panel (its own attributes say so): kept even while collapsed. */
export function isPanel(attrs: string): boolean {
  return PANEL_ROLE.test(attrs) || PANEL_WORDS.test(namesOf(attrs));
}

/** An element whose collapsed children are panels: <details>, or an accordion / FAQ / tabs block. */
function isPanelContainer(tag: string, attrs: string): boolean {
  return tag === "details" || /\brole\s*=\s*["']?tablist\b/i.test(attrs) || CONTAINER_WORDS.test(namesOf(attrs));
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", laquo: "«", raquo: "»", deg: "°", times: "×", eacute: "é", egrave: "è", agrave: "à", uuml: "ü", ouml: "ö", auml: "ä", ntilde: "ñ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function tidy(s: string): string {
  return s.replace(/[​-‍⁠﻿]/g, "").replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
}

/** The page's own name: its <title> without a " | Site name" tail, else its first heading is used by the caller. */
export function pageTitleOf(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (m) {
    const t = tidy(decodeEntities(m[1]!.replace(/<[^>]*>/g, " ")));
    const head = t.split(/\s+\|\s+/)[0]!.trim();
    if (head) return head.slice(0, 160);
  }
  const og = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(html);
  if (og) {
    const t = tidy(decodeEntities(og[1]!));
    if (t) return t.slice(0, 160);
  }
  return "";
}

/** HTML to blocks of text. Never throws on malformed markup. */
export function htmlToBlocks(html: string): PageText {
  const lower = html.toLowerCase();
  const hasMain = /<main[\s>]/i.test(html);
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<[^>]*>|([^<]+)|</g;
  const blocks: Block[] = [];
  let buf = "";
  let heading = false;
  let list = false;
  let skipTag: string | null = null;
  let skipDepth = 0;
  let mainDepth = 0;
  // The outermost accordion / FAQ / tabs block we are inside (by tag name and depth, as skipTag).
  let boxTag: string | null = null;
  let boxDepth = 0;

  const flush = () => {
    const text = tidy(buf);
    const isHeading = heading;
    const isList = list;
    buf = "";
    heading = false;
    list = false;
    if (text.length < 2 || !/[\p{L}\p{N}]/u.test(text)) return;
    if (hasMain && mainDepth <= 0) return;
    const prev = blocks[blocks.length - 1];
    if (prev && prev.text === text) return;
    blocks.push({ text, heading: isHeading, list: isList });
  };

  let m: RegExpExecArray | null;
  while ((m = token.exec(html))) {
    const close = m[1]?.toLowerCase();
    const open = m[2]?.toLowerCase();
    const attrs = m[3] ?? "";
    if (skipTag) {
      if (open === skipTag) skipDepth++;
      else if (close === skipTag && --skipDepth === 0) skipTag = null;
      continue;
    }
    if (open) {
      const hiddenAttr = /\shidden(\s|=|$)/i.test(" " + attrs);
      const untilFound = /\shidden\s*=\s*["']?until-found/i.test(attrs);
      const ariaHidden = /\saria-hidden\s*=\s*["']true["']/i.test(attrs);
      const displayNone = /display\s*:\s*none/i.test(attrs);
      // Collapsed is not furniture: a panel keeps its text however it is hidden; inside an accordion, FAQ or tabs
      // block (or <details>) "hidden" and display:none mean "not opened yet". aria-hidden alone (an icon, a
      // decorative duplicate) is still dropped there. hidden="until-found" is collapsed content by definition.
      const hidden =
        !untilFound && (hiddenAttr || ariaHidden || displayNone) && !isPanel(attrs) && !(boxTag !== null && !(ariaHidden && !hiddenAttr && !displayNone));
      // An accordion's header is often a <button> ("What are the timings?"): it is the question, so its text stays.
      const accordionButton = open === "button" && (boxTag !== null || /\saria-(?:expanded|controls)\s*=/i.test(attrs));
      if ((SKIP.has(open) && !accordionButton) || (hidden && !["br", "hr", "img", "input", "meta", "link"].includes(open))) {
        flush();
        skipTag = open;
        skipDepth = 1;
        if (open === "script" || open === "style") {
          const end = lower.indexOf("</" + open, token.lastIndex);
          token.lastIndex = end === -1 ? html.length : end;
        }
        continue;
      }
      if (open === "main") {
        flush();
        mainDepth++;
      }
      if (boxTag) {
        if (open === boxTag) boxDepth++;
      } else if (isPanelContainer(open, attrs)) {
        boxTag = open;
        boxDepth = 1;
      }
      if (BLOCK.has(open)) {
        flush();
        if (HEADING.test(open)) heading = true;
        if (open === "li") list = true;
      }
      continue;
    }
    if (close) {
      if (BLOCK.has(close)) flush();
      if (close === "main") mainDepth--;
      if (boxTag && close === boxTag && --boxDepth === 0) boxTag = null;
      continue;
    }
    if (m[4] !== undefined) buf += decodeEntities(m[4]);
  }
  flush();
  return { title: pageTitleOf(html), blocks };
}

/** Split a block that is longer than one section on sentence ends, else on word breaks. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const piece of text.split(/(?<=[.!?])\s+/)) {
    if (piece.length > max) {
      if (cur) out.push(cur);
      cur = "";
      for (let rest = piece; rest.length > 0; ) {
        let cut = rest.length <= max ? rest.length : rest.lastIndexOf(" ", max);
        if (cut < max / 2) cut = Math.min(max, rest.length);
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      continue;
    }
    if (cur && cur.length + 1 + piece.length > max) {
      out.push(cur);
      cur = piece;
    } else cur = cur ? cur + " " + piece : piece;
  }
  if (cur) out.push(cur);
  return out;
}

function shorten(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.lastIndexOf(" ", n - 1);
  return s.slice(0, cut > n / 2 ? cut : n - 1).trimEnd() + "…";
}

/** Blocks to sections: start a new one at a heading (once the current one has substance) or when full. */
export function sectionize(page: PageText): Sections {
  // A page whose first text is a heading is named by it ("JSH Relocation FAQs"): many sites give every
  // page the same <title>. Otherwise the <title> is the name.
  const first = page.blocks[0];
  const pageTitle = shorten(first?.heading ? first.text : page.title || "Web page", 120);
  type Cur = { head: string | null; lines: Block[]; len: number };
  const groups: Cur[] = [];
  let cur: Cur | null = null;
  const pieces: Block[] = page.blocks.flatMap((b) => splitLong(b.text, MAX_SECTION_CHARS).map((t) => ({ ...b, text: t })));
  for (const b of pieces) {
    const full = !!cur && cur.len + b.text.length + 2 > MAX_SECTION_CHARS;
    const newTopic = !!cur && b.heading && cur.len >= MIN_SECTION_CHARS;
    if (!cur || full || newTopic) {
      // A question stays with its answer: if the last line of a full section is a question, it opens the next one.
      const carried = full && cur && cur.lines.length > 1 && /\?$/.test(cur.lines[cur.lines.length - 1]!.text) && cur.lines[cur.lines.length - 1]!.text.length <= 250 ? cur.lines.pop()! : null;
      if (carried && cur) cur.len -= carried.text.length + 2;
      cur = { head: b.heading ? b.text : null, lines: [], len: 0 };
      groups.push(cur);
      if (carried) {
        cur.lines.push(carried);
        cur.len += carried.text.length + 2;
      }
    } else if (cur.head === null && b.heading && cur.lines.length === 0) {
      cur.head = b.text;
    }
    cur.lines.push(b);
    cur.len += b.text.length + 2;
  }

  let chars = 0;
  const sections: Section[] = groups.map((g) => {
    let body = "";
    g.lines.forEach((b, i) => {
      const line = b.list ? `- ${b.text}` : b.text;
      body += i === 0 ? line : g.lines[i - 1]!.list && b.list ? `\n${line}` : `\n\n${line}`;
    });
    const label = shorten(g.head ?? g.lines[0]!.text, 90);
    const title = label.toLowerCase() === pageTitle.toLowerCase() || label.toLowerCase().startsWith(pageTitle.toLowerCase()) ? label : `${pageTitle}: ${label}`;
    chars += body.length;
    return { title: shorten(title, 200), body, heading: label };
  });
  const truncated = sections.length > MAX_SECTIONS;
  return { pageTitle, sections: sections.slice(0, MAX_SECTIONS), truncated, chars };
}
