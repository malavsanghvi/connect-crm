// Thanksgiving / harvest: golden fields at the end of the day, a red barn and autumn trees, hay bales and a rail fence,
// pumpkins and a wheat sheaf tied with a ribbon in the brand colour, leaves falling. Autumn leaf, acorn and wheat corners.

import { borderLines, fourCorners, frameWash, glowDot, groundOf, hills, leaf, makeDefs, mix, n, paperFill, rng, roundTree, sceneSky, sideRun, svgDoc } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (golden hour): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#EFA95E";

const AUTUMN = ["#C8452B", "#E07A2E", "#E8A93A", "#9C5A2E", "#D9662B"];

/** A maple leaf centred on (x, y), about 100s tall, turned `rot` degrees. */
export function mapleLeaf(x: number, y: number, s: number, rot: number, fill: string): string {
  const pts = [
    [0, -50], [8, -30], [20, -36], [16, -14], [34, -22], [30, -12], [46, -10], [36, 2], [44, 10], [24, 12], [28, 24], [8, 18], [3, 30],
    [-3, 30], [-8, 18], [-28, 24], [-24, 12], [-44, 10], [-36, 2], [-46, -10], [-30, -12], [-34, -22], [-16, -14], [-20, -36], [-8, -30],
  ];
  const d = `M${pts.map(([px, py]) => `${n(px * s)} ${n(py * s)}`).join("L")}Z`;
  const vein = mix(fill, "#000000", 0.25);
  return (
    `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})"><path d="${d}" fill="${fill}"/>` +
    `<path d="M0 ${n(44 * s)}V${n(-40 * s)}M0 ${n(6 * s)}L${n(30 * s)} ${n(-12 * s)}M0 ${n(6 * s)}L${n(-30 * s)} ${n(-12 * s)}M0 ${n(14 * s)}L${n(20 * s)} ${n(14 * s)}M0 ${n(14 * s)}L${n(-20 * s)} ${n(14 * s)}" stroke="${vein}" stroke-width="${n(Math.max(0.8, 2 * s))}" fill="none"/></g>`
  );
}

function acorn(x: number, y: number, s: number, rot: number): string {
  return (
    `<g transform="translate(${n(x)} ${n(y)}) rotate(${rot}) scale(${n(s)})">` +
    `<ellipse cx="0" cy="8" rx="11" ry="14" fill="#C08A4E"/><ellipse cx="-3" cy="5" rx="3" ry="6" fill="#FFFFFF" opacity="0.3"/>` +
    `<path d="M-14 -2Q0 -16 14 -2Q14 4 0 4Q-14 4 -14 -2Z" fill="#7A5230"/><path d="M-9 -4l3 4M-3 -7l3 4M3 -7l3 4M9 -4l-3 4" stroke="#5E3E22" stroke-width="1.2"/>` +
    `<path d="M0 -10q2 -6 6 -8" stroke="#5E3E22" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`
  );
}

/** A stalk of wheat from (x, y) along `rot` degrees (0 = up), `len` long, grains along its top part. */
function wheat(x: number, y: number, len: number, rot: number, color = "#D9A441"): string {
  let out = `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})"><path d="M0 0V${n(-len)}" stroke="${mix(color, "#000000", 0.15)}" stroke-width="2"/>`;
  for (let k = 0; k < 7; k++) {
    const gy = -len + 8 + k * len * 0.07;
    out += `<ellipse cx="-4" cy="${n(gy)}" rx="3.4" ry="7" transform="rotate(-28 -4 ${n(gy)})" fill="${color}"/><ellipse cx="4" cy="${n(gy)}" rx="3.4" ry="7" transform="rotate(28 4 ${n(gy)})" fill="${mix(color, "#FFFFFF", 0.15)}"/>`;
    out += `<path d="M-6 ${n(gy - 5)}l-6 -12M6 ${n(gy - 5)}l6 -12" stroke="${color}" stroke-width="0.9"/>`;
  }
  return `${out}<ellipse cx="0" cy="${n(-len + 2)}" rx="3" ry="7" fill="${color}"/></g>`;
}

