// Drawing primitives shared by every occasion art pack: the packs in
// src/lib/events/flyer-art-packs.ts and the ones in this folder. Pure SVG
// strings (paths, circles, gradients), never a <text> element, never a person.
//
// Units are the poster's own: 1080 wide. A frame is W x H, a scene W x h with
// its ground line `h - 78` (the footer band covers the bottom 66).

import { contrastRatio, parseHexColor, textOn } from "@/lib/setup";

// ── Numbers and colours ──────────────────────────────────────────────────────

export const n = (v: number) => String(Math.round(v * 10) / 10);
/** Two decimals, for opacities. */
const a2 = (v: number) => String(Math.round(Math.max(0, Math.min(1, v)) * 100) / 100);

export function rgba(hex: string, a: number): string {
  const c = parseHexColor(hex) ?? [0, 0, 0];
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** Mix two hex colours: t = 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHexColor(a) ?? [0, 0, 0];
  const y = parseHexColor(b) ?? [0, 0, 0];
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** A tiny deterministic random number generator (the same art every render). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** A point on a quadratic curve. */
export const qb = (p0: number[], p1: number[], p2: number[], t: number) => [
  (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0],
  (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1],
];

// ── The document ─────────────────────────────────────────────────────────────

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

export function svgDoc(W: number, H: number, body: string, defs = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}" height="${n(H)}" viewBox="0 0 ${n(W)} ${n(H)}">${defs ? `<defs>${defs}</defs>` : ""}${flattenOpacity(body)}</svg>`;
}

export type Stop = [offset: number, color: string, alpha: number];

export function skyGradient(id: string, stops: Stop[]): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
}

/**
 * How far down a scene `h` tall the poster's words can reach, as a fraction of its height: the words stop `busy` units above
 * the scene's bottom plus the layout's 28-unit slack, which is about 20 scene units on a Story (the scene is drawn 1.42
 * times larger there); on every other size they stop higher. planPoster() in flyer-poster.tsx is the rule this follows.
 */
export const wordLine = (h: number, busy: number) => Math.max(0.05, (h - busy - 20) / h);

/**
 * The sky colour where words may sit: `tint` mixed into the paper only as far as the text colour still reads at 6:1 on it
 * (4.5:1 is the rule; the margin covers the paragraph colour, a step lighter than the ink). On a dark page the sky stays dark.
 */
export function quietSky(c: { paper: string; ink: string; primary?: string }, tint: string, most = 0.6): string {
  // The brand colour is also set as text (agenda times, the big number) when it reads on the paper: keep it at 4.5:1 too.
  const accent = c.primary && (contrastRatio(c.primary, c.paper) ?? 0) >= 4.5 ? c.primary : null;
  // The paragraph is set a step lighter than the ink (brandPalette mixes in 12% of the paper): check a slightly lighter one.
  const body = mix(c.ink, c.paper, 0.15);
  for (let t = most; t > 0.001; t -= 0.05) {
    const m = mix(c.paper, tint, t);
    if ((contrastRatio(c.ink, m) ?? 0) >= 6 && (contrastRatio(body, m) ?? 0) >= 4.6 && (!accent || (contrastRatio(accent, m) ?? 0) >= 4.6)) return m;
  }
  return c.paper;
}

/**
 * A quiet wash over the frame's lower part in the occasion's sky colour (the same colour the scene's sky starts with, so
 * the two meet without a seam): the middle of the poster is never a flat empty page, and every word still reads.
 */
export function frameWash(W: number, H: number, c: { paper: string; ink: string; primary?: string }, tint: string): { defs: string; body: string } {
  const q = quietSky(c, tint);
  return {
    defs: skyGradient("wash", [
      [0, q, 0],
      [0.4, q, 0.5],
      [1, q, 1],
    ]),
    body: `<rect x="0" y="${n(H * 0.26)}" width="${n(W)}" height="${n(H * 0.74)}" fill="url(#wash)"/>`,
  };
}

/**
 * A scene drawn at its own size (`W / g` by `h / g`) shown `g` times larger in a `W` by `h` picture: every shape in
 * proportion, the sky's stops where they were.
 */
export function grownScene(svg: string, W: number, h: number, g: number): string {
  const m = /^<svg[^>]*>(?:<defs>([\s\S]*?)<\/defs>)?([\s\S]*)<\/svg>$/.exec(svg);
  if (!m || Math.abs(g - 1) < 1e-6) return svg;
  return svgDoc(W, h, `<g transform="scale(${Math.round(g * 10000) / 10000})">${m[2]}</g>`, m[1] ?? "");
}

