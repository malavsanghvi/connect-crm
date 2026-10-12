// The flyer layouts' renderer (Flyers v3): the Poster's words as BLOCKS in a preset (flyer-layout.ts). Server side only (imported
// by flyer-render.tsx); no client component imports it.
//
// It works the way the original stacked poster does (flyer-poster.tsx): Satori cannot measure text, so planLayout() ESTIMATES each
// block's height from its words (wrapping them word by word, a little generously), shrinks the whole stack (k, down to 0.58, then a
// block at a time, least important first, is left out) until it fits between the top and the bottom scene, and spreads what is
// left over between the blocks, so a Story has no empty middle and a Square never overflows. The art under the words (frame, scene,
// the AI picture's panel) is the same posterLayers() the original poster draws.
//
// Block heights are for scale 1; the words and the padding inside a block scale with k, the width of a block's box does not (a
// narrower scale only ever gives text more room, so an estimate made at scale 1 holds).

import type { ReactElement, ReactNode } from "react";

import { flyerTextLength } from "./flyer";
import { artPack, mix, ribbonSvg, svgDataUri, type ArtPack, type PosterPalette } from "./flyer-art-packs";
import { readableOn } from "./flyer-art-palette";
import { posterIconUri, type PosterIcon } from "./flyer-icons";
import { blockPresent, layoutPreset, presentBlocks, scriptSafe, titleWords, type BlockKey, type CreditGroup, type HeroShape, type PosterLayout, type PresetSpec } from "./flyer-layout";
import { bannerSvg, dividerSvg, sprigSvg, windowSvg } from "./flyer-ornaments";
import { POSTER_UNITS, badgeSizes, box, diamond, haloLayers, image, lineCount, posterLayers, qrCardElement, ribbonLayout, textWidth, txt, type PosterImage, type PosterInput } from "./flyer-poster";

export type LayoutFonts = { display: string; body: string; script: string };

// ── Measures (units: the flyer is 1080 wide) ─────────────────────────────────
const W = 1080;
const SIDE = 70;
const COL = W - 2 * SIDE;
/** Cards (host, date, note, contacts) are a little narrower than the column. */
const CARD = 920;
const K_MIN = 0.58;
const K_FLOOR = 0.4;
const K_MAX = 1.3;
const STORY_FROM = 1800;
const SCENE_MAX_STORY = 1.42;
const SLACK = 24;
const FILL = 0.96;

type Ctx = {
  headline: string;
  /** The flyer's height in units. */
  H: number;
  /** The call to action is drawn as the heading of the contacts card (both are present), so it takes no room of its own. */
  heading: boolean;
  poster: PosterInput["poster"];
  layout: PosterLayout;
  spec: PresetSpec;
  venue: string;
  story: boolean;
  /** The community's logo is available (a picture). */
  logo: boolean;
  centerName: string;
  /** The picture the layout shows, loaded (null: none chosen, or it could not be loaded). */
  hero: PosterImage | null;
  /** The blocks drawn inside the arched window, and its width, when the preset has one and any of its blocks is present. */
  win: { members: BlockKey[]; width: number } | null;
};

/** How wide the words of a block may be: narrower inside the arched window, else undefined (the block's own measure). */
const innerWidth = (ctx: Ctx, key: BlockKey): number | undefined => (ctx.win && ctx.win.members.includes(key) ? ctx.win.width - 100 : undefined);

/** How far the window's arch rises above its first block, and the room under its last one (units). */
const WINDOW_RISE = 96;
const WINDOW_FOOT = 48;
/** The window's bottom edge sits this far above the end of its last block (the rest of the foot is air below it). */
const WINDOW_EDGE = 24;
/** The corner RSVP card is drawn at this scale in a layout (190 units of code at 0.78 is still easily scanned). */
const LAYOUT_QR_SCALE = 0.78;

const SERIF = { serif: true } as const;

/** A script word is narrower than the sans estimate says (Kaushan Script measures about 0.45 em a letter). */
const scriptWidth = (s: string, size: number) => textWidth(s, size) * 0.9;

/** The first size in `sizes` (biggest first) for which `fits` holds, else the smallest. */
function pick(sizes: readonly number[], fits: (size: number) => boolean): number {
  return sizes.find(fits) ?? sizes[sizes.length - 1]!;
}

/**
 * Breaks words (their widths in units, with `space` between them) into the fewest lines no wider than `max`, then moves the
 * breaks so the lines are as even as they can be. Returns the number of words on each line, or null when a word alone is wider
 * than a line.
 */
export function breakWords(widths: readonly number[], space: number, max: number): number[] | null {
  const n = widths.length;
  if (n === 0) return [];
  if (widths.some((w) => w > max)) return null;
  const lineW = (a: number, b: number) => {
    let t = space * (b - a - 1);
    for (let i = a; i < b; i++) t += widths[i]!;
    return t;
  };
  // The fewest lines (greedy).
  let lines = 1;
  let used = widths[0]!;
  for (let i = 1; i < n; i++) {
    if (used + space + widths[i]! <= max) used += space + widths[i]!;
    else {
      lines++;
      used = widths[i]!;
    }
  }
  // The most even way to break into that many lines: minimize the widest line (then the sum of squares, so the others balance too).
  const INF = Number.POSITIVE_INFINITY;
  const best: { cost: number; widest: number; at: number }[][] = Array.from({ length: lines + 1 }, () => Array.from({ length: n + 1 }, () => ({ cost: INF, widest: INF, at: -1 })));
  best[0]![0] = { cost: 0, widest: 0, at: -1 };
  for (let j = 1; j <= lines; j++) {
    for (let i = j; i <= n; i++) {
      for (let t = j - 1; t < i; t++) {
        const prev = best[j - 1]![t]!;
        if (prev.cost === INF) continue;
        const w = lineW(t, i);
        if (w > max) continue;
        const widest = Math.max(prev.widest, w);
        const cost = prev.cost + (max - w) ** 2;
        const cur = best[j]![i]!;
        if (widest < cur.widest - 0.01 || (Math.abs(widest - cur.widest) <= 0.01 && cost < cur.cost)) best[j]![i] = { cost, widest, at: t };
      }
    }
  }
  if (best[lines]![n]!.cost === INF) return null;
  const counts: number[] = [];
  let i = n;
  for (let j = lines; j >= 1; j--) {
    const t = best[j]![i]!.at;
    counts.unshift(i - t);
    i = t;
  }
  return counts;
}

// ── The title ────────────────────────────────────────────────────────────────

export type TitleWordPlan = { text: string; accent: boolean; script: boolean; size: number; width: number };
export type TitlePlan = { size: number; lines: TitleWordPlan[][]; lineHeight: number; height: number; widest: number };

/**
 * The title's size and lines. As big as the preset allows, down to a floor; fewer lines are preferred (a line more costs a
 * quarter of the size), no word is ever wider than a line, and the accent word is set in script (a little larger, a script
 * looks small beside a heavy face) when the preset says so and every letter is one the script font has.
 */
export function titlePlan(headline: string, accent: string, spec: PresetSpec, o: { width: number; story: boolean; /** The scale the words are drawn at. */ scale?: number; /** The flyer's height (units): the title takes at most 30% of it. */ height?: number }): TitlePlan {
  const sc = o.scale ?? 1;
  const cap = o.height ? (0.3 * o.height) / sc : Number.POSITIVE_INFINITY;
  const t = spec.style.title;
  const words = titleWords(headline, accent);
  const maxLines = 3;
  const floor = t.set === "banner" ? 50 : 52;
  const lh = t.set === "banner" ? 1.08 : 1.02;
  let chosen: { plan: TitlePlan; score: number } | null = null;
  for (let size = t.max; size >= floor; size -= 2) {
    const plans: TitleWordPlan[] = words.map((w) => {
      const script = w.accent && t.accent === "script" && scriptSafe(w.text);
      const s = script ? size * 1.16 : size;
      const width = script ? scriptWidth(w.text, s) : textWidth(w.text, s, { ...SERIF, caps: t.caps, spacing: t.caps ? size * 0.02 : 0 });
      return { text: w.text, accent: w.accent, script, size: s, width };
    });
    const space = textWidth(" ", size, SERIF) + (t.caps ? size * 0.02 : 0);
    const counts = breakWords(
      plans.map((p) => p.width),
      space,
      (o.width * FILL) / sc,
    );
    if (!counts || counts.length > maxLines) continue;
    const lines: TitleWordPlan[][] = [];
    let at = 0;
    for (const c of counts) {
      lines.push(plans.slice(at, at + c));
      at += c;
    }
    const widest = Math.max(...lines.map((l) => l.reduce((a, p) => a + p.width, 0) + space * (l.length - 1)));
    const plan: TitlePlan = { size, lines, lineHeight: lh, height: Math.round(lines.length * size * lh * 1.05), widest };
    if (plan.height > cap) continue;
    const score = size * (1 - 0.33 * (lines.length - 1));
    if (!chosen || score > chosen.score + 0.5) chosen = { plan, score };
    // Smaller sizes only help with fewer lines: stop once a size fits in one line.
    if (lines.length === 1) break;
  }
  if (chosen) return chosen.plan;
  // Nothing fits in the most lines allowed, even at the floor (a very long title, or a word wider than a line): the floor size, wrapped
  // line by line as far as it takes (more lines than usual; the plan then shrinks the flyer or leaves other blocks out). Never one
  // endless line: a row far wider than its box can hang the image renderer.
  const room = (o.width * FILL) / sc;
  // A single word wider than a line is set smaller still (down to 24), so it never runs out of its box.
  const widestWord = Math.max(1, ...words.map((w) => textWidth(w.text, floor, { ...SERIF, caps: t.caps, spacing: t.caps ? floor * 0.02 : 0 })));
  const size = widestWord > room ? Math.max(24, Math.floor((floor * room) / widestWord)) : floor;
  const space = textWidth(" ", size, SERIF) + (t.caps ? size * 0.02 : 0);
  const plans: TitleWordPlan[] = words.map((w) => ({ text: w.text, accent: w.accent, script: false, size, width: textWidth(w.text, size, { ...SERIF, caps: t.caps, spacing: t.caps ? size * 0.02 : 0 }) }));
  const lines: TitleWordPlan[][] = [];
  let used = 0;
  for (const p of plans) {
    if (lines.length && used + space + p.width <= room) {
      lines[lines.length - 1]!.push(p);
      used += space + p.width;
    } else {
      lines.push([p]);
      used = p.width;
    }
  }
  const widest = Math.max(0, ...lines.map((l) => l.reduce((a, p) => a + p.width, 0) + space * (l.length - 1)));
  return { size, lines, lineHeight: lh, height: Math.round(Math.max(1, lines.length) * size * lh * 1.05), widest };
}

