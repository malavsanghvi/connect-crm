// Writes four files from the Weaver brand kit (brand/tokens.json and brand/icons/*.svg), so the kit is the one source of the colours,
// faces, radii, shadows, layout sizes and icons the portal and the website use:
//   src/styles/brand-tokens.css              the CSS variables and Tailwind theme (colour, type, radius, shadow, layout)
//   src/lib/brand-tokens.generated.ts        the colours and shadows as constants, for code that cannot read a CSS variable
//   brand/weaver-tokens.css                  the kit's own preview stylesheet (variables and the type styles as classes)
//   src/components/brand/icons.generated.ts  the markup of every icon in brand/icons, for the Icon component
//
//   node scripts/sync-brand-tokens.mjs           writes all four
//   node scripts/sync-brand-tokens.mjs --check   exits 1 when a committed file is not what the kit produces
//
// tests/brand-conformance.test.ts runs the same check, so a change to tokens.json without a run of this script fails CI.
// The member app and the event-day app keep a verbatim copy of brand/tokens.json and read their own values from it
// (brand/MAINTAINING.md says how the copy is kept current).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const TOKENS_PATH = join(here, "../brand/tokens.json");
export const OUTPUT_PATH = join(here, "../src/styles/brand-tokens.css");
export const TS_OUTPUT_PATH = join(here, "../src/lib/brand-tokens.generated.ts");
export const KIT_CSS_PATH = join(here, "../brand/weaver-tokens.css");
export const ICONS_DIR = join(here, "../brand/icons");
export const ICONS_TS_PATH = join(here, "../src/components/brand/icons.generated.ts");

/** A token value that points at another colour, "{gold}", becomes a reference to that colour's variable. */
function colourValue(value) {
  const ref = /^\{([a-z0-9-]+)\}$/.exec(value);
  return ref ? `var(--color-${ref[1]})` : value;
}

/**
 * The font stack for a family. next/font names the face it serves after a hash, so the stack starts with the variable the root
 * layout sets (`--font-bricolage` for "Bricolage Grotesque", `--font-hanken` for "Hanken Grotesk") and keeps the kit's own stack
 * behind it as the fallback.
 */
function fontStack(stack) {
  const first = /^"([^"]+)"/.exec(stack)?.[1];
  if (!first) throw new Error(`The font stack "${stack}" does not start with a quoted family name.`);
  return `var(--font-${first.split(" ")[0].toLowerCase()}), ${stack}`;
}

/** The generated stylesheet for a parsed tokens.json. Pure, so the test can compare it with the committed file. */
export function buildBrandTokensCss(tokens) {
  const lines = [];
  const add = (s = "") => lines.push(s);

  add("/*");
  add(" * GENERATED FILE. Do not edit it by hand.");
  add(" * Source: brand/tokens.json (the Weaver brand kit). Regenerate with: node scripts/sync-brand-tokens.mjs");
  add(" * tests/brand-conformance.test.ts fails when this file and tokens.json disagree.");
  add(" *");
  add(" * `static` keeps every token in the built stylesheet even when no utility uses it yet, so a plain CSS rule or an inline");
  add(" * style can read var(--color-navy) and the rest.");
  add(" */");
  add("@theme static {");
  add("  /* Colour */");
  for (const t of tokens.color.tokens) add(`  --color-${t.name}: ${colourValue(t.value)};`);
  add();
  add("  /* Type */");
  for (const [name, stack] of Object.entries(tokens.type.families)) add(`  --font-${name}: ${fontStack(stack)};`);
  add();
  add("  /* Shape */");
  for (const t of tokens.radius.tokens) add(`  --${t.name}: ${t.value};`);
  add();
  add("  /* Elevation */");
  for (const t of tokens.shadow.tokens) add(`  --${t.name}: ${t.value};`);
  add("}");
  add();
  add(":root {");
  add("  /* Layout */");
  for (const t of tokens.spacing.tokens) add(`  --${t.name}: ${t.value};`);
  add("}");
  return `${lines.join("\n")}\n`;
}

