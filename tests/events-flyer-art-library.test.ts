import { describe, expect, it } from "vitest";

import { FLYER_LAYER_GUARDRAIL, findBlockedArtTerm } from "@/lib/events/flyer";
import { NO_GEMINI_KEY, flyerArtPath } from "@/lib/events/flyer-art";
import { PARTNER_LOGO_MAX_BYTES, collectFlyerArt, discardFlyerArt, flyerArtReadiness, listFlyerArt, requestFlyerArt, storePartnerLogo } from "@/lib/events/flyer-art-library";
import { sniffImage } from "@/lib/events/flyer-image";
import { DbFailure, FormError } from "@/lib/events/forms";
import type { AppSupabase } from "@/lib/supabase/server";

const C = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const E = "22222222-2222-4222-8222-222222222222";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

type Answer = { data?: unknown; error?: { message: string; code?: string; statusCode?: string } | null };

/** A hand-rolled stand-in for the organizer's Supabase client: records every call, answers what the test scripts. */
function fake(
  o: {
    rpc?: Record<string, Answer | ((args: Record<string, unknown>) => Answer)>;
    list?: Answer;
    signed?: (paths: string[]) => { path: string; signedUrl: string | null; error: string | null }[] | { error: { message: string } };
    upload?: Answer;
    remove?: Answer;
  } = {},
) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const db = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ fn: `rpc:${name}`, args: [args] });
      const a = o.rpc?.[name];
      const r = typeof a === "function" ? a(args) : a;
      return { data: r?.data ?? null, error: r?.error ?? null };
    },
    storage: {
      from(bucket: string) {
        return {
          async list(folder: string, opts: unknown) {
            calls.push({ fn: `list:${bucket}`, args: [folder, opts] });
            return { data: (o.list?.data ?? []) as { name: string }[], error: o.list?.error ?? null };
          },
          async createSignedUrls(paths: string[], seconds: number) {
            calls.push({ fn: "createSignedUrls", args: [paths, seconds] });
            const r = o.signed ? o.signed(paths) : paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?t=1`, error: null }));
            return Array.isArray(r) ? { data: r, error: null } : { data: null, error: r.error };
          },
          async createSignedUrl(path: string, seconds: number) {
            calls.push({ fn: "createSignedUrl", args: [path, seconds] });
            return { data: { signedUrl: `https://signed.example/${path}?t=1` }, error: null };
          },
          async upload(path: string, bytes: Uint8Array, opts: unknown) {
            calls.push({ fn: `upload:${bucket}`, args: [path, bytes.length, opts] });
            return { data: o.upload?.error ? null : { path }, error: o.upload?.error ?? null };
          },
          async remove(paths: string[]) {
            calls.push({ fn: `remove:${bucket}`, args: [paths] });
            return { data: (o.remove?.data ?? paths.map((name) => ({ name }))) as { name: string }[], error: o.remove?.error ?? null };
          },
        };
      },
    },
  };
  return { db: db as unknown as AppSupabase, calls };
}
const called = <T extends { fn: string }>(calls: T[], fn: string): T[] => calls.filter((c) => c.fn === fn);

/** What app.events_flyer_result answers for a finished layer job. */
const done = (over: Record<string, unknown> = {}) => ({
  data: { status: "done", result: { image_b64: b64(PNG), content_type: "image/png", prompt: "p", layer: "frame", occasion: "garba", seed: 777, ...over } },
});