// ── Block layouts: each block's sizes and its natural height (units, scale 1, margins included) ──

// Every layout function takes the scale `s` the words will be drawn at: the width of a box does not scale (a flyer's column is
// always the same width), the type does, so at s > 1 a line breaks sooner. Measuring at the scale it is drawn at keeps the plan
// tight (a flyer is neither crowded at a larger scale nor left with empty bands at a smaller one). Heights returned are for scale 1
// with the line counts of scale `s`: the drawn height is s times as much.

const greetingLayout = (text: string, kind: "top" | "bottom", s = 1) => {
  const base = kind === "top" ? 54 : 76;
  const script = scriptSafe(text);
  const width = script ? scriptWidth(text, base) : textWidth(text, base, SERIF);
  const room = 700 / s;
  const size = Math.round(Math.min(base, (base * room) / Math.max(room, width)));
  // Drawn: the top greeting is a line of text over a divider 18 tall; the bottom one a divider 20 tall over the text.
  return { size, script, h: kind === "top" ? 14 + Math.round(size * 1.2) + 10 + 18 : 8 + 20 + 8 + Math.round(size * 1.25) };
};

const eyebrowLayout = (text: string, caps: boolean, s = 1, maxW = 700) => {
  const size = caps ? 34 : 54;
  const lines = lineCount(text, size, Math.min(700, maxW) / s, { caps, spacing: caps ? 8 : 1, serif: !caps });
  return { size, caps, lines, h: 8 + lines * Math.round(size * 1.2) };
};

const subheadLayout = (text: string, kind: "serif" | "script" | "caps", s = 1, maxW?: number) => {
  const room = ((maxW ?? COL) * FILL) / s;
  if (kind === "script") {
    const script = scriptSafe(text);
    const wide = (size: number) => (script ? scriptWidth(text, size) : textWidth(text, size * 0.8, SERIF));
    const size = pick([124, 108, 94, 80, 68, 58], (z) => wide(z) <= room);
    const lines = Math.max(1, Math.ceil(wide(size) / room));
    return { size, script, lines, h: 6 + Math.round(lines * size * 1.15) + 4 };
  }
  if (kind === "caps") {
    const lines = lineCount(text, 35, ((maxW ?? COL) - 200) / s, { caps: true, spacing: 5 });
    return { size: 35, script: false, lines, h: 12 + lines * 44 };
  }
  const lines = lineCount(text, 56, ((maxW ?? COL) - 160) / s, SERIF);
  return { size: 56, script: false, lines, h: 10 + lines * 68 };
};

const taglineLayout = (text: string, kind: "line" | "pill" | "script", s = 1, maxW?: number) => {
  if (kind === "script") {
    const script = scriptSafe(text);
    const room = (((maxW ?? COL - 60) * FILL) / s) * 1;
    const wide = (z: number) => (script ? scriptWidth(text, z) : textWidth(text, z * 0.8, SERIF));
    const size = pick([80, 70, 62, 54, 46, 40], (z) => wide(z) <= room);
    const lines = Math.max(1, Math.ceil(wide(size) / room));
    return { size, script, lines, h: 10 + Math.round(lines * size * 1.2) + 4 };
  }
  if (kind === "pill") {
    const size = pick([52, 48, 44, 40, 36], (z) => lineCount(text, z, Math.min(800, maxW ?? 800) / s, SERIF) <= 2);
    const lines = lineCount(text, size, Math.min(800, maxW ?? 800) / s, SERIF);
    // Drawn: padding 20 above and below, a 3 border each side.
    return { size, lines, h: 14 + 2 * 20 + 2 * 3 + lines * Math.round(size * 1.22) };
  }
  const size = pick([54, 48, 42, 36], (z) => lineCount(text, z, (maxW ?? COL - 20) / s, { spacing: 1.5 }) <= 2);
  const lines = lineCount(text, size, (maxW ?? COL - 20) / s, { spacing: 1.5 });
  return { size, lines, h: 12 + lines * Math.round(size * 1.2) };
};

/** A card's border (it is drawn 3 thick on each side, and the height of a card includes it). */
const EDGE = 6;

const hostLayout = (label: string, names: string, s = 1) => {
  const size = pick([68, 62, 56, 50, 44, 38], (z) => lineCount(names, z, (CARD - 120) / s, SERIF) <= 2);
  const lines = lineCount(names, size, (CARD - 120) / s, SERIF);
  const inner = EDGE + 18 + (label ? 36 + 6 : 0) + lines * Math.round(size * 1.14) + 22;
  return { size, lines, inner, h: 18 + inner };
};

/** A long date on two lines: the weekday (up to the first comma), then the rest. A short date, or one without a comma, stays on one. */
export function splitDate(date: string): string[] {
  const m = /^([^,\d]{2,16}),\s*(.{4,})$/.exec(date.trim());
  return m && Array.from(date).length > 16 ? [`${m[1]},`, m[2]!] : [date];
}

/** A long email address on two lines, the name and then the "@domain" (so it never breaks in the middle of a word); anything else stays on one. */
export function splitDetail(detail: string): string[] {
  const m = /^([^\s@]+)(@[^\s@]+)$/.exec(detail.trim());
  return m && Array.from(detail).length > 20 ? [m[1]!, m[2]!] : [detail];
}

/** The icon beside a date or time: its size and the gap after it (units). */
const ICON = 72;
const ICON_W = ICON + 22 + 6;

const whenLayout = (ctx: Ctx, kind: "cells" | "plain" | "rules" | "band", s = 1) => {
  const { date, time } = ctx.poster.ribbon;
  const venue = ctx.venue;
  if (kind === "band") {
    // The coloured band (the original poster's ribbon): one row of date and place when they fit, else the place below.
    const rl = ribbonLayout(date, time, venue, s);
    return { kind, dateSize: 0, timeSize: 0, venueSize: 0, venueLines: rl.venueLines, dateLines: 0, timeLines: 0, cell: 0, inner: 0, band: rl, h: 22 + rl.band + 24 };
  }
  if (kind === "rules") {
    // Big plain lines between two ornament rules (a divider 20 tall above and below, 10 of air beside each).
    const dateSize = date ? pick([60, 54, 48, 44, 40, 36], (z) => lineCount(date, z, COL / s, SERIF) <= 1) : 0;
    const timeSize = time ? pick([56, 52, 48, 44, 40, 36], (z) => z <= Math.max(34, dateSize || 60) && lineCount(time, z, COL / s, SERIF) <= 1) : 0;
    const venueSize = 36;
    const venueLines = venue ? lineCount(venue, venueSize, 800 / s, {}) : 0;
    const h = 10 + 20 + 10 + (date ? Math.round(dateSize * 1.2) : 0) + (time ? Math.round(timeSize * 1.2) + 2 : 0) + (venue ? 10 + venueLines * Math.round(venueSize * 1.24) : 0) + 10 + 20 + 4;
    return { kind, dateSize, timeSize, venueSize, venueLines, dateLines: 1, timeLines: 1, cell: 0, inner: 0, h };
  }
  if (kind === "plain") {
    const dateSize = date ? pick([84, 74, 66, 58, 50, 44, 38], (z) => lineCount(date, z, COL / s, { ...SERIF }) <= 1) : 0;
    const timeSize = time ? pick([104, 94, 82, 72, 62, 52, 44], (z) => lineCount(time, z, COL / s, { ...SERIF }) <= 1) : 0;
    const venueSize = 42;
    const venueLines = venue ? lineCount(venue, venueSize, 800 / s, {}) : 0;
    const h = 8 + (date ? Math.round(dateSize * 1.18) : 0) + (time ? Math.round(timeSize * 1.2) + 2 : 0) + (venue ? 14 + venueLines * Math.round(venueSize * 1.24) : 0) + 4;
    return { kind, dateSize, timeSize, venueSize, venueLines, dateLines: 1, timeLines: 1, cell: 0, inner: 0, h };
  }
  // Cells: the date and the time side by side in one card (the date's cell wider), the place on a row below.
  const both = Boolean(date && time);
  const dateCell = both ? 440 : CARD - 60;
  const timeCell = both ? 380 : CARD - 60;
  const parts = date ? splitDate(date) : [];
  const dateLinesAt = (z: number) => parts.reduce((a, p) => a + lineCount(p, z, (dateCell - ICON_W) / s, SERIF), 0);
  const dateSize = date ? pick([56, 52, 48, 44, 40, 36, 32, 28], (z) => dateLinesAt(z) <= parts.length) : 0;
  const timeSize = time ? pick([66, 60, 54, 48, 42, 38, 34, 30], (z) => lineCount(time, z, (timeCell - ICON_W) / s, SERIF) <= 1) : 0;
  const dateLines = date ? dateLinesAt(dateSize) : 0;
  const timeLines = time ? lineCount(time, timeSize, (timeCell - ICON_W) / s, SERIF) : 0;
  const cell = Math.max(dateLines * Math.round(dateSize * 1.14), timeLines * Math.round(timeSize * 1.14), ICON);
  const venueSize = 36;
  const venueLines = venue ? lineCount(venue, venueSize, (CARD - 160) / s, {}) : 0;
  const rowH = date || time ? cell + 2 * 22 : 0;
  // Drawn: the place's row has 12 (or 20 when it is alone) above, 18 below, and a hairline above it when a date or time precedes it.
  const venueH = venue ? (rowH ? 12 + 2 : 20) + Math.max(48, venueLines * Math.round(venueSize * 1.22)) + 18 : 0;
  const inner = EDGE + rowH + venueH;
  return { kind, dateSize, timeSize, venueSize, venueLines, dateLines, timeLines, cell, dateCell, timeCell, inner, h: 16 + inner };
};

