// Occasion art packs for the Poster template (owner decision 2026-10-02).
// Pure, no server imports: the flyer panel draws the same thumbnails the
// renderer uses.
//
// A pack is a palette, a FRAME layer, a bottom SCENE layer and fade settings.
// Both layers are drawn here in code (SVG: paths, circles, gradients — never a
// <text> element, never a deity), so every pack costs nothing and always
// works. An organizer may swap either layer for a cached AI picture
// (src/lib/events/flyer-art.ts); the palette, the type and the layout stay ours.
//
// Every drawing is in the poster's own units: 1080 wide, `H` tall (1350 Post,
// 1398 Print, 1620 Tall, 1920 Story), and the renderer scales the SVG to the
// output pixels, so the print PDF is as sharp as the screen.

import { contrastRatio, parseHexColor, textOn } from "@/lib/setup";

import type { FlyerOccasion } from "./flyer-art";

// ── Palettes ─────────────────────────────────────────────────────────────────

export type PosterPalette = {
  /** The page. */
  paper: string;
  /** Headline, slogan, labels, agenda text. */
  ink: string;
  /** The paragraph. */
  body: string;
  /** Rules, borders, icon rings (ornament — never small text). */
  gold: string;
  /** Gold for TEXT on the paper (the subhead): #C9A227 on cream is only ~2.2:1. */
  goldText: string;
  /** The ribbon, the big number, agenda times. */
  accent: string;
  /** The ribbon's folded tails. */
  accentDeep: string;
  /** The date on the ribbon. */
  onAccent: string;
  /** The time on the ribbon. */
  ribbonHi: string;
  footerBg: string;
  footerText: string;
};

const FIXED: Record<Exclude<FlyerOccasion, "general">, PosterPalette> = {
  // The reference: the owner's JAINA 2027 Houston Host City Kick-Off poster.
  convention: { paper: "#FBF3E4", ink: "#1B2C5C", body: "#27325A", gold: "#C9A227", goldText: "#9C7A12", accent: "#8C1D2E", accentDeep: "#5E101C", onAccent: "#FBF3E4", ribbonHi: "#DDB740", footerBg: "#1B2C5C", footerText: "#D8B23A" },
  garba: { paper: "#FFF4E6", ink: "#5A1446", body: "#4A2340", gold: "#D9A21B", goldText: "#8A5A00", accent: "#B0174F", accentDeep: "#6E0B30", onAccent: "#FFF4E6", ribbonHi: "#FFD36B", footerBg: "#5A1446", footerText: "#F6C445" },
  diwali: { paper: "#FFF6E5", ink: "#4A1238", body: "#3F2236", gold: "#D4A017", goldText: "#86600A", accent: "#A8330C", accentDeep: "#661D05", onAccent: "#FFF6E5", ribbonHi: "#FFD27A", footerBg: "#3A0D2E", footerText: "#F2C14E" },
  paryushan: { paper: "#F7F6EE", ink: "#1E4D45", body: "#2A3F3B", gold: "#B8963A", goldText: "#6E5A1E", accent: "#2F6B5E", accentDeep: "#173B33", onAccent: "#F7F6EE", ribbonHi: "#F1DC97", footerBg: "#1E4D45", footerText: "#E3CF8A" },
  mahavir: { paper: "#FFF7EA", ink: "#7A2E0B", body: "#4A2A18", gold: "#D99A1E", goldText: "#8A5800", accent: "#B23A0A", accentDeep: "#6B2205", onAccent: "#FFF7EA", ribbonHi: "#FFE0A3", footerBg: "#7A2E0B", footerText: "#F7C873" },
  pathshala: { paper: "#F4FAFB", ink: "#1D3E6E", body: "#2B3A4F", gold: "#F2A93B", goldText: "#8F5300", accent: "#C2412F", accentDeep: "#7A2418", onAccent: "#FFFFFF", ribbonHi: "#FFE08A", footerBg: "#1D3E6E", footerText: "#FFD166" },
  bhakti: { paper: "#FBF5FA", ink: "#3B1F5C", body: "#3A2E4A", gold: "#C9A227", goldText: "#7E630E", accent: "#8E2462", accentDeep: "#55123A", onAccent: "#FBF5FA", ribbonHi: "#F2D27A", footerBg: "#3B1F5C", footerText: "#E6C65C" },
};

const HEX = /^#[0-9a-f]{6}$/i;
const hexOr = (v: string, fallback: string) => (HEX.test(v) ? v.toUpperCase() : fallback);

/** Mix two hex colours: t = 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHexColor(a) ?? [0, 0, 0];
  const y = parseHexColor(b) ?? [0, 0, 0];
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** `preferred` when it reads at `min`:1 on `bg`, else a darker (or lighter) step of it that does, else ink/white. */
function readableOn(preferred: string, bg: string, min: number): string {
  if ((contrastRatio(preferred, bg) ?? 0) >= min) return preferred;
  const toward = textOn(bg) === "#FFFFFF" ? "#FFFFFF" : "#000000";
  for (let t = 0.15; t <= 0.9; t += 0.15) {
    const c = mix(preferred, toward, t);
    if ((contrastRatio(c, bg) ?? 0) >= min) return c;
  }
  return textOn(bg);
}

/** The General pack is the community's own brand kit, with every text colour made readable. */
export function brandPalette(brand: { primary: string; accent: string; background: string }): PosterPalette {
  const paper = hexOr(brand.background, "#FBF7F0");
  const primary = hexOr(brand.primary, "#1B2C5C");
  const gold = hexOr(brand.accent, "#C9731C");
  const ink = readableOn(primary, paper, 7);
  const accent = readableOn(primary, paper, 4.5);
  return {
    paper,
    ink,
    body: readableOn(mix(ink, paper, 0.12), paper, 7),
    gold,
    goldText: readableOn(gold, paper, 4.5),
    accent,
    accentDeep: mix(accent, "#000000", 0.35),
    onAccent: readableOn(paper, accent, 4.5),
    ribbonHi: readableOn(mix(gold, "#FFFFFF", 0.25), accent, 3),
    footerBg: accent,
    footerText: readableOn(mix(gold, "#FFFFFF", 0.2), accent, 4.5),
  };
}

// ── Small SVG helpers ────────────────────────────────────────────────────────

const n = (v: number) => String(Math.round(v * 10) / 10);
function rgba(hex: string, a: number): string {
  const c = parseHexColor(hex) ?? [0, 0, 0];
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** A tiny deterministic random number generator (the same art every render). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const qb = (p0: number[], p1: number[], p2: number[], t: number) => [
  (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0],
  (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1],
];

/**
 * An `opacity="x"` on a single shape becomes `fill-opacity` / `stroke-opacity`. The renderer (resvg) draws a shape with
 * `opacity` through a layer the size of the whole picture: at Print size that is tens of milliseconds PER SHAPE, so the
 * hundreds of lit windows and string-light bulbs of a scene took half a minute. `fill-opacity` costs nothing. (A group's
 * `opacity` is one layer and is left alone.)
 */
export function flattenOpacity(svg: string): string {
  return svg.replace(/<(?:circle|ellipse|path|rect|line|polygon|polyline)\b[^>]*>/g, (tag) => {
    const m = / opacity="([^"]+)"/.exec(tag);
    if (!m) return tag;
    const rest = tag.replace(m[0], "");
    const stroked = / stroke="(?!none)/.test(rest);
    const filled = !/ fill="none"/.test(rest);
    return rest.replace(/(\/?>)$/, `${filled ? ` fill-opacity="${m[1]}"` : ""}${stroked ? ` stroke-opacity="${m[1]}"` : ""}$1`);
  });
}

function svgDoc(W: number, H: number, body: string, defs = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}" height="${n(H)}" viewBox="0 0 ${n(W)} ${n(H)}">${defs ? `<defs>${defs}</defs>` : ""}${flattenOpacity(body)}</svg>`;
}

/** A petal from (0,0) pointing up. */
function petal(len: number, wid: number): string {
  return `M0 0C${n(wid)} ${n(-len * 0.32)} ${n(wid * 0.62)} ${n(-len * 0.86)} 0 ${n(-len)}C${n(-wid * 0.62)} ${n(-len * 0.86)} ${n(-wid)} ${n(-len * 0.32)} 0 0Z`;
}

/** The prototype's mandala: rings, a dot ring, two layers of petals, a centre rosette. */
function mandala(cx: number, cy: number, r: number, gold: string, opacity = 1, fills: string[] = []): string {
  const parts: string[] = [];
  const ring = (rr: number, w: number) => parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rr)}" stroke="${gold}" stroke-width="${w}" fill="none"/>`);
  const petals = (count: number, r1: number, r2: number, width: number, fill: string, offset = 0) => {
    for (let i = 0; i < count; i++) {
      const a = (360 / count) * i + offset;
      const mid = (r1 + r2) / 2;
      parts.push(
        `<path transform="translate(${n(cx)} ${n(cy)}) rotate(${n(a)})" d="M0 ${n(-r1)}Q${n(width)} ${n(-mid)} 0 ${n(-r2)}Q${n(-width)} ${n(-mid)} 0 ${n(-r1)}Z" fill="${fill}" stroke="${gold}" stroke-width="1.2"/>`,
      );
    }
  };
  const dots = (count: number, rr: number, size: number) => {
    for (let i = 0; i < count; i++) {
      const a = ((Math.PI * 2) / count) * i;
      parts.push(`<circle cx="${n(cx + Math.cos(a) * rr)}" cy="${n(cy + Math.sin(a) * rr)}" r="${size}" fill="${gold}"/>`);
    }
  };
  ring(r, 1.6);
  dots(36, r * 0.93, 1.6);
  petals(16, r * 0.5, r * 0.88, r * 0.11, fills[0] ?? rgba(gold, 0.1), 11.25);
  petals(16, r * 0.42, r * 0.74, r * 0.09, fills[1] ?? rgba(gold, 0.18));
  ring(r * 0.42, 1.4);
  petals(8, r * 0.14, r * 0.4, r * 0.1, fills[2] ?? rgba(gold, 0.25), 22.5);
  ring(r * 0.14, 1.2);
  return `<g opacity="${opacity}">${parts.join("")}</g>`;
}