/**
 * A scene's sky: clear at the top, a quiet tint (quietSky) down to the line the words can reach (wordLine), then the
 * scene's own colours. Stops above that line are dropped, so no pack can put a dark sky behind words.
 */
export function sceneSky(c: { paper: string; ink: string; primary?: string }, h: number, busy: number, tint: string, stops: Stop[], most = 0.6): string {
  const w = Math.round(wordLine(h, busy) * 1000) / 1000;
  const quiet = quietSky(c, tint, most);
  return skyGradient("sky", [[0, c.paper, 0], [Math.round(w * 600) / 1000, quiet, 0.6], [w, quiet, 1], ...stops.filter(([o]) => o > w)]);
}

/**
 * Gradients collected while drawing, each defined once. Ids carry a prefix (a frame's "f", a scene's "s") so a frame and a
 * scene drawn into one picture (the picker's thumbnail) never share an id.
 */
export type Defs = {
  /** A soft round glow: the colour at the centre fading to nothing at the rim (fill a circle with it). */
  glow(color: string, strength?: number): string;
  /** A linear gradient, top to bottom (or left to right). */
  linear(name: string, stops: Stop[], dir?: "down" | "right"): string;
  /** Everything defined so far, for svgDoc's defs. */
  svg(): string;
};

export function makeDefs(prefix: string): Defs {
  const items = new Map<string, string>();
  const add = (id: string, svg: string) => {
    if (!items.has(id)) items.set(id, svg);
    return `url(#${id})`;
  };
  return {
    glow: (color, strength = 0.85) => {
      const id = `${prefix}glow${color.replace("#", "")}${Math.round(strength * 100)}`;
      return add(
        id,
        `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${color}" stop-opacity="${a2(strength)}"/><stop offset="0.32" stop-color="${color}" stop-opacity="${a2(strength * 0.5)}"/><stop offset="0.65" stop-color="${color}" stop-opacity="${a2(strength * 0.14)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
      );
    },
    linear: (name, stops, dir = "down") => {
      const id = `${prefix}${name}`;
      return add(
        id,
        `<linearGradient id="${id}" x1="0" y1="0" x2="${dir === "right" ? 1 : 0}" y2="${dir === "down" ? 1 : 0}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a2(a)}"/>`).join("")}</linearGradient>`,
      );
    },
    svg: () => [...items.values()].join(""),
  };
}

/** A circle filled with a soft glow. */
export function glowDot(d: Defs, x: number, y: number, r: number, color: string, strength = 0.85): string {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${d.glow(color, strength)}"/>`;
}

// ── The frame's paper and rules ──────────────────────────────────────────────

/** The paper: a soft radial glow towards the middle (a dark page glows only faintly, so its light words keep their contrast). */
export function paperFill(W: number, H: number, pal: { paper: string }, glow = "#FFFFFF"): { defs: string; body: string } {
  const dark = textOn(pal.paper) === "#FFFFFF";
  const [inner, mid] = dark ? [0.06, 0.02] : [0.45, 0.15];
  return {
    defs: `<radialGradient id="paper" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${mix(pal.paper, glow, inner)}"/><stop offset="0.55" stop-color="${mix(pal.paper, glow, mid)}"/><stop offset="1" stop-color="${pal.paper}"/></radialGradient>`,
    body: `<rect width="${n(W)}" height="${n(H)}" fill="url(#paper)"/>`,
  };
}