const noteLayout = (text: string, s = 1) => {
  const size = pick([36, 33, 30, 27], (z) => lineCount(text, z, (CARD - 250) / s, {}) <= 4);
  const lines = lineCount(text, size, (CARD - 250) / s, {});
  const inner = 2 * 2 + 2 * 24 + Math.max(100, lines * Math.round(size * 1.34));
  return { size, lines, inner, h: 14 + inner };
};

const ctaLayout = (text: string, s = 1) => {
  const size = pick([44, 40, 36, 32], (z) => lineCount(text, z, 800 / s, SERIF) <= 2);
  const lines = lineCount(text, size, 800 / s, SERIF);
  // Alone it is a pill: a 2.5 border, 14 of padding above and below.
  return { size, lines, h: 12 + 5 + 2 * 14 + lines * Math.round(size * 1.2) };
};

const contactsLayout = (layout: PosterLayout, withCta: boolean, s = 1) => {
  const n = layout.contacts.length;
  const colW = Math.floor((CARD - 80 - (n - 1) * 50) / n);
  const heading = withCta ? ctaLayout(layout.cta, s) : null;
  let cols = 0;
  const per = layout.contacts.map((c) => {
    const nameSize = pick([50, 46, 42, 38, 34, 30], (z) => lineCount(c.name, z, (colW - 10) / s, SERIF) <= 2);
    const parts = splitDetail(c.detail);
    const detailSize = pick([42, 38, 34, 30, 26, 23], (z) => parts.every((p) => lineCount(p, z, (colW - 6) / s, {}) <= 1));
    const nl = c.name ? lineCount(c.name, nameSize, (colW - 10) / s, SERIF) : 0;
    const dl = c.detail ? parts.reduce((a, p) => a + Math.max(1, lineCount(p, detailSize, (colW - 6) / s, {})), 0) : 0;
    const h = nl * Math.round(nameSize * 1.18) + (c.name && c.detail ? 6 : 0) + dl * Math.round(detailSize * 1.22);
    cols = Math.max(cols, h);
    return { nameSize, detailSize };
  });
  // Drawn: 20 of padding above; the heading (and 10 below it); the label's pill (52 tall, 12 below it); the columns; 22 below.
  const headH = heading ? heading.lines * Math.round(heading.size * 1.2) + 10 : 0;
  const labelH = layout.contacts_label ? 52 + 12 : 0;
  const inner = EDGE + 20 + headH + labelH + cols + 22;
  return { n, colW, per, cols, heading, labelH, inner, h: 16 + inner };
};

const statLayout = (ctx: Ctx, s = 1) => {
  const st = ctx.poster.stat;
  const valueSize = Math.min(118, (118 * 6) / Math.max(4, flyerTextLength(st.value)));
  const column = (st.label ? Math.round(26 * 1.2) : 0) + Math.round(valueSize) - (st.label ? 2 : 0);
  const caption = st.caption ? lineCount(st.caption, 27, 740 / s, { caps: true, spacing: 1.2 }) * Math.round(27 * 1.22) + 4 : 0;
  const inner = EDGE + 14 + Math.max(100, column) + caption + 17;
  return { valueSize, inner, h: 22 + inner };
};

const agendaLayout = (ctx: Ctx, s = 1) => {
  let rows = 14;
  for (const r of ctx.poster.agenda) {
    const t = Math.max(lineCount(r.time, 29, 262 / s), 1) * 36;
    const x = Math.max(lineCount(r.text, 28, 490 / s), 1) * 35;
    rows += Math.max(74, t, x) + 20;
  }
  return { h: rows };
};

const paragraphType = (story: boolean) => (story ? { size: 32, line: 46 } : { size: 26, line: 38 });

const footerLayout = (text: string, s = 1) => {
  const size = Math.round(Math.min(34, (34 * 40) / Math.max(30, flyerTextLength(text))));
  // Drawn: 22 above, the divider (14) and 8, then the line (it may take two lines at a larger scale).
  const lines = lineCount(text, size, (COL - 100) / s, SERIF);
  return { size, h: 22 + 14 + 8 + lines * Math.round(size * 1.25) };
};

// The picture: the size of its frame by shape (units); a free picture is fitted into the same room, as it is.
const HERO_BOX: Record<HeroShape, { w: number; h: number }> = { arch: { w: 470, h: 560 }, rounded: { w: 820, h: 480 }, circle: { w: 440, h: 440 }, free: { w: 820, h: 480 } };
const heroLayout = (shape: HeroShape, img: PosterImage | null) => {
  const box = HERO_BOX[shape];
  if (shape === "free" && img && img.w > 0 && img.h > 0) {
    const ratio = img.w / img.h;
    const w = Math.min(box.w, box.h * ratio);
    return { w: Math.round(w), h: Math.round(w / ratio), h_block: 20 + Math.round(w / ratio) };
  }
  return { w: box.w, h: box.h, h_block: 20 + box.h };
};

/** One card for each group of people, two to a row (an odd last one takes the whole row). */
const CREDIT_TEXT = 27;
const creditsLayout = (groups: readonly CreditGroup[], s = 1) => {
  const shown = groups.filter((g) => g.heading || g.names);
  const colW = Math.floor((CARD - 20) / 2);
  const cards = shown.map((g, i) => {
    const full = shown.length % 2 === 1 && i === shown.length - 1;
    const w = full ? CARD : colW;
    const headLines = g.heading ? lineCount(g.heading, 36, (w - 56 - 76) / s, SERIF) : 0;
    const nameLines = g.names ? lineCount(g.names, CREDIT_TEXT, (w - 56) / s, {}) : 0;
    const head = Math.max(64, headLines * Math.round(36 * 1.2));
    const h = EDGE + 18 + head + (g.names ? 8 + nameLines * Math.round(CREDIT_TEXT * 1.32) : 0) + 20;
    return { w, h, full };
  });
  const rows: number[][] = [];
  for (let i = 0; i < cards.length; ) {
    if (cards[i]!.full || i === cards.length - 1) rows.push([i++]);
    else {
      rows.push([i, i + 1]);
      i += 2;
    }
  }
  const rowH = rows.map((r) => Math.max(...r.map((j) => cards[j]!.h)));
  return { shown, cards, rows, rowH, h: shown.length ? 16 + rowH.reduce((a, b) => a + b, 0) + 16 * (rows.length - 1) : 0 };
};

const donorsLayout = (heading: string, names: string, s = 1) => {
  const size = 36;
  const lines = lineCount(names, size, (CARD - 120) / s, SERIF);
  const panel = EDGE + 22 + lines * Math.round(size * 1.3) + 24;
  const pill = heading ? 52 : 0;
  return { size, lines, panel, pill, h: 18 + pill + (pill ? 10 : 0) + panel };
};

const closingLayout = (text: string, s = 1) => {
  const size = pick([34, 32, 30, 28], (z) => lineCount(text, z, (CARD - 120) / s, {}) <= 4);
  const lines = lineCount(text, size, (CARD - 120) / s, {});
  const inner = EDGE + 2 * 22 + lines * Math.round(size * 1.36);
  return { size, lines, inner, h: 16 + inner };
};

/** The pastel fills of the thank-you cards, from the palette: each one light enough for the ink to read at 7:1. */
export const creditTints = (pal: PosterPalette): string[] =>
  // A soft sage, rose, sky, apricot, lilac and sand, each warmed by the palette's own accent so they sit with the brand.
  ["#A9CBA4", "#E8B1A8", "#A9C8E6", "#F2C98B", "#C9B9E8", "#D8CBA7"].map((hue) => mix(mix(pal.paper, hue, 0.4), pal.accent, 0.04));

const logosHeight = 132;

/** The RSVP code as a block of its own: the code 190 across in a white card with "RSVP" and "Scan to reply". */
const QR_BLOCK_IMAGE = 190;
const qrBlockHeight = 16 + 6 + 12 + QR_BLOCK_IMAGE + 6 + 26 + 17 + 8;

/** The height of one block (units; scale 1 with the line counts of scale `s`: the drawn height is `s` times as much). */
export function blockHeight(key: BlockKey, ctx: Ctx, s = 1): number {
  const { poster, layout, spec } = ctx;
  switch (key) {
    case "greeting_top":
      return greetingLayout(layout.greeting.top, "top", s).h;
    case "greeting_bottom":
      return greetingLayout(layout.greeting.bottom, "bottom", s).h;
    case "logos":
      return logosHeight;
    case "eyebrow":
      return eyebrowLayout(layout.eyebrow, spec.style.title.caps, s, innerWidth(ctx, "eyebrow")).h;
    case "title": {
      const t = titlePlan(ctx.headline, layout.accent, spec, { width: titleWidth(spec, innerWidth(ctx, "title")), story: ctx.story, scale: s, height: ctx.H });
      return spec.style.title.set === "banner" ? bannerHeight(t) + 14 : t.height + 8;
    }
    case "subhead":
      return subheadLayout(poster.subhead, spec.style.subhead, s, innerWidth(ctx, "subhead")).h;
    case "tagline":
      return taglineLayout(poster.slogan, spec.style.tagline, s, innerWidth(ctx, "tagline")).h;
    case "hero":
      return heroLayout(layout.hero.shape, ctx.hero).h_block;
    case "credits":
      return creditsLayout(layout.credits, s).h;
    case "donors":
      return donorsLayout(layout.donors.heading, layout.donors.names, s).h;
    case "closing":
      return closingLayout(layout.closing, s).h;
    case "host":
      return hostLayout(layout.host.label, layout.host.names, s).h;
    case "stat":
      return statLayout(ctx, s).h;
    case "when":
      return whenLayout(ctx, spec.style.when, s).h;
    case "agenda":
      return agendaLayout(ctx, s).h;
    case "note":
      return noteLayout(layout.note.text, s).h;
    case "paragraph": {
      const p = paragraphType(ctx.story);
      return 18 + lineCount(poster.paragraph, p.size, 860 / s) * p.line;
    }
    case "cta":
      // With contacts the line is the card's heading (the contacts block holds it); alone it is a pill of its own.
      return ctx.heading ? 0 : ctaLayout(layout.cta, s).h;
    case "contacts":
      return contactsLayout(layout, ctx.heading, s).h;
    case "qr":
      return qrBlockHeight;
    case "footer":
      return footerLayout(poster.footer, s).h;
  }
}

