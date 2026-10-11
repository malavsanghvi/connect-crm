import { describe, expect, it } from "vitest";

import { contrastRatio, extractFonts, extractPalette, googleFamilies, hsl, isNeutral, parseColor, toHex } from "../src/web/site/style";
import { extractPage } from "../src/web/site/extract";
import { buildReport, type OwnReport } from "../src/web/site/report";
import { fixtureHtml, siteBase } from "./site-fixtures";

describe("colours", () => {
  it("reads hex, rgb, rgba, hsl, with percentages, slashes and alpha", () => {
    expect(toHex(parseColor("#FA0")!)).toBe("#ffaa00");
    expect(toHex(parseColor("#8c1c13")!)).toBe("#8c1c13");
    expect(toHex(parseColor("rgb(140, 28, 19)")!)).toBe("#8c1c13");
    expect(toHex(parseColor("rgb(140 28 19 / 0.5)")!)).toBe("#8c1c13");
    expect(parseColor("rgba(0,0,0,0.2)")!.a).toBeCloseTo(0.2);
    expect(toHex(parseColor("hsl(0, 100%, 50%)")!)).toBe("#ff0000");
    expect(toHex(parseColor("hsl(120deg 100% 25%)")!)).toBe("#008000");
    expect(parseColor("red")).toBeNull();
    expect(parseColor("#12")).toBeNull();
  });
  it("tells brand colours from greys, near-white tints and near-black text", () => {
    for (const n of ["#ffffff", "#000000", "#777777", "#f4efe6", "#dfeedd", "#222222", "#26332b"]) expect(isNeutral(n), n).toBe(true);
    for (const c of ["#8c1c13", "#0b3d6b", "#e07b00", "#1f3b2d", "#2f6b3f"]) expect(isNeutral(c), c).toBe(false);
    expect(hsl(parseColor("#ff0000")!)).toMatchObject({ h: 0, s: 1 });
  });
  it("computes the contrast ratio the WCAG way", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the palette", () => {
  it("ranks the colours the CSS actually uses, backgrounds and buttons above text", () => {
    const css = `body{background:#fff8ec;color:#2b2118} .btn{background-color:#f2a900;color:#2b2118} .site-header{background:#8c1c13;color:#fff} footer{background:#2b2118}
      h1{color:#8c1c13} a{color:#8c1c13} .x{border:1px solid #8c1c13}`;
    const p = extractPalette({ themeColors: [], css: [css], inline: [] });
    const roles = Object.fromEntries(p.colors.map((c) => [c.role, c.hex]));
    expect(roles["primary"]).toBe("#8c1c13");
    expect(roles["secondary"]).toBe("#f2a900");
    expect(roles["text"]).toBe("#2b2118");
    expect(p.colors.find((c) => c.hex === "#fff8ec")?.role).toBe("background");
    expect(p.colors.reduce((s, c) => s + c.share, 0)).toBeLessThanOrEqual(1.01);
  });
  it("trusts the theme-color meta tag and variables named primary over a pile of other colours", () => {
    const css = `:root{--brand-primary:#0b3d6b;--gap:#e0e0e0} ${".a{color:#ff00aa}\n".repeat(4)}`;
    const p = extractPalette({ themeColors: ["#0b3d6b"], css: [css], inline: [] });
    expect(p.colors[0]).toMatchObject({ hex: "#0b3d6b", role: "primary" });
    expect(p.theme_color).toBe("#0b3d6b");
    expect(p.sources.theme_meta).toBe(1);
    expect(p.sources.variables).toBeGreaterThan(0);
  });
  it("merges colours that are nearly the same and ignores transparent ones and comments", () => {
    const css = `.a{color:#8c1c13}.b{color:#8d1c14}.c{color:rgba(255,0,0,0.1)} /* .d{color:#00ff00} */ .e{background:#8c1c13}`;
    const p = extractPalette({ themeColors: [], css: [css], inline: [] });
    expect(p.colors.filter((c) => c.role === "primary" || c.role === "secondary")).toHaveLength(1);
    expect(p.colors.some((c) => c.hex === "#00ff00" || c.hex === "#ff0000")).toBe(false);
  });
  it("reads inline style attributes and @font-face blocks are not colours", () => {
    const p = extractPalette({ themeColors: [], css: ["@font-face{font-family:X;src:url(x.woff);color:#123456}"], inline: ["background-color:#2e9e6f;color:#fff", "background:#2e9e6f"] });
    expect(p.colors[0]).toMatchObject({ hex: "#2e9e6f", role: "primary" });
    expect(p.colors.some((c) => c.hex === "#123456")).toBe(false);
  });
  it("writes a contrast note in plain words, with the verdict", () => {
    const good = extractPalette({ themeColors: ["#0b3d6b"], css: ["body{background:#ffffff;color:#222222}"], inline: [] });
    expect(good.contrast[0]).toMatchObject({ pair: ["#ffffff", "#0b3d6b"], passes_aa: true });
    expect(good.contrast[0]!.note).toMatch(/^White on the main colour: \d+(\.\d+)?:1, easy to read at any size\.$/);
    const weak = extractPalette({ themeColors: ["#e07b00"], css: [], inline: [] });
    expect(weak.contrast[0]!.passes_aa).toBe(false);
    expect(weak.contrast[0]!.note).toMatch(/readable only as large text or on buttons/);
    const faint = extractPalette({ themeColors: ["#f2a900"], css: [], inline: [] });
    expect(faint.contrast[0]!.note).toMatch(/too faint for text/);
  });
  it("gives an empty palette for a page with no colours instead of failing", () => {
    expect(extractPalette({ themeColors: [], css: [], inline: [] })).toMatchObject({ colors: [], theme_color: null, contrast: [] });
  });
});

describe("fonts", () => {
  it("reads Google Fonts addresses (old and new form) and Bunny fonts", () => {
    expect(googleFamilies("https://fonts.googleapis.com/css?family=Open+Sans:400,700|Lora:400i&display=swap")).toEqual(["Open Sans", "Lora"]);
    expect(googleFamilies("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=Lato:wght@400;700&display=swap")).toEqual(["Cormorant Garamond", "Lato"]);
    expect(googleFamilies("not an address")).toEqual([]);
  });
  it("finds the heading and body fonts from the rules that use them", () => {
    const css = `body{font-family:'Lato', Arial, sans-serif} h1,h2,h3{font-family:"Playfair Display",Georgia,serif} p{font-family:Lato,sans-serif} .fa{font-family:"Font Awesome 5 Free"} code{font-family:monospace}`;
    const f = extractFonts({ css: [css], inline: [], links: [] });
    expect(f).toMatchObject({ heading: "Playfair Display", body: "Lato" });
    expect(f.fonts.map((x) => x.name)).toEqual(["Lato", "Playfair Display"]);
  });
  it("counts @font-face fonts, font variables, Google and Typekit links, and not icon fonts or system stacks", () => {
    const css = `@font-face{font-family:"Brand Sans";src:url(b.woff2)} :root{--font-heading:"Brand Serif",serif;--font-size:16px} body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif} .i{font-family:dashicons}`;
    const f = extractFonts({ css: [css], inline: [], links: ["https://fonts.googleapis.com/css?family=Merriweather", "https://use.typekit.net/abc.css"] });
    expect(f.fonts.map((x) => [x.name, x.source])).toEqual(expect.arrayContaining([["Merriweather", "google"], ["Brand Sans", "font-face"], ["Brand Serif", "css"], ["Adobe Fonts", "typekit"]]));
    expect(f.fonts.some((x) => /apple|segoe|dashicons/i.test(x.name))).toBe(false);
    expect(f.heading).toBe("Brand Serif");
  });
  it("calls one lone font the body font, and does not guess otherwise", () => {
    expect(extractFonts({ css: [], inline: [], links: ["https://fonts.googleapis.com/css?family=Nunito"] })).toMatchObject({ heading: null, body: "Nunito" });
    expect(extractFonts({ css: [], inline: [], links: [] })).toEqual({ fonts: [], heading: null, body: null });
  });
});

describe("the look of the invented sites", () => {
  const home = (site: string) => extractPage(fixtureHtml(site, "home.html"), siteBase(site) + "/", { isStart: true });
  const look = (site: string, css: string[] = []) => (buildReport({ mode: "own", startUrl: siteBase(site) + "/", pages: [home(site)], css, stats: { pages_fetched: 1, pages_in_sitemap: 0, sitemap_used: false, stopped_by: "done", bytes: 0, elapsed_ms: 0, skipped: { robots: 0, off_site: 0, off_site_redirect: 0, files: 0, errors: 0 }, css_files_read: css.length }, notes: [] }) as OwnReport).look;
  it("finds the temple's maroon and saffron, and its two Google fonts", () => {
    const l = look("temple");
    expect(l.palette.colors[0]).toMatchObject({ hex: "#8c1c13", role: "primary" });
    expect(l.palette.colors.find((c) => c.role === "secondary")?.hex).toBe("#f2a900");
    expect(l.palette.theme_color).toBe("#8c1c13");
    expect(l.fonts).toMatchObject({ heading: "Cormorant Garamond", body: "Lato" });
  });
  it("finds the chamber's blue from the page builder's variables and its fonts from the Google link", () => {
    const l = look("chamber");
    expect(l.palette.colors[0]).toMatchObject({ hex: "#0b3d6b", role: "primary" });
    expect(l.palette.colors.find((c) => c.role === "secondary")?.hex).toBe("#e07b00");
    expect(l.fonts.fonts.map((f) => f.name).sort()).toEqual(["Merriweather", "Montserrat"]);
    expect(l.logo_candidates[0]!.url).toContain("chamber-logo.png");
  });
  it("reads a linked stylesheet too (the crawl fetches the site's own)", () => {
    const l = look("club", [".navbar{background:#2f6b3f}.accent{color:#c8553d;border-color:#c8553d}.btn{background:#c8553d}"]);
    expect(l.palette.colors.map((c) => c.hex)).toContain("#c8553d");
    expect(l.palette.colors[0]!.hex).toBe("#2f6b3f");
  });
});