/** The thin gold rules every frame shares: an outer line, an inner line, a dotted line. */
export function borderLines(W: number, H: number, gold: string, o: { inset?: number; dotted?: boolean; radius?: number } = {}): string {
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
export function filigree(W: number, H: number, gold: string, o: { sides?: boolean; top?: boolean } = {}): string {
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
export function fourCorners(W: number, H: number, corner: string): string {
  return (
    `<g>${corner}</g>` +
    `<g transform="translate(${n(W)} 0) scale(-1 1)">${corner}</g>` +
    `<g transform="translate(0 ${n(H)}) scale(1 -1)">${corner}</g>` +
    `<g transform="translate(${n(W)} ${n(H)}) scale(-1 -1)">${corner}</g>`
  );
}

/** Mirror the top-left corner art into the top-right corner only (the bottom corners sit under the scene). */
export function topCorners(W: number, corner: string): string {
  return `<g>${corner}</g><g transform="translate(${n(W)} 0) scale(-1 1)">${corner}</g>`;
}

/** Small ornaments down both side edges, from `y0` to `y1`, every `step` units (`draw` is given the x and the y). */
export function sideRun(W: number, y0: number, y1: number, step: number, draw: (x: number, y: number, i: number) => string, inset = 30): string {
  let out = "";
  let i = 0;
  for (let y = y0; y <= y1; y += step, i++) out += draw(inset, y, i) + draw(W - inset, y, i);
  return out;
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/** A petal from (0,0) pointing up. */
export function petal(len: number, wid: number): string {
  return `M0 0C${n(wid)} ${n(-len * 0.32)} ${n(wid * 0.62)} ${n(-len * 0.86)} 0 ${n(-len)}C${n(-wid * 0.62)} ${n(-len * 0.86)} ${n(-wid)} ${n(-len * 0.32)} 0 0Z`;
}

/** A five-petal flower (jasmine, marigold) centred on (x, y). */
export function flower(x: number, y: number, r: number, fill: string, centre: string, petals = 5, rot = 0): string {
  let out = `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})">`;
  for (let i = 0; i < petals; i++) out += `<ellipse cx="0" cy="${n(-r * 0.55)}" rx="${n(r * 0.36)}" ry="${n(r * 0.55)}" transform="rotate(${n((360 / petals) * i)})" fill="${fill}"/>`;
  return `${out}<circle r="${n(r * 0.28)}" fill="${centre}"/></g>`;
}

/** A paper-cut star with five points. */
export function star(x: number, y: number, r: number, fill: string, rot = 0): string {
  return starN(x, y, r, r * 0.45, 5, fill, rot);
}

/** A star of `points` points: outer radius `R`, inner `r`. */
export function starN(x: number, y: number, R: number, r: number, points: number, fill: string, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI / points) * i - Math.PI / 2 + (rot * Math.PI) / 180;
    const rr = i % 2 ? r : R;
    pts.push(`${n(x + Math.cos(a) * rr)} ${n(y + Math.sin(a) * rr)}`);
  }
  return `<path d="M${pts.join("L")}Z" fill="${fill}"/>`;
}

/** A four-pointed twinkle with softly curved sides. */
export function sparkle(x: number, y: number, r: number, fill: string, opacity = 1): string {
  const c = r * 0.16;
  return `<path d="M${n(x)} ${n(y - r)}Q${n(x + c)} ${n(y - c)} ${n(x + r)} ${n(y)}Q${n(x + c)} ${n(y + c)} ${n(x)} ${n(y + r)}Q${n(x - c)} ${n(y + c)} ${n(x - r)} ${n(y)}Q${n(x - c)} ${n(y - c)} ${n(x)} ${n(y - r)}Z" fill="${fill}"${opacity < 1 ? ` opacity="${a2(opacity)}"` : ""}/>`;
}

/** A heart centred on (x, y), about 2s wide. */
export function heart(x: number, y: number, s: number, fill: string, extra = ""): string {
  return `<path d="M${n(x)} ${n(y + s * 0.95)}C${n(x - s * 1.5)} ${n(y + s * 0.05)} ${n(x - s * 0.95)} ${n(y - s * 1.05)} ${n(x)} ${n(y - s * 0.38)}C${n(x + s * 0.95)} ${n(y - s * 1.05)} ${n(x + s * 1.5)} ${n(y + s * 0.05)} ${n(x)} ${n(y + s * 0.95)}Z" fill="${fill}"${extra}/>`;
}

/** A leaf pointed at both ends, from (x, y) along `rot` degrees (0 = up), with a centre vein. */
export function leaf(x: number, y: number, len: number, wid: number, rot: number, fill: string, vein?: string): string {
  return (
    `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})">` +
    `<path d="M0 0Q${n(wid)} ${n(-len * 0.45)} 0 ${n(-len)}Q${n(-wid)} ${n(-len * 0.45)} 0 0Z" fill="${fill}"/>` +
    (vein ? `<path d="M0 ${n(-len * 0.04)}L0 ${n(-len * 0.88)}" stroke="${vein}" stroke-width="${n(Math.max(0.8, wid * 0.08))}" stroke-linecap="round"/>` : "") +
    `</g>`
  );
}

/** A teardrop flame standing on (x, yBase), `h` tall and about `w` wide. */
export function flame(x: number, yBase: number, h: number, w: number, fill: string): string {
  const c = w * 0.62;
  return `<path d="M${n(x)} ${n(yBase - h)}C${n(x + c * 0.55)} ${n(yBase - h * 0.6)} ${n(x + c)} ${n(yBase - h * 0.22)} ${n(x)} ${n(yBase)}C${n(x - c)} ${n(yBase - h * 0.22)} ${n(x - c * 0.55)} ${n(yBase - h * 0.6)} ${n(x)} ${n(yBase - h)}Z" fill="${fill}"/>`;
}

/**
 * A crescent moon: a disc of radius `r` less a disc offset towards `rot` degrees (0 = the horns point right). Drawn from the
 * two circles' crossing points so it is one clean shape.
 */
export function crescent(cx: number, cy: number, r: number, fill: string, o: { inner?: number; offset?: number; rot?: number } = {}): string {
  const rb = r * (o.inner ?? 0.84);
  const d = r * (o.offset ?? 0.38);
  const a = (r * r - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r * r - a * a));
  const large = a > d ? 1 : 0;
  return `<path transform="translate(${n(cx)} ${n(cy)}) rotate(${n(o.rot ?? 0)})" d="M${n(a)} ${n(h)}A${n(r)} ${n(r)} 0 1 1 ${n(a)} ${n(-h)}A${n(rb)} ${n(rb)} 0 ${large} 0 ${n(a)} ${n(h)}Z" fill="${fill}"/>`;
}

