import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { FLYER_TEMPLATES, type FlyerDesign } from "@/lib/events/flyer";
import { readFlyerBrand } from "@/lib/events/flyer-brand";
import { BUNDLED_FONT_FILES, flyerFontPath } from "@/lib/events/flyer-fonts";
import { patternSvg } from "@/lib/events/flyer-patterns";
import { backgroundBox, flyerDims, flyerElement, isPng, renderFlyerPdf, renderFlyerPng, type FlyerRenderInput } from "@/lib/events/flyer-render";

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
