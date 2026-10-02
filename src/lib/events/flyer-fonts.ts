// Fonts for the flyer renderer — server side only (node:fs and the network).
// Not marked `server-only` so the render tests can import it; no client
// component imports it.
//
// next/og (satori) reads TTF, OTF or WOFF — not the WOFF2 the portal serves
// browsers — so the brand-kit defaults are vendored as static WOFF files in
// assets/flyer-fonts/ (SIL OFL 1.1, see its README). They are read once at
// module scope, as the Next docs show; a missing file is kept as a value so
// the organizer gets a plain sentence instead of a crashed route.
//
// Any other brand font (centers.branding.display_font / body_font) and
// Gujarati (Noto Sans Gujarati) come from Google Fonts — free, every family
// there is OFL or Apache licensed — fetched with a legacy User-Agent so the
// CSS points at TTF files, the technique next/og itself uses for its own
// language fallbacks (it already covers Devanagari, not Gujarati). Results
// are cached in memory; a failed fetch falls back to the bundled pair and
// says so in a note.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type FlyerFont = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" };

export class FlyerFontsMissingError extends Error {
  constructor(cause?: unknown) {
    super("The flyer fonts are missing on this server.");
    this.name = "FlyerFontsMissingError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export const BUNDLED_DISPLAY = "Fraunces";
export const BUNDLED_BODY = "DM Sans";

export const BUNDLED_FONT_FILES = [
  { name: BUNDLED_BODY, weight: 400, file: "DMSans-400.woff" },
  { name: BUNDLED_BODY, weight: 700, file: "DMSans-700.woff" },
  { name: BUNDLED_DISPLAY, weight: 600, file: "Fraunces-600.woff" },
  { name: BUNDLED_DISPLAY, weight: 700, file: "Fraunces-700.woff" },
] as const;

export function flyerFontPath(file: string): string {
  return join(process.cwd(), "assets/flyer-fonts", file);
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const bundled: Promise<FlyerFont[] | Error> = Promise.all(
  BUNDLED_FONT_FILES.map(async (f) => ({ name: f.name, weight: f.weight, style: "normal" as const, data: toArrayBuffer(await readFile(flyerFontPath(f.file))) })),
).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))));

// ── Google Fonts ─────────────────────────────────────────────────────────────
const LEGACY_UA = "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";
const TIMEOUT_MS = 5000;
const MAX_FONT_BYTES = 8 * 1024 * 1024;
const FAILURE_TTL_MS = 10 * 60 * 1000;

type Cached = { at: number; fonts: FlyerFont[] | null };
const googleCache = new Map<string, Promise<Cached>>();

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, { headers: { "User-Agent": LEGACY_UA }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" };
}

