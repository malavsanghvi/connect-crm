// The look of the draft: colours, fonts, logo and layout hints.
//   * The organization's own website decides first (its main colours, fonts and logo).
//   * A website the organization likes is only a HINT: it is used for a part the old website did not give (for example the
//     colours), and the draft says so (theme.from).
//   * Colours are checked for reading comfort (WCAG contrast, 4.5 to 1 for text) and adjusted when they would not read well.

import type { OwnCrawl, PaletteEntry, ReferenceHints } from "./crawl";
import type { Density, HeroStyleName, Img, SiteTheme } from "./types";

/** Weaver's own plain colours, used when neither the old website nor a website the organization likes gave any. */
export const DEFAULT_PALETTE = { primary: "#1b2c5c", secondary: "#5b6b8c", accent: "#9a4a14", background: "#ffffff", text: "#1b1f23" } as const;

const LOGO_SOURCES = ["header-image", "named-logo", "json-ld", "apple-touch-icon"];

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function luminance(hexColor: string): number {
  const n = parseInt(hexColor.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#ffffff";
const INK = "#111827";
/** White or near-black, whichever reads better on this colour. */
export const readableOn = (color: string): string => (contrast(WHITE, color) >= contrast(INK, color) ? WHITE : INK);

const roleColor = (entries: readonly PaletteEntry[], role: PaletteEntry["role"]): string | null => entries.find((e) => e.role === role)?.hex ?? null;

/** Text that reads on this background: a colour of the palette when one does, else Weaver's ink (or white on a dark page). */
function textFor(background: string, candidates: (string | null)[]): string {
  for (const c of candidates) if (c && contrast(c, background) >= 4.5) return c;
  return contrast(DEFAULT_PALETTE.text, background) >= contrast(WHITE, background) ? DEFAULT_PALETTE.text : WHITE;
}

export function buildTheme(input: { own: OwnCrawl | null; references: readonly ReferenceHints[]; patternSource: "own_site" | "reference_hint" | "default"; heroImage: boolean }): SiteTheme {
  const { own } = input;
  const ownHas = (own?.palette ?? []).some((p) => p.role === "primary");
  const refWith = input.references.find((r) => r.palette.some((p) => p.role === "primary"));
  const entries: readonly PaletteEntry[] = ownHas ? own!.palette : refWith ? refWith.palette : [];
  const paletteFrom: SiteTheme["from"]["palette"] = ownHas ? "own_site" : refWith ? "reference_hint" : "default";

  const primary = roleColor(entries, "primary") ?? DEFAULT_PALETTE.primary;
  const secondary = roleColor(entries, "secondary") ?? DEFAULT_PALETTE.secondary;
  const accent = roleColor(entries, "accent") ?? DEFAULT_PALETTE.accent;
  const background = roleColor(entries, "background") ?? DEFAULT_PALETTE.background;
  const text = textFor(background, [roleColor(entries, "text"), roleColor(entries, "accent"), roleColor(entries, "primary")]);

  const ownFonts = own?.fonts ?? { heading: null, body: null };
  const refFonts = input.references.find((r) => r.fonts.heading || r.fonts.body)?.fonts ?? { heading: null, body: null };
  const ownFontsGiven = ownFonts.heading !== null || ownFonts.body !== null;
  const fonts = ownFontsGiven ? ownFonts : refFonts;
  const fontsFrom: SiteTheme["from"]["fonts"] = ownFontsGiven ? "own_site" : fonts.heading || fonts.body ? "reference_hint" : "default";

  const logo = own?.logos.find((l) => LOGO_SOURCES.includes(l.source)) ?? null;
  const logoImg: Img | null = logo ? { src: logo.url, alt: logo.alt || "Logo" } : null;

  const refHero = input.references.find((r) => r.heroStyle)?.heroStyle ?? null;
  const heroStyle: HeroStyleName = own?.heroStyle ?? refHero ?? (input.heroImage ? "image" : "text");
  const refDensity = input.references.find((r) => r.density)?.density ?? null;
  const density: Density = refDensity ?? "medium";

  return {
    palette: { primary, secondary, accent, background, text, on_primary: readableOn(primary) },
    fonts: { heading: fonts.heading, body: fonts.body },
    logo: logoImg,
    hero_style: heroStyle,
    density,
    from: { palette: paletteFrom, fonts: fontsFrom, layout: input.patternSource, logo: logoImg ? "own_site" : "none" },
  };
}
