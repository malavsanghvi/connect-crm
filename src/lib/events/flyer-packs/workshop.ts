// A workshop / class / training: a bright workroom with pendant lamps, a board of sticky notes and a simple chart, a shelf
// of books and plants, and a table set with a laptop, notebooks and mugs. Simple shapes, no words anywhere.
// The frame: a clean line, graph-paper dots and small geometric shapes in the corners, a lightbulb for ideas.

import { borderLines, frameWash, glowDot, groundOf, leaf, makeDefs, mix, n, paperFill, sceneSky, sideRun, svgDoc, topCorners } from "./draw";
import type { ArtColors, DrawnPack } from "./types";

/** Units from the scene's bottom that hold its art (the words stay above them). */
const BUSY = 330;
/** The occasion's sky (a cool, bright room): the frame's quiet wash and the top of the scene's sky. */
const TINT = "#A9BACB";

/** A lightbulb with short rays, centred on (x, y). */
function bulb(x: number, y: number, s: number, line: string, glass: string): string {
  let out = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(20 * s)}" fill="${glass}"/>`;
  out += `<path d="M${n(x - 12 * s)} ${n(y + 14 * s)}Q${n(x - 10 * s)} ${n(y + 22 * s)} ${n(x - 9 * s)} ${n(y + 28 * s)}H${n(x + 9 * s)}Q${n(x + 10 * s)} ${n(y + 22 * s)} ${n(x + 12 * s)} ${n(y + 14 * s)}" fill="${glass}"/>`;
  out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(20 * s)}" fill="none" stroke="${line}" stroke-width="${n(2.4 * s)}"/>`;
  out += `<path d="M${n(x - 9 * s)} ${n(y + 30 * s)}H${n(x + 9 * s)}M${n(x - 8 * s)} ${n(y + 35 * s)}H${n(x + 8 * s)}M${n(x - 5 * s)} ${n(y + 40 * s)}H${n(x + 5 * s)}" stroke="${line}" stroke-width="${n(2.4 * s)}" stroke-linecap="round"/>`;
  out += `<path d="M${n(x - 6 * s)} ${n(y + 14 * s)}L${n(x - 3 * s)} ${n(y + 2 * s)}L${n(x)} ${n(y + 8 * s)}L${n(x + 3 * s)} ${n(y + 2 * s)}L${n(x + 6 * s)} ${n(y + 14 * s)}" stroke="${line}" stroke-width="${n(1.6 * s)}" fill="none"/>`;
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (Math.PI * i) / 6;
    out += `<path d="M${n(x + Math.cos(a) * 28 * s)} ${n(y + Math.sin(a) * 28 * s)}L${n(x + Math.cos(a) * 38 * s)} ${n(y + Math.sin(a) * 38 * s)}" stroke="${line}" stroke-width="${n(2.4 * s)}" stroke-linecap="round"/>`;
  }
  return out;
}

function frame(W: number, H: number, c: ArtColors): string {
  const gold = c.secondary;
  let dots = "";
  for (let y = 60; y < 260; y += 18) for (let x = 60; x < 260; x += 18) if ((x - 44) ** 2 + (y - 44) ** 2 < 200 ** 2) dots += `<circle cx="${x}" cy="${y}" r="1.6" fill="${c.primary}" opacity="0.28"/>`;
  const corner =
    dots +
    `<circle cx="196" cy="76" r="22" fill="none" stroke="${c.primary}" stroke-width="3"/>` +
    `<path d="M70 222L94 180L118 222Z" fill="${gold}" opacity="0.85"/>` +
    `<rect x="150" y="160" width="26" height="26" rx="3" transform="rotate(18 163 173)" fill="${mix(c.primary, "#FFFFFF", 0.55)}"/>` +
    `<path d="M236 150v18M227 159h18" stroke="${gold}" stroke-width="3" stroke-linecap="round"/>` +
    bulb(98, 96, 1.05, c.primary, mix(gold, "#FFFFFF", 0.6));
  const sides = sideRun(W, 380, H - 460, 64, (x, y, i) => (i % 3 === 0 ? `<path d="M${x} ${y - 6}v12M${x - 6} ${y}h12" stroke="${gold}" stroke-width="2" stroke-linecap="round"/>` : `<circle cx="${x}" cy="${y}" r="2" fill="${c.primary}" opacity="0.5"/>`));
  const p = paperFill(W, H, c);
  const wash = frameWash(W, H, c, TINT);
  return svgDoc(W, H, p.body + wash.body + borderLines(W, H, gold, { dotted: false, radius: 16 }) + sides + topCorners(W, corner), p.defs + wash.defs);
}

