// The site's menu and footer: which links, how deep the menu goes (dropdowns), whether it has a mobile toggle and a
// button-styled item ("Donate"), how many columns the footer has. Read from the tree, never from a running page.

import { closest, findAll, findFirst, kids, names, textOf, type El } from "./dom";
import type { FooterFacts, Nav, NavItem } from "./types";
import { isInternal, resolveHref, shorten, unique } from "./util";

const MAX_ITEMS = 40;
const MAX_DEPTH = 4;

function labelOf(a: El): string {
  const t = textOf(a, 400);
  if (t) return shorten(t, 60);
  const img = findFirst(a, "img");
  return shorten(a.attrs["aria-label"] ?? a.attrs["title"] ?? img?.attrs["alt"] ?? "", 60);
}

/** The first link of a menu item that is not inside its sub-menu. */
function ownLink(el: El): El | null {
  for (const c of kids(el)) {
    if (c.tag === "a") return c;
    if (c.tag === "ul" || c.tag === "ol") continue;
    const a = ownLink(c);
    if (a) return a;
  }
  return null;
}

function sublistOf(li: El): El | null {
  return findFirst(li, (e) => (e.tag === "ul" || e.tag === "ol") && closest(e, (p) => p.tag === "li") === li);
}

function parseList(list: El, base: string, site: string, depth: number, budget: { n: number }): NavItem[] {
  const out: NavItem[] = [];
  for (const li of kids(list)) {
    if (li.tag !== "li" || budget.n <= 0) continue;
    const a = ownLink(li);
    const label = a ? labelOf(a) : shorten(textOf(li, 200), 60);
    if (!label) continue;
    budget.n--;
    const href = a ? resolveHref(a.attrs["href"], base) : null;
    const sub = depth < MAX_DEPTH ? sublistOf(li) : null;
    out.push({ label, href, internal: href !== null && isInternal(href, site), children: sub ? parseList(sub, base, site, depth + 1, budget) : [] });
  }
  return out;
}

function depthOf(items: NavItem[]): number {
  return items.length === 0 ? 0 : 1 + Math.max(0, ...items.map((i) => depthOf(i.children)));
}
function countLinks(items: NavItem[]): number {
  return items.reduce((n, i) => n + 1 + countLinks(i.children), 0);
}

function menuItems(root: El, base: string, site: string): NavItem[] {
  const list = root.tag === "ul" || root.tag === "ol" ? root : findFirst(root, (e) => e.tag === "ul" || e.tag === "ol");
  if (list) {
    const items = parseList(list, base, site, 1, { n: MAX_ITEMS });
    if (items.length >= 2) return items;
  }
  // A menu built of plain links (Wix, Squarespace and friends).
  const links = unique(
    findAll(root, "a").map((a) => ({ label: labelOf(a), href: resolveHref(a.attrs["href"], base) })).filter((l) => l.label),
    (l) => l.label + "|" + l.href,
    MAX_ITEMS,
  );
  return links.map((l) => ({ label: l.label, href: l.href, internal: l.href !== null && isInternal(l.href, site), children: [] }));
}

const TOGGLE = /hamburger|menu-toggle|navbar-toggler|burger|mobile-menu|nav-toggle|menu-button|sidebar-toggle|toggle-menu|menu-icon|menu-trigger/;
const NOT_PRIMARY = /breadcrumb|skip|social|pagination|footer|share|language|lang-|utility|top-bar|topbar|secondary/;

