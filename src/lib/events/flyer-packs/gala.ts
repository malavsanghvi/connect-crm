// A gala / fundraiser dinner: a dressed banquet table with a candelabra, flowers and glassware under chandeliers, in a room
// of the brand's deep colour with warm light. The frame is art deco: fans in the corners, a chevron crest, fine lines.

import { borderLines, candle, frameWash, glowDot, groundOf, makeDefs, mix, n, paperFill, rng, sceneSky, sideRun, svgDoc, topCorners, type Defs } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 360;

/** An art deco fan in the corner at (0, 0), opening into the poster. */
function decoFan(r: number, gold: string): string {
  let out = `<path d="M16 16L${n(16 + r * 0.42)} 16A${n(r * 0.42)} ${n(r * 0.42)} 0 0 1 16 ${n(16 + r * 0.42)}Z" fill="${gold}" opacity="0.2"/>`;
  for (const [k, w] of [
    [0.42, 1.8],
    [0.6, 1],
    [0.78, 1],
    [0.96, 2.2],
  ] as const)
    out += `<path d="M${n(16 + r * k)} 16A${n(r * k)} ${n(r * k)} 0 0 1 16 ${n(16 + r * k)}" stroke="${gold}" stroke-width="${w}" fill="none"/>`;
  for (let i = 0; i <= 9; i++) {
    const a = ((Math.PI / 2) * i) / 9;
    const x0 = 16 + Math.cos(a) * r * 0.42;
    const y0 = 16 + Math.sin(a) * r * 0.42;
    const x1 = 16 + Math.cos(a) * r * 0.96;
    const y1 = 16 + Math.sin(a) * r * 0.96;
    out += `<path d="M${n(x0)} ${n(y0)}L${n(x1)} ${n(y1)}" stroke="${gold}" stroke-width="1.1"/>`;
    if (i % 2 === 1) {
      const x2 = 16 + Math.cos(a) * r * 1.06;
      const y2 = 16 + Math.sin(a) * r * 1.06;
      out += `<path d="M${n(x2)} ${n(y2 - 6)}l5 6-5 6-5-6z" fill="${gold}"/>`;
    }
  }
  // A small sunburst in the fan's heart.
  for (let i = 0; i < 5; i++) {
    const a = ((Math.PI / 2) * (i + 0.5)) / 5;
    out += `<path d="M16 16L${n(16 + Math.cos(a - 0.08) * r * 0.36)} ${n(16 + Math.sin(a - 0.08) * r * 0.36)}L${n(16 + Math.cos(a + 0.08) * r * 0.36)} ${n(16 + Math.sin(a + 0.08) * r * 0.36)}Z" fill="${gold}" opacity="0.55"/>`;
  }
  return out;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  // The crest: three nested chevrons and a diamond, centred on the top rule.
  const cx = W / 2;
  let crest = "";
  for (let k = 0; k < 3; k++) crest += `<path d="M${n(cx - 70 + k * 16)} 24L${n(cx)} ${n(40 - k * 6)}L${n(cx + 70 - k * 16)} 24" stroke="${gold}" stroke-width="${k === 0 ? 2 : 1.2}" fill="none"/>`;
  crest += `<path d="M${n(cx)} 10l9 12-9 12-9-12z" fill="${gold}"/><path d="M${n(cx - 150)} 30H${n(cx - 86)}M${n(cx + 86)} 30H${n(cx + 150)}" stroke="${gold}" stroke-width="1.2"/>`;
  // Long fine lines down the sides with a diamond every so often.
  const lines = `<path d="M30 300V${n(H - 300)}M${n(W - 30)} 300V${n(H - 300)}" stroke="${gold}" stroke-width="1" opacity="0.7"/>`;
  const diamonds = sideRun(W, 360, H - 420, 120, (x, y) => `<path d="M${x} ${y - 9}l6 9-6 9-6-9z" fill="${gold}"/><path d="M${x} ${y - 18}V${y - 12}M${x} ${y + 12}V${y + 18}" stroke="${gold}" stroke-width="1.2"/>`);
  const corner = decoFan(190, gold) + `<path d="M16 230V250M230 16H250" stroke="${gold}" stroke-width="1.6"/>`;
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, c.primary);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { dotted: false, radius: 2 }) + lines + diamonds + topCorners(W, corner) + `<g transform="translate(0 ${n(H)}) scale(1 -1)">${corner}</g><g transform="translate(${n(W)} ${n(H)}) scale(-1 -1)">${corner}</g>` + crest, p.defs + wash.defs);
}

