// Easter: spring blooms and a sunrise. Tulips, daffodils and white lilies in front of green hills, the sun rising behind them,
// two butterflies. Blossom and lily corners. No figures and no other symbols: flowers and light only.

import { borderLines, flower, fourCorners, frameWash, glowDot, groundOf, hills, leaf, makeDefs, mix, n, paperFill, petal, rng, sceneSky, sideRun, svgDoc } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (dawn): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#F4A97E";

const LEAF = "#5E9E5E";
const LEAF_DARK = "#447F49";
const TULIPS = ["#E8556D", "#F59AB0", "#F7C948", "#B57EDC", "#F28A5B", "#FFFFFF"];

/** A tulip on a gently curved stem, standing on (x, base), `h` tall. */
export function tulip(x: number, base: number, h: number, color: string, sway = 0, r = 13): string {
  const hx = x + sway;
  const hy = base - h;
  const dark = mix(color, "#5A1630", color === "#FFFFFF" ? 0.12 : 0.22);
  const light = mix(color, "#FFFFFF", 0.35);
  return (
    leaf(x, base, h * 0.58, 9, -16 + sway * 0.3, LEAF) +
    leaf(x, base, h * 0.46, 8, 20 + sway * 0.3, LEAF_DARK) +
    `<path d="M${n(x)} ${n(base)}Q${n(x + sway * 0.1)} ${n(base - h * 0.5)} ${n(hx)} ${n(hy + r * 0.4)}" stroke="${LEAF_DARK}" stroke-width="3" fill="none"/>` +
    `<path d="M${n(hx - r * 0.55)} ${n(hy + r * 0.3)}Q${n(hx - r * 0.62)} ${n(hy - r * 0.9)} ${n(hx)} ${n(hy - r * 1.35)}Q${n(hx + r * 0.62)} ${n(hy - r * 0.9)} ${n(hx + r * 0.55)} ${n(hy + r * 0.3)}Z" fill="${dark}"/>` +
    `<path d="M${n(hx)} ${n(hy + r * 0.6)}C${n(hx - r * 1.1)} ${n(hy + r * 0.45)} ${n(hx - r * 1.15)} ${n(hy - r * 0.6)} ${n(hx - r * 0.78)} ${n(hy - r * 1.15)}Q${n(hx - r * 0.15)} ${n(hy - r * 0.5)} ${n(hx + r * 0.1)} ${n(hy + r * 0.6)}Z" fill="${color}"/>` +
    `<path d="M${n(hx)} ${n(hy + r * 0.6)}C${n(hx + r * 1.1)} ${n(hy + r * 0.45)} ${n(hx + r * 1.15)} ${n(hy - r * 0.6)} ${n(hx + r * 0.78)} ${n(hy - r * 1.15)}Q${n(hx + r * 0.15)} ${n(hy - r * 0.5)} ${n(hx - r * 0.1)} ${n(hy + r * 0.6)}Z" fill="${mix(color, dark, 0.35)}"/>` +
    `<path d="M${n(hx - r * 0.62)} ${n(hy - r * 0.55)}Q${n(hx - r * 0.5)} ${n(hy + r * 0.2)} ${n(hx - r * 0.1)} ${n(hy + r * 0.4)}" stroke="${light}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  );
}

/** A daffodil facing us on a thin stem: six pale petals round a deep yellow trumpet. */
export function daffodil(x: number, base: number, h: number, r = 15): string {
  const hy = base - h;
  return (
    leaf(x - 4, base, h * 0.8, 6, -8, LEAF) +
    leaf(x + 4, base, h * 0.7, 6, 10, LEAF_DARK) +
    `<path d="M${n(x)} ${n(base)}Q${n(x + 4)} ${n(base - h * 0.5)} ${n(x)} ${n(hy)}" stroke="${LEAF_DARK}" stroke-width="2.6" fill="none"/>` +
    flower(x, hy, r * 2, "#FFF0A0", "#F7B733", 6, 15) +
    `<circle cx="${n(x)}" cy="${n(hy)}" r="${n(r * 0.62)}" fill="#F7B733"/><circle cx="${n(x)}" cy="${n(hy)}" r="${n(r * 0.42)}" fill="#E89A1E"/><circle cx="${n(x)}" cy="${n(hy)}" r="${n(r * 0.18)}" fill="#C97B10"/>`
  );
}

/** A white trumpet lily on a tall stem, its flower turned `rot` degrees from upright. */
export function lily(x: number, base: number, h: number, rot: number, s = 1): string {
  const hx = x + Math.sin((rot * Math.PI) / 180) * 10;
  const hy = base - h;
  let head = "";
  for (const a of [-34, 34, -12, 12]) head += `<path transform="rotate(${a})" d="${petal(48 * s, 15 * s)}" fill="${a === -12 || a === 12 ? "#FFFFFF" : "#F4F1EA"}" stroke="#D9DCCB" stroke-width="1"/>`;
  head += `<path d="M0 0V${n(-22 * s)}" stroke="#C7D7A0" stroke-width="${n(6 * s)}" stroke-linecap="round"/>`;
  for (const a of [-14, 0, 14]) head += `<path transform="rotate(${a})" d="M0 ${n(-10 * s)}V${n(-44 * s)}" stroke="#B9C77E" stroke-width="1.2"/><circle transform="rotate(${a})" cy="${n(-46 * s)}" r="${n(2.6 * s)}" fill="#E39A3B"/>`;
  return (
    `<path d="M${n(x)} ${n(base)}Q${n(x - 6)} ${n(base - h * 0.6)} ${n(hx)} ${n(hy)}" stroke="${LEAF_DARK}" stroke-width="3.4" fill="none"/>` +
    leaf(x, base - h * 0.35, 40 * s, 7 * s, -50, LEAF) +
    leaf(x - 2, base - h * 0.55, 34 * s, 6 * s, 46, LEAF) +
    `<g transform="translate(${n(hx)} ${n(hy)}) rotate(${n(rot)})">${head}</g>`
  );
}

function butterfly(x: number, y: number, s: number, color: string, rot = 0): string {
  const dark = mix(color, "#000000", 0.25);
  return (
    `<g transform="translate(${n(x)} ${n(y)}) rotate(${rot}) scale(${n(s)})">` +
    `<ellipse cx="-9" cy="-6" rx="10" ry="13" transform="rotate(-30 -9 -6)" fill="${color}"/><ellipse cx="9" cy="-6" rx="10" ry="13" transform="rotate(30 9 -6)" fill="${color}"/>` +
    `<ellipse cx="-7" cy="8" rx="6" ry="8" transform="rotate(25 -7 8)" fill="${dark}"/><ellipse cx="7" cy="8" rx="6" ry="8" transform="rotate(-25 7 8)" fill="${dark}"/>` +
    `<circle cx="-10" cy="-8" r="3" fill="#FFFFFF" opacity="0.6"/><circle cx="10" cy="-8" r="3" fill="#FFFFFF" opacity="0.6"/>` +
    `<rect x="-1.6" y="-12" width="3.2" height="24" rx="1.6" fill="#4A3B33"/><path d="M-1 -12q-4-8-8-9M1 -12q4-8 8-9" stroke="#4A3B33" stroke-width="1" fill="none"/></g>`
  );
}

function blossom(x: number, y: number, r: number, rot = 0): string {
  return flower(x, y, r, "#F7C6D3", "#E88AA6", 5, rot) + `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * 0.14)}" fill="#F6E27A"/>`;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const corner = [
    leaf(54, 62, 150, 20, 84, LEAF),
    leaf(58, 70, 110, 16, 104, LEAF_DARK),
    leaf(62, 54, 150, 20, 186, LEAF),
    leaf(70, 58, 110, 16, 166, LEAF_DARK),
    leaf(176, 50, 60, 10, 70, "#7DB474"),
    leaf(50, 176, 60, 10, 200, "#7DB474"),
    blossom(150, 66, 20, 10),
    blossom(66, 150, 19, 40),
    blossom(214, 46, 13, 20),
    blossom(46, 214, 12, 0),
    flower(84, 84, 34, "#FFF0A0", "#F7B733", 6, 10),
    `<circle cx="84" cy="84" r="10" fill="#F7B733"/><circle cx="84" cy="84" r="6" fill="#E89A1E"/>`,
    ...[
      [252, 44],
      [270, 54],
      [44, 252],
      [54, 270],
    ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="#F7C6D3"/>`),
  ].join("");
  const sides = sideRun(W, 400, H - 460, 90, (x, y, i) => (i % 2 ? blossom(x, y, 11, i * 20) : `<circle cx="${x}" cy="${y}" r="3" fill="${gold}"/>`));
  // A small rising sun on the top rule.
  let sun = `<path d="M${n(W / 2 - 22)} 16A22 22 0 0 0 ${n(W / 2 + 22)} 16Z" fill="${gold}"/>`;
  for (let i = 1; i < 8; i++) {
    const a = (Math.PI * i) / 8;
    sun += `<path d="M${n(W / 2 + Math.cos(a) * 28)} ${n(16 + Math.sin(a) * 28)}L${n(W / 2 + Math.cos(a) * 38)} ${n(16 + Math.sin(a) * 38)}" stroke="${gold}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  const p = paperFill(W, H, c, "#FFFBEF");
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { radius: 18 }) + sides + fourCorners(W, H, corner) + sun, p.defs + wash.defs);
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  // The sun rising behind the hills, with soft rays.
  const sy = base - 96;
  for (let i = 0; i < 15; i++) {
    const a = Math.PI + (Math.PI * (i + 0.5)) / 15;
    const a0 = a - 0.035;
    const a1 = a + 0.035;
    out.push(`<path d="M${n(mid)} ${n(sy)}L${n(mid + Math.cos(a0) * 900)} ${n(sy + Math.sin(a0) * 900)}L${n(mid + Math.cos(a1) * 900)} ${n(sy + Math.sin(a1) * 900)}Z" fill="#FFF4D6" opacity="0.32"/>`);
  }
  out.push(glowDot(d, mid, sy, 280, "#FFE3A0", 0.6), `<circle cx="${n(mid)}" cy="${n(sy)}" r="84" fill="#FFE7A8"/><circle cx="${n(mid)}" cy="${n(sy)}" r="64" fill="#FFF1C6"/>`);
  out.push(butterfly(W * 0.68, h - 300, 0.9, "#9AC8F0", 12), butterfly(W * 0.3, h - 262, 0.75, "#F7B2C4", -16));
  out.push(hills(W, base - 104, 16, h, "#BFD9B4", 0.6), hills(W, base - 66, 14, h, "#9CC991", 2.2), hills(W, base - 30, 8, h, "#79B571", 4.1));
  // Flowers: tall lilies at the sides, tulips and daffodils across the front, lower in the middle so the sun shows.
  const r = rng(19);
  const lilies = [W * 0.06, W * 0.12, W * 0.88, W * 0.94];
  lilies.forEach((x, i) => out.push(lily(x, base + 4, 170 + (i % 2) * 26, i < 2 ? -22 + i * 10 : 18 - (i - 2) * 10, 0.95)));
  for (let x = 24, i = 0; x < W - 10; x += 34 + r() * 18, i++) {
    const fromMid = Math.abs(x - mid) / (W / 2);
    const tall = 46 + fromMid * 70 + r() * 18;
    if (i % 3 === 2) out.push(daffodil(x, base + 6, tall * 0.9));
    else out.push(tulip(x, base + 6, tall, TULIPS[(i + Math.floor(r() * 3)) % TULIPS.length], (r() - 0.5) * 10));
  }
  // Grass along the bottom.
  for (let x = 0; x < W; x += 6) {
    const gh = 10 + r() * 22;
    out.push(`<path d="M${n(x)} ${n(base + 8)}Q${n(x + 2)} ${n(base - gh * 0.5)} ${n(x + 5 - r() * 10)} ${n(base + 8 - gh)}" stroke="${r() > 0.5 ? LEAF : LEAF_DARK}" stroke-width="2" fill="none"/>`);
  }
  out.push(`<rect x="0" y="${n(base + 6)}" width="${n(W)}" height="${n(h - base)}" fill="#4F8B4F"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.36, "#FCE1C8", 1],
    [0.52, "#F9CDA6", 1],
    [0.68, "#FBDCA8", 1],
    [0.82, "#FFF0C8", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const easterPack: DrawnPack = {
  occasion: "easter",
  blurb: "Spring blooms and a sunrise over green hills; blossom corners",
  frame,
  scene,
  sceneHeight: 480,
  busy: BUSY,
  fade: { from: 0.14, to: 0.4 },
  scrim: 0.84,
  topInset: 60,
};
