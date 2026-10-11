// A site's look, read from its CSS as text (no browser, nothing runs): the colour palette, ranked, with a contrast
// note, and the fonts (font-family declarations, @font-face, Google Fonts links).
//
// Colours are weighed, not just counted: the theme-color meta tag and CSS variables named "primary" or "brand" say
// what the site means its colours to be; backgrounds count more than text; a button, header or hero rule counts
// double; a colour nearly the same as a stronger one is merged into it.

import type { ContrastNote, FontFact, FontSet, Palette, PaletteColor } from "./types";

export type Rgb = { r: number; g: number; b: number; a: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function parseColor(token: string): Rgb | null {
  const t = token.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
  if (m) {
    let h = m[1]!;
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(t);
  if (m) {
    const ch = (v: string, pct: string) => clamp(Math.round(pct ? (parseFloat(v) * 255) / 100 : parseFloat(v)), 0, 255);
    const a = m[7] === undefined ? 1 : clamp(m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7]), 0, 1);
    return { r: ch(m[1]!, m[2]!), g: ch(m[3]!, m[4]!), b: ch(m[5]!, m[6]!), a };
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(t);
  if (m) {
    const h = (parseFloat(m[1]!) % 360) / 360;
    const s = clamp(parseFloat(m[2]!) / 100, 0, 1);
    const l = clamp(parseFloat(m[3]!) / 100, 0, 1);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (x: number) => {
      const k = (x + 1) % 1;
      const v = k < 1 / 6 ? p + (q - p) * 6 * k : k < 1 / 2 ? q : k < 2 / 3 ? p + (q - p) * (2 / 3 - k) * 6 : p;
      return Math.round(v * 255);
    };
    const a = m[4] === undefined ? 1 : clamp(m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]), 0, 1);
    return { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3), a };
  }
  return null;
}

export function toHex(c: Rgb): string {
  return "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Hue (0-360), saturation and lightness (0-1). */
export function hsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function luminance(c: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio of two colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const ca = parseColor(a), cb = parseColor(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca), lb = luminance(cb);
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
}

export function isNeutral(hex: string): boolean {
  const c = parseColor(hex);
  if (!c) return true;
  const { s, l } = hsl(c);
  // Greys, near white (a light tint is a background, not a brand colour), near black and dark text with a hint of colour.
  return s < 0.1 || l > 0.88 || l < 0.08 || (l < 0.22 && s < 0.25);
}

const distance = (a: Rgb, b: Rgb) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

// ── Reading CSS text ─────────────────────────────────────────────────────────────────────────────────────────────
const COLOR_TOKEN = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]{5,40}\)|hsla?\([^)]{5,40}\)/g;

/** CSS without its comments (one pass; a comment that never ends takes the rest of the file). Linear, whatever the file holds. */
export function stripComments(css: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = css.indexOf("/*", at);
    if (open === -1) return out + css.slice(at);
    out += css.slice(at, open) + " ";
    const close = css.indexOf("*/", open + 2);
    if (close === -1) return out;
    at = close + 2;
  }
}

export type CssRule = { selector: string; decls: string };

/**
 * The rules of a stylesheet, flattened (a rule inside @media is a rule): the text before each { and the declarations up to
 * the } that closes it. One pass over the text with indexOf, so a hostile file cannot make it slow.
 */
export function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  let start = 0;
  for (;;) {
    const open = css.indexOf("{", start);
    if (open === -1) return out;
    const nextOpen = css.indexOf("{", open + 1);
    const close = css.indexOf("}", open + 1);
    if (close === -1) return out;
    if (nextOpen !== -1 && nextOpen < close) {
      // A block that holds rules (@media, @supports): its rules come next.
      start = open + 1;
      continue;
    }
    out.push({ selector: css.slice(start, open).replace(/^[\s}]+/, "").trim(), decls: css.slice(open + 1, close) });
    start = close + 1;
  }
}

function propWeight(prop: string): number {
  const p = prop.toLowerCase();
  if (p === "background" || p === "background-color") return 2;
  if (p === "color" || p === "fill" || p === "stroke") return 1;
  if (p.startsWith("border") || p === "outline-color") return 0.5;
  if (p.includes("shadow")) return 0.1;
  return 0.5;
}

function selectorWeight(sel: string): number {
  return /\b(btn|button|header|nav|navbar|footer|hero|banner|masthead|menu|cta|donate|site-title)\b|^(a|button|header|nav|footer|h1|h2)\b|:root|^body/i.test(sel) ? 2 : 1;
}

