// Reading an image's bytes (pure: no server imports). Satori (next/og) draws
// PNG, JPEG, GIF and SVG only, so the flyer maker looks at the first bytes of
// every file before it uses it — never at a file name or a Content-Type header.

export type ImageKind = "image/jpeg" | "image/png" | "image/gif" | "image/svg+xml" | "image/webp" | "image/heic" | "image/avif";

/** What the bytes are, from their first bytes (never from a file name or a Content-Type header). */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (/^avi[fs]$/.test(brand)) return "image/avif";
    if (/^(?:hei[cxsm]|hev[cx]|mif1|msf1)$/.test(brand)) return "image/heic";
  }
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^\uFEFF/, "").trimStart();
  if (/^(?:<\?xml|<!--|<!doctype svg|<svg)/i.test(head) && /<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

/** The natural size of a PNG, JPEG, GIF or SVG (used to keep a logo's shape); a sensible guess when unreadable. */
export function imageSize(b: Uint8Array, kind: ImageKind): { w: number; h: number } {
  const be16 = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  if (kind === "image/png" && b.length >= 24) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (kind === "image/gif" && b.length >= 10) return { w: (b[6] ?? 0) | ((b[7] ?? 0) << 8), h: (b[8] ?? 0) | ((b[9] ?? 0) << 8) };
  if (kind === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1] ?? 0;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: be16(i + 7), h: be16(i + 5) };
      i += 2 + be16(i + 2);
    }
  }
  if (kind === "image/svg+xml") {
    const text = new TextDecoder().decode(b.subarray(0, 4096));
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    if (vb) return { w: Number(vb[1]) || 300, h: Number(vb[2]) || 100 };
    const w = /\swidth\s*=\s*["']([\d.]+)/i.exec(text);
    const h = /\sheight\s*=\s*["']([\d.]+)/i.exec(text);
    if (w && h) return { w: Number(w[1]) || 300, h: Number(h[1]) || 100 };
  }
  return { w: 300, h: 100 };
}

/**
 * The most a picture drawn on a flyer may measure. A small file can declare enormous dimensions (a few dozen KB of PNG can
 * claim 8,000 × 8,000 pixels), and the renderer decodes at the declared size, in the portal's own process: an 8,000-pixel
 * square made one preview take eight seconds and 220 MB. Logos and AI art are never anywhere near this big.
 */
export const MAX_PICTURE_SIDE = 4096;
export const MAX_PICTURE_PIXELS = 12_000_000;

/** The picture's size when a PNG or JPEG is bigger than the flyer maker will draw, else null (read from the header only: nothing is decoded). */
export function oversizePicture(b: Uint8Array, kind: ImageKind): { w: number; h: number } | null {
  const { w, h } = imageSize(b, kind);
  return w > MAX_PICTURE_SIDE || h > MAX_PICTURE_SIDE || w * h > MAX_PICTURE_PIXELS ? { w, h } : null;
}
