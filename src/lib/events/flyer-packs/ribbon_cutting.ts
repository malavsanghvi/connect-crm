// A ribbon cutting / grand opening: a shopfront on a bright street, a ribbon stretched between brass posts with a bow,
// a big pair of scissors, balloons and confetti. The frame's corners are wrapped in ribbon like a gift.

import { balloon, borderLines, cloud, confetti, fourCorners, frameWash, groundOf, makeDefs, mix, n, paperFill, rng, sceneSky, sideRun, sparkle, svgDoc } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 360;
/** The occasion's sky (a clear day): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#8FC3E8";

/** A bow: two loops and two notched tails, centred on (x, y), `s` = 1 about 140 wide. */
export function bow(x: number, y: number, s: number, color: string): string {
  const dark = mix(color, "#000000", 0.28);
  const light = mix(color, "#FFFFFF", 0.3);
  const loop = (k: number) =>
    `<path d="M0 0C${n(-20 * k)} -36 ${n(-72 * k)} -36 ${n(-68 * k)} -4C${n(-64 * k)} 20 ${n(-24 * k)} 16 0 0Z" fill="${color}"/>` +
    `<path d="M0 0C${n(-16 * k)} -20 ${n(-46 * k)} -22 ${n(-50 * k)} -6C${n(-40 * k)} -14 ${n(-18 * k)} -10 0 0Z" fill="${dark}"/>` +
    `<path d="M${n(-10 * k)} -14C${n(-28 * k)} -28 ${n(-52 * k)} -28 ${n(-60 * k)} -14" stroke="${light}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const tail = (k: number) => `<path d="M${n(-4 * k)} 6L${n(-34 * k)} 70L${n(-22 * k)} 62L${n(-14 * k)} 76L${n(8 * k)} 8Z" fill="${k > 0 ? color : dark}"/>`;
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})">${tail(1)}${tail(-1)}${loop(1)}${loop(-1)}<rect x="-10" y="-12" width="20" height="24" rx="6" fill="${dark}"/><rect x="-6" y="-9" width="6" height="18" rx="3" fill="${light}" opacity="0.6"/></g>`;
}

/** A large pair of scissors, open, pivot at (x, y), turned `rot` degrees (0: blades pointing right). */
export function scissors(x: number, y: number, s: number, rot: number, handle: string): string {
  const half = (k: number, open: number) =>
    `<g transform="rotate(${open * k}) scale(1 ${k})">` +
    `<path d="M0 -7L126 -3Q138 0 126 3L0 8Z" fill="#D7DCE3"/>` +
    `<path d="M0 -7L126 -3Q138 0 126 3" stroke="#9AA3AE" stroke-width="1.6" fill="none"/>` +
    `<path d="M6 -3L118 -1" stroke="#F6F8FB" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M0 -7L-36 -10L-36 10L0 8Z" fill="#AEB6C1"/>` +
    `<ellipse cx="-66" cy="0" rx="30" ry="19" fill="none" stroke="${handle}" stroke-width="11"/>` +
    `<ellipse cx="-66" cy="-3" rx="30" ry="19" fill="none" stroke="#FFFFFF" stroke-width="2" opacity="0.35"/>` +
    `</g>`;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)}) scale(${n(s)})">${half(1, 15)}${half(-1, 15)}<circle r="6" fill="#7D8794"/><circle r="2.4" fill="#E3E7EC"/></g>`;
}

