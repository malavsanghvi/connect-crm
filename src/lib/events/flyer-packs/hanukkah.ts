// Hanukkah: a nine-branched hanukkiah with every candle lit (the shammash raised in the middle) on a dressed table under a
// starry night, a quiet row of houses with lit windows behind, dreidels with plain faces and coins in front. Six-pointed
// star corners. Conventional and respectful: light, the lamp and the star; no lettering anywhere (the dreidels' faces are blank).

import { borderLines, candle, fourCorners, frameWash, glowDot, groundOf, hills, makeDefs, mix, n, paperFill, sceneSky, sideRun, starField, svgDoc } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (night blue): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#4F67A6";

/** A six-pointed star: two interlaced triangles, outlined. */
export function sixStar(x: number, y: number, r: number, stroke: string, width = 2, fill = "none"): string {
  const tri = (rot: number) => {
    const pts = [0, 1, 2].map((k) => {
      const a = (Math.PI * 2 * k) / 3 - Math.PI / 2 + rot;
      return `${n(x + Math.cos(a) * r)} ${n(y + Math.sin(a) * r)}`;
    });
    return `<path d="M${pts.join("L")}Z" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
  };
  return tri(0) + tri(Math.PI);
}

function dreidel(x: number, base: number, s: number, body: string, rot = 0): string {
  const X = (v: number) => n(v * s);
  return (
    `<g transform="translate(${n(x)} ${n(base)}) rotate(${rot})">` +
    `<path d="M${X(-4)} ${X(-70)}H${X(4)}V${X(-52)}H${X(-4)}Z" fill="${mix(body, "#000000", 0.25)}"/>` +
    `<path d="M${X(-20)} ${X(-52)}H${X(20)}V${X(-18)}L0 0L${X(-20)} ${X(-18)}Z" fill="${body}"/>` +
    `<path d="M0 ${X(-52)}V0L${X(20)} ${X(-18)}V${X(-52)}Z" fill="${mix(body, "#000000", 0.18)}"/>` +
    `<path d="M${X(-20)} ${X(-44)}H${X(20)}" stroke="#FFFFFF" stroke-width="${X(2)}" opacity="0.5"/>` +
    `<path d="M${X(-14)} ${X(-50)}V${X(-22)}" stroke="#FFFFFF" stroke-width="${X(3)}" opacity="0.35" stroke-linecap="round"/></g>`
  );
}