function variableWeight(name: string): number {
  const n = name.toLowerCase();
  if (/primary|brand|main|theme-color|accent-1|color-1\b/.test(n)) return 30;
  if (/secondary|accent|highlight|theme|color-2|color-3|palette/.test(n)) return 18;
  if (/font|size|space|radius|width|height|shadow|z-index|line/.test(n)) return 0;
  return 4;
}

export type PaletteInput = {
  /** <meta name="theme-color"> and msapplication-TileColor values. */
  themeColors: string[];
  /** Every CSS text read: <style> blocks and fetched stylesheets. */
  css: string[];
  /** The contents of inline style="" attributes. */
  inline: string[];
};

export function extractPalette(input: PaletteInput): Palette {
  // bg: how much of the score is background use; text: declared as the colour of the page's body text.
  const tally = new Map<string, { rgb: Rgb; score: number; bg: number; text: boolean }>();
  const add = (token: string, weight: number, use?: "bg" | "text"): boolean => {
    const c = parseColor(token);
    if (!c || c.a < 0.3 || weight <= 0) return false;
    const hex = toHex(c);
    const cur = tally.get(hex) ?? { rgb: { ...c, a: 1 }, score: 0, bg: 0, text: false };
    cur.score += weight;
    if (use === "bg") cur.bg += weight;
    if (use === "text") cur.text = true;
    tally.set(hex, cur);
    return true;
  };

  let themeMeta = 0;
  for (const t of input.themeColors) if (add(t, 50)) themeMeta++;

  let variables = 0;
  let values = 0;
  const readDecls = (decls: string, selW: number, sel = "") => {
    for (const d of decls.split(";")) {
      const at = d.indexOf(":");
      if (at < 1) continue;
      const prop = d.slice(0, at).trim();
      const val = d.slice(at + 1);
      const tokens = val.match(COLOR_TOKEN);
      if (!tokens) continue;
      if (prop.startsWith("--")) {
        const w = variableWeight(prop);
        for (const t of tokens) if (add(t, w)) variables++;
      } else {
        const w = propWeight(prop) * selW;
        const p = prop.toLowerCase();
        const use = p === "color" && /(^|,)\s*(html|body|p|:root|\*)\s*(,|$)/i.test(sel) ? "text" : p === "background" || p === "background-color" ? "bg" : undefined;
        for (const t of tokens) if (add(t, w, use)) values++;
      }
    }
  };
  for (const raw of input.css) {
    for (const r of cssRules(stripComments(raw))) if (!/^@font-face/i.test(r.selector)) readDecls(r.decls, selectorWeight(r.selector), r.selector);
  }
  for (const s of input.inline) readDecls(s, 1);

  // Strongest first; a colour within a hair of a stronger one is that colour.
  const ranked = [...tally.entries()].map(([hex, v]) => ({ hex, ...v })).sort((a, b) => b.score - a.score || (a.hex < b.hex ? -1 : 1));
  const merged: { hex: string; rgb: Rgb; score: number; bg: number; text: boolean }[] = [];
  for (const c of ranked) {
    const near = merged.find((m) => distance(m.rgb, c.rgb) < 18);
    if (near) {
      near.score += c.score;
      near.bg += c.bg;
      near.text = near.text || c.text;
    } else merged.push({ hex: c.hex, rgb: c.rgb, score: c.score, bg: c.bg, text: c.text });
  }
  merged.sort((a, b) => b.score - a.score || (a.hex < b.hex ? -1 : 1));
  const total = merged.reduce((s, c) => s + c.score, 0) || 1;

  // A dark colour that is the page's body text colour, and hardly ever a background, is text, however warm or green it is.
  const textLike = (c: { text: boolean; bg: number }) => c.text && c.bg < 6;
  const chromatic = merged.filter((c) => !isNeutral(c.hex) && !textLike(c));
  const lightNeutral = merged.filter((c) => isNeutral(c.hex) && hsl(c.rgb).l > 0.5);
  const darkNeutral = merged.filter((c) => (isNeutral(c.hex) && hsl(c.rgb).l <= 0.5) || (textLike(c) && !isNeutral(c.hex)));
  const picked: PaletteColor[] = [];
  const share = (s: number) => Math.round((s / total) * 1000) / 1000;
  const score = (s: number) => Math.round(s * 10) / 10;
  const primary = chromatic[0];
  if (primary) picked.push({ hex: primary.hex, score: score(primary.score), share: share(primary.score), role: "primary" });
  const hueGap = (a: Rgb, b: Rgb) => {
    const d = Math.abs(hsl(a).h - hsl(b).h);
    return Math.min(d, 360 - d);
  };
  const secondary = chromatic.slice(1).find((c) => primary && (hueGap(primary.rgb, c.rgb) >= 25 || distance(primary.rgb, c.rgb) >= 90));
  if (secondary) picked.push({ hex: secondary.hex, score: score(secondary.score), share: share(secondary.score), role: "secondary" });
  for (const c of chromatic) {
    if (picked.length >= 5) break;
    if (picked.some((p) => p.hex === c.hex)) continue;
    picked.push({ hex: c.hex, score: score(c.score), share: share(c.score), role: "accent" });
  }
  const bg = lightNeutral[0];
  if (bg) picked.push({ hex: bg.hex, score: score(bg.score), share: share(bg.score), role: "background" });
  const tx = darkNeutral[0];
  if (tx) picked.push({ hex: tx.hex, score: score(tx.score), share: share(tx.score), role: "text" });
  for (const c of merged) {
    if (picked.length >= 8) break;
    if (picked.some((p) => p.hex === c.hex) || !isNeutral(c.hex)) continue;
    picked.push({ hex: c.hex, score: score(c.score), share: share(c.score), role: "neutral" });
  }

  return {
    colors: picked,
    theme_color: input.themeColors.map((t) => parseColor(t)).filter((c): c is Rgb => c !== null).map(toHex)[0] ?? null,
    contrast: contrastNotes(picked),
    sources: { theme_meta: themeMeta, variables, css_values: values },
  };
}

