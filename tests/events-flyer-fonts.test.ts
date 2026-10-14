import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { BUNDLED_BODY, BUNDLED_DISPLAY, BUNDLED_FONT_FILES, LEGACY_BODY, LEGACY_DISPLAY, flyerFontPath, getFlyerFonts } from "@/lib/events/flyer-fonts";
import { FLYER_BRAND_DEFAULTS } from "@/lib/events/flyer-brand";

// The flyer maker's default faces are the brand kit's (Bricolage Grotesque and Hanken Grotesk); Fraunces, DM Sans and Kaushan Script stay
// bundled for a community whose brand names them. The files are vendored WOFF (assets/flyer-fonts, SIL OFL): a flyer never needs the network
// for any of these.
describe("the flyer maker's bundled faces", () => {
  it("the defaults are the kit's two faces", () => {
    expect(BUNDLED_DISPLAY).toBe("Bricolage Grotesque");
    expect(BUNDLED_BODY).toBe("Hanken Grotesk");
    expect(FLYER_BRAND_DEFAULTS.displayFont).toBe(BUNDLED_DISPLAY);
    expect(FLYER_BRAND_DEFAULTS.bodyFont).toBe(BUNDLED_BODY);
  });

  it("every bundled file is a WOFF the renderer can read, and the licence names every family", async () => {
    for (const f of BUNDLED_FONT_FILES) {
      const bytes = await readFile(flyerFontPath(f.file));
      expect(bytes.subarray(0, 4).toString("latin1"), f.file).toBe("wOFF");
      expect(bytes.byteLength, f.file).toBeGreaterThan(10_000);
    }
    const licence = (await readFile(flyerFontPath("OFL.txt"), "utf8")).replace(/\r\n/g, "\n");
    for (const family of [BUNDLED_DISPLAY, BUNDLED_BODY, LEGACY_DISPLAY, LEGACY_BODY, "Kaushan Script"]) expect(licence, family).toContain(`${family} (`);
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("a flyer with no brand faces is drawn in the kit's, from the bundled files", async () => {
    const set = await getFlyerFonts({ displayFont: FLYER_BRAND_DEFAULTS.displayFont, bodyFont: FLYER_BRAND_DEFAULTS.bodyFont }, "Spring celebration", { poster: true });
    expect(set.display).toBe("Bricolage Grotesque");
    expect(set.body).toBe("Hanken Grotesk");
    expect(set.notes).toEqual([]);
    const weights = (family: string) => set.fonts.filter((f) => f.name === family).map((f) => f.weight).sort((a, b) => a - b);
    expect(weights("Bricolage Grotesque")).toEqual([600, 700, 800]);
    expect(weights("Hanken Grotesk")).toEqual([400, 500, 700, 800]);
  });

  it("a community that chose Fraunces and DM Sans still gets them, without a request to Google", async () => {
    const set = await getFlyerFonts({ displayFont: "Fraunces", bodyFont: "DM Sans" }, "Spring celebration", { poster: true });
    expect(set.display).toBe("Fraunces");
    expect(set.body).toBe("DM Sans");
    expect(set.notes).toEqual([]);
    expect(set.fonts.some((f) => f.name === "Fraunces" && f.weight === 900)).toBe(true);
    expect(set.fonts.some((f) => f.name === "DM Sans" && f.weight === 800)).toBe(true);
  });
});