/** A ribbon band along a gentle curve from (x0, y0) to (x1, y0), `w` wide, sagging by `sag`. */
function ribbonBand(x0: number, x1: number, y0: number, sag: number, w: number, color: string): string {
  const mid = (x0 + x1) / 2;
  const light = mix(color, "#FFFFFF", 0.32);
  return (
    `<path d="M${n(x0)} ${n(y0)}Q${n(mid)} ${n(y0 + sag * 2)} ${n(x1)} ${n(y0)}L${n(x1)} ${n(y0 + w)}Q${n(mid)} ${n(y0 + w + sag * 2)} ${n(x0)} ${n(y0 + w)}Z" fill="${color}"/>` +
    `<path d="M${n(x0)} ${n(y0 + 4)}Q${n(mid)} ${n(y0 + 4 + sag * 2)} ${n(x1)} ${n(y0 + 4)}" stroke="${light}" stroke-width="2.4" fill="none"/>` +
    `<path d="M${n(x0)} ${n(y0 + w - 3)}Q${n(mid)} ${n(y0 + w - 3 + sag * 2)} ${n(x1)} ${n(y0 + w - 3)}" stroke="${mix(color, "#000000", 0.25)}" stroke-width="1.6" fill="none"/>`
  );
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const rib = c.primary;
  const colors = [c.primary, gold, mix(c.primary, "#FFFFFF", 0.45), mix(gold, "#FFFFFF", 0.35)];
  // A ribbon along each edge from the corner, ending in a notched tail, with a bow where they cross.
  const strip = (len: number) => `<path d="M0 37H${len}L${len - 14} 47L${len} 57H0Z" fill="${rib}"/><path d="M0 41H${len - 6}" stroke="${mix(rib, "#FFFFFF", 0.3)}" stroke-width="2"/>`;
  const corner = [
    strip(300),
    `<g transform="translate(0 0) rotate(90) scale(1 -1)">${strip(300)}</g>`,
    confetti(3, 26, { x0: 70, y0: 70, x1: 250, y1: 250 }, colors, 1.1),
    bow(47, 50, 0.62, rib),
    sparkle(214, 96, 9, gold),
    sparkle(98, 214, 8, gold),
  ].join("");
  const sides = sideRun(W, 400, H - 460, 70, (x, y, i) => (i % 3 === 0 ? sparkle(x, y, 7, gold) : `<rect x="${x - 4}" y="${y - 2}" width="8" height="4" rx="1" transform="rotate(${i * 37} ${x} ${y})" fill="${colors[i % colors.length]}"/>`));
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { dotted: false }) + sides + fourCorners(W, H, corner), p.defs + wash.defs);
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  out.push(cloud(W * 0.2, h * 0.42, 0.9, "#FFFFFF"), cloud(W * 0.86, h * 0.36, 0.7, "#FFFFFF"));
  // The street: neighbouring shops either side of ours.
  const fw = Math.min(W * 0.6, 620);
  const left = mid - fw / 2;
  const right = mid + fw / 2;
  const r = rng(17);
  const walls = ["#CDBBA8", "#B9C6CE", "#D8C9B1", "#B3C4B8", "#C9B3B0"];
  const shop = (x: number, w: number, i: number) => {
    const top = base - 140 - r() * 60;
    const wall = walls[i % walls.length];
    let s = `<rect x="${n(x)}" y="${n(top)}" width="${n(w)}" height="${n(base - top)}" fill="${wall}"/><rect x="${n(x - 3)}" y="${n(top)}" width="${n(w + 6)}" height="10" fill="${mix(wall, "#000000", 0.18)}"/>`;
    for (let wy = top + 26; wy < base - 110; wy += 46) for (let wx = x + 14; wx < x + w - 30; wx += 40) s += `<rect x="${n(wx)}" y="${n(wy)}" width="24" height="30" rx="2" fill="#EAF2F7"/><path d="M${n(wx + 12)} ${n(wy)}V${n(wy + 30)}" stroke="${mix(wall, "#000000", 0.2)}" stroke-width="2"/>`;
    s += `<path d="M${n(x + 8)} ${n(base - 96)}H${n(x + w - 8)}L${n(x + w - 16)} ${n(base - 76)}H${n(x + 16)}Z" fill="${mix(wall, "#000000", 0.25)}"/>`;
    s += `<rect x="${n(x + 16)}" y="${n(base - 72)}" width="${n(w - 32)}" height="60" fill="#E4EDF2"/>`;
    return s;
  };
  let i = 0;
  for (let x = left - 14; x > -10; i++) {
    const w = 120 + r() * 60;
    out.push(shop(x - w, w, i));
    x -= w + 6;
  }
  for (let x = right + 14; x < W + 10; i++) {
    const w = 120 + r() * 60;
    out.push(shop(x, w, i + 2));
    x += w + 6;
  }
  // Our shop: a cream front, a blank sign band in the brand colour, a striped awning, warm windows and a glass door.
  const top = base - 236;
  out.push(`<rect x="${n(left)}" y="${n(top)}" width="${n(fw)}" height="${n(base - top)}" fill="#F3EBDF"/>`);
  out.push(`<rect x="${n(left - 8)}" y="${n(top)}" width="${n(fw + 16)}" height="14" fill="#DCCDB9"/><rect x="${n(left - 4)}" y="${n(top + 14)}" width="${n(fw + 8)}" height="5" fill="#C9B9A3"/>`);
  out.push(`<rect x="${n(left + 30)}" y="${n(top + 30)}" width="${n(fw - 60)}" height="40" rx="4" fill="${c.primary}"/><rect x="${n(left + 36)}" y="${n(top + 36)}" width="${n(fw - 72)}" height="28" rx="2" fill="none" stroke="${c.secondary}" stroke-width="2"/>`);
  const aw = top + 80;
  const stripes = Math.max(8, Math.round(fw / 44));
  const sw = (fw + 20) / stripes;
  for (let k = 0; k < stripes; k++) {
    const x = left - 10 + k * sw;
    out.push(`<path d="M${n(x)} ${n(aw)}H${n(x + sw)}L${n(x + sw + 4)} ${n(aw + 36)}H${n(x + 4)}Z" fill="${k % 2 ? "#FFFFFF" : c.primary}"/>`);
    out.push(`<path d="M${n(x + 4)} ${n(aw + 36)}Q${n(x + 4 + sw / 2)} ${n(aw + 50)} ${n(x + sw + 4)} ${n(aw + 36)}Z" fill="${k % 2 ? "#F1F1F1" : mix(c.primary, "#000000", 0.15)}"/>`);
  }
  const winTop = aw + 62;
  const winH = base - 26 - winTop;
  const doorW = fw * 0.2;
  const winW = (fw - doorW - 80) / 2;
  const glass = d.linear("win", [
    [0, "#FFF1C9", 1],
    [1, "#FFD98F", 1],
  ]);
  for (const wx of [left + 20, right - 20 - winW]) {
    out.push(`<rect x="${n(wx)}" y="${n(winTop)}" width="${n(winW)}" height="${n(winH)}" fill="${glass}" stroke="#8C7B66" stroke-width="5"/>`);
    out.push(`<path d="M${n(wx + winW * 0.15)} ${n(winTop + winH)}L${n(wx + winW * 0.55)} ${n(winTop)}M${n(wx + winW * 0.42)} ${n(winTop + winH)}L${n(wx + winW * 0.8)} ${n(winTop)}" stroke="#FFFFFF" stroke-width="7" opacity="0.35"/>`);
    out.push(`<rect x="${n(wx + 6)}" y="${n(winTop + winH * 0.62)}" width="${n(winW - 12)}" height="5" fill="#B39A7C"/>`);
    for (let k = 0; k < 3; k++) out.push(`<circle cx="${n(wx + winW * (0.25 + k * 0.25))}" cy="${n(winTop + winH * 0.62 - 12)}" r="11" fill="${[mix(c.secondary, "#FFFFFF", 0.3), "#E9B8A0", "#CFE0C4"][k]}"/>`);
  }
  const dx = mid - doorW / 2;
  out.push(`<rect x="${n(dx)}" y="${n(winTop - 8)}" width="${n(doorW)}" height="${n(base - winTop + 8)}" fill="#6E5B47"/><rect x="${n(dx + 8)}" y="${n(winTop)}" width="${n(doorW - 16)}" height="${n(base - winTop - 6)}" fill="#D6E6EF"/>`);
  out.push(`<path d="M${n(mid)} ${n(winTop)}V${n(base - 6)}" stroke="#6E5B47" stroke-width="4"/><circle cx="${n(mid - 7)}" cy="${n(winTop + winH * 0.55)}" r="3" fill="${c.secondary}"/><circle cx="${n(mid + 7)}" cy="${n(winTop + winH * 0.55)}" r="3" fill="${c.secondary}"/>`);
  // The pavement.
  out.push(`<rect x="0" y="${n(base - 8)}" width="${n(W)}" height="${n(h - base + 8)}" fill="#C9CDD3"/><path d="M0 ${n(base - 8)}H${n(W)}" stroke="#E6E8EB" stroke-width="3"/>`);
  // Brass posts, the ribbon and its bow.
  const pl = mid - fw * 0.47;
  const pr = mid + fw * 0.47;
  const ry = base - 96;
  for (const px of [pl, pr]) {
    out.push(`<rect x="${n(px - 5)}" y="${n(ry - 6)}" width="10" height="${n(base - ry)}" fill="${c.secondary}"/><rect x="${n(px - 2)}" y="${n(ry - 6)}" width="3" height="${n(base - ry)}" fill="#FFFFFF" opacity="0.4"/>`);
    out.push(`<circle cx="${n(px)}" cy="${n(ry - 12)}" r="10" fill="${c.secondary}"/><circle cx="${n(px - 3)}" cy="${n(ry - 15)}" r="3" fill="#FFFFFF" opacity="0.55"/><ellipse cx="${n(px)}" cy="${n(base - 4)}" rx="22" ry="7" fill="${mix(c.secondary, "#000000", 0.25)}"/>`);
  }
  // Balloons tied to the posts.
  const pastel = [c.primary, c.secondary, mix(c.primary, "#FFFFFF", 0.45), "#F4EFE6"];
  const bunch = (px: number, k: number) =>
    [
      [-34, -126, 30],
      [8, -152, 32],
      [40, -112, 28],
      [-6, -96, 26],
    ]
      .map(([bx, by, br], j) => balloon(px + bx * k, ry + by, br, pastel[(j + (k > 0 ? 0 : 1)) % pastel.length], px, ry - 14))
      .join("");
  out.push(bunch(pl, -1), bunch(pr, 1));
  out.push(confetti(41, Math.round(W / 13), { x0: 0, y0: h - 340, x1: W, y1: base - 196 }, [c.primary, c.secondary, "#7FC8A9", "#F28C8C", "#8FB8E8"], 1.2));
  out.push(ribbonBand(pl, pr, ry, 6, 24, c.primary));
  out.push(bow(mid, ry + 12, 0.85, c.primary));
  out.push(scissors(mid + fw * 0.22, ry - 66, 1.2, 150, c.secondary));
  out.push(`<rect x="0" y="${n(base + 4)}" width="${n(W)}" height="${n(h - base)}" fill="#8E949C"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.34, "#CFE5F5", 1],
    [0.7, "#E8F2F9", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const ribbonCuttingPack: DrawnPack = {
  occasion: "ribbon_cutting",
  blurb: "A shopfront, ribbon, scissors and balloons; ribbon-wrapped corners",
  frame,
  scene,
  sceneHeight: 500,
  busy: BUSY,
  fade: { from: 0.14, to: 0.38 },
  scrim: 0.84,
  topInset: 54,
};