/** The constants module for a parsed tokens.json: every colour (references resolved), every shadow, and the text face's stack. */
export function buildBrandTokensTs(tokens) {
  const byName = new Map(tokens.color.tokens.map((t) => [t.name, t.value]));
  const resolve = (value) => {
    const ref = /^\{([a-z0-9-]+)\}$/.exec(value);
    return ref ? resolve(byName.get(ref[1])) : value;
  };
  const entries = (pairs) => pairs.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
  return [
    "// GENERATED FILE. Do not edit it by hand.",
    "// Source: brand/tokens.json (the Weaver brand kit). Regenerate with: node scripts/sync-brand-tokens.mjs",
    "// tests/brand-conformance.test.ts fails when this file and tokens.json disagree.",
    "",
    "export const BRAND_COLORS = {",
    entries(tokens.color.tokens.map((t) => [t.name, resolve(t.value)])),
    "} as const;",
    "",
    "export const BRAND_SHADOWS = {",
    entries(tokens.shadow.tokens.map((t) => [t.name, t.value])),
    "} as const;",
    "",
    `export const BRAND_SANS_STACK = ${JSON.stringify(tokens.type.families.sans)};`,
    "",
  ].join("\n");
}

/** The kit's own stylesheet: the tokens as plain CSS variables and every type style as a class. The brand previews read it. */
export function buildKitCss(tokens) {
  const lines = ["/* Weaver Brand Kit: design tokens as CSS variables (generated from tokens.json by scripts/sync-brand-tokens.mjs). */"];
  const add = (s) => lines.push(s);
  add(
    '@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap");',
  );
  add(":root {");
  for (const t of tokens.color.tokens) add(`  --${t.name}: ${t.value.startsWith("{") ? `var(--${t.value.slice(1, -1)})` : t.value};`);
  for (const [name, stack] of Object.entries(tokens.type.families)) add(`  --font-${name}: ${stack};`);
  for (const t of tokens.spacing.tokens) add(`  --${t.name}: ${t.value};`);
  for (const t of tokens.radius.tokens) add(`  --${t.name}: ${t.value};`);
  for (const t of tokens.shadow.tokens) add(`  --${t.name}: ${t.value};`);
  add("}");
  for (const group of tokens.type.groups) {
    for (const s of group.styles) {
      const parts = [`font-family: var(--font-${group.family})`, `font-size: ${s.fontSize}`, `line-height: ${s.lineHeight}`, `font-weight: ${s.fontWeight}`];
      if (s.letterSpacing) parts.push(`letter-spacing: ${s.letterSpacing}`);
      add(`.${s.name} { ${parts.join("; ")}; }`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The icons in brand/icons, each as its inner markup. Every file must carry the kit's root (24px grid, navy ink, stroke 2, round caps). */
export function readIcons(tokens, dir = ICONS_DIR) {
  const navy = tokens.color.tokens.find((t) => t.name === "navy").value;
  const root = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${navy}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".svg"))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim();
      if (!text.startsWith(root) || !text.endsWith("</svg>")) throw new Error(`brand/icons/${file} does not have the kit's root element`);
      const inner = text.slice(root.length, -"</svg>".length).split("\n").map((l) => l.trim()).join("");
      return [file.replace(/\.svg$/, ""), inner];
    });
}

/** The generated module for the Icon component. */
export function buildIconsTs(icons) {
  return [
    "// GENERATED FILE. Do not edit it by hand.",
    "// Source: brand/icons/*.svg (the Weaver brand kit's icons). Regenerate with: node scripts/sync-brand-tokens.mjs",
    "// tests/brand-conformance.test.ts fails when this file and the icon files disagree.",
    "",
    "export const ICON_MARKUP = {",
    ...icons.map(([name, markup]) => `  ${JSON.stringify(name)}: ${JSON.stringify(markup)},`),
    "} as const;",
    "",
    "export type IconName = keyof typeof ICON_MARKUP;",
    "",
  ].join("\n");
}

export function readTokens() {
  return JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tokens = readTokens();
  const files = [
    [OUTPUT_PATH, buildBrandTokensCss(tokens)],
    [TS_OUTPUT_PATH, buildBrandTokensTs(tokens)],
    [KIT_CSS_PATH, buildKitCss(tokens)],
    [ICONS_TS_PATH, buildIconsTs(readIcons(tokens))],
  ];
  if (process.argv.includes("--check")) {
    const stale = files.filter(([path, text]) => readFileSync(path, "utf8").replace(/\r\n/g, "\n") !== text);
    if (stale.length > 0) {
      console.error(`${stale.map(([path]) => path).join(", ")} out of date with brand/tokens.json. Run: node scripts/sync-brand-tokens.mjs`);
      process.exit(1);
    }
    console.log("The generated brand token files match brand/tokens.json");
  } else {
    for (const [path, text] of files) {
      writeFileSync(path, text);
      console.log(`Wrote ${path}`);
    }
  }
}
