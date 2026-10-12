// A worship service or gathering, for any faith (or none): first light over quiet hills and a still lake, reeds, a few
// birds far off, small lanterns along the near shore. No symbol of any one tradition. Olive-branch corners and a soft
// halo of light at the top.

import { borderLines, flame, fourCorners, frameWash, glowDot, groundOf, hills, leaf, makeDefs, mix, n, paperFill, qb, rng, sceneSky, sideRun, sparkle, svgDoc } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 320;
/** The occasion's sky (first light): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#F2BE96";

const OLIVE = "#7E9466";
const OLIVE_LIGHT = "#A3B58A";

/** An olive branch along a curve: slim grey-green leaves and a few olives. */
function olive(p0: number[], p1: number[], p2: number[], leaves = 10, size = 30): string {
  let out = `<path d="M${p0.map(n).join(" ")}Q${p1.map(n).join(" ")} ${p2.map(n).join(" ")}" stroke="#6A5A44" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  for (let i = 1; i <= leaves; i++) {
    const t = i / (leaves + 0.5);
    const [x, y] = qb(p0, p1, p2, t);
    const [x2, y2] = qb(p0, p1, p2, Math.min(1, t + 0.01));
    const deg = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI + 90;
    const side = i % 2 ? 1 : -1;
    out += leaf(x, y, size * (1 - t * 0.35), size * 0.16, deg + side * 48, side > 0 ? OLIVE : OLIVE_LIGHT);
    if (i % 3 === 0) out += `<ellipse cx="${n(x - side * 6)}" cy="${n(y + 7)}" rx="5" ry="6.5" fill="#55603F"/>`;
  }
  return out;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const d = makeDefs("f");
  const corner = olive([30, 40], [150, 24], [290, 54]) + olive([40, 30], [24, 150], [54, 290]) + sparkle(120, 104, 7, gold) + sparkle(104, 120, 5, gold) + `<circle cx="40" cy="40" r="5" fill="${gold}"/>`;
  const sides = sideRun(W, 420, H - 460, 80, (x, y, i) => (i % 2 ? sparkle(x, y, 6, gold) : `<circle cx="${x}" cy="${y}" r="2" fill="${gold}"/>`));
  // A soft halo of light at the top, behind the rules.
  let halo = glowDot(d, W / 2, 16, 120, mix(gold, "#FFFFFF", 0.4), 0.45);
  for (let i = 1; i < 10; i++) {
    const a = (Math.PI * i) / 10;
    halo += `<path d="M${n(W / 2 + Math.cos(a) * 26)} ${n(16 + Math.sin(a) * 26)}L${n(W / 2 + Math.cos(a) * 40)} ${n(16 + Math.sin(a) * 40)}" stroke="${gold}" stroke-width="1.6" stroke-linecap="round"/>`;
  }
  halo += `<path d="M${n(W / 2 - 18)} 16A18 18 0 0 0 ${n(W / 2 + 18)} 16Z" fill="${gold}"/>`;
  const p = paperFill(W, H, c, "#FFFDF6");
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { radius: 18 }) + sides + fourCorners(W, H, corner) + halo, p.defs + wash.defs + d.svg());
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  const water = base - 92;
  // First light: the sun just over the hills, soft rays.
  for (let i = 0; i < 13; i++) {
    const a = Math.PI + (Math.PI * (i + 0.5)) / 13;
    out.push(`<path d="M${n(mid)} ${n(water - 64)}L${n(mid + Math.cos(a - 0.03) * 900)} ${n(water - 64 + Math.sin(a - 0.03) * 900)}L${n(mid + Math.cos(a + 0.03) * 900)} ${n(water - 64 + Math.sin(a + 0.03) * 900)}Z" fill="#FFF6DE" opacity="0.3"/>`);
  }
  out.push(glowDot(d, mid, water - 64, 300, "#FFE2A6", 0.6), `<circle cx="${n(mid)}" cy="${n(water - 64)}" r="54" fill="#FFF0C8"/>`);
  // Birds far off.
  for (const [bx, by, s] of [
    [0.62, h - 280, 1],
    [0.67, h - 296, 0.8],
    [0.71, h - 274, 0.7],
  ] as const)
    out.push(`<path d="M${n(W * bx - 10 * s)} ${n(by)}q${n(5 * s)} ${n(-6 * s)} ${n(10 * s)} 0q${n(5 * s)} ${n(-6 * s)} ${n(10 * s)} 0" stroke="#6B6A78" stroke-width="2" fill="none" stroke-linecap="round"/>`);
  // Hills, a brand-tinted far range, then the lake.
  out.push(hills(W, water - 50, 16, water + 2, mix(c.primary, "#B9C4D6", 0.72), 0.3), hills(W, water - 30, 14, water + 2, mix(c.primary, "#94A79A", 0.7), 2.2));
  const lake = d.linear("lake", [
    [0, "#F4E3C3", 1],
    [0.5, "#C9D6DC", 1],
    [1, "#9DB4C0", 1],
  ]);
  out.push(`<rect x="0" y="${n(water)}" width="${n(W)}" height="${n(h - water)}" fill="${lake}"/>`);
  out.push(`<path d="M${n(mid - 60)} ${n(water + 6)}H${n(mid + 60)}M${n(mid - 40)} ${n(water + 16)}H${n(mid + 40)}M${n(mid - 24)} ${n(water + 26)}H${n(mid + 24)}" stroke="#FFF6DE" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`);
  const r = rng(97);
  for (let i = 0; i < Math.round(W / 60); i++) {
    const x = r() * W;
    const y = water + 30 + r() * 40;
    out.push(`<path d="M${n(x)} ${n(y)}h${n(30 + r() * 40)}" stroke="#FFFFFF" stroke-width="2" opacity="0.4" stroke-linecap="round"/>`);
  }
  // The near shore: reeds and grasses at the sides, small lanterns along the edge.
  out.push(`<path d="M0 ${n(base - 22)}Q${n(W * 0.3)} ${n(base - 34)} ${n(W * 0.5)} ${n(base - 24)}T${n(W)} ${n(base - 26)}V${n(h)}H0Z" fill="#6E8B5A"/>`);
  for (let x = 0; x < W; x += 9) {
    if (Math.abs(x - mid) < W * 0.18) continue;
    const rh = 30 + r() * 60;
    out.push(`<path d="M${n(x)} ${n(base - 20)}Q${n(x + 2)} ${n(base - 20 - rh * 0.6)} ${n(x + 6 - r() * 12)} ${n(base - 20 - rh)}" stroke="${r() > 0.5 ? "#5E7A4A" : "#7F9A62"}" stroke-width="2.4" fill="none"/>`);
    if (r() > 0.86) out.push(`<rect x="${n(x + 2)}" y="${n(base - 20 - rh)}" width="6" height="18" rx="3" fill="#7A5A3A"/>`);
  }
  for (let k = -3; k <= 3; k++) {
    const x = mid + k * Math.min(64, W * 0.07);
    out.push(glowDot(d, x, base - 44, 44, "#FFC861", 0.65), `<rect x="${n(x - 12)}" y="${n(base - 54)}" width="24" height="28" rx="4" fill="#F6EEDC"/><path d="M${n(x - 15)} ${n(base - 54)}H${n(x + 15)}L${n(x + 9)} ${n(base - 62)}H${n(x - 9)}Z" fill="${c.secondary}"/><rect x="${n(x - 14)}" y="${n(base - 28)}" width="28" height="5" rx="2" fill="${c.secondary}"/>`, flame(x, base - 32, 16, 9, "#FFB43C"));
  }
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="#55704A"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.36, "#F8DEC2", 1],
    [0.52, "#F5CFAE", 1],
    [0.66, "#F8E2BC", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const worshipPack: DrawnPack = {
  occasion: "worship",
  blurb: "First light over hills and a still lake, small lanterns; olive corners",
  frame,
  scene,
  sceneHeight: 470,
  busy: BUSY,
  fade: { from: 0.14, to: 0.4 },
  scrim: 0.84,
  topInset: 60,
};