/** A chandelier hanging from `top`, its bowl at `y`. */
function chandelier(d: Defs, x: number, top: number, y: number, s: number, gold: string): string {
  const X = (v: number) => n(x + v * s);
  const Y = (v: number) => n(y + v * s);
  let out = glowDot(d, x, y + 8 * s, 120 * s, "#FFD58A", 0.42);
  out += `<path d="M${n(x)} ${n(top)}V${Y(-14)}" stroke="${gold}" stroke-width="${n(2 * s)}"/>`;
  out += `<ellipse cx="${n(x)}" cy="${Y(-18)}" rx="${n(6 * s)}" ry="${n(8 * s)}" fill="${gold}"/>`;
  out += `<path d="M${X(-30)} ${Y(0)}Q${X(0)} ${Y(30)} ${X(30)} ${Y(0)}Z" fill="${gold}"/>`;
  for (const [ax, ay] of [
    [-74, -14],
    [-44, -24],
    [44, -24],
    [74, -14],
    [0, -34],
  ]) {
    if (ax !== 0) out += `<path d="M${X(ax * 0.2)} ${Y(4)}Q${X(ax * 0.8)} ${Y(18)} ${X(ax)} ${Y(ay + 8)}" stroke="${gold}" stroke-width="${n(2.6 * s)}" fill="none"/>`;
    else out += `<path d="M${X(0)} ${Y(0)}V${Y(ay + 8)}" stroke="${gold}" stroke-width="${n(2.6 * s)}"/>`;
    out += `<rect x="${X(ax - 3)}" y="${Y(ay - 4)}" width="${n(6 * s)}" height="${n(12 * s)}" fill="#FFF4DC"/>`;
    out += glowDot(d, x + ax * s, y + (ay - 10) * s, 18 * s, "#FFE6A8", 0.9);
    out += `<path d="M${X(ax)} ${Y(ay - 15)}q${n(3 * s)} ${n(5 * s)} 0 ${n(10 * s)}q${n(-3 * s)} ${n(-5 * s)} 0 ${n(-10 * s)}z" fill="#FFC44D"/>`;
  }
  // Crystal drops.
  for (const dx of [-24, -12, 0, 12, 24]) out += `<path d="M${X(dx)} ${Y(14 - Math.abs(dx) * 0.3)}v${n(10 * s)}" stroke="#F2EEE6" stroke-width="1" opacity="0.8"/><path d="M${X(dx)} ${Y(24 - Math.abs(dx) * 0.3)}l${n(3 * s)} ${n(5 * s)}l${n(-3 * s)} ${n(5 * s)}l${n(-3 * s)} ${n(-5 * s)}z" fill="#FFFFFF" opacity="0.85"/>`;
  return out;
}

function wineGlass(x: number, ty: number, wine: string | null): string {
  let out = `<ellipse cx="${n(x)}" cy="${n(ty)}" rx="11" ry="3" fill="#FFFFFF" opacity="0.7"/><path d="M${n(x)} ${n(ty)}V${n(ty - 30)}" stroke="#FFFFFF" stroke-width="2.4" opacity="0.8"/>`;
  out += `<path d="M${n(x - 15)} ${n(ty - 62)}Q${n(x - 17)} ${n(ty - 30)} ${n(x)} ${n(ty - 30)}Q${n(x + 17)} ${n(ty - 30)} ${n(x + 15)} ${n(ty - 62)}Z" fill="#FFFFFF" opacity="0.22"/>`;
  if (wine) out += `<path d="M${n(x - 16)} ${n(ty - 47)}Q${n(x - 16)} ${n(ty - 31)} ${n(x)} ${n(ty - 31)}Q${n(x + 16)} ${n(ty - 31)} ${n(x + 16)} ${n(ty - 47)}Z" fill="${wine}" opacity="0.9"/>`;
  out += `<path d="M${n(x - 15)} ${n(ty - 62)}Q${n(x - 17)} ${n(ty - 30)} ${n(x)} ${n(ty - 30)}Q${n(x + 17)} ${n(ty - 30)} ${n(x + 15)} ${n(ty - 62)}" stroke="#FFFFFF" stroke-width="1.4" fill="none" opacity="0.8"/>`;
  return `${out}<path d="M${n(x - 9)} ${n(ty - 56)}Q${n(x - 10)} ${n(ty - 40)} ${n(x - 5)} ${n(ty - 36)}" stroke="#FFFFFF" stroke-width="2.4" fill="none" opacity="0.7" stroke-linecap="round"/>`;
}

