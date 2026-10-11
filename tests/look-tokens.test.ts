import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The colors of the redesigned look ([data-look="v2"] in src/app/globals.css): light mode only, and every text color must be
// readable on the surface it is used on (WCAG AA: 4.5:1). The values are read from the stylesheet itself, not copied here.
const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

const SCOPE_OPEN = 'html:has([data-look="v2"]),\n[data-look="v2"],\n[data-v2-tokens] {\n';
const start = css.indexOf(SCOPE_OPEN);
const scope = css.slice(start + SCOPE_OPEN.length, css.indexOf("\n}\n", start));
const v2Section = css.slice(css.indexOf("Look v2 (the redesigned shell"), css.indexOf("Public website (src/app/site)"));

const tokens = new Map<string, string>();
for (const m of scope.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) tokens.set(m[1], m[2].trim());

function value(name: string): string {
  let v = tokens.get(name);
  if (v === undefined) throw new Error(`The v2 scope does not define ${name}`);
  for (let i = 0; i < 5; i++) {
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
    if (!ref) break;
    v = tokens.get(ref[1]);
    if (v === undefined) throw new Error(`${name} points at ${ref[1]}, which is not defined`);
  }
  return v;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const color = (nameOrHex: string) => (nameOrHex.startsWith("#") ? nameOrHex : value(nameOrHex));

describe("the v2 scope", () => {
  it("is found, and defines the logo palette from the design", () => {
    expect(start).toBeGreaterThan(0);
    expect(value("--v2-blue")).toBe("#1c56b0");
    expect(value("--v2-blue-hover")).toBe("#164690");
    expect(value("--v2-blue-tint")).toBe("#e8f1fc");
    expect(value("--v2-blue-border")).toBe("#bbd3f2");
    expect(value("--v2-indigo")).toBe("#3d3bb8");
    expect(value("--v2-lavender")).toBe("#5a48b8");
    expect(value("--v2-teal")).toBe("#0e7c86");
    expect(value("--v2-green")).toBe("#17724a");
    expect(value("--v2-sun-from")).toBe("#ffb82a");
    expect(value("--v2-sun-to")).toBe("#ff7640");
    expect(value("--v2-sun-ink")).toBe("#a8400d");
    expect(value("--v2-danger")).toBe("#b3261e");
    expect(value("--v2-page")).toBe("#f3f7fb");
    expect(value("--v2-ground")).toBe("#f8fafd");
    expect(value("--v2-line")).toBe("#dde6f0");
    expect(value("--v2-line-input")).toBe("#cbd7e4");
    expect(value("--v2-ink")).toBe("#12203a");
  });

  it("points the portal's own token names at the palette, so pages inside the shell match", () => {
    expect(value("--color-navy")).toBe("#1c56b0");
    expect(value("--color-navy-50")).toBe("#e8f1fc");
    expect(value("--color-canvas")).toBe("#f3f7fb");
    expect(value("--color-line")).toBe("#dde6f0");
    expect(value("--color-ink")).toBe("#12203a");
    expect(value("--color-success")).toBe("#17724a");
    expect(value("--color-purple")).toBe("#5a48b8");
    expect(value("--color-maroon")).toBe("#3d3bb8");
    expect(value("--color-danger")).toBe("#b3261e");
  });

  it("leaves the classic tokens as they were", () => {
    const theme = css.slice(css.indexOf("@theme {"), css.indexOf("html {"));
    expect(theme).toContain("--color-navy: #1b2c5c;");
    expect(theme).toContain("--color-canvas: #f6f2ea;");
    expect(theme).toContain("--color-saffron: #c9731c;");
  });

  it("has no dark mode and uses the sun gradient for Niva's button only", () => {
    expect(v2Section).not.toMatch(/prefers-color-scheme/);
    expect(v2Section.match(/var\(--v2-sun\)/g) ?? []).toHaveLength(1);
    expect(v2Section).toMatch(/\.v2-niva-orb \{[^}]*background: var\(--v2-sun\)/);
    // The gradient's colors are named only in the token list (and as the gold token), never painted elsewhere.
    expect(v2Section.match(/var\(--v2-sun-(from|to)\)/g) ?? []).toHaveLength(1);
    expect(v2Section.match(/var\(--color-gold\)/g) ?? []).toHaveLength(0);
  });
});

describe("text contrast is at least 4.5:1 on the surface it sits on", () => {
  const WHITE = "#ffffff";
  const surfaces = ["--v2-page", "--v2-ground", "--v2-blue-tint", "--color-highlight", "--color-frame", WHITE];

  const pairs: [string, string[]][] = [
    ["--v2-ink", surfaces],
    ["--v2-ink-2", surfaces],
    ["--v2-muted", surfaces],
    ["--v2-faint", surfaces],
    ["--v2-blue", surfaces],
    ["--v2-indigo", [...surfaces, "--v2-indigo-tint"]],
    ["--v2-lavender", [...surfaces, "--v2-lavender-tint"]],
    ["--v2-teal-ink", [...surfaces, "--v2-teal-tint"]],
    ["--v2-teal", [WHITE, "--v2-page"]],
    ["--v2-green", [...surfaces, "--v2-green-tint"]],
    ["--v2-green-ink", ["--v2-green-tint"]],
    ["--v2-sun-ink", [...surfaces, "--v2-sun-tint"]],
    ["--color-brown-900", ["--v2-sun-tint"]],
    ["--color-purple-900", ["--v2-lavender-tint"]],
    ["--v2-danger", [WHITE, "--v2-page", "--v2-danger-tint"]],
    // Text on a filled button or badge
    [WHITE, ["--v2-blue", "--v2-blue-hover", "--v2-indigo", "--v2-lavender", "--v2-green", "--v2-sun-ink", "--v2-danger", "--v2-teal"]],
    ["--color-navy-200", ["--v2-blue", "--v2-blue-hover"]],
  ];

  for (const [fg, backgrounds] of pairs) {
    for (const bg of backgrounds) {
      it(`${fg} on ${bg}`, () => {
        const r = ratio(color(fg), color(bg));
        expect(r, `${color(fg)} on ${color(bg)} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("Niva's icon is readable on both ends of the sun gradient (3:1 for a graphic)", () => {
    expect(ratio(color("--v2-ink"), color("--v2-sun-from"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color("--v2-ink"), color("--v2-sun-to"))).toBeGreaterThanOrEqual(4.5);
  });
});
