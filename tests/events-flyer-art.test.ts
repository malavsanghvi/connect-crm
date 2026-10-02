import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FLYER_LAYER_GUARDRAIL, findBlockedArtTerm, withLayerGuardrail } from "@/lib/events/flyer";
import {
  ART_SERVICE_DOWN,
  ART_SERVICE_OLD,
  DEFAULT_FLYER_ART_MODEL,
  FLYER_ART_DAILY_LIMIT,
  FLYER_ART_MODELS,
  FLYER_ART_MODEL_IDS,
  FLYER_ART_SEED_MAX,
  FLYER_LAYER_ASPECT,
  FLYER_LAYER_KINDS,
  FLYER_LAYER_PROMPTS,
  FLYER_OCCASIONS,
  NO_GEMINI_KEY,
  artCostSentence,
  artPriceSentence,
  englishOnlyNote,
  firstNonEnglishLetter,
  flyerArtFolder,
  flyerArtModel,
  flyerArtPath,
  formatArtCost,
  isCenterArtPath,
  isFlyerArtModel,
  isFlyerOccasion,
  isNewPicture,
  newArtSeed,
  occasionFor,
  parseFlyerArtPath,
  readFlyerArtStatus,
  type FlyerArtEntry,
} from "@/lib/events/flyer-art";

const C = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";

describe("occasions", () => {
  it("are the eight packs of the brief", () => {
    expect([...FLYER_OCCASIONS]).toEqual(["garba", "paryushan", "diwali", "mahavir", "convention", "pathshala", "bhakti", "general"]);
    expect(isFlyerOccasion("garba")).toBe(true);
    expect(isFlyerOccasion("birthday")).toBe(false);
    expect(isFlyerOccasion(null)).toBe(false);
  });

  it("are suggested from the event's name (the organizer can always choose another)", () => {
    expect(occasionFor("Navratri Garba Night")).toBe("garba");
    expect(occasionFor("Dandiya Raas 2026")).toBe("garba");
    expect(occasionFor("Paryushan Mahaparva")).toBe("paryushan");
    expect(occasionFor("Samvatsari Pratikraman")).toBe("paryushan");
    expect(occasionFor("Diwali Mela & Annakut")).toBe("diwali");
    expect(occasionFor("Mahavir Janma Kalyanak")).toBe("mahavir");
    expect(occasionFor("JAINA 2027 Houston Host City Kick-Off")).toBe("convention");
    expect(occasionFor("Youth Convention")).toBe("convention");
    expect(occasionFor("Sunday Pathshala term starts")).toBe("pathshala");
    expect(occasionFor("Bhakti Sandhya")).toBe("bhakti");
    expect(occasionFor("Annual picnic")).toBe("general");
    expect(occasionFor("")).toBe("general");
  });

  it("also read the description, so 'Evening of fun' with a garba description is a garba", () => {
    expect(occasionFor("Evening of fun", "Bring your dandiya sticks for garba under the lights.")).toBe("garba");
    expect(occasionFor("Evening of fun", null)).toBe("general");
  });
});

