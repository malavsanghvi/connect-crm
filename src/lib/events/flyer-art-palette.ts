// The colours flyer ART is drawn in (B96, 2026-10-11): the community's brand kit (primary, secondary, page) made safe for
// art and words, plus "natural" colours that never follow a brand (a flame is orange, a night sky is deep blue, leaves are
// green). Every drawn pack takes an ArtPalette, so a church whose kit is navy and a chamber whose kit is teal each get
// coherent flyers instead of the fixed orange and magenta.
//
// Pure, no imports (the portal, the renderer and the background service can all use it). The contrast rules:
//   ink on paper        at least 7:1 when it can be reached, never under 4.5:1 (body text, WCAG AA)
//   onPrimary/onSecondary on their colour   at least 4.5:1 (words on a band or ribbon)
//   primaryStrong / secondaryStrong on paper   at least 3:1 (shapes that must read, WCAG 1.4.11)
//   primary / secondary on paper   at least 1.6:1, so an ornament never vanishes into the page
// paletteChecks() reports every pair, and the tests hold paletteFromBrand to them for many brand kits.

/** Colours that are the same for every community: what things in nature (and metals) look like. */
export type NaturalColours = {
  /** A candle or lamp flame, its bright core and the warm glow around it. */
  flame: string;
  flameCore: string;
  glow: string;
  /** The sun, a day sky, a dusk sky and a night sky. */
  sun: string;
  skyDay: string;
  skyDusk: string;
  night: string;
  /** Stars and snow. */
  star: string;
  snow: string;
  /** Leaves (light and deep), grass, tree bark. */
  leaf: string;
  leafDeep: string;
  grass: string;
  bark: string;
  /** Stone and water. */
  stone: string;
  water: string;
  /** Flower petals and berries. */
  petal: string;
  berry: string;
  /** Metals for ornament (gold, silver). */
  gold: string;
  silver: string;
};

export const NATURAL_COLOURS: Readonly<NaturalColours> = Object.freeze({
  flame: "#F59E1B",
  flameCore: "#FFE28A",
  glow: "#FFD27A",
  sun: "#F7C948",
  skyDay: "#CFE3F5",
  skyDusk: "#F3C6A5",
  night: "#1C2448",
  star: "#FFF4C2",
  snow: "#FFFFFF",
  leaf: "#5E9C55",
  leafDeep: "#2F5E34",
  grass: "#7DB46C",
  bark: "#6B4A2E",
  stone: "#D9D3C7",
  water: "#7FB3D5",
  petal: "#F2B8C6",
  berry: "#B3263E",
  gold: "#C9A227",
  silver: "#B8BEC6",
});

export type ArtPalette = {
  /** The brand's main colour for ornament and large shapes (stepped away from the page when it would vanish into it). */
  primary: string;
  /** The brand's second colour (the kit's accent) for accents; gold when the kit's two colours are too alike. */
  secondary: string;
  /** Words on the page: at least 7:1 on `paper` when reachable, never under 4.5:1. */
  ink: string;
  /** The page behind the words (the kit's background). */
  paper: string;
  /** True when the page is dark (a navy kit page): drawn art then uses light strokes and glows. */
  darkPaper: boolean;
  /** Lighter and deeper steps of the two brand colours, for fills, shading and gradients. */
  primaryLight: string;
  primaryDeep: string;
  secondaryLight: string;
  secondaryDeep: string;
  /** The brand colours stepped until they read at 3:1 on the paper: shapes that must be seen (silhouettes, icons). */
  primaryStrong: string;
  secondaryStrong: string;
  /** Words on a band of `primary` / `secondary`: at least 4.5:1. */
  onPrimary: string;
  onSecondary: string;
  /** A soft panel colour behind words laid over busy art (the paper, ready to be drawn semi-transparent). */
  scrim: string;
  /** Fixed natural colours: flames, skies, leaves, metals. */
  natural: NaturalColours;
};

/** What paletteFromBrand reads: the brand kit's three colours (FlyerBrand has them; `accent` is the secondary colour). */
export type BrandColours = { primary: string; accent: string; background: string };

/** The Weaver defaults, the same as FLYER_BRAND_DEFAULTS in flyer-brand.ts (a test keeps them equal). */
export const ART_PALETTE_DEFAULTS: Readonly<BrandColours> = Object.freeze({ primary: "#1B2C5C", accent: "#C9731C", background: "#FBF7F0" });

// ── Colour arithmetic (WCAG 2.1) ─────────────────────────────────────────────

const HEX6 = /^#?([0-9a-f]{6})$/i;

