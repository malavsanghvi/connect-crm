// A small, forgiving HTML tree for the site extractors (worker/src/web/site/*). No HTML library and no scripts are
// run: the page is read as text, once, into elements with their attributes and children, so the extractors can ask
// "which links sit inside the footer" or "what is the first block of <main>".
//
// Lenient on purpose: unclosed tags, stray end tags and odd nesting never throw. Tags that close themselves by
// the HTML rules (<li>, <p>, <td> ...) are closed. <script> and <style> keep their raw text (the palette, the fonts
// and the JSON-LD blocks are read from it); the tree stops growing at MAX_NODES, so a hostile page cannot cost more.

import { decodeEntities } from "../page_text";

export type Text = { kind: "text"; text: string; parent: El | null };
export type El = { kind: "el"; tag: string; attrs: Record<string, string>; children: Node[]; parent: El | null; raw?: string; depth?: number };
export type Node = El | Text;
export type Doc = { root: El; truncated: boolean; nodes: number };

export const MAX_NODES = 60_000;
/** Deeper than this is not nested further: a page cannot make the extractors recurse without limit. */
export const MAX_DEPTH = 120;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);
// Opening one of these closes an open one of the same group (up to the nearest container).
const IMPLIED: Record<string, { closes: string[]; stopAt: string[] }> = {
  li: { closes: ["li"], stopAt: ["ul", "ol", "menu"] },
  dt: { closes: ["dt", "dd"], stopAt: ["dl"] },
  dd: { closes: ["dt", "dd"], stopAt: ["dl"] },
  p: { closes: ["p"], stopAt: ["div", "section", "article", "li", "td", "th", "main", "body", "blockquote"] },
  option: { closes: ["option"], stopAt: ["select", "optgroup"] },
  tr: { closes: ["tr", "td", "th"], stopAt: ["table", "tbody", "thead", "tfoot"] },
  td: { closes: ["td", "th"], stopAt: ["tr", "table"] },
  th: { closes: ["td", "th"], stopAt: ["tr", "table"] },
};
const BLOCK_CLOSES_P = new Set(["div", "section", "article", "ul", "ol", "table", "h1", "h2", "h3", "h4", "h5", "h6", "header", "footer", "nav", "main", "aside", "form", "blockquote", "figure", "address", "hr"]);

const TOKEN = /<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|</gi;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(src))) {
    const name = m[1]!.toLowerCase();
    if (name in out) continue;
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** The page without its comments (one pass; a comment that never ends takes the rest of the page). Linear, whatever the page holds. */
export function stripHtmlComments(html: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = html.indexOf("<!--", at);
    if (open === -1) return out + html.slice(at);
    out += html.slice(at, open);
    const close = html.indexOf("-->", open + 4);
    if (close === -1) return out;
    at = close + 3;
  }
}

/** HTML text to a tree. Never throws. Comments are left out (stripHtmlComments). */
export function parseHtml(html: string): Doc {
  const root: El = { kind: "el", tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  let nodes = 0;
  let truncated = false;
  html = stripHtmlComments(html);
  const lower = html.toLowerCase();
  const re = new RegExp(TOKEN.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (nodes >= MAX_NODES) {
      truncated = true;
      break;
    }
    if (m[4] !== undefined) {
      cur.children.push({ kind: "text", text: m[4], parent: cur });
      nodes++;
      continue;
    }
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let e: El | null = cur; e && e !== root; e = e.parent) {
        if (e.tag === tag) {
          cur = e.parent ?? root;
          break;
        }
      }
      continue;
    }
    if (!m[2]) continue; // a comment, a doctype, a stray "<"
    const tag = m[2].toLowerCase();
    const attrSrc = m[3] ?? "";
    // Implied end tags: <li> closes the open <li>, a block closes an open <p>.
    const rule = IMPLIED[tag];
    if (rule) {
      for (let e: El | null = cur; e && e !== root; e = e.parent) {
        if (rule.closes.includes(e.tag)) {
          cur = e.parent ?? root;
          // A new row closes its open cell and the row the cell is in.
          while (cur !== root && rule.closes.includes(cur.tag)) cur = cur.parent ?? root;
          break;
        }
        if (rule.stopAt.includes(e.tag)) break;
      }
    } else if (BLOCK_CLOSES_P.has(tag) && cur.tag === "p") {
      cur = cur.parent ?? root;
    }
    const el: El = { kind: "el", tag, attrs: parseAttrs(attrSrc), children: [], parent: cur, depth: (cur.depth ?? 0) + 1 };
    cur.children.push(el);
    nodes++;
    if (RAW.has(tag) && !/\/\s*$/.test(attrSrc)) {
      const end = lower.indexOf(`</${tag}`, re.lastIndex);
      const stop = end === -1 ? html.length : end;
      el.raw = html.slice(re.lastIndex, Math.min(stop, re.lastIndex + 600_000));
      const close = end === -1 ? -1 : lower.indexOf(">", end);
      re.lastIndex = close === -1 ? html.length : close + 1;
      continue;
    }
    if (VOID.has(tag) || (/\/\s*$/.test(attrSrc) && !["div", "span", "a", "section"].includes(tag)) || el.depth! >= MAX_DEPTH) continue;
    cur = el;
  }
  return { root, truncated, nodes };
}

// ── Reading the tree ─────────────────────────────────────────────────────────────────────────────────────────────
/** Every element below `el` (not `el` itself), in document order. */
export function* elements(el: El): Generator<El> {
  // With a stack of its own, not nested generators: a yield from a deep tree costs one step, not one per level.
  const stack: { node: El; i: number }[] = [{ node: el, i: 0 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.i >= top.node.children.length) {
      stack.pop();
      continue;
    }
    const c = top.node.children[top.i++]!;
    if (c.kind !== "el") continue;
    yield c;
    stack.push({ node: c, i: 0 });
  }
}

