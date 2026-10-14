// The Weaver brand kit's two faces for the images Weaver draws itself with next/og (the website's share image).
//
// next/og reads TTF, OTF or WOFF, not the WOFF2 a browser gets, so each face is fetched from Google Fonts with an old browser's
// User-Agent, which makes the stylesheet name a WOFF file (the same technique scripts/brand-logo-pngs.mjs and
// src/lib/events/flyer-fonts.ts use). Bricolage Grotesque is asked at its display size (opsz 96), as the kit's wordmark is.
// A failed fetch never fails the image: it is logged, and the image is drawn in next/og's built-in face instead.
export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" };

const LEGACY_UA = "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.100 Safari/534.30";
const TIMEOUT_MS = 5000;
const MAX_FONT_BYTES = 4 * 1024 * 1024;

/** The family names as the kit spells them (tokens.json "type"): display first, then the text face. */
export const OG_DISPLAY = "Bricolage Grotesque";
export const OG_SANS = "Hanken Grotesk";

async function face(name: string, query: string, weight: OgFont["weight"]): Promise<OgFont | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${query}`, { headers: { "User-Agent": LEGACY_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!css.ok) throw new Error(`Google Fonts answered ${css.status}`);
    const url = /url\((https:[^)]+)\)/.exec(await css.text())?.[1];
    if (!url) throw new Error("the stylesheet names no font file");
    const file = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!file.ok) throw new Error(`the font file answered ${file.status}`);
    const data = await file.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > MAX_FONT_BYTES) throw new Error(`the font file is ${data.byteLength} bytes`);
    return { name, data, weight, style: "normal" };
  } catch (error) {
    console.error(`[brand-og] could not load ${name} ${weight}; the image is drawn in the built-in face instead:`, error);
    return null;
  }
}

let loading: Promise<OgFont[]> | null = null;

/** Bricolage Grotesque 600 and 700 and Hanken Grotesk 600 and 700, loaded once per server process. Empty when none could be loaded. */
export function loadBrandOgFonts(): Promise<OgFont[]> {
  loading ??= Promise.all([
    face(OG_DISPLAY, "Bricolage+Grotesque:opsz,wght@96,600", 600),
    face(OG_DISPLAY, "Bricolage+Grotesque:opsz,wght@96,700", 700),
    face(OG_SANS, "Hanken+Grotesk:wght@600", 600),
    face(OG_SANS, "Hanken+Grotesk:wght@700", 700),
  ]).then((all) => all.filter((f): f is OgFont => f !== null));
  return loading;
}