/** A rangoli-style rosette (filled petals), centred on (0,0). */
function rosette(r: number, colors: string[], gold: string): string {
  let out = "";
  const ringOf = (count: number, len: number, wid: number, fill: string, off: number) => {
    for (let i = 0; i < count; i++) out += `<path transform="rotate(${n(off + (360 / count) * i)})" d="${petal(len, wid)}" fill="${fill}"/>`;
  };
  ringOf(16, r, r * 0.2, colors[0], 0);
  ringOf(16, r * 0.74, r * 0.17, colors[1], 11.25);
  ringOf(8, r * 0.45, r * 0.16, colors[2] ?? colors[0], 22.5);
  out += `<circle r="${n(r * 0.16)}" fill="${gold}"/><circle r="${n(r * 0.07)}" fill="${colors[1]}"/>`;
  for (let i = 0; i < 24; i++) {
    const a = (Math.PI * 2 * i) / 24;
    out += `<circle cx="${n(Math.cos(a) * r * 1.1)}" cy="${n(Math.sin(a) * r * 1.1)}" r="${n(r * 0.035)}" fill="${gold}"/>`;
  }
  return out;
}

/** A eucalyptus sprig: a curved stem with round leaves on alternating sides. */
function sprig(p0: number[], p1: number[], p2: number[], o: { leaves: number; size: number; palette: string[]; stem: string }): string {
  const out = [`<path d="M${p0.map(n).join(" ")}Q${p1.map(n).join(" ")} ${p2.map(n).join(" ")}" stroke="${o.stem}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`];
  for (let i = 1; i <= o.leaves; i++) {
    const t = i / (o.leaves + 0.6);
    const [x, y] = qb(p0, p1, p2, t);
    const [x2, y2] = qb(p0, p1, p2, Math.min(1, t + 0.01));
    const ang = Math.atan2(y2 - y, x2 - x);
    const side = i % 2 ? 1 : -1;
    const s = o.size * (1 - t * 0.55);
    const ox = Math.cos(ang + (side * Math.PI) / 2) * s * 0.7;
    const oy = Math.sin(ang + (side * Math.PI) / 2) * s * 0.7;
    const deg = (ang * 180) / Math.PI + side * 20;
    out.push(
      `<ellipse cx="${n(x + ox)}" cy="${n(y + oy)}" rx="${n(s * 0.62)}" ry="${n(s * 0.5)}" transform="rotate(${n(deg)} ${n(x + ox)} ${n(y + oy)})" fill="${o.palette[i % o.palette.length]}" stroke="${o.stem}" stroke-width="0.8" stroke-opacity="0.5"/>`,
      `<path d="M${n(x)} ${n(y)}L${n(x + ox * 0.6)} ${n(y + oy * 0.6)}" stroke="${o.stem}" stroke-width="1.2"/>`,
    );
  }
  return out.join("");
}

/** A five-petal flower (jasmine, marigold) centred on (x, y). */
function flower(x: number, y: number, r: number, fill: string, centre: string, petals = 5, rot = 0): string {
  let out = `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})">`;
  for (let i = 0; i < petals; i++) out += `<ellipse cx="0" cy="${n(-r * 0.55)}" rx="${n(r * 0.36)}" ry="${n(r * 0.55)}" transform="rotate(${n((360 / petals) * i)})" fill="${fill}"/>`;
  return `${out}<circle r="${n(r * 0.28)}" fill="${centre}"/></g>`;
}

/** A lotus flower sitting on (x, y), `s` tall. */
function lotusFlower(x: number, y: number, s: number, outer: string, inner: string, stroke: string): string {
  let out = `<g transform="translate(${n(x)} ${n(y)})">`;
  for (const deg of [-72, -40, 40, 72]) out += `<path transform="rotate(${deg})" d="${petal(s * 0.82, s * 0.24)}" fill="${outer}" stroke="${stroke}" stroke-width="1"/>`;
  for (const deg of [-20, 20]) out += `<path transform="rotate(${deg})" d="${petal(s * 0.95, s * 0.27)}" fill="${inner}" stroke="${stroke}" stroke-width="1"/>`;
  out += `<path d="${petal(s, s * 0.26)}" fill="${inner}" stroke="${stroke}" stroke-width="1"/>`;
  return `${out}</g>`;
}

/** A small clay oil lamp (diya) with its flame and glow, sitting on (x, y). */
function diya(x: number, y: number, s: number, bowl: string, rim: string, flame = "#FFC44D"): string {
  return (
    `<g transform="translate(${n(x)} ${n(y)})">` +
    `<circle cy="${n(-s * 0.95)}" r="${n(s * 1.15)}" fill="${flame}" opacity="0.18"/>` +
    `<circle cy="${n(-s * 0.95)}" r="${n(s * 0.6)}" fill="${flame}" opacity="0.25"/>` +
    `<path d="M${n(-s)} 0Q0 ${n(s * 0.95)} ${n(s)} 0Z" fill="${bowl}"/>` +
    `<ellipse rx="${n(s)}" ry="${n(s * 0.18)}" fill="${rim}"/>` +
    `<path d="M0 ${n(-s * 1.55)}C${n(s * 0.36)} ${n(-s * 0.95)} ${n(s * 0.3)} ${n(-s * 0.2)} 0 ${n(-s * 0.18)}C${n(-s * 0.3)} ${n(-s * 0.2)} ${n(-s * 0.36)} ${n(-s * 0.95)} 0 ${n(-s * 1.55)}Z" fill="${flame}"/>` +
    `<path d="M0 ${n(-s * 1.05)}C${n(s * 0.14)} ${n(-s * 0.75)} ${n(s * 0.12)} ${n(-s * 0.35)} 0 ${n(-s * 0.32)}C${n(-s * 0.12)} ${n(-s * 0.35)} ${n(-s * 0.14)} ${n(-s * 0.75)} 0 ${n(-s * 1.05)}Z" fill="#FFF3C4"/>` +
    `</g>`
  );
}

/** A paper-cut star with five points. */
function star(x: number, y: number, r: number, fill: string, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((Math.PI * 2) / 10) * i - Math.PI / 2 + (rot * Math.PI) / 180;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${n(x + Math.cos(a) * rr)} ${n(y + Math.sin(a) * rr)}`);
  }
  return `<path d="M${pts.join("L")}Z" fill="${fill}"/>`;
}

/** A garland hanging between two points: beads of marigold along a sag, with leaves. */
function garland(x0: number, x1: number, y: number, sag: number, beads: number, colors: string[], leaf: string): string {
  let out = "";
  for (let i = 0; i <= beads; i++) {
    const t = i / beads;
    const x = x0 + (x1 - x0) * t;
    const yy = y + sag * 4 * t * (1 - t);
    out += `<circle cx="${n(x)}" cy="${n(yy)}" r="${n(7.5)}" fill="${colors[i % colors.length]}"/><circle cx="${n(x - 2)}" cy="${n(yy - 2)}" r="2.4" fill="#FFFFFF" opacity="0.35"/>`;
    if (i % 3 === 1) out += `<path d="M${n(x)} ${n(yy + 6)}q6 10 0 22q-6-12 0-22z" fill="${leaf}"/>`;
  }
  return out;
}

/** The thin gold rules every frame shares: an outer line, an inner line, a dotted line. */
function borderLines(W: number, H: number, gold: string, o: { inset?: number; dotted?: boolean; radius?: number } = {}): string {
  const a = o.inset ?? 16;
  const r = o.radius ?? 10;
  return (
    `<rect x="${a}" y="${a}" width="${n(W - 2 * a)}" height="${n(H - 2 * a)}" rx="${r}" fill="none" stroke="${gold}" stroke-width="3"/>` +
    `<rect x="${a + 28}" y="${a + 28}" width="${n(W - 2 * a - 56)}" height="${n(H - 2 * a - 56)}" rx="${Math.max(2, r - 4)}" fill="none" stroke="${gold}" stroke-width="1.2"/>` +
    (o.dotted === false
      ? ""
      : `<rect x="${a + 36}" y="${a + 36}" width="${n(W - 2 * a - 72)}" height="${n(H - 2 * a - 72)}" rx="4" fill="none" stroke="${gold}" stroke-width="1" stroke-dasharray="1.5 7" stroke-linecap="round"/>`)
  );
}

/** Small gold diamonds and dots along the side edges and the top, between the corners. */
function filigree(W: number, H: number, gold: string, o: { sides?: boolean; top?: boolean } = {}): string {
  const out: string[] = [];
  if (o.sides !== false) {
    for (let y = 420; y <= H - 420; y += 46) {
      for (const x of [30, W - 30]) {
        out.push(`<path d="M${x} ${y - 7}l5 7-5 7-5-7z" fill="${gold}" opacity="0.85"/>`, `<circle cx="${x}" cy="${y + 23}" r="1.8" fill="${gold}" opacity="0.8"/>`);
      }
    }
  }
  if (o.top !== false) for (let x = 400; x <= W - 400; x += 46) out.push(`<path d="M${x - 7} 30l7-5 7 5-7 5z" fill="${gold}" opacity="0.85"/>`);
  return out.join("");
}

/** Mirror the top-left corner art into the other three corners. */
function fourCorners(W: number, H: number, corner: string): string {
  return (
    `<g>${corner}</g>` +
    `<g transform="translate(${n(W)} 0) scale(-1 1)">${corner}</g>` +
    `<g transform="translate(0 ${n(H)}) scale(1 -1)">${corner}</g>` +
    `<g transform="translate(${n(W)} ${n(H)}) scale(-1 -1)">${corner}</g>`
  );
}

/** The paper: a soft radial glow towards the middle. */
function paperFill(W: number, H: number, pal: PosterPalette, glow = "#FFFFFF"): { defs: string; body: string } {
  return {
    defs: `<radialGradient id="paper" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${mix(pal.paper, glow, 0.45)}"/><stop offset="0.55" stop-color="${mix(pal.paper, glow, 0.15)}"/><stop offset="1" stop-color="${pal.paper}"/></radialGradient>`,
    body: `<rect width="${n(W)}" height="${n(H)}" fill="url(#paper)"/>`,
  };
}