/** An eight-pointed star (two squares turned 45 degrees to each other), the classic geometric star. */
export function eightStar(cx: number, cy: number, r: number, attrs: string, rot = 0): string {
  const inner = r * 0.7654;
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const ang = (Math.PI / 8) * i - Math.PI / 2 + (rot * Math.PI) / 180;
    const rr = i % 2 ? inner : r;
    pts.push(`${n(cx + Math.cos(ang) * rr)} ${n(cy + Math.sin(ang) * rr)}`);
  }
  return `<path d="M${pts.join("L")}Z" ${attrs}/>`;
}

/** A burst of rays and sparks (fireworks), centred on (cx, cy). */
export function burst(cx: number, cy: number, r: number, color: string, rays = 18, width = 2.2): string {
  let s = "";
  for (let i = 0; i < rays; i++) {
    const a = (Math.PI * 2 * i) / rays;
    s += `<path d="M${n(cx + Math.cos(a) * r * 0.3)} ${n(cy + Math.sin(a) * r * 0.3)}L${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
    s += `<circle cx="${n(cx + Math.cos(a) * r * 1.12)}" cy="${n(cy + Math.sin(a) * r * 1.12)}" r="${n(width * 1.2)}" fill="${color}"/>`;
  }
  return s;
}

/** A soft cloud of overlapping circles on a flat base, centred on (x, y). */
export function cloud(x: number, y: number, s: number, fill: string, opacity = 0.9): string {
  const parts = [
    [-34, 4, 20],
    [-8, -10, 28],
    [24, -4, 24],
    [48, 8, 15],
  ]
    .map(([dx, dy, r]) => `<circle cx="${n(x + dx * s)}" cy="${n(y + dy * s)}" r="${n(r * s)}"/>`)
    .join("");
  return `<g fill="${fill}" opacity="${a2(opacity)}">${parts}<rect x="${n(x - 52 * s)}" y="${n(y + 2 * s)}" width="${n(114 * s)}" height="${n(22 * s)}" rx="${n(11 * s)}"/></g>`;
}

/** A layered pine tree standing on (x, base), about 200s tall; optional snow on each tier. */
export function pine(x: number, base: number, s: number, fill: string, o: { snow?: string; shade?: number; trunk?: string } = {}): string {
  const H = 200 * s;
  const dark = mix(fill, "#000000", o.shade ?? 0.22);
  const tiers: [number, number, number][] = [
    [0, 0.36, 0.26],
    [0.16, 0.58, 0.38],
    [0.36, 0.8, 0.5],
    [0.56, 0.98, 0.62],
  ];
  let out = `<rect x="${n(x - 8 * s)}" y="${n(base - H * 0.1)}" width="${n(16 * s)}" height="${n(H * 0.1)}" fill="${o.trunk ?? "#4A3426"}"/>`;
  for (const [t0, t1, wf] of tiers) {
    const top = base - H + H * t0;
    const bot = base - H + H * t1;
    const hw = H * wf * 0.5;
    const mid = (top + bot) / 2;
    const tip = `M${n(x)} ${n(top)}`;
    const right = `Q${n(x + hw * 0.32)} ${n(mid)} ${n(x + hw)} ${n(bot)}L${n(x + hw * 0.55)} ${n(bot - 7 * s)}L${n(x + hw * 0.3)} ${n(bot - 1 * s)}L${n(x)} ${n(bot - 6 * s)}`;
    const left = `L${n(x - hw * 0.3)} ${n(bot - 1 * s)}L${n(x - hw * 0.55)} ${n(bot - 7 * s)}L${n(x - hw)} ${n(bot)}Q${n(x - hw * 0.32)} ${n(mid)} ${n(x)} ${n(top)}Z`;
    out += `<path d="${tip}${right}${left}" fill="${fill}"/>`;
    out += `<path d="${tip}${right}Z" fill="${dark}"/>`;
    if (o.snow) out += `<path d="M${n(x - hw * 0.92)} ${n(bot - 1)}Q${n(x - hw * 0.4)} ${n(bot - 12 * s)} ${n(x)} ${n(bot - 7 * s)}Q${n(x + hw * 0.4)} ${n(bot - 12 * s)} ${n(x + hw * 0.92)} ${n(bot - 1)}Q${n(x)} ${n(bot - 3 * s)} ${n(x - hw * 0.92)} ${n(bot - 1)}Z" fill="${o.snow}" opacity="0.9"/>`;
  }
  return out;
}

/** A round leafy tree standing on (x, base), about 150s tall. */
export function roundTree(x: number, base: number, s: number, leafColor: string, trunk = "#6B4A33"): string {
  const light = mix(leafColor, "#FFFFFF", 0.18);
  const dark = mix(leafColor, "#000000", 0.18);
  return (
    `<path d="M${n(x - 7 * s)} ${n(base)}L${n(x - 4 * s)} ${n(base - 70 * s)}L${n(x + 4 * s)} ${n(base - 70 * s)}L${n(x + 7 * s)} ${n(base)}Z" fill="${trunk}"/>` +
    `<path d="M${n(x)} ${n(base - 52 * s)}L${n(x + 18 * s)} ${n(base - 78 * s)}" stroke="${trunk}" stroke-width="${n(4 * s)}" stroke-linecap="round"/>` +
    `<circle cx="${n(x - 26 * s)}" cy="${n(base - 92 * s)}" r="${n(32 * s)}" fill="${dark}"/>` +
    `<circle cx="${n(x + 28 * s)}" cy="${n(base - 96 * s)}" r="${n(30 * s)}" fill="${dark}"/>` +
    `<circle cx="${n(x)}" cy="${n(base - 118 * s)}" r="${n(38 * s)}" fill="${leafColor}"/>` +
    `<circle cx="${n(x - 18 * s)}" cy="${n(base - 104 * s)}" r="${n(26 * s)}" fill="${leafColor}"/>` +
    `<circle cx="${n(x + 20 * s)}" cy="${n(base - 108 * s)}" r="${n(24 * s)}" fill="${leafColor}"/>` +
    `<circle cx="${n(x - 10 * s)}" cy="${n(base - 130 * s)}" r="${n(16 * s)}" fill="${light}"/>`
  );
}

/** A smooth band of hills across the whole width: its crest wanders around `y` by `amp`, filled down to `bottom`. */
export function hills(W: number, y: number, amp: number, bottom: number, fill: string, phase = 0): string {
  const pts: string[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const x = (W / steps) * i;
    const yy = y + Math.sin(i * 1.7 + phase) * amp * (i % 2 ? 1 : 0.55);
    pts.push(`${n(x)} ${n(yy)}`);
  }
  let d = `M-2 ${pts[0].split(" ")[1]}`;
  for (let i = 1; i <= steps; i++) {
    const [px, py] = pts[i - 1].split(" ").map(Number);
    const [x, yy] = pts[i].split(" ").map(Number);
    const mx = (px + x) / 2;
    d += `C${n(mx)} ${n(py)} ${n(mx)} ${n(yy)} ${n(x)} ${n(yy)}`;
  }
  return `<path d="${d}L${n(W + 2)} ${n(bottom)}L-2 ${n(bottom)}Z" fill="${fill}"/>`;
}

/** Triangle flags on a sagging cord from x0 to x1. */
export function bunting(x0: number, x1: number, y: number, sag: number, count: number, colors: string[], cord: string, o: { drop?: number; offset?: number } = {}): string {
  const drop = o.drop ?? 30;
  const at = (t: number) => [x0 + (x1 - x0) * t, y + sag * 4 * t * (1 - t)];
  let out = "";
  const pts: number[][] = [];
  for (let i = 0; i <= 24; i++) pts.push(at(i / 24));
  out += `<path d="M${pts.map((p) => p.map(n).join(" ")).join("L")}" stroke="${cord}" stroke-width="1.6" fill="none"/>`;
  for (let i = 0; i < count; i++) {
    const [ax, ay] = at((i + 0.1) / count);
    const [bx, by] = at((i + 0.9) / count);
    const c = colors[(i + (o.offset ?? 0)) % colors.length];
    out += `<path d="M${n(ax)} ${n(ay)}L${n(bx)} ${n(by)}L${n((ax + bx) / 2)} ${n((ay + by) / 2 + drop)}Z" fill="${c}"/>`;
    out += `<path d="M${n(ax)} ${n(ay)}L${n((ax + bx) / 2)} ${n((ay + by) / 2 + drop)}L${n((ax * 2 + bx) / 3)} ${n((ay * 2 + by) / 3)}Z" fill="#FFFFFF" opacity="0.18"/>`;
  }
  return out;
}

/** A balloon centred on (x, y) with its string running down to (sx, sy). */
export function balloon(x: number, y: number, r: number, color: string, sx: number, sy: number): string {
  const knot = y + r * 1.16;
  return (
    `<path d="M${n(x)} ${n(knot + 4)}C${n(x + (sx - x) * 0.2 + 14)} ${n(knot + (sy - knot) * 0.3)} ${n(sx - 12)} ${n(knot + (sy - knot) * 0.65)} ${n(sx)} ${n(sy)}" stroke="#8A8F98" stroke-width="1.4" fill="none"/>` +
    `<path d="M${n(x - 5)} ${n(knot + 6)}L${n(x + 5)} ${n(knot + 6)}L${n(x)} ${n(knot - 2)}Z" fill="${mix(color, "#000000", 0.2)}"/>` +
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(r)}" ry="${n(r * 1.17)}" fill="${color}"/>` +
    `<ellipse cx="${n(x + r * 0.25)}" cy="${n(y + r * 0.2)}" rx="${n(r * 0.72)}" ry="${n(r * 0.9)}" fill="${mix(color, "#000000", 0.14)}" opacity="0.55"/>` +
    `<ellipse cx="${n(x - r * 0.36)}" cy="${n(y - r * 0.42)}" rx="${n(r * 0.2)}" ry="${n(r * 0.32)}" transform="rotate(-28 ${n(x - r * 0.36)} ${n(y - r * 0.42)})" fill="#FFFFFF" opacity="0.5"/>`
  );
}

