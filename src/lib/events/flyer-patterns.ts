// Flyer background patterns, drawn in code (pure; no server imports, so the
// flyer panel can show the same thumbnails the renderer uses).
//
// Lotus, rangoli, diya and mandala: decorative ornament only, in the brand's
// colours at low opacity so the flyer's words stay readable. Paths, circles
// and rotate transforms — never a <text> element, never a figure.

import type { FlyerPattern } from "./flyer";

export type PatternColors = { w: number; h: number; primary: string; accent: string; background: string; transparent?: boolean };

const HEX = /^#[0-9a-f]{6}$/i;
const color = (v: string, fallback: string) => (HEX.test(v) ? v : fallback);
const f = (n: number) => String(Math.round(n * 10) / 10);

/** A petal with its base at (0,0), pointing up (towards −y). */
function petal(len: number, wid: number): string {
  return `M0,0 C${f(wid)},${f(-len * 0.32)} ${f(wid * 0.62)},${f(-len * 0.86)} 0,${f(-len)} C${f(-wid * 0.62)},${f(-len * 0.86)} ${f(-wid)},${f(-len * 0.32)} 0,0 Z`;
}

/** `count` petals around (0,0), their bases `r0` from the centre. */
function ring(count: number, r0: number, len: number, wid: number, fill: string, opacity: number, offsetDeg = 0): string {
  const d = petal(len, wid);
  let out = `<g fill="${fill}" fill-opacity="${opacity}">`;
  for (let i = 0; i < count; i++) {
    out += `<path transform="rotate(${f(offsetDeg + (360 / count) * i)}) translate(0 ${f(-r0)})" d="${d}"/>`;
  }
  return `${out}</g>`;
}

function dots(count: number, r: number, dotR: number, fill: string, opacity: number, offsetDeg = 0): string {
  let out = `<g fill="${fill}" fill-opacity="${opacity}">`;
  for (let i = 0; i < count; i++) {
    const a = ((offsetDeg + (360 / count) * i) * Math.PI) / 180;
    out += `<circle cx="${f(Math.sin(a) * r)}" cy="${f(-Math.cos(a) * r)}" r="${f(dotR)}"/>`;
  }
  return `${out}</g>`;
}

function circleStroke(r: number, stroke: string, opacity: number, width: number): string {
  return `<circle r="${f(r)}" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${f(width)}"/>`;
}

function lotus(w: number, h: number, p: string, a: string, glow: boolean): string {
  const s = Math.min(w, h) * 0.42;
  const cx = w / 2;
  const cy = h * 0.8;
  let out = !glow ? "" : `<defs><radialGradient id="glow" cx="50%" cy="80%" r="55%"><stop offset="0" stop-color="${a}" stop-opacity="0.22"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient></defs>`;
  if (glow) out += `<rect width="${f(w)}" height="${f(h)}" fill="url(#glow)"/>`;
  // Small lotus marks across the upper part, like a block print.
  const step = w / 6;
  const mark = `${ring(3, 0, step * 0.32, step * 0.1, p, 0.07, -40)}${ring(2, 0, step * 0.24, step * 0.09, a, 0.08, -70)}`;
  for (let row = 0; row * step * 0.9 < h * 0.55; row++) {
    for (let col = 0; col <= 6; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0);
      const y = step * 0.6 + row * step * 0.9;
      out += `<g transform="translate(${f(x)} ${f(y)})">${mark}</g>`;
    }
  }
  // Water ripples under the flower.
  out += `<g fill="none" stroke="${p}" stroke-opacity="0.12" stroke-width="${f(s * 0.012)}">`;
  for (const k of [0.95, 1.3, 1.7]) out += `<ellipse cx="${f(cx)}" cy="${f(cy + s * 0.08)}" rx="${f(s * k)}" ry="${f(s * k * 0.13)}"/>`;
  out += "</g>";
  // The lotus: back petals, front petals, the centre petal.
  out += `<g transform="translate(${f(cx)} ${f(cy)})">`;
  out += `<g fill="${p}" fill-opacity="0.11">`;
  for (const deg of [-68, -34, 0, 34, 68]) out += `<path transform="rotate(${deg})" d="${petal(s, s * 0.3)}"/>`;
  out += `</g><g fill="${a}" fill-opacity="0.17">`;
  for (const deg of [-50, -17, 17, 50]) out += `<path transform="rotate(${deg})" d="${petal(s * 0.8, s * 0.26)}"/>`;
  out += `</g><path fill="${a}" fill-opacity="0.24" d="${petal(s * 0.62, s * 0.2)}"/>`;
  out += "</g>";
  return out;
}