/** A banner title keeps to the banner; a plain one keeps clear of the ornaments some frames hang in the top corners (140 units a side). */
const titleWidth = (spec: PresetSpec, inner?: number) => inner ?? (spec.style.title.set === "banner" ? CARD - 150 : COL - 180);
const bannerPad = 24;
const bannerHeight = (t: TitlePlan) => t.height + 2 * bannerPad;

// ── The plan ─────────────────────────────────────────────────────────────────

export type LayoutPlan = {
  /** The scale every block is drawn at (1 = the reference sizes). */
  k: number;
  /** The flyer's height in units. */
  H: number;
  sceneScale: number;
  sceneH: number;
  /** Units above the bottom edge the scene (or the QR card) needs. */
  reserve: number;
  /** The blocks drawn, in order. */
  blocks: BlockKey[];
  /** The height of each block at the scale it is drawn at, divided by that scale (margins included). */
  heights: Partial<Record<BlockKey, number>>;
  /** Extra air between blocks (units, after scaling) and at the top. */
  gap: number;
  top: number;
  /** Blocks left out because there was not room even at the smallest comfortable scale (in the order they went). */
  dropped: BlockKey[];
  /** How much larger than its usual size the picture is drawn (it takes room that is left over). */
  heroGrow: number;
  /** The arched window behind the first to the last of its blocks that are drawn, or null. */
  win: { first: BlockKey; last: BlockKey; width: number } | null;
};

/** Where each block is drawn (units from the top of the flyer), from the plan. */
export function blockPositions(plan: LayoutPlan): { key: BlockKey; y: number; h: number }[] {
  const out: { key: BlockKey; y: number; h: number }[] = [];
  let y = plan.top;
  plan.blocks.forEach((key, i) => {
    if (i > 0) y += (tightBetween(plan.blocks[i - 1]!, key) ? 0.3 : 1) * plan.gap;
    const h = plan.k * (plan.heights[key] ?? 0);
    out.push({ key, y, h });
    y += h;
  });
  return out;
}

/** Blocks that sit close to the one before (the spacer between them is a fraction of the usual). */
const TIGHT_AFTER: readonly BlockKey[] = ["eyebrow", "greeting_top"];
const tightBetween = (prev: BlockKey, next: BlockKey) => TIGHT_AFTER.includes(prev) || (prev === "title" && (next === "subhead" || next === "tagline")) || (prev === "subhead" && next === "tagline") || (prev === "cta" && next === "contacts");

/** Where the stack of blocks ends, in units from the top of the flyer (the tests check it stays above the bottom scene). */
export function stackBottom(plan: LayoutPlan): number {
  const last = blockPositions(plan).pop();
  return last ? last.y + last.h : plan.top;
}

export const LAYOUT_SCALES = { min: K_MIN, floor: K_FLOOR, max: K_MAX } as const;

export function layoutCtx(input: Pick<PosterInput, "design" | "poster" | "logo" | "assets"> & { centerName?: string }, H: number): Ctx {
  const layout = input.poster.layout!;
  const venue = input.design.venue_line;
  const hero = input.assets.hero ?? null;
  const has = { poster: input.poster, layout, hasLogo: Boolean(input.logo), venue, hero: Boolean(hero) };
  const spec = layoutPreset(layout.preset);
  const members = spec.style.window ? presentBlocks(input.poster, layout, { hasLogo: has.hasLogo, venue, hero: has.hero }).filter((b) => spec.style.window!.blocks.includes(b)) : [];
  const ctx: Ctx = {
    headline: input.design.headline,
    heading: blockPresent("cta", has) && blockPresent("contacts", has),
    poster: input.poster,
    layout,
    spec,
    venue,
    story: H > STORY_FROM,
    H,
    logo: Boolean(input.logo),
    centerName: input.centerName ?? "",
    hero,
    win: spec.style.window && members.length ? { members, width: spec.style.window.width } : null,
  };
  return ctx;
}

/** What goes on the flyer, how big, and how much room is left: pure, so the tests can check it. */
export function planLayout(input: Pick<PosterInput, "design" | "poster" | "logo" | "assets"> & { centerName?: string }, dims: { w: number; h: number }, pack: ArtPack, o: { qr?: boolean } = {}): LayoutPlan {
  const u = dims.w / W;
  const H = dims.h / u;
  const ctx = layoutCtx(input, H);
  const { poster, layout, spec } = ctx;
  const qrOn = o.qr ?? input.design.show_qr;
  const present = presentBlocks(poster, layout, { hasLogo: ctx.logo, venue: ctx.venue, qr: qrOn, hero: Boolean(ctx.hero) });
  // A call to action beside contacts is drawn inside their card: it takes no room of its own.
  let blocks = present.filter((b) => !(b === "cta" && ctx.heading));

  const sceneOn = poster.scene.source !== "none";
  let sceneScale = Math.min(ctx.story ? SCENE_MAX_STORY : 1.12, Math.max(0.78, ctx.story ? (H / 1620) * 1.2 : H / 1620));
  // A code in the flow is a block; one that is not is a small card in the corner, over the art, which the bottom needs room for.
  const showQr = qrOn && spec.style.qr === "corner";
  const reserveFor = (s: number) => Math.max(sceneOn ? pack.scene.busy * s : 0, showQr ? POSTER_UNITS.qrCard * LAYOUT_QR_SCALE + 18 + 22 : 0, 24);
  // The window's arch rises above its first block: the words start lower to leave it room.
  const topPad = Math.max(64, pack.topInset + 12) + (ctx.win ? WINDOW_RISE - 24 : 0);
  const room = (s: number) => H - reserveFor(s) - SLACK;
  const dropped: BlockKey[] = [];

  const heightsAt = (k: number) => {
    const hs: Partial<Record<BlockKey, number>> = {};
    for (const b of blocks) hs[b] = blockHeight(b, ctx, k);
    // The window needs a little room under its last block.
    const last = ctx.win ? [...blocks].reverse().find((b) => ctx.win!.members.includes(b)) : undefined;
    if (last) hs[last] = (hs[last] ?? 0) + WINDOW_FOOT;
    return hs;
  };
  const sum = (hs: Partial<Record<BlockKey, number>>) => Object.values(hs).reduce((a, b) => a + (b ?? 0), 0);
  /** The largest scale (to 0.01, between `lowest` and K_MAX) at which the blocks fit above the scene, or null. */
  const solve = (lowest: number) => {
    const fitsAt = (k: number) => {
      const hs = heightsAt(k);
      return k * (sum(hs) + topPad) <= room(sceneScale) ? hs : null;
    };
    const top = fitsAt(K_MAX);
    if (top) return { k: K_MAX, heights: top };
    let best = fitsAt(lowest);
    if (!best) return null;
    // Bisection: the drawn height grows with the scale, so the largest scale that fits (to 0.01) is found in a handful of looks.
    let lo = lowest;
    let hi = K_MAX;
    while (hi - lo > 0.0105) {
      const mid = Math.round(((lo + hi) / 2) * 100) / 100;
      if (mid <= lo || mid >= hi) break;
      const hs = fitsAt(mid);
      if (hs) {
        lo = mid;
        best = hs;
      } else hi = mid;
    }
    return { k: lo, heights: best };
  };
  let fitted = solve(K_MIN);
  // Long content on a short flyer: the scene gives way first (down to half its size), then the words.
  while (sceneOn && (!fitted || fitted.k < 0.8) && sceneScale > 0.5) {
    sceneScale = Math.max(0.5, sceneScale * 0.92);
    fitted = solve(K_MIN);
  }
  // Still too much at the smallest comfortable scale: leave the least important block out (the render says so) and look again. Only when
  // nothing more can go does the scale fall below it, so nothing is ever pushed off the flyer.
  while (!fitted) {
    const next = spec.dropOrder.find((b) => blocks.includes(b));
    if (!next) {
      fitted = solve(K_FLOOR) ?? { k: K_FLOOR, heights: heightsAt(K_FLOOR) };
      break;
    }
    blocks = blocks.filter((b) => b !== next);
    dropped.push(next);
    fitted = solve(K_MIN);
  }
  const { k, heights } = fitted!;
  const reserve = reserveFor(sceneScale);
  let left = Math.max(0, room(sceneScale) - (sum(heights) + topPad) * k);
  // The picture is the one block that can grow: it takes up to three quarters of the room left over, to half as large again, and never wider than the column.
  let heroGrow = 1;
  if (blocks.includes("hero") && heights.hero) {
    const base = heights.hero - 20;
    const shape = layout.hero.shape;
    const widest = shape === "free" ? Number.POSITIVE_INFINITY : 880 / HERO_BOX[shape].w;
    heroGrow = Math.max(1, Math.min(1.5, widest, 1 + (0.75 * left) / (base * k)));
    heights.hero = 20 + base * heroGrow;
    left = Math.max(0, room(sceneScale) - (sum(heights) + topPad) * k);
  }
  let weights = 0;
  for (let i = 1; i < blocks.length; i++) weights += tightBetween(blocks[i - 1]!, blocks[i]!) ? 0.3 : 1;
  const gap = Math.min(ctx.story ? 170 : H > 1700 ? 100 : H > 1500 ? 90 : H > 1200 ? 70 : 50, left / (weights + 1));
  // What is still left goes above the stack and below it in equal parts (a Story's counts only the gaps really drawn, between the blocks).
  const extraTop = Math.max(0, left - gap * weights) * 0.5;
  const inWindow = ctx.win ? blocks.filter((b) => ctx.win!.members.includes(b)) : [];
  const win = ctx.win && inWindow.length ? { first: inWindow[0]!, last: inWindow[inWindow.length - 1]!, width: ctx.win.width } : null;
  return { k: Math.round(k * 1000) / 1000, H, sceneScale, sceneH: pack.scene.height * sceneScale, reserve, blocks, heights, gap, top: topPad * k + extraTop, dropped, heroGrow, win };
}