/** Scattered confetti (little strips, dots and squiggles) inside a box, the same every time for a seed. */
export function confetti(seed: number, count: number, box: { x0: number; y0: number; x1: number; y1: number }, colors: string[], scale = 1): string {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = box.x0 + r() * (box.x1 - box.x0);
    const y = box.y0 + r() * (box.y1 - box.y0);
    const c = colors[i % colors.length];
    const rot = Math.round(r() * 180);
    const kind = i % 4;
    if (kind === 0 || kind === 1) out += `<rect x="${n(x - 6 * scale)}" y="${n(y - 2.5 * scale)}" width="${n(12 * scale)}" height="${n(5 * scale)}" rx="1" transform="rotate(${rot} ${n(x)} ${n(y)})" fill="${c}"/>`;
    else if (kind === 2) out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(3.6 * scale)}" fill="${c}"/>`;
    else out += `<path d="M${n(x - 9 * scale)} ${n(y)}q${n(4.5 * scale)} ${n(-6 * scale)} ${n(9 * scale)} 0t${n(9 * scale)} 0" transform="rotate(${rot} ${n(x)} ${n(y)})" stroke="${c}" stroke-width="${n(2.4 * scale)}" fill="none" stroke-linecap="round"/>`;
  }
  return out;
}

/** A tall wax candle standing on (x, base): `h` tall, `w` wide, with its flame and a warm halo. */
export function candle(d: Defs, x: number, base: number, h: number, w: number, o: { wax?: string; halo?: number } = {}): string {
  const wax = o.wax ?? "#F7EDD8";
  const top = base - h;
  const fy = top - w * 0.32;
  const fh = w * 2.3;
  const halo = o.halo ?? 1;
  return (
    glowDot(d, x, fy - fh * 0.45, w * 5.2 * halo, "#FFC15A", 0.5) +
    glowDot(d, x, fy - fh * 0.42, w * 2.2 * halo, "#FFE4A0", 0.75) +
    `<rect x="${n(x - w / 2)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" rx="${n(w * 0.1)}" fill="${wax}"/>` +
    `<rect x="${n(x - w / 2)}" y="${n(top)}" width="${n(w * 0.3)}" height="${n(h)}" fill="${mix(wax, "#8A6A3A", 0.22)}" opacity="0.8"/>` +
    `<rect x="${n(x + w * 0.16)}" y="${n(top)}" width="${n(w * 0.14)}" height="${n(h)}" fill="#FFFFFF" opacity="0.45"/>` +
    `<path d="M${n(x - w / 2)} ${n(top + w * 0.08)}Q${n(x - w * 0.3)} ${n(top + w * 0.7)} ${n(x - w * 0.15)} ${n(top + w * 0.1)}Q${n(x + w * 0.05)} ${n(top + w * 1.2)} ${n(x + w * 0.22)} ${n(top + w * 0.1)}Q${n(x + w * 0.38)} ${n(top + w * 0.5)} ${n(x + w / 2)} ${n(top + w * 0.08)}V${n(top)}H${n(x - w / 2)}Z" fill="${mix(wax, "#FFFFFF", 0.35)}"/>` +
    `<path d="M${n(x)} ${n(top)}V${n(fy + 1)}" stroke="#3E2F22" stroke-width="${n(Math.max(1, w * 0.07))}" stroke-linecap="round"/>` +
    flame(x, fy, fh, w * 0.78, "#FFB43C") +
    flame(x, fy - fh * 0.04, fh * 0.6, w * 0.4, "#FFF5D2")
  );
}

