import { describe, expect, it, vi } from "vitest";

import type { PosterContent } from "@/lib/events/flyer";
import { flyerArtPath } from "@/lib/events/flyer-art";
import type { AppSupabase } from "@/lib/supabase/server";

// flyer-assets is a server-only module (it reads the organizer's storage); the marker package throws outside the server build.
vi.mock("server-only", () => ({}));
const { loadPosterAssets } = await import("@/lib/events/flyer-assets");

const C = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";

/** A PNG that is only a header claiming this size. */
const pngOf = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
};
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4]);

/** The organizer's storage: the files it holds, by key. */
function storage(files: Record<string, Uint8Array>) {
  const downloads: string[] = [];
  const db = {
    storage: {
      from: () => ({
        async download(path: string) {
          downloads.push(path);
          const bytes = files[path];
          if (!bytes) return { data: null, error: { message: "Object not found" } };
          return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
        },
      }),
    },
  } as unknown as AppSupabase;
  return { db, downloads };
}

const frame = flyerArtPath(C, "garba", "frame", 11, "png");
const scene = flyerArtPath(C, "garba", "scene", 12, "png");
const partner = `${C}/events/${E}/partner-5.png`;

const poster = (over: Partial<PosterContent> = {}): PosterContent => ({
  occasion: "garba",
  frame: { source: "ai", path: frame },
  scene: { source: "ai", path: scene },
  logo: true,
  partner: { on: true, label: "", sub: "", logo_path: partner },
  subhead: "",
  slogan: "",
  stat: { on: false, icon: "people", label: "", value: "", caption: "" },
  ribbon: { on: false, date: "", time: "" },
  agenda: [],
  paragraph: "",
  footer: "",
  ...over,
});

describe("loadPosterAssets: the pictures a poster draws that are not drawn in code", () => {
  it("loads an AI frame and scene and the partner's logo, each with its own size", async () => {
    const { db } = storage({ [frame]: pngOf(1024, 1536), [scene]: pngOf(1536, 658), [partner]: pngOf(600, 200) });
    const r = await loadPosterAssets(db, C, E, poster());
    expect(r.notes).toEqual([]);
    expect(r.assets.frame).toMatchObject({ w: 1024, h: 1536 });
    expect(r.assets.scene).toMatchObject({ w: 1536, h: 658 });
    expect(r.assets.partnerLogo).toMatchObject({ w: 600, h: 200 });
    expect(r.assets.frame?.dataUri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("falls back to the drawn art, with a note, for a picture that claims to be bigger than the renderer should decode", async () => {
    // A file in the art library can be written by any event lead (0585 A3), and a small file can claim 8,000 × 8,000 pixels.
    const { db } = storage({ [frame]: pngOf(8000, 8000), [scene]: pngOf(1536, 658), [partner]: pngOf(5000, 100) });
    const r = await loadPosterAssets(db, C, E, poster());
    expect(r.assets.frame).toBeNull();
    expect(r.assets.partnerLogo).toBeNull();
    expect(r.assets.scene).not.toBeNull();
    expect(r.notes).toEqual([
      "The AI frame couldn't be used — it measures 8000 × 8000 pixels, more than the flyer maker draws (up to 4096 on a side and 12 megapixels) — so the drawn frame was used. Choose another, or generate a new one.",
      "The partner logo couldn't be used — it measures 5000 × 100 pixels, more than the flyer maker draws (up to 4096 on a side and 12 megapixels) — so the partner badge was drawn instead. Upload it again.",
    ]);
  });

  it("falls back, with a note, for a picture that is gone or is not a PNG or JPEG", async () => {
    const { db } = storage({ [scene]: WEBP });
    const r = await loadPosterAssets(db, C, E, poster({ partner: { on: false, label: "", sub: "", logo_path: null } }));
    expect(r.assets).toEqual({ frame: null, scene: null, partnerLogo: null });
    expect(r.notes).toHaveLength(2);
    expect(r.notes[0]).toMatch(/AI frame couldn't be used — it could not be loaded \(it may have been discarded\)/);
    expect(r.notes[1]).toMatch(/AI bottom scene couldn't be used — it is not a PNG or JPEG picture/);
  });

  it("never reads a picture from another community, another occasion or another event", async () => {
    const other = flyerArtPath("99999999-9999-4999-8999-999999999999", "garba", "frame", 11, "png");
    const wrongOccasion = flyerArtPath(C, "diwali", "scene", 12, "png");
    const wrongEvent = `${C}/events/${C}/partner-5.png`;
    const { db, downloads } = storage({ [other]: pngOf(10, 10), [wrongOccasion]: pngOf(10, 10), [wrongEvent]: pngOf(10, 10) });
    const r = await loadPosterAssets(
      db,
      C,
      E,
      poster({ frame: { source: "ai", path: other }, scene: { source: "ai", path: wrongOccasion }, partner: { on: true, label: "", sub: "", logo_path: wrongEvent } }),
    );
    expect(downloads).toEqual([]);
    expect(r.assets).toEqual({ frame: null, scene: null, partnerLogo: null });
    expect(r.notes).toHaveLength(3);
  });
});