function pendant(d: ReturnType<typeof makeDefs>, x: number, top: number, y: number, shade: string): string {
  return (
    `<path d="M${n(x)} ${n(top)}V${n(y - 22)}" stroke="#4A4F57" stroke-width="2"/>` +
    `<path d="M${n(x - 40)} ${n(y + 160)}L${n(x - 30)} ${n(y)}H${n(x + 30)}L${n(x + 40)} ${n(y + 160)}Z" fill="#FFF3D0" opacity="0.18"/>` +
    glowDot(d, x, y + 8, 70, "#FFE3A0", 0.65) +
    `<path d="M${n(x - 30)} ${n(y)}Q${n(x - 28)} ${n(y - 24)} ${n(x)} ${n(y - 24)}Q${n(x + 28)} ${n(y - 24)} ${n(x + 30)} ${n(y)}Z" fill="${shade}"/>` +
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="30" ry="5" fill="${mix(shade, "#000000", 0.25)}"/><ellipse cx="${n(x)}" cy="${n(y + 4)}" rx="9" ry="6" fill="#FFF6D8"/>`
  );
}

function pottedPlant(x: number, base: number, s: number, pot: string): string {
  let out = "";
  for (const [rot, len, col] of [
    [-40, 56, "#5E9E5E"],
    [-14, 70, "#447F49"],
    [12, 66, "#5E9E5E"],
    [38, 54, "#7DB474"],
    [-2, 48, "#7DB474"],
  ] as const)
    out += leaf(x, base - 34 * s, len * s, 11 * s, rot, col);
  return out + `<path d="M${n(x - 20 * s)} ${n(base - 36 * s)}H${n(x + 20 * s)}L${n(x + 15 * s)} ${n(base)}H${n(x - 15 * s)}Z" fill="${pot}"/><rect x="${n(x - 22 * s)}" y="${n(base - 40 * s)}" width="${n(44 * s)}" height="${n(8 * s)}" rx="2" fill="${mix(pot, "#000000", 0.15)}"/>`;
}