/** Parse Google's CSS for (weight, TTF/OTF url) pairs on fonts.gstatic.com. */
export function parseGoogleFontCss(css: string): { weight: number; url: string }[] {
  const out: { weight: number; url: string }[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const weight = Number(/font-weight:\s*(\d{3})/.exec(block)?.[1] ?? "400");
    const src = /src:\s*url\(([^)\s]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/.exec(block)?.[1];
    if (src && /^https:\/\/fonts\.gstatic\.com\//.test(src)) out.push({ weight, url: src });
  }
  return out;
}

async function loadGoogle(family: string, weights: readonly (400 | 600 | 700)[]): Promise<FlyerFont[]> {
  const fam = encodeURIComponent(family).replace(/%20/g, "+");
  let css = await fetchText(`https://fonts.googleapis.com/css2?family=${fam}:wght@${weights.join(";")}&display=swap`);
  // A family without every weight answers 400; take whatever it has.
  if (!css.ok && css.status === 400) css = await fetchText(`https://fonts.googleapis.com/css2?family=${fam}&display=swap`);
  if (!css.ok) throw new Error(`Google Fonts answered ${css.status} for ${family}`);
  const faces = parseGoogleFontCss(css.text);
  if (!faces.length) throw new Error(`Google Fonts sent no TTF for ${family}`);
  const seen = new Set<number>();
  const fonts: FlyerFont[] = [];
  for (const face of faces) {
    if (seen.has(face.weight)) continue;
    seen.add(face.weight);
    const res = await fetch(face.url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
    if (!res.ok) throw new Error(`fonts.gstatic.com answered ${res.status} for ${family}`);
    const data = await res.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > MAX_FONT_BYTES) throw new Error(`the ${family} font file was empty or too large`);
    const weight = face.weight >= 650 ? 700 : face.weight >= 550 ? 600 : 400;
    fonts.push({ name: family, data, weight, style: "normal" });
  }
  return fonts;
}

/** One Google Fonts family, cached for the life of the server (a failure is retried after ten minutes). */
async function googleFamily(family: string, weights: readonly (400 | 600 | 700)[]): Promise<FlyerFont[] | null> {
  const key = `${family}|${weights.join(",")}`;
  const hit = googleCache.get(key);
  if (hit) {
    const c = await hit;
    if (c.fonts || Date.now() - c.at < FAILURE_TTL_MS) return c.fonts;
  }
  const p = loadGoogle(family, weights).then(
    (fonts): Cached => ({ at: Date.now(), fonts }),
    (err: unknown): Cached => {
      console.error(`[events/flyer] could not load the font "${family}" from Google Fonts:`, err);
      return { at: Date.now(), fonts: null };
    },
  );
  googleCache.set(key, p);
  return (await p).fonts;
}

// ── What a flyer needs ───────────────────────────────────────────────────────
const GUJARATI = /[઀-૿]/;
const DEVANAGARI = /[ऀ-ॿ]/;

export type FlyerFontSet = { fonts: FlyerFont[]; display: string; body: string; notes: string[] };

/**
 * The fonts for one flyer: the bundled pair, the brand's own fonts when they
 * are not the bundled ones (falling back with a note), and Noto Sans Gujarati
 * when the words contain Gujarati. Throws FlyerFontsMissingError when the
 * bundled files are not on this server.
 */
export async function getFlyerFonts(brand: { displayFont: string; bodyFont: string }, text: string): Promise<FlyerFontSet> {
  const base = await bundled;
  if (base instanceof Error) {
    console.error("[events/flyer] the bundled flyer fonts could not be read:", base);
    throw new FlyerFontsMissingError(base);
  }
  const isBundled = (name: string) => name === BUNDLED_DISPLAY || name === BUNDLED_BODY;
  const wantDisplay = brand.displayFont.trim() || BUNDLED_DISPLAY;
  const wantBody = brand.bodyFont.trim() || BUNDLED_BODY;

  // Every Google family this flyer needs, with the weights it uses (one request per family).
  const needed = new Map<string, Set<400 | 600 | 700>>();
  const need = (name: string, weights: (400 | 600 | 700)[]) => {
    if (isBundled(name)) return;
    const set = needed.get(name) ?? new Set();
    for (const w of weights) set.add(w);
    needed.set(name, set);
  };
  need(wantDisplay, [600, 700]);
  need(wantBody, [400, 700]);
  if (GUJARATI.test(text)) need("Noto Sans Gujarati", [400, 700]);
  const loaded = new Map<string, FlyerFont[] | null>(
    await Promise.all([...needed].map(async ([name, w]) => [name, await googleFamily(name, [...w].sort((a, b) => a - b))] as const)),
  );

  const fonts: FlyerFont[] = [...base];
  const notes: string[] = [];
  const pick = (want: string, fallback: string): string => {
    if (isBundled(want)) return want;
    if (loaded.get(want)) return want;
    notes.push(`Your brand font ‘${want}’ could not be loaded, so ${fallback} was used.`);
    return fallback;
  };
  const display = pick(wantDisplay, BUNDLED_DISPLAY);
  const body = pick(wantBody, BUNDLED_BODY);
  for (const [name, list] of loaded) {
    if (list && name !== "Noto Sans Gujarati") fonts.push(...list);
  }
  // Gujarati last: satori falls back through the fonts in order for letters the chosen family lacks.
  if (loaded.has("Noto Sans Gujarati")) {
    const guj = loaded.get("Noto Sans Gujarati");
    if (guj) fonts.push(...guj);
    else notes.push("The Gujarati font could not be loaded, so Gujarati letters may be missing — check the preview.");
  }
  if (GUJARATI.test(text) || DEVANAGARI.test(text)) {
    notes.push("Gujarati and Hindi letters may not join exactly right in the image — check the preview.");
  }
  return { fonts, display, body, notes: [...new Set(notes)] };
}
