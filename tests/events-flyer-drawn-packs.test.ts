// The drawn art packs for occasions every kind of organization holds (src/lib/events/flyer-packs, registered in ONE list
// in flyer-art-packs.ts): each draws a frame and a bottom scene in the community's brand colours, as clean SVG, through the
// real renderer at every size, and never puts a dark sky or a shape behind the words.
import { inflateSync } from "node:zlib";

import { ImageResponse } from "next/og";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { FLYER_SIZE_KEYS, type FlyerDesign, type FlyerSize, type PosterContent } from "@/lib/events/flyer";
import type { FlyerOccasion } from "@/lib/events/flyer-art";
import { artColors, artPack, brandPalette, DRAWN_PACKS, drawnPack, packLayerThumbnailSvg, packThumbnailSvg, svgDataUri } from "@/lib/events/flyer-art-packs";
import { readFlyerBrand } from "@/lib/events/flyer-brand";
import { mix, quietSky, wordLine } from "@/lib/events/flyer-packs/draw";
import { flyerDims, flyerElement, isPng, renderFlyerPng } from "@/lib/events/flyer-render";
import { contrastRatio } from "@/lib/setup";

/** A church in navy, a chamber in teal, a temple in maroon, and two hard cases: a white page, a dark page. */
const BRANDS = {
  church: { primary: "#1E3A6E", accent: "#C9A227", background: "#F8F6F0" },
  chamber: { primary: "#0F6E6A", accent: "#E9A23B", background: "#F4FAF9" },
  temple: { primary: "#7A1F2B", accent: "#E0A030", background: "#FFF8EE" },
  white: { primary: "#5B6B7A", accent: "#9FB3C8", background: "#FFFFFF" },
  dark: { primary: "#9CC3FF", accent: "#F2C14E", background: "#14213D" },
} as const;

const occasions = DRAWN_PACKS.map((p) => p.occasion as FlyerOccasion);
/** The eight Flyers v2 packs, drawn in flyer-art-packs.ts itself. */
const ORIGINAL_PACKS = ["garba", "paryushan", "diwali", "mahavir", "convention", "pathshala", "bhakti", "general"];
const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 0;

/** The stops of a scene's sky gradient: [offset, colour, opacity]. */
function skyStops(svg: string): [number, string, number][] {
  const g = /<linearGradient id="sky"[^>]*>(.*?)<\/linearGradient>/.exec(svg);
  if (!g) throw new Error("no sky gradient");
  return [...g[1].matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)" stop-opacity="([^"]+)"\/>/g)].map((m) => [Number(m[1]), m[2], Number(m[3])]);
}

/** The sky at `t` (0 top, 1 bottom) laid over the paper. */
function skyAt(stops: [number, string, number][], t: number, paper: string): string {
  let i = stops.findIndex(([o]) => o >= t);
  if (i <= 0) i = Math.max(1, i);
  const [o0, c0, a0] = stops[i - 1];
  const [o1, c1, a1] = stops[Math.min(i, stops.length - 1)];
  const k = o1 > o0 ? Math.min(1, Math.max(0, (t - o0) / (o1 - o0))) : 0;
  return mix(paper, mix(c0, c1, k), a0 + (a1 - a0) * k);
}

/** RGBA pixels of an 8-bit, non-interlaced RGB or RGBA PNG (what next/og writes). */
function decodePng(png: Uint8Array): { w: number; h: number; px: Uint8Array } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  const idat: Uint8Array[] = [];
  while (at + 8 <= png.length) {
    const len = dv.getUint32(at);
    const kind = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (kind === "IHDR") {
      w = dv.getUint32(at + 8);
      h = dv.getUint32(at + 12);
      type = png[at + 17];
    } else if (kind === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
    else if (kind === "IEND") break;
    at += 12 + len;
  }
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
        v += Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) px.set([cur[x * bpp], cur[x * bpp + 1], cur[x * bpp + 2], 255], (y * w + x) * 4);
    prev = cur;
  }
  return { w, h, px };
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** Every image src in an element tree. */
function imageSources(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) imageSources(n, out);
    return out;
  }
  const el = node as { type?: unknown; props?: { src?: unknown; children?: unknown } };
  if (el.type === "img" && typeof el.props?.src === "string") out.push(el.props.src);
  if (typeof el.type === "function") return imageSources((el.type as (p: unknown) => unknown)(el.props), out);
  return imageSources(el.props?.children, out);
}

