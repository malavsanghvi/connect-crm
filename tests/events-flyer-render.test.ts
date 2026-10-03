import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

import { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { FLYER_LIMITS, FLYER_SIZE_KEYS, FLYER_TEMPLATES, POSTER_AGENDA_MAX, POSTER_LIMITS, type FlyerDesign, type FlyerSize, type FlyerTemplate, type PosterContent } from "@/lib/events/flyer";
import { FLYER_OCCASIONS, type FlyerOccasion } from "@/lib/events/flyer-art";
import { artPack } from "@/lib/events/flyer-art-packs";
import { readFlyerBrand } from "@/lib/events/flyer-brand";
import { BUNDLED_FONT_FILES, flyerFontPath, getFlyerFonts } from "@/lib/events/flyer-fonts";
import { POSTER_ICONS } from "@/lib/events/flyer-icons";
import { patternSvg } from "@/lib/events/flyer-patterns";
import { POSTER_UNITS, planPoster } from "@/lib/events/flyer-poster";
import {
  backgroundBox,
  flyerDims,
  flyerElement,
  flyerText,
  isPng,
  pictureMinHeight,
  renderFlyerPdf,
  renderFlyerPng,
  type FlyerDims,
  type FlyerRenderInput,
} from "@/lib/events/flyer-render";

const brand = readFlyerBrand(null, undefined);
const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const pattern = { dataUri: svgUri(patternSvg("mandala", { w: 216, h: 270, ...brand })), w: 216, h: 270 };
const logo = {
  dataUri: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60"><rect width="200" height="60" rx="8" fill="#7A2E1F"/></svg>'),
  w: 200,
  h: 60,
};

const design = (over: Partial<FlyerDesign> = {}): FlyerDesign => ({
  v: 1,
  template: "classic",
  size: "post",
  headline: "Diwali Mela",
  tagline: "An evening of lights, food and garba.",
  date_line: "Sat, Nov 8 · 6:00 PM–9:00 PM",
  venue_line: "Main hall",
  show_qr: true,
  background: { source: "pattern", pattern: "mandala" },
  ...over,
});

const input = (over: Partial<FlyerRenderInput> = {}): FlyerRenderInput => ({
  design: design(),
  brand,
  centerName: "Jain Society of Houston",
  background: pattern,
  logo,
  logoDark: null,
  qrLink: "https://app.example.org/e/22222222-2222-4222-8222-222222222222",
  ...over,
});

/** Every image src in the element tree (to see whether the QR code was drawn). */
function imageSources(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) imageSources(n, out);
    return out;
  }
  const el = node as { type?: unknown; props?: { src?: unknown; children?: unknown; img?: unknown } };
  if (el.type === "img" && typeof el.props?.src === "string") out.push(el.props.src);
  if (typeof el.type === "function") {
    imageSources((el.type as (p: unknown) => unknown)(el.props), out);
    return out;
  }
  imageSources(el.props?.children, out);
  return out;
}

describe("bundled flyer fonts", () => {
  it("are on disk and are WOFF files satori can read", async () => {
    for (const f of BUNDLED_FONT_FILES) {
      const bytes = await readFile(flyerFontPath(f.file));
      expect(bytes.subarray(0, 4).toString("latin1"), f.file).toBe("wOFF");
    }
  });
});

describe("flyer sizes", () => {
  it("previews Post and Story at half size and Print at a quarter", () => {
    expect(flyerDims("post", "preview")).toEqual({ w: 540, h: 675 });
    expect(flyerDims("story", "full")).toEqual({ w: 1080, h: 1920 });
    expect(flyerDims("print", "preview")).toEqual({ w: 638, h: 825 });
    expect(flyerDims("print", "full")).toEqual({ w: 2550, h: 3300 });
    expect(backgroundBox("classic", { w: 1080, h: 1350 })).toEqual({ w: 1080, h: 743 });
  });
});

describe("flyerElement", () => {
  it("draws the QR code only when there is a link and the organizer wants it", () => {
    const qr = "data:image/png;base64,QR";
    expect(imageSources(flyerElement(input(), { w: 216, h: 270 }, { display: "Fraunces", body: "DM Sans" }, qr))).toContain(qr);
    expect(imageSources(flyerElement(input(), { w: 216, h: 270 }, { display: "Fraunces", body: "DM Sans" }, null))).not.toContain(qr);
    expect(imageSources(flyerElement(input({ design: design({ show_qr: false }) }), { w: 216, h: 270 }, { display: "Fraunces", body: "DM Sans" }, qr))).not.toContain(qr);
  });
});

describe("renderFlyerPng", () => {
  for (const template of FLYER_TEMPLATES) {
    it(`renders the ${template} template to a PNG`, async () => {
      const r = await renderFlyerPng(input({ design: design({ template, background: template === "photo" ? { source: "photo", photo_id: "33333333-3333-4333-8333-333333333333" } : { source: "pattern", pattern: "mandala" } }) }), "preview", {
        w: 216,
        h: 270,
      });
      expect(isPng(r.png)).toBe(true);
      expect(r.dims).toEqual({ w: 216, h: 270 });
      expect(r.notes).toEqual([]);
    }, 30_000);
  }

  it("says so when the organizer wants a QR code but there is no link", async () => {
    const r = await renderFlyerPng(input({ qrLink: null, background: null, logo: null }), "preview", { w: 108, h: 135 });
    expect(isPng(r.png)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/no QR code/);
  }, 30_000);
});