function flute(x: number, ty: number): string {
  return (
    `<ellipse cx="${n(x)}" cy="${n(ty)}" rx="9" ry="2.6" fill="#FFFFFF" opacity="0.7"/><path d="M${n(x)} ${n(ty)}V${n(ty - 26)}" stroke="#FFFFFF" stroke-width="2.2" opacity="0.8"/>` +
    `<path d="M${n(x - 8)} ${n(ty - 74)}L${n(x - 6)} ${n(ty - 32)}Q${n(x)} ${n(ty - 26)} ${n(x + 6)} ${n(ty - 32)}L${n(x + 8)} ${n(ty - 74)}Z" fill="#FFFFFF" opacity="0.22"/>` +
    `<path d="M${n(x - 7.6)} ${n(ty - 60)}L${n(x - 6)} ${n(ty - 32)}Q${n(x)} ${n(ty - 27)} ${n(x + 6)} ${n(ty - 32)}L${n(x + 7.6)} ${n(ty - 60)}Z" fill="#F3DE96" opacity="0.92"/>` +
    `<circle cx="${n(x - 2)}" cy="${n(ty - 48)}" r="1.2" fill="#FFFFFF"/><circle cx="${n(x + 2)}" cy="${n(ty - 40)}" r="1" fill="#FFFFFF"/>` +
    `<path d="M${n(x - 8)} ${n(ty - 74)}L${n(x - 6)} ${n(ty - 32)}Q${n(x)} ${n(ty - 26)} ${n(x + 6)} ${n(ty - 32)}L${n(x + 8)} ${n(ty - 74)}" stroke="#FFFFFF" stroke-width="1.3" fill="none" opacity="0.8"/>`
  );
}

