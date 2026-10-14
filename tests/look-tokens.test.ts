import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The colours of the portal's two looks. Both read the Weaver brand kit (brand/tokens.json, through src/styles/brand-tokens.css);
// the redesigned look ([data-look="v2"] in src/app/globals.css) only keeps the names it was drawn with, each pointing at a kit token.
// Light mode only. Every text colour must be readable on the surface it is used on (WCAG AA, 4.5:1). The values are read from the
// stylesheets themselves, not copied here.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const css = read("../src/app/globals.css");

const SCOPE_OPEN = 'html:has([data-look="v2"]),\n[data-look="v2"],\n[data-v2-tokens] {\n';
const start = css.indexOf(SCOPE_OPEN);
const scope = css.slice(start + SCOPE_OPEN.length, css.indexOf("\n}\n", start));
const v2Section = css.slice(css.indexOf("Look v2 (the redesigned shell"), css.indexOf("Public website (src/app/site)"));

const declared = new Map<string, string>();
for (const text of [read("../src/styles/brand-tokens.css"), read("../src/styles/portal-tokens.css"), scope]) {
  for (const m of text.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) declared.set(m[1]!, m[2]!.trim());
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** A token's value as #rrggbb: follows var() references and works out color-mix(in srgb, <colour> N%, black|white). */
function resolve(value: string, from: string): string {
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (ref) {
    const next = declared.get(ref[1]!);
    if (next === undefined) throw new Error(`${from} points at ${ref[1]}, which is not defined`);
    return resolve(next, ref[1]!);
  }
  const mix = /^color-mix\(in srgb, (.+) (\d+)%, (black|white)\)$/.exec(value);
  if (mix) {
    const base = channels(resolve(mix[1]!, from));
    const other = mix[3] === "black" ? [0, 0, 0] : [255, 255, 255];
    const p = Number(mix[2]) / 100;
    return `#${base.map((c, i) => Math.round(c * p + other[i]! * (1 - p)).toString(16).padStart(2, "0")).join("")}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${from} is "${value}", which is not a colour this test can read`);
  return value.toLowerCase();
}

function value(name: string): string {
  const v = declared.get(name);
  if (v === undefined) throw new Error(`No stylesheet defines ${name}`);
  return resolve(v, name);
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
const color = (nameOrHex: string) => (nameOrHex.startsWith("#") ? nameOrHex : value(nameOrHex));

describe("the portal's colours are the brand kit's", () => {
  it("the v2 scope is found", () => {
    expect(start).toBeGreaterThan(0);
  });

  it("the classic names carry the kit's values", () => {
    expect(value("--color-navy")).toBe("#2b2a8a");
    expect(value("--color-navy-50")).toBe("#f1eefc");
    expect(value("--color-saffron")).toBe("#ff7640");
    expect(value("--color-canvas")).toBe("#fffaf5");
    expect(value("--color-line")).toBe("#eee3d9");
    expect(value("--color-ink")).toBe("#1e1d5c");
    expect(value("--color-muted")).toBe("#555a79");
    expect(value("--color-success")).toBe("#1f7a4d");
    expect(value("--color-danger")).toBe("#b3261e");
  });

  it("the redesigned look's names point at the same tokens, so the two looks differ in layout and not in colour", () => {
    expect(value("--v2-blue")).toBe(value("--color-navy"));
    expect(value("--v2-blue-tint")).toBe(value("--color-navy-50"));
    expect(value("--v2-page")).toBe(value("--color-canvas"));
    expect(value("--v2-ground")).toBe(value("--color-ground"));
    expect(value("--v2-line")).toBe(value("--color-line"));
    expect(value("--v2-ink")).toBe(value("--color-ink"));
    expect(value("--v2-muted")).toBe(value("--color-muted"));
    expect(value("--v2-sun-ink")).toBe(value("--color-brown"));
    expect(value("--v2-sun-tint")).toBe(value("--color-saffron-50"));
    expect(value("--v2-danger")).toBe(value("--color-danger"));
    expect(value("--v2-green")).toBe(value("--color-success"));
    // Written as references, never as a second copy of a value.
    for (const [name, v] of declared) {
      if (name.startsWith("--v2-") && name !== "--v2-sun") expect(v, name).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
  });

  it("has no dark mode and uses the sun gradient for Niva's button only", () => {
    expect(v2Section).not.toMatch(/prefers-color-scheme/);
    expect(v2Section.match(/var\(--v2-sun\)/g) ?? []).toHaveLength(1);
    expect(v2Section).toMatch(/\.v2-niva-orb \{[^}]*background: var\(--v2-sun\)/);
    // The gradient is gold to saffron, named once, in the token list.
    expect(declared.get("--v2-sun")).toBe("linear-gradient(135deg, var(--color-gold), var(--color-saffron))");
    expect(v2Section.match(/var\(--v2-sun-(from|to)\)/g) ?? []).toHaveLength(0);
  });
});

describe("text contrast is at least 4.5:1 on the surface it sits on", () => {
  const WHITE = "#ffffff";
  const surfaces = ["--v2-page", "--v2-ground", "--v2-blue-tint", "--color-highlight", "--color-frame", WHITE];
  // Accent text (green, brown, red) is never put on a switched-off button's fill, so it is checked on the surfaces it is used on.
  const cardSurfaces = ["--v2-page", "--v2-ground", "--v2-blue-tint", WHITE];

  const pairs: [string, string[]][] = [
    ["--v2-ink", surfaces],
    ["--v2-ink-2", surfaces],
    ["--v2-muted", surfaces],
    ["--v2-faint", surfaces],
    ["--v2-blue", surfaces],
    ["--v2-indigo", [...surfaces, "--v2-indigo-tint"]],
    ["--v2-lavender", [...surfaces, "--v2-lavender-tint"]],
    ["--v2-teal-ink", [...cardSurfaces, "--v2-teal-tint"]],
    ["--v2-teal", [WHITE, "--v2-page"]],
    ["--v2-green", [...cardSurfaces, "--v2-green-tint"]],
    ["--v2-green-ink", ["--v2-green-tint"]],
    ["--v2-sun-ink", [...cardSurfaces, "--color-highlight", "--color-frame", "--v2-sun-tint"]],
    ["--color-brown-900", ["--v2-sun-tint"]],
    ["--v2-danger", [WHITE, "--v2-page", "--v2-danger-tint"]],
    ["--color-danger-900", ["--v2-danger-tint"]],
    // Text on a filled button or badge
    [WHITE, ["--v2-blue", "--v2-blue-hover", "--v2-green", "--v2-sun-ink", "--v2-danger", "--color-danger-900", "--color-success-900"]],
    ["--color-navy-200", ["--v2-blue", "--v2-blue-hover"]],
    // The count badge on the navigation: ink on saffron (white on saffron is 2.6:1, which the kit forbids)
    ["--color-ink", ["--color-saffron"]],
    ["--color-navy-hover", ["--color-gold"]],
  ];

  for (const [fg, backgrounds] of pairs) {
    for (const bg of backgrounds) {
      it(`${fg} on ${bg}`, () => {
        const r = ratio(color(fg), color(bg));
        expect(r, `${color(fg)} on ${color(bg)} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("Niva's icon is readable on both ends of the sun gradient", () => {
    expect(ratio(color("--v2-ink"), color("--v2-sun-from"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color("--v2-ink"), color("--v2-sun-to"))).toBeGreaterThanOrEqual(4.5);
  });
});