// ── Frames ───────────────────────────────────────────────────────────────────

type FrameFn = (W: number, H: number, pal: PosterPalette) => string;

/** Gold border, corner mandalas, eucalyptus sprigs (the reference poster). */
const eucalyptusFrame: FrameFn = (W, H, pal) => {
  const g = pal.gold;
  const leaves = ["rgba(135,168,145,0.92)", "rgba(170,196,178,0.92)", "rgba(108,145,122,0.9)", "rgba(190,210,196,0.9)"];
  const stem = "#6F8F78";
  const corner = [
    mandala(40, 40, 92, g, 0.95),
    sprig([14, 30], [140, 6], [330, 52], { leaves: 15, size: 34, palette: leaves, stem }),
    sprig([30, 14], [8, 160], [52, 360], { leaves: 15, size: 34, palette: leaves, stem }),
    sprig([20, 20], [150, 40], [250, 110], { leaves: 10, size: 28, palette: [...leaves].reverse(), stem }),
    sprig([20, 20], [40, 150], [96, 250], { leaves: 10, size: 28, palette: [...leaves].reverse(), stem }),
    ...[[118, 66], [132, 80], [66, 118], [80, 134], [190, 96], [96, 190]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${g}"/>`),
    `<path d="M120 150c30-6 52 12 44 34-6 16-28 14-30 0-1-10 10-14 16-8" stroke="${g}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    `<path d="M150 120c-6 30 12 52 34 44 16-6 14-28 0-30-10-1-14 10-8 16" stroke="${g}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  ].join("");
  const p = paperFill(W, H, pal, "#EEF3F4");
  return svgDoc(W, H, p.body + borderLines(W, H, g) + filigree(W, H, g) + fourCorners(W, H, corner), p.defs);
};

/** Navratri: gold border, colourful corner mandalas, mirror-work dots along the edges, crossed dandiya sticks. */
const garbaFrame: FrameFn = (W, H, pal) => {
  const g = pal.gold;
  const mirror = (x: number, y: number, c: string) => `<circle cx="${n(x)}" cy="${n(y)}" r="6.5" fill="${c}"/><circle cx="${n(x)}" cy="${n(y)}" r="3" fill="#FFFFFF" opacity="0.9"/>`;
  const colors = ["#C2185B", "#F57C00", "#00897B", "#7B1FA2"];
  const dots: string[] = [];
  let k = 0;
  for (let y = 330; y <= H - 330; y += 40) for (const x of [30, W - 30]) dots.push(mirror(x, y, colors[k++ % colors.length]));
  for (let x = 330; x <= W - 330; x += 40) for (const y of [30, H - 30]) dots.push(mirror(x, y, colors[k++ % colors.length]));
  const corner = [
    mandala(46, 46, 108, g, 1, ["rgba(194,24,91,0.55)", "rgba(245,124,0,0.6)", "rgba(0,137,123,0.6)"]),
    // A spray of marigolds and mirror-work leaving the corner along both edges.
    ...[[176, 52, 17, "#F57C00"], [214, 40, 12, "#FBC02D"], [52, 176, 17, "#F57C00"], [40, 214, 12, "#FBC02D"], [150, 150, 15, "#C2185B"]].map(([x, y, r, c]) => flower(x as number, y as number, r as number, c as string, g, 8)),
    mirror(252, 34, "#00897B"),
    mirror(34, 252, "#7B1FA2"),
  ].join("");
  const p = paperFill(W, H, pal);
  return svgDoc(W, H, p.body + borderLines(W, H, g, { dotted: false }) + dots.join("") + fourCorners(W, H, corner), p.defs);
};

/** Diwali: a marigold toran across the top, rangoli rosettes in the corners, small diyas on the sides. */
const diwaliFrame: FrameFn = (W, H, pal) => {
  const g = pal.gold;
  const top: string[] = [];
  const swags = 5;
  for (let i = 0; i < swags; i++) {
    const x0 = 60 + ((W - 120) / swags) * i;
    top.push(garland(x0, x0 + (W - 120) / swags, 54, 30, 12, ["#F9A825", "#EF6C00", "#FFD54F"], "#5E8C3A"));
  }
  const corner = `<g transform="translate(70 ${n(H > 1500 ? 200 : 180)})">${rosette(58, ["rgba(168,51,12,0.85)", "rgba(249,168,37,0.9)", "rgba(142,36,98,0.8)"], g)}</g>`;
  const bottomCorner = `<g transform="translate(70 ${n(H - 70)})">${rosette(52, ["rgba(168,51,12,0.85)", "rgba(249,168,37,0.9)", "rgba(142,36,98,0.8)"], g)}</g>`;
  const sides: string[] = [];
  for (let y = 420; y <= H - 260; y += 150) sides.push(diya(34, y, 14, "#B5561F", g), diya(W - 34, y, 14, "#B5561F", g));
  const p = paperFill(W, H, pal);
  return svgDoc(
    W,
    H,
    p.body +
      borderLines(W, H, g) +
      sides.join("") +
      corner +
      `<g transform="translate(${n(W)} 0) scale(-1 1)">${corner}</g>` +
      bottomCorner +
      `<g transform="translate(${n(W)} 0) scale(-1 1)">${bottomCorner}</g>` +
      top.join(""),
    p.defs,
  );
};

/** Paryushan: serene — thin gold lines, lotus buds in the corners, sage leaf vines along the sides. */
const lotusFrame: FrameFn = (W, H, pal) => {
  const g = pal.gold;
  const leafA = "rgba(120,160,130,0.85)";
  const leafB = "rgba(160,190,165,0.85)";
  const vine = (x: number, y0: number, y1: number, dir: number) => {
    let out = `<path d="M${x} ${y0}C${x + 18 * dir} ${y0 + (y1 - y0) * 0.33} ${x - 18 * dir} ${y0 + (y1 - y0) * 0.66} ${x} ${y1}" stroke="#6E9A7C" stroke-width="1.6" fill="none"/>`;
    for (let y = y0 + 30, i = 0; y < y1 - 20; y += 44, i++) {
      const s = i % 2 ? 1 : -1;
      out += `<ellipse cx="${n(x + 12 * s)}" cy="${n(y)}" rx="12" ry="5.5" transform="rotate(${s * -30} ${n(x + 12 * s)} ${n(y)})" fill="${i % 3 ? leafA : leafB}"/>`;
    }
    return out;
  };
  const corner = [
    lotusFlower(92, 112, 64, rgba("#E8A0B4", 0.75), rgba("#F6CAD5", 0.9), g),
    `<path d="M40 150C70 150 92 134 92 112" stroke="${g}" stroke-width="1.4" fill="none"/>`,
    `<ellipse cx="150" cy="70" rx="34" ry="12" fill="${leafA}" transform="rotate(-18 150 70)"/>`,
    `<ellipse cx="62" cy="186" rx="30" ry="11" fill="${leafB}" transform="rotate(-60 62 186)"/>`,
    ...[[190, 46], [210, 60], [46, 220]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${g}"/>`),
  ].join("");
  const p = paperFill(W, H, pal);
  return svgDoc(W, H, p.body + borderLines(W, H, g, { dotted: false, radius: 18 }) + vine(30, 300, H - 300, 1) + vine(W - 30, 300, H - 300, -1) + fourCorners(W, H, corner), p.defs);
};

/** Mahavir Janma Kalyanak: a mango-leaf toran across the top, saffron lotus rosettes in the corners, gold filigree. */
const toranFrame: FrameFn = (W, H, pal) => {
  const g = pal.gold;
  const leaves: string[] = [`<path d="M40 44Q${n(W / 2)} 78 ${n(W - 40)} 44" stroke="${g}" stroke-width="2.4" fill="none"/>`];
  const count = 21;
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const x = 40 + (W - 80) * t;
    const y = 44 + 34 * 4 * t * (1 - t) * 0.5 + 0;
    const c = i % 2 ? "#4E8A3A" : "#6BA84E";
    leaves.push(`<path d="M${n(x)} ${n(y)}c-9 14-9 34 0 48c9-14 9-34 0-48z" fill="${c}"/>`, `<circle cx="${n(x)}" cy="${n(y)}" r="4" fill="${i % 3 ? "#F59E0B" : g}"/>`);
  }
  const corner = [
    `<g transform="translate(86 ${H > 1500 ? 168 : 150})">${rosette(52, ["rgba(194,65,12,0.82)", "rgba(245,158,11,0.88)", "rgba(217,154,30,0.9)"], g)}</g>`,
    `<path d="M30 220c40 0 70 30 70 70" stroke="${g}" stroke-width="1.6" fill="none"/>`,
  ].join("");
  const bottom = `<g transform="translate(86 ${n(H - 86)})">${rosette(48, ["rgba(194,65,12,0.82)", "rgba(245,158,11,0.88)", "rgba(217,154,30,0.9)"], g)}</g>`;
  const p = paperFill(W, H, pal);
  return svgDoc(
    W,
    H,
    p.body + borderLines(W, H, g) + filigree(W, H, g, { top: false }) + corner + `<g transform="translate(${n(W)} 0) scale(-1 1)">${corner}</g>` + bottom + `<g transform="translate(${n(W)} 0) scale(-1 1)">${bottom}</g>` + leaves.join(""),
    p.defs,
  );
};

/** Pathshala: playful — a rounded dashed border, stars and coloured dots in the corners. */
const playfulFrame: FrameFn = (W, H, pal) => {
  const colors = ["#F2A93B", "#C2412F", "#3BA3D0", "#4CAF7A", "#8E6AC8"];
  const dots: string[] = [];
  let k = 0;
  for (let x = 120; x <= W - 120; x += 46) for (const y of [30, H - 30]) dots.push(`<circle cx="${x}" cy="${y}" r="7" fill="${colors[k++ % colors.length]}"/>`);
  for (let y = 120; y <= H - 120; y += 46) for (const x of [30, W - 30]) dots.push(`<circle cx="${x}" cy="${y}" r="7" fill="${colors[k++ % colors.length]}"/>`);
  const corner = [star(92, 92, 46, "#F2A93B", -8), star(170, 58, 18, "#3BA3D0", 12), star(58, 172, 16, "#C2412F", -4), `<circle cx="150" cy="140" r="9" fill="#4CAF7A"/>`].join("");
  const p = paperFill(W, H, pal);
  return svgDoc(
    W,
    H,
    p.body +
      `<rect x="56" y="56" width="${n(W - 112)}" height="${n(H - 112)}" rx="36" fill="none" stroke="${pal.ink}" stroke-opacity="0.35" stroke-width="3" stroke-dasharray="14 12" stroke-linecap="round"/>` +
      dots.join("") +
      fourCorners(W, H, corner),
    p.defs,
  );
};

/** A paisley (boteh): a round body that narrows to a tip curling to one side, with an inner outline and a row of dots. Tip up, base at (0, 0). */
function boteh(x: number, y: number, s: number, rot: number, fill: string, inner: string, gold: string): string {
  const outline = "M0 0C-34 0 -42-34 -24-64C-12-84 6-98 20-128C24-136 36-134 34-124C28-96 44-70 38-38C34-14 22 0 0 0Z";
  const core = "M2-8C-24-8 -30-34 -17-56C-8-72 4-82 14-100C16-76 30-62 26-36C24-20 14-8 2-8Z";
  const dots: string[] = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    dots.push(`<circle cx="${n(-6 + Math.sin(t * Math.PI) * -22 + t * 36)}" cy="${n(-8 - t * 112)}" r="${n(2.2 - t * 0.8)}" fill="${gold}"/>`);
  }
  return (
    `<g transform="translate(${n(x)} ${n(y)}) rotate(${rot}) scale(${s})">` +
    `<path d="${outline}" fill="${fill}" stroke="${gold}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path d="${core}" fill="${inner}" stroke="${gold}" stroke-width="1.4"/>` +
    `<circle cx="-6" cy="-28" r="7" fill="${gold}"/><circle cx="-6" cy="-28" r="3" fill="#FFFFFF" opacity="0.85"/>` +
    `<path d="M-10-46C-14-58-4-66 2-74" stroke="${gold}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
    dots.join("") +
    `</g>`
  );
}

/** Bhakti: gold border, mandala and paisley corners, jasmine vines along the sides. */
const paisleyFrame: FrameFn = (W, H, pal) => {
  const g = pal.gold;
  const jasmine: string[] = [];
  for (let y = 360; y <= H - 360; y += 64) for (const x of [32, W - 32]) jasmine.push(flower(x, y, 11, "#FFFFFF", g, 5, y % 3), `<circle cx="${x}" cy="${y + 32}" r="2" fill="${g}"/>`);
  const corner = [
    mandala(40, 40, 70, g, 0.95, [rgba(pal.accent, 0.25), rgba(pal.ink, 0.15), rgba(g, 0.4)]),
    // Two paisleys leaving the corner, one along each edge, tips curling away from it.
    boteh(168, 84, 0.74, 78, rgba(pal.accent, 0.72), rgba(pal.paper, 0.92), g),
    boteh(84, 168, 0.74, 192, rgba(pal.ink, 0.62), rgba(pal.paper, 0.92), g),
    ...[[262, 50], [282, 62], [50, 262], [62, 282]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${g}"/>`),
  ].join("");
  const p = paperFill(W, H, pal);
  return svgDoc(W, H, p.body + borderLines(W, H, g) + jasmine.join("") + fourCorners(W, H, corner), p.defs);
};

