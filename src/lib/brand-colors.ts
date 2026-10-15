// The Weaver brand kit's colours for code that cannot read a CSS variable: the share image, the home-screen icon, hand-written HTML pages,
// a colour input's default. The values come from src/lib/brand-tokens.generated.ts, which scripts/sync-brand-tokens.mjs writes from
// brand/tokens.json (the one source; the same script writes the stylesheet), so a change to the kit reaches these surfaces without a
// second edit.
//
// A community's own colours (centers.branding) are not here: they are the community's identity, not Weaver's.
import { BRAND_COLORS, BRAND_SHADOWS } from "@/lib/brand-tokens.generated";

export type BrandColorName = keyof typeof BRAND_COLORS;
export type BrandShadowName = keyof typeof BRAND_SHADOWS;

/** One colour of the kit, by its token name ("navy", "ink", "canvas"), as lower-case #rrggbb. */
export function brandColor(name: BrandColorName): string {
  return BRAND_COLORS[name];
}

/** One shadow of the kit, by its token name ("shadow-hero"), as a CSS box-shadow value. */
export function brandShadow(name: BrandShadowName): string {
  return BRAND_SHADOWS[name];
}

/**
 * The colours an organization gets until it chooses its own (Setup › Profile & brand): Weaver's indigo as the primary and its
 * ember as the accent text colour. Anything an organization has saved wins over these.
 */
export const DEFAULT_COMMUNITY_PALETTE = {
  primary: BRAND_COLORS.navy,
  accent: BRAND_COLORS.brown,
  background: BRAND_COLORS.canvas,
} as const;