const fromUri = (uri: string) => Buffer.from(uri.replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");

describe("drawn packs for every kind of organization", () => {
  it("registers at least eight packs, each once, for occasions the eight original packs do not draw", () => {
    expect(DRAWN_PACKS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(occasions).size).toBe(occasions.length);
    for (const p of DRAWN_PACKS) {
      expect(p.occasion).toMatch(/^[a-z][a-z_]*$/);
      expect(ORIGINAL_PACKS.includes(p.occasion), p.occasion).toBe(false);
      expect(drawnPack(p.occasion)).toBe(p);
      expect(p.blurb.length, p.occasion).toBeGreaterThan(10);
      expect(p.blurb.length, p.occasion).toBeLessThanOrEqual(80);
      expect(p.sceneHeight).toBeGreaterThan(300);
      expect(p.busy).toBeLessThanOrEqual(p.sceneHeight);
      expect(p.fade.from).toBeLessThan(p.fade.to);
      expect(p.topInset).toBeGreaterThanOrEqual(54);
      expect(p.scrim).toBeGreaterThan(0);
      expect(p.scrim).toBeLessThan(1);
    }
    expect(drawnPack("garba")).toBeNull();
    expect(drawnPack("not_an_occasion")).toBeNull();
  });

  it("takes its colours from the community's brand kit, with every text colour readable", () => {
    for (const o of occasions) {
      const church = artPack(o, BRANDS.church);
      const chamber = artPack(o, BRANDS.chamber);
      expect(church.palette).toEqual(brandPalette(BRANDS.church));
      expect(church.frame(1080, 1620), o).toContain(church.palette.gold);
      expect(chamber.frame(1080, 1620), o).toContain(chamber.palette.gold);
      expect(church.frame(1080, 1620)).not.toBe(chamber.frame(1080, 1620));
      expect(church.scene.draw(1080, church.scene.height)).not.toBe(chamber.scene.draw(1080, chamber.scene.height));
      const c = church.palette;
      expect(ratio(c.ink, c.paper), o).toBeGreaterThanOrEqual(7);
      expect(ratio(c.onAccent, c.accent), o).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.footerText, c.footerBg), o).toBeGreaterThanOrEqual(4.5);
    }
    expect(artColors(brandPalette(BRANDS.temple))).toEqual({ primary: brandPalette(BRANDS.temple).accent, secondary: "#E0A030", ink: brandPalette(BRANDS.temple).ink, paper: "#FFF8EE" });
  });

  it("draws every frame and scene as clean SVG at every size: no text, scripts, pictures or broken numbers, plain ASCII", () => {
    const single = /<(?!g\b)[a-z]+\b[^>]*\sopacity=/;
    for (const o of occasions) {
      const p = artPack(o, BRANDS.church);
      for (const H of [1350, 1398, 1620, 1920]) {
        const frame = p.frame(1080, H);
        expect(frame.startsWith("<svg"), `${o} frame ${H}`).toBe(true);
        expect(frame).toContain(`viewBox="0 0 1080 ${H}"`);
        expect(frame.length, `${o} frame ${H}`).toBeLessThan(400_000);
        expect(frame, o).not.toMatch(single);
        expect(frame, o).not.toMatch(/<text|<script|<image|<foreignObject|<use |href=|\son[a-z]+=|NaN|undefined|Infinity/i);
        expect(/^[\x20-\x7E]*$/.test(frame), `${o} frame is ASCII (svgDataUri uses btoa)`).toBe(true);
      }
      for (const W of [760, 1080, 1296, 1800]) {
        const scene = p.scene.draw(W, p.scene.height);
        expect(scene).toContain(`viewBox="0 0 ${W} ${p.scene.height}"`);
        expect(scene.length, `${o} scene ${W}`).toBeLessThan(400_000);
        expect(scene, o).not.toMatch(single);
        expect(scene, o).not.toMatch(/<text|<script|<image|<foreignObject|<use |href=|\son[a-z]+=|NaN|undefined|Infinity/i);
        expect(/^[\x20-\x7E]*$/.test(scene), `${o} scene is ASCII`).toBe(true);
      }
      expect(p.frame(1080, 1620)).toBe(artPack(o, BRANDS.church).frame(1080, 1620));
      expect(p.scene.draw(1080, p.scene.height)).toBe(artPack(o, BRANDS.church).scene.draw(1080, p.scene.height));
      expect(packThumbnailSvg(p, { frame: true, scene: true })).not.toMatch(/<text|NaN|undefined/);
      expect(packLayerThumbnailSvg(p, "scene")).toMatchObject({ w: 1080, h: p.scene.height });
    }
  });

  it("gives the picker's thumbnail its own gradient ids, so the frame's and the scene's never collide", () => {
    for (const o of occasions) {
      const svg = packThumbnailSvg(artPack(o, BRANDS.chamber), { frame: true, scene: true });
      const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, `${o}: ${ids.join(",")}`).toBe(ids.length);
      for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids, `${o}: url(#${m[1]})`).toContain(m[1]);
    }
  });

  it("keeps the sky quiet behind the words: the ink and the paragraph read at 4.5:1 down to the words' line, on light and dark pages", () => {
    for (const [name, b] of Object.entries(BRANDS)) {
      const pal = brandPalette(b);
      for (const o of occasions) {
        const p = artPack(o, b);
        const stops = skyStops(p.scene.draw(1080, p.scene.height));
        const line = wordLine(p.scene.height, p.scene.busy);
        for (let t = 0; t <= line + 1e-9; t += line / 12) {
          const bg = skyAt(stops, t, pal.paper);
          expect(ratio(pal.ink, bg), `${o} on the ${name} page at ${t.toFixed(2)}: ${bg}`).toBeGreaterThanOrEqual(4.5);
          expect(ratio(pal.body, bg), `${o} paragraph on the ${name} page at ${t.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
          expect(ratio(pal.accent, bg), `${o} agenda times on the ${name} page at ${t.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    // A tint is mixed in only as far as the text colour still reads.
    expect(quietSky({ paper: "#FFFFFF", ink: "#767676" }, "#000000")).toBe("#FFFFFF");
    expect(ratio("#1E3A6E", quietSky({ paper: "#F8F6F0", ink: "#1E3A6E" }, "#5B76AE"))).toBeGreaterThanOrEqual(6);
  });

  it("keeps the frame's centre calm: the paragraph and the agenda times read at 4.5:1 on every pixel of the middle, wash and all", async () => {
    for (const [name, b] of Object.entries(BRANDS)) {
      for (const o of occasions) {
        const p = artPack(o, b);
        const pal = p.palette;
        for (const H of [1350, 1920]) {
          const width = 270;
          const height = Math.round((H * width) / 1080);
          const pic = createElement("img", { src: svgDataUri(p.frame(1080, H)), width, height, style: { width, height } });
          const img = decodePng(new Uint8Array(await new ImageResponse(createElement("div", { style: { display: "flex", width, height } }, pic), { width, height }).arrayBuffer()));
          const u = width / 1080;
          let worst = 21;
          let where = "";
          for (let y = Math.round(340 * u); y < Math.round((H - 340) * u); y++) {
            for (let x = Math.round(110 * u); x < Math.round(970 * u); x++) {
              const i = (y * img.w + x) * 4;
              const c = hex(img.px[i], img.px[i + 1], img.px[i + 2]);
              const r = Math.min(ratio(pal.body, c), ratio(pal.accent, c));
              if (r < worst) {
                worst = r;
                where = `${x},${y}`;
              }
            }
          }
          expect(worst, `${o} frame (${H}) on the ${name} page at ${where}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  }, 240_000);

  it("draws nothing above the words' line: a scene's own pixels there are as quiet as its sky", async () => {
    for (const o of occasions) {
      const p = artPack(o, BRANDS.church);
      const pal = p.palette;
      for (const W of [760, 1800]) {
        const h = p.scene.height;
        const width = 360;
        const height = Math.round((h * width) / W);
        const el = createElement(
          "div",
          { style: { display: "flex", width, height, backgroundColor: pal.paper } },
          createElement("img", { src: svgDataUri(p.scene.draw(W, h)), width, height, style: { width, height } }),
        );
        const img = decodePng(new Uint8Array(await new ImageResponse(el, { width, height }).arrayBuffer()));
        const stop = Math.floor(wordLine(h, p.scene.busy) * img.h) - 1;
        let worst = 21;
        let where = "";
        for (let y = 0; y < stop; y++) {
          for (let x = 0; x < img.w; x++) {
            const i = (y * img.w + x) * 4;
            const r = ratio(pal.ink, hex(img.px[i], img.px[i + 1], img.px[i + 2]));
            if (r < worst) {
              worst = r;
              where = `${x},${y}`;
            }
          }
        }
        expect(worst, `${o} (${W} wide): a shape above the words' line at ${where}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }, 120_000);

  it("renders through the real renderer at every size, with both layers drawn", async () => {
    const brand = readFlyerBrand(BRANDS.chamber, undefined);
    for (const o of occasions) {
      for (const size of FLYER_SIZE_KEYS as readonly FlyerSize[]) {
        const poster = {
          occasion: o,
          frame: { source: "code" },
          scene: { source: "code" },
          logo: false,
          partner: { on: false, label: "", sub: "", logo_path: null },
          subhead: "RIVERSIDE CHAMBER OF COMMERCE",
          slogan: "",
          stat: { on: false, icon: "people", label: "", value: "", caption: "" },
          ribbon: { on: true, date: "Thursday, November 12, 2026", time: "5:30 PM" },
          agenda: [{ icon: "clock", time: "5:30 PM", text: "Welcome" }],
          paragraph: "Meet fellow members and local business owners.",
          footer: "Riverside Chamber of Commerce",
        } as PosterContent;
        const design = { v: 1, template: "poster", size, headline: "November Member Evening", tagline: "", date_line: "", venue_line: "Main hall", show_qr: true, background: { source: "plain" }, poster } as FlyerDesign;
        const input = { design, brand, centerName: "Riverside Chamber of Commerce", background: null, logo: null, logoDark: null, qrLink: "https://app.example.org/e/22222222-2222-4222-8222-222222222222" };
        const dims = flyerDims(size, "preview");
        const svgs = imageSources(flyerElement(input, dims, { display: "Fraunces", body: "DM Sans" }, null))
          .filter((s) => s.startsWith("data:image/svg+xml"))
          .map(fromUri);
        expect(svgs.some((s) => s.includes('id="paper"') && s.includes("viewBox=\"0 0 1080 ")), `${o} ${size}: the frame`).toBe(true);
        expect(svgs.some((s) => s.includes('id="sky"')), `${o} ${size}: the scene`).toBe(true);
        const r = await renderFlyerPng(input, "preview");
        expect(isPng(r.png), `${o} ${size}`).toBe(true);
        expect(r.dims).toEqual(dims);
      }
    }
  }, 240_000);
});