function verdict(ratio: number): { ok: boolean; words: string } {
  if (ratio >= 7) return { ok: true, words: "easy to read at any size" };
  if (ratio >= 4.5) return { ok: true, words: "good for text" };
  if (ratio >= 3) return { ok: false, words: "readable only as large text or on buttons" };
  return { ok: false, words: "too faint for text; use it for decoration only" };
}

function contrastNotes(colors: PaletteColor[]): ContrastNote[] {
  const out: ContrastNote[] = [];
  const note = (a: string, b: string, label: string) => {
    const ratio = contrastRatio(a, b);
    const v = verdict(ratio);
    out.push({ pair: [a, b], ratio, passes_aa: ratio >= 4.5, note: `${label}: ${ratio}:1, ${v.words}.` });
  };
  const by = (role: PaletteColor["role"]) => colors.find((c) => c.role === role)?.hex;
  const primary = by("primary");
  const secondary = by("secondary");
  const bg = by("background") ?? "#ffffff";
  const text = by("text");
  if (primary) note("#ffffff", primary, "White on the main colour");
  if (primary && bg !== "#ffffff") note(primary, bg, "Main colour on the page background");
  if (secondary) note("#ffffff", secondary, "White on the second colour");
  if (text) note(text, bg, "Body text on the page background");
  return out;
}

// ── Fonts ────────────────────────────────────────────────────────────────────────────────────────────────────────
const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit", "initial", "unset", "revert", "-apple-system", "blinkmacsystemfont", "segoe ui", "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji", "sans", "default"]);
const ICON_FONT = /awesome|icon|glyph|dashicons|eicons|swiper|slick|brands|themify|linearicons|genericons|symbols|emoji|wp-|dingbats|webdings|wingdings/i;
const HEADING_SEL = /\bh[1-6]\b|heading|title|display|hero|banner|site-title|entry-title|page-title|\.logo|masthead/i;
const BODY_SEL = /^\s*(html|body|p|:root|\*)\s*(,|$)|\bbody\b|\.content|\.entry-content|\bp\b/i;