describe("the art cache key: center + occasion + layer + seed, so a picture is made once and reused", () => {
  it("is content/<center>/flyer-art/<occasion>/<layer>-<seed>.<ext>", () => {
    expect(flyerArtPath(C, "garba", "frame", 12345, "jpg")).toBe(`${C}/flyer-art/garba/frame-12345.jpg`);
    expect(flyerArtPath(C.toUpperCase(), "diwali", "scene", 7, "png")).toBe(`${C}/flyer-art/diwali/scene-7.png`);
    expect(flyerArtFolder(C, "bhakti")).toBe(`${C}/flyer-art/bhakti`);
  });

  it("is the same for the same ask, and different for another seed, layer, occasion or community", () => {
    const key = flyerArtPath(C, "garba", "frame", 5, "jpg");
    expect(flyerArtPath(C, "garba", "frame", 5, "jpg")).toBe(key);
    expect(flyerArtPath(C, "garba", "frame", 6, "jpg")).not.toBe(key);
    expect(flyerArtPath(C, "garba", "scene", 5, "jpg")).not.toBe(key);
    expect(flyerArtPath(C, "diwali", "frame", 5, "jpg")).not.toBe(key);
    expect(flyerArtPath(OTHER, "garba", "frame", 5, "jpg")).not.toBe(key);
  });

  it("refuses what is not a community id or a seed", () => {
    expect(() => flyerArtPath("not-a-uuid", "garba", "frame", 1, "jpg")).toThrow(/community id/);
    expect(() => flyerArtPath(C, "garba", "frame", 0, "jpg")).toThrow(/seed/);
    expect(() => flyerArtPath(C, "garba", "frame", FLYER_ART_SEED_MAX + 1, "jpg")).toThrow(/seed/);
    expect(() => flyerArtPath(C, "garba", "frame", 1.5, "jpg")).toThrow(/seed/);
  });

  it("reads its own parts back", () => {
    expect(parseFlyerArtPath(`${C}/flyer-art/mahavir/scene-2147483647.png`)).toEqual({ centerId: C, occasion: "mahavir", layer: "scene", seed: 2147483647, ext: "png" });
    expect(parseFlyerArtPath(`  ${C.toUpperCase()}/flyer-art/garba/frame-9.JPG `)).toMatchObject({ centerId: C, occasion: "garba", layer: "frame", seed: 9, ext: "jpg" });
  });

  it("refuses every path that is not a layer's key", () => {
    for (const bad of [
      `${C}/flyer-art/garba/frame-0.jpg`,
      `${C}/flyer-art/garba/frame-01.jpg`,
      `${C}/flyer-art/garba/frame-2147483648.jpg`,
      `${C}/flyer-art/garba/frame-1.webp`,
      `${C}/flyer-art/birthday/frame-1.jpg`,
      `${C}/flyer-art/garba/background-1.jpg`,
      `${C}/flyer-art/garba/frame-1.jpg/../../x`,
      `${C}/events/${C}/art-1.jpg`,
      `${C}/flyer-art/garba/sub/frame-1.jpg`,
      `flyer-art/garba/frame-1.jpg`,
      "https://evil.example/frame-1.jpg",
      "",
    ]) {
      expect(parseFlyerArtPath(bad), bad).toBeNull();
    }
  });

  it("belongs to one community, and (when asked) to one occasion and layer", () => {
    const path = flyerArtPath(C, "garba", "frame", 5, "jpg");
    expect(isCenterArtPath(path, C)).toBe(true);
    expect(isCenterArtPath(path, C, "garba", "frame")).toBe(true);
    expect(isCenterArtPath(path, OTHER)).toBe(false);
    expect(isCenterArtPath(path, C, "diwali")).toBe(false);
    expect(isCenterArtPath(path, C, "garba", "scene")).toBe(false);
  });

  it("a new seed is a whole number from 1 to 2^31 - 1", () => {
    expect(newArtSeed(() => 0)).toBe(1);
    expect(newArtSeed(() => 0.9999999999)).toBeLessThanOrEqual(FLYER_ART_SEED_MAX);
    for (let i = 0; i < 200; i++) {
      const n = newArtSeed();
      expect(Number.isInteger(n) && n >= 1 && n <= FLYER_ART_SEED_MAX).toBe(true);
    }
  });
});

describe("what a picture costs, shown before anything is asked", () => {
  // Google's prices for one 1K image (ai.google.dev/gemini-api/docs/pricing, read 2026-10-02), in dollars.
  const PRICE_USD = { "gemini-3.1-flash-lite-image": 0.0336, "gemini-3.1-flash-image": 0.067, "gemini-3-pro-image": 0.134 } as const;

  it("rounds each model's price UP to whole cents (money is integer cents)", () => {
    expect([...FLYER_ART_MODEL_IDS].sort()).toEqual(Object.keys(PRICE_USD).sort());
    for (const id of FLYER_ART_MODEL_IDS) {
      expect(Number.isInteger(FLYER_ART_MODELS[id].cents)).toBe(true);
      expect(FLYER_ART_MODELS[id].cents, id).toBe(Math.ceil(PRICE_USD[id as keyof typeof PRICE_USD] * 100));
    }
  });

  it("the default model costs about the owner's four cents", () => {
    expect(DEFAULT_FLYER_ART_MODEL).toBe("gemini-3.1-flash-lite-image");
    expect(FLYER_ART_MODELS[DEFAULT_FLYER_ART_MODEL].cents).toBe(4);
  });

  it("never offers a model Google shuts down today", () => {
    expect(isFlyerArtModel("gemini-2.5-flash-image")).toBe(false);
    expect(flyerArtModel("gemini-2.5-flash-image")).toBe(DEFAULT_FLYER_ART_MODEL);
  });

  it("uses the platform's model when it is one we know the price of, else the default", () => {
    expect(flyerArtModel("gemini-3-pro-image")).toBe("gemini-3-pro-image");
    expect(flyerArtModel("  gemini-3.1-flash-image ")).toBe("gemini-3.1-flash-image");
    expect(flyerArtModel("")).toBe(DEFAULT_FLYER_ART_MODEL);
    expect(flyerArtModel(null)).toBe(DEFAULT_FLYER_ART_MODEL);
    expect(flyerArtModel("imagen-4.0-generate")).toBe(DEFAULT_FLYER_ART_MODEL);
  });

  it("says it in words", () => {
    expect(formatArtCost(4)).toBe("about 4¢");
    expect(formatArtCost(3.2)).toBe("about 4¢");
    expect(formatArtCost(99)).toBe("about 99¢");
    expect(formatArtCost(100)).toBe("about $1.00");
    expect(formatArtCost(140)).toBe("about $1.40");
    expect(formatArtCost(-5)).toBe("about 0¢");
    expect(artCostSentence("gemini-3.1-flash-lite-image")).toBe(
      "Each new picture costs about 4¢ (Gemini 3.1 Flash Lite Image). Community Connect pays for it; nothing is charged to your community. A community can make 30 pictures a day. Pictures already made for this occasion are free to reuse.",
    );
    expect(artCostSentence("gemini-3-pro-image")).toMatch(/about 14¢ \(Gemini 3 Pro Image\)/);
  });

  it("says who pays: Community Connect does, never the community (the owner's Google account is billed)", () => {
    for (const model of FLYER_ART_MODEL_IDS) {
      const s = artPriceSentence(model);
      expect(s).toMatch(/Community Connect pays for it; nothing is charged to your community\./);
      expect(s).not.toMatch(/paid by your community/i);
      // The price sentence alone is for a picture that is not reused (a background); the layer sentence adds the reuse.
      expect(s).not.toMatch(/free to reuse/);
      expect(artCostSentence(model)).toMatch(/free to reuse/);
    }
  });

  it("keeps the daily limit it tells people about equal to the database's (app.flyer_art_daily_limit, 0585)", () => {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "0585_flyers_v2.sql"), "utf8");
    const limit = /flyer_art_daily_limit\(\)[^;]*select\s+(\d+)/i.exec(sql);
    expect(limit, "0585 defines app.flyer_art_daily_limit()").not.toBeNull();
    expect(FLYER_ART_DAILY_LIMIT).toBe(Number(limit![1]));
  });
});

