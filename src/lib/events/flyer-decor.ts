// The layouts' decoration (pure SVG, drawn in code, no text, no figures): a wash of the brand's colours over the frame, bolder corner
// clusters (leaves, blossoms or a lotus) and ornament columns down the sides. It sits between the art frame and the words, so a
// drawn frame gets richer without being replaced, and an AI frame (already rich) is left alone.
//
// Which family a community starts with is data (flyer-layout.ts: ornamentFor): leaves for everyone, a lotus offered to the
// traditions that use it. The organizer can change it or turn it off.

import { mix } from "./flyer-art-packs";

export const ORNAMENT_FAMILIES = ["leaf", "blossom", "lotus", "none"] as const;
export type OrnamentFamily = (typeof ORNAMENT_FAMILIES)[number];
export const ORNAMENT_LABEL: Record<OrnamentFamily, string> = { leaf: "Leaves", blossom: "Blossoms", lotus: "Lotus", none: "None" };
export function isOrnamentFamily(v: unknown): v is OrnamentFamily {
  return typeof v === "string" && (ORNAMENT_FAMILIES as readonly string[]).includes(v);
}

export type DecorColors = { paper: string; ink: string; primary: string; accent: string; gold: string };

const n = (v: number) => Math.round(v * 100) / 100;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** A leaf from (0,0) pointing up (−y), `len` long and `wid` wide, as a path. */
function leafPath(len: number, wid: number): string {
  return `M0 0C${n(wid * 0.9)} ${n(-len * 0.3)} ${n(wid * 0.55)} ${n(-len * 0.8)} 0 ${n(-len)}C${n(-wid * 0.55)} ${n(-len * 0.8)} ${n(-wid * 0.9)} ${n(-len * 0.3)} 0 0Z`;
}

/** A leaf placed at (x, y), turned `deg` degrees from "up", with its midrib. */
function leaf(x: number, y: number, deg: number, len: number, wid: number, fill: string, vein: string): string {
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(deg)})"><path d="${leafPath(len, wid)}" fill="${fill}"/><path d="M0 ${n(-len * 0.08)}L0 ${n(-len * 0.9)}" stroke="${vein}" stroke-width="1.6" stroke-opacity="0.55" fill="none"/></g>`;
}

/** A five-petal blossom centred on (x, y), `r` across. */
function blossom(x: number, y: number, r: number, petal: string, centre: string, deg = 0): string {
  const petals = Array.from({ length: 5 }, (_, i) => `<ellipse cx="0" cy="${n(-r * 0.55)}" rx="${n(r * 0.36)}" ry="${n(r * 0.55)}" transform="rotate(${n(deg + i * 72)})" fill="${petal}"/>`).join("");
  return `<g transform="translate(${n(x)} ${n(y)})">${petals}<circle r="${n(r * 0.22)}" fill="${centre}"/><circle r="${n(r * 0.09)}" cx="${n(r * 0.06)}" cy="${n(-r * 0.05)}" fill="#fff" fill-opacity="0.55"/></g>`;
}

/** A lotus bloom opening upwards at (x, y): layers of pointed petals from the outside in. */
function lotus(x: number, y: number, size: number, outer: string, inner: string, centre: string, deg = 0): string {
  const layer = (count: number, spread: number, len: number, wid: number, fill: string) =>
    Array.from({ length: count }, (_, i) => {
      const a = count === 1 ? 0 : -spread / 2 + (spread / (count - 1)) * i;
      return `<path d="${leafPath(len, wid)}" transform="rotate(${n(a)})" fill="${fill}" stroke="${centre}" stroke-width="1.2" stroke-opacity="0.45"/>`;
    }).join("");
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(deg)})">${layer(5, 150, size, size * 0.34, outer)}${layer(5, 100, size * 0.82, size * 0.3, inner)}${layer(3, 52, size * 0.6, size * 0.24, mix(inner, "#FFFFFF", 0.45))}<circle cy="${n(-size * 0.06)}" r="${n(size * 0.07)}" fill="${centre}"/></g>`;
}

