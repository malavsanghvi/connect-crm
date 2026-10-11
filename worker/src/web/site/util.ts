// Small shared helpers for the site extractors: addresses, trimming, dates.

import { siteOf } from "../sitemap";

export function shorten(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.lastIndexOf(" ", n - 1);
  return t.slice(0, cut > n / 2 ? cut : n - 1).trimEnd() + "…";
}

export function wordCount(s: string): number {
  const m = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** An absolute http(s) address for a link or image, without its #fragment; null for mailto:, tel:, javascript:, data: ... */
export function resolveHref(href: string | undefined, base: string): string | null {
  const h = (href ?? "").trim();
  if (!h || h.startsWith("#") || /^(mailto|tel|sms|javascript|data|blob|about|whatsapp):/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function isInternal(url: string, site: string): boolean {
  return siteOf(url) === site;
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname.replace(/\/+$/, "") || "/") + (u.search ? "?" + u.search.slice(1, 80) : "");
  } catch {
    return "/";
  }
}

// ── Dates and times written the way organizations write them ─────────────────────────────────────────────────────
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DAY = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\.?";
const DATE_PATTERNS = [
  new RegExp(`\\b(?:${DAY},?\\s+)?${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*[-–—]\\s*\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+\\d{4})?\\b`, "i"),
  new RegExp(`\\b(?:${DAY},?\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?\\b`, "i"),
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b(?:1[0-2]|0?[1-9])\/(?:3[01]|[12]\d|0?[1-9])(?:\/(?:\d{4}|\d{2}))?\b/,
];
const TIME = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?:\s*[-–—to]+\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))?/i;

/** The first date-like phrase in a text ("Sat, Nov 2", "October 14, 2026", "2026-10-14", "10/14"), or null. */
export function firstDate(text: string): string | null {
  let best: RegExpExecArray | null = null;
  for (const re of DATE_PATTERNS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = m;
  }
  return best ? best[0].trim() : null;
}

export function countDates(text: string): number {
  let n = 0;
  for (const re of DATE_PATTERNS.slice(0, 3)) {
    const g = new RegExp(re.source, "gi");
    n += (text.match(g) ?? []).length;
  }
  return n;
}

export function firstTime(text: string): string | null {
  const m = TIME.exec(text);
  return m ? m[0].trim() : null;
}

/** Keeps the first `n` of a list that are not repeats. */
export function unique<T>(items: T[], key: (t: T) => string, n: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= n) break;
  }
  return out;
}