/** General: a refined double border with small mandala corners in the brand colours. */
const simpleFrame: FrameFn = (W, H, pal) => {
  const g = pal.gold;
  const corner = mandala(44, 44, 84, g, 0.9, [rgba(g, 0.12), rgba(pal.ink, 0.1), rgba(g, 0.3)]);
  const p = paperFill(W, H, pal);
  return svgDoc(W, H, p.body + borderLines(W, H, g) + filigree(W, H, g) + fourCorners(W, H, corner), p.defs);
};

/** No frame: just the paper. */
export function plainPaperSvg(W: number, H: number, pal: PosterPalette): string {
  const p = paperFill(W, H, pal);
  return svgDoc(W, H, p.body, p.defs);
}

/** A thin gold double border drawn OVER an AI frame (the AI picture never has to get the edge exactly right). */
export function frameEdgeSvg(W: number, H: number, gold: string): string {
  return svgDoc(
    W,
    H,
    `<rect x="14" y="14" width="${n(W - 28)}" height="${n(H - 28)}" rx="10" fill="none" stroke="${gold}" stroke-width="3"/><rect x="24" y="24" width="${n(W - 48)}" height="${n(H - 48)}" rx="6" fill="none" stroke="${gold}" stroke-width="1.2"/>`,
  );
}

// ── Scenes ───────────────────────────────────────────────────────────────────
// Each scene is drawn `h` tall (units) and sits with its bottom at the poster's
// bottom edge, under the footer band (FOOTER units), with its sky fading to
// transparent at the top so the words above stay on calm ground.

type SceneFn = (W: number, h: number, pal: PosterPalette) => string;

function skyGradient(id: string, stops: [number, string, number][]): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
}