describe("isNewPicture: what is worth announcing when the flyer panel opens", () => {
  const entry = (over: Partial<FlyerArtEntry> = {}): FlyerArtEntry => ({ path: flyerArtPath(C, "garba", "frame", 7, "jpg"), layer: "frame", occasion: "garba", seed: 7, url: "https://x/y", ...over });
  const drawn = { frame: { source: "code" }, scene: { source: "code" } } as const;

  it("is news when it is for the occasion on screen and neither listed nor on the poster", () => {
    expect(isNewPicture(entry(), { occasion: "garba", listed: [], poster: drawn })).toBe(true);
  });

  it("is not news when it is already among the pictures listed (the panel finds the last picture asked for on every visit)", () => {
    expect(isNewPicture(entry(), { occasion: "garba", listed: [entry()], poster: drawn })).toBe(false);
  });

  it("is not news when it is already on the poster, as the frame or as the scene it was made for", () => {
    const frame = entry();
    expect(isNewPicture(frame, { occasion: "garba", listed: [], poster: { ...drawn, frame: { source: "ai", path: frame.path } } })).toBe(false);
    const scene = entry({ layer: "scene", path: flyerArtPath(C, "garba", "scene", 8, "png") });
    expect(isNewPicture(scene, { occasion: "garba", listed: [], poster: { ...drawn, scene: { source: "ai", path: scene.path } } })).toBe(false);
    // Another picture on the layer does not hide it.
    expect(isNewPicture(frame, { occasion: "garba", listed: [], poster: { ...drawn, frame: { source: "ai", path: flyerArtPath(C, "garba", "frame", 9, "jpg") } } })).toBe(true);
  });

  it("is not news for another occasion (it is kept there; the person is told when they ask, not on every visit)", () => {
    expect(isNewPicture(entry({ occasion: "diwali" }), { occasion: "garba", listed: [], poster: drawn })).toBe(false);
  });
});

