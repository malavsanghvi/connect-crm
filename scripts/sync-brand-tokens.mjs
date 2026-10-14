// Writes two files from brand/tokens.json (the Weaver brand kit), so the kit's JSON is the one source of the colours, faces, radii,
// shadows and layout sizes the portal and the website use:
//   src/styles/brand-tokens.css          the CSS variables and Tailwind theme (colour, type, radius, shadow, layout)
//   src/lib/brand-tokens.generated.ts    the colours and shadows as constants, for code that cannot read a CSS variable
//
//   node scripts/sync-brand-tokens.mjs           writes both
//   node scripts/sync-brand-tokens.mjs --check   exits 1 when a committed file is not what tokens.json produces
//
// tests/brand-conformance.test.ts runs the same check, so a change to tokens.json without a run of this script fails CI.
// The member app and the event-day app keep a verbatim copy of brand/tokens.json and read their own values from it
// (brand/MAINTAINING.md says how the copy is kept current).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const TOKENS_PATH = join(here, "../brand/tokens.json");
export const OUTPUT_PATH = join(here, "../src/styles/brand-tokens.css");
export const TS_OUTPUT_PATH = join(here, "../src/lib/brand-tokens.generated.ts");

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

export function readTokens() {
  return JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tokens = readTokens();
  const files = [
    [OUTPUT_PATH, buildBrandTokensCss(tokens)],
    [TS_OUTPUT_PATH, buildBrandTokensTs(tokens)],
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