describe("renderFlyerPdf", () => {
  it("wraps the print PNG in a one-page PDF", async () => {
    const { png } = await renderFlyerPng(input({ design: design({ size: "print" }) }), "preview", { w: 85, h: 110 });
    const pdf = await renderFlyerPdf(png, "Diwali Mela");
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(png.length);
  }, 30_000);
});

// ── Nothing is cut off ───────────────────────────────────────────────────────
// Satori does not shrink a box unless told to, so long words used to push the
// QR code and the centre's name past the bottom edge. Each flyer is drawn on a
// magenta stage a quarter of its size larger on every side: anything drawn on
// the stage is outside the flyer, i.e. cut off in the real image. The picture
// in Classic and in Minimal's photo corner is a plain green photo, so words
// drawn over it show up as pixels that are not green.

/** RGBA pixels of an 8-bit, non-interlaced RGB or RGBA PNG (what next/og writes). */
function decodePng(png: Uint8Array): { w: number; h: number; px: Uint8Array } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (at + 8 <= png.length) {
    const len = dv.getUint32(at);
    const kind = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (kind === "IHDR") {
      w = dv.getUint32(at + 8);
      h = dv.getUint32(at + 12);
      depth = png[at + 16];
      type = png[at + 17];
      interlace = png[at + 20];
    } else if (kind === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
    else if (kind === "IEND") break;
    at += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) throw new Error(`unexpected PNG format (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      px.set([cur[x * bpp], cur[x * bpp + 1], cur[x * bpp + 2], bpp === 4 ? cur[x * bpp + 3] : 255], (y * w + x) * 4);
    }
    prev = cur;
  }
  return { w, h, px };
}

type Pixels = { w: number; h: number; px: Uint8Array };
const STAGE = [255, 0, 255] as const;
const GREEN = [0, 255, 0] as const;
const solid = (rgb: readonly number[], w: number, h: number) => ({
  dataUri: svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="rgb(${rgb.join(",")})"/></svg>`),
  w,
  h,
});

type Words = Pick<FlyerDesign, "headline" | "tagline" | "date_line" | "venue_line">;

/** Every field at its limit, in ordinary words (so they wrap like real text). */
function longest(headline = "Paryushan Mahaparva Pratikraman and Samvatsari Celebration for the Whole Jain Community"): Words {
  const fill = (s: string, n: number) => `${s} ${"and more ".repeat(40)}`.slice(0, n).trimEnd();
  return {
    headline: fill(headline, FLYER_LIMITS.headline),
    tagline: fill(
      "Join us for eight days of reflection, swadhyay, pratikraman and community meals, with special programmes for young families, seniors and first-time visitors from every centre.",
      FLYER_LIMITS.tagline,
    ),
    date_line: fill("Thursday, September 10 – Thursday, September 17, 2026 · 6:00 PM–9:30 PM each evening", FLYER_LIMITS.date_line),
    venue_line: fill("Jain Society of Greater Houston Main Prayer Hall and Community Centre, 3905 Arc Street, Sugar Land, Texas", FLYER_LIMITS.venue_line),
  };
}

/** The flyer drawn on a magenta stage with a quarter of its size free on every side. */
async function renderOnStage(inp: FlyerRenderInput, dims: FlyerDims): Promise<{ img: Pixels; mx: number; my: number }> {
  const set = await getFlyerFonts(inp.brand, flyerText(inp), { poster: inp.design.template === "poster" });
  const qr = inp.qrLink ? await QRCode.toDataURL(inp.qrLink, { errorCorrectionLevel: "M", margin: 1, width: Math.round((220 * dims.w) / 1080) }) : null;
  const mx = Math.round(dims.w / 4);
  const my = Math.round(dims.h / 4);
  const stage = createElement(
    "div",
    { style: { display: "flex", width: dims.w + 2 * mx, height: dims.h + 2 * my, padding: `${my}px ${mx}px`, backgroundColor: `rgb(${STAGE.join(",")})` } },
    flyerElement(inp, dims, { display: set.display, body: set.body }, qr),
  );
  const res = new ImageResponse(stage, { width: dims.w + 2 * mx, height: dims.h + 2 * my, fonts: set.fonts });
  return { img: decodePng(new Uint8Array(await res.arrayBuffer())), mx, my };
}

function pixel(img: Pixels, x: number, y: number): [number, number, number] {
  const i = (y * img.w + x) * 4;
  return [img.px[i], img.px[i + 1], img.px[i + 2]];
}
const near = (p: readonly number[], q: readonly number[]) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) <= 12;

/** How many stage pixels outside the flyer were drawn on, and where the first one is. */
function drawnOutside(img: Pixels, mx: number, my: number, dims: FlyerDims): { count: number; first: string | null } {
  let count = 0;
  let first: string | null = null;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (x >= mx && x < mx + dims.w && y >= my && y < my + dims.h) continue;
      if (!near(pixel(img, x, y), STAGE)) {
        count++;
        first ??= `${x < mx ? "left of" : x >= mx + dims.w ? "right of" : y < my ? "above" : "below"} the flyer, at (${x - mx}, ${y - my})`;
      }
    }
  }
  return { count, first };
}