describe("the safety check for a free-text description reads English only", () => {
  it("finds a letter that is not Latin, in any script the check cannot read", () => {
    expect(firstNonEnglishLetter("Warm saffron and navy mandala rings")).toBeNull();
    expect(firstNonEnglishLetter("Café lights, naïve ornaments — 100% “festive” ★ 2026 …")).toBeNull();
    expect(firstNonEnglishLetter("")).toBeNull();
    expect(firstNonEnglishLetter("સુંદર ફૂલોની ડિઝાઇન")).toBe("સ");
    expect(firstNonEnglishLetter("diya लैंप light")).toBe("ल");
    expect(firstNonEnglishLetter("лотос")).toBe("л");
    expect(firstNonEnglishLetter("gold 金色 rings")).toBe("金");
  });

  it("tells the organizer which letter and what to do, in plain English", () => {
    const note = englishOnlyNote("સ");
    expect(note).toMatch(/^Please describe the background art in English/);
    expect(note).toContain('"સ"');
    expect(note).toMatch(/flyer's own words can be in any language/);
  });
});

describe("is AI art available? (the answer of app.flyer_art_status)", () => {
  it("ready: the model and its price", () => {
    expect(readFlyerArtStatus({ state: "ready", model: "gemini-3.1-flash-image" })).toEqual({ state: "ready", model: "gemini-3.1-flash-image", cents: 7 });
    expect(readFlyerArtStatus({ state: "ready", model: "something-unknown" })).toEqual({ state: "ready", model: DEFAULT_FLYER_ART_MODEL, cents: 4 });
    expect(readFlyerArtStatus({ state: "ready" })).toMatchObject({ state: "ready", cents: 4 });
  });

  it("without a key, says so plainly and names who to ask (the drawn art stays)", () => {
    const r = readFlyerArtStatus({ state: "no_key" });
    expect(r).toEqual({ state: "no_key", message: "AI art needs a Gemini key — ask your Community Connect admin (Platform › Setup)." });
    expect(NO_GEMINI_KEY).toBe(r.state === "no_key" ? r.message : "");
  });

  it("says when the background service is down or needs updating", () => {
    expect(readFlyerArtStatus({ state: "no_service" })).toEqual({ state: "no_service", message: ART_SERVICE_DOWN });
    expect(readFlyerArtStatus({ state: "update_needed" })).toEqual({ state: "update_needed", message: ART_SERVICE_OLD });
    expect(ART_SERVICE_DOWN).toMatch(/drawn art always works/);
    expect(ART_SERVICE_OLD).toMatch(/drawn art always works/);
  });

  it("treats anything it cannot read as the service being down, never as ready", () => {
    for (const raw of [null, undefined, [], "ready", 7, {}, { state: "READY" }, { state: "maybe" }]) {
      expect(readFlyerArtStatus(raw).state, JSON.stringify(raw)).toBe("no_service");
    }
  });
});

describe("the prompts (code-set; the organizer never types them)", () => {
  it("has a frame and a scene for every occasion", () => {
    for (const o of FLYER_OCCASIONS) for (const k of FLYER_LAYER_KINDS) expect(FLYER_LAYER_PROMPTS[o][k].length, `${o} ${k}`).toBeGreaterThan(120);
  });

  it("never names a blocked word (people, deities, lettering), so the guard never refuses our own prompts", () => {
    for (const o of FLYER_OCCASIONS) for (const k of FLYER_LAYER_KINDS) expect(findBlockedArtTerm(FLYER_LAYER_PROMPTS[o][k]), `${o} ${k}`).toBeNull();
  });

  it("each ends with the no-text / no-deities / no-close-up-faces guard, exactly once, within the job's 2,000 characters", () => {
    for (const o of FLYER_OCCASIONS) {
      for (const k of FLYER_LAYER_KINDS) {
        const sent = withLayerGuardrail(FLYER_LAYER_PROMPTS[o][k]);
        expect(sent.endsWith(FLYER_LAYER_GUARDRAIL), `${o} ${k}`).toBe(true);
        expect(sent.split(FLYER_LAYER_GUARDRAIL).length - 1).toBe(1);
        expect(sent.length).toBeLessThanOrEqual(2000);
      }
    }
    expect(FLYER_LAYER_GUARDRAIL).toMatch(/No text of any kind/);
    expect(FLYER_LAYER_GUARDRAIL).toMatch(/No deities/);
    expect(FLYER_LAYER_GUARDRAIL).toMatch(/No close-up faces/);
  });

  it("describe ornament, colour and light only: no event names, no figures", () => {
    const all = FLYER_OCCASIONS.flatMap((o) => FLYER_LAYER_KINDS.map((k) => FLYER_LAYER_PROMPTS[o][k])).join(" ").toLowerCase();
    for (const word of ["mahavir", "jayanti", "bhagwan", "murti", "portrait", "tirthankar", "dancer"]) expect(all, word).not.toContain(word);
  });

  it("are all different", () => {
    const all = FLYER_OCCASIONS.flatMap((o) => FLYER_LAYER_KINDS.map((k) => FLYER_LAYER_PROMPTS[o][k]));
    expect(new Set(all).size).toBe(all.length);
  });

  it("ask a frame for a tall picture and a scene for a wide strip", () => {
    expect(FLYER_LAYER_ASPECT.frame).toBe("2:3");
    expect(FLYER_LAYER_ASPECT.scene).toBe("21:9");
  });
});
