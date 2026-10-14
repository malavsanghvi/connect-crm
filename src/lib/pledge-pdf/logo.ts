// The community's logo for the pledge PDF. PDF can embed a PNG or a JPEG; an SVG or WebP logo is skipped (the next file of the brand
// kit is tried, and the community's name is drawn when none can be used). The bytes are read from the public branding files by
// whoever renders: the portal (fetch) or the background service (its HTTP client). A logo that is missing, too large or not a
// picture never stops the PDF.
//
// Pure (no "@/" imports, no I/O of its own): the background service imports it too.

export type PdfLogo = { bytes: Uint8Array; kind: "png" | "jpg" };
export type FetchBytes = (url: string) => Promise<Uint8Array | null>;

/** The largest logo file embedded: a bigger one makes an email attachment heavy for no gain on a small header. */
export const MAX_LOGO_BYTES = 600_000;

/** PNG or JPEG, read from the file's own first bytes (never from its name or the server's say-so). */
export function sniffLogo(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/** The first of these files that loads and is a PNG or JPEG of a sensible size, or null. */
export async function firstDrawableLogo(urls: readonly string[], fetchBytes: FetchBytes): Promise<PdfLogo | null> {
  for (const url of urls) {
    try {
      const bytes = await fetchBytes(url);
      if (!bytes || bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) continue;
      const kind = sniffLogo(bytes);
      if (kind) return { bytes, kind };
    } catch {
      // A logo that cannot be loaded leaves the community's name in its place.
    }
  }
  return null;
}