/** What the organizer should be told about the layout at this size, in plain sentences (the same plan the picture is drawn from). */
export function layoutNotes(input: Pick<PosterInput, "design" | "poster" | "logo" | "assets" | "brand"> & { centerName?: string }, dims: { w: number; h: number }): string[] {
  const plan = planLayout(input, dims, artPack(input.poster.occasion, input.brand));
  const notes: string[] = [];
  if (plan.dropped.length) {
    const names = plan.dropped.map((b) => BLOCK_NAME[b]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    notes.push(`There was not room for the ${list} on this flyer, so ${plan.dropped.length > 1 ? "they were" : "it was"} left out. Shorten the text, switch a block off, or choose the Tall or Story size, which have more room.`);
  }
  if (plan.k < 0.7) {
    notes.push(`This flyer is crowded, so its words are set small (${Math.round(plan.k * 100)}% of the usual size). Shorten some text, switch a block off, or choose the Tall or Story size.`);
  }
  return notes;
}

const BLOCK_NAME: Record<BlockKey, string> = {
  greeting_top: "greeting at the top",
  logos: "logos",
  eyebrow: "small line above the title",
  title: "title",
  subhead: "sub-title",
  tagline: "tagline",
  hero: "picture",
  host: "host card",
  stat: "highlight box",
  when: "date, time and place",
  agenda: "agenda",
  note: "note box",
  paragraph: "paragraph",
  credits: "thank-you cards",
  donors: "donors panel",
  closing: "closing message",
  cta: "call to action",
  contacts: "contacts",
  qr: "RSVP code",
  footer: "footer line",
  greeting_bottom: "greeting at the bottom",
};

// ── Drawing ──────────────────────────────────────────────────────────────────

/** The card fill: the paper warmed with a little of the gold, so cards stand off the page and the ink still reads at 7:1. */
export const cardFill = (pal: PosterPalette) => mix(pal.paper, pal.gold, 0.13);
/** The note's fill: the paper lightened, so it stands apart from the warm cards. */
export const tintFill = (pal: PosterPalette) => mix(pal.paper, "#FFFFFF", 0.6);

/** The fills the blocks stand on, and the small gold label that reads on the card (the palette's gold text, made darker where the card's warmth costs it contrast). */
export function layoutColors(pal: PosterPalette) {
  const card = cardFill(pal);
  return {
    card,
    tint: tintFill(pal),
    /** The small gold capitals on the host card. */
    cardLabel: readableOn(pal.goldText, card, 4.5),
    /** The accent colour for words and icons on a card (the date, the host's names, a contact's name). */
    cardAccent: readableOn(pal.accent, card, 4.5),
    /** The gold text on the paper itself (the small line above the title, a caps sub-title, the footer line). */
    goldOnPaper: readableOn(pal.goldText, pal.paper, 4.5),
  };
}

export function layoutElement(input: PosterInput, dims: { w: number; h: number }, fonts: LayoutFonts, qrDataUri: string | null): ReactElement {
  const { design, poster } = input;
  const layout = poster.layout!;
  const pack = artPack(poster.occasion, input.brand);
  const pal: PosterPalette = pack.palette;
  const lc = layoutColors(pal);
  const qr = input.design.show_qr && qrDataUri ? qrDataUri : null;
  const plan = planLayout(input, dims, pack, { qr: Boolean(qr) });
  const ctx = layoutCtx(input, plan.H);
  const { spec } = ctx;
  const u = dims.w / W;
  const k = plan.k;
  const px = (v: number) => Math.round(v * k * u * 10) / 10;
  const ux = (v: number) => Math.round(v * u * 10) / 10;
  const { w, h } = dims;
  const unit = (v: number) => Math.max(1, px(v));
  const gapPx = ux(plan.gap);

  const layers = posterLayers({ poster, assets: input.assets, pack, pal, dims, H: plan.H, sceneScale: plan.sceneScale, sceneH: plan.sceneH, reserve: plan.reserve, footer: 0 });

  const icon = (name: PosterIcon, color: string, size: number, strokeWidth = 2.6) => image(posterIconUri(name, color, strokeWidth), px(size), px(size));
  const iconCircle = (name: PosterIcon, size: number) =>
    box(
      { width: px(size), height: px(size), borderRadius: px(size / 2), border: `${unit(3)}px solid ${pal.gold}`, backgroundColor: "rgba(255,255,255,0.82)", alignItems: "center", justifyContent: "center", flexShrink: 0 },
      image(posterIconUri(name, pal.ink), px(size * 0.56), px(size * 0.56)),
    );
  const center = { display: "flex", justifyContent: "center", textAlign: "center" as const, flexShrink: 0 };
  const divider = (width: number, height: number, color: string) => image(svgDataUri(dividerSvg(width * 4, height * 4, color)), px(width), px(height));
  const sprig = (flip: boolean, color: string) => image(svgDataUri(sprigSvg(120, 48, color, flip)), px(60), px(24));
  const card = (width: number, fill: string, radius: number, children: ReactNode[], height?: number) => (
    <div style={{ display: "flex", position: "relative", width: ux(width), flexShrink: 0, ...(height ? { height: px(height) } : {}) }}>
      {haloLayers({ rgb: "27,44,92", alpha: 0.1, radius: px(radius), spread: px(10), dy: px(5) })}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", width: ux(width), backgroundColor: fill, border: `${unit(3)}px solid ${pal.gold}`, borderRadius: px(radius), ...(height ? { height: px(height) } : {}) }}>
        {box({ position: "absolute", left: px(6), top: px(6), right: px(6), bottom: px(6), border: `${unit(1)}px solid ${pal.gold}`, borderRadius: px(radius - 6), opacity: 0.7 })}
        {children}
      </div>
    </div>
  );
  const ornamentRow = (label: ReactNode, side: ReactNode, sideFlip: ReactNode, gap = 14) => box({ alignItems: "center", justifyContent: "center", gap: px(gap) }, side, label, sideFlip);

  const draw: Record<BlockKey, () => ReactNode> = {
    greeting_top: () => {
      const g = greetingLayout(layout.greeting.top, "top", k);
      return (
        <div key="greeting_top" style={{ ...center, flexDirection: "column", alignItems: "center", marginTop: px(14), flexShrink: 0 }}>
          {txt({ fontFamily: g.script ? fonts.script : fonts.display, fontWeight: g.script ? 400 : 700, fontSize: px(g.size), lineHeight: 1.2, color: pal.accent, maxWidth: ux(COL - 120) }, layout.greeting.top)}
          <div style={{ display: "flex", marginTop: px(10) }}>{divider(220, 18, pal.gold)}</div>
        </div>
      );
    },
    logos: () => {
      const items: ReactNode[] = [];
      const showName = poster.logo && !input.logo;
      if (poster.logo && input.logo) {
        const s = fit(input.logo, px(330), px(124));
        items.push(image(input.logo.dataUri, s.width, s.height));
      } else if (showName) {
        const name = input.centerName;
        items.push(txt({ fontFamily: fonts.display, fontWeight: 800, fontSize: px(Math.min(46, (46 * 26) / Math.max(26, flyerTextLength(name)))), color: pal.ink, lineHeight: 1.1, textAlign: "center", justifyContent: "center", maxWidth: px(560) }, name));
      }
      if (poster.partner.on) {
        if (items.length) items.push(box({ width: Math.max(1, px(2)), height: px(92), backgroundColor: pal.gold }));
        const logo = input.assets.partnerLogo;
        if (logo) {
          const s = fit(logo, px(300), px(124));
          items.push(image(logo.dataUri, s.width, s.height));
        } else {
          const b = 122;
          const label = poster.partner.label || "PARTNER";
          const sub = poster.partner.sub;
          const { label: labelSize, labelGap, sub: subSize, subGap } = badgeSizes(label, sub);
          items.push(
            box(
              { width: px(b), height: px(b), borderRadius: px(b / 2), backgroundColor: pal.ink, border: `${unit(4)}px solid ${pal.gold}`, alignItems: "center", justifyContent: "center", flexDirection: "column", position: "relative" },
              box({ position: "absolute", left: px(4), top: px(4), width: px(b - 16), height: px(b - 16), borderRadius: px((b - 16) / 2), border: `${unit(1.5)}px solid ${pal.gold}` }),
              txt({ fontFamily: fonts.display, fontWeight: 800, fontSize: px(labelSize), color: pal.paper, lineHeight: 1, letterSpacing: px(labelGap) }, label),
              sub ? txt({ fontWeight: 800, fontSize: px(subSize), color: pal.gold, letterSpacing: px(subGap), marginTop: px(5), marginLeft: px(subGap) }, sub) : null,
            ),
          );
        }
      }
      return (
        <div key="logos" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: px(28), height: px(logosHeight), flexShrink: 0 }}>
          {items}
        </div>
      );
    },
    eyebrow: () => {
      const e = eyebrowLayout(layout.eyebrow, spec.style.title.caps, k, innerWidth(ctx, "eyebrow"));
      const text = e.caps
        ? txt({ fontWeight: 800, fontSize: px(e.size), letterSpacing: px(8), color: lc.goldOnPaper, textTransform: "uppercase", lineHeight: 1.2, textAlign: "center", justifyContent: "center", maxWidth: ux(Math.min(640, innerWidth(ctx, "eyebrow") ?? 640)) }, layout.eyebrow)
        : txt({ fontFamily: fonts.display, fontWeight: 700, fontSize: px(e.size), letterSpacing: px(1), color: pal.ink, lineHeight: 1.2, textAlign: "center", justifyContent: "center", maxWidth: ux(Math.min(640, innerWidth(ctx, "eyebrow") ?? 640)) }, layout.eyebrow);
      return (
        <div key="eyebrow" style={{ display: "flex", justifyContent: "center", marginTop: px(8), flexShrink: 0 }}>
          {ornamentRow(text, sprig(false, pal.gold), sprig(true, pal.gold), 16)}
        </div>
      );
    },
    title: () => {
      const t = spec.style.title;
      const tw = titleWidth(spec, innerWidth(ctx, "title"));
      const tp = titlePlan(design.headline, layout.accent, spec, { width: tw, story: ctx.story, scale: k, height: plan.H });
      const onBanner = t.set === "banner";
      const ink = onBanner ? pal.onAccent : pal.ink;
      const accentColor = onBanner ? pal.ribbonHi : pal.accent;
      const face = t.face === "display" ? fonts.display : fonts.body;
      const space = (tp.size * 0.27 + (t.caps ? tp.size * 0.02 : 0)) * k * u;
      const lines = tp.lines.map((line, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", width: ux(tw + 40), height: Math.round(tp.size * tp.lineHeight * k * u * 10) / 10 }}>
          {line.map((word, j) => (
            <div
              key={j}
              style={{
                display: "flex",
                fontFamily: word.script ? fonts.script : face,
                fontWeight: word.script ? 400 : 800,
                fontSize: px(word.size),
                color: word.accent ? accentColor : ink,
                lineHeight: 1,
                textTransform: t.caps && !word.script ? "uppercase" : "none",
                letterSpacing: t.caps && !word.script ? px(tp.size * 0.02) : 0,
                marginLeft: j ? space / 2 : 0,
                marginRight: j < line.length - 1 ? space / 2 : 0,
              }}
            >
              {word.text}
            </div>
          ))}
        </div>
      ));
      if (!onBanner) {
        return (
          <div key="title" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: ux(COL), marginTop: px(8), flexShrink: 0 }}>
            {lines}
          </div>
        );
      }
      const bh = bannerHeight(tp);
      const bw = CARD;
      return (
        <div key="title" style={{ display: "flex", position: "relative", width: ux(bw), height: px(bh), marginTop: px(14), flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
          {image(svgDataUri(bannerSvg({ w: bw, h: bh, light: mix(pal.accent, "#FFFFFF", 0.14), dark: mix(pal.accent, "#000000", 0.24), gold: pal.gold })), ux(bw), px(bh), { position: "absolute", left: 0, top: 0 })}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>{lines}</div>
        </div>
      );
    },
    subhead: () => {
      const mws = innerWidth(ctx, "subhead");
      const s = subheadLayout(poster.subhead, spec.style.subhead, k, mws);
      if (spec.style.subhead === "script") {
        return (
          <div key="subhead" style={{ ...center, width: ux(mws ?? COL), marginTop: px(6), fontFamily: s.script ? fonts.script : fonts.display, fontWeight: s.script ? 400 : 700, fontSize: px(s.script ? s.size : s.size * 0.8), lineHeight: 1.15, color: pal.accent }}>
            {poster.subhead}
          </div>
        );
      }
      if (spec.style.subhead === "caps") {
        const rule = (flip: boolean) =>
          box({ alignItems: "center", gap: px(6), flexShrink: 0 }, ...(flip ? [box({ width: px(64), height: unit(2.5), backgroundColor: pal.gold }), diamond(px(7), pal.gold)] : [diamond(px(7), pal.gold), box({ width: px(64), height: unit(2.5), backgroundColor: pal.gold })]));
        return (
          <div key="subhead" style={{ display: "flex", alignItems: "center", gap: px(18), marginTop: px(12), flexShrink: 0, maxWidth: ux(mws ?? COL) }}>
            {rule(false)}
            <div style={{ ...center, fontWeight: 800, fontSize: px(35), letterSpacing: px(5), color: lc.goldOnPaper, textTransform: "uppercase", lineHeight: 1.2, maxWidth: ux((mws ?? COL) - 200) }}>{poster.subhead}</div>
            {rule(true)}
          </div>
        );
      }
      return (
        <div key="subhead" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: px(20), marginTop: px(10), flexShrink: 0 }}>
          {diamond(px(10), pal.gold)}
          <div style={{ ...center, fontFamily: fonts.display, fontWeight: 600, fontSize: px(s.size), lineHeight: 1.2, color: pal.ink, maxWidth: ux((mws ?? COL) - 160) }}>{poster.subhead}</div>
          {diamond(px(10), pal.gold)}
        </div>
      );
    },
    tagline: () => {
      const mwt = innerWidth(ctx, "tagline");
      const t = taglineLayout(poster.slogan, spec.style.tagline, k, mwt);
      if (spec.style.tagline === "script") {
        return (
          <div key="tagline" style={{ ...center, width: ux(mwt ?? COL - 60), marginTop: px(10), fontFamily: t.script ? fonts.script : fonts.display, fontWeight: t.script ? 400 : 700, fontSize: px(t.script ? t.size : t.size * 0.8), lineHeight: 1.2, color: pal.accent }}>
            {poster.slogan}
          </div>
        );
      }
      if (spec.style.tagline === "pill") {
        return (
          <div key="tagline" style={{ display: "flex", marginTop: px(14), flexShrink: 0, maxWidth: ux(Math.min(820, mwt ?? 820)) }}>
            <div style={{ ...center, fontFamily: fonts.body, fontWeight: 700, fontSize: px(t.size), lineHeight: 1.22, color: pal.onAccent, backgroundColor: pal.accent, borderRadius: px(46), padding: `${px(20)}px ${px(54)}px`, border: `${unit(3)}px solid ${pal.gold}`, maxWidth: ux(Math.min(820, mwt ?? 820)) }}>{poster.slogan}</div>
          </div>
        );
      }
      return (
        <div key="tagline" style={{ ...center, width: ux(mwt ?? COL - 20), marginTop: px(12), fontWeight: 800, fontSize: px(t.size), letterSpacing: px(1.5), color: pal.ink, lineHeight: 1.2 }}>
          {poster.slogan}
        </div>
      );
    },
    hero: () => {
      const shape = layout.hero.shape;
      const img = input.assets.hero!;
      const hl = heroLayout(shape, img);
      const wpx = px(hl.w * plan.heroGrow);
      const hpx = px(hl.h * plan.heroGrow);
      if (shape === "free") {
        return (
          <div key="hero" style={{ display: "flex", marginTop: px(20), flexShrink: 0 }}>
            {image(img.dataUri, wpx, hpx)}
          </div>
        );
      }
      const radius = shape === "arch" ? { borderTopLeftRadius: wpx / 2, borderTopRightRadius: wpx / 2, borderBottomLeftRadius: px(28), borderBottomRightRadius: px(28) } : shape === "circle" ? { borderRadius: wpx / 2 } : { borderRadius: px(36) };
      const edge = unit(5);
      return (
        <div key="hero" style={{ display: "flex", position: "relative", marginTop: px(20), width: wpx, height: hpx, flexShrink: 0 }}>
          {shape === "rounded" ? haloLayers({ rgb: "27,44,92", alpha: 0.18, radius: px(36), spread: px(16), dy: px(8) }) : null}
          <div style={{ display: "flex", position: "relative", width: wpx, height: hpx, overflow: "hidden", border: `${edge}px solid ${pal.gold}`, backgroundColor: pal.paper, ...radius }}>
            {image(img.dataUri, Math.max(1, wpx - 2 * edge), Math.max(1, hpx - 2 * edge), { objectFit: "cover" })}
          </div>
        </div>
      );
    },
    host: () => {
      const hl = hostLayout(layout.host.label, layout.host.names, k);
      return (
        <div key="host" style={{ display: "flex", marginTop: px(18), flexShrink: 0 }}>
          {card(CARD - 20, cardFill(pal), 34, [
            <div key="in" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: `${px(18)}px ${px(40)}px ${px(22)}px`, position: "relative" }}>
              {layout.host.label ? (
                <div style={{ display: "flex", alignItems: "center", gap: px(14), marginBottom: px(6) }}>
                  {sprig(false, pal.gold)}
                  {txt({ fontWeight: 800, fontSize: px(30), letterSpacing: px(5), color: lc.cardLabel, textTransform: "uppercase" }, layout.host.label)}
                  {sprig(true, pal.gold)}
                </div>
              ) : null}
              <div style={{ ...center, fontFamily: fonts.display, fontWeight: 700, fontSize: px(hl.size), lineHeight: 1.14, color: lc.cardAccent, maxWidth: ux(CARD - 110) }}>{layout.host.names}</div>
            </div>,
          ], hl.inner)}
        </div>
      );
    },
    stat: () => {
      const st = poster.stat;
      const sl = statLayout(ctx, k);
      const valueSize = sl.valueSize;
      return (
        <div key="stat" style={{ display: "flex", marginTop: px(22), flexShrink: 0 }}>
          {card(800, pal.paper, 26, [
            <div key="in" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: `${px(14)}px ${px(30)}px ${px(17)}px`, position: "relative" }}>
              {box(
                { alignItems: "center", gap: px(30) },
                iconCircle(poster.stat.icon, 100),
                box(
                  { flexDirection: "column", alignItems: "center" },
                  st.label ? txt({ fontWeight: 800, fontSize: px(26), letterSpacing: px(7), color: pal.ink, marginLeft: px(7), textTransform: "uppercase" }, st.label) : null,
                  txt({ fontFamily: fonts.display, fontWeight: 900, fontSize: px(valueSize), lineHeight: 1, color: pal.accent, marginTop: px(-2) }, st.value),
                ),
                box({ width: px(100), flexShrink: 0 }),
              )}
              {st.caption ? <div style={{ ...center, fontWeight: 800, fontSize: px(27), letterSpacing: px(1.2), color: pal.ink, marginTop: px(4), textTransform: "uppercase", lineHeight: 1.22, maxWidth: ux(740) }}>{st.caption}</div> : null}
            </div>,
          ], sl.inner)}
        </div>
      );
    },
    when: () => {
      const wl = whenLayout(ctx, spec.style.when, k);
      const { date, time } = poster.ribbon;
      const venue = design.venue_line;
      if (wl.kind === "band" && "band" in wl && wl.band) {
        const rl = wl.band;
        const tall = rl.band + 24;
        const whenBox = box(
          { alignItems: "center", gap: px(22), flexShrink: 1 },
          date || time ? image(posterIconUri("calendar", pal.ribbonHi, 2.8), px(58), px(58)) : null,
          box(
            { flexDirection: "column", flexShrink: 1 },
            date ? txt({ fontWeight: 700, fontSize: px(35), color: pal.onAccent, lineHeight: 1.12 }, date) : null,
            time ? txt({ fontWeight: 800, fontSize: px(29), color: pal.ribbonHi, lineHeight: 1.15, marginTop: px(2) }, time) : null,
          ),
        );
        const where = venue
          ? box(
              { alignItems: "center", gap: px(16), flexShrink: 1 },
              image(posterIconUri("pin", pal.ribbonHi, 2.8), px(44), px(44)),
              txt({ fontWeight: 700, fontSize: px(rl.oneRow ? 32 : 31), color: pal.onAccent, lineHeight: 1.2, flexShrink: 1 }, venue),
            )
          : null;
        return (
          <div key="when" style={{ display: "flex", position: "relative", width: w, height: px(tall), marginTop: px(22), flexShrink: 0 }}>
            {image(svgDataUri(ribbonSvg({ W: Math.round(W / k), H: tall, band: rl.band, pal })), w, px(tall), { position: "absolute", left: 0, top: 0 })}
            <div style={{ position: "absolute", left: ux(SIDE), top: 0, width: ux(COL), height: px(rl.band), display: "flex", flexDirection: rl.oneRow ? "row" : "column", alignItems: "center", justifyContent: "center", gap: px(rl.oneRow ? 22 : 10), padding: `${px(14)}px ${px(20)}px` }}>
              {whenBox}
              {rl.oneRow && where && (date || time) ? box({ width: Math.max(1, px(2)), height: px(72), backgroundColor: pal.ribbonHi, marginLeft: px(8), marginRight: px(8), opacity: 0.75 }) : null}
              {where}
            </div>
          </div>
        );
      }
      if (wl.kind === "rules") {
        return (
          <div key="when" style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: px(10), width: ux(COL), flexShrink: 0 }}>
            {divider(560, 20, pal.gold)}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: px(10) }}>
              {date ? <div style={{ ...center, fontFamily: fonts.display, fontWeight: 600, fontSize: px(wl.dateSize), lineHeight: 1.2, color: pal.ink }}>{date}</div> : null}
              {time ? <div style={{ ...center, fontFamily: fonts.display, fontWeight: 600, fontSize: px(wl.timeSize), lineHeight: 1.2, color: pal.accent, marginTop: px(2) }}>{time}</div> : null}
              {venue ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: px(12), marginTop: px(10), maxWidth: ux(860) }}>
                  {icon("pin", pal.accent, 38)}
                  <div style={{ ...center, fontWeight: 600, fontSize: px(wl.venueSize), lineHeight: 1.24, color: pal.body, maxWidth: ux(780) }}>{venue}</div>
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", marginTop: px(10) }}>{divider(560, 20, pal.gold)}</div>
          </div>
        );
      }
      if (wl.kind === "plain") {
        return (
          <div key="when" style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: px(8), flexShrink: 0, width: ux(COL) }}>
            {date ? <div style={{ ...center, fontFamily: fonts.body, fontWeight: 800, fontSize: px(wl.dateSize), lineHeight: 1.18, color: pal.ink }}>{date}</div> : null}
            {time ? <div style={{ ...center, fontFamily: fonts.body, fontWeight: 800, fontSize: px(wl.timeSize), lineHeight: 1.2, color: pal.accent, marginTop: px(2) }}>{time}</div> : null}
            {venue ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: px(14), marginTop: px(14), maxWidth: ux(860) }}>
                {icon("pin", pal.accent, 40)}
                <div style={{ ...center, fontWeight: 500, fontSize: px(wl.venueSize), lineHeight: 1.24, color: pal.body, maxWidth: ux(780) }}>{venue}</div>
              </div>
            ) : null}
          </div>
        );
      }
      const both = Boolean(date && time);
      if (wl.kind !== "cells") return null;
      return (
        <div key="when" style={{ display: "flex", marginTop: px(16), flexShrink: 0 }}>
          {card(CARD, cardFill(pal), 30, [
            <div key="in" style={{ display: "flex", flexDirection: "column", width: ux(CARD), position: "relative" }}>
              {date || time ? (
                <div style={{ display: "flex", alignItems: "center", padding: `${px(22)}px ${px(30)}px` }}>
                  {date ? (
                    <div style={{ display: "flex", alignItems: "center", gap: px(22), width: ux(both ? wl.dateCell! : CARD - 60), justifyContent: both ? "flex-start" : "center", flexShrink: 0 }}>
                      {icon("calendar", lc.cardAccent, ICON)}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: both ? "flex-start" : "center", maxWidth: ux((both ? wl.dateCell! : CARD - 60) - ICON_W) }}>
                        {splitDate(date).map((part, i) => (
                          <div key={i} style={{ display: "flex", fontFamily: fonts.display, fontWeight: 700, fontSize: px(wl.dateSize), lineHeight: 1.14, color: lc.cardAccent, textAlign: both ? "left" : "center" }}>{part}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {both ? box({ width: unit(2), height: px(Math.max(70, wl.cell)), backgroundColor: pal.gold, marginRight: ux(19), marginLeft: ux(19), flexShrink: 0 }) : null}
                  {time ? (
                    <div style={{ display: "flex", alignItems: "center", gap: px(22), width: ux(both ? wl.timeCell! : CARD - 60), justifyContent: both ? "flex-start" : "center", flexShrink: 0 }}>
                      {icon("clock", lc.cardAccent, ICON)}
                      <div style={{ display: "flex", fontFamily: fonts.display, fontWeight: 700, fontSize: px(wl.timeSize), lineHeight: 1.14, color: lc.cardAccent, maxWidth: ux((both ? wl.timeCell! : CARD - 60) - ICON_W) }}>{time}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {venue ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: px(14), padding: `${px(date || time ? 12 : 20)}px ${px(30)}px ${px(18)}px`, borderTop: date || time ? `${unit(1.5)}px solid ${pal.gold}` : "0px solid transparent" }}>
                  {icon("pin", lc.cardAccent, 48)}
                  <div style={{ display: "flex", fontWeight: 700, fontSize: px(wl.venueSize), lineHeight: 1.22, color: pal.ink, maxWidth: ux(CARD - 160), textAlign: "center" }}>{venue}</div>
                </div>
              ) : null}
            </div>,
          ], wl.inner)}
        </div>
      );
    },
    agenda: () => (
      <div key="agenda" style={{ display: "flex", flexDirection: "column", marginTop: px(14), width: ux(870), flexShrink: 0 }}>
        {poster.agenda.map((row, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", paddingTop: px(10), paddingBottom: px(10), borderBottom: i < poster.agenda.length - 1 ? `${unit(2)}px dashed ${pal.gold}` : `0px solid ${pal.paper}` }}>
            {iconCircle(row.icon, 74)}
            <div style={{ display: "flex", width: ux(262), marginLeft: px(24), fontWeight: 800, fontSize: px(29), color: pal.accent, flexShrink: 0, lineHeight: 1.2 }}>{row.time}</div>
            <div style={{ display: "flex", flex: 1, marginLeft: px(14), fontWeight: 700, fontSize: px(28), lineHeight: 1.22, color: pal.ink }}>{row.text}</div>
          </div>
        ))}
      </div>
    ),
    note: () => {
      const nl = noteLayout(layout.note.text, k);
      return (
        <div key="note" style={{ display: "flex", marginTop: px(14), flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", width: ux(CARD), height: px(nl.inner), padding: `0px ${px(30)}px`, backgroundColor: tintFill(pal), border: `${unit(2)}px solid ${pal.gold}`, borderRadius: px(30) }}>
            {iconCircle(layout.note.icon, 100)}
            <div style={{ display: "flex", flex: 1, justifyContent: "center", marginLeft: px(26), fontWeight: 600, fontSize: px(nl.size), lineHeight: 1.34, color: pal.ink, textAlign: "center" }}>{layout.note.text}</div>
          </div>
        </div>
      );
    },
    paragraph: () => {
      const p = paragraphType(ctx.story);
      return (
        <div key="paragraph" style={{ ...center, marginTop: px(18), width: ux(860), fontSize: px(p.size), lineHeight: p.line / p.size, fontWeight: 500, color: pal.body }}>
          {poster.paragraph}
        </div>
      );
    },
    credits: () => {
      const cl = creditsLayout(layout.credits, k);
      const tints = creditTints(pal);
      return (
        <div key="credits" style={{ display: "flex", flexDirection: "column", marginTop: px(16), width: ux(CARD), gap: px(16), flexShrink: 0 }}>
          {cl.rows.map((row, ri) => (
            <div key={ri} style={{ display: "flex", flexDirection: "row", gap: ux(20), height: px(cl.rowH[ri]!) }}>
              {row.map((ci) => {
                const g = cl.shown[ci]!;
                const c = cl.cards[ci]!;
                const fill = tints[ci % tints.length]!;
                const head = readableOn(pal.accent, fill, 4.5);
                return (
                  <div key={ci} style={{ display: "flex", flexDirection: "column", width: ux(c.w), height: px(cl.rowH[ri]!), padding: `${px(18)}px ${px(28)}px ${px(20)}px`, backgroundColor: fill, border: `${unit(3)}px solid ${pal.gold}`, borderRadius: px(26) }}>
                    <div style={{ display: "flex", alignItems: "center", gap: px(12) }}>
                      {iconCircle(g.icon, 64)}
                      <div style={{ display: "flex", flex: 1, fontFamily: fonts.display, fontWeight: 600, fontSize: px(36), lineHeight: 1.2, color: head }}>{g.heading}</div>
                    </div>
                    {g.names ? <div style={{ display: "flex", marginTop: px(8), fontWeight: 500, fontSize: px(CREDIT_TEXT), lineHeight: 1.32, color: pal.ink }}>{g.names}</div> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      );
    },
    donors: () => {
      const dl = donorsLayout(layout.donors.heading, layout.donors.names, k);
      return (
        <div key="donors" style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: px(18), width: ux(CARD), flexShrink: 0 }}>
          {layout.donors.heading ? (
            <div style={{ display: "flex", alignItems: "center", gap: px(14), marginBottom: px(10) }}>
              {sprig(false, pal.gold)}
              <div style={{ ...center, fontWeight: 800, fontSize: px(30), letterSpacing: px(3), color: pal.onAccent, backgroundColor: pal.accent, borderRadius: px(30), padding: `${px(6)}px ${px(40)}px`, border: `${unit(2)}px solid ${pal.gold}`, textTransform: "uppercase" }}>{layout.donors.heading}</div>
              {sprig(true, pal.gold)}
            </div>
          ) : null}
          {card(
            CARD,
            cardFill(pal),
            28,
            [<div key="in" style={{ ...center, position: "relative", fontFamily: fonts.display, fontWeight: 600, fontSize: px(dl.size), lineHeight: 1.3, color: pal.ink, maxWidth: ux(CARD - 120) }}>{layout.donors.names}</div>],
            dl.panel,
          )}
        </div>
      );
    },
    closing: () => {
      const cl = closingLayout(layout.closing, k);
      return (
        <div key="closing" style={{ display: "flex", marginTop: px(16), flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: ux(CARD), height: px(cl.inner), padding: `0px ${px(40)}px`, backgroundColor: tintFill(pal), border: `${unit(3)}px solid ${pal.gold}`, borderRadius: px(30), fontWeight: 700, fontSize: px(cl.size), lineHeight: 1.36, color: pal.ink, textAlign: "center" }}>{layout.closing}</div>
        </div>
      );
    },
    cta: () => {
      const c = ctaLayout(layout.cta, k);
      return (
        <div key="cta" style={{ display: "flex", marginTop: px(12), flexShrink: 0, maxWidth: ux(820) }}>
          <div style={{ ...center, fontFamily: fonts.display, fontWeight: 600, fontSize: px(c.size), lineHeight: 1.2, color: pal.accent, border: `${Math.max(1, Math.round(px(2.5)))}px solid ${pal.accent}`, borderRadius: px(44), padding: `${px(14)}px ${px(40)}px`, maxWidth: ux(820) }}>{layout.cta}</div>
        </div>
      );
    },
    contacts: () => {
      const cl = contactsLayout(layout, ctx.heading, k);
      return (
        <div key="contacts" style={{ display: "flex", marginTop: px(16), flexShrink: 0 }}>
          {card(CARD, cardFill(pal), 30, [
            <div key="in" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: ux(CARD), padding: `${px(20)}px ${px(40)}px ${px(22)}px`, position: "relative" }}>
              {cl.heading ? <div style={{ ...center, fontFamily: fonts.display, fontWeight: 600, fontSize: px(cl.heading.size), lineHeight: 1.2, color: pal.ink, maxWidth: ux(780), marginBottom: px(10) }}>{layout.cta}</div> : null}
              {layout.contacts_label ? (
                <div style={{ display: "flex", alignItems: "center", gap: px(16), marginBottom: px(12) }}>
                  {diamond(px(8), pal.gold)}
                  <div style={{ ...center, fontWeight: 800, fontSize: px(30), letterSpacing: px(1), color: pal.onAccent, backgroundColor: pal.accent, borderRadius: px(30), padding: `${px(6)}px ${px(36)}px`, border: `${unit(2)}px solid ${pal.gold}` }}>{layout.contacts_label}</div>
                  {diamond(px(8), pal.gold)}
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: px(24) }}>
                {layout.contacts.flatMap((c, i) => [
                  i ? <div key={`rule-${i}`} style={{ display: "flex", width: unit(2), height: px(Math.max(70, cl.cols)), backgroundColor: pal.gold, opacity: 0.8 }} /> : null,
                  <div key={`c-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: ux(cl.colW), flexShrink: 0 }}>
                    {c.name ? <div style={{ ...center, fontFamily: fonts.display, fontWeight: 700, fontSize: px(cl.per[i]!.nameSize), lineHeight: 1.18, color: lc.cardAccent, maxWidth: ux(cl.colW - 10) }}>{c.name}</div> : null}
                    {c.detail ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: px(c.name ? 6 : 0) }}>
                        {splitDetail(c.detail).map((part, j) => (
                          <div key={j} style={{ ...center, fontWeight: 700, fontSize: px(cl.per[i]!.detailSize), lineHeight: 1.22, color: pal.ink, maxWidth: ux(cl.colW - 6) }}>{part}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>,
                ])}
              </div>
            </div>,
          ], cl.inner)}
        </div>
      );
    },
    qr: () => (
      <div key="qr" style={{ display: "flex", marginTop: px(16), flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: `${px(12)}px ${px(12)}px ${px(8)}px`, backgroundColor: "#FFFFFF", borderRadius: px(16), border: `${unit(3)}px solid ${pal.gold}` }}>
          {image(qr ?? "", px(QR_BLOCK_IMAGE), px(QR_BLOCK_IMAGE))}
          {txt({ fontWeight: 800, fontSize: px(22), lineHeight: 1.2, letterSpacing: px(5), color: pal.ink, marginTop: px(6), marginLeft: px(5) }, "RSVP")}
          {txt({ fontWeight: 500, fontSize: px(14), lineHeight: 1.2, color: pal.body }, "Scan to reply")}
        </div>
      </div>
    ),
    footer: () => {
      const f = footerLayout(poster.footer, k);
      return (
        <div key="footer" style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: px(22), flexShrink: 0 }}>
          {divider(150, 14, pal.gold)}
          <div style={{ ...center, fontFamily: fonts.display, fontWeight: 600, fontSize: px(f.size), letterSpacing: px(1.2), color: lc.goldOnPaper, marginTop: px(8), maxWidth: ux(COL - 100), lineHeight: 1.25 }}>{poster.footer}</div>
        </div>
      );
    },
    greeting_bottom: () => {
      const g = greetingLayout(layout.greeting.bottom, "bottom", k);
      return (
        <div key="greeting_bottom" style={{ ...center, flexDirection: "column", alignItems: "center", marginTop: px(8), flexShrink: 0 }}>
          {divider(320, 20, pal.gold)}
          {txt({ fontFamily: g.script ? fonts.script : fonts.display, fontWeight: g.script ? 400 : 700, fontSize: px(g.size), lineHeight: 1.25, color: pal.accent, marginTop: px(8), maxWidth: ux(COL - 120) }, layout.greeting.bottom)}
        </div>
      );
    },
  };

  // The arched window (a panel with a pointed arch on top) behind its blocks, from the arch's apex above the first to the foot under the last.
  const winEl = (() => {
    if (!plan.win) return null;
    const pos = blockPositions(plan);
    const first = pos.find((p) => p.key === plan.win!.first)!;
    const last = pos.find((p) => p.key === plan.win!.last)!;
    const top = first.y - WINDOW_RISE * k;
    // The drawing keeps 14 units under the panel for its shadow.
    const hUnits = last.y + last.h - top - WINDOW_EDGE * k + 14;
    const wUnits = plan.win.width;
    return image(svgDataUri(windowSvg({ w: wUnits, h: Math.max(200, hUnits / 1), rise: 300, fill: pal.paper, gold: pal.gold, shadow: pal.ink })), ux(wUnits), Math.max(1, Math.round(hUnits * u * 10) / 10), { position: "absolute", left: (w - ux(wUnits)) / 2, top: Math.round(top * u * 10) / 10 });
  })();
  const sections: ReactNode[] = [];
  plan.blocks.forEach((key, i) => {
    if (i > 0) sections.push(<div key={`g-${key}`} style={{ display: "flex", height: tightBetween(plan.blocks[i - 1]!, key) ? gapPx * 0.3 : gapPx, flexShrink: 0 }} />);
    sections.push(draw[key]());
  });
  const column = (
    <div key="column" style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, flexShrink: 0, paddingTop: ux(plan.top) }}>
      {sections}
    </div>
  );
  const aiUsed = (poster.frame.source === "ai" && input.assets.frame ? 1 : 0) + (poster.scene.source === "ai" && input.assets.scene ? 1 : 0) > 0;

  return (
    <div style={{ width: w, height: h, display: "flex", flexDirection: "column", position: "relative", backgroundColor: pal.paper, fontFamily: fonts.body, color: pal.ink, wordBreak: "break-word" }}>
      {layers}
      {winEl}
      {column}
      {qr && spec.style.qr === "corner" ? qrCardElement({ qr, sceneScale: plan.sceneScale, u, pal, bottom: ux(18), scale: LAYOUT_QR_SCALE }) : null}
      {/* A small honest line when AI made some of the art; nothing when it was all drawn in code. */}
      {aiUsed ? <div style={{ display: "flex", position: "absolute", right: ux(16), bottom: ux(8), fontSize: ux(12), fontWeight: 500, color: pal.body, opacity: 0.8 }}>Art: Google Gemini (AI)</div> : null}
    </div>
  );
}

function fit(img: { w: number; h: number }, maxW: number, maxH: number): { width: number; height: number } {
  const ratio = img.w > 0 && img.h > 0 ? img.w / img.h : 1;
  let height = maxH;
  let width = height * ratio;
  if (width > maxW) {
    width = maxW;
    height = width / ratio;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}