/** One Garba dancer in a flared ghagra with dandiya sticks (a silhouette: no face). */
function dancer(x: number, base: number, s: number, skirt: string, choli: string, facing: number, hem: string, body = "#2A1B3D"): string {
  const X = (dx: number) => n(x + dx * s * facing);
  const Y = (dy: number) => n(base - dy * s);
  const waist = 62;
  const sh = 92;
  const parts: string[] = [];
  parts.push(`<path d="M${X(-8)} ${Y(waist)}Q${X(-26)} ${Y(34)} ${X(-40)} ${Y(8)}Q${X(0)} ${Y(-2)} ${X(40)} ${Y(8)}Q${X(26)} ${Y(34)} ${X(8)} ${Y(waist)}Z" fill="${skirt}"/>`);
  parts.push(`<path d="M${X(-40)} ${Y(8)}Q${X(0)} ${Y(-2)} ${X(40)} ${Y(8)}" stroke="${hem}" stroke-width="${n(4 * s)}" fill="none"/>`);
  parts.push(`<path d="M${X(-30)} ${Y(26)}Q${X(0)} ${Y(18)} ${X(30)} ${Y(26)}" stroke="${hem}" stroke-width="${n(1.6 * s)}" fill="none" opacity="0.8"/>`);
  parts.push(`<path d="M${X(-10)} ${Y(4)}l${n(-6 * s * facing)} ${n(4 * s)}M${X(10)} ${Y(4)}l${n(6 * s * facing)} ${n(4 * s)}" stroke="${body}" stroke-width="${n(4 * s)}" stroke-linecap="round"/>`);
  parts.push(`<path d="M${X(-8)} ${Y(waist)}L${X(-11)} ${Y(sh)}Q${X(0)} ${Y(sh + 5)} ${X(11)} ${Y(sh)}L${X(8)} ${Y(waist)}Z" fill="${choli}"/>`);
  parts.push(`<path d="M${X(-11)} ${Y(sh - 2)}Q${X(4)} ${Y(74)} ${X(10)} ${Y(waist + 2)}Q${X(24)} ${Y(50)} ${X(30)} ${Y(30)}" stroke="${hem}" stroke-width="${n(3 * s)}" fill="none" opacity="0.9"/>`);
  const arm = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    parts.push(`<path d="M${X(x1)} ${Y(y1)}L${X(x2)} ${Y(y2)}L${X(x3)} ${Y(y3)}" stroke="${body}" stroke-width="${n(5 * s)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  arm(9, sh - 2, 22, sh + 14, 28, sh + 30);
  arm(-9, sh - 2, -22, sh - 12, -34, sh - 2);
  const stick = (x1: number, y1: number, x2: number, y2: number) => parts.push(`<path d="M${X(x1)} ${Y(y1)}L${X(x2)} ${Y(y2)}" stroke="#E0B23A" stroke-width="${n(3.4 * s)}" stroke-linecap="round"/>`);
  stick(22, sh + 22, 40, sh + 46);
  stick(-32, sh - 10, -46, sh + 12);
  parts.push(`<path d="M${X(0)} ${Y(sh)}L${X(1)} ${Y(sh + 6)}" stroke="${body}" stroke-width="${n(5 * s)}"/>`);
  parts.push(`<circle cx="${X(2)}" cy="${Y(sh + 15)}" r="${n(10 * s)}" fill="${body}"/>`);
  parts.push(`<circle cx="${X(-8)}" cy="${Y(sh + 18)}" r="${n(5 * s)}" fill="${body}"/>`);
  return parts.join("");
}

const SKIRTS: [string, string, string][] = [
  ["#D81B60", "#7B1FA2", "#FFC94A"],
  ["#F57C00", "#C62828", "#FFE08A"],
  ["#00897B", "#1B5E20", "#FFD54F"],
  ["#FBC02D", "#D84315", "#8C1D2E"],
  ["#8E24AA", "#D81B60", "#FFD54F"],
  ["#1E88E5", "#283593", "#FFC94A"],
  ["#E53935", "#F9A825", "#FFF3B0"],
  ["#43A047", "#F57C00", "#FFD54F"],
];

function building(x: number, w: number, top: number, base: number, fill: string, kind: string): string {
  switch (kind) {
    case "bevel":
      return `<path d="M${x} ${base}V${top + 10}l10 -10H${x + w}V${base}Z" fill="${fill}"/>`;
    case "round":
      return `<path d="M${x} ${base}V${top + 24}Q${x} ${top} ${x + w / 2} ${top}Q${x + w} ${top} ${x + w} ${top + 24}V${base}Z" fill="${fill}"/>`;
    case "gables": {
      const s = w / 3;
      return `<path d="M${x} ${base}V${top + 70}l${s / 2} -18l${s / 2} 18V${top + 40}l${s / 2} -20l${s / 2} 20V${top + 18}l${s / 2} -18l${s / 2} 18V${top + 40}l${s / 2} -20l${s / 2} 20V${top + 70}V${base}Z" fill="${fill}"/>`;
    }
    case "spire":
      return `<path d="M${x} ${base}V${top + 30}L${x + w / 2} ${top}L${x + w} ${top + 30}V${base}Z" fill="${fill}"/><circle cx="${x + w / 2}" cy="${top - 8}" r="4" fill="#FFE6A3"/>`;
    case "stepped":
      return `<path d="M${x} ${base}V${top + 30}h6v-10h6v-10h${w - 24}v10h6v10h6V${base}Z" fill="${fill}"/>`;
    case "twin":
      return `<path d="M${x} ${base}V${top + 22}L${x + w * 0.46} ${top}V${base}Z M${x + w * 0.54} ${base}V${top}L${x + w} ${top + 22}V${base}Z" fill="${fill}"/>`;
    default:
      return `<rect x="${x}" y="${top}" width="${w}" height="${base - top}" fill="${fill}"/>`;
  }
}

function stringLights(W: number, y0: number, sag: number, phase: number, out: string[]): void {
  const colours = ["#FFD36B", "#FF8FB1", "#7FE0D2", "#FFB25B", "#C9A0FF"];
  const pts: number[][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push([t * W, y0 + sag * 4 * t * (1 - t)]);
  }
  out.push(`<path d="M${pts.map((p) => p.map(n).join(" ")).join("L")}" stroke="#5B4A6E" stroke-width="1.4" fill="none" opacity="0.7"/>`);
  for (let i = 1; i < 40; i += 2) {
    const [bx, by] = pts[i];
    const c = colours[(i + phase) % colours.length];
    out.push(`<circle cx="${n(bx)}" cy="${n(by + 5)}" r="9" fill="${c}" opacity="0.25"/><circle cx="${n(bx)}" cy="${n(by + 5)}" r="3.6" fill="${c}"/>`);
  }
}

/** Convention / kick-off: a city skyline at dusk, string lights and Garba dancers (the reference poster). */
const skylineScene: SceneFn = (W, h, pal) => {
  const r = rng(7);
  const base = h - 78;
  const skyTop = h - 274;
  const back: string[] = [];
  const front: string[] = [];
  const windows: string[] = [];
  for (let x = -10; x < W; ) {
    const w = 34 + Math.floor(r() * 50);
    const top = base - 110 + Math.floor(r() * 50);
    back.push(building(x, w, top, base, "rgba(118,86,150,0.55)", "rect"));
    x += w + 4;
  }
  const marks: [number, number, number, string][] = [
    [150, 54, 270, "rect"], [210, 64, 225, "twin"], [282, 50, 260, "rect"], [340, 84, 168, "gables"], [432, 50, 230, "rect"], [488, 74, 120, "bevel"],
    [568, 64, 150, "round"], [640, 60, 200, "stepped"], [706, 46, 250, "rect"], [760, 52, 205, "rect"], [830, 48, 140, "spire"], [886, 56, 270, "rect"],
    [60, 60, 290, "rect"], [950, 70, 290, "rect"],
  ];
  const sx = W / 1080;
  for (const [x0, w, top0, kind] of marks) {
    const x = Math.round(x0 * sx);
    const top = Math.round(skyTop + (top0 - 120) * 0.62);
    front.push(building(x, w, top, base, "#3B2A5E", kind));
    for (let wy = top + 34; wy < base - 12; wy += 14) {
      for (let wx = x + 8; wx < x + w - 8; wx += 11) if (r() < 0.32) windows.push(`<rect x="${wx}" y="${wy}" width="4" height="6" fill="#FFD98A" opacity="${n(0.45 + r() * 0.5)}"/>`);
    }
  }
  const lights: string[] = [];
  stringLights(W, skyTop + 10, 26, 0, lights);
  stringLights(W, skyTop + 36, 18, 2, lights);
  const xs = [262, 360, 474, 572, 690, 788, 904, 1002];
  const ds = xs.map((x, i) => dancer(x * sx, base + 2, 1.05, SKIRTS[i][0], SKIRTS[i][1], i % 2 ? -1 : 1, SKIRTS[i][2]));
  const sky = skyGradient("sky", [[0, pal.paper, 0], [0.26, "#EBDDEB", 0.7], [0.44, "#B796CF", 1], [0.6, "#E592B4", 1], [0.74, "#F5B66C", 1], [0.84, "#F9D48C", 1]]);
  const sun = `<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFF1C2" stop-opacity="0.95"/><stop offset="0.45" stop-color="#FFD27A" stop-opacity="0.6"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient>`;
  return svgDoc(
    W,
    h,
    `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/><circle cx="${n(560 * sx)}" cy="${n(base - 62)}" r="150" fill="url(#sun)"/>${back.join("")}${front.join("")}${windows.join("")}${lights.join("")}` +
      `<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="#2A1E45"/><path d="M0 ${n(base)}H${n(W)}" stroke="${pal.gold}" stroke-width="2" opacity="0.6"/>${ds.join("")}`,
    sky + sun,
  );
};

/** Garba / Navratri: dancers under bunting and lanterns on a festive night. */
const garbaScene: SceneFn = (W, h, pal) => {
  const base = h - 78;
  const out: string[] = [];
  // Bunting: triangles on two sagging strings.
  const flags = ["#D81B60", "#F57C00", "#FBC02D", "#00897B", "#7B1FA2", "#1E88E5"];
  for (const [y0, sag, off] of [[h - 300, 30, 0], [h - 262, 22, 3]] as const) {
    const pts: number[][] = [];
    for (let i = 0; i <= 28; i++) pts.push([(W / 28) * i, y0 + sag * 4 * (i / 28) * (1 - i / 28)]);
    out.push(`<path d="M${pts.map((p) => p.map(n).join(" ")).join("L")}" stroke="#6D4C41" stroke-width="1.4" fill="none" opacity="0.7"/>`);
    for (let i = 0; i < 28; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      out.push(`<path d="M${n(x1 + 2)} ${n(y1)}L${n(x2 - 2)} ${n(y2)}L${n((x1 + x2) / 2)} ${n((y1 + y2) / 2 + 24)}Z" fill="${flags[(i + off) % flags.length]}" opacity="0.92"/>`);
    }
  }
  // Lanterns hanging between the strings.
  const sx = W / 1080;
  for (const [x0, len] of [[120, 40], [330, 60], [540, 34], [750, 58], [960, 42]] as const) {
    const x = Math.round(x0 * sx);
    const y = h - 290 + len;
    out.push(
      `<path d="M${x} ${h - 300}V${y}" stroke="#6D4C41" stroke-width="1.2"/>`,
      `<circle cx="${x}" cy="${y + 22}" r="34" fill="#FFC94A" opacity="0.18"/>`,
      `<rect x="${x - 15}" y="${y}" width="30" height="44" rx="12" fill="#E65100"/><path d="M${x - 15} ${y + 14}h30M${x - 15} ${y + 30}h30" stroke="#FFD54F" stroke-width="2"/>`,
      `<path d="M${x - 9} ${y}h18l-4-6h-10z M${x - 9} ${y + 44}h18l-4 6h-10z" fill="${pal.gold}"/>`,
    );
  }
  // Ground: a stage edge with a rangoli border.
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="#3E0F33"/>`);
  for (let x = 20; x < W; x += 40) out.push(`<path d="M${x} ${n(base + 10)}l10 10-10 10-10-10z" fill="${flags[(x / 40) % flags.length | 0]}" opacity="0.85"/>`);
  out.push(`<path d="M0 ${n(base)}H${n(W)}" stroke="${pal.gold}" stroke-width="3"/>`);
  const xs = [250, 340, 450, 540, 650, 740, 850, 940, 1030];
  xs.forEach((x, i) => out.push(dancer(x * sx, base + 2, 1.08, SKIRTS[i % 8][0], SKIRTS[i % 8][1], i % 2 ? -1 : 1, SKIRTS[i % 8][2])));
  const sky = skyGradient("sky", [[0, pal.paper, 0], [0.3, "#F8D7E3", 0.75], [0.55, "#E58BB0", 1], [0.8, "#9C3D78", 1], [1, "#5A1446", 1]]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky);
};

/** Diwali: rows of glowing diyas on a rangoli floor, gentle fireworks in a plum twilight. */
const diwaliScene: SceneFn = (W, h, pal) => {
  const base = h - 78;
  const out: string[] = [];
  const burst = (cx: number, cy: number, r: number, c: string) => {
    let s = "";
    for (let i = 0; i < 18; i++) {
      const a = (Math.PI * 2 * i) / 18;
      s += `<path d="M${n(cx + Math.cos(a) * r * 0.3)} ${n(cy + Math.sin(a) * r * 0.3)}L${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`;
      s += `<circle cx="${n(cx + Math.cos(a) * r * 1.12)}" cy="${n(cy + Math.sin(a) * r * 1.12)}" r="2.6" fill="${c}"/>`;
    }
    return s;
  };
  const sx = W / 1080;
  const mid = W / 2;
  out.push(burst(170 * sx, h - 250, 58, "#FFD54F"), burst(880 * sx, h - 270, 66, "#FF8FB1"), burst(560 * sx, h - 300, 40, "#7FE0D2"), burst(360 * sx, h - 230, 30, "#FFB25B"));
  // The floor and a big rangoli in the middle.
  out.push(`<rect x="0" y="${n(base - 30)}" width="${n(W)}" height="${n(h - base + 30)}" fill="#3A0D2E"/>`);
  out.push(`<g transform="translate(${n(mid)} ${n(base + 18)}) scale(1 0.42)">${rosette(150, ["#C2185B", "#F9A825", "#7B1FA2"], pal.gold)}</g>`);
  // Two rows of diyas.
  for (let x = 40; x < W; x += 74) out.push(diya(x, base - 40, 20, "#B5561F", pal.gold));
  for (let x = 77; x < W; x += 74) if (Math.abs(x - mid) > 200) out.push(diya(x, base + 6, 16, "#8D3B12", pal.gold));
  const sky = skyGradient("sky", [[0, pal.paper, 0], [0.28, "#F6D9C4", 0.75], [0.52, "#C7739B", 1], [0.78, "#6B2559", 1], [1, "#3A0D2E", 1]]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky);
};