function rosette(r: number, p: string, a: string): string {
  return (
    ring(16, 0, r, r * 0.22, p, 0.12) +
    ring(16, 0, r * 0.72, r * 0.18, a, 0.16, 11.25) +
    dots(32, r * 1.08, r * 0.02, a, 0.28) +
    circleStroke(r * 0.3, p, 0.2, r * 0.012) +
    ring(8, r * 0.04, r * 0.24, r * 0.09, a, 0.24, 22.5) +
    `<circle r="${f(r * 0.05)}" fill="${p}" fill-opacity="0.3"/>`
  );
}

function rangoli(w: number, h: number, p: string, a: string): string {
  const r = Math.min(w, h) * 0.36;
  let out = `<g transform="translate(${f(w / 2)} ${f(h / 2)})">${rosette(r, p, a)}</g>`;
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    out += `<g transform="translate(${f(x)} ${f(y)})">${rosette(r * 0.55, p, a)}</g>`;
  }
  return out;
}

function diya(w: number, h: number, p: string, a: string): string {
  const s = w / 16;
  let out = `<g fill="${p}" fill-opacity="0.14">`;
  for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s) out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s * 0.06)}"/>`;
  out += "</g>";
  const bowlW = s * 0.9;
  const flame = s * 0.75;
  const lamp =
    `<circle cy="${f(-flame * 0.55)}" r="${f(flame * 0.9)}" fill="${a}" fill-opacity="0.08"/>` +
    `<path d="M${f(-bowlW)},0 Q0,${f(bowlW * 1.05)} ${f(bowlW)},0 Z" fill="${p}" fill-opacity="0.18"/>` +
    `<ellipse rx="${f(bowlW)}" ry="${f(bowlW * 0.16)}" fill="${p}" fill-opacity="0.22"/>` +
    `<path d="M0,${f(-flame * 1.2)} C${f(flame * 0.42)},${f(-flame * 0.6)} ${f(flame * 0.36)},${f(-flame * 0.08)} 0,${f(-flame * 0.08)} C${f(-flame * 0.36)},${f(-flame * 0.08)} ${f(-flame * 0.42)},${f(-flame * 0.6)} 0,${f(-flame * 1.2)} Z" fill="${a}" fill-opacity="0.34"/>`;
  const stepX = s * 3.2;
  const stepY = s * 3.4;
  for (let row = 0, y = stepY * 0.75; y < h + stepY / 2; row++, y += stepY) {
    for (let x = row % 2 ? stepX : stepX / 2; x < w + stepX / 2; x += stepX) {
      out += `<g transform="translate(${f(x)} ${f(y)})">${lamp}</g>`;
    }
  }
  return out;
}

function mandalaRings(r: number, p: string, a: string): string {
  return (
    ring(8, 0, r * 0.18, r * 0.07, a, 0.24) +
    circleStroke(r * 0.16, p, 0.18, r * 0.006) +
    ring(12, r * 0.16, r * 0.34, r * 0.1, p, 0.12) +
    circleStroke(r * 0.5, p, 0.16, r * 0.006) +
    ring(16, r * 0.5, r * 0.32, r * 0.08, a, 0.14, 11.25) +
    circleStroke(r * 0.84, p, 0.16, r * 0.006) +
    ring(24, r * 0.84, r * 0.2, r * 0.05, p, 0.1) +
    circleStroke(r * 1.08, p, 0.14, r * 0.006) +
    dots(48, r * 1.16, r * 0.012, a, 0.22)
  );
}

function mandala(w: number, h: number, p: string, a: string): string {
  const r = Math.min(w, h) * 0.4;
  return (
    `<g transform="translate(${f(w / 2)} ${f(h / 2)})">${mandalaRings(r, p, a)}</g>` +
    `<g transform="translate(0 0)" opacity="0.6">${mandalaRings(r * 0.45, p, a)}</g>` +
    `<g transform="translate(${f(w)} ${f(h)})" opacity="0.6">${mandalaRings(r * 0.45, p, a)}</g>`
  );
}

/** A decorative SVG (a complete document with a viewBox) for the flyer background or a thumbnail. Never contains text. */
export function patternSvg(kind: FlyerPattern, o: PatternColors): string {
  const w = Math.max(1, Math.round(o.w));
  const h = Math.max(1, Math.round(o.h));
  const p = color(o.primary, "#1B2C5C");
  const a = color(o.accent, "#C9731C");
  const bg = color(o.background, "#FBF7F0");
  const body = kind === "lotus" ? lotus(w, h, p, a, !o.transparent) : kind === "rangoli" ? rangoli(w, h, p, a) : kind === "diya" ? diya(w, h, p, a) : mandala(w, h, p, a);
  const fill = o.transparent ? "" : `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${fill}${body}</svg>`;
}

/** The same SVG as a data URI, for an <img src>. */
export function patternDataUri(kind: FlyerPattern, o: PatternColors): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(patternSvg(kind, o))}`;
}
