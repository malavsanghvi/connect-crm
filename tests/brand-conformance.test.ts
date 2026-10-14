import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { brandColor, type BrandColorName } from "@/lib/brand-colors";
import { EMAIL_PALETTE } from "@/lib/messaging/email";
import { buildPledgeDocument } from "@/lib/pledge-pdf/document";

import {
  ICONS_TS_PATH,
  KIT_CSS_PATH,
  OUTPUT_PATH,
  TS_OUTPUT_PATH,
  buildBrandTokensCss,
  buildBrandTokensTs,
  buildIconsTs,
  buildKitCss,
  readIcons,
  readTokens,
} from "../scripts/sync-brand-tokens.mjs";

// Keeps the portal and the website on the Weaver brand kit (brand/: README.md, tokens.json, logos, icons, components).
// docs/BRAND_CONFORMANCE.md says what was brought onto the kit and what waits for an owner decision; brand/MAINTAINING.md says how
// to run this test and how the tokens reach the other apps. Every allowlist line below says why it is there: keep the list short,
// and fix a finding rather than allow it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function* walk(dir: string, extensions: RegExp): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== ".next") yield* walk(path, extensions);
    } else if (extensions.test(name)) {
      yield path;
    }
  }
}

const SOURCE = [...walk(join(ROOT, "src"), /\.(?:tsx?|css|svg)$/)].map((path) => ({ path, rel: relative(ROOT, path).replace(/\\/g, "/") }));
const CODE = SOURCE.filter((f) => /\.tsx?$/.test(f.rel));