/** Paryushan: a calm lotus pond at dawn. */
const lotusScene: SceneFn = (W, h, pal) => {
  const base = h - 78;
  const water = base - 120;
  const sx = W / 1080;
  const out: string[] = [];
  out.push(`<path d="M0 ${n(water - 10)}Q${n(200 * sx)} ${n(water - 70)} ${n(420 * sx)} ${n(water - 20)}T${n(820 * sx)} ${n(water - 40)}T${n(W)} ${n(water - 10)}V${n(water + 10)}H0Z" fill="#A9C7B4" opacity="0.7"/>`);
  out.push(`<rect x="0" y="${n(water)}" width="${n(W)}" height="${n(h - water)}" fill="url(#water)"/>`);
  for (let i = 0; i < 6; i++) {
    const y = water + 18 + i * 22;
    out.push(`<path d="M${n((60 + i * 30) * sx)} ${n(y)}h${n(220 - i * 10)}M${n((560 - i * 20) * sx)} ${n(y + 6)}h${n(260 - i * 12)}" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2" stroke-linecap="round"/>`);
  }
  const pads: [number, number, number][] = [[110, base - 34, 46], [300, base - 10, 54], [470, base - 48, 38], [640, base - 14, 58], [820, base - 40, 46], [990, base - 12, 50], [210, base - 70, 30], [740, base - 76, 32]];
  for (const [x0, y, r] of pads) {
    const x = n(x0 * sx);
    out.push(`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${n(r * 0.32)}" fill="#4E8A6A"/><path d="M${x} ${y}l${n(r * 0.9)} ${n(-r * 0.12)}" stroke="#3B6E53" stroke-width="2"/>`);
  }
  for (const [x, y, s] of [[300, base - 22, 64], [640, base - 26, 76], [990, base - 24, 58], [110, base - 44, 46], [820, base - 50, 50]] as const) {
    out.push(lotusFlower(x * sx, y, s, "#F3A6BC", "#FBD3DE", "#D97A98"));
  }
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="${pal.accentDeep}"/>`);
  const sky = skyGradient("sky", [[0, pal.paper, 0], [0.3, "#F4EDE0", 0.8], [0.55, "#F6DDC8", 1], [0.7, "#EFC9B0", 1]]);
  const waterG = skyGradient("water", [[0, "#9FC3C0", 1], [1, "#5E9C94", 1]]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/><circle cx="${n(W / 2)}" cy="${n(water - 40)}" r="110" fill="#FFE7B8" opacity="0.7"/>${out.join("")}`, sky + waterG);
};

