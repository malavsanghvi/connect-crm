// A picnic / outdoor day: a gingham blanket with a basket, lemonade and watermelon on the grass, trees, a kite in a
// summer sky. The frame has a gingham edge in the brand colour, bunting across the top and daisies in the corners.

import { borderLines, bunting, cloud, flower, frameWash, glowDot, groundOf, hills, leaf, makeDefs, mix, n, paperFill, rng, roundTree, sceneSky, svgDoc, topCorners } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (golden hour): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#F0B566";

function daisy(x: number, y: number, r: number, rot = 0): string {
  return flower(x, y, r, "#FFFFFF", "#F7C948", 12, rot) + `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * 0.22)}" fill="#E8A92A"/>`;
}

/** A gingham band (two sets of translucent stripes) filling a rectangle. */
function gingham(x: number, y: number, w: number, h: number, color: string, cell = 14): string {
  let out = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="#FFFFFF"/>`;
  for (let cx = x; cx < x + w - 0.5; cx += cell * 2) out += `<rect x="${n(cx)}" y="${n(y)}" width="${n(Math.min(cell, x + w - cx))}" height="${n(h)}" fill="${color}" opacity="0.42"/>`;
  for (let cy = y; cy < y + h - 0.5; cy += cell * 2) out += `<rect x="${n(x)}" y="${n(cy)}" width="${n(w)}" height="${n(Math.min(cell, y + h - cy))}" fill="${color}" opacity="0.42"/>`;
  return out;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const band = gingham(16, 16, 28, H - 32, c.primary) + gingham(W - 44, 16, 28, H - 32, c.primary) + gingham(44, 16, W - 88, 28, c.primary) + gingham(44, H - 44, W - 88, 28, c.primary);
  const flags = [c.primary, gold, mix(c.primary, "#FFFFFF", 0.5), "#FFFFFF", mix(gold, "#FFFFFF", 0.45)];
  const top = bunting(60, W / 2, 46, 34, 9, flags, mix(c.ink, c.paper, 0.3), { drop: 30 }) + bunting(W / 2, W - 60, 46, 34, 9, flags, mix(c.ink, c.paper, 0.3), { drop: 30, offset: 2 });
  const corner =
    leaf(58, 120, 70, 12, 160, "#5E9E5E") +
    leaf(62, 130, 60, 10, 200, "#447F49") +
    leaf(58, 236, 50, 9, 150, "#7DB474") +
    daisy(70, 110, 30, 8) +
    daisy(96, 168, 20, 20) +
    daisy(62, 214, 15, 4) +
    `<circle cx="110" cy="120" r="5" fill="#E8556D"/><circle cx="118" cy="128" r="5" fill="#E8556D"/><path d="M110 115q6-12 14-14M118 123q2-12 6-22" stroke="#447F49" stroke-width="1.4" fill="none"/>`;
  const p = paperFill(W, H, c, "#FFFDF4");
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + band + borderLines(W, H, gold, { inset: 16, dotted: false, radius: 2 }) + topCorners(W, corner) + top, p.defs + wash.defs);
}

/** A point on a four-cornered patch: u across (0 at the left edge), v down (0 at the far edge). */
function quadAt(q: number[][], u: number, v: number): number[] {
  const [a, b, cc, d] = q; // far-left, far-right, near-right, near-left
  const top = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const bot = [d[0] + (cc[0] - d[0]) * u, d[1] + (cc[1] - d[1]) * u];
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
}

function blanket(q: number[][], color: string, cols = 10, rows = 4): string {
  let out = "";
  const light = mix(color, "#FFFFFF", 0.55);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const tone = (i % 2) + (j % 2);
      const fill = tone === 0 ? "#FFFFFF" : tone === 1 ? light : color;
      const p = [quadAt(q, i / cols, j / rows), quadAt(q, (i + 1) / cols, j / rows), quadAt(q, (i + 1) / cols, (j + 1) / rows), quadAt(q, i / cols, (j + 1) / rows)];
      out += `<path d="M${p.map((pt) => pt.map(n).join(" ")).join("L")}Z" fill="${fill}"/>`;
    }
  }
  const [, , cc, d] = q;
  out += `<path d="M${n(d[0])} ${n(d[1])}L${n(cc[0])} ${n(cc[1])}L${n(cc[0] - 4)} ${n(cc[1] + 7)}L${n(d[0] + 4)} ${n(d[1] + 7)}Z" fill="${mix(color, "#000000", 0.3)}"/>`;
  return out;
}