/** A hanging lantern (pierced metal and warm glass, the kind lit for Ramadan and Eid) on a cord from `top`, its body starting at `y`. */
export function lantern(d: Defs, x: number, top: number, y: number, s: number, metal: string, glass = "#FFD27A"): string {
  const X = (v: number) => n(x + v * s);
  const Y = (v: number) => n(y + v * s);
  const dark = mix(metal, "#000000", 0.3);
  return (
    `<path d="M${n(x)} ${n(top)}V${Y(-26)}" stroke="${metal}" stroke-width="${n(1.6 * s)}"/>` +
    glowDot(d, x, y + 40 * s, 92 * s, "#FFC861", 0.55) +
    `<circle cx="${n(x)}" cy="${Y(-30)}" r="${n(4.5 * s)}" fill="none" stroke="${metal}" stroke-width="${n(2 * s)}"/>` +
    // The dome and its finial.
    `<path d="M${X(-17)} ${Y(0)}Q${X(-16)} ${Y(-20)} ${X(0)} ${Y(-25)}Q${X(16)} ${Y(-20)} ${X(17)} ${Y(0)}Z" fill="${metal}"/>` +
    `<path d="M${X(-21)} ${Y(0)}H${X(21)}L${X(18)} ${Y(6)}H${X(-18)}Z" fill="${dark}"/>` +
    // The glass body: narrow at the top, widest in the middle, narrow at the foot.
    `<path d="M${X(-18)} ${Y(6)}L${X(-26)} ${Y(26)}L${X(-26)} ${Y(58)}L${X(-14)} ${Y(76)}H${X(14)}L${X(26)} ${Y(58)}L${X(26)} ${Y(26)}L${X(18)} ${Y(6)}Z" fill="${glass}"/>` +
    `<path d="M${X(-8)} ${Y(14)}Q${X(0)} ${Y(4)} ${X(8)} ${Y(14)}V${Y(62)}H${X(-8)}Z" fill="#FFF4D0" opacity="0.85"/>` +
    // The metal ribs and the pointed arch windows.
    `<path d="M${X(-18)} ${Y(6)}L${X(-26)} ${Y(26)}L${X(-26)} ${Y(58)}L${X(-14)} ${Y(76)}H${X(14)}L${X(26)} ${Y(58)}L${X(26)} ${Y(26)}L${X(18)} ${Y(6)}Z" fill="none" stroke="${metal}" stroke-width="${n(2.4 * s)}" stroke-linejoin="round"/>` +
    `<path d="M${X(-26)} ${Y(26)}H${X(26)}M${X(-26)} ${Y(58)}H${X(26)}M${X(-12)} ${Y(26)}V${Y(58)}M${X(12)} ${Y(26)}V${Y(58)}" stroke="${metal}" stroke-width="${n(1.8 * s)}"/>` +
    `<path d="M${X(-19)} ${Y(56)}V${Y(38)}Q${X(-19)} ${Y(30)} ${X(-12)} ${Y(28)}M${X(19)} ${Y(56)}V${Y(38)}Q${X(19)} ${Y(30)} ${X(12)} ${Y(28)}" stroke="${metal}" stroke-width="${n(1.2 * s)}" fill="none"/>` +
    // The foot and its tassel.
    `<path d="M${X(-14)} ${Y(76)}H${X(14)}L${X(9)} ${Y(84)}H${X(-9)}Z" fill="${dark}"/>` +
    `<path d="M${n(x)} ${Y(84)}V${Y(96)}" stroke="${metal}" stroke-width="${n(2 * s)}"/>` +
    `<path d="M${X(-4)} ${Y(96)}H${X(4)}L${X(2)} ${Y(110)}H${X(-2)}Z" fill="${metal}"/>`
  );
}

