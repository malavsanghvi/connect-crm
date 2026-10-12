import { describe, expect, it } from "vitest";

import { FLYER_BRAND_DEFAULTS } from "@/lib/events/flyer-brand";
import {
  ART_PALETTE_DEFAULTS,
  NATURAL_COLOURS,
  contrast,
  mixHex,
  normalizeHex,
  paletteChecks,
  paletteFromBrand,
  paletteProblems,
  readableOn,
} from "@/lib/events/flyer-art-palette";

// Brand kits of every sort: light pages, dark pages, colours too close to the page, two identical colours, mid greys.
const KITS = [
  { name: "Weaver default", primary: "#1B2C5C", accent: "#C9731C", background: "#FBF7F0" },
  { name: "church navy", primary: "#14213D", accent: "#FCA311", background: "#FFFFFF" },
  { name: "chamber teal", primary: "#0F766E", accent: "#F59E0B", background: "#F8FAFC" },
  { name: "club green on dark", primary: "#22C55E", accent: "#FDE047", background: "#0B1F14" },
  { name: "navy page", primary: "#F4D35E", accent: "#EE964B", background: "#0B1F3A" },
  { name: "pale primary", primary: "#FFF5E1", accent: "#FFE8C2", background: "#FFFDF8" },
  { name: "same colours", primary: "#8C1D2E", accent: "#8C1D2E", background: "#FBF3E4" },
  { name: "mid grey page", primary: "#777777", accent: "#888888", background: "#767676" },
  { name: "orange page", primary: "#FFFFFF", accent: "#1B2C5C", background: "#C9731C" },
  { name: "black and white", primary: "#000000", accent: "#FFFFFF", background: "#FFFFFF" },
];

describe("paletteFromBrand", () => {
  it("keeps the Weaver defaults equal to the brand kit's defaults", () => {
    expect(ART_PALETTE_DEFAULTS).toEqual({ primary: FLYER_BRAND_DEFAULTS.primary, accent: FLYER_BRAND_DEFAULTS.accent, background: FLYER_BRAND_DEFAULTS.background });
  });

  for (const kit of KITS) {
    it(`passes every contrast rule for ${kit.name}`, () => {
      const p = paletteFromBrand(kit);
      expect(paletteProblems(p), JSON.stringify(paletteChecks(p))).toEqual([]);
      expect(contrast(p.ink, p.paper)).toBeGreaterThanOrEqual(4.5);
      for (const v of Object.values(p).filter((x): x is string => typeof x === "string")) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    });
  }

  it("uses the brand colours as they are when they already read", () => {
    const p = paletteFromBrand({ primary: "#14213d", accent: "#FCA311", background: "#ffffff" });
    expect(p.primary).toBe("#14213D");
    expect(p.secondary).toBe("#FCA311");
    expect(p.paper).toBe("#FFFFFF");
    expect(p.ink).toBe("#14213D");
    expect(p.darkPaper).toBe(false);
  });

  it("makes words light on a dark page", () => {
    const p = paletteFromBrand({ primary: "#1B2C5C", accent: "#C9731C", background: "#0B1F3A" });
    expect(p.darkPaper).toBe(true);
    expect(contrast(p.ink, "#FFFFFF")).toBeLessThan(contrast(p.ink, "#000000"));
    expect(contrast(p.ink, p.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("turns the second colour to gold when the kit's two colours are the same", () => {
    expect(paletteFromBrand({ primary: "#8C1D2E", accent: "#8C1D2E", background: "#FBF3E4" }).secondary).toBe(NATURAL_COLOURS.gold);
  });

  it("falls back to the defaults for colours that are not hex codes", () => {
    const p = paletteFromBrand({ primary: "navy", accent: "", background: "rgb(0,0,0)" });
    expect(p.paper).toBe(ART_PALETTE_DEFAULTS.background);
    expect(p.primary).toBe(ART_PALETTE_DEFAULTS.primary);
    expect(paletteFromBrand(null).paper).toBe(ART_PALETTE_DEFAULTS.background);
  });

  it("gives natural colours that never follow the brand, as a copy", () => {
    const a = paletteFromBrand(KITS[1]);
    const b = paletteFromBrand(KITS[3]);
    expect(a.natural).toEqual(NATURAL_COLOURS);
    expect(b.natural).toEqual(NATURAL_COLOURS);
    a.natural.flame = "#000000";
    expect(NATURAL_COLOURS.flame).not.toBe("#000000");
  });
});

describe("colour helpers", () => {
  it("normalizes hex codes", () => {
    expect(normalizeHex("1b2c5c")).toBe("#1B2C5C");
    expect(normalizeHex(" #abcdef ")).toBe("#ABCDEF");
    expect(normalizeHex("#abc")).toBeNull();
    expect(normalizeHex(42)).toBeNull();
  });

  it("measures contrast like WCAG and mixes colours", () => {
    expect(contrast("#000000", "#FFFFFF")).toBe(21);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#FFFFFF", 0)).toBe("#123456");
  });

  it("readableOn always reaches 4.5:1, even on a mid grey", () => {
    for (const bg of ["#767676", "#777777", "#808080", "#C9731C", "#0B1F3A", "#FFFFFF"]) {
      for (const fg of ["#777777", "#FFFFFF", "#000000", "#C9A227"]) expect(contrast(readableOn(fg, bg, 4.5), bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
