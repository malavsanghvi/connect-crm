import { inflateSync } from "node:zlib";

// Shared by the flyer tests that look at a rendered picture's pixels (copied from events-flyer-render.test.ts).
/** RGBA pixels of an 8-bit, non-interlaced RGB or RGBA PNG (what next/og writes). */
export function decodePng(png: Uint8Array): { w: number; h: number; px: Uint8Array } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (at + 8 <= png.length) {
    const len = dv.getUint32(at);
    const kind = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (kind === "IHDR") {
      w = dv.getUint32(at + 8);
      h = dv.getUint32(at + 12);
      depth = png[at + 16];
      type = png[at + 17];
      interlace = png[at + 20];
    } else if (kind === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
    else if (kind === "IEND") break;
    at += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) throw new Error(`unexpected PNG format (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      px.set([cur[x * bpp], cur[x * bpp + 1], cur[x * bpp + 2], bpp === 4 ? cur[x * bpp + 3] : 255], (y * w + x) * 4);
    }
    prev = cur;
  }
  return { w, h, px };
}
