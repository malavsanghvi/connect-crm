// Draws the Weaver logo PNGs from the real mark (src/app/icon.svg) and the real faces (Bricolage Grotesque and Hanken Grotesk,
// fetched from Google Fonts), into brand/logos/ and public/brand/ (the downloads on www.weaverams.org/brand).
// Run from the repository root: node scripts/brand-logo-pngs.mjs
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.cwd();
const require = createRequire(join(repo, "package.json"));
// sharp and the image renderer come with Next (sharp is Next's own dependency, not ours).
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const React = require("react");
const { ImageResponse } = await import(pathToFileURL(require.resolve("next/dist/compiled/@vercel/og/index.node.js")).href);

const OUT = [join(repo, "brand/logos"), join(repo, "public/brand")];
for (const dir of OUT) mkdirSync(dir, { recursive: true });
const save = (name, bytes) => {
  for (const dir of OUT) writeFileSync(join(dir, name), bytes);
};

const svg = readFileSync(join(repo, "src/app/icon.svg"));
const png = (size) => sharp(svg, { density: 600 }).resize(size, size).png().toBuffer();

// 1. The mark, transparent, and on a white square (profile pictures, app icons).
for (const size of [256, 512, 1024]) save(`weaver-mark-${size}.png`, await png(size));
save(
  "weaver-mark-on-white-1024.png",
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ffffff" } })
    .composite([{ input: await png(840), gravity: "centre" }])
    .png()
    .toBuffer(),
);

// 2. The full logo (mark, Weaver, descriptor), drawn at six times the website header's size.
// An old browser's user agent makes Google Fonts answer with WOFF, which the renderer reads (it cannot read WOFF2).
const UA = "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.100 Safari/534.30";
async function font(query) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query}`, { headers: { "User-Agent": UA } })).text();
  const url = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!url) throw new Error(`Google Fonts sent no font file for ${query}`);
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}
const fonts = [
  { name: "Bricolage Grotesque", data: await font("Bricolage+Grotesque:opsz,wght@96,600"), weight: 600, style: "normal" },
  { name: "Hanken Grotesk", data: await font("Hanken+Grotesk:wght@600"), weight: 600, style: "normal" },
];
const markUri = `data:image/png;base64,${(await png(528)).toString("base64")}`;
const S = 6;
const h = React.createElement;

async function lockup({ name, desc, tile }) {
  const mark = tile
    ? h(
        "div",
        { style: { width: 44 * S, height: 44 * S, borderRadius: 12 * S, background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center" } },
        h("img", { src: markUri, width: 32 * S, height: 32 * S }),
      )
    : h("img", { src: markUri, width: 44 * S, height: 44 * S });
  const el = h(
    "div",
    { style: { width: "100%", height: "100%", display: "flex", alignItems: "center", gap: 6 * S, padding: 8 * S } },
    mark,
    h(
      "div",
      { style: { display: "flex", flexDirection: "column" } },
      h("div", { style: { fontFamily: "Bricolage Grotesque", fontWeight: 600, fontSize: 24 * S, lineHeight: 1, letterSpacing: -0.01 * 24 * S, color: name } }, "Weaver"),
      h("div", { style: { marginTop: 4 * S, fontFamily: "Hanken Grotesk", fontWeight: 600, fontSize: 11.5 * S, lineHeight: 1, color: desc } }, "Community management platform"),
    ),
  );
  const res = new ImageResponse(el, { width: 1600, height: 76 * S, fonts });
  // Crop the empty room the fixed canvas leaves, then add an even margin.
  return sharp(Buffer.from(await res.arrayBuffer())).trim({ threshold: 1 }).toBuffer();
}

const clear = { r: 0, g: 0, b: 0, alpha: 0 };
save("weaver-logo.png", await sharp(await lockup({ name: "#2b2a8a", desc: "#555a79", tile: false })).extend({ top: 48, bottom: 48, left: 48, right: 48, background: clear }).png().toBuffer());
save(
  "weaver-logo-on-indigo.png",
  await sharp(await lockup({ name: "#ffffff", desc: "#d4d2f5", tile: true }))
    .flatten({ background: "#2b2a8a" })
    .extend({ top: 72, bottom: 72, left: 72, right: 72, background: "#2b2a8a" })
    .png()
    .toBuffer(),
);

// 3. The SVG master next to the PNGs.
for (const dir of OUT) copyFileSync(join(repo, "src/app/icon.svg"), join(dir, "weaver-mark.svg"));
console.log("Drew the Weaver logo files into brand/logos and public/brand.");
