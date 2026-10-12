// New Year's Eve: fireworks over a city at night, a clock tower a minute before midnight (a plain face, no numerals),
// confetti falling. Firework, streamer and confetti corners.

import { borderLines, building, burst, confetti, fourCorners, frameWash, glowDot, groundOf, makeDefs, mix, n, paperFill, sceneSky, sideRun, skyline, sparkle, starField, svgDoc, type Defs } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 340;
/** The occasion's sky (night indigo): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#3F4682";

/** A firework: a glow, a ring of rays and sparks, and a second smaller ring inside. */
function firework(d: Defs, x: number, y: number, r: number, color: string): string {
  return glowDot(d, x, y, r * 1.6, color, 0.35) + burst(x, y, r, color, 22, 2.4) + burst(x, y, r * 0.55, mix(color, "#FFFFFF", 0.45), 14, 1.8) + `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * 0.08)}" fill="#FFFFFF"/>`;
}

/** A curling streamer from (x, y). */
function streamer(x: number, y: number, len: number, rot: number, color: string): string {
  let d = `M0 0`;
  for (let i = 0; i < 4; i++) d += `c${n(len * 0.12)} ${n(-len * 0.08)} ${n(len * 0.22)} ${n(len * 0.08)} ${n(len * 0.25)} 0`;
  return `<path transform="translate(${n(x)} ${n(y)}) rotate(${rot})" d="${d}" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const d = makeDefs("f");
  const colors = [c.primary, gold, mix(c.primary, "#FFFFFF", 0.45), mix(gold, "#FFFFFF", 0.4)];
  const corner =
    firework(d, 92, 92, 52, gold) +
    firework(d, 196, 60, 24, c.primary) +
    firework(d, 60, 196, 22, mix(c.primary, gold, 0.5)) +
    streamer(150, 150, 150, 18, c.primary) +
    streamer(140, 160, 130, 70, gold) +
    confetti(7, 22, { x0: 160, y0: 80, x1: 320, y1: 140 }, colors) +
    confetti(8, 22, { x0: 80, y0: 160, x1: 140, y1: 320 }, colors) +
    sparkle(250, 110, 9, gold) +
    sparkle(110, 250, 8, gold);
  const sides = sideRun(W, 400, H - 460, 80, (x, y, i) => (i % 2 ? sparkle(x, y, 7, gold) : `<circle cx="${x}" cy="${y}" r="2.6" fill="${c.primary}" opacity="0.6"/>`));
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold) + sides + fourCorners(W, H, corner), p.defs + wash.defs + d.svg());
}

function clockTower(x: number, base: number, fill: string, gold: string): string {
  const w = 74;
  const top = base - 205;
  let out = building(Math.round(x - w / 2), w, Math.round(top + 40), Math.round(base), fill, "rect");
  out += `<path d="M${n(x - w / 2 - 6)} ${n(top + 40)}H${n(x + w / 2 + 6)}L${n(x + w / 2)} ${n(top + 28)}H${n(x - w / 2)}Z" fill="${fill}"/><path d="M${n(x - w / 2)} ${n(top + 28)}L${n(x)} ${n(top - 30)}L${n(x + w / 2)} ${n(top + 28)}Z" fill="${fill}"/>`;
  out += `<path d="M${n(x)} ${n(top - 30)}V${n(top - 48)}" stroke="${gold}" stroke-width="3"/><circle cx="${n(x)}" cy="${n(top - 50)}" r="4" fill="${gold}"/>`;
  const cy = top + 76;
  out += `<circle cx="${n(x)}" cy="${n(cy)}" r="30" fill="#FFF3D2"/><circle cx="${n(x)}" cy="${n(cy)}" r="30" fill="none" stroke="${gold}" stroke-width="4"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    out += `<path d="M${n(x + Math.cos(a) * 22)} ${n(cy + Math.sin(a) * 22)}L${n(x + Math.cos(a) * 26)} ${n(cy + Math.sin(a) * 26)}" stroke="#3A3A4A" stroke-width="${i % 3 ? 1.4 : 3}"/>`;
  }
  // A minute to midnight.
  out += `<path d="M${n(x)} ${n(cy)}L${n(x - 1.5)} ${n(cy - 15)}" stroke="#2A2A36" stroke-width="3.4" stroke-linecap="round"/><path d="M${n(x)} ${n(cy)}L${n(x - 2.4)} ${n(cy - 22)}" stroke="#2A2A36" stroke-width="2" stroke-linecap="round"/><circle cx="${n(x)}" cy="${n(cy)}" r="2.6" fill="#2A2A36"/>`;
  for (let wy = top + 124; wy < base - 20; wy += 22) out += `<rect x="${n(x - 8)}" y="${n(wy)}" width="16" height="12" rx="2" fill="#FFD98A" opacity="0.7"/>`;
  return out;
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  out.push(starField(67, Math.round(W / 12), { x0: 0, y0: h * 0.42, x1: W, y1: base - 160 }, "#FFFFFF"));
  const fw: [number, number, number, string][] = [
    [0.22, h - 288, 62, mix(c.secondary, "#FFFFFF", 0.1)],
    [0.5, h - 296, 44, "#FF8FB1"],
    [0.76, h - 290, 70, "#7FE0D2"],
    [0.36, h - 230, 34, "#FFD36B"],
    [0.9, h - 222, 32, mix(c.primary, "#FFFFFF", 0.5)],
    [0.62, h - 226, 30, "#C9A0FF"],
  ];
  for (const [fx, y, r, col] of fw) out.push(firework(d, W * fx, y, r, col));
  out.push(skyline(W, base - 10, { seed: 21, height: 170, back: "#2C3466", front: mix(c.primary, "#121530", 0.7), lit: "#FFD98A", litShare: 0.3 }));
  out.push(clockTower(mid, base - 10, mix(c.primary, "#0E1128", 0.62), c.secondary));
  out.push(confetti(91, Math.round(W / 10), { x0: 0, y0: h - 330, x1: W, y1: base - 60 }, [c.secondary, "#FF8FB1", "#7FE0D2", "#FFD36B", mix(c.primary, "#FFFFFF", 0.5)], 1));
  out.push(`<rect x="0" y="${n(base - 10)}" width="${n(W)}" height="${n(h - base + 10)}" fill="${mix(c.primary, "#0A0C1E", 0.7)}"/><path d="M0 ${n(base - 10)}H${n(W)}" stroke="${c.secondary}" stroke-width="2" opacity="0.7"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.3, "#9C9CC8", 1],
    [0.44, "#3F4682", 1],
    [0.62, "#1F2452", 1],
    [0.84, "#141836", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const newYearPack: DrawnPack = {
  occasion: "new_year",
  blurb: "Fireworks over the city and a clock at midnight; confetti corners",
  frame,
  scene,
  sceneHeight: 490,
  busy: BUSY,
  fade: { from: 0.12, to: 0.38 },
  scrim: 0.84,
  topInset: 54,
};
