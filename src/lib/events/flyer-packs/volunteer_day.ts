// A volunteer day / service day: a neighbourhood of small houses and trees behind a community garden (raised beds,
// sunflowers, a watering can), with hearts rising from it. No people and no hands. Heart-cluster corners.

import { borderLines, flower, fourCorners, frameWash, glowDot, groundOf, heart, hills, leaf, makeDefs, mix, n, paperFill, rng, roundTree, sceneSky, sideRun, svgDoc } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (a clear morning): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#8FC9E6";

/** A small house standing on (x, base): walls, a gable roof, a door and two lit windows. */
export function house(x: number, base: number, w: number, hh: number, wall: string, roof: string, chimney = false): string {
  const top = base - hh;
  const peak = top - w * 0.42;
  let out = chimney ? `<rect x="${n(x + w * 0.66)}" y="${n(peak + w * 0.12)}" width="${n(w * 0.12)}" height="${n(w * 0.3)}" fill="${mix(roof, "#000000", 0.2)}"/>` : "";
  out += `<rect x="${n(x)}" y="${n(top)}" width="${n(w)}" height="${n(hh)}" fill="${wall}"/><rect x="${n(x)}" y="${n(top)}" width="${n(w * 0.18)}" height="${n(hh)}" fill="${mix(wall, "#000000", 0.07)}"/>`;
  out += `<path d="M${n(x - 8)} ${n(top + 2)}L${n(x + w / 2)} ${n(peak)}L${n(x + w + 8)} ${n(top + 2)}Z" fill="${roof}"/><path d="M${n(x - 8)} ${n(top + 2)}L${n(x + w / 2)} ${n(peak)}" stroke="${mix(roof, "#FFFFFF", 0.25)}" stroke-width="2"/>`;
  out += `<rect x="${n(x + w * 0.4)}" y="${n(base - hh * 0.5)}" width="${n(w * 0.2)}" height="${n(hh * 0.5)}" rx="2" fill="${mix(roof, "#000000", 0.1)}"/>`;
  for (const wx of [x + w * 0.12, x + w * 0.68]) out += `<rect x="${n(wx)}" y="${n(top + hh * 0.22)}" width="${n(w * 0.2)}" height="${n(w * 0.2)}" fill="#FFE3A0"/><path d="M${n(wx + w * 0.1)} ${n(top + hh * 0.22)}v${n(w * 0.2)}M${n(wx)} ${n(top + hh * 0.22 + w * 0.1)}h${n(w * 0.2)}" stroke="${wall}" stroke-width="2"/>`;
  return out;
}

function sunflower(x: number, base: number, h: number): string {
  const hy = base - h;
  return (
    `<path d="M${n(x)} ${n(base)}Q${n(x - 6)} ${n(base - h * 0.5)} ${n(x)} ${n(hy)}" stroke="#4E8B4F" stroke-width="4" fill="none"/>` +
    leaf(x, base - h * 0.4, 34, 12, -60, "#5E9E5E") +
    leaf(x, base - h * 0.6, 30, 11, 58, "#447F49") +
    flower(x, hy, 40, "#F7C21E", "#F7C21E", 14, 0) +
    flower(x, hy, 30, "#FFD84A", "#FFD84A", 14, 12) +
    `<circle cx="${n(x)}" cy="${n(hy)}" r="10" fill="#7A4A1E"/><circle cx="${n(x)}" cy="${n(hy)}" r="5" fill="#5A3414"/>`
  );
}