export function findAll(el: El, test: string | ((e: El) => boolean)): El[] {
  const out: El[] = [];
  const fn = typeof test === "string" ? (e: El) => e.tag === test : test;
  for (const e of elements(el)) if (fn(e)) out.push(e);
  return out;
}

export function findFirst(el: El, test: string | ((e: El) => boolean)): El | null {
  const fn = typeof test === "string" ? (e: El) => e.tag === test : test;
  for (const e of elements(el)) if (fn(e)) return e;
  return null;
}

const NO_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head"]);
// Text formatting inside a word or a line: no space is added around these.
const INLINE_TEXT = new Set(["b", "i", "em", "strong", "u", "mark", "small", "sub", "sup", "abbr", "font", "code", "s", "del", "ins", "cite", "q"]);

function squash(s: string): string {
  return s.replace(/[​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim();
}

/** The visible text of an element, one line (scripts, styles and hidden templates left out). Elements are separated by a space. */
export function textOf(el: El, max = 100_000): string {
  const parts: string[] = [];
  let len = 0;
  const walk = (e: El) => {
    if (len > max) return;
    for (const c of e.children) {
      if (c.kind === "text") {
        const t = decodeEntities(c.text);
        parts.push(t);
        len += t.length;
      } else if (!NO_TEXT.has(c.tag)) {
        const gap = !INLINE_TEXT.has(c.tag);
        if (gap) parts.push(" ");
        walk(c);
        if (gap) parts.push(" ");
      }
    }
  };
  walk(el);
  return squash(parts.join(""));
}

/** class and id together, lower case: what a block says about itself ("hero-banner", "footer-widgets"). */
export function names(el: El): string {
  return `${el.attrs["class"] ?? ""} ${el.attrs["id"] ?? ""} ${el.attrs["data-section"] ?? ""} ${el.attrs["data-hook"] ?? ""} ${el.attrs["data-testid"] ?? ""}`.toLowerCase();
}

export function closest(el: El, test: string | ((e: El) => boolean)): El | null {
  const fn = typeof test === "string" ? (e: El) => e.tag === test : test;
  for (let e = el.parent; e; e = e.parent) if (fn(e)) return e;
  return null;
}

export function hasAncestorTag(el: El, tags: string[]): boolean {
  return closest(el, (e) => tags.includes(e.tag)) !== null;
}

/** Element children only. */
export function kids(el: El): El[] {
  return el.children.filter((c): c is El => c.kind === "el");
}

/** The document's <html>, <head> and <body> (the root itself when a fragment has none). */
export function parts(doc: Doc): { html: El; head: El | null; body: El } {
  const html = findFirst(doc.root, "html") ?? doc.root;
  const head = findFirst(html, "head");
  const body = findFirst(html, "body") ?? html;
  return { html, head, body };
}

/** Whether an element is hidden for visitors (hidden attribute, aria-hidden, display:none inline). */
export function isHidden(el: El): boolean {
  if ("hidden" in el.attrs) return true;
  if (el.attrs["aria-hidden"] === "true" && !/accordion|collaps|tab|faq|panel/i.test(names(el))) return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.attrs["style"] ?? "");
}

export function metaContent(doc: Doc, test: (m: El) => boolean): string {
  const el = findFirst(doc.root, (e) => e.tag === "meta" && test(e));
  return squash(decodeEntities(el?.attrs["content"] ?? ""));
}

export function meta(doc: Doc, key: string): string {
  const k = key.toLowerCase();
  return metaContent(doc, (m) => (m.attrs["name"] ?? "").toLowerCase() === k || (m.attrs["property"] ?? "").toLowerCase() === k);
}

// ── Page furniture ───────────────────────────────────────────────────────────────────────────────────────────────
const CHROME_TAGS = new Set(["header", "footer", "nav", "aside"]);
const CHROME_ROLES = new Set(["banner", "contentinfo", "navigation"]);
const CHROME_TOKENS = new Set(["bar", "topbar", "top-bar", "header", "footer", "navbar", "nav", "site-header", "site-footer", "masthead", "colophon", "footer-block", "footer-widgets", "site-info", "nav-links", "main-nav", "main-navigation", "header-wrap", "site-nav"]);

/** The page's furniture: header, footer, menus, sidebars (by tag, role, or a class that is exactly such a name). */
export function isChrome(e: El): boolean {
  if (CHROME_TAGS.has(e.tag) || CHROME_ROLES.has(e.attrs["role"] ?? "")) return true;
  const tokens = `${e.attrs["class"] ?? ""} ${e.attrs["id"] ?? ""}`.toLowerCase().split(/\s+/);
  return tokens.some((t) => CHROME_TOKENS.has(t));
}

/** A copy of the tree below `el` without the furniture: what the page itself says, not what every page says. */
export function withoutChrome(el: El): El {
  const copy: El = { kind: "el", tag: el.tag, attrs: el.attrs, children: [], parent: el.parent, ...(el.raw !== undefined ? { raw: el.raw } : {}) };
  for (const c of el.children) {
    if (c.kind === "text") copy.children.push({ kind: "text", text: c.text, parent: copy });
    else if (!isChrome(c)) {
      const sub = withoutChrome(c);
      sub.parent = copy;
      copy.children.push(sub);
    }
  }
  return copy;
}
