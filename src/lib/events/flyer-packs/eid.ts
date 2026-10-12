// Eid: a crescent moon, hanging lanterns and geometric patterns. An evening sky over an arcade of pointed arches lit from
// within, lanterns glowing in front; eight-pointed star rosettes and a geometric band in the frame's corners.
// Conventional and respectful: architecture, light and pattern only.

import { borderLines, crescent, eightStar, fourCorners, frameWash, glowDot, groundOf, lantern, makeDefs, mix, n, paperFill, sceneSky, sideRun, star, starField, svgDoc } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 360;
/** The occasion's sky (evening lavender): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#7570AE";

/** An eight-pointed star rosette: two stars, rings and a dotted halo, centred on (x, y). */
export function rosette8(x: number, y: number, r: number, line: string, fill: string): string {
  let out = eightStar(x, y, r, `fill="${fill}" fill-opacity="0.16" stroke="${line}" stroke-width="2"`);
  out += eightStar(x, y, r * 0.7, `fill="${line}" fill-opacity="0.22" stroke="${line}" stroke-width="1.4"`, 22.5);
  out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * 0.36)}" fill="none" stroke="${line}" stroke-width="1.4"/>`;
  out += eightStar(x, y, r * 0.24, `fill="${line}"`);
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    out += `<circle cx="${n(x + Math.cos(a) * r * 1.14)}" cy="${n(y + Math.sin(a) * r * 1.14)}" r="${i % 2 ? 1.6 : 2.6}" fill="${line}"/>`;
  }
  return out;
}

/** A pointed arch opening from (x0) to (x1), springing at `spring`, its point at `apex`, down to `bottom`. */
function archPath(x0: number, x1: number, spring: number, apex: number, bottom: number): string {
  const xc = (x0 + x1) / 2;
  return `M${n(x0)} ${n(bottom)}V${n(spring)}Q${n(x0)} ${n(apex + (spring - apex) * 0.25)} ${n(xc)} ${n(apex)}Q${n(x1)} ${n(apex + (spring - apex) * 0.25)} ${n(x1)} ${n(spring)}V${n(bottom)}Z`;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const d = makeDefs("f");
  const chain = (x0: number, x1: number, y: number) => {
    let s = "";
    for (let x = x0, i = 0; x <= x1; x += 30, i++) s += i % 2 ? `<path d="M${n(x)} ${n(y - 6)}l6 6-6 6-6-6z" fill="${gold}"/>` : eightStar(x, y, 8, `fill="none" stroke="${gold}" stroke-width="1.4"`);
    return s;
  };
  const corner =
    rosette8(84, 84, 56, gold, c.primary) +
    chain(170, 320, 30) +
    `<g transform="rotate(90) scale(1 -1)">${chain(170, 320, 30)}</g>` +
    `<path d="M150 50H340M50 150V340" stroke="${gold}" stroke-width="1" opacity="0.7"/>`;
  const sides = sideRun(W, 420, H - 460, 92, (x, y, i) => (i % 2 ? `<circle cx="${x}" cy="${y}" r="2.4" fill="${gold}"/>` : eightStar(x, y, 7, `fill="${gold}"`)));
  // A crescent and a star on the top rule.
  const cx = W / 2;
  const top = glowDot(d, cx, 30, 46, "#FFE7A8", 0.7) + crescent(cx - 6, 32, 19, gold, { rot: -30, inner: 0.82, offset: 0.4 }) + star(cx + 15, 22, 7, gold, 10);
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { dotted: false, radius: 4 }) + sides + fourCorners(W, H, corner) + top, p.defs + wash.defs + d.svg());
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const gold = c.secondary;
  const out: string[] = [];
  out.push(starField(43, Math.round(W / 12), { x0: 0, y0: h * 0.36, x1: W, y1: base - 190 }, "#FFF4D2"));
  // The crescent moon and its star.
  // Between the last two lanterns (they hang at the middle of each of `count` bays).
  const count = Math.max(4, Math.round(W / 170));
  const mx = (W / count) * (count - 1);
  const my = h - 300;
  out.push(glowDot(d, mx, my, 130, "#FFEFC2", 0.5), crescent(mx, my, 44, "#FCE9B0", { rot: -35, inner: 0.84, offset: 0.38 }), star(mx + 34, my - 34, 10, "#FFF4D2", 12));
  // The arcade: a long wall with pointed arches lit warm from inside, a patterned cornice.
  const wallTop = base - 172;
  const wall = mix(c.primary, "#141832", 0.5);
  const lit = d.linear("arch", [
    [0, "#FFE7AE", 1],
    [1, "#F2B25C", 1],
  ]);
  out.push(`<rect x="0" y="${n(wallTop)}" width="${n(W)}" height="${n(base - wallTop)}" fill="${wall}"/>`);
  out.push(`<rect x="0" y="${n(wallTop - 14)}" width="${n(W)}" height="18" fill="${mix(wall, "#000000", 0.25)}"/><path d="M0 ${n(wallTop + 4)}H${n(W)}" stroke="${gold}" stroke-width="2"/>`);
  for (let x = 18, i = 0; x < W; x += 36, i++) out.push(i % 2 ? `<path d="M${n(x)} ${n(wallTop - 11)}l6 6-6 6-6-6z" fill="${gold}"/>` : eightStar(x, wallTop - 5, 7, `fill="none" stroke="${gold}" stroke-width="1.2"`));
  const bay = W / Math.max(5, Math.round(W / 118));
  for (let x = 0; x < W - 1; x += bay) {
    const x0 = x + bay * 0.2;
    const x1 = x + bay * 0.8;
    out.push(`<path d="${archPath(x0 - 6, x1 + 6, base - 92, base - 150, base)}" fill="${mix(wall, "#FFFFFF", 0.08)}"/>`);
    out.push(`<path d="${archPath(x0, x1, base - 88, base - 142, base)}" fill="${lit}"/>`);
    out.push(`<path d="${archPath(x0 + 10, x1 - 10, base - 78, base - 120, base - 56)}" fill="none" stroke="${mix(gold, "#FFFFFF", 0.3)}" stroke-width="1.4" opacity="0.7"/>`);
    out.push(eightStar((x0 + x1) / 2, base - 158, 6, `fill="${gold}"`));
  }
  out.push(glowDot(d, W / 2, base - 40, W * 0.5, "#FFC870", 0.22));
  // Lanterns hanging in front, at different heights.
  const top = h - 360;
  for (let i = 0; i < count; i++) {
    const x = (W / count) * (i + 0.5);
    const y = top + 70 + ((i * 53) % 3) * 34;
    out.push(lantern(d, x, top, y, i % 2 ? 0.82 : 1, gold));
  }
  // The courtyard floor: geometric tiles.
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="${mix(c.primary, "#0E1124", 0.55)}"/>`);
  for (let x = 0; x < W; x += 28) out.push(`<path d="M${n(x)} ${n(base + 6)}l14 7-14 7-14-7z" fill="${gold}" opacity="0.35"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.3, "#BBAAD3", 1],
    [0.39, "#625F9F", 1],
    [0.5, "#2F3B74", 1],
    [0.7, "#1C2448", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const eidPack: DrawnPack = {
  occasion: "eid",
  blurb: "Crescent moon, lanterns and lit arches; geometric star corners",
  frame,
  scene,
  sceneHeight: 500,
  busy: BUSY,
  fade: { from: 0.12, to: 0.36 },
  scrim: 0.84,
  topInset: 60,
};