function bed(x: number, base: number, w: number, plant: (px: number, py: number, i: number) => string): string {
  let out = "";
  for (let px = x + 18, i = 0; px < x + w - 10; px += 28, i++) out += plant(px, base - 24, i);
  out += `<rect x="${n(x)}" y="${n(base - 26)}" width="${n(w)}" height="26" rx="2" fill="#A9774A"/><path d="M${n(x)} ${n(base - 13)}H${n(x + w)}" stroke="#8A5E37" stroke-width="2"/><rect x="${n(x - 3)}" y="${n(base - 29)}" width="${n(w + 6)}" height="6" rx="2" fill="#C08A58"/>`;
  return out;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const warm = mix(c.primary, "#FFFFFF", 0.4);
  const corner = [
    leaf(60, 60, 110, 16, 100, "#7DB474"),
    leaf(60, 60, 110, 16, 170, "#5E9E5E"),
    heart(78, 82, 30, c.primary),
    heart(134, 62, 18, gold),
    heart(62, 138, 17, warm),
    heart(176, 104, 11, warm),
    heart(104, 176, 10, gold),
    heart(212, 54, 8, c.primary),
    heart(54, 212, 8, c.primary),
    `<path d="M66 70q8-8 18-4" stroke="#FFFFFF" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.5"/>`,
  ].join("");
  const sides = sideRun(W, 400, H - 460, 76, (x, y, i) => heart(x, y, i % 2 ? 6 : 8, i % 3 === 0 ? c.primary : i % 3 === 1 ? gold : warm));
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { radius: 14 }) + sides + fourCorners(W, H, corner), p.defs + wash.defs);
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  out.push(glowDot(d, W * 0.3, h - 296, 120, "#FFE7A0", 0.6), `<circle cx="${n(W * 0.3)}" cy="${n(h - 296)}" r="32" fill="#FFDB6E"/>`);
  out.push(hills(W, base - 120, 14, h, "#C9E3C0", 1.2));
  // The neighbourhood: small houses and trees along the street.
  const r = rng(71);
  const walls = ["#F3E3C8", "#DCE8E1", "#F2D7CF", "#E3E0F0", "#FFF1D6"];
  const roofs = [mix(c.primary, "#5A4A42", 0.35), mix(c.secondary, "#6B4A3A", 0.3), mix(c.primary, "#FFFFFF", 0.2), "#B5654A"];
  const street = base - 64;
  for (let x = -20, i = 0; x < W; i++) {
    if (i % 3 === 2) {
      out.push(roundTree(x + 26, street + 2, 0.75 + r() * 0.2, i % 2 ? "#6FAE5F" : "#5E9C55"));
      x += 56;
      continue;
    }
    const w = 70 + r() * 34;
    out.push(house(x, street, w, 56 + r() * 26, walls[i % walls.length], roofs[i % roofs.length], r() > 0.5));
    x += w + 18;
  }
  out.push(`<rect x="0" y="${n(street)}" width="${n(W)}" height="${n(h - street)}" fill="#8CC47E"/>`);
  // A white picket fence behind the garden.
  for (let x = 6; x < W; x += 22) out.push(`<path d="M${n(x)} ${n(street + 30)}V${n(street + 2)}l5 -7 5 7V${n(street + 30)}Z" fill="#FFFFFF"/>`);
  out.push(`<rect x="0" y="${n(street + 8)}" width="${n(W)}" height="5" fill="#F1F1F1"/><rect x="0" y="${n(street + 20)}" width="${n(W)}" height="5" fill="#F1F1F1"/>`);
  out.push(`<rect x="0" y="${n(street + 30)}" width="${n(W)}" height="${n(h - street)}" fill="#7DB86B"/>`);
  // The garden: raised beds of greens and tomatoes, sunflowers at the ends, a watering can.
  const gw = Math.min(W * 0.7, 640);
  const g0 = mid - gw / 2;
  const greens = (px: number, py: number) => leaf(px, py, 22, 8, -30, "#5E9E5E") + leaf(px, py, 26, 9, 10, "#447F49") + leaf(px, py, 20, 7, 40, "#7DB474");
  const tomatoes = (px: number, py: number, i: number) =>
    leaf(px, py, 34, 9, -20, "#4E8B4F") + leaf(px, py, 30, 8, 24, "#5E9E5E") + `<circle cx="${n(px - 6)}" cy="${n(py - 16)}" r="5.5" fill="#E2453C"/><circle cx="${n(px + 7)}" cy="${n(py - 22)}" r="5" fill="${i % 2 ? "#E2453C" : "#F28C3C"}"/>`;
  out.push(bed(g0, base - 8, gw * 0.3, greens), bed(g0 + gw * 0.35, base - 8, gw * 0.3, tomatoes), bed(g0 + gw * 0.7, base - 8, gw * 0.3, greens));
  out.push(sunflower(g0 - 30, base - 6, 150), sunflower(g0 + gw + 30, base - 6, 166), sunflower(g0 + gw + 66, base - 4, 128));
  const wx = g0 + gw * 0.66;
  out.push(`<path d="M${n(wx - 22)} ${n(base - 6)}H${n(wx + 22)}L${n(wx + 18)} ${n(base - 40)}H${n(wx - 18)}Z" fill="${c.secondary}"/><path d="M${n(wx + 18)} ${n(base - 34)}L${n(wx + 46)} ${n(base - 58)}" stroke="${c.secondary}" stroke-width="6" stroke-linecap="round"/><path d="M${n(wx - 14)} ${n(base - 40)}Q${n(wx)} ${n(base - 64)} ${n(wx + 14)} ${n(base - 40)}" stroke="${mix(c.secondary, "#000000", 0.2)}" stroke-width="4" fill="none"/>`);
  // Hearts rising from the garden.
  const hearts = [
    [-0.04, -120, 30, c.primary],
    [0.12, -166, 22, c.secondary],
    [-0.18, -176, 19, mix(c.primary, "#FFFFFF", 0.35)],
    [0.26, -206, 16, "#F28C8C"],
    [0.02, -220, 15, c.secondary],
    [0.36, -140, 18, mix(c.primary, "#FFFFFF", 0.35)],
    [-0.32, -136, 15, "#F28C8C"],
    [-0.12, -244, 11, c.primary],
    [0.18, -250, 10, mix(c.primary, "#FFFFFF", 0.35)],
    [-0.28, -226, 9, c.secondary],
  ] as const;
  for (const [fx, dy, s, col] of hearts) {
    const hx = mid + fx * gw;
    const hy = base + dy;
    out.push(glowDot(d, hx, hy, s * 2.6, "#FFFFFF", 0.6), heart(hx, hy, s, col));
  }
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="#6CA85C"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.36, "#CFE8F4", 1],
    [0.7, "#EAF5FA", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const volunteerDayPack: DrawnPack = {
  occasion: "volunteer_day",
  blurb: "A neighbourhood garden with rising hearts; heart-cluster corners",
  frame,
  scene,
  sceneHeight: 470,
  busy: BUSY,
  fade: { from: 0.14, to: 0.4 },
  scrim: 0.84,
  topInset: 54,
};