function basket(x: number, y: number, s: number): string {
  const X = (v: number) => n(x + v * s);
  const Y = (v: number) => n(y + v * s);
  let out = `<ellipse cx="${n(x)}" cy="${Y(4)}" rx="${n(64 * s)}" ry="${n(9 * s)}" fill="#000000" opacity="0.12"/>`;
  out += `<path d="M${X(-40)} ${Y(-58)}Q${X(0)} ${Y(-118)} ${X(40)} ${Y(-58)}" stroke="#9A6534" stroke-width="${n(7 * s)}" fill="none"/>`;
  out += `<path d="M${X(-56)} ${Y(-58)}H${X(56)}L${X(46)} ${Y(0)}H${X(-46)}Z" fill="#C68B4E"/>`;
  for (let k = 1; k < 5; k++) out += `<path d="M${X(-56 + k * 2)} ${Y(-58 + k * 11.6)}H${X(56 - k * 2)}" stroke="#9A6534" stroke-width="${n(2 * s)}"/>`;
  for (let k = -4; k <= 4; k++) out += `<path d="M${X(k * 12)} ${Y(-58)}L${X(k * 10)} ${Y(0)}" stroke="#A8713D" stroke-width="${n(1.4 * s)}"/>`;
  out += `<path d="M${X(-60)} ${Y(-66)}H${X(60)}V${Y(-56)}H${X(-60)}Z" fill="#A8713D"/>`;
  out += `<path d="M${X(-30)} ${Y(-66)}Q${X(-10)} ${Y(-80)} ${X(10)} ${Y(-66)}" fill="#E85D5D"/><path d="M${X(-26)} ${Y(-72)}h${n(8 * s)}M${X(-14)} ${Y(-75)}h${n(8 * s)}" stroke="#FFFFFF" stroke-width="${n(2 * s)}"/>`;
  return out;
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  const sunX = W * 0.74;
  const sunY = h - 296;
  out.push(glowDot(d, sunX, sunY + 30, 220, "#FFD58A", 0.7), `<circle cx="${n(sunX)}" cy="${n(sunY + 30)}" r="44" fill="#FFD27A"/><circle cx="${n(sunX)}" cy="${n(sunY + 30)}" r="32" fill="#FFE7A8"/>`);
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    out.push(`<path d="M${n(sunX + Math.cos(a) * 56)} ${n(sunY + 30 + Math.sin(a) * 56)}L${n(sunX + Math.cos(a) * 72)} ${n(sunY + 30 + Math.sin(a) * 72)}" stroke="#FFD27A" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`);
  }
  out.push(cloud(W * 0.36, h - 290, 0.85, "#FFF4E2"), cloud(W * 0.6, h - 318, 0.6, "#FFF4E2"));
  // A kite with a bowed tail, its string running down to the grass.
  const kx = W * 0.6;
  const ky = h - 262;
  out.push(`<path d="M${n(kx)} ${n(ky + 40)}C${n(kx + 40)} ${n(ky + 120)} ${n(kx + 90)} ${n(ky + 160)} ${n(kx + 150)} ${n(base - 40)}" stroke="#6B6B6B" stroke-width="1.2" fill="none"/>`);
  out.push(`<path d="M${n(kx)} ${n(ky - 44)}L${n(kx + 30)} ${n(ky)}L${n(kx)} ${n(ky + 40)}L${n(kx - 30)} ${n(ky)}Z" fill="${c.primary}"/><path d="M${n(kx)} ${n(ky - 44)}L${n(kx + 30)} ${n(ky)}L${n(kx)} ${n(ky)}Z" fill="${c.secondary}"/><path d="M${n(kx)} ${n(ky)}L${n(kx - 30)} ${n(ky)}L${n(kx)} ${n(ky + 40)}Z" fill="${c.secondary}"/>`);
  out.push(`<path d="M${n(kx)} ${n(ky - 44)}V${n(ky + 40)}M${n(kx - 30)} ${n(ky)}H${n(kx + 30)}" stroke="#FFFFFF" stroke-width="1.6" opacity="0.7"/>`);
  out.push(`<path d="M${n(kx)} ${n(ky + 40)}q-16 22 0 40t-6 40" stroke="#6B6B6B" stroke-width="1.2" fill="none"/>`);
  for (const [bx, by] of [
    [-4, 58],
    [2, 80],
    [-6, 100],
  ])
    out.push(`<path d="M${n(kx + bx - 7)} ${n(ky + by - 4)}L${n(kx + bx + 7)} ${n(ky + by + 4)}M${n(kx + bx + 7)} ${n(ky + by - 4)}L${n(kx + bx - 7)} ${n(ky + by + 4)}" stroke="${c.secondary}" stroke-width="4" stroke-linecap="round"/>`);
  out.push(hills(W, base - 112, 18, h, "#C6D98E", 0.8), hills(W, base - 78, 14, h, "#9FC774", 2.6));
  // Trees on the far sides.
  for (const [fx, s, col] of [
    [0.06, 0.95, "#5E9C55"],
    [0.17, 0.75, "#6FAE5F"],
    [0.83, 0.8, "#6FAE5F"],
    [0.95, 1.05, "#5E9C55"],
  ] as const)
    out.push(roundTree(W * fx, base - 64, s, col));
  out.push(hills(W, base - 44, 8, h, "#7DB86B", 4.2));
  // The blanket, the basket, lemonade and watermelon.
  const bw = Math.min(W * 0.46, 380);
  const q = [
    [mid - bw * 0.42, base - 66],
    [mid + bw * 0.46, base - 66],
    [mid + bw * 0.56, base - 6],
    [mid - bw * 0.5, base - 6],
  ];
  out.push(blanket(q, c.primary));
  out.push(basket(mid + bw * 0.18, base - 30, 0.9));
  const px = mid - bw * 0.2;
  out.push(`<path d="M${n(px - 16)} ${n(base - 34)}L${n(px - 12)} ${n(base - 92)}H${n(px + 12)}L${n(px + 16)} ${n(base - 34)}Z" fill="#FFFFFF" opacity="0.55"/><path d="M${n(px - 15)} ${n(base - 36)}L${n(px - 13)} ${n(base - 74)}H${n(px + 13)}L${n(px + 15)} ${n(base - 36)}Z" fill="#F9DD6B"/><path d="M${n(px + 12)} ${n(base - 84)}q16 4 10 28" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.8"/>`);
  for (const gx of [px + 36, px + 58]) out.push(`<path d="M${n(gx - 8)} ${n(base - 34)}L${n(gx - 9)} ${n(base - 60)}H${n(gx + 9)}L${n(gx + 8)} ${n(base - 34)}Z" fill="#FFFFFF" opacity="0.55"/><path d="M${n(gx - 8)} ${n(base - 35)}L${n(gx - 8.6)} ${n(base - 50)}H${n(gx + 8.6)}L${n(gx + 8)} ${n(base - 35)}Z" fill="#F9DD6B"/>`);
  const wx = mid - bw * 0.02;
  out.push(`<ellipse cx="${n(wx)}" cy="${n(base - 30)}" rx="34" ry="8" fill="#FFFFFF"/>`);
  for (const [dx, rot] of [
    [-14, -12],
    [12, 10],
  ])
    out.push(`<path transform="rotate(${rot} ${n(wx + dx)} ${n(base - 34)})" d="M${n(wx + dx - 16)} ${n(base - 34)}A16 16 0 0 1 ${n(wx + dx + 16)} ${n(base - 34)}Z" fill="#F0605D"/><path transform="rotate(${rot} ${n(wx + dx)} ${n(base - 34)})" d="M${n(wx + dx - 16)} ${n(base - 34)}H${n(wx + dx + 16)}" stroke="#4E9A4E" stroke-width="4"/><circle cx="${n(wx + dx - 4)}" cy="${n(base - 42)}" r="1.6" fill="#3A2A2A"/><circle cx="${n(wx + dx + 4)}" cy="${n(base - 44)}" r="1.6" fill="#3A2A2A"/>`);
  // Daisies in the grass.
  const r = rng(61);
  for (let i = 0; i < Math.round(W / 50); i++) {
    const x = r() * W;
    if (Math.abs(x - mid) < bw * 0.6) continue;
    out.push(daisy(x, base - 10 - r() * 20, 6 + r() * 4, r() * 40));
  }
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="#6CA85C"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.34, "#F9D9A6", 1],
    [0.52, "#F6C58A", 1],
    [0.74, "#F9DDB0", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const picnicPack: DrawnPack = {
  occasion: "picnic",
  blurb: "A gingham blanket, basket and kite in the park; bunting and daisies",
  frame,
  scene,
  sceneHeight: 480,
  busy: BUSY,
  fade: { from: 0.14, to: 0.4 },
  scrim: 0.84,
  topInset: 104,
};