function pumpkin(x: number, base: number, w: number, color: string): string {
  const h = w * 0.72;
  const cy = base - h / 2;
  const dark = mix(color, "#000000", 0.18);
  const light = mix(color, "#FFFFFF", 0.18);
  return (
    `<ellipse cx="${n(x)}" cy="${n(base - 2)}" rx="${n(w * 0.5)}" ry="${n(w * 0.08)}" fill="#000000" opacity="0.15"/>` +
    `<ellipse cx="${n(x - w * 0.24)}" cy="${n(cy)}" rx="${n(w * 0.26)}" ry="${n(h * 0.5)}" fill="${dark}"/>` +
    `<ellipse cx="${n(x + w * 0.24)}" cy="${n(cy)}" rx="${n(w * 0.26)}" ry="${n(h * 0.5)}" fill="${dark}"/>` +
    `<ellipse cx="${n(x - w * 0.11)}" cy="${n(cy)}" rx="${n(w * 0.22)}" ry="${n(h * 0.52)}" fill="${color}"/>` +
    `<ellipse cx="${n(x + w * 0.11)}" cy="${n(cy)}" rx="${n(w * 0.22)}" ry="${n(h * 0.52)}" fill="${color}"/>` +
    `<ellipse cx="${n(x)}" cy="${n(cy)}" rx="${n(w * 0.15)}" ry="${n(h * 0.53)}" fill="${light}"/>` +
    `<path d="M${n(x - 3)} ${n(cy - h * 0.48)}Q${n(x - 2)} ${n(cy - h * 0.7)} ${n(x + 8)} ${n(cy - h * 0.78)}" stroke="#5E6B2E" stroke-width="${n(Math.max(3, w * 0.07))}" fill="none" stroke-linecap="round"/>` +
    leaf(x + 4, cy - h * 0.5, w * 0.3, w * 0.08, 70, "#6B8A3A")
  );
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const corner = [
    wheat(30, 30, 190, 104, "#D9A441"),
    wheat(30, 30, 190, 166, "#D9A441"),
    wheat(36, 36, 150, 120, "#E3B65A"),
    wheat(36, 36, 150, 150, "#E3B65A"),
    mapleLeaf(70, 70, 0.95, -40, AUTUMN[0]),
    mapleLeaf(132, 60, 0.6, 20, AUTUMN[1]),
    mapleLeaf(60, 132, 0.58, -100, AUTUMN[2]),
    leaf(110, 110, 46, 14, 135, AUTUMN[3], mix(AUTUMN[3], "#000000", 0.25)),
    acorn(150, 100, 0.9, -20),
    acorn(100, 152, 0.8, 30),
  ].join("");
  const sides = sideRun(W, 400, H - 460, 84, (x, y, i) => (i % 2 ? mapleLeaf(x, y, 0.16, i * 40, AUTUMN[i % AUTUMN.length]) : `<circle cx="${x}" cy="${y}" r="2.4" fill="${gold}"/>`));
  const p = paperFill(W, H, c, "#FFF8EC");
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold) + sides + fourCorners(W, H, corner), p.defs + wash.defs);
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  const sx = W * 0.66;
  const sy = base - 126;
  out.push(glowDot(d, sx, sy, 240, "#FFD98A", 0.6), `<circle cx="${n(sx)}" cy="${n(sy)}" r="54" fill="#FFE3A6"/>`);
  out.push(hills(W, base - 130, 14, h, "#EBC98A", 0.4));
  // A red barn on the far field.
  const bx = W * 0.84;
  const bt = base - 168;
  out.push(
    `<path d="M${n(bx - 50)} ${n(base - 104)}V${n(bt + 30)}L${n(bx - 34)} ${n(bt + 6)}L${n(bx)} ${n(bt - 8)}L${n(bx + 34)} ${n(bt + 6)}L${n(bx + 50)} ${n(bt + 30)}V${n(base - 104)}Z" fill="#B23A2E"/>`,
    `<path d="M${n(bx - 54)} ${n(bt + 32)}L${n(bx - 34)} ${n(bt + 4)}L${n(bx)} ${n(bt - 12)}L${n(bx + 34)} ${n(bt + 4)}L${n(bx + 54)} ${n(bt + 32)}" stroke="#F4EDE2" stroke-width="4" fill="none"/>`,
    `<rect x="${n(bx - 18)}" y="${n(base - 146)}" width="36" height="42" fill="#8E2A22" stroke="#F4EDE2" stroke-width="3"/><path d="M${n(bx - 18)} ${n(base - 146)}L${n(bx + 18)} ${n(base - 104)}M${n(bx + 18)} ${n(base - 146)}L${n(bx - 18)} ${n(base - 104)}" stroke="#F4EDE2" stroke-width="2.4"/>`,
    `<rect x="${n(bx - 7)}" y="${n(bt + 14)}" width="14" height="14" fill="#F4EDE2"/>`,
  );
  out.push(hills(W, base - 100, 16, h, "#DDAA5A", 1.9));
  for (let k = 0; k < 5; k++) out.push(`<path d="M0 ${n(base - 82 + k * 12)}Q${n(W * 0.5)} ${n(base - 100 + k * 14)} ${n(W)} ${n(base - 80 + k * 11)}" stroke="#C89443" stroke-width="2" fill="none" opacity="0.5"/>`);
  // Autumn trees.
  for (const [fx, s, col] of [
    [0.05, 1, "#D9662B"],
    [0.15, 0.78, "#E8A93A"],
    [0.95, 0.9, "#B8452E"],
  ] as const)
    out.push(roundTree(W * fx, base - 70, s, col, "#5E3E22"));
  // Round hay bales.
  for (const [fx, r] of [
    [0.3, 28],
    [0.4, 22],
    [0.74, 26],
  ] as const) {
    const hx = W * fx;
    const hy = base - 70 - r;
    out.push(`<ellipse cx="${n(hx + 6)}" cy="${n(base - 70)}" rx="${n(r * 1.3)}" ry="5" fill="#000000" opacity="0.12"/><circle cx="${n(hx)}" cy="${n(hy)}" r="${r}" fill="#E3BE6A"/><path d="M${n(hx)} ${n(hy)}m-4 0a4 4 0 1 1 8 0a8 8 0 1 1 -16 0a12 12 0 1 1 24 0a16 16 0 1 1 -32 0" stroke="#C79A45" stroke-width="2" fill="none"/>`);
  }
  // A rail fence.
  const fy = base - 46;
  for (let x = 10; x < W; x += 90) out.push(`<rect x="${n(x)}" y="${n(fy - 24)}" width="8" height="58" fill="#7A5230"/>`);
  out.push(`<rect x="0" y="${n(fy - 16)}" width="${n(W)}" height="7" fill="#946539"/><rect x="0" y="${n(fy + 4)}" width="${n(W)}" height="7" fill="#946539"/>`);
  out.push(`<rect x="0" y="${n(base - 20)}" width="${n(W)}" height="${n(h - base + 20)}" fill="#B98446"/>`);
  // The wheat sheaf, tied with a ribbon in the brand colour, and pumpkins.
  const wx = mid - 150;
  for (let k = -5; k <= 5; k++) out.push(wheat(wx + k * 4, base - 4, 120 - Math.abs(k) * 4, k * 5, k % 2 ? "#D9A441" : "#E3B65A"));
  out.push(`<path d="M${n(wx - 18)} ${n(base - 52)}Q${n(wx)} ${n(base - 44)} ${n(wx + 18)} ${n(base - 52)}L${n(wx + 18)} ${n(base - 42)}Q${n(wx)} ${n(base - 34)} ${n(wx - 18)} ${n(base - 42)}Z" fill="${c.primary}"/>`);
  out.push(`<path d="M${n(wx)} ${n(base - 46)}l-20 -14q-6 10 4 16zM${n(wx)} ${n(base - 46)}l20 -14q6 10 -4 16z" fill="${c.primary}"/><path d="M${n(wx)} ${n(base - 44)}l-10 24M${n(wx)} ${n(base - 44)}l10 24" stroke="${c.primary}" stroke-width="5" stroke-linecap="round"/>`);
  out.push(pumpkin(mid - 40, base + 4, 96, "#E8812B"), pumpkin(mid + 50, base + 4, 70, "#D06A1E"), pumpkin(mid + 112, base + 4, 54, "#F1E4CC"), pumpkin(mid - 230, base + 4, 52, "#E8812B"));
  out.push(`<ellipse cx="${n(mid + 160)}" cy="${n(base - 8)}" rx="22" ry="12" transform="rotate(-20 ${n(mid + 160)} ${n(base - 8)})" fill="#E8C24A"/><path d="M${n(mid + 146)} ${n(base - 2)}q14 -16 30 -12" stroke="#6B8A3A" stroke-width="3" fill="none"/>`);
  // Leaves falling.
  const r = rng(83);
  for (let i = 0; i < Math.round(W / 70); i++) out.push(mapleLeaf(r() * W, h - 320 + r() * 160, 0.12 + r() * 0.1, r() * 360, AUTUMN[i % AUTUMN.length]));
  out.push(`<rect x="0" y="${n(base + 4)}" width="${n(W)}" height="${n(h - base)}" fill="#7A4E2A"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.34, "#F9D4A0", 1],
    [0.5, "#F3B172", 1],
    [0.72, "#F6C98A", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const thanksgivingPack: DrawnPack = {
  occasion: "thanksgiving",
  blurb: "Golden fields, a red barn, pumpkins and wheat; autumn leaf corners",
  frame,
  scene,
  sceneHeight: 480,
  busy: BUSY,
  fade: { from: 0.14, to: 0.4 },
  scrim: 0.84,
  topInset: 54,
};