/** Mahavir Janma Kalyanak: white temple spires with saffron flags at sunrise, lotuses in front. Architecture only. */
const templeScene: SceneFn = (W, h, pal) => {
  const base = h - 78;
  const sx = W / 1080;
  const mid = W / 2;
  const out: string[] = [];
  // Sun rays.
  for (let i = 0; i < 18; i++) {
    const a = Math.PI + (Math.PI * i) / 17;
    out.push(`<path d="M${n(mid)} ${n(base - 90)}L${n(mid + Math.cos(a) * 700)} ${n(base - 90 + Math.sin(a) * 700)}" stroke="#FFD58A" stroke-width="18" opacity="0.18"/>`);
  }
  out.push(`<circle cx="${n(mid)}" cy="${n(base - 90)}" r="120" fill="#FFD58A" opacity="0.55"/>`);
  // A shikhara: a curved tower of stacked bands with a finial and a flag.
  const shikhar = (cx: number, w: number, hh: number, fill: string) => {
    const top = base - 40 - hh;
    let s = `<path d="M${n(cx - w / 2)} ${n(base - 40)}C${n(cx - w / 2)} ${n(top + hh * 0.4)} ${n(cx - w * 0.18)} ${n(top + 18)} ${n(cx)} ${n(top)}C${n(cx + w * 0.18)} ${n(top + 18)} ${n(cx + w / 2)} ${n(top + hh * 0.4)} ${n(cx + w / 2)} ${n(base - 40)}Z" fill="${fill}" stroke="#D9C9B0" stroke-width="1.5"/>`;
    for (let k = 1; k < 6; k++) {
      const y = base - 40 - (hh * k) / 6;
      const ww = (w / 2) * (1 - (k / 6) ** 1.6);
      s += `<path d="M${n(cx - ww)} ${n(y)}H${n(cx + ww)}" stroke="#D9C9B0" stroke-width="1.5"/>`;
    }
    s += `<circle cx="${n(cx)}" cy="${n(top - 8)}" r="7" fill="${pal.gold}"/><path d="M${n(cx)} ${n(top - 14)}V${n(top - 70)}" stroke="#7A5A3A" stroke-width="2.5"/>`;
    s += `<path d="M${n(cx)} ${n(top - 70)}l46 10-46 14z" fill="#E8590C"/>`;
    return s;
  };
  out.push(
    // The left corner is kept for the RSVP code, so the spires sit in the middle and to the right.
    shikhar(mid - 250 * sx, 130, 170, "#FBF7F0"),
    shikhar(mid + 250 * sx, 130, 170, "#FBF7F0"),
    shikhar(mid, 190, 250, "#FFFFFF"),
    shikhar(mid + 400 * sx, 90, 110, "#F6EFE4"),
  );
  // The temple's base and steps.
  out.push(`<rect x="90" y="${n(base - 42)}" width="${n(W - 180)}" height="30" fill="#F1E6D6" stroke="#D9C9B0"/><rect x="60" y="${n(base - 14)}" width="${n(W - 120)}" height="16" fill="#E6D7C2"/>`);
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="${pal.accentDeep}"/>`);
  for (let x = 70; x < W; x += 118) out.push(lotusFlower(x, base + 2, 40, "#F7A072", "#FFD8A8", "#D9772B"));
  const sky = skyGradient("sky", [[0, pal.paper, 0], [0.3, "#FFF0D6", 0.8], [0.6, "#FFD9A0", 1], [0.85, "#F7B267", 1]]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky);
};

/** Pathshala / kids: rolling hills, a stack of books, pencils, kites and a sun. */
const learningScene: SceneFn = (W, h, pal) => {
  const base = h - 78;
  const sx = W / 1080;
  const out: string[] = [];
  const sunX = 900 * sx;
  out.push(`<circle cx="${n(sunX)}" cy="${n(base - 210)}" r="52" fill="#FFD166"/>`);
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    out.push(`<path d="M${n(sunX + Math.cos(a) * 66)} ${n(base - 210 + Math.sin(a) * 66)}L${n(sunX + Math.cos(a) * 86)} ${n(base - 210 + Math.sin(a) * 86)}" stroke="#FFD166" stroke-width="6" stroke-linecap="round"/>`);
  }
  const kite = (x: number, y: number, s: number, a: string, b: string) =>
    `<path d="M${x} ${y - s}L${x + s * 0.7} ${y}L${x} ${y + s}L${x - s * 0.7} ${y}Z" fill="${a}"/><path d="M${x} ${y - s}V${y + s}M${x - s * 0.7} ${y}H${x + s * 0.7}" stroke="${b}" stroke-width="2"/>` +
    `<path d="M${x} ${y + s}q-20 30 6 54t-4 60" stroke="${b}" stroke-width="1.6" fill="none"/>`;
  out.push(kite(Math.round(170 * sx), base - 250, 34, "#C2412F", "#7A2418"), kite(Math.round(330 * sx), base - 300, 26, "#3BA3D0", "#1D3E6E"), kite(Math.round(700 * sx), base - 280, 30, "#8E6AC8", "#4A2C8A"));
  out.push(`<path d="M0 ${n(base - 60)}Q${n(240 * sx)} ${n(base - 150)} ${n(520 * sx)} ${n(base - 70)}T${n(W)} ${n(base - 90)}V${n(h)}H0Z" fill="#8BC9A0"/>`);
  out.push(`<path d="M0 ${n(base - 20)}Q${n(300 * sx)} ${n(base - 100)} ${n(640 * sx)} ${n(base - 30)}T${n(W)} ${n(base - 40)}V${n(h)}H0Z" fill="#5FAE7E"/>`);
  // Books, centred on the scene.
  const bx = W / 2 - 540;
  const book = (x: number, y: number, w: number, c: string) => `<rect x="${n(x + bx)}" y="${y}" width="${w}" height="26" rx="4" fill="${c}"/><path d="M${n(x + bx + 8)} ${y + 7}h${w - 16}" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="2"/>`;
  out.push(book(420, base - 30, 220, "#C2412F"), book(440, base - 56, 190, "#3BA3D0"), book(410, base - 82, 230, "#F2A93B"), book(450, base - 108, 170, "#8E6AC8"));
  // An open book on top.
  out.push(`<path d="M${n(470 + bx)} ${n(base - 112)}Q${n(530 + bx)} ${n(base - 140)} ${n(530 + bx)} ${n(base - 112)}Q${n(530 + bx)} ${n(base - 140)} ${n(590 + bx)} ${n(base - 112)}V${n(base - 106)}H${n(470 + bx)}Z" fill="#FFFFFF" stroke="#D0D7DE"/>`);
  // Pencils.
  const pencil = (x0: number, c: string) => {
    const x = n(x0 * sx);
    return `<rect x="${x}" y="${n(base - 120)}" width="18" height="96" fill="${c}"/><path d="M${x} ${n(base - 120)}l9 -20 9 20z" fill="#F6D7A7"/><path d="M${n(x0 * sx + 6)} ${n(base - 134)}l3 -6 3 6z" fill="#333"/>`;
  };
  out.push(pencil(700, "#F2A93B"), pencil(724, "#4CAF7A"), pencil(748, "#C2412F"));
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="${pal.ink}"/>`);
  const sky = skyGradient("sky", [[0, pal.paper, 0], [0.3, "#DDF0F7", 0.8], [0.7, "#BFE3F2", 1]]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky);
};

/** Bhakti / music: tabla, harmonium and cymbals beside diyas, with ribbons of light like sound. */
const musicScene: SceneFn = (W, h, pal) => {
  const base = h - 78;
  const sx = W / 1080;
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const y = base - 230 + i * 26;
    out.push(`<path d="M0 ${n(y)}C${n(200 * sx)} ${n(y - 50)} ${n(340 * sx)} ${n(y + 50)} ${n(540 * sx)} ${n(y)}S${n(880 * sx)} ${n(y - 50)} ${n(W)} ${n(y)}" stroke="${i % 2 ? "#E6C65C" : "#C9A0FF"}" stroke-width="${3 - i * 0.4}" fill="none" opacity="${0.7 - i * 0.12}"/>`);
  }
  const note = (x0: number, y: number, c: string) => {
    const x = n(x0 * sx);
    return `<ellipse cx="${x}" cy="${y}" rx="11" ry="8" transform="rotate(-20 ${x} ${y})" fill="${c}"/><path d="M${n(x0 * sx + 10)} ${y - 2}V${y - 46}l16 8" stroke="${c}" stroke-width="3" fill="none"/>`;
  };
  out.push(note(140, base - 190, pal.gold), note(380, base - 250, "#C9A0FF"), note(720, base - 220, pal.gold), note(960, base - 260, "#E6A0C8"));
  out.push(`<rect x="0" y="${n(base - 24)}" width="${n(W)}" height="${n(h - base + 24)}" fill="${pal.footerBg}"/>`);
  // The instruments, drawn for a 1080-wide strip and centred on this one.
  out.push(`<g transform="translate(${n(W / 2 - 540)} 0)">`);
  // Tabla pair.
  out.push(
    `<path d="M200 ${n(base - 24)}c-12-50-4-96 8-110h84c12 14 20 60 8 110z" fill="#8B5A2B"/><ellipse cx="250" cy="${n(base - 134)}" rx="42" ry="10" fill="#E9D8B8"/><ellipse cx="250" cy="${n(base - 134)}" rx="16" ry="4" fill="#2B2B2B"/>`,
    `<path d="M310 ${n(base - 24)}c-20-30-16-70 10-84h70c26 14 30 54 10 84z" fill="#A8A8B0"/><ellipse cx="355" cy="${n(base - 108)}" rx="44" ry="10" fill="#E9D8B8"/><ellipse cx="355" cy="${n(base - 108)}" rx="17" ry="4" fill="#2B2B2B"/>`,
  );
  // Harmonium.
  out.push(
    `<rect x="560" y="${n(base - 110)}" width="250" height="86" rx="6" fill="#7A3E1D"/><rect x="560" y="${n(base - 130)}" width="250" height="26" fill="#9C5A2E"/>`,
    ...Array.from({ length: 14 }, (_, i) => `<rect x="${572 + i * 16.5}" y="${n(base - 127)}" width="13" height="20" fill="#FFFFFF"/>`),
    ...Array.from({ length: 6 }, (_, i) => `<path d="M570 ${n(base - 100 + i * 12)}H800" stroke="#5A2B12" stroke-width="2"/>`),
  );
  // Cymbals (manjira) on a cord.
  out.push(`<path d="M890 ${n(base - 120)}q20 30 40 0" stroke="#8B5A2B" stroke-width="2" fill="none"/><ellipse cx="886" cy="${n(base - 100)}" rx="26" ry="12" fill="${pal.gold}"/><ellipse cx="934" cy="${n(base - 100)}" rx="26" ry="12" fill="${pal.gold}"/>`);
  out.push(`</g>`);
  for (const x of [90, 470, 1010]) out.push(diya(x * sx, base - 26, 22, "#B5561F", pal.gold));
  out.push(garland(0, W, base - 6, 0, 40, ["#F9A825", "#EF6C00", "#FFD54F"], "#5E8C3A"));
  const sky = skyGradient("sky", [[0, pal.paper, 0], [0.3, "#F3E3F0", 0.8], [0.65, "#D9BCE0", 1], [0.9, "#9B7CC0", 1]]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky);
};