function cleanName(raw: string): string | null {
  const n = raw.trim().replace(/^["']|["']$/g, "").replace(/\s*!important$/i, "").replace(/\s+/g, " ").trim();
  if (!n || n.length > 40 || /[(){}$@<>;]/.test(n) || /^var\b/i.test(n)) return null;
  if (GENERIC.has(n.toLowerCase()) || ICON_FONT.test(n)) return null;
  return n;
}

/** Family names a Google Fonts (or Bunny Fonts) stylesheet address asks for. */
export function googleFamilies(href: string): string[] {
  const out: string[] = [];
  let q: string;
  try {
    q = new URL(href, "https://x.invalid").search;
  } catch {
    return out;
  }
  for (const part of q.replace(/^\?/, "").split("&")) {
    const [k, v] = [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)];
    if (k !== "family" || !v) continue;
    for (const fam of decodeURIComponent(v.replace(/\+/g, " ")).split("|")) {
      const name = fam.split(":")[0]!.trim();
      if (name && name.length <= 40 && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

export type FontInput = { css: string[]; inline: string[]; links: string[] };

export function extractFonts(input: FontInput): FontSet {
  const tally = new Map<string, { name: string; uses: number; heading: number; body: number; source: FontFact["source"] }>();
  const bump = (raw: string, role: "heading" | "body" | "unknown", source: FontFact["source"], weight = 1) => {
    const name = cleanName(raw);
    if (!name) return;
    const k = name.toLowerCase();
    const cur = tally.get(k) ?? { name, uses: 0, heading: 0, body: 0, source };
    cur.uses += weight;
    if (role === "heading") cur.heading += weight;
    if (role === "body") cur.body += weight;
    if (source === "google" || source === "typekit" || (source === "font-face" && cur.source === "css")) cur.source = source;
    tally.set(k, cur);
  };

  for (const href of input.links) {
    if (/fonts\.(googleapis|bunny)\.|fonts\.gstatic\./i.test(href)) for (const n of googleFamilies(href)) bump(n, "unknown", "google", 2);
    else if (/typekit\.net|fonts\.adobe\.com/i.test(href)) bump("Adobe Fonts", "unknown", "typekit", 2);
  }
  // @import url(https://fonts.googleapis.com/...) inside the CSS.
  for (const raw of input.css) {
    for (const m of stripComments(raw).matchAll(/@import\s+(?:url\()?["']?([^"')\s]*fonts\.(?:googleapis|bunny)[^"')\s]*)/gi)) for (const n of googleFamilies(m[1]!)) bump(n, "unknown", "google", 2);
  }

  const readDecl = (prop: string, val: string, sel: string) => {
    const p = prop.trim().toLowerCase();
    const isFam = p === "font-family" || p === "font" || (p.startsWith("--") && /font|family|typeface/.test(p) && !/size|weight|style|height|spacing/.test(p));
    if (!isFam) return;
    if (p === "font") {
      const at = val.search(/\d[\w%.]*\s*(?:\/[\w.]+\s*)?(?=[A-Za-z"'])/);
      if (at === -1) return;
      val = val.slice(val.indexOf(" ", at) + 1);
    }
    const first = val.split(",").map((s) => s.trim()).find((s) => s && !/^var\(/.test(s));
    if (!first) return;
    let role: "heading" | "body" | "unknown" = HEADING_SEL.test(sel) ? "heading" : BODY_SEL.test(sel) ? "body" : "unknown";
    if (p.startsWith("--")) role = /head|title|display/.test(p) ? "heading" : /body|text|base|paragraph/.test(p) ? "body" : "unknown";
    bump(first, role, "css");
  };
  for (const raw of input.css) {
    for (const r of cssRules(stripComments(raw))) {
      if (/^@font-face/i.test(r.selector)) {
        const f = /font-family\s*:\s*([^;}]+)/i.exec(r.decls);
        if (f) bump(f[1]!, "unknown", "font-face", 1);
        continue;
      }
      for (const d of r.decls.split(";")) {
        const at = d.indexOf(":");
        if (at > 0) readDecl(d.slice(0, at), d.slice(at + 1), r.selector);
      }
    }
  }
  for (const s of input.inline) for (const d of s.split(";")) {
    const at = d.indexOf(":");
    if (at > 0) readDecl(d.slice(0, at), d.slice(at + 1), "");
  }

  const fonts: FontFact[] = [...tally.values()]
    .sort((a, b) => b.uses - a.uses || (a.name < b.name ? -1 : 1))
    .slice(0, 8)
    .map((f) => ({ name: f.name, uses: f.uses, source: f.source, role: f.heading > f.body ? "heading" : f.body > f.heading ? "body" : "unknown" }));
  const heading = fonts.find((f) => f.role === "heading")?.name ?? null;
  // Only what the CSS says: a font nobody ties to headings or to body text stays "unknown" (one font alone is the body's).
  const body = fonts.find((f) => f.role === "body")?.name ?? (fonts.length === 1 && heading === null ? fonts[0]!.name : null);
  return { fonts, heading, body };
}