/** The top-left corner's cluster (origin at the corner, growing right and down), `size` units to its far leaf. */
function cluster(family: Exclude<OrnamentFamily, "none">, size: number, c: DecorColors): string {
  const green = mix(c.primary, "#3E7B4B", 0.45);
  const green2 = mix(c.gold, "#4E8A4E", 0.4);
  const vein = mix(green, "#000000", 0.35);
  const parts: string[] = [];
  // Three stems fanning out from the corner; leaves alternate along each.
  const stems: { deg: number; len: number }[] = [
    { deg: 12, len: size * 0.98 },
    { deg: 42, len: size * 0.82 },
    { deg: 72, len: size * 0.96 },
  ];
  for (const [si, st] of stems.entries()) {
    const a = rad(st.deg);
    const ex = Math.cos(a) * st.len;
    const ey = Math.sin(a) * st.len;
    const cx = Math.cos(a - 0.22) * st.len * 0.55;
    const cy = Math.sin(a - 0.22) * st.len * 0.55;
    parts.push(`<path d="M14 14Q${n(cx + 14)} ${n(cy + 14)} ${n(ex + 14)} ${n(ey + 14)}" fill="none" stroke="${vein}" stroke-width="4" stroke-linecap="round"/>`);
    const count = 6;
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 0.6);
      // A point on the quadratic curve, and the leaf's side and direction.
      const px = (1 - t) * (1 - t) * 14 + 2 * (1 - t) * t * (cx + 14) + t * t * (ex + 14);
      const py = (1 - t) * (1 - t) * 14 + 2 * (1 - t) * t * (cy + 14) + t * t * (ey + 14);
      const side = (i + si) % 2 === 0 ? -1 : 1;
      const dir = st.deg + 90 + side * 52;
      const len = size * (0.2 - t * 0.07) * (si === 1 ? 0.9 : 1);
      parts.push(leaf(px, py, dir, len, len * 0.5, (i + si) % 3 === 0 ? green2 : green, vein));
    }
    // The stem's tip: a leaf, or a blossom for the blossom family.
    const tipX = ex + 14;
    const tipY = ey + 14;
    if (family === "blossom" && si !== 1) parts.push(blossom(tipX, tipY, size * 0.15, mix(c.accent, "#FFFFFF", 0.25), c.gold, st.deg));
    else parts.push(leaf(tipX, tipY, st.deg + 90, size * 0.17, size * 0.085, green, vein));
  }
  if (family === "blossom") parts.push(blossom(size * 0.2, size * 0.2, size * 0.2, mix(c.gold, "#FFFFFF", 0.3), c.accent, 18));
  if (family === "lotus") parts.push(lotus(size * 0.24, size * 0.24, size * 0.34, mix(c.accent, "#FFFFFF", 0.2), mix(c.gold, "#FFFFFF", 0.25), c.gold, 135));
  // A few berries (dots) in the gold.
  for (const [bx, by] of [
    [0.34, 0.1],
    [0.1, 0.34],
    [0.5, 0.3],
    [0.3, 0.52],
  ] as const) {
    parts.push(`<circle cx="${n(size * bx + 14)}" cy="${n(size * by + 14)}" r="${n(size * 0.022)}" fill="${c.gold}"/>`);
  }
  return parts.join("");
}

/** A column down a side, `width` wide and `h` tall: a gold-edged strip with a stack of pointed-arch niches and diamonds. */
function column(h: number, width: number, x: number, c: DecorColors): string {
  const deep = mix(c.accent, "#000000", 0.18);
  const niche = Math.min(width * 0.8, 70);
  const step = niche * 2.1;
  const count = Math.max(2, Math.floor((h - 120) / step));
  const startY = (h - count * step) / 2 + step / 2;
  const cx = x + width / 2;
  const parts: string[] = [`<rect x="${n(x)}" y="0" width="${n(width)}" height="${n(h)}" fill="${deep}" fill-opacity="0.9"/>`, `<path d="M${n(x + width * 0.1)} 0V${n(h)}M${n(x + width * 0.9)} 0V${n(h)}" stroke="${c.gold}" stroke-width="2.2" stroke-opacity="0.9"/>`];
  for (let i = 0; i < count; i++) {
    const cy = startY + i * step;
    const top = cy - niche * 0.95;
    const bot = cy + niche * 0.95;
    parts.push(
      `<path d="M${n(cx - niche * 0.42)} ${n(bot)}V${n(cy - niche * 0.1)}Q${n(cx - niche * 0.42)} ${n(top + niche * 0.35)} ${n(cx)} ${n(top)}Q${n(cx + niche * 0.42)} ${n(top + niche * 0.35)} ${n(cx + niche * 0.42)} ${n(cy - niche * 0.1)}V${n(bot)}Z" fill="${mix(deep, c.gold, 0.14)}" stroke="${c.gold}" stroke-width="2.4"/>`,
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(niche * 0.13)}" fill="${c.gold}"/>`,
      `<path d="M${n(cx)} ${n(bot + niche * 0.16)}l${n(niche * 0.12)} ${n(niche * 0.12)}l${n(-niche * 0.12)} ${n(niche * 0.12)}l${n(-niche * 0.12)} ${n(-niche * 0.12)}Z" fill="${c.gold}"/>`,
    );
  }
  return parts.join("");
}

