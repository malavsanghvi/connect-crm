// An annual (general) meeting: a civic hall with columns, a pediment and steps, banners in the brand colour between the
// columns, trees and lamps either side, on a clear morning. Laurel branches in the corners: formal and calm.

import { borderLines, cloud, fourCorners, frameWash, glowDot, groundOf, hills, leaf, makeDefs, mix, n, paperFill, qb, roundTree, sceneSky, sideRun, sparkle, svgDoc } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (a clear morning): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#9FC4E2";

/** A laurel branch along a curve: pairs of slim leaves, smaller towards the tip. */
export function laurel(p0: number[], p1: number[], p2: number[], color: string, leaves = 9, size = 26): string {
  let out = `<path d="M${p0.map(n).join(" ")}Q${p1.map(n).join(" ")} ${p2.map(n).join(" ")}" stroke="${color}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  for (let i = 1; i <= leaves; i++) {
    const t = i / (leaves + 0.5);
    const [x, y] = qb(p0, p1, p2, t);
    const [x2, y2] = qb(p0, p1, p2, Math.min(1, t + 0.01));
    const deg = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI + 90;
    const s = size * (1 - t * 0.45);
    out += leaf(x, y, s, s * 0.3, deg - 38, color) + leaf(x, y, s, s * 0.3, deg + 38, mix(color, "#FFFFFF", 0.15));
  }
  const [ex, ey] = qb(p0, p1, p2, 1);
  return out + leaf(ex, ey, size * 0.6, size * 0.18, (Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI + 90, color);
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const corner =
    laurel([40, 40], [150, 30], [300, 40], gold, 9, 26) +
    laurel([40, 40], [30, 150], [40, 300], gold, 9, 26) +
    `<circle cx="40" cy="40" r="16" fill="${c.primary}"/><circle cx="40" cy="40" r="16" fill="none" stroke="${gold}" stroke-width="2.4"/>` +
    sparkle(40, 40, 9, gold) +
    sparkle(130, 110, 7, gold) +
    sparkle(110, 130, 6, gold);
  const sides = sideRun(W, 420, H - 460, 70, (x, y, i) => (i % 2 ? `<path d="M${x} ${y - 7}l5 7-5 7-5-7z" fill="${gold}"/>` : `<circle cx="${x}" cy="${y}" r="2" fill="${gold}"/>`));
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { radius: 4 }) + sides + fourCorners(W, H, corner), p.defs + wash.defs);
}

function lamp(d: ReturnType<typeof makeDefs>, x: number, base: number): string {
  return (
    `<rect x="${n(x - 3)}" y="${n(base - 120)}" width="6" height="120" fill="#3E4652"/><rect x="${n(x - 9)}" y="${n(base - 8)}" width="18" height="8" fill="#3E4652"/>` +
    glowDot(d, x, base - 132, 34, "#FFE6A8", 0.7) +
    `<path d="M${n(x - 10)} ${n(base - 122)}H${n(x + 10)}L${n(x + 7)} ${n(base - 144)}H${n(x - 7)}Z" fill="#FFF0C8"/><path d="M${n(x - 11)} ${n(base - 144)}H${n(x + 11)}L${n(x)} ${n(base - 154)}Z" fill="#3E4652"/>`
  );
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  out.push(glowDot(d, mid + 260, h - 300, 140, "#FFF0C2", 0.5), cloud(mid - 330, h - 296, 0.8, "#FFFFFF"), cloud(mid + 330, h - 270, 0.65, "#FFFFFF"));
  out.push(hills(W, base - 96, 12, h, "#BFD8C0", 1.4));
  // The hall: steps, a base, six columns, an entablature and a pediment.
  const hw = Math.min(W * 0.62, 560);
  const x0 = mid - hw / 2;
  const stone = "#F2EEE6";
  const shade = "#DCD5C8";
  const deep = "#C9C0B0";
  const floor = base - 34;
  for (let k = 0; k < 3; k++) out.push(`<rect x="${n(x0 - 30 + k * 10)}" y="${n(base - 12 * (k + 1))}" width="${n(hw + 60 - k * 20)}" height="12" fill="${k % 2 ? shade : stone}"/>`);
  const colTop = floor - 124;
  out.push(`<rect x="${n(x0 + 10)}" y="${n(colTop)}" width="${n(hw - 20)}" height="${n(floor - colTop)}" fill="${deep}"/>`);
  // The doors and the banners between the columns.
  out.push(`<rect x="${n(mid - 34)}" y="${n(floor - 96)}" width="68" height="96" rx="4" fill="#6E5B47"/><path d="M${n(mid)} ${n(floor - 96)}V${n(floor)}" stroke="#4E3F31" stroke-width="3"/><rect x="${n(mid - 40)}" y="${n(floor - 104)}" width="80" height="8" fill="${shade}"/>`);
  const cols = 6;
  const gap = (hw - 40) / (cols - 1);
  for (let k = 0; k < cols - 1; k++) {
    const bx = x0 + 20 + gap * (k + 0.5);
    if (Math.abs(bx - mid) < 50) continue;
    out.push(`<path d="M${n(bx - 16)} ${n(colTop + 18)}H${n(bx + 16)}V${n(colTop + 84)}L${n(bx)} ${n(colTop + 72)}L${n(bx - 16)} ${n(colTop + 84)}Z" fill="${k % 2 ? c.primary : mix(c.primary, c.secondary, 0.25)}"/><path d="M${n(bx - 10)} ${n(colTop + 30)}H${n(bx + 10)}" stroke="${c.secondary}" stroke-width="2.4"/><circle cx="${n(bx)}" cy="${n(colTop + 52)}" r="6" fill="none" stroke="${c.secondary}" stroke-width="2"/>`);
  }
  for (let k = 0; k < cols; k++) {
    const cx = x0 + 20 + gap * k;
    out.push(`<rect x="${n(cx - 13)}" y="${n(colTop + 10)}" width="26" height="${n(floor - colTop - 20)}" fill="${stone}"/><rect x="${n(cx + 4)}" y="${n(colTop + 10)}" width="7" height="${n(floor - colTop - 20)}" fill="${shade}"/>`);
    out.push(`<path d="M${n(cx - 4)} ${n(colTop + 14)}V${n(floor - 14)}" stroke="${shade}" stroke-width="1.4"/>`);
    out.push(`<rect x="${n(cx - 18)}" y="${n(colTop)}" width="36" height="10" fill="${stone}"/><rect x="${n(cx - 18)}" y="${n(floor - 10)}" width="36" height="10" fill="${stone}"/>`);
  }
  const ent = colTop - 26;
  out.push(`<rect x="${n(x0 - 6)}" y="${n(ent)}" width="${n(hw + 12)}" height="26" fill="${stone}"/><rect x="${n(x0 - 6)}" y="${n(ent + 18)}" width="${n(hw + 12)}" height="8" fill="${shade}"/>`);
  for (let x = x0; x < x0 + hw; x += 18) out.push(`<rect x="${n(x)}" y="${n(ent + 4)}" width="8" height="10" fill="${shade}"/>`);
  out.push(`<path d="M${n(x0 - 14)} ${n(ent)}L${n(mid)} ${n(ent - hw * 0.12)}L${n(x0 + hw + 14)} ${n(ent)}Z" fill="${stone}"/><path d="M${n(x0 + 20)} ${n(ent - 6)}L${n(mid)} ${n(ent - hw * 0.12 + 12)}L${n(x0 + hw - 20)} ${n(ent - 6)}Z" fill="${shade}"/>`);
  out.push(`<circle cx="${n(mid)}" cy="${n(ent - hw * 0.045)}" r="10" fill="${c.secondary}"/><circle cx="${n(mid)}" cy="${n(ent - hw * 0.045)}" r="5" fill="${stone}"/>`);
  // Trees, lamps and hedges either side.
  for (const side of [-1, 1]) {
    out.push(roundTree(mid + side * (hw / 2 + 80), base - 6, 1, "#5E9C55"), roundTree(mid + side * (hw / 2 + 190), base - 6, 0.8, "#6FAE5F"));
    out.push(lamp(d, mid + side * (hw / 2 + 24), base - 2));
    out.push(`<rect x="${n(side < 0 ? 0 : mid + hw / 2 + 40)}" y="${n(base - 26)}" width="${n(W / 2 - hw / 2 - 40)}" height="26" rx="12" fill="#4E8B4F"/>`);
  }
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="#9AA39C"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.36, "#D3E6F2", 1],
    [0.72, "#EEF5F9", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const annualMeetingPack: DrawnPack = {
  occasion: "annual_meeting",
  blurb: "A civic hall with columns and banners; laurel corners",
  frame,
  scene,
  sceneHeight: 470,
  busy: BUSY,
  fade: { from: 0.14, to: 0.4 },
  scrim: 0.84,
  topInset: 54,
};