/** A low bowl of roses and leaves. */
function roses(x: number, ty: number, s: number, bowl: string): string {
  const r = rng(Math.round(x));
  let out = "";
  for (const [lx, ly, rot] of [
    [-50, -18, -70],
    [50, -18, 70],
    [-36, -36, -40],
    [36, -36, 40],
  ])
    out += `<ellipse cx="${n(x + lx * s)}" cy="${n(ty + ly * s)}" rx="${n(20 * s)}" ry="${n(8 * s)}" transform="rotate(${rot} ${n(x + lx * s)} ${n(ty + ly * s)})" fill="#3F7A55"/>`;
  const blooms: [number, number, number, string][] = [
    [-30, -30, 15, "#F2C4C0"],
    [0, -44, 17, "#F7EFE8"],
    [30, -30, 15, "#E8A0A8"],
    [-14, -20, 14, "#E8A0A8"],
    [16, -20, 14, "#F7EFE8"],
    [0, -26, 12, "#F2C4C0"],
  ];
  for (const [bx, by, br, col] of blooms) {
    const cx = x + bx * s;
    const cy = ty + by * s;
    out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(br * s)}" fill="${col}"/>`;
    out += `<path d="M${n(cx - br * s * 0.5)} ${n(cy)}a${n(br * s * 0.5)} ${n(br * s * 0.5)} 0 1 1 ${n(br * s * 0.5)} ${n(br * s * 0.5)}a${n(br * s * 0.3)} ${n(br * s * 0.3)} 0 1 1 ${n(-br * s * 0.2)} ${n(-br * s * 0.55)}" stroke="${mix(col, "#7A2E3A", 0.35)}" stroke-width="1.4" fill="none" opacity="${n(0.6 + r() * 0.2)}"/>`;
  }
  out += `<path d="M${n(x - 34 * s)} ${n(ty - 12 * s)}H${n(x + 34 * s)}L${n(x + 24 * s)} ${n(ty)}H${n(x - 24 * s)}Z" fill="${bowl}"/>`;
  return out;
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const gold = c.secondary;
  const deep = mix(c.primary, "#000000", 0.5);
  const out: string[] = [];
  out.push(glowDot(d, mid, base - 120, Math.min(W * 0.55, 460), "#FFC870", 0.42));
  // Warm bokeh in the room.
  const r = rng(29);
  for (let i = 0; i < Math.round(W / 34); i++) {
    const x = r() * W;
    const y = h - 330 + r() * 170;
    out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(5 + r() * 14)}" fill="#FFE2A6" opacity="${n(0.1 + r() * 0.18)}"/>`);
  }
  // Drapes at the sides, tied back with gold.
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? 0 : W;
    const dw = Math.min(110, W * 0.1);
    let drape = "";
    for (let k = 0; k < 5; k++) {
      const a = x0 - side * (dw * k) / 5;
      const b = x0 - side * (dw * (k + 1)) / 5;
      drape += `<path d="M${n(a)} ${n(h - 360)}L${n(b)} ${n(h - 360)}Q${n(b + side * 10)} ${n(base - 150)} ${n(b - side * 14)} ${n(base - 120)}Q${n(b - side * 4)} ${n(base - 60)} ${n(b + side * 6)} ${n(base)}L${n(a)} ${n(base)}Z" fill="${mix(c.primary, "#000000", k % 2 ? 0.42 : 0.3)}"/>`;
    }
    out.push(drape);
  }
  // A valance of swags across the top, trimmed in gold, with small tassels.
  const swags = Math.max(4, Math.round(W / 180));
  const sw = W / swags;
  const vy = h - 338;
  let valance = `<rect x="0" y="${n(vy - 20)}" width="${n(W)}" height="22" fill="${mix(c.primary, "#000000", 0.45)}"/>`;
  for (let k = 0; k < swags; k++) {
    const a = k * sw;
    valance += `<path d="M${n(a)} ${n(vy)}Q${n(a + sw / 2)} ${n(vy + 52)} ${n(a + sw)} ${n(vy)}Z" fill="${mix(c.primary, "#000000", 0.36)}"/>`;
    valance += `<path d="M${n(a)} ${n(vy)}Q${n(a + sw / 2)} ${n(vy + 52)} ${n(a + sw)} ${n(vy)}" stroke="${gold}" stroke-width="3" fill="none"/>`;
    valance += `<path d="M${n(a + sw * 0.18)} ${n(vy + 8)}Q${n(a + sw / 2)} ${n(vy + 36)} ${n(a + sw * 0.82)} ${n(vy + 8)}" stroke="${mix(c.primary, "#000000", 0.5)}" stroke-width="2" fill="none"/>`;
    valance += `<path d="M${n(a)} ${n(vy)}V${n(vy + 22)}" stroke="${gold}" stroke-width="2"/><path d="M${n(a - 4)} ${n(vy + 22)}h8l-2 12h-4z" fill="${gold}"/>`;
  }
  valance += `<path d="M0 ${n(vy)}H${n(W)}M0 ${n(vy - 20)}H${n(W)}" stroke="${gold}" stroke-width="2"/>`;
  out.push(chandelier(d, W * 0.28, h - 352, h - 296, 1, gold), chandelier(d, W * 0.72, h - 352, h - 296, 1, gold), valance);
  // The table: a long white cloth with soft folds and a gold runner.
  const ty = base - 70;
  out.push(`<rect x="-10" y="${n(ty)}" width="${n(W + 20)}" height="${n(h - ty)}" fill="#F6F1E6"/>`);
  for (let x = 30; x < W; x += 64) out.push(`<rect x="${n(x)}" y="${n(ty + 8)}" width="14" height="${n(h - ty)}" fill="#E6DCCB" opacity="0.7"/>`);
  out.push(`<rect x="-10" y="${n(ty)}" width="${n(W + 20)}" height="7" fill="#FFFFFF"/><rect x="-10" y="${n(ty + 7)}" width="${n(W + 20)}" height="5" fill="${gold}"/>`);
  out.push(`<path d="M${n(mid - 48)} ${n(ty + 12)}H${n(mid + 48)}V${n(base - 4)}L${n(mid)} ${n(base + 10)}L${n(mid - 48)} ${n(base - 4)}Z" fill="${gold}"/><path d="M${n(mid - 40)} ${n(ty + 18)}H${n(mid + 40)}V${n(base - 8)}L${n(mid)} ${n(base + 2)}L${n(mid - 40)} ${n(base - 8)}Z" fill="none" stroke="${mix(gold, "#FFFFFF", 0.4)}" stroke-width="1.4"/>`);
  // The candelabra in the middle.
  const arms: [number, number][] = [
    [0, -132],
    [-42, -112],
    [42, -112],
    [-82, -94],
    [82, -94],
  ];
  out.push(`<ellipse cx="${n(mid)}" cy="${n(ty)}" rx="30" ry="7" fill="${mix(gold, "#000000", 0.2)}"/><path d="M${n(mid - 6)} ${n(ty)}L${n(mid - 4)} ${n(ty - 70)}H${n(mid + 4)}L${n(mid + 6)} ${n(ty)}Z" fill="${gold}"/>`);
  for (const [ax, ay] of arms) {
    if (ax !== 0) out.push(`<path d="M${n(mid)} ${n(ty - 62)}Q${n(mid + ax)} ${n(ty - 66)} ${n(mid + ax)} ${n(ty + ay + 6)}" stroke="${gold}" stroke-width="4" fill="none"/>`);
    else out.push(`<path d="M${n(mid)} ${n(ty - 62)}V${n(ty + ay + 6)}" stroke="${gold}" stroke-width="4"/>`);
    out.push(`<path d="M${n(mid + ax - 10)} ${n(ty + ay + 6)}H${n(mid + ax + 10)}L${n(mid + ax + 6)} ${n(ty + ay + 12)}H${n(mid + ax - 6)}Z" fill="${gold}"/>`);
    out.push(candle(d, mid + ax, ty + ay + 6, 40, 10, { halo: 0.9 }));
  }
  out.push(roses(mid - 150, ty, 1, gold), roses(mid + 150, ty, 1, gold));
  // Place settings along the table: a charger and plate, a folded napkin, a wine glass and a flute.
  const spots: number[] = [];
  for (let x = mid + 250; x < W - 30; x += 170) spots.push(x);
  for (let x = mid - 250; x > 30; x -= 170) spots.push(x);
  spots.forEach((x, i) => {
    out.push(`<ellipse cx="${n(x)}" cy="${n(ty - 2)}" rx="44" ry="9" fill="${gold}"/><ellipse cx="${n(x)}" cy="${n(ty - 4)}" rx="36" ry="7" fill="#FFFFFF"/><ellipse cx="${n(x)}" cy="${n(ty - 4)}" rx="24" ry="4.4" fill="none" stroke="#E2D9C8" stroke-width="1.2"/>`);
    out.push(`<path d="M${n(x - 14)} ${n(ty - 6)}L${n(x)} ${n(ty - 40)}L${n(x + 14)} ${n(ty - 6)}Z" fill="${c.primary}"/><path d="M${n(x)} ${n(ty - 40)}L${n(x + 14)} ${n(ty - 6)}H${n(x + 4)}Z" fill="${deep}"/>`);
    out.push(wineGlass(x + 52, ty - 4, i % 2 ? "#8E1F35" : null), flute(x + 76, ty - 4));
  });
  out.push(`<rect x="0" y="${n(base + 6)}" width="${n(W)}" height="${n(h - base)}" fill="${mix(c.primary, "#000000", 0.62)}"/>`);
  const sky = sceneSky(
    c,
    h,
    BUSY,
    c.primary,
    [
      [0.3, mix(c.primary, "#000000", 0.2), 0.96],
      [0.55, deep, 1],
      [1, mix(c.primary, "#000000", 0.6), 1],
    ],
  );
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const galaPack: DrawnPack = {
  occasion: "gala",
  blurb: "A banquet table, candelabra and chandeliers; art deco fans",
  frame,
  scene,
  sceneHeight: 500,
  busy: BUSY,
  fade: { from: 0.12, to: 0.36 },
  scrim: 0.84,
  topInset: 54,
};