function coin(x: number, y: number, r: number): string {
  return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(r)}" ry="${n(r * 0.42)}" fill="#C9A227"/><ellipse cx="${n(x)}" cy="${n(y - 2)}" rx="${n(r)}" ry="${n(r * 0.42)}" fill="#E8C54A"/><ellipse cx="${n(x)}" cy="${n(y - 2)}" rx="${n(r * 0.7)}" ry="${n(r * 0.28)}" fill="none" stroke="#C9A227" stroke-width="1.4"/>`;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const corner =
    `<circle cx="84" cy="84" r="60" fill="${c.primary}" opacity="0.08"/><circle cx="84" cy="84" r="60" fill="none" stroke="${gold}" stroke-width="1.6"/><circle cx="84" cy="84" r="66" fill="none" stroke="${gold}" stroke-width="1" stroke-dasharray="2 6" stroke-linecap="round"/>` +
    sixStar(84, 84, 44, gold, 2.4, mix(c.primary, c.paper, 0.85)) +
    sixStar(84, 84, 18, c.primary, 1.6) +
    `<path d="M160 44H330M44 160V330" stroke="${gold}" stroke-width="1.2"/>` +
    [190, 230, 270, 310].map((v, i) => (i % 2 ? `<circle cx="${v}" cy="44" r="3" fill="${gold}"/><circle cx="44" cy="${v}" r="3" fill="${gold}"/>` : sixStar(v, 44, 8, gold, 1.4) + sixStar(44, v, 8, gold, 1.4))).join("");
  const sides = sideRun(W, 420, H - 460, 96, (x, y, i) => (i % 2 ? `<circle cx="${x}" cy="${y}" r="2.6" fill="${gold}"/>` : sixStar(x, y, 8, gold, 1.4)));
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold) + sides + fourCorners(W, H, corner), p.defs + wash.defs);
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const gold = c.secondary;
  const out: string[] = [];
  out.push(starField(53, Math.round(W / 10), { x0: 0, y0: h * 0.4, x1: W, y1: base - 140 }, "#F3F6FF"));
  out.push(hills(W, base - 120, 10, h, "#26386B", 0.7));
  // A quiet row of houses with lit windows.
  for (let x = -10, i = 0; x < W; i++) {
    const w = 60 + ((i * 37) % 40);
    const hh = 46 + ((i * 23) % 34);
    const top = base - 104 - hh;
    out.push(`<path d="M${n(x)} ${n(base - 100)}V${n(top)}L${n(x + w / 2)} ${n(top - w * 0.35)}L${n(x + w)} ${n(top)}V${n(base - 100)}Z" fill="#1E2C57"/>`);
    out.push(`<rect x="${n(x + w * 0.2)}" y="${n(top + 12)}" width="${n(w * 0.2)}" height="${n(w * 0.2)}" fill="#FFD98A" opacity="${i % 3 ? 0.85 : 0.45}"/><rect x="${n(x + w * 0.6)}" y="${n(top + 12)}" width="${n(w * 0.2)}" height="${n(w * 0.2)}" fill="#FFD98A" opacity="${i % 2 ? 0.8 : 0.4}"/>`);
    x += w + 8;
  }
  out.push(glowDot(d, mid, base - 140, Math.min(W * 0.5, 380), "#FFD27A", 0.4));
  // The table, dressed in the brand colour.
  const ty = base - 54;
  out.push(`<rect x="-10" y="${n(ty)}" width="${n(W + 20)}" height="${n(h - ty)}" fill="${mix(c.primary, "#0E1430", 0.25)}"/><rect x="-10" y="${n(ty)}" width="${n(W + 20)}" height="6" fill="${mix(c.primary, "#FFFFFF", 0.25)}"/>`);
  // The hanukkiah: eight arms in nested arcs, the shammash raised in the middle, every candle lit.
  const armTop = ty - 112;
  const step = 27;
  for (let k = 1; k <= 4; k++) out.push(`<path d="M${n(mid - k * step)} ${n(armTop)}A${n(k * step)} ${n(k * step * 0.85)} 0 0 0 ${n(mid + k * step)} ${n(armTop)}" stroke="${gold}" stroke-width="5" fill="none"/>`);
  out.push(`<path d="M${n(mid - 4)} ${n(armTop - 24)}H${n(mid + 4)}L${n(mid + 6)} ${n(ty - 16)}H${n(mid - 6)}Z" fill="${gold}"/><path d="M${n(mid - 34)} ${n(ty)}Q${n(mid)} ${n(ty - 26)} ${n(mid + 34)} ${n(ty)}Z" fill="${gold}"/>`);
  for (let k = -4; k <= 4; k++) {
    const x = mid + k * step;
    const cupY = k === 0 ? armTop - 24 : armTop;
    out.push(`<path d="M${n(x - 9)} ${n(cupY)}H${n(x + 9)}L${n(x + 6)} ${n(cupY + 7)}H${n(x - 6)}Z" fill="${gold}"/>`);
    out.push(candle(d, x, cupY, k === 0 ? 40 : 36, 9, { wax: k === 0 ? "#FFFFFF" : "#DCE7F7", halo: 0.75 }));
  }
  out.push(dreidel(mid - 210, ty + 2, 0.9, "#3B6FB6", -8), dreidel(mid + 200, ty + 2, 0.8, "#B8BEC6", 12));
  out.push(coin(mid - 150, ty + 8, 14), coin(mid - 128, ty + 12, 12), coin(mid + 136, ty + 10, 13), coin(mid + 260, ty + 12, 12));
  out.push(`<rect x="0" y="${n(base + 6)}" width="${n(W)}" height="${n(h - base)}" fill="${mix(c.primary, "#0B1026", 0.55)}"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.3, "#A9BADF", 1],
    [0.44, "#4F67A6", 1],
    [0.62, "#243670", 1],
    [0.84, "#18234B", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const hanukkahPack: DrawnPack = {
  occasion: "hanukkah",
  blurb: "A lit hanukkiah under a starry sky, dreidels and coins; star corners",
  frame,
  scene,
  sceneHeight: 480,
  busy: BUSY,
  fade: { from: 0.14, to: 0.4 },
  scrim: 0.84,
  topInset: 54,
};