/** A simple building block for a skyline. */
export function building(x: number, w: number, top: number, base: number, fill: string, kind: string): string {
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

/** A string of party lights sagging across the whole width; `o` sets warm bulbs and a glow for the newer packs. */
export function stringLights(W: number, y0: number, sag: number, phase: number, out: string[], o: { colours?: string[]; wire?: string; glow?: Defs; every?: number; size?: number } = {}): void {
  const colours = o.colours ?? ["#FFD36B", "#FF8FB1", "#7FE0D2", "#FFB25B", "#C9A0FF"];
  const pts: number[][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push([t * W, y0 + sag * 4 * t * (1 - t)]);
  }
  out.push(`<path d="M${pts.map((p) => p.map(n).join(" ")).join("L")}" stroke="${o.wire ?? "#5B4A6E"}" stroke-width="1.4" fill="none" opacity="0.7"/>`);
  const size = o.size ?? 3.6;
  for (let i = 1; i < 40; i += o.every ?? 2) {
    const [bx, by] = pts[i];
    const c = colours[(i + phase) % colours.length];
    if (o.glow) out.push(glowDot(o.glow, bx, by + 5, size * 6, c, 0.7), `<path d="M${n(bx)} ${n(by)}V${n(by + 3)}" stroke="${o.wire ?? "#5B4A6E"}" stroke-width="2.4"/>`, `<circle cx="${n(bx)}" cy="${n(by + 5 + size * 0.3)}" r="${n(size)}" fill="${c}"/>`);
    else out.push(`<circle cx="${n(bx)}" cy="${n(by + 5)}" r="9" fill="${c}" opacity="0.25"/><circle cx="${n(bx)}" cy="${n(by + 5)}" r="3.6" fill="${c}"/>`);
  }
}

/** Twinkling stars and dots scattered over a box (a night sky). */
export function starField(seed: number, count: number, box: { x0: number; y0: number; x1: number; y1: number }, color = "#FFFFFF"): string {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = box.x0 + r() * (box.x1 - box.x0);
    const y = box.y0 + r() * (box.y1 - box.y0);
    const k = r();
    out += k > 0.9 ? sparkle(x, y, 5 + k * 4, color, 0.9) : `<circle cx="${n(x)}" cy="${n(y)}" r="${n(0.8 + k * 1.6)}" fill="${color}" opacity="${a2(0.35 + k * 0.55)}"/>`;
  }
  return out;
}