/** The green picture's height inside the flyer, and how many pixels inside it are not green (words drawn over it). */
function pictureBox(img: Pixels, mx: number, my: number, dims: FlyerDims, roundedBottomLeft: number): { h: number; covered: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = my; y < my + dims.h; y++) {
    for (let x = mx; x < mx + dims.w; x++) {
      if (!near(pixel(img, x, y), GREEN)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return { h: 0, covered: 0 };
  let covered = 0;
  // The inside of the box, two pixels in from its edges (anti-aliasing), less the rounded corner.
  for (let y = y0 + 2; y <= y1 - 2; y++) {
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      if (roundedBottomLeft && x - x0 < roundedBottomLeft && y1 - y < roundedBottomLeft) continue;
      if (!near(pixel(img, x, y), GREEN)) covered++;
    }
  }
  return { h: y1 - y0 + 1, covered };
}

const stageCases: { template: FlyerTemplate; source: "photo" | "pattern" }[] = [
  { template: "classic", source: "photo" },
  { template: "festival", source: "pattern" },
  { template: "minimal", source: "photo" },
  { template: "minimal", source: "pattern" },
  { template: "photo", source: "photo" },
];

async function expectFits(template: FlyerTemplate, source: "photo" | "pattern", size: FlyerSize, words: Words, scale: "preview" | "full" = "preview") {
  const dims = flyerDims(size, scale);
  const box = backgroundBox(template, dims);
  const background = source === "photo" ? solid(GREEN, box.w, box.h) : { dataUri: svgUri(patternSvg("mandala", { w: box.w, h: box.h, ...brand })), w: box.w, h: box.h };
  const d = design({
    template,
    size,
    ...words,
    background: source === "photo" ? { source: "photo", photo_id: "33333333-3333-4333-8333-333333333333" } : { source: "pattern", pattern: "mandala" },
  });
  // Classic draws the logo over its picture on purpose; every other template keeps it beside the words.
  const { img, mx, my } = await renderOnStage(input({ design: d, background, logo: template === "classic" ? null : logo }), dims);
  const outside = drawnOutside(img, mx, my, dims);
  expect(outside.count, `${template} ${size}: something is drawn ${outside.first}`).toBe(0);
  if (source === "photo" && (template === "classic" || template === "minimal")) {
    const pic = pictureBox(img, mx, my, dims, template === "minimal" ? Math.ceil((48 * dims.w) / 1080) + 2 : 0);
    expect(pic.h, `${template} ${size}: the picture keeps at least its smallest height`).toBeGreaterThanOrEqual(pictureMinHeight(template, dims) - 2);
    expect(pic.covered, `${template} ${size}: words are drawn over the picture`).toBe(0);
  }
}

describe("flyer layout: nothing is cut off, nothing is drawn over the picture", () => {
  for (const { template, source } of stageCases) {
    for (const size of FLYER_SIZE_KEYS) {
      it(`${template} (${source}) at ${size} size with every field at its longest`, async () => {
        await expectFits(template, source, size, longest());
      }, 60_000);
    }
    it(`${template} (${source}) with an ALL-CAPS headline at its longest`, async () => {
      await expectFits(template, source, "post", longest("PARYUSHAN MAHAPARVA PRATIKRAMAN AND SAMVATSARI CELEBRATION FOR THE WHOLE JAIN COMMUNITY"));
    }, 60_000);
    it(`${template} (${source}) at full Post size (what "Use this flyer" saves) with every field at its longest`, async () => {
      await expectFits(template, source, "post", longest(), "full");
    }, 60_000);
    it(`${template} (${source}) with ordinary words`, async () => {
      await expectFits(template, source, "post", {
        headline: "Diwali Mela & Annakut",
        tagline: "Celebrate the festival of lights with the whole community: an evening of aarti, garba, a children's rangoli contest and a shared vegetarian dinner.",
        date_line: "Sat, Nov 8 · 6:00 PM–9:30 PM",
        venue_line: "JSGH Community Hall, 3905 Arc Street, Sugar Land",
      });
    }, 60_000);
  }
});

// ── The Poster template (Flyers v2) ──────────────────────────────────────────
// The same magenta stage: every poster is drawn on it with a quarter of its size free on every side, so anything the
// poster pushes out of the picture (a footer shoved down by a long agenda) shows up as pixels on the stage.

const GREEN_RGB = [0, 255, 0] as const;
const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Every field at its limit, in ordinary words (so they wrap like real text). */
function fullPoster(occasion: FlyerOccasion, over: Partial<PosterContent> = {}): PosterContent {
  const fill = (s: string, n: number) => `${s} ${"and more ".repeat(40)}`.slice(0, n).trimEnd();
  return {
    occasion,
    frame: { source: "code" },
    scene: { source: "code" },
    logo: true,
    partner: { on: true, label: "PARTNERLOG", sub: "20272027", logo_path: null },
    subhead: fill("Houston Host City Kick-Off Celebration", POSTER_LIMITS.subhead),
    slogan: fill("Let's make our whole community proud together", POSTER_LIMITS.slogan),
    stat: { on: true, icon: "people", label: fill("More than", POSTER_LIMITS.stat_label), value: "100K+", caption: fill("Of convention registrations are filled so far this year", POSTER_LIMITS.stat_caption) },
    ribbon: { on: true, date: fill("Thursday, Sept 10 – Thursday, Sept 17", POSTER_LIMITS.ribbon_date), time: fill("6:00 PM–9:30 PM each evening of the week", POSTER_LIMITS.ribbon_time) },
    agenda: Array.from({ length: POSTER_AGENDA_MAX }, (_, i) => ({
      icon: POSTER_ICONS[i]!,
      time: fill("5:00–6:00 PM onwards", POSTER_LIMITS.agenda_time),
      text: fill("Convention kick-off and meet and greet with the leaders", POSTER_LIMITS.agenda_text),
    })),
    paragraph: fill("Connect with Jains nationwide and help our community reach more families worldwide.", POSTER_LIMITS.paragraph),
    footer: fill("JAINA 2027 Host City Team and volunteers", POSTER_LIMITS.footer),
    ...over,
  };
}

/** The reference poster: the owner's JAINA 2027 Houston Host City Kick-Off. */
function jainaPoster(over: Partial<PosterContent> = {}): PosterContent {
  return {
    occasion: "convention",
    frame: { source: "code" },
    scene: { source: "code" },
    logo: true,
    partner: { on: true, label: "JAINA", sub: "2027", logo_path: null },
    subhead: "HOUSTON HOST CITY KICK-OFF",
    slogan: "LET'S MAKE JSH PROUD!",
    stat: { on: true, icon: "people", label: "MORE THAN", value: "80%", caption: "OF CONVENTION REGISTRATIONS ARE FILLED!" },
    ribbon: { on: true, date: "Saturday, October 3, 2026", time: "5:00 PM onwards" },
    agenda: [
      { icon: "clock", time: "5:00–6:00 PM", text: "Convention Kick-Off & Meet and Greet with JAINA Leaders" },
      { icon: "dinner", time: "6:00 PM onwards", text: "Dinner & Fellowship" },
      { icon: "dancers", time: "After Dinner", text: "Garba Night!" },
    ],
    paragraph: "Connect with Jains nationwide. Be part of 60+ teams across the country. Help JSH reach 100K+ Jains worldwide.",
    footer: "JAINA 2027 Host City Team",
    ...over,
  };
}

const posterOff: Partial<PosterContent> = {
  logo: false,
  partner: { on: false, label: "", sub: "", logo_path: null },
  subhead: "",
  slogan: "",
  stat: { on: false, icon: "people", label: "", value: "", caption: "" },
  ribbon: { on: false, date: "", time: "" },
  agenda: [],
  paragraph: "",
  footer: "",
};

const posterDesign = (poster: PosterContent, over: Partial<FlyerDesign> = {}): FlyerDesign => ({
  v: 1,
  template: "poster",
  size: "tall",
  headline: "JAINA 2027",
  tagline: "",
  date_line: "",
  venue_line: "JSH Main Hall",
  show_qr: true,
  background: { source: "plain" },
  poster,
  ...over,
});

/** Render a poster on the stage and check nothing is outside it and the footer band is still at the bottom. */
async function expectPosterFits(
  label: string,
  poster: PosterContent,
  over: { design?: Partial<FlyerDesign>; size?: FlyerSize; assets?: FlyerRenderInput["posterAssets"]; logo?: FlyerRenderInput["logo"]; qrLink?: string | null; scale?: "preview" | "full" } = {},
) {
  const size = over.size ?? "tall";
  const d = posterDesign(poster, { size, ...over.design });
  const dims = flyerDims(size, over.scale ?? "preview");
  const { img, mx, my } = await renderOnStage(
    input({ design: d, background: null, logo: over.logo === undefined ? logo : over.logo, qrLink: over.qrLink === undefined ? "https://app.example.org/e/22222222-2222-4222-8222-222222222222" : over.qrLink, posterAssets: over.assets }),
    dims,
  );
  const outside = drawnOutside(img, mx, my, dims);
  expect(outside.count, `${label} (${size}): something is drawn ${outside.first}`).toBe(0);
  // The footer band stays on the bottom edge (a long agenda would shove it out of the picture).
  const footerBg = hexRgb(artPack(poster.occasion, brand).palette.footerBg);
  const band = Math.max(3, Math.round(dims.w / 54));
  for (const x of [mx + 8, mx + dims.w - 9]) expect(near(pixel(img, x, my + dims.h - band), footerBg), `${label} (${size}): the footer band is at the bottom edge`).toBe(true);
}

const sizeDims = (size: FlyerSize) => flyerDims(size, "preview");

describe("poster layout: nothing is cut off, whatever is switched on or off", () => {
  it("has the Poster among the templates, and Tall among the sizes", () => {
    expect([...FLYER_TEMPLATES]).toContain("poster");
    expect([...FLYER_SIZE_KEYS]).toEqual(["post", "tall", "story", "print"]);
    expect(flyerDims("tall", "full")).toEqual({ w: 1080, h: 1620 });
    expect(flyerDims("tall", "preview")).toEqual({ w: 540, h: 810 });
  });

  for (const occasion of FLYER_OCCASIONS) {
    it(`${occasion}: every section on at its longest (tall)`, async () => {
      await expectPosterFits(`${occasion} longest`, fullPoster(occasion), { design: { headline: "Paryushan Mahaparva Pratikraman and Samvatsari Celebration for the Whole Jain Community".slice(0, 90), venue_line: "Jain Society of Greater Houston Main Prayer Hall and Community Centre, 3905 Arc Street, Sugar Land, Texas".slice(0, FLYER_LIMITS.venue_line) } });
    }, 60_000);
  }

  for (const size of FLYER_SIZE_KEYS) {
    it(`every section on at its longest at ${size} size`, async () => {
      await expectPosterFits("longest", fullPoster("convention"), { size, design: { headline: "PARYUSHAN MAHAPARVA PRATIKRAMAN AND SAMVATSARI CELEBRATION FOR THE WHOLE JAIN COMMUNITY" } });
    }, 60_000);
    it(`the reference poster at ${size} size`, async () => {
      await expectPosterFits("jaina", jainaPoster(), { size });
    }, 60_000);
  }

  it("the reference poster at full Tall size (what Use this flyer saves)", async () => {
    await expectPosterFits("jaina full", jainaPoster(), { scale: "full" });
  }, 60_000);

  const sections: [string, Partial<PosterContent>][] = [
    ["the logos", { logo: false, partner: { on: false, label: "", sub: "", logo_path: null } }],
    ["the partner", { partner: { on: false, label: "", sub: "", logo_path: null } }],
    ["the subhead", { subhead: "" }],
    ["the slogan", { slogan: "" }],
    ["the highlight box", { stat: { on: false, icon: "people", label: "", value: "", caption: "" } }],
    ["the date ribbon", { ribbon: { on: false, date: "", time: "" } }],
    ["the agenda", { agenda: [] }],
    ["the paragraph", { paragraph: "" }],
    ["the footer credit (the community's name shows)", { footer: "" }],
    ["the frame", { frame: { source: "none" } }],
    ["the bottom scene", { scene: { source: "none" } }],
    ["every optional section", posterOff],
    ["every optional section and both art layers", { ...posterOff, frame: { source: "none" }, scene: { source: "none" } }],
  ];
  for (const [what, off] of sections) {
    for (const size of ["tall", "post"] as const) {
      it(`without ${what} (${size})`, async () => {
        await expectPosterFits(what, jainaPoster(off), { size });
      }, 60_000);
    }
  }

  it("without the QR code, and without a logo file", async () => {
    await expectPosterFits("no qr", jainaPoster(), { design: { show_qr: false }, logo: null });
    await expectPosterFits("no link", jainaPoster(), { qrLink: null });
  }, 60_000);

  it("with AI art for the frame and the scene (pictures of their own shape), the long way and the short way", async () => {
    const frame = solid(GREEN_RGB, 1024, 1536);
    const scene = solid(GREEN_RGB, 1536, 658);
    const poster = (p: Partial<PosterContent>) => fullPoster("garba", { frame: { source: "ai", path: "x" }, scene: { source: "ai", path: "x" }, ...p });
    for (const size of ["tall", "post", "story"] as const) {
      await expectPosterFits(`AI art ${size}`, poster({}), { size, assets: { frame, scene, partnerLogo: null } });
    }
    await expectPosterFits("AI frame only", poster({ scene: { source: "code" } }), { assets: { frame, scene: null, partnerLogo: null } });
    await expectPosterFits("AI scene only, reference content", jainaPoster({ occasion: "garba", frame: { source: "code" }, scene: { source: "ai", path: "x" } }), { assets: { frame: null, scene, partnerLogo: null } });
  }, 120_000);

  it("a layer that could not be loaded falls back to the drawn art (no picture, no gap)", async () => {
    await expectPosterFits("fallback", jainaPoster({ frame: { source: "ai", path: "x" }, scene: { source: "ai", path: "x" } }), { assets: { frame: null, scene: null, partnerLogo: null } });
  }, 60_000);

  it("with the partner's own logo, wide or square, in place of the drawn badge", async () => {
    for (const [w, h] of [[600, 200], [200, 200], [120, 400]] as const) {
      await expectPosterFits(`partner ${w}x${h}`, jainaPoster(), { assets: { frame: null, scene: null, partnerLogo: solid(GREEN_RGB, w, h) } });
    }
  }, 60_000);

  it("draws the poster's own words on its pixels (something is on the page, in the pack's ink)", async () => {
    const r = await renderFlyerPng(input({ design: posterDesign(jainaPoster()), background: null }), "preview");
    expect(isPng(r.png)).toBe(true);
    expect(r.dims).toEqual(sizeDims("tall"));
    expect(r.notes).toEqual([]);
    const { w, h, px } = decodePng(r.png);
    const ink = hexRgb(artPack("convention", brand).palette.ink);
    let inkPixels = 0;
    for (let i = 0; i < w * h; i++) if (Math.abs(px[i * 4]! - ink[0]) + Math.abs(px[i * 4 + 1]! - ink[1]) + Math.abs(px[i * 4 + 2]! - ink[2]) < 30) inkPixels++;
    expect(inkPixels).toBeGreaterThan(w * h * 0.01);
  }, 60_000);

  it("renders the Print size as a sharp PDF (a letter page, the picture drawn edge to edge)", async () => {
    const r = await renderFlyerPng(input({ design: posterDesign(jainaPoster(), { size: "print" }), background: null }), "preview", { w: 255, h: 330 });
    const pdf = await renderFlyerPdf(r.png, "JAINA 2027");
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(flyerDims("print", "full")).toEqual({ w: 2550, h: 3300 });
  }, 60_000);

  it("a poster's words reach the font chooser (Gujarati and the like)", () => {
    expect(flyerText(input({ design: posterDesign(jainaPoster({ subhead: "ગુજરાતી ઉપશીર્ષક" })) }))).toContain("ગુજરાતી ઉપશીર્ષક");
    expect(flyerText(input({ design: design() }))).not.toContain("ગુજરાતી");
  });
});

// ── The words end where the plan says they do ────────────────────────────────
// The poster plans how tall its words are (planPoster) from an estimate of how they wrap, and the footer band is pinned to the
// bottom edge. So a wrong estimate does not push the footer out of the picture any more: the last line runs into the scene
// instead. These tests catch that. A poster with no art layers and no QR code has nothing on its page but the words, so the
// strip of paper just above the footer band must be clear whenever the estimate was big enough. (Estimates that were too
// small, for headlines of long words such as "Swamivatsalya Pratikraman Celebration Programme", pushed the footer off the picture.)

/** Pixels in the strip above the footer band, between the frame's side ornaments, that are darker than any paper: ink. */
function inkAboveFooter(img: Pixels, mx: number, my: number, dims: FlyerDims): number {
  const u = dims.w / POSTER_UNITS.width;
  const footerTop = my + dims.h - Math.round(POSTER_UNITS.footer * u);
  let ink = 0;
  for (let y = footerTop - Math.round(24 * u); y < footerTop - 2; y++) {
    for (let x = Math.round(mx + POSTER_UNITS.side * u); x < Math.round(mx + dims.w - POSTER_UNITS.side * u); x++) {
      const [r, g, b] = pixel(img, x, y);
      if (0.299 * r + 0.587 * g + 0.114 * b < 215) ink++;
    }
  }
  return ink;
}

/** A poster with only its words (no frame, no scene, no QR code): nothing is drawn outside it, and nothing runs into the strip above the footer. */
async function expectWordsFit(label: string, poster: PosterContent, size: FlyerSize, over: Partial<FlyerDesign> = {}) {
  const bare: PosterContent = { ...poster, frame: { source: "none" }, scene: { source: "none" } };
  const dims = flyerDims(size, "preview");
  const { img, mx, my } = await renderOnStage(input({ design: posterDesign(bare, { size, show_qr: false, ...over }), background: null }), dims);
  const outside = drawnOutside(img, mx, my, dims);
  expect(outside.count, `${label} (${size}): something is drawn ${outside.first}`).toBe(0);
  expect(inkAboveFooter(img, mx, my, dims), `${label} (${size}): the words run into the strip above the footer`).toBe(0);
}

/** A small seeded random number generator, so a failing poster can be drawn again. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** Words a community's posters are made of, long and short, with wide capitals and numbers among them. */
const VOCABULARY = [
  "Paryushan", "Mahaparva", "Samvatsari", "Pratikraman", "Swamivatsalya", "Navratri", "Garba", "Raas", "Dandiya", "Diwali", "Annakut", "Bhakti", "Bhajan", "Sangeet",
  "Pathshala", "Teachers", "Volunteers", "Registration", "Orientation", "Convention", "Celebration", "Community", "Fellowship", "Dinner", "Lunch", "Prasad", "Aarti",
  "Pooja", "Snatra", "Kshamapana", "Mahotsav", "Janma", "Kalyanak", "Jayanti", "Youth", "Seniors", "Families", "Children", "Welcome", "Annual", "General", "Meeting",
  "Fundraiser", "Gala", "Retreat", "Picnic", "Programme", "Inauguration", "Siddhachakra", "Mahapujan", "Greater", "Cultural", "Society", "of", "and", "the", "for",
  "with", "at", "in", "a", "to", "&", "2026", "2027", "100K+", "80%", "5:00", "PM", "AM", "Hall", "Temple", "Center", "Houston", "Sugar", "Land", "WWW", "MMM",
  "Extraordinary", "Contributions", "Understanding", "Participation", "Accommodations",
];

/** Up to `max` characters of random words (all capitals when `caps`). */
function someWords(r: () => number, max: number, caps = false): string {
  const target = Math.floor(r() * (max + 1));
  let out = "";
  for (let guard = 0; guard < 200; guard++) {
    const word = VOCABULARY[Math.floor(r() * VOCABULARY.length)]!;
    const next = out ? `${out} ${word}` : word;
    if (next.length > target) break;
    out = next;
  }
  return caps ? out.toUpperCase() : out;
}

/** Three to five of the long words, the headlines whose wrapping is hardest to estimate. */
function longHeadline(r: () => number): string {
  const long = VOCABULARY.filter((w) => w.length >= 9);
  return Array.from({ length: 3 + Math.floor(r() * 3) }, () => long[Math.floor(r() * long.length)]!).join(" ");
}

/** A poster of random words, with random sections on and off, at a random size and occasion. */
function randomPoster(r: () => number): { poster: PosterContent; size: FlyerSize; headline: string; venue: string } {
  const on = (p: number) => r() < p;
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const caps = on(0.4);
  const poster: PosterContent = {
    occasion: pick(FLYER_OCCASIONS),
    frame: { source: "code" },
    scene: { source: "code" },
    logo: on(0.8),
    partner: { on: on(0.5), label: someWords(r, POSTER_LIMITS.partner_label, true), sub: someWords(r, POSTER_LIMITS.partner_sub, true), logo_path: null },
    subhead: on(0.7) ? someWords(r, POSTER_LIMITS.subhead, true) : "",
    slogan: on(0.7) ? someWords(r, POSTER_LIMITS.slogan, caps) : "",
    stat: { on: on(0.6), icon: pick(POSTER_ICONS), label: someWords(r, POSTER_LIMITS.stat_label, true), value: someWords(r, 4) || "80%", caption: someWords(r, POSTER_LIMITS.stat_caption, true) },
    ribbon: { on: on(0.85), date: someWords(r, POSTER_LIMITS.ribbon_date), time: someWords(r, POSTER_LIMITS.ribbon_time) },
    agenda: Array.from({ length: Math.floor(r() * (POSTER_AGENDA_MAX + 1)) }, () => ({ icon: pick(POSTER_ICONS), time: someWords(r, POSTER_LIMITS.agenda_time), text: someWords(r, POSTER_LIMITS.agenda_text) })),
    paragraph: on(0.7) ? someWords(r, POSTER_LIMITS.paragraph) : "",
    footer: on(0.6) ? someWords(r, POSTER_LIMITS.footer) : "",
  };
  const headline = on(0.5) ? longHeadline(r).slice(0, FLYER_LIMITS.headline).trim() : someWords(r, FLYER_LIMITS.headline, caps) || "Event";
  return { poster, size: pick(FLYER_SIZE_KEYS), headline, venue: on(0.8) ? someWords(r, FLYER_LIMITS.venue_line) : "" };
}

describe("poster layout: the words end where the plan says they do", () => {
  // Headlines of three to five long words: the ones whose line count the first estimate got wrong (a fourth line the plan did not
  // know about pushed the footer off the picture), under a ribbon, a highlight box and an agenda.
  const NATURAL_HEADLINES = [
    "Pathshala Orientation Registration Celebration",
    "Swamivatsalya Pratikraman Celebration Programme",
    "Mahavir Janma Kalyanak Mahotsav Celebration",
    "Samvatsari Pratikraman Kshamapana Celebration",
    "Diwali Annakut Mahotsav Celebration Programme",
    "Annual Paryushan Pratikraman and Samvatsari Celebration",
    "Retreat Picnic Children Orientation Annakut",
  ];
  const dense: Partial<PosterContent> = {
    partner: { on: true, label: "JAINA", sub: "YJP", logo_path: null },
    subhead: "",
    slogan: "",
    stat: { on: true, icon: "people", label: "MORE THAN", value: "80%", caption: "OF SEATS ARE FILLED" },
    ribbon: { on: true, date: "Saturday, October 3, 2026", time: "5:00 PM onwards" },
    agenda: [
      { icon: "clock", time: "5:00–6:00 PM", text: "Registration and welcome" },
      { icon: "dinner", time: "6:00 PM onwards", text: "Dinner and fellowship" },
      { icon: "dancers", time: "After dinner", text: "Garba night" },
    ],
    paragraph: "",
    footer: "",
  };
  for (const occasion of ["mahavir", "convention"] as const) {
    for (const size of ["tall", "post"] as const) {
      it(`${occasion} (${size}): headlines of long words, over a ribbon, a highlight box and an agenda`, async () => {
        for (const h of NATURAL_HEADLINES) await expectWordsFit(`"${h}"`, jainaPoster({ ...dense, occasion }), size, { headline: h, venue_line: "JSH Main Hall, Sugar Land" });
      }, 90_000);
    }
  }

  it("sets a single long word smaller until it fits its line, and breaks one that cannot fit at all", async () => {
    for (const h of ["Dasalakshanaparva", "Pratishthamahotsav", "Samvatsaripratikraman", "SWAMIVATSALYA", "Paryushanmahaparva 2026", "Abcdefghijklmnopqrstuvwxyzabcdefghijklmn"]) {
      await expectWordsFit(`"${h}"`, jainaPoster(), "tall", { headline: h });
    }
  }, 60_000);

  it("breaks text with no spaces in it (a long link, a run of letters) instead of letting it run off the edge", async () => {
    const run = (n: number) => "Swamivatsalyabhojanshala".repeat(15).slice(0, n);
    const poster = jainaPoster({
      subhead: run(POSTER_LIMITS.subhead),
      slogan: run(POSTER_LIMITS.slogan),
      stat: { on: true, icon: "people", label: run(POSTER_LIMITS.stat_label), value: "100K+", caption: run(POSTER_LIMITS.stat_caption) },
      ribbon: { on: true, date: run(POSTER_LIMITS.ribbon_date), time: run(POSTER_LIMITS.ribbon_time) },
      agenda: [{ icon: "clock", time: run(POSTER_LIMITS.agenda_time), text: run(POSTER_LIMITS.agenda_text) }],
      paragraph: run(POSTER_LIMITS.paragraph),
      footer: run(POSTER_LIMITS.footer),
    });
    for (const size of ["tall", "story"] as const) await expectWordsFit("unbroken text", poster, size, { headline: run(FLYER_LIMITS.headline), venue_line: run(FLYER_LIMITS.venue_line) });
  }, 60_000);

  // Random posters (the same ones every run): ordinary and awkward words, every section on or off, every occasion and size.
  for (const [name, seed] of [["A", 20261002], ["B", 777]] as const) {
    it(`random posters ${name}: ordinary words in every section, at every size`, async () => {
      const r = seeded(seed);
      for (let i = 0; i < 20; i++) {
        const c = randomPoster(r);
        await expectWordsFit(`random #${i} (${c.poster.occasion}) ${JSON.stringify({ ...c.poster, frame: undefined, scene: undefined, headline: c.headline, venue: c.venue })}`, c.poster, c.size, {
          headline: c.headline,
          venue_line: c.venue,
        });
      }
    }, 180_000);
  }
});

// ── The RSVP QR code is big enough to scan ───────────────────────────────────

/** Average a picture down to `width` pixels wide (a box filter: harsher on a QR code than a phone's camera is). */
function downscale(img: Pixels, width: number): Pixels {
  const height = Math.round((img.h * width) / img.w);
  const px = new Uint8Array(width * height * 4);
  const sx = img.w / width;
  const sy = img.h / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.min(img.h, Math.ceil((y + 1) * sy)); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.min(img.w, Math.ceil((x + 1) * sx)); xx++) {
          const i = (yy * img.w + xx) * 4;
          r += img.px[i]!;
          g += img.px[i + 1]!;
          b += img.px[i + 2]!;
          n++;
        }
      }
      px.set([r / n, g / n, b / n, 255], (y * width + x) * 4);
    }
  }
  return { w: width, h: height, px };
}

