// The brand kit as the flyer maker uses it (pure): colours, fonts and logos
// from centers.branding (Setup › Profile & brand), with the Community Connect
// defaults when something is missing or not usable.

import type { Json } from "@/lib/database.types";
import { parseHexColor, publicObjectUrl } from "@/lib/setup";

export type FlyerBrand = {
  primary: string;
  accent: string;
  background: string;
  /** A font family name for headings (a Google Fonts family, or the bundled Fraunces). */
  displayFont: string;
  /** A font family name for body text (a Google Fonts family, or the bundled DM Sans). */
  bodyFont: string;
  /** https URL of the logo for light backgrounds, or null. */
  logoUrl: string | null;
  /** https URL of the logo for dark backgrounds (logo_dark_path), or null. */
  logoDarkUrl: string | null;
};

export const FLYER_BRAND_DEFAULTS = {
  primary: "#1B2C5C",
  accent: "#C9731C",
  background: "#FBF7F0",
  displayFont: "Fraunces",
  bodyFont: "DM Sans",
} as const;

const FONT_NAME = /^[A-Za-z0-9 ]{1,40}$/;

function hex(v: unknown, fallback: string): string {
  if (typeof v !== "string" || !parseHexColor(v)) return fallback;
  return `#${v.trim().replace(/^#/, "").toUpperCase()}`;
}

function fontName(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const name = v.trim().replace(/\s+/g, " ");
  return FONT_NAME.test(name) ? name : fallback;
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^https:\/\/[^\s]+$/i.test(s) ? s : null;
}

/** A brand-kit file in the public branding bucket (<center_id>/…), as its public URL. */
function brandingFile(v: unknown, supabaseUrl: string | null | undefined): string | null {
  if (typeof v !== "string" || !supabaseUrl || !/^https?:\/\//i.test(supabaseUrl)) return null;
  const path = v.trim();
  if (!/^[0-9a-f-]{36}\/[^\s]+$/i.test(path) || path.includes("..")) return null;
  return publicObjectUrl(supabaseUrl, "branding", path);
}

export function readFlyerBrand(branding: Json | null | undefined, supabaseUrl: string | null | undefined): FlyerBrand {
  const b = (branding && typeof branding === "object" && !Array.isArray(branding) ? branding : {}) as Record<string, Json | undefined>;
  return {
    primary: hex(b.primary, FLYER_BRAND_DEFAULTS.primary),
    accent: hex(b.accent, FLYER_BRAND_DEFAULTS.accent),
    background: hex(b.background, FLYER_BRAND_DEFAULTS.background),
    displayFont: fontName(b.display_font, FLYER_BRAND_DEFAULTS.displayFont),
    bodyFont: fontName(b.body_font, FLYER_BRAND_DEFAULTS.bodyFont),
    logoUrl:
      brandingFile(b.logo_path, supabaseUrl) ?? httpsUrl(b.logo_url) ?? brandingFile(b.mark_path, supabaseUrl) ?? httpsUrl(b.mark_url),
    logoDarkUrl: brandingFile(b.logo_dark_path, supabaseUrl) ?? httpsUrl(b.logo_dark_url),
  };
}

/** "Using your brand kit: #1B2C5C / #C9731C · Fraunces + DM Sans · logo" */
export function flyerBrandSummary(brand: FlyerBrand): string {
  const fonts = brand.displayFont === brand.bodyFont ? brand.displayFont : `${brand.displayFont} + ${brand.bodyFont}`;
  return `Using your brand kit: ${brand.primary} / ${brand.accent} · ${fonts} · ${brand.logoUrl ? "logo" : "no logo yet"}`;
}