/** The scene's ground line: everything stands on `h - 78` (the footer band covers the bottom 66 units). */
export const groundOf = (h: number) => h - 78;

/**
 * A city skyline standing on `base`, as wide as the scene: a pale back row, then a front row of varied buildings with
 * lit windows (the same skyline every time for a seed).
 */
export function skyline(W: number, base: number, o: { seed: number; height: number; back: string; front: string; lit: string; litShare?: number }): string {
  const r = rng(o.seed);
  const out: string[] = [];
  for (let x = -10; x < W + 10; ) {
    const w = Math.round(30 + r() * 50);
    const top = Math.round(base - o.height * (0.42 + r() * 0.3));
    out.push(`<rect x="${Math.round(x)}" y="${top}" width="${w}" height="${n(base - top)}" fill="${o.back}"/>`);
    x += w + 2;
  }
  const kinds = ["rect", "bevel", "round", "stepped", "rect", "spire", "twin", "rect", "gables"];
  const windows: string[] = [];
  for (let x = -6; x < W + 6; ) {
    const w = Math.round(44 + r() * 56);
    const top = Math.round(base - o.height * (0.32 + r() * 0.62));
    const kind = kinds[Math.floor(r() * kinds.length)] ?? "rect";
    const bx = Math.round(x);
    out.push(building(bx, w, top, Math.round(base), o.front, kind));
    for (let wy = top + 30; wy < base - 14; wy += 14) {
      for (let wx = bx + 7; wx < bx + w - 9; wx += 11) if (r() < (o.litShare ?? 0.34)) windows.push(`<rect x="${wx}" y="${wy}" width="4" height="7" fill="${o.lit}" opacity="${n(0.45 + r() * 0.5)}"/>`);
    }
    x += w + 3 + r() * 6;
  }
  return out.join("") + windows.join("");
}