/** The text with its comments blanked out (line numbers stay), so a note that quotes an old value does not count. */
function withoutComments(source: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return source
    .replace(/(^|[\s{(;,])\/\*[\s\S]*?\*\//gm, (m) => blank(m))
    .replace(/(^|\s)\/\/.*$/gm, (m) => blank(m));
}

const tokens = readTokens() as { color: { tokens: { name: string; value: string }[] } };
const KIT_HEX = new Set(tokens.color.tokens.map((t) => brandColor(t.name as BrandColorName).toLowerCase()));

// ─── (a) Colours ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Files that may hold a colour value of their own, and why. Everything else uses a token, or a value that is the kit's own. */
const COLOUR_ALLOWLIST: { match: (rel: string) => boolean; why: string }[] = [
  { match: (r) => r === "src/styles/brand-tokens.css" || r === "src/lib/brand-tokens.generated.ts", why: "Generated from brand/tokens.json (the kit's shadows hold rgba values); the test below keeps both equal to the kit." },
  { match: (r) => r === "src/styles/portal-tokens.css", why: "Three module hues the kit has no colour for (maroon, purple, store), waiting for owner decision D4." },
  { match: (r) => r === "src/components/brand/weaver-mark.tsx" || r === "src/app/icon.svg", why: "The logo's own artwork: its gradient stops are the mark, not interface colours." },
  { match: (r) => r.startsWith("src/lib/events/"), why: "Event flyer artwork and each community's own flyer palettes: a community's output, not Weaver's chrome (decision D7)." },
  { match: (r) => r.startsWith("src/lib/site-draft/"), why: "The community's own website draft: its theme palettes are the community's identity." },
  { match: (r) => r === "src/app/dev/event-flyer-panel/fixtures.ts", why: "Sample community brands for the flyer developer preview." },
  { match: (r) => r === "src/lib/setup.ts", why: "Contrast helper for a community's own colours: it picks black-ish or white text for whatever colour the community chose." },
];

// Three, six and eight digits: a four-digit "#4417" is a check number, not a colour.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;
const CSS_FUNCTION = /\b(?:rgba?|hsla?)\(\s*\d[^)]*\)/g;

function normalise(hex: string): string {
  let h = hex.slice(1).toLowerCase();
  if (h.length === 3 || h.length === 4) h = h.replace(/./g, "$&$&");
  return `#${h.slice(0, 6)}`;
}

describe("(a) colours come from the brand kit", () => {
  it("no colour value appears outside the kit's own values, except in the allowlisted files", () => {
    const found: string[] = [];
    for (const { path, rel } of SOURCE) {
      if (COLOUR_ALLOWLIST.some((a) => a.match(rel))) continue;
      const text = withoutComments(readFileSync(path, "utf8"));
      text.split(/\r?\n/).forEach((line, i) => {
        for (const m of line.match(HEX) ?? []) if (!KIT_HEX.has(normalise(m))) found.push(`${rel}:${i + 1}  ${m}`);
        for (const m of line.match(CSS_FUNCTION) ?? []) found.push(`${rel}:${i + 1}  ${m}`);
      });
    }
    expect(found, "Use a token (bg-navy, text-muted, var(--color-line)) or brandColor() from src/lib/brand-colors.ts").toEqual([]);
  });

  it("every allowlist line still points at something", () => {
    for (const a of COLOUR_ALLOWLIST) expect(SOURCE.some((f) => a.match(f.rel)), a.why).toBe(true);
  });

  it("no utility reaches for Tailwind's own palette, and the logo's colours (mark-*) stay out of the interface", () => {
    const palette =
      /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|accent|decoration|shadow|placeholder|caret)-(?:(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|fuchsia|pink|rose)-\d{2,3}|purple-(?!50\b|900\b)\d{2,3})(?![\w-])/;
    const mark = /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-mark-(?:teal|blue|green|deep-blue|indigo|lavender|sun-top|sun-bottom)\b/;
    const found: string[] = [];
    for (const { path, rel } of CODE) {
      withoutComments(readFileSync(path, "utf8")).split(/\r?\n/).forEach((line, i) => {
        if (palette.test(line)) found.push(`${rel}:${i + 1}  Tailwind palette colour`);
        if (mark.test(line)) found.push(`${rel}:${i + 1}  mark-* colour in the interface`);
      });
    }
    expect(found).toEqual([]);
  });

  it("saffron is never text, and the type tops out at weight 700 (the kit's README: Colour, Type)", () => {
    const found: string[] = [];
    for (const { path, rel } of CODE) {
      if (rel.startsWith("src/lib/events/")) continue;
      withoutComments(readFileSync(path, "utf8")).split(/\r?\n/).forEach((line, i) => {
        if (/\btext-saffron\b(?!-)/.test(line)) found.push(`${rel}:${i + 1}  text-saffron (use text-brown)`);
        if (/\bfont-(?:extrabold|black)\b/.test(line)) found.push(`${rel}:${i + 1}  weight above 700`);
      });
    }
    for (const rel of ["src/app/globals.css", "src/app/site/site.css"]) {
      read(rel).split("\n").forEach((line, i) => {
        if (/font-weight:\s*[89]00\b/.test(line)) found.push(`${rel}:${i + 1}  weight above 700`);
      });
    }
    expect(found).toEqual([]);
  });

  it("the places that cannot read a variable use the kit's values", () => {
    expect(EMAIL_PALETTE).toEqual({
      page: brandColor("canvas"),
      ink: brandColor("ink"),
      muted: brandColor("muted"),
      line: brandColor("line"),
      fallbackPrimary: brandColor("navy"),
      noticeBg: brandColor("saffron-50"),
      noticeBorder: brandColor("saffron-200"),
      noticeInk: brandColor("brown-900"),
    });
    // A pledge document for a community with no colours of its own carries Weaver's.
    const plain = buildPledgeDocument({ center: { name: "Bare Club", country: "US", branding: {} }, pledge: { amount_cents: 500 } });
    expect(plain.brand).toEqual({ primary: brandColor("navy").toUpperCase(), accent: brandColor("brown").toUpperCase() });
  });
});

// ─── (c) The generated token file ───────────────────────────────────────────────────────────────────────────────────────────

describe("(c) the generated token file", () => {
  it("src/styles/brand-tokens.css and src/lib/brand-tokens.generated.ts are what brand/tokens.json produces (run: node scripts/sync-brand-tokens.mjs)", () => {
    expect(readFileSync(OUTPUT_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(buildBrandTokensCss(readTokens()));
    expect(readFileSync(TS_OUTPUT_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(buildBrandTokensTs(readTokens()));
  });

  it("the portal's stylesheet imports it, and the faces it names are the ones the root layout loads", () => {
    const globals = read("src/app/globals.css");
    expect(globals).toContain('@import "../styles/brand-tokens.css";');
    expect(globals).toContain('@import "../styles/portal-tokens.css";');
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("Bricolage_Grotesque");
    expect(layout).toContain("Hanken_Grotesk");
    const generated = read("src/styles/brand-tokens.css");
    expect(generated).toContain("--font-display: var(--font-bricolage)");
    expect(generated).toContain("--font-sans: var(--font-hanken)");
    expect(layout).toContain('variable: "--font-bricolage"');
    expect(layout).toContain('variable: "--font-hanken"');
    expect(layout).toContain('variable: "--font-jetbrains"');
    expect(generated).toContain("--font-mono: var(--font-jetbrains)");
  });

  it("the kit's own stylesheet (brand/weaver-tokens.css) is what tokens.json produces", () => {
    expect(readFileSync(KIT_CSS_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(buildKitCss(readTokens()));
  });

  it("no stylesheet or layout loads a face the kit does not name (the kit has Bricolage Grotesque, Hanken Grotesk and JetBrains Mono)", () => {
    const loaders = CODE.filter((f) => /from "next\/font\/google"/.test(readFileSync(f.path, "utf8")));
    expect(loaders.map((f) => f.rel)).toEqual(["src/app/layout.tsx"]);
    expect(read("src/app/layout.tsx").match(/import \{([^}]+)\} from "next\/font\/google"/)![1]!.split(",").map((s) => s.trim()).sort()).toEqual([
      "Bricolage_Grotesque",
      "Hanken_Grotesk",
      "JetBrains_Mono",
    ]);
  });
});

// ─── (d) The logo and the icons ─────────────────────────────────────────────────────────────────────────────────────────────

describe("(d) the official logo files are in place", () => {
  const LOGO_FILES = [
    "weaver-mark.svg",
    "weaver-mark-256.png",
    "weaver-mark-512.png",
    "weaver-mark-1024.png",
    "weaver-mark-on-white-1024.png",
    "weaver-logo.png",
    "weaver-logo-on-indigo.png",
  ];

  it("the kit holds every logo file, and the website serves the same downloads", () => {
    for (const file of LOGO_FILES) {
      expect(existsSync(join(ROOT, "brand/logos", file)), `brand/logos/${file}`).toBe(true);
      expect(existsSync(join(ROOT, "public/brand", file)), `public/brand/${file}`).toBe(true);
    }
  });

  it("the favicon, the app icon and the kit's master file are one drawing", () => {
    const icon = read("src/app/icon.svg");
    expect(read("brand/logos/weaver-mark.svg")).toBe(icon);
    expect(read("public/brand/weaver-mark.svg")).toBe(icon);
    expect(existsSync(join(ROOT, "src/app/apple-icon.tsx"))).toBe(true);
    // favicon.ico is an ICO that holds the mark as a PNG.
    const ico = readFileSync(join(ROOT, "src/app/favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0);
    expect(read("src/app/apple-icon.tsx")).toContain("weaverMarkSvg");
  });

  it("the share image draws the mark and the kit's lines, not a copy of its own", () => {
    const og = read("src/app/site/opengraph-image.tsx");
    expect(og).toContain("weaverMarkSvg");
    expect(og).toContain("GENEROSITY_LINE");
    expect(og).toContain("PRODUCT_DESCRIPTOR");
    expect(og).toContain("Do more good. Weaver handles the operations.");
    expect(og).toContain("For free. Forever.");
  });

  it("the icons are in the kit, every file has the kit's root, and the Icon component is generated from them", () => {
    const icons = readdirSync(join(ROOT, "brand/icons")).filter((f) => f.endsWith(".svg"));
    expect(icons).toHaveLength(42);
    // readIcons throws on a file whose root is not the kit's (24px grid, navy ink, stroke 2, round caps).
    expect(readIcons(readTokens()).map(([name]) => name)).toEqual(icons.map((f) => f.replace(/\.svg$/, "")).sort());
    expect(readFileSync(ICONS_TS_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(buildIconsTs(readIcons(readTokens())));
  });

  it("every place that shows the Weaver mark draws it with the component (no second drawing of the W)", () => {
    const drawings = CODE.filter((f) => f.rel !== "src/components/brand/weaver-mark.tsx" && /WEAVER_SILHOUETTE_D|M370,535 C520,535/.test(readFileSync(f.path, "utf8")));
    expect(drawings.map((f) => f.rel)).toEqual([]);
    // Over navy the mark sits on its white tile (the kit's LogoTile), never bare.
    expect(read("src/components/brand/logo.tsx")).toContain("rounded-logo-tile");
    for (const page of ["src/app/login/page.tsx", "src/components/onboarding-split.tsx", "src/app/demo/page.tsx"]) expect(read(page), page).toContain("LogoTile");
  });
});

// ─── The kit's own contrast claims ──────────────────────────────────────────────────────────────────────────────────────────

describe("the kit's new tokens keep the contrast the README promises", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: BrandColorName, b: BrandColorName) => {
    const [hi, lo] = [lum(brandColor(a)), lum(brandColor(b))].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const atLeast: [BrandColorName, BrandColorName, number][] = [
    // text
    ["faint", "white", 4.5], ["faint", "canvas", 4.5], ["faint", "ground", 4.5], ["faint", "navy-50", 4.5], ["faint", "saffron-50", 4.5],
    ["white", "saffron-strong", 4.5], ["saffron-strong", "canvas", 4.5],
    ["warning", "white", 4.5], ["warning", "canvas", 4.5], ["warning", "warning-50", 4.5],
    ["warning-ink", "warning-50", 7], ["warning-ink", "warning-200", 7],
    // a control's border (WCAG 1.4.11)
    ["line-control", "white", 3], ["line-control", "canvas", 3], ["line-control", "ground", 3],
  ];
  for (const [fg, bg, min] of atLeast) {
    it(`${fg} on ${bg} is at least ${min}:1`, () => {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min);
    });
  }
  it("saffron on its own still fails white text, which is why saffron-strong exists", () => {
    expect(ratio("white", "saffron")).toBeLessThan(3);
    expect(ratio("brown", "white")).toBeGreaterThanOrEqual(4.5);
  });
});

// ─── (b) and (e) Words ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the old product name is kept on purpose, and why. */
const OLD_NAME_ALLOWLIST: { file: string; why: string }[] = [
  { file: "src/lib/qbo/setup.ts", why: 'The QuickBooks marker "Community Connect test post" is written by migration 0234; the instructions must match it (docs/DECISIONS.md, product name row).' },
  { file: "src/app/(app)/accounting/qbo/setup/page.tsx", why: "The same QuickBooks marker, in the confirmation the treasurer ticks." },
  { file: "src/lib/security.ts", why: "CC_FIRST_ADMIN_REASON is the audit reason written by migration 0400 and asserted by supabase/tests/32." },
  { file: "src/lib/payments/change-control.ts", why: 'Reads the database\'s own message "Community Connect has paused ..." (migrations 0580, 0597), which is already applied.' },
  { file: "src/lib/modules.ts", why: 'The WhatsApp Business module is labelled "CommunityConnect" (decision D6 in docs/BRAND_CONFORMANCE.md): the owner chooses the new label.' },
];

describe("(b) the product is called Weaver", () => {
  it('"Community Connect" (and "CommunityConnect") appears in no string a person reads, outside the allowlist', () => {
    const found: string[] = [];
    for (const { path, rel } of CODE) {
      if (OLD_NAME_ALLOWLIST.some((a) => a.file === rel)) continue;
      // Joined, so a sentence broken across two lines is still seen.
      const text = withoutComments(readFileSync(path, "utf8"));
      for (const m of text.matchAll(/Community\s*Connect/g)) found.push(`${rel}:${text.slice(0, m.index).split("\n").length}`);
    }
    expect(found, "Say Weaver").toEqual([]);
  });

  it('"Connect" never stands for the product ("Connect approves", "the Connect team")', () => {
    const found: string[] = [];
    const asProduct = /\b(?:Connect(?:'s|’s)? (?:approves|team|admins?|support|staff|sends|keeps|reviews)|(?:the|ask|by) Connect (?:team|admin|support))\b/;
    for (const { path, rel } of CODE) {
      withoutComments(readFileSync(path, "utf8")).split("\n").forEach((line, i) => {
        if (asProduct.test(line)) found.push(`${rel}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("every allowlisted file still holds the name it is allowed to (so the list cannot go stale)", () => {
    for (const a of OLD_NAME_ALLOWLIST) expect(/Community\s*Connect/.test(readFileSync(join(ROOT, a.file), "utf8")), `${a.file}: ${a.why}`).toBe(true);
  });
});

describe("(e) voice", () => {
  /** The pages of the website and the public pages of the portal, where the kit's voice rules apply word for word. */
  const PUBLIC = CODE.filter((f) => /^src\/(?:app\/(?:site|login|request-access|demo|start)|components\/(?:site|onboarding-split))/.test(f.rel) || f.rel === "src/lib/site.ts" || f.rel === "src/lib/brand.ts");

  it('says "pledge", never "bid" (the assistant\'s own instruction line quotes the forbidden word)', () => {
    const found: string[] = [];
    for (const { path, rel } of CODE) {
      if (rel === "src/lib/assistant/prompt.ts") continue;
      withoutComments(readFileSync(path, "utf8")).split("\n").forEach((line, i) => {
        if (/["'`>][^"'`<]*\b(?:bids?|bidding)\b[^"'`<]*["'`<]/i.test(line)) found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("no emoji anywhere in the source", () => {
    const found = CODE.filter((f) => /\p{Emoji_Presentation}|️/u.test(withoutComments(readFileSync(f.path, "utf8")))).map((f) => f.rel);
    expect(found).toEqual([]);
  });

  it("the public pages claim only what works: no \"AI Native\", \"end-to-end encrypted\" or undated \"coming soon\", and no exclamation marks", () => {
    const found: string[] = [];
    for (const { path, rel } of PUBLIC) {
      withoutComments(readFileSync(path, "utf8")).split("\n").forEach((line, i) => {
        if (/AI[- ]Native|end-to-end encrypt|coming soon/i.test(line)) found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
        // An exclamation mark after a word in a string or in text (not != or !==, and not a TypeScript non-null "!").
        if (/[A-Za-z0-9]!(?=["'`<{]|\s+[A-Za-z"'])/.test(line.replace(/!==?/g, ""))) found.push(`${rel}:${i + 1}  exclamation mark: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("the kit's lines are used word for word", () => {
    const kitLines = [
      "Do more good. Weaver handles the operations. For free. Forever.",
      "This is our way of paying it forward.",
      "Every hour a volunteer spends on admin is an hour taken from the mission.",
      "AI does the busywork. People make the final decisions.",
      "Partner is a promise. Here is ours.",
      "Give your volunteers their time back.",
      "Built and Runs on Generosity",
      "Community management platform",
    ];
    // Each line is in the kit's README, and appears as written in the code that shows it.
    const readme = read("brand/README.md");
    for (const line of kitLines) expect(readme, line).toContain(line);
    expect(read("brand/README.md")).toContain("If you ever want to leave, we'll help you go. We're confident you'll stay.");
    const site = read("src/app/site/page.tsx").replace(/&apos;/g, "'");
    for (const line of kitLines.filter((l) => !["Built and Runs on Generosity", "Community management platform", "Do more good. Weaver handles the operations. For free. Forever."].includes(l))) {
      expect(site, line).toContain(line);
    }
    expect(site).toContain("If you ever want to leave, we'll help you go.");
    expect(site).toContain("We're confident you'll stay.");
    expect(read("src/lib/site.ts")).toContain('SITE_TAGLINE = "Do more good. Weaver handles the operations. For free. Forever."');
    expect(read("src/lib/brand.ts")).toContain('GENEROSITY_LINE = "Built and Runs on Generosity"');
    expect(read("src/lib/brand.ts")).toContain('PRODUCT_DESCRIPTOR = "Community management platform"');
    // The AI line is never paraphrased: no "AI does the busywork" that is not followed by the kit's second sentence.
    for (const { path, rel } of CODE) {
      for (const m of readFileSync(path, "utf8").matchAll(/AI does the busywork(?!\. People make the final decisions\.)/g)) {
        expect.soft(m[0], `${rel} paraphrases the AI line`).toBeUndefined();
      }
    }
  });
});