/** "#1b2c5c" / "1B2C5C" → "#1B2C5C"; anything else → null. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = HEX6.exec(v.trim());
  return m ? `#${m[1]!.toUpperCase()}` : null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt((normalizeHex(hex) ?? "#000000").slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG contrast ratio of two colours, 1 to 21 (two decimals). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Mix two colours: t = 0 is `a`, 1 is `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * Math.min(1, Math.max(0, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export const tint = (c: string, t: number) => mixHex(c, "#FFFFFF", t);
export const shade = (c: string, t: number) => mixHex(c, "#000000", t);

/** True when white reads better than near-black on `bg`. */
export function isDark(bg: string): boolean {
  return contrast("#FFFFFF", bg) >= contrast("#1D1A16", bg);
}

/**
 * `preferred` when it reaches `min`:1 on `bg`; else the first step of it toward black (on a light page) or white (on a
 * dark one) that does; else near-black or white, whichever reads better. The result always reaches `min` when `min` <= 4.5.
 */
export function readableOn(preferred: string, bg: string, min: number): string {
  if (contrast(preferred, bg) >= min) return preferred;
  const toward = isDark(bg) ? "#FFFFFF" : "#000000";
  for (let step = 1; step <= 10; step++) {
    const c = mixHex(preferred, toward, step / 10);
    if (contrast(c, bg) >= min) return c;
  }
  // Pure white or black reaches at least 4.58:1 on any colour; past that, the better of the two.
  return contrast("#FFFFFF", bg) >= contrast("#000000", bg) ? "#FFFFFF" : "#000000";
}

// ── The palette ──────────────────────────────────────────────────────────────

/** The brand kit as art colours, every pair checked (see the top of this file). Invalid colours take the Weaver defaults. */
export function paletteFromBrand(brand: Partial<BrandColours> | null | undefined): ArtPalette {
  const paper = normalizeHex(brand?.background) ?? ART_PALETTE_DEFAULTS.background;
  const rawPrimary = normalizeHex(brand?.primary) ?? ART_PALETTE_DEFAULTS.primary;
  const rawSecondary = normalizeHex(brand?.accent) ?? ART_PALETTE_DEFAULTS.accent;
  const darkPaper = isDark(paper);

  const primary = readableOn(rawPrimary, paper, 1.6);
  // Two brand colours that are nearly the same (or the same) would make one-colour art: the second becomes gold.
  const secondary = readableOn(contrast(rawSecondary, primary) < 1.25 ? NATURAL_COLOURS.gold : rawSecondary, paper, 1.6);

  const inkTarget = readableOn(rawPrimary, paper, 7);
  const ink = contrast(inkTarget, paper) >= 4.5 ? inkTarget : readableOn(rawPrimary, paper, 4.5);

  return {
    primary,
    secondary,
    ink,
    paper,
    darkPaper,
    primaryLight: tint(primary, 0.55),
    primaryDeep: shade(primary, 0.35),
    secondaryLight: tint(secondary, 0.55),
    secondaryDeep: shade(secondary, 0.35),
    primaryStrong: readableOn(primary, paper, 3),
    secondaryStrong: readableOn(secondary, paper, 3),
    onPrimary: readableOn(paper, primary, 4.5),
    onSecondary: readableOn(paper, secondary, 4.5),
    scrim: paper,
    natural: { ...NATURAL_COLOURS },
  };
}

export type PaletteCheck = { pair: string; ratio: number; min: number; ok: boolean };

/** Every contrast rule of an ArtPalette, with its ratio: a test (and a pack author) can see which pair fails. */
export function paletteChecks(p: ArtPalette): PaletteCheck[] {
  const check = (pair: string, a: string, b: string, min: number): PaletteCheck => {
    const ratio = contrast(a, b);
    return { pair, ratio, min, ok: ratio >= min };
  };
  return [
    check("ink on paper", p.ink, p.paper, 4.5),
    check("onPrimary on primary", p.onPrimary, p.primary, 4.5),
    check("onSecondary on secondary", p.onSecondary, p.secondary, 4.5),
    check("primaryStrong on paper", p.primaryStrong, p.paper, 3),
    check("secondaryStrong on paper", p.secondaryStrong, p.paper, 3),
    check("primary on paper", p.primary, p.paper, 1.6),
    check("secondary on paper", p.secondary, p.paper, 1.6),
  ];
}

/** The pairs that fail (empty for every palette paletteFromBrand makes). */
export function paletteProblems(p: ArtPalette): string[] {
  return paletteChecks(p)
    .filter((c) => !c.ok)
    .map((c) => `${c.pair}: ${c.ratio}:1, needs ${c.min}:1`);
}
