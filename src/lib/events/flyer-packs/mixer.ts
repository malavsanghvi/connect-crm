// A mixer / networking evening: a city skyline at dusk under strings of warm lights, seen from a rooftop terrace.
// Swags of lights across the frame's top, soft bokeh circles in the brand colours in the corners.

import { borderLines, frameWash, glowDot, groundOf, makeDefs, mix, n, paperFill, rng, sceneSky, sideRun, skyline, sparkle, starField, stringLights, svgDoc, topCorners, type Defs } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (dusk rose): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#C97A9A";

const WARM = ["#FFE08A", "#FFC27A", "#FFF2C2", "#FFD36B"];

/** Swags of warm bulbs hanging from the top rule, from x0 to x1. */
export function lightSwags(d: Defs, x0: number, x1: number, y: number, sag: number, swags: number, wire: string): string {
  let out = "";
  const span = (x1 - x0) / swags;
  for (let s = 0; s < swags; s++) {
    const a = x0 + span * s;
    const pts: number[][] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push([a + span * t, y + sag * 4 * t * (1 - t)]);
    }
    out += `<path d="M${pts.map((p) => p.map(n).join(" ")).join("L")}" stroke="${wire}" stroke-width="1.6" fill="none"/>`;
    for (let i = 2; i < 20; i += 3) {
      const [bx, by] = pts[i];
      const c = WARM[(i + s) % WARM.length];
      out += glowDot(d, bx, by + 10, 38, c, 0.8) + `<path d="M${n(bx)} ${n(by)}V${n(by + 5)}" stroke="${wire}" stroke-width="3.4"/><ellipse cx="${n(bx)}" cy="${n(by + 11)}" rx="5.6" ry="7" fill="${c}"/><circle cx="${n(bx - 1.6)}" cy="${n(by + 9)}" r="2" fill="#FFFFFF" opacity="0.7"/>`;
    }
  }
  return out;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  const d = makeDefs("f");
  const bokeh = [
    [98, 104, 32, c.primary, 0.12],
    [158, 74, 18, gold, 0.24],
    [70, 168, 16, gold, 0.22],
    [184, 136, 11, c.primary, 0.22],
    [124, 182, 8, gold, 0.4],
    [236, 92, 7, c.primary, 0.32],
  ]
    .map(([x, y, r, col, a]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity="${a}"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${col}" stroke-width="1.4" opacity="${Math.min(0.6, (a as number) * 2.2)}"/>`)
    .join("");
  const corner = bokeh + sparkle(176, 196, 10, gold) + sparkle(300, 110, 7, gold) + sparkle(82, 300, 7, gold);
  const sides = sideRun(W, 380, H - 460, 54, (x, y, i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 4 : 2.4}" fill="${i % 2 ? gold : c.primary}" opacity="${i % 3 === 0 ? 0.8 : 0.55}"/>`);
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { dotted: false, radius: 14 }) + sides + topCorners(W, corner) + lightSwags(d, 40, W - 40, 30, 36, 3, mix(c.ink, c.paper, 0.35)), p.defs + wash.defs + d.svg());
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const roof = base - 46;
  const out: string[] = [];
  out.push(starField(31, Math.round(W / 16), { x0: 0, y0: h * 0.46, x1: W, y1: h * 0.62 }, "#FFF6E0"));
  // A low moon.
  const mx = W * 0.74;
  const my = h * 0.42;
  out.push(glowDot(d, mx, my, 130, "#FFE9C2", 0.5), `<circle cx="${n(mx)}" cy="${n(my)}" r="40" fill="#FBE7C3"/><circle cx="${n(mx - 12)}" cy="${n(my - 8)}" r="8" fill="#F0D5A8"/><circle cx="${n(mx + 14)}" cy="${n(my + 12)}" r="5" fill="#F0D5A8"/>`);
  // The city, tinted by the brand colour.
  out.push(skyline(W, roof, { seed: 9, height: 180, back: mix(c.primary, "#3B3F72", 0.55), front: mix(c.primary, "#151833", 0.72), lit: "#FFD98A", litShare: 0.36 }));
  // Bokeh over the city.
  const r = rng(13);
  for (let i = 0; i < Math.round(W / 40); i++) {
    const x = r() * W;
    const y = h * 0.6 + r() * (roof - h * 0.6);
    out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(6 + r() * 16)}" fill="${WARM[i % WARM.length]}" opacity="${n(0.12 + r() * 0.16)}"/>`);
  }
  // Two strings of warm lights across the terrace.
  const lights: string[] = [];
  stringLights(W, h - 330 + 18, 46, 0, lights, { colours: WARM, wire: "#2A2540", glow: d, every: 2, size: 5.2 });
  stringLights(W, h - 330 + 66, 30, 1, lights, { colours: WARM, wire: "#2A2540", glow: d, every: 3, size: 4.4 });
  out.push(lights.join(""));
  // The terrace: a glass railing with posts, planters with round shrubs.
  out.push(`<rect x="0" y="${n(roof)}" width="${n(W)}" height="${n(base - roof)}" fill="#E8EEF5" opacity="0.16"/>`);
  out.push(`<path d="M0 ${n(roof)}H${n(W)}" stroke="${mix(c.secondary, "#FFFFFF", 0.2)}" stroke-width="4"/>`);
  for (let x = 20; x < W; x += 64) out.push(`<rect x="${n(x - 2.5)}" y="${n(roof)}" width="5" height="${n(base - roof)}" fill="#2A2740"/>`);
  for (const fx of [0.36, 0.64, 0.94]) {
    const x = W * fx;
    out.push(
      `<rect x="${n(x - 34)}" y="${n(base - 30)}" width="68" height="30" rx="4" fill="${mix(c.primary, "#000000", 0.35)}"/>`,
      `<circle cx="${n(x - 16)}" cy="${n(base - 42)}" r="20" fill="#2F5D46"/><circle cx="${n(x + 14)}" cy="${n(base - 46)}" r="23" fill="#3B7556"/><circle cx="${n(x)}" cy="${n(base - 58)}" r="18" fill="#4A8A63"/>`,
    );
  }
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="${mix(c.primary, "#0D0F1F", 0.6)}"/>`);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.3, "#F2B48C", 0.95],
    [0.42, "#D88A98", 1],
    [0.56, "#6A4E8E", 1],
    [0.74, "#2A2D5C", 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/>${out.join("")}`, sky + d.svg());
}

export const mixerPack: DrawnPack = {
  occasion: "mixer",
  blurb: "A city skyline at dusk under string lights; light swags and bokeh",
  frame,
  scene,
  sceneHeight: 480,
  busy: BUSY,
  fade: { from: 0.15, to: 0.42 },
  scrim: 0.84,
  topInset: 86,
};