/** General: soft hills and a large faint mandala rising like a sun, in the brand colours. */
const hillsScene: SceneFn = (W, h, pal) => {
  const base = h - 78;
  const sx = W / 1080;
  const out: string[] = [];
  out.push(`<g opacity="0.55">${mandala(W / 2, base - 40, 230, pal.gold, 1, [rgba(pal.gold, 0.12), rgba(pal.accent, 0.1), rgba(pal.gold, 0.25)])}</g>`);
  out.push(`<path d="M0 ${n(base - 70)}Q${n(260 * sx)} ${n(base - 150)} ${n(540 * sx)} ${n(base - 80)}T${n(W)} ${n(base - 100)}V${n(h)}H0Z" fill="${mix(pal.accent, pal.paper, 0.55)}"/>`);
  out.push(`<path d="M0 ${n(base - 20)}Q${n(320 * sx)} ${n(base - 100)} ${n(660 * sx)} ${n(base - 30)}T${n(W)} ${n(base - 40)}V${n(h)}H0Z" fill="${mix(pal.accent, pal.paper, 0.25)}"/>`);
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="${pal.accent}"/>`);
  const sky = skyGradient("sky", [[0, pal.paper, 0], [0.4, mix(pal.paper, pal.gold, 0.12), 0.8], [0.8, mix(pal.paper, pal.gold, 0.3), 1]]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky);
};

// ── The ribbon ───────────────────────────────────────────────────────────────

/** The date ribbon: a band with folded, notched tails and gold rules (`band` of `H` tall; the tails hang below). */
export function ribbonSvg(o: { W: number; H: number; band: number; inset?: number; pal: PosterPalette }): string {
  const { W, H, band, pal } = o;
  const inset = o.inset ?? 50;
  const tailY = H - band;
  const light = mix(pal.accent, "#FFFFFF", 0.14);
  const dark = mix(pal.accent, "#000000", 0.22);
  const defs = `<linearGradient id="rb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${pal.accent}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;
  return svgDoc(
    W,
    H,
    `<path d="M0 ${n(tailY)}H${n(inset + 34)}V${n(H)}H0L26 ${n(tailY + band / 2)}Z" fill="${pal.accentDeep}"/>` +
      `<path d="M${n(W)} ${n(tailY)}H${n(W - inset - 34)}V${n(H)}H${n(W)}L${n(W - 26)} ${n(tailY + band / 2)}Z" fill="${pal.accentDeep}"/>` +
      `<path d="M${n(inset)} ${n(band)}L${n(inset + 34)} ${n(H)}V${n(band)}Z" fill="${mix(pal.accentDeep, "#000000", 0.35)}"/>` +
      `<path d="M${n(W - inset)} ${n(band)}L${n(W - inset - 34)} ${n(H)}V${n(band)}Z" fill="${mix(pal.accentDeep, "#000000", 0.35)}"/>` +
      `<rect x="${n(inset)}" y="0" width="${n(W - inset * 2)}" height="${n(band)}" fill="url(#rb)"/>` +
      `<path d="M${n(inset + 10)} 9H${n(W - inset - 10)}M${n(inset + 10)} ${n(band - 9)}H${n(W - inset - 10)}" stroke="${pal.gold}" stroke-width="1.6"/>` +
      `<path d="M${n(inset + 10)} 14H${n(W - inset - 10)}M${n(inset + 10)} ${n(band - 14)}H${n(W - inset - 10)}" stroke="${pal.gold}" stroke-width="0.8" stroke-dasharray="2 5"/>`,
    defs,
  );
}

// ── The packs ────────────────────────────────────────────────────────────────

export type ArtPack = {
  occasion: FlyerOccasion;
  /** One line for the picker. */
  blurb: string;
  palette: PosterPalette;
  /** The code-drawn frame (W × H units). */
  frame: (W: number, H: number) => string;
  /** The code-drawn scene, `height` units tall at full size; `busy` units from its bottom hold the art (the rest is sky). */
  scene: { draw: (W: number, h: number) => string; height: number; busy: number };
  /** For an AI scene: transparent above `from`, solid below `to` (fractions of its height). */
  fade: { from: number; to: number };
  /** For an AI frame: the opacity of the soft paper panel behind the words (AI frames rarely leave a clean centre). */
  scrim: number;
  /** Units from the top edge that the frame's own ornament hangs down to in the middle (a toran, a garland): the words start below it. */
  topInset: number;
};

type PackSpec = { blurb: string; frame: FrameFn; scene: SceneFn; sceneHeight: number; busy: number; fade: { from: number; to: number }; scrim: number; topInset: number };

const SPECS: Record<FlyerOccasion, PackSpec> = {
  garba: { blurb: "Dancers, bunting and lanterns; mirror-work border", frame: garbaFrame, scene: garbaScene, sceneHeight: 470, busy: 330, fade: { from: 0.12, to: 0.4 }, scrim: 0.84, topInset: 54 },
  paryushan: { blurb: "A calm lotus pond at dawn; a quiet gold border", frame: lotusFrame, scene: lotusScene, sceneHeight: 420, busy: 250, fade: { from: 0.15, to: 0.42 }, scrim: 0.8, topInset: 54 },
  diwali: { blurb: "Glowing diyas and rangoli; a marigold toran", frame: diwaliFrame, scene: diwaliScene, sceneHeight: 450, busy: 320, fade: { from: 0.12, to: 0.4 }, scrim: 0.84, topInset: 128 },
  mahavir: { blurb: "Temple spires at sunrise; a mango-leaf toran", frame: toranFrame, scene: templeScene, sceneHeight: 460, busy: 330, fade: { from: 0.12, to: 0.38 }, scrim: 0.82, topInset: 118 },
  convention: { blurb: "City skyline, string lights and Garba; gold and eucalyptus", frame: eucalyptusFrame, scene: skylineScene, sceneHeight: 470, busy: 280, fade: { from: 0.18, to: 0.42 }, scrim: 0.82, topInset: 54 },
  pathshala: { blurb: "Hills, books and kites; a playful dotted border", frame: playfulFrame, scene: learningScene, sceneHeight: 420, busy: 330, fade: { from: 0.12, to: 0.36 }, scrim: 0.82, topInset: 54 },
  bhakti: { blurb: "Tabla, harmonium and diyas; paisley and jasmine", frame: paisleyFrame, scene: musicScene, sceneHeight: 440, busy: 290, fade: { from: 0.14, to: 0.4 }, scrim: 0.82, topInset: 54 },
  general: { blurb: "Your brand colours; mandala corners and soft hills", frame: simpleFrame, scene: hillsScene, sceneHeight: 400, busy: 200, fade: { from: 0.15, to: 0.45 }, scrim: 0.8, topInset: 54 },
};

/** The pack for an occasion. General takes its palette from the community's brand kit. */
export function artPack(occasion: FlyerOccasion, brand: { primary: string; accent: string; background: string }): ArtPack {
  const spec = SPECS[occasion];
  const palette = occasion === "general" ? brandPalette(brand) : FIXED[occasion];
  return {
    occasion,
    blurb: spec.blurb,
    palette,
    frame: (W, H) => spec.frame(W, H, palette),
    scene: { draw: (W, h) => spec.scene(W, h, palette), height: spec.sceneHeight, busy: spec.busy },
    fade: spec.fade,
    scrim: spec.scrim,
    topInset: spec.topInset,
  };
}

/** An SVG as a data URI (base64 of ASCII: works in the browser and on the server). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * One layer of a pack on its own, for the layer picker's "Drawn" tile: the frame
 * (1080 × 1620) or the bottom scene (1080 wide, its own height, transparent sky:
 * show it on the palette's paper colour), or nothing but the paper.
 */
export function packLayerThumbnailSvg(pack: ArtPack, layer: "frame" | "scene" | "none"): { svg: string; w: number; h: number } {
  if (layer === "frame") return { svg: pack.frame(1080, 1620), w: 1080, h: 1620 };
  if (layer === "scene") return { svg: pack.scene.draw(1080, pack.scene.height), w: 1080, h: pack.scene.height };
  return { svg: plainPaperSvg(1080, 1620, pack.palette), w: 1080, h: 1620 };
}

/**
 * A small preview of a pack (frame and scene together), for the picker:
 * `w` × `h` pixels, drawn at poster scale and shrunk by the browser.
 */
export function packThumbnailSvg(pack: ArtPack, o: { frame: boolean; scene: boolean }): string {
  const W = 1080;
  const H = 1620;
  const sh = pack.scene.height;
  const frame = o.frame ? pack.frame(W, H) : plainPaperSvg(W, H, pack.palette);
  const scene = o.scene ? pack.scene.draw(W, sh) : null;
  const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  // Unique gradient ids: the frame and the scene each define their own.
  const f = inner(frame).replace(/id="paper"/g, 'id="tpaper"').replace(/url\(#paper\)/g, "url(#tpaper)");
  const s = scene ? inner(scene).replace(/id="(sky|sun|water|rb)"/g, 'id="t$1"').replace(/url\(#(sky|sun|water|rb)\)/g, "url(#t$1)") : "";
  const bars = [0.2, 0.27, 0.36].map((y, i) => `<rect x="${200 + i * 40}" y="${n(H * y)}" width="${680 - i * 80}" height="${i === 0 ? 70 : 34}" rx="10" fill="${i === 0 ? pack.palette.ink : pack.palette.goldText}" opacity="${i === 0 ? 0.85 : 0.6}"/>`);
  const ribbon = `<rect x="60" y="${n(H * 0.47)}" width="960" height="90" fill="${pack.palette.accent}"/>`;
  return svgDoc(W, H, `${f}${bars.join("")}${ribbon}${s ? `<g transform="translate(0 ${n(H - sh)})">${s}</g>` : ""}<rect x="0" y="${n(H - 66)}" width="${W}" height="66" fill="${pack.palette.footerBg}"/>`);
}