describe("sniffImage", () => {
  it("tells PNG and JPEG by their first bytes, and nothing else by guesswork", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(WEBP)).toBe("image/webp");
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("flyerArtReadiness (is AI art available?)", () => {
  it("is ready with the model's price", async () => {
    const { db, calls } = fake({ rpc: { flyer_art_status: { data: { state: "ready", model: "gemini-3.1-flash-lite-image" } } } });
    expect(await flyerArtReadiness(db, C)).toEqual({ state: "ready", model: "gemini-3.1-flash-lite-image", cents: 4 });
    expect(calls[0]).toEqual({ fn: "rpc:flyer_art_status", args: [{ p_center: C }] });
  });

  it("says there is no key, in the words the brief asks for", async () => {
    const { db } = fake({ rpc: { flyer_art_status: { data: { state: "no_key" } } } });
    expect(await flyerArtReadiness(db, C)).toEqual({ state: "no_key", message: "AI art needs a Gemini key — ask your Community Connect admin (Platform › Setup)." });
  });

  it("never throws: a status that cannot be read says so and the drawn art still works", async () => {
    const { db } = fake({ rpc: { flyer_art_status: { error: { message: "function app.flyer_art_status does not exist", code: "PGRST202" } } } });
    const r = await flyerArtReadiness(db, C);
    expect(r.state).toBe("unknown");
    expect(r.state === "unknown" ? r.message : "").toMatch(/Could not check whether AI art is available — the database function is not available.*\. The drawn art always works\.$/);
  });
});

describe("listFlyerArt (the pictures kept for an occasion)", () => {
  it("lists frames and scenes with signed URLs, newest first, and skips everything else", async () => {
    const { db, calls } = fake({
      list: { data: [{ name: "frame-900.jpg" }, { name: "scene-20.png" }, { name: ".emptyFolderPlaceholder" }, { name: "frame-abc.png" }, { name: "background-4.jpg" }, { name: "frame-5.webp" }, { name: "frame-3.png" }] },
    });
    const r = await listFlyerArt(db, C, "garba");
    expect(r.problem).toBeNull();
    expect(r.entries.map((e) => [e.layer, e.seed, e.path])).toEqual([
      ["frame", 900, `${C}/flyer-art/garba/frame-900.jpg`],
      ["scene", 20, `${C}/flyer-art/garba/scene-20.png`],
      ["frame", 3, `${C}/flyer-art/garba/frame-3.png`],
    ]);
    expect(r.entries.every((e) => e.occasion === "garba" && e.url?.startsWith("https://signed.example/"))).toBe(true);
    expect(called(calls, "list:content")[0]!.args).toEqual([`${C}/flyer-art/garba`, { limit: 100, sortBy: { column: "created_at", order: "desc" } }]);
  });

  it("lists a picture whose URL could not be made, without one (the panel says so)", async () => {
    const { db } = fake({ list: { data: [{ name: "frame-1.jpg" }, { name: "frame-2.jpg" }] }, signed: (paths) => paths.map((p) => ({ path: p, signedUrl: p.endsWith("frame-2.jpg") ? null : "https://s/x", error: p.endsWith("frame-2.jpg") ? "nope" : null })) });
    const r = await listFlyerArt(db, C, "diwali");
    expect(r.entries.map((e) => e.url)).toEqual(["https://s/x", null]);
  });

  it("says why when the library cannot be listed (never an empty list that looks like none)", async () => {
    const { db } = fake({ list: { error: { message: "fetch failed" } } });
    const r = await listFlyerArt(db, C, "garba");
    expect(r.entries).toEqual([]);
    expect(r.problem).toMatch(/^The AI pictures kept for this occasion could not be listed — the database could not be reached/);
  });

  it("is empty, with no signing, when nothing has been made yet", async () => {
    const { db, calls } = fake({ list: { data: [] } });
    expect(await listFlyerArt(db, C, "bhakti")).toEqual({ entries: [], problem: null });
    expect(called(calls, "createSignedUrls")).toHaveLength(0);
  });
});

describe("collectFlyerArt (the worker's picture, kept once, at its cache key)", () => {
  const args = { eventId: E, centerId: C };

  it("keeps a finished frame at content/<center>/flyer-art/<occasion>/<layer>-<seed>.<ext>, then has the job drop the bytes", async () => {
    const { db, calls } = fake({ rpc: { events_flyer_result: done() } });
    const r = await collectFlyerArt(db, args);
    const path = `${C}/flyer-art/garba/frame-777.png`;
    expect(r).toEqual({ status: "ready", entry: { path, layer: "frame", occasion: "garba", seed: 777, url: `https://signed.example/${path}?t=1` } });
    expect(called(calls, "upload:content")[0]!.args).toEqual([path, PNG.length, { contentType: "image/png", upsert: false }]);
    expect(called(calls, "rpc:events_flyer_art_taken")[0]!.args).toEqual([{ p_event: E, p_path: path }]);
    // upload first, then the job is told: a failed upload never loses the bytes.
    expect(calls.findIndex((c) => c.fn === "upload:content")).toBeLessThan(calls.findIndex((c) => c.fn === "rpc:events_flyer_art_taken"));
  });

  it("names a JPEG .jpg and a scene scene-", async () => {
    const { db, calls } = fake({ rpc: { events_flyer_result: done({ image_b64: b64(JPEG), content_type: "image/jpeg", layer: "scene", occasion: "convention", seed: 4 }) } });
    const r = await collectFlyerArt(db, args);
    expect(r.status === "ready" ? r.entry.path : "").toBe(`${C}/flyer-art/convention/scene-4.jpg`);
    expect(called(calls, "upload:content")[0]!.args[2]).toEqual({ contentType: "image/jpeg", upsert: false });
  });

  it("goes by what the bytes are, not by what the service says they are", async () => {
    const { db } = fake({ rpc: { events_flyer_result: done({ image_b64: b64(JPEG), content_type: "image/png" }) } });
    const r = await collectFlyerArt(db, args);
    expect(r.status === "ready" ? r.entry.path : "").toBe(`${C}/flyer-art/garba/frame-777.jpg`);
  });

  it("refuses bytes that are not a PNG or JPEG, and keeps nothing", async () => {
    for (const bytes of [WEBP, new Uint8Array([1, 2, 3, 4])]) {
      const { db, calls } = fake({ rpc: { events_flyer_result: done({ image_b64: b64(bytes) }) } });
      const r = await collectFlyerArt(db, args);
      expect(r).toEqual({ status: "failed", reason: "The AI service sent back a picture the flyer maker can't use. Ask for it again." });
      expect(called(calls, "upload:content")).toHaveLength(0);
    }
  });

  it("treats a picture already kept at that key as kept (nothing is lost, nothing is paid twice)", async () => {
    const { db, calls } = fake({ rpc: { events_flyer_result: done() }, upload: { error: { message: "The resource already exists", statusCode: "409" } } });
    const r = await collectFlyerArt(db, args);
    expect(r.status).toBe("ready");
    expect(called(calls, "rpc:events_flyer_art_taken")).toHaveLength(1);
  });

  it("says so when the picture cannot be kept, and does not tell the job it was", async () => {
    const { db, calls } = fake({ rpc: { events_flyer_result: done() }, upload: { error: { message: "new row violates row-level security policy" } } });
    await expect(collectFlyerArt(db, args)).rejects.toBeInstanceOf(DbFailure);
    expect(called(calls, "rpc:events_flyer_art_taken")).toHaveLength(0);
  });

  it("says so when the storage area does not exist", async () => {
    const { db } = fake({ rpc: { events_flyer_result: done() }, upload: { error: { message: "Bucket not found" } } });
    await expect(collectFlyerArt(db, args)).rejects.toThrow(/content storage area is not set up/);
  });

  it("says so when the picture was kept but the job could not be updated", async () => {
    const { db } = fake({ rpc: { events_flyer_result: done(), events_flyer_art_taken: { error: { message: "that file is not the art this request made." } } } });
    const err = await collectFlyerArt(db, args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbFailure);
    expect((err as DbFailure).doing).toBe("the picture was kept, but the background job could not be updated");
  });

  it("finds a picture the job already handed over (a reload), without keeping it twice", async () => {
    const path = `${C}/flyer-art/garba/frame-777.jpg`;
    const { db, calls } = fake({ rpc: { events_flyer_result: { data: { status: "done", result: { stored_path: path, prompt: "p", layer: "frame", occasion: "garba", seed: 777 } } } } });
    const r = await collectFlyerArt(db, args);
    expect(r.status === "ready" ? r.entry.path : "").toBe(path);
    expect(called(calls, "upload:content")).toHaveLength(0);
    expect(called(calls, "rpc:events_flyer_art_taken")).toHaveLength(0);
  });

  it("will not take another community's stored picture", async () => {
    const path = `${OTHER}/flyer-art/garba/frame-777.jpg`;
    const { db } = fake({ rpc: { events_flyer_result: { data: { status: "done", result: { stored_path: path, layer: "frame", occasion: "garba", seed: 777 } } } } });
    const r = await collectFlyerArt(db, args);
    expect(r).toEqual({ status: "failed", reason: "The stored picture belongs to another community. Ask for it again." });
  });

  it("answers waiting, failing and nothing as they are", async () => {
    expect(await collectFlyerArt(fake({ rpc: { events_flyer_result: { data: { status: "queued" } } } }).db, args)).toEqual({ status: "queued" });
    expect(await collectFlyerArt(fake({ rpc: { events_flyer_result: { data: { status: "running" } } } }).db, args)).toEqual({ status: "running" });
    expect(await collectFlyerArt(fake({ rpc: { events_flyer_result: { data: { status: "failed", error: "Gemini refused the key (HTTP 403)." } } } }).db, args)).toEqual({
      status: "failed",
      reason: "Gemini refused the key (HTTP 403).",
    });
    expect(await collectFlyerArt(fake({ rpc: { events_flyer_result: { data: { status: "none" } } } }).db, args)).toEqual({ status: "none" });
  });

  it("leaves a background request (no layer) to the background picker", async () => {
    const { db, calls } = fake({ rpc: { events_flyer_result: { data: { status: "done", result: { image_b64: b64(PNG), content_type: "image/png", prompt: "p" } } } } });
    expect(await collectFlyerArt(db, args)).toEqual({ status: "none" });
    expect(called(calls, "upload:content")).toHaveLength(0);
  });

  it("says why when the job cannot be read", async () => {
    const { db } = fake({ rpc: { events_flyer_result: { error: { message: "only event managers and this event's lead can see this event's flyer generation." } } } });
    await expect(collectFlyerArt(db, args)).rejects.toBeInstanceOf(DbFailure);
  });
});

describe("requestFlyerArt (asking Gemini for a frame or a scene)", () => {
  const ready = { data: { state: "ready", model: "gemini-3.1-flash-lite-image" } };
  const ask = { eventId: E, centerId: C, occasion: "garba" as const, layer: "frame" as const };

  it("asks only when AI art is ready: without a key it says so and calls nothing", async () => {
    const { db, calls } = fake({ rpc: { flyer_art_status: { data: { state: "no_key" } } } });
    expect(await requestFlyerArt(db, ask)).toEqual({ status: "unavailable", reason: NO_GEMINI_KEY });
    expect(called(calls, "rpc:events_request_flyer_art")).toHaveLength(0);
    expect(called(calls, "rpc:events_flyer_result")).toHaveLength(0);
  });

  it("asks with the occasion, layer, a fresh seed and a code-set prompt that ends with the guard", async () => {
    const { db, calls } = fake({ rpc: { flyer_art_status: ready, events_flyer_result: { data: { status: "none" } }, events_request_flyer_art: { data: { status: "queued", job_id: "9" } } } });
    expect(await requestFlyerArt(db, { ...ask, seed: 4242 })).toEqual({ status: "queued" });
    const sent = called(calls, "rpc:events_request_flyer_art")[0]!.args[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ p_event: E, p_occasion: "garba", p_layer: "frame", p_seed: 4242 });
    expect(String(sent.p_prompt).endsWith(FLYER_LAYER_GUARDRAIL)).toBe(true);
    expect(findBlockedArtTerm(String(sent.p_prompt))).toBeNull();
    expect(String(sent.p_prompt)).toMatch(/border frame/);
  });

  it("picks the seed itself when none is given (the picture's name in the library)", async () => {
    const { db, calls } = fake({ rpc: { flyer_art_status: ready, events_flyer_result: { data: { status: "none" } }, events_request_flyer_art: { data: { status: "queued" } } } });
    await requestFlyerArt(db, ask);
    await requestFlyerArt(db, ask);
    const seeds = called(calls, "rpc:events_request_flyer_art").map((c) => (c.args[0] as { p_seed: number }).p_seed);
    expect(seeds).toHaveLength(2);
    expect(seeds.every((s) => Number.isInteger(s) && s >= 1 && s <= 2147483647)).toBe(true);
  });

  it("asks a scene for the scene's own description", async () => {
    const { db, calls } = fake({ rpc: { flyer_art_status: ready, events_flyer_result: { data: { status: "none" } }, events_request_flyer_art: { data: { status: "queued" } } } });
    await requestFlyerArt(db, { ...ask, layer: "scene", occasion: "paryushan" });
    expect(String((called(calls, "rpc:events_request_flyer_art")[0]!.args[0] as { p_prompt: string }).p_prompt)).toMatch(/lotus pond/);
  });

  it("makes one picture at a time: a picture still being made is waited for, not asked for again", async () => {
    const { db, calls } = fake({ rpc: { flyer_art_status: ready, events_flyer_result: { data: { status: "running" } } } });
    expect(await requestFlyerArt(db, ask)).toEqual({ status: "running" });
    expect(called(calls, "rpc:events_request_flyer_art")).toHaveLength(0);
  });

  it("keeps an earlier finished picture first, so a paid picture is never lost, then asks", async () => {
    const { db, calls } = fake({ rpc: { flyer_art_status: ready, events_flyer_result: done({ seed: 31 }), events_request_flyer_art: { data: { status: "queued" } } } });
    expect(await requestFlyerArt(db, ask)).toEqual({ status: "queued" });
    expect(called(calls, "upload:content")[0]!.args[0]).toBe(`${C}/flyer-art/garba/frame-31.png`);
    expect(calls.findIndex((c) => c.fn === "upload:content")).toBeLessThan(calls.findIndex((c) => c.fn === "rpc:events_request_flyer_art"));
  });

  it("passes on why not when the service refuses (the day's limit, the service is not set up)", async () => {
    const reason = "This community has asked for 30 AI pictures in the last 24 hours, the most allowed in a day. Reuse one already made, use the drawn art, or try again tomorrow.";
    const { db } = fake({ rpc: { flyer_art_status: ready, events_flyer_result: { data: { status: "none" } }, events_request_flyer_art: { data: { status: "unavailable", reason } } } });
    expect(await requestFlyerArt(db, ask)).toEqual({ status: "unavailable", reason });
  });

  it("says so when the database refuses the request", async () => {
    const { db } = fake({ rpc: { flyer_art_status: ready, events_flyer_result: { data: { status: "none" } }, events_request_flyer_art: { error: { message: "only event managers and this event's lead can ask for AI art for it." } } } });
    await expect(requestFlyerArt(db, ask)).rejects.toBeInstanceOf(DbFailure);
  });
});

describe("discardFlyerArt", () => {
  const path = flyerArtPath(C, "garba", "frame", 5, "jpg");

  it("removes the picture from the community's library", async () => {
    const { db, calls } = fake();
    await discardFlyerArt(db, C, path);
    expect(called(calls, "remove:content")[0]!.args).toEqual([[path]]);
  });

  it("refuses a path that is not in this community's library", async () => {
    const { db, calls } = fake();
    for (const bad of [flyerArtPath(OTHER, "garba", "frame", 5, "jpg"), `${C}/events/${E}/flyer-1.png`, `${C}/flyer-art/garba/../../x.png`, ""]) {
      await expect(discardFlyerArt(db, C, bad), bad).rejects.toBeInstanceOf(FormError);
    }
    expect(called(calls, "remove:content")).toHaveLength(0);
  });

  it("says so when nothing was removed (storage refused, or it was already gone)", async () => {
    const { db } = fake({ remove: { data: [] } });
    await expect(discardFlyerArt(db, C, path)).rejects.toThrow(/was not discarded/);
  });

  it("says so when storage fails", async () => {
    const { db } = fake({ remove: { error: { message: "boom" } } });
    await expect(discardFlyerArt(db, C, path)).rejects.toBeInstanceOf(DbFailure);
  });
});

describe("storePartnerLogo", () => {
  it("keeps a PNG or JPEG in the event's own folder as partner-<ms>.<ext> and answers a preview URL", async () => {
    const { db, calls } = fake();
    const png = await storePartnerLogo(db, { centerId: C, eventId: E, bytes: PNG, now: 1759300000000 });
    expect(png.path).toBe(`${C}/events/${E}/partner-1759300000000.png`);
    expect(png.url).toBe(`https://signed.example/${png.path}?t=1`);
    const jpg = await storePartnerLogo(db, { centerId: C, eventId: E, bytes: JPEG, now: 5 });
    expect(jpg.path).toBe(`${C}/events/${E}/partner-5.jpg`);
    expect(called(calls, "upload:content")[0]!.args[2]).toEqual({ contentType: "image/png", upsert: false });
  });

  it("refuses WebP and other files (the renderer cannot draw them), empty files and big files, in plain English", async () => {
    const { db, calls } = fake();
    await expect(storePartnerLogo(db, { centerId: C, eventId: E, bytes: WEBP })).rejects.toThrow(/must be a PNG or JPEG/);
    await expect(storePartnerLogo(db, { centerId: C, eventId: E, bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(/must be a PNG or JPEG/);
    await expect(storePartnerLogo(db, { centerId: C, eventId: E, bytes: new Uint8Array() })).rejects.toThrow(/empty/);
    const big = new Uint8Array(PARTNER_LOGO_MAX_BYTES + 1);
    big.set(PNG);
    await expect(storePartnerLogo(db, { centerId: C, eventId: E, bytes: big })).rejects.toThrow(/larger than 3 MB/);
    expect(called(calls, "upload:content")).toHaveLength(0);
  });

  it("says so when storage refuses the file", async () => {
    const { db } = fake({ upload: { error: { message: "new row violates row-level security policy" } } });
    await expect(storePartnerLogo(db, { centerId: C, eventId: E, bytes: PNG })).rejects.toBeInstanceOf(DbFailure);
  });
});
