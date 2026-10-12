// Christmas Eve: candles and pines on a snowy, starry night; fir and holly in the corners.
// Conventional and quiet: candlelight, evergreens, a bright star. No figures.

import {
  borderLines,
  candle,
  fourCorners,
  frameWash,
  glowDot,
  groundOf,
  hills,
  makeDefs,
  mix,
  n,
  paperFill,
  pine,
  qb,
  rng,
  sceneSky,
  sideRun,
  sparkle,
  starField,
  svgDoc,
} from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (night blue): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#5B76AE";

const NEEDLE = "#2F5D46";
const NEEDLE_LIGHT = "#4F8A68";
const HOLLY = "#2E6B47";
const BERRY = "#B3262E";

/** A fir branch along a gentle curve: a stem with needles on both sides, shorter towards the tip. */
export function firBranch(p0: number[], p1: number[], p2: number[], o: { needles?: number; len?: number; color?: string; light?: string } = {}): string {
  const count = o.needles ?? 26;
  const len = o.len ?? 22;
  let out = `<path d="M${p0.map(n).join(" ")}Q${p1.map(n).join(" ")} ${p2.map(n).join(" ")}" stroke="#5A4632" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const [x, y] = qb(p0, p1, p2, t);
    const [x2, y2] = qb(p0, p1, p2, Math.min(1, t + 0.01));
    const ang = Math.atan2(y2 - y, x2 - x);
    const l = len * (1 - t * 0.55);
    for (const side of [-1, 1]) {
      const a = ang + side * 0.95;
      const c = side > 0 ? (o.color ?? NEEDLE) : (o.light ?? NEEDLE_LIGHT);
      out += `<path d="M${n(x)} ${n(y)}L${n(x + Math.cos(a) * l)} ${n(y + Math.sin(a) * l)}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
    }
  }
  return out;
}

/** A holly leaf from (x, y) along `rot` degrees (0 = up), with its spiky edge and a vein. */
export function hollyLeaf(x: number, y: number, L: number, rot: number, fill = HOLLY): string {
  const W = L * 0.5;
  const P = (px: number, py: number) => `${n(px * W)} ${n(-py * L)}`;
  const d =
    `M0 0Q${P(0.35, 0.05)} ${P(0.5, 0.2)}Q${P(0.28, 0.3)} ${P(0.54, 0.45)}Q${P(0.3, 0.56)} ${P(0.46, 0.72)}Q${P(0.2, 0.82)} ${P(0, 1)}` +
    `Q${P(-0.2, 0.82)} ${P(-0.46, 0.72)}Q${P(-0.3, 0.56)} ${P(-0.54, 0.45)}Q${P(-0.28, 0.3)} ${P(-0.5, 0.2)}Q${P(-0.35, 0.05)} 0 0Z`;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})"><path d="${d}" fill="${fill}"/><path d="M0 ${n(-L * 0.04)}L0 ${n(-L * 0.9)}" stroke="${mix(fill, "#FFFFFF", 0.35)}" stroke-width="1.6"/></g>`;
}

function berries(x: number, y: number, r: number): string {
  return [
    [0, 0],
    [r * 1.7, r * 0.6],
    [r * 0.6, r * 1.7],
  ]
    .map(([dx, dy]) => `<circle cx="${n(x + dx)}" cy="${n(y + dy)}" r="${n(r)}" fill="${BERRY}"/><circle cx="${n(x + dx - r * 0.3)}" cy="${n(y + dy - r * 0.3)}" r="${n(r * 0.32)}" fill="#FFFFFF" opacity="0.55"/>`)
    .join("");
}