export type DecorOptions = {
  w: number;
  h: number;
  family: OrnamentFamily;
  /** How strongly the brand's colours tint the page (0 to 1). */
  wash: number;
  corners: boolean;
  columns: boolean;
  /** A fine lattice of diamonds in the gold across the page, strongest at the edges and fading towards the middle where the words are. */
  pattern: boolean;
  /** Whether the bottom is decorated (the strong wash and the lower corners); false when a bottom scene fills it. */
  bottom: boolean;
  colors: DecorColors;
};

/** The decoration for one flyer, as an SVG document of the flyer's size (units). */
export function decorSvg(o: DecorOptions): string {
  const { w, h, colors: c } = o;
  // Warm at the top (the brand's gold), cooler at the bottom (its main colour): a gradient of the brand, not a flat page.
  const top = mix(c.paper, c.gold, 0.6);
  const bottom = mix(c.paper, c.accent, 0.38);
  const defs =
    `<linearGradient id="wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}" stop-opacity="${n(o.wash)}"/><stop offset="0.42" stop-color="${top}" stop-opacity="${n(o.wash * 0.12)}"/><stop offset="0.62" stop-color="${bottom}" stop-opacity="${n(o.wash * 0.12)}"/><stop offset="1" stop-color="${bottom}" stop-opacity="${n(o.bottom ? o.wash * 0.95 : o.wash * 0.12)}"/></linearGradient>` +
    `<radialGradient id="glow" cx="0.5" cy="0.46" r="0.62"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${n(o.wash * 0.55)}"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`;
  const parts: string[] = [`<rect width="${n(w)}" height="${n(h)}" fill="url(#wash)"/>`, `<rect width="${n(w)}" height="${n(h)}" fill="url(#glow)"/>`];
  if (o.pattern) {
    parts.push(
      `<defs><pattern id="lat" width="84" height="84" patternUnits="userSpaceOnUse"><path d="M42 6L78 42L42 78L6 42Z" fill="none" stroke="${c.gold}" stroke-width="1.6"/><circle cx="42" cy="42" r="4.5" fill="${c.gold}"/><path d="M0 0L7 7M84 0L77 7M0 84L7 77M84 84L77 77" stroke="${c.gold}" stroke-width="1.6"/></pattern>` +
        `<radialGradient id="fadeg" cx="0.5" cy="0.5" r="0.78"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.12"/><stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.45"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="1"/></radialGradient>` +
        `<mask id="latmask"><rect width="${n(w)}" height="${n(h)}" fill="url(#fadeg)"/></mask></defs>` +
        `<rect width="${n(w)}" height="${n(h)}" fill="url(#lat)" fill-opacity="0.34" mask="url(#latmask)"/>`,
    );
  }
  if (o.columns) parts.push(column(h, 92, 0, c), column(h, 92, w - 92, c));
  if (o.corners && o.family !== "none") {
    const size = Math.min(w * 0.215, h * 0.145);
    const cl = cluster(o.family, size, c);
    const small = cluster(o.family, size * 0.82, c);
    parts.push(`<g>${small}</g>`);
    parts.push(`<g transform="translate(${n(w)} 0) scale(-1 1)">${small}</g>`);
    if (o.bottom) {
      parts.push(`<g transform="translate(0 ${n(h)}) scale(1 -1)">${cl}</g>`);
      parts.push(`<g transform="translate(${n(w)} ${n(h)}) scale(-1 -1)">${cl}</g>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}"><defs>${defs}</defs>${parts.join("")}</svg>`;
}