/** The text of the QR code in a picture, or null when ZXing cannot read one. */
function readQr(img: Pixels): string | null {
  const lum = new Uint8ClampedArray(img.w * img.h);
  for (let i = 0; i < img.w * img.h; i++) lum[i] = Math.round(0.299 * img.px[i * 4]! + 0.587 * img.px[i * 4 + 1]! + 0.114 * img.px[i * 4 + 2]!);
  const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
  try {
    return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, img.w, img.h))), hints).getText();
  } catch {
    return null;
  }
}

describe("poster QR code", () => {
  const link = "https://app.example.org/e/22222222-2222-4222-8222-222222222222";

  it("can be scanned from the picture shown 700 pixels wide (the first, smaller code could not below 900)", async () => {
    for (const size of ["tall", "post"] as const) {
      const r = await renderFlyerPng(input({ design: posterDesign(jainaPoster(), { size }), background: null, qrLink: link }), "full");
      const full = decodePng(r.png);
      expect(readQr(full), `${size} at full size`).toBe(link);
      expect(readQr(downscale(full, 700)), `${size} shown 700 pixels wide`).toBe(link);
    }
  }, 60_000);

  it("keeps clear of the words: the card is no taller than the room the plan reserves for it", async () => {
    // No art layers, so the only white on the page is the card.
    const poster: PosterContent = { ...jainaPoster(), frame: { source: "none" }, scene: { source: "none" } };
    for (const size of ["tall", "post", "story"] as const) {
      const dims = flyerDims(size, "full");
      const u = dims.w / POSTER_UNITS.width;
      const d = posterDesign(poster, { size });
      const plan = planPoster({ design: d, poster, logo, assets: { frame: null, scene: null, partnerLogo: null } }, dims, artPack(poster.occasion, brand));
      const qs = Math.max(plan.sceneScale, 0.8);
      const { img, mx, my } = await renderOnStage(input({ design: d, background: null, qrLink: link }), dims);
      // The card's bottom edge is 18 units above the footer band. Walk up from there along the card's left padding (pure white,
      // inside its gold border) to the border at the top; the card's height is that, plus the two borders.
      const bottom = my + dims.h - Math.round((POSTER_UNITS.footer + 18) * u);
      const column = mx + Math.round((40 + 8 * qs) * u);
      let top = bottom - Math.round(10 * qs * u);
      for (let y = top; y > my + dims.h / 2; y--) {
        const [r, g, b] = pixel(img, column, y);
        if (r < 254 || g < 254 || b < 254) break;
        top = y;
      }
      const heightUnits = (bottom - top) / u + 3 * qs;
      // The card is POSTER_UNITS.qrCard tall at scale 1 (the border and edges are a few pixels either way).
      expect(heightUnits, `${size}: the card's height in units`).toBeGreaterThan(POSTER_UNITS.qrCard * qs * 0.93);
      expect(heightUnits, `${size}: the card is no taller than the room reserved for it`).toBeLessThanOrEqual(POSTER_UNITS.qrCard * qs + 2);
      expect(plan.reserve, `${size}: the room reserved above the footer`).toBeGreaterThanOrEqual(POSTER_UNITS.qrCard * qs + 18);
    }
  }, 60_000);
});