/** A round ornament hanging from a short ribbon. */
function bauble(x: number, top: number, len: number, r: number, color: string, gold: string): string {
  const cy = top + len + r;
  return (
    `<path d="M${n(x)} ${n(top)}V${n(cy - r)}" stroke="${gold}" stroke-width="1.6"/>` +
    `<rect x="${n(x - r * 0.28)}" y="${n(cy - r - r * 0.3)}" width="${n(r * 0.56)}" height="${n(r * 0.34)}" rx="1.5" fill="${gold}"/>` +
    `<circle cx="${n(x)}" cy="${n(cy)}" r="${n(r)}" fill="${color}"/>` +
    `<path d="M${n(x - r)} ${n(cy)}Q${n(x)} ${n(cy + r * 0.35)} ${n(x + r)} ${n(cy)}" stroke="${gold}" stroke-width="1.4" fill="none"/>` +
    `<circle cx="${n(x - r * 0.35)}" cy="${n(cy - r * 0.38)}" r="${n(r * 0.24)}" fill="#FFFFFF" opacity="0.55"/>`
  );
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const d = makeDefs("f");
  const corner = [
    firBranch([18, 30], [150, 8], [330, 44], { needles: 30, len: 24 }),
    firBranch([30, 18], [8, 150], [44, 330], { needles: 30, len: 24 }),
    firBranch([22, 22], [120, 60], [210, 120], { needles: 18, len: 20 }),
    hollyLeaf(82, 76, 58, 62),
    hollyLeaf(76, 82, 58, 208),
    hollyLeaf(90, 88, 50, 135, mix(HOLLY, "#000000", 0.15)),
    berries(84, 84, 6.5),
    bauble(232, 36, 26, 15, c.primary, gold),
    bauble(36, 232, 18, 12, mix(c.primary, gold, 0.5), gold),
    sparkle(286, 92, 9, gold),
    sparkle(92, 290, 8, gold),
  ].join("");
  const sides = sideRun(W, 400, H - 460, 86, (x, y, i) => (i % 2 ? sparkle(x, y, 7, gold) : `<circle cx="${x}" cy="${y}" r="2.4" fill="${gold}"/>`));
  // A bright star at the top, on the rules.
  const starTop = glowDot(d, W / 2, 30, 40, "#FFE7A8", 0.8) + sparkle(W / 2, 30, 20, gold) + sparkle(W / 2, 30, 9, "#FFF6DA");
  const p = paperFill(W, H, c, "#FFFFFF");
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold) + sides + fourCorners(W, H, corner) + starTop, p.defs + wash.defs + d.svg());
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  // The night: stars in the dark part of the sky only, and one bright star.
  out.push(starField(11, Math.round(W / 9), { x0: 0, y0: h * 0.5, x1: W, y1: base - 120 }, "#FFFFFF"));
  const sx = W * 0.8;
  const sy = h * 0.52;
  out.push(glowDot(d, sx, sy, 110, "#FFF1C4", 0.55), sparkle(sx, sy, 34, "#FFF6DA"), sparkle(sx, sy, 14, "#FFFFFF"));
  for (const a of [45, 135]) out.push(`<path d="M${n(sx)} ${n(sy)}l${n(Math.cos((a * Math.PI) / 180) * 18)} ${n(-Math.sin((a * Math.PI) / 180) * 18)}" stroke="#FFF6DA" stroke-width="2" stroke-linecap="round"/>`);
  // Far hills, then the snowy ground.
  out.push(hills(W, base - 96, 22, h, "#2C4478", 0.4), hills(W, base - 70, 16, h, "#3A5690", 1.9));
  // Pines: a far row, then the near trees with snow, both sides (the words' column stays clear above).
  const r = rng(5);
  const farPines: number[] = [];
  for (let x = 10; x < W; x += 58 + r() * 40) if (Math.abs(x - mid) > Math.min(250, W * 0.3)) farPines.push(x);
  for (const x of farPines) out.push(pine(x, base - 40, 0.52 + r() * 0.25, "#24465A", { shade: 0.25 }));
  out.push(hills(W, base - 36, 10, h, "#DCE6F3", 0.9));
  out.push(`<path d="M0 ${n(base - 20)}Q${n(W * 0.3)} ${n(base - 32)} ${n(W * 0.55)} ${n(base - 18)}T${n(W)} ${n(base - 22)}V${n(h)}H0Z" fill="#EEF3FA"/>`);
  const nearSpots = [W * 0.06, W * 0.15, W * 0.86, W * 0.95].filter((x) => Math.abs(x - mid) > 230);
  nearSpots.forEach((x, i) => out.push(pine(x, base - 8, [1.05, 0.82, 0.88, 1.1][i] ?? 0.9, "#24573F", { snow: "#F4F8FD" })));
  // The candles: a tall one in the middle, the others stepping down on both sides; small lights in the snow further out.
  const steps = [0, 52, 100, 146, 188, 228].filter((o) => o < W * 0.33);
  const heights = [150, 118, 96, 78, 62, 50];
  const widths = [30, 25, 24, 22, 20, 18];
  for (let i = steps.length - 1; i >= 0; i--) {
    for (const side of i === 0 ? [0] : [-1, 1]) {
      const x = mid + side * steps[i];
      out.push(`<ellipse cx="${n(x)}" cy="${n(base - 14)}" rx="${n(widths[i] * 1.6)}" ry="${n(widths[i] * 0.35)}" fill="#FFD98A" opacity="0.45"/>`);
      out.push(candle(d, x, base - 14, heights[i], widths[i], { halo: i === 0 ? 1.2 : 1 }));
    }
  }
  // A brass tray under the candles, in the brand's second colour.
  const trayW = (steps[steps.length - 1] ?? 100) + 40;
  out.push(`<path d="M${n(mid - trayW)} ${n(base - 14)}H${n(mid + trayW)}L${n(mid + trayW - 14)} ${n(base - 2)}H${n(mid - trayW + 14)}Z" fill="${c.secondary}"/>`);
  out.push(`<path d="M${n(mid - trayW)} ${n(base - 14)}H${n(mid + trayW)}" stroke="${mix(c.secondary, "#FFFFFF", 0.45)}" stroke-width="2"/>`);
  for (const x of [W * 0.27, W * 0.33, W * 0.67, W * 0.73]) {
    if (Math.abs(x - mid) < trayW + 30) continue;
    out.push(glowDot(d, x, base - 8, 26, "#FFC15A", 0.6), `<ellipse cx="${n(x)}" cy="${n(base - 4)}" rx="9" ry="4" fill="#C9B79A"/>`, `<path d="M${n(x)} ${n(base - 18)}q4 6 0 12q-4-6 0-12z" fill="#FFC44D"/>`);
  }
  // Falling snow over the dark sky.
  const snow = rng(23);
  for (let i = 0; i < Math.round(W / 14); i++) {
    const x = snow() * W;
    const y = h * 0.46 + snow() * (base - 30 - h * 0.46);
    out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(1.4 + snow() * 2.2)}" fill="#FFFFFF" opacity="${n(0.5 + snow() * 0.4)}"/>`);
  }
  out.push(`<rect x="0" y="${n(base + 2)}" width="${n(W)}" height="${n(h - base)}" fill="${mix(c.primary, "#0E1A33", 0.5)}"/>`);
  // The sky: clear at the top (the words), a pale dusk, then deep blue night behind the art.
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.36, "#AFC0E0", 0.95],
    [0.5, "#5B76AE", 1],
    [0.68, "#2A3F74", 1],
    [0.86, "#1B2A55", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const christmasEvePack: DrawnPack = {
  occasion: "christmas_eve",
  blurb: "Candles and pines on a starry night; fir and holly corners",
  frame,
  scene,
  sceneHeight: 480,
  busy: BUSY,
  fade: { from: 0.15, to: 0.42 },
  scrim: 0.84,
  topInset: 70,
};