function scene(W: number, h: number, c: ArtColors): string {
  const d = makeDefs("s");
  const base = groundOf(h);
  const mid = W / 2;
  const out: string[] = [];
  const top = h - 330;
  // The back wall: a soft wash with a picture rail.
  out.push(`<path d="M0 ${n(top + 20)}H${n(W)}" stroke="${mix(c.paper, "#7A8592", 0.25)}" stroke-width="3"/>`);
  // The board: sticky notes in a grid, a little bar chart and an arrow (no writing).
  const bx = mid - 290;
  const by = top + 44;
  const bw = 300;
  const bh = 124;
  out.push(`<rect x="${n(bx - 8)}" y="${n(by - 8)}" width="${n(bw + 16)}" height="${n(bh + 16)}" rx="6" fill="#9AA3AD"/><rect x="${n(bx)}" y="${n(by)}" width="${n(bw)}" height="${n(bh)}" rx="3" fill="#FFFFFF"/>`);
  const notes = ["#FFE27A", "#FFB3C1", "#A8E6CF", mix(c.primary, "#FFFFFF", 0.6), "#FFE27A", mix(c.secondary, "#FFFFFF", 0.5)];
  notes.forEach((col, i) => {
    const nx = bx + 18 + (i % 3) * 48;
    const ny = by + 14 + Math.floor(i / 3) * 52;
    out.push(`<rect x="${n(nx)}" y="${n(ny)}" width="36" height="36" transform="rotate(${(i % 2 ? 3 : -3)} ${n(nx + 18)} ${n(ny + 18)})" fill="${col}"/>`, `<path d="M${n(nx + 7)} ${n(ny + 13)}h20M${n(nx + 7)} ${n(ny + 21)}h15" stroke="${mix(col, "#000000", 0.25)}" stroke-width="2" stroke-linecap="round"/>`);
  });
  const cx0 = bx + 176;
  const cy0 = by + bh - 18;
  [32, 52, 42, 72].forEach((bhh, i) => out.push(`<rect x="${n(cx0 + i * 26)}" y="${n(cy0 - bhh)}" width="16" height="${bhh}" fill="${i === 3 ? c.primary : mix(c.primary, "#FFFFFF", 0.45)}"/>`));
  out.push(`<path d="M${n(cx0 - 6)} ${n(cy0)}H${n(cx0 + 108)}" stroke="#5B6470" stroke-width="2"/><path d="M${n(cx0)} ${n(cy0 - 44)}Q${n(cx0 + 50)} ${n(cy0 - 64)} ${n(cx0 + 98)} ${n(cy0 - 92)}" stroke="${c.secondary}" stroke-width="3" fill="none"/><path d="M${n(cx0 + 98)} ${n(cy0 - 92)}l-14 2 8 10z" fill="${c.secondary}"/>`);
  // The shelf: books, a plant and a jar.
  const sx = mid + 110;
  for (const sy of [top + 132]) out.push(`<rect x="${n(sx)}" y="${n(sy)}" width="240" height="8" rx="2" fill="#B88A5E"/>`);
  const books = [c.primary, "#E8B04A", mix(c.primary, "#FFFFFF", 0.4), "#7FA9C9", c.secondary, "#C97B6B", "#8DB58A"];
  let bxp = sx + 10;
  books.forEach((col, i) => {
    const bwid = 16 + (i % 3) * 4;
    const bht = 58 + ((i * 7) % 18);
    out.push(`<rect x="${n(bxp)}" y="${n(top + 132 - bht)}" width="${bwid}" height="${bht}" rx="2" fill="${col}"/><path d="M${n(bxp + 3)} ${n(top + 132 - bht + 10)}h${bwid - 6}M${n(bxp + 3)} ${n(top + 132 - 14)}h${bwid - 6}" stroke="#FFFFFF" stroke-width="1.6" opacity="0.6"/>`);
    bxp += bwid + 3;
  });
  out.push(pottedPlant(sx + 196, top + 132, 0.8, "#D9825B"));
    // Tall plants at the ends of the wall.
  out.push(pottedPlant(mid - 400, base - 70, 1.6, "#D9825B"), pottedPlant(mid + 420, base - 70, 1.5, mix(c.primary, "#FFFFFF", 0.2)));
  // Pendant lamps over the table.
  for (const fx of [-0.3, 0.02, 0.32]) out.push(pendant(d, mid + fx * Math.min(W, 1080) * 0.9, top, top + 34, c.primary));
  // The table: a wooden top on legs, set for a session.
  const ty = base - 70;
  out.push(`<rect x="${n(mid - Math.min(W * 0.46, 470))}" y="${n(ty)}" width="${n(Math.min(W * 0.92, 940))}" height="12" rx="3" fill="#C89B6D"/><rect x="${n(mid - Math.min(W * 0.46, 470))}" y="${n(ty + 12)}" width="${n(Math.min(W * 0.92, 940))}" height="8" fill="#A97C52"/>`);
  for (const lx of [mid - Math.min(W * 0.42, 430), mid + Math.min(W * 0.42, 430) - 12]) out.push(`<rect x="${n(lx)}" y="${n(ty + 20)}" width="12" height="${n(base - ty)}" fill="#8E6844"/>`);
  // The laptop: a glowing screen of plain shapes.
  const lx = mid - 40;
  out.push(`<path d="M${n(lx - 70)} ${n(ty)}H${n(lx + 70)}L${n(lx + 60)} ${n(ty - 8)}H${n(lx - 60)}Z" fill="#B8BEC6"/><rect x="${n(lx - 58)}" y="${n(ty - 96)}" width="116" height="88" rx="6" fill="#3B4250"/><rect x="${n(lx - 51)}" y="${n(ty - 89)}" width="102" height="74" rx="2" fill="#DDEBF7"/>`);
  out.push(`<rect x="${n(lx - 43)}" y="${n(ty - 81)}" width="44" height="10" rx="3" fill="${c.primary}"/><rect x="${n(lx - 43)}" y="${n(ty - 64)}" width="86" height="6" rx="3" fill="#A9BFD3"/><rect x="${n(lx - 43)}" y="${n(ty - 52)}" width="70" height="6" rx="3" fill="#A9BFD3"/><rect x="${n(lx + 10)}" y="${n(ty - 40)}" width="33" height="18" rx="3" fill="${c.secondary}"/>`);
  // Notebooks and pencils.
  const nx = mid + 120;
  out.push(`<path d="M${n(nx - 64)} ${n(ty)}L${n(nx - 56)} ${n(ty - 12)}H${n(nx + 56)}L${n(nx + 64)} ${n(ty)}Z" fill="#FFFFFF"/><path d="M${n(nx)} ${n(ty - 12)}V${n(ty)}" stroke="#D3D8DE" stroke-width="2"/>`);
  for (let k = 0; k < 3; k++) out.push(`<path d="M${n(nx - 50 + k * 2)} ${n(ty - 9 + k * 3)}H${n(nx - 8)}M${n(nx + 8)} ${n(ty - 9 + k * 3)}H${n(nx + 50 - k * 2)}" stroke="#C9D3DD" stroke-width="1"/>`);
  out.push(`<path d="M${n(nx + 20)} ${n(ty - 16)}L${n(nx + 72)} ${n(ty - 26)}" stroke="#E8B04A" stroke-width="5" stroke-linecap="round"/><path d="M${n(nx + 72)} ${n(ty - 26)}l8-1.6" stroke="#3A3A3A" stroke-width="3" stroke-linecap="round"/>`);
  // Mugs with steam.
  for (const [mx, col] of [
    [mid - 190, c.primary],
    [mid + 250, c.secondary],
  ] as const) {
    out.push(`<path d="M${n(mx - 16)} ${n(ty - 40)}H${n(mx + 16)}V${n(ty - 4)}Q${n(mx + 16)} ${n(ty)} ${n(mx + 12)} ${n(ty)}H${n(mx - 12)}Q${n(mx - 16)} ${n(ty)} ${n(mx - 16)} ${n(ty - 4)}Z" fill="${col}"/><path d="M${n(mx + 16)} ${n(ty - 32)}q14 0 14 12t-14 12" stroke="${col}" stroke-width="5" fill="none"/>`);
    out.push(`<path d="M${n(mx - 6)} ${n(ty - 48)}q-6-10 0-18t0-18M${n(mx + 6)} ${n(ty - 50)}q-6-10 0-18" stroke="#B9C2CC" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  }
  out.push(`<rect x="0" y="${n(base)}" width="${n(W)}" height="${n(h - base)}" fill="${mix(c.primary, "#30353D", 0.55)}"/>`);
  const wall = mix(c.paper, "#DCE4EA", 0.6);
  const sky = sceneSky(c, h, BUSY, TINT, [
    [0.32, wall, 1],
    [0.84, mix(wall, "#C9D3DC", 0.4), 1],
  ]);
  return svgDoc(W, h, `<rect width="${n(W)}" height="${n(h)}" fill="url(#sky)"/><rect x="0" y="${n(base - 6)}" width="${n(W)}" height="${n(h)}" fill="#B9C4CD"/>${out.join("")}`, sky + d.svg());
}

export const workshopPack: DrawnPack = {
  occasion: "workshop",
  blurb: "A bright workroom: sticky notes, books, laptop and lamps; idea corners",
  frame,
  scene,
  sceneHeight: 470,
  busy: BUSY,
  fade: { from: 0.14, to: 0.4 },
  scrim: 0.84,
  topInset: 54,
};