export function extractNav(body: El, base: string, site: string): { nav: Nav | null; footer: FooterFacts | null; hasSearch: boolean } {
  const FOOTER_TOKENS = ["footer", "site-footer", "footer-block", "footer-widgets", "colophon", "site-info"];
  const footerEl =
    findFirst(body, (e) => e.tag === "footer" || (e.attrs["role"] ?? "") === "contentinfo") ??
    findFirst(body, (e) => `${e.attrs["class"] ?? ""} ${e.attrs["id"] ?? ""}`.toLowerCase().split(/\s+/).some((t) => FOOTER_TOKENS.includes(t))) ??
    null;
  const inFooter = (e: El) => (footerEl !== null && (e === footerEl || closest(e, (p) => p === footerEl) !== null)) || closest(e, (p) => /footer/.test(names(p))) !== null;

  const candidates = findAll(body, (e) => (e.tag === "nav" || (e.attrs["role"] ?? "") === "navigation" || (/\b(main-?menu|primary-?menu|main-?nav|navbar|site-?nav|menu-main|nav-menu|navigation|nav-links?|nav-wrap)\b/.test(names(e)) && (e.tag === "ul" || e.tag === "div"))) && !inFooter(e));
  let best: { el: El; score: number; items: NavItem[] } | null = null;
  for (const el of candidates) {
    const nm = names(el) + " " + (el.attrs["aria-label"] ?? "").toLowerCase();
    if (NOT_PRIMARY.test(nm)) continue;
    // A nested candidate is part of an outer one already considered.
    const items = menuItems(el, base, site);
    if (items.length < 2) continue;
    let score = countLinks(items);
    if (closest(el, (p) => p.tag === "header" || (p.attrs["role"] ?? "") === "banner")) score += 6;
    if (/primary|main|site/.test(nm)) score += 4;
    if (/mobile|offcanvas|off-canvas|drawer|sidebar/.test(nm)) score -= 5;
    if (!best || score > best.score) best = { el, score, items };
  }
  const nav: Nav | null = best
    ? (() => {
        const items = best.items;
        const depth = depthOf(items);
        const btn = best.el ? findFirst(best.el, (e) => e.tag === "a" && /\b(btn|button|cta)\b/.test(names(e))) : null;
        const hasDrop = depth >= 2 || findFirst(best.el, (e) => /dropdown|sub-?menu|has-children|mega-?menu/.test(names(e))) !== null;
        return {
          items,
          depth: Math.max(depth, hasDrop ? 2 : 1),
          top_level_count: items.length,
          total_links: countLinks(items),
          has_dropdowns: hasDrop,
          mobile_toggle: findFirst(body, (e) => TOGGLE.test(names(e)) || (e.tag === "button" && /menu/i.test(e.attrs["aria-label"] ?? "") && "aria-controls" in e.attrs)) !== null,
          cta: btn ? labelOf(btn) || null : null,
        };
      })()
    : null;

  const hasSearch = findFirst(body, (e) => (e.tag === "input" && (e.attrs["type"] ?? "") === "search") || (e.tag === "form" && ((e.attrs["role"] ?? "") === "search" || /search/.test(names(e))))) !== null;
  return { nav, footer: footerEl ? footerFacts(footerEl, base, site) : null, hasSearch };
}

const COPYRIGHT = /©|&copy;|copyright|all rights reserved/i;
const ADDRESS_LINE = /\d{1,6}\s+[A-Za-z0-9.\s]{3,40}\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|court|ct|highway|hwy|parkway|pkwy)\b/i;

export function footerFacts(footer: El, base: string, site: string): FooterFacts {
  const links = unique(
    findAll(footer, "a").map((a) => ({ label: labelOf(a), href: resolveHref(a.attrs["href"], base) })).filter((l): l is { label: string; href: string } => l.label !== "" && l.href !== null),
    (l) => l.href,
    MAX_ITEMS,
  ).map((l) => ({ ...l, internal: isInternal(l.href, site) }));
  const total = findAll(footer, "a").length;
  // Columns: the most blocks of one kind (2 to 6, same tag and same first class) side by side in the footer's first four levels, each holding something.
  let columns = 1;
  let level: El[] = [footer];
  for (let depth = 0; depth < 4 && level.length > 0; depth++) {
    const next: El[] = [];
    for (const el of level) {
      const children = kids(el).filter((c) => c.tag !== "script" && c.tag !== "style");
      const groups = new Map<string, number>();
      for (const c of children) {
        if (!["div", "section", "aside", "article", "nav", "td"].includes(c.tag)) continue;
        if (findFirst(c, "a") === null && findFirst(c, (e) => /^h[1-6]$/.test(e.tag)) === null && textOf(c, 100).length < 8) continue;
        const sig = c.tag + "." + ((c.attrs["class"] ?? "").split(/\s+/)[0] ?? "");
        groups.set(sig, (groups.get(sig) ?? 0) + 1);
      }
      for (const n of groups.values()) if (n >= 2 && n <= 6 && n > columns) columns = n;
      next.push(...children);
    }
    level = next.slice(0, 80);
  }
  const text = textOf(footer, 4000);
  return {
    links,
    link_count: total,
    columns,
    has_social: findFirst(footer, (e) => e.tag === "a" && /facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|tiktok\.com|wa\.me/i.test(e.attrs["href"] ?? "")) !== null,
    has_newsletter: findFirst(footer, (e) => e.tag === "input" && /email/i.test(e.attrs["type"] ?? "")) !== null || /newsletter|subscribe/i.test(text),
    has_address: findFirst(footer, "address") !== null || ADDRESS_LINE.test(text),
    has_copyright: COPYRIGHT.test(text),
  };
}
