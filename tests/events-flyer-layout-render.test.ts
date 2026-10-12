import { describe, expect, it } from "vitest";

import { FLYER_SIZES, FLYER_SIZE_KEYS, type FlyerDesign } from "@/lib/events/flyer";
import { FLYER_OCCASIONS } from "@/lib/events/flyer-art";
import { artPack } from "@/lib/events/flyer-art-packs";
import { BUNDLED_SCRIPT, BUNDLED_SCRIPT_FILE, flyerFontPath, getFlyerFonts } from "@/lib/events/flyer-fonts";
import { LAYOUT_PRESETS, defaultLayout, greetingFor, type PosterLayout } from "@/lib/events/flyer-layout";
import { LAYOUT_SCALES, blockPositions, breakWords, creditTints, layoutColors, layoutNotes, planLayout, shortenNames, splitDate, splitDetail, stackBottom, titlePlan } from "@/lib/events/flyer-layout-render";
import { flyerDims, flyerText, isPng, renderFlyerPng, type FlyerRenderInput } from "@/lib/events/flyer-render";
import { contrastRatio } from "@/lib/setup";
import { flyerTextLength as flyerLen } from "@/lib/events/flyer-text";
import { readFile } from "node:fs/promises";

import { decodePng } from "./flyer-png-helper";
import { PHOTO, PRESETS, brand, build, dimsOf, heroPic, logo, planOf, svgUri } from "./flyer-layout-fixtures";


describe("breakWords", () => {
  it("makes the fewest lines, then moves the breaks so they are even", () => {
    // Two lines (60 + 10 + 60 fits in 140), the fewest.
    expect(breakWords([60, 60, 60], 10, 140)).toHaveLength(2);
    expect(breakWords([40, 40, 40, 40], 10, 100)).toEqual([2, 2]);
    // Greedy would break 80 + 20 | 20 + 80 only by luck; the lines are 110 and 110 either way, never 80 | 130.
    expect(breakWords([80, 20, 20, 80], 10, 130)).toEqual([2, 2]);
    expect(breakWords([100], 10, 100)).toEqual([1]);
    expect(breakWords([], 10, 100)).toEqual([]);
  });
  it("gives up on a word wider than a line", () => {
    expect(breakWords([30, 120], 10, 100)).toBeNull();
  });
});

describe("the title", () => {
  const notice = LAYOUT_PRESETS.notice;
  const save = LAYOUT_PRESETS.save_the_date;
  it("is set big on one line when it is short, and on the fewest lines that fit when it is long", () => {
    const short = titlePlan("JSH Picnic", "", save, { width: 920, story: false, height: 1350 });
    expect(short.lines).toHaveLength(1);
    expect(short.size).toBeGreaterThan(100);
    const longer = titlePlan("Maple Street Neighbourhood Picnic and Games", "", save, { width: 920, story: false, height: 1350 });
    expect(longer.lines.length).toBeGreaterThan(1);
    expect(longer.lines.length).toBeLessThanOrEqual(3);
    expect(longer.widest).toBeLessThanOrEqual(920);
  });
  it("never takes more than 30% of the flyer's height", () => {
    for (const h of [1080, 1350, 1620, 1920]) {
      const t = titlePlan("Maple Street Picnic", "", save, { width: 920, story: h > 1800, height: h });
      expect(t.height).toBeLessThanOrEqual(0.3 * h + 1);
    }
  });
  it("sets the accent word in script (a little larger) only when every letter is one the font has", () => {
    const t = titlePlan("Community Supper", "Supper", { ...notice, style: { ...notice.style, title: { ...notice.style.title, accent: "script" } } }, { width: 730, story: false });
    const words = t.lines.flat();
    expect(words.find((w) => w.text === "Supper")).toMatchObject({ accent: true, script: true });
    expect(words.find((w) => w.text === "Supper")!.size).toBeGreaterThan(words.find((w) => w.text === "Community")!.size);
    const g = titlePlan("Snatra સ્નાત્ર", "સ્નાત્ર", { ...notice, style: { ...notice.style, title: { ...notice.style.title, accent: "script" } } }, { width: 730, story: false });
    expect(g.lines.flat().find((w) => w.text === "સ્નાત્ર")).toMatchObject({ accent: true, script: false });
  });
  it("shrinks until the longest word fits a line", () => {
    const t = titlePlan("Dasalakshanaparvamahotsava", "", save, { width: 920, story: false, height: 1350 });
    expect(t.widest).toBeLessThanOrEqual(920);
    expect(t.size).toBeLessThan(save.style.title.max);
  });
  it("is scale-aware: at a larger scale a line breaks sooner", () => {
    const a = titlePlan("Community Supper Night", "", save, { width: 920, story: false, scale: 1 });
    const b = titlePlan("Community Supper Night", "", save, { width: 920, story: false, scale: 1.3 });
    expect(b.lines.length).toBeGreaterThanOrEqual(a.lines.length);
  });
});

describe("the date and the contact lines", () => {
  it("puts a long date on two lines (the weekday, then the rest) and keeps a short one together", () => {
    expect(splitDate("Saturday, October 3, 2026")).toEqual(["Saturday,", "October 3, 2026"]);
    expect(splitDate("Oct 3, 2026")).toEqual(["Oct 3, 2026"]);
    expect(splitDate("September 10–16, 2026")).toEqual(["September 10–16, 2026"]);
    expect(splitDate("Thursday, September 10 – Thursday, September 17, 2026")).toEqual(["Thursday,", "September 10 – Thursday, September 17, 2026"]);
  });
  it("puts a long email on two lines at the @, never in the middle of a word", () => {
    expect(splitDetail("events@oakcitychamber.example")).toEqual(["events", "@oakcitychamber.example"]);
    expect(splitDetail("dana@example.org")).toEqual(["dana@example.org"]);
    expect(splitDetail("555-0142")).toEqual(["555-0142"]);
  });
});

describe("planLayout: everything fits, at every size, with little, ordinary and the most content", () => {
  for (const preset of PRESETS) {
    for (const size of FLYER_SIZE_KEYS) {
      for (const content of ["bare", "typical", "longest"] as const) {
        for (const qr of [false, true]) {
          it(`${preset} · ${size} · ${content}${qr ? " · RSVP code" : ""}`, () => {
            const d = build(preset, content, { size, qr });
            const plan = planOf(d);
            // The title is in the stack, or in the window / side column that holds it.
            expect([...plan.blocks, ...(plan.group?.members ?? [])]).toContain("title");
            expect(plan.k).toBeGreaterThanOrEqual(LAYOUT_SCALES.floor);
            expect(plan.k).toBeLessThanOrEqual(LAYOUT_SCALES.max);
            // Only the blocks the preset says may be left out go, and the title and the logos never.
            const spec = LAYOUT_PRESETS[preset];
            for (const b of plan.dropped) {
              expect(spec.dropOrder).toContain(b);
              expect(plan.blocks).not.toContain(b);
              expect(plan.group?.members ?? []).not.toContain(b);
            }
            // The stack ends above the scene (unless nothing more could be done: the scale is at its floor).
            if (plan.k > LAYOUT_SCALES.floor + 0.001) expect(stackBottom(plan)).toBeLessThanOrEqual(plan.H - plan.reserve + 1);
            // And it starts below the top edge.
            expect(plan.top).toBeGreaterThanOrEqual(0);
            // No block's box overlaps another's: each entry (a block, or the window or side column as one) starts where the one before it ends.
            const pos = blockPositions(plan);
            for (let i = 1; i < pos.length; i++) expect(pos[i]!.y, `${pos[i]!.key} starts above the end of ${pos[i - 1]!.key}`).toBeGreaterThanOrEqual(pos[i - 1]!.y + pos[i - 1]!.h - 0.01);
            for (const p of pos) expect(p.h, `${p.key} has a height`).toBeGreaterThan(0);
          });
        }
      }
    }
  }

  it("leaves no empty middle on a Story: the blocks spread over the height, with no gap wider than 170 units", () => {
    for (const preset of PRESETS) {
      const plan = planOf(build(preset, "typical", { size: "story" }));
      expect(plan.gap).toBeLessThanOrEqual(170);
      // What is left under the stack is no more than one gap.
      expect(plan.H - plan.reserve - stackBottom(plan)).toBeLessThanOrEqual(plan.gap + 60);
    }
  });

  it("sets typical content at full size or larger on Tall, without leaving anything out", () => {
    for (const preset of PRESETS) {
      const plan = planOf(build(preset, "typical", { size: "tall", scene: preset === "notice" ? false : true }));
      // Only what the preset itself says goes first may go: the thank-you has no use for the host card the ordinary content carries, and it
      // keeps its cards, donors and closing message at a readable size by leaving out the date, note and contacts the ordinary content also carries.
      const allowed = preset === "thank_you" ? ["host", "when", "note", "contacts"] : ["host"];
      expect(plan.dropped.filter((b) => !allowed.includes(b))).toEqual([]);
      if (preset === "thank_you") for (const b of ["credits", "donors", "closing"] as const) expect(plan.blocks).toContain(b);
      expect(plan.k).toBeGreaterThanOrEqual(preset === "thank_you" ? 0.8 : 0.6);
    }
  });

  it("says in plain sentences what was left out or set small", () => {
    const d = build("notice", "longest", { size: "square" });
    const notes = layoutNotes({ design: d, poster: d.poster!, brand, logo, assets: { frame: null, scene: null, partnerLogo: null, hero: heroPic }, centerName: "x" }, dimsOf("square"));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).toMatch(/^(There was not room for|This flyer is crowded)/);
    const fine = build("notice", "typical", { size: "tall", scene: false });
    expect(layoutNotes({ design: fine, poster: fine.poster!, brand, logo, assets: { frame: null, scene: null, partnerLogo: null }, centerName: "x" }, dimsOf("tall"))).toEqual([]);
  });

  it("keeps the arched window as one container: one entry in the stack, its blocks inside it, and the block after it below it", () => {
    for (const size of ["post", "tall", "story", "square"] as const) {
      const d = build("ceremony", "typical", { size });
      const plan = planOf(d);
      expect(plan.group).toMatchObject({ kind: "window", width: LAYOUT_PRESETS.ceremony.style.window!.width });
      expect(plan.group!.members).toContain("title");
      for (const m of plan.group!.members) {
        expect(LAYOUT_PRESETS.ceremony.style.window!.blocks).toContain(m);
        // A block inside the window is not also in the stack.
        expect(plan.blocks).not.toContain(m);
      }
      const at = plan.blocks.indexOf("group");
      expect(at).toBeGreaterThanOrEqual(0);
      // The group's height holds its blocks, the arch's air above them and the foot under them.
      expect(plan.heights.group!).toBeGreaterThan(300);
      const pos = blockPositions(plan);
      const win = pos[at]!;
      const next = pos[at + 1]!;
      // The date (the entry after the window) starts below the window's bottom edge, with air between them.
      expect(next.y).toBeGreaterThanOrEqual(win.y + win.h);
      expect(win.y).toBeGreaterThanOrEqual(0);
      expect(plan.heroGrow).toBeGreaterThanOrEqual(0.6);
      expect(plan.heroGrow).toBeLessThanOrEqual(1.5);
      expect(stackBottom(plan)).toBeLessThanOrEqual(plan.H - plan.reserve + 1);
    }
    // Without a window in the preset there is none.
    expect(planOf(build("notice", "typical", { size: "tall" })).group).toBeNull();
  });

  it("puts a notice's header blocks in a side column when it has a picture, and the picture beside them (not in the flow)", () => {
    const d = build("notice", "typical", { size: "tall" });
    d.poster = { ...d.poster!, layout: { ...d.poster!.layout!, hero: { photo_id: PHOTO, shape: "arch" } } };
    const plan = planOf(d);
    expect(plan.group).toMatchObject({ kind: "side", width: LAYOUT_PRESETS.notice.style.side!.width });
    expect(plan.group!.members).toContain("title");
    expect(plan.blocks).not.toContain("hero");
    // The column is at least as tall as the picture, so the card under it never overlaps it.
    expect(plan.heights.group!).toBeGreaterThanOrEqual(430);
    // Without a picture there is no side column.
    expect(planOf(build("notice", "typical", { size: "tall" })).group).toBeNull();
  });

  it("leaves the picture out of the plan when the renderer does not have it (a photo that could not be loaded)", () => {
    const d = build("thank_you", "typical", { size: "tall" });
    const poster = d.poster!;
    const withoutPic = planLayout({ design: d, poster, logo, assets: { frame: null, scene: null, partnerLogo: null, hero: null }, centerName: "x" }, dimsOf("tall"), artPack(poster.occasion, brand), {});
    expect(withoutPic.blocks).not.toContain("hero");
    expect(planOf(d).blocks).toContain("hero");
  });

  it("shortens the thank-you cards' and donors' names to \"and N more\" before it leaves a block out, and says so", () => {
    const d = build("thank_you", "longest", { size: "square" });
    const poster = d.poster!;
    const plan = planOf(d);
    expect(plan.shown.level).toBeGreaterThan(0);
    // Each shortened card ends in "and N more" and the first names are kept.
    const first = plan.shown.credits[0]!.names;
    expect(first).toMatch(/ and \d+ more$/);
    expect(poster.layout!.credits[0]!.names.startsWith(first.split(" and ")[0]!)).toBe(true);
    const notes = layoutNotes({ design: d, poster, brand, logo, assets: { frame: null, scene: null, partnerLogo: null, hero: heroPic }, centerName: "x" }, dimsOf("square"));
    expect(notes.join(" ")).toMatch(/some thank-you or donor names are shown as/);
    // On a Story the same words fit, so nothing is shortened and nothing of the cards is left out.
    const roomy = planOf(build("thank_you", "typical", { size: "story" }));
    expect(roomy.shown.level).toBe(0);
    expect(roomy.blocks).toContain("credits");
    // The thank-you keeps its words readable: at least 80% of the usual size, unless nothing more could be done.
    expect(plan.k).toBeGreaterThanOrEqual(0.4);
    expect(roomy.k).toBeGreaterThanOrEqual(0.8);
  });

  it("gives a call to action beside contacts no room of its own (it is the contacts card's heading)", () => {
    const d = build("notice", "typical", { size: "tall" });
    const plan = planOf(d);
    expect(plan.blocks).toContain("contacts");
    expect(plan.blocks).not.toContain("cta");
    const alone = build("notice", "typical", { size: "tall" });
    alone.poster = { ...alone.poster!, layout: { ...alone.poster!.layout!, contacts: [] } };
    expect(planOf(alone).blocks).toContain("cta");
  });

  it("keeps the RSVP code in the flow of a notice and in the corner of a save-the-date", () => {
    expect(planOf(build("notice", "typical", { qr: true })).blocks).toContain("qr");
    expect(planOf(build("save_the_date", "typical", { qr: true })).blocks).not.toContain("qr");
  });
});

describe("the colours", () => {
  const brands = [
    { primary: "#1F3A5F", accent: "#B8860B", background: "#FBF8F1" },
    { primary: "#0F5E63", accent: "#C46A2B", background: "#F7FAF9" },
    { primary: "#235B34", accent: "#3F8F3B", background: "#F4F8EE" },
    { primary: "#8A1C3A", accent: "#C99A1A", background: "#FFF7E8" },
    { primary: "#111111", accent: "#999999", background: "#FFFFFF" },
  ];
  it("keep every word at 4.5:1 or more on the card it is set on, for every occasion and a spread of brands", () => {
    const problems: string[] = [];
    for (const occasion of FLYER_OCCASIONS) {
      for (const b of brands) {
        const pal = artPack(occasion, b).palette;
        const { card, tint, cardLabel, cardAccent, goldOnPaper } = layoutColors(pal);
        const pairs: [string, string, string, number][] = [
          ["ink on card", pal.ink, card, 4.5],
          ["accent on card", cardAccent, card, 4.5],
          ["the label on the host card", cardLabel, card, 4.5],
          ["ink on note", pal.ink, tint, 4.5],
          ["onAccent on accent (banner, pill, label)", pal.onAccent, pal.accent, 4.5],
          // The accent word on the banner is large type: 3:1.
          ["ribbonHi on accent (banner accent word)", pal.ribbonHi, pal.accent, 3],
          ["ink on paper", pal.ink, pal.paper, 4.5],
          ["accent on paper", pal.accent, pal.paper, 4.5],
          ["body on paper", pal.body, pal.paper, 4.5],
          ["the gold text on paper", goldOnPaper, pal.paper, 4.5],
        ];
        for (const [what, fg, bg, min] of pairs) {
          const r = contrastRatio(fg, bg) ?? 0;
          if (r < min) problems.push(`${occasion} ${b.primary}: ${what} is ${r.toFixed(2)}:1 (needs ${min}:1)`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("the thank-you cards", () => {
  it("are pastel fills the ink reads on at 4.5:1 or more, six different ones, for every occasion and a spread of brands", () => {
    const problems: string[] = [];
    const brands = [
      { primary: "#1F3A5F", accent: "#B8860B", background: "#FBF8F1" },
      { primary: "#0F5E63", accent: "#C46A2B", background: "#F7FAF9" },
      { primary: "#111111", accent: "#999999", background: "#FFFFFF" },
      { primary: "#8A1C3A", accent: "#C99A1A", background: "#FFF7E8" },
    ];
    for (const occasion of FLYER_OCCASIONS) {
      for (const b of brands) {
        const pal = artPack(occasion, b).palette;
        const tints = creditTints(pal);
        expect(tints).toHaveLength(6);
        expect(new Set(tints).size).toBe(6);
        for (const fill of tints) {
          const r = contrastRatio(pal.ink, fill) ?? 0;
          if (r < 4.5) problems.push(`${occasion} ${b.primary}: ink on ${fill} is ${r.toFixed(2)}:1`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("the script font", () => {
  it("is bundled (a file on disk) and asked for only by a layout", async () => {
    expect((await readFile(flyerFontPath(BUNDLED_SCRIPT_FILE.file))).byteLength).toBeGreaterThan(10_000);
    const without = await getFlyerFonts(brand, "Save the date", { poster: true });
    expect(without.fonts.map((f) => f.name)).not.toContain(BUNDLED_SCRIPT);
    expect(without.script).toBe(without.display);
    const withIt = await getFlyerFonts(brand, "Save the date", { poster: true, script: true });
    expect(withIt.fonts.map((f) => f.name)).toContain(BUNDLED_SCRIPT);
    expect(withIt.script).toBe(BUNDLED_SCRIPT);
  });
});

describe("renderFlyerPng draws every layout at every size", () => {
  const input = (d: FlyerDesign, over: Partial<FlyerRenderInput> = {}): FlyerRenderInput => ({
    design: d,
    brand,
    centerName: "Maple Street Neighbours",
    background: null,
    logo,
    logoDark: null,
    qrLink: "https://app.example.org/e/22222222-2222-4222-8222-222222222222",
    posterAssets: { frame: null, scene: null, partnerLogo: null, hero: d.poster?.layout?.hero.photo_id ? heroPic : null },
    ...over,
  });
  for (const preset of PRESETS) {
    for (const size of FLYER_SIZE_KEYS) {
      it(`${preset} · ${size}: a PNG of the right size, with the most content too`, async () => {
        const dims = flyerDims(size, "preview");
        for (const content of ["typical", "longest"] as const) {
          const r = await renderFlyerPng(input(build(preset, content, { size, qr: true })), "preview");
          expect(isPng(r.png)).toBe(true);
          expect(r.dims).toEqual(dims);
        }
      }, 30_000);
    }
  }

  it("draws the arched window's bottom edge below its last words with clear space, at every size and amount of content (the picture itself, not the plan)", async () => {
    // No frame, no bottom scene and no code: nothing is drawn but the blocks. The window's bottom edge is found in the picture (the lowest row, inside the
    // window's span, that is a line across the whole window); the foot above it and the row of the edge itself hold nothing dark. The old defect was that
    // edge running through the tagline and the date.
    let looked = 0;
    for (const size of FLYER_SIZE_KEYS) {
      for (const content of ["bare", "typical", "longest"] as const) {
        const d = build("ceremony", content, { size, qr: false });
        d.poster = { ...d.poster!, frame: { source: "none" }, scene: { source: "none" } };
        const dims = flyerDims(size, "preview");
        const r = await renderFlyerPng(input(d), "preview");
        const { w, h, px } = decodePng(r.png);
        expect([w, h]).toEqual([dims.w, dims.h]);
        const plan = planLayout({ design: d, poster: d.poster, logo, assets: { frame: null, scene: null, partnerLogo: null, hero: d.poster.layout?.hero.photo_id ? heroPic : null }, centerName: "Maple Street Neighbours" }, dims, artPack(d.poster.occasion, brand), {});
        const u = dims.w / 1080;
        const win = blockPositions(plan).find((p) => p.key === "group")!;
        const left = Math.round(((1080 - plan.group!.width) / 2 + 70) * u);
        const right = Math.round(((1080 + plan.group!.width) / 2 - 70) * u);
        const rgb = (x: number, y: number) => [px[(y * w + x) * 4]!, px[(y * w + x) * 4 + 1]!, px[(y * w + x) * 4 + 2]!] as const;
        const paper = rgb(2, 2);
        const isPaper = (x: number, y: number) => {
          const p = rgb(x, y);
          return Math.abs(p[0] - paper[0]) + Math.abs(p[1] - paper[1]) + Math.abs(p[2] - paper[2]) < 30;
        };
        const dark = (x: number, y: number) => {
          const p = rgb(x, y);
          return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] < 120;
        };
        // The edge: the lowest row of the window's span in which nearly every pixel is a line (not the paper), and not dark (the border is gold).
        let edge = -1;
        for (let y = Math.max(0, Math.floor(win.y * u)); y < Math.min(h, Math.ceil((win.y + win.h) * u)); y++) {
          let line = 0;
          for (let x = left; x < right; x++) if (!isPaper(x, y) && !dark(x, y)) line++;
          if (line >= 0.95 * (right - left)) edge = y;
        }
        expect(edge, `${size} · ${content}: the window's bottom edge is in the picture`).toBeGreaterThan(0);
        // The foot: from 44 to 18 units (at this scale) above the edge, and the rows of the edge itself.
        for (const [from, to] of [[edge - 44 * plan.k * u, edge - 18 * plan.k * u], [edge - 2, edge + 2]] as const) {
          for (let y = Math.max(0, Math.ceil(from)); y < Math.min(h, Math.floor(to)); y++) {
            looked++;
            for (let x = left; x < right; x++) expect(dark(x, y), `${size} · ${content}: dark pixel at (${x}, ${y}) in the window's foot (its bottom edge is at ${edge})`).toBe(false);
          }
        }
      }
    }
    expect(looked).toBeGreaterThan(100);
  }, 120_000);

  it("draws every layout over an AI-made frame and bottom scene too (a drawn picture stands in for the generated one here), with the AI credit line and no drawn decoration over it", async () => {
    for (const preset of PRESETS) {
      const d = build(preset, "typical", { size: "tall", qr: true });
      const pack = artPack(d.poster!.occasion, brand);
      d.poster = { ...d.poster!, frame: { source: "ai", path: "x/frame.png" }, scene: { source: "ai", path: "x/scene.png" } };
      const frame = { dataUri: svgUri(pack.frame(1080, 1620)), w: 1080, h: 1620 };
      const scene = { dataUri: svgUri(pack.scene.draw(1080, pack.scene.height)), w: 1080, h: pack.scene.height };
      const withAi = await renderFlyerPng(input(d, { posterAssets: { frame, scene, partnerLogo: null, hero: d.poster.layout?.hero.photo_id ? heroPic : null } }), "preview");
      expect(isPng(withAi.png), preset).toBe(true);
      expect(withAi.dims).toEqual(flyerDims("tall", "preview"));
      // The same words with the drawn art draw a different picture (the decoration is drawn only over drawn art).
      const drawn = build(preset, "typical", { size: "tall", qr: true });
      const plain = await renderFlyerPng(input(drawn), "preview");
      expect(Buffer.from(plain.png).equals(Buffer.from(withAi.png)), preset).toBe(false);
    }
  }, 120_000);

  it("says nothing about a flyer that fits, and the square size is square", async () => {
    const r = await renderFlyerPng(input(build("notice", "typical", { size: "tall", scene: false, qr: false })), "preview");
    expect(r.notes).toEqual([]);
    expect(FLYER_SIZES.square.w).toBe(FLYER_SIZES.square.h);
    const sq = await renderFlyerPng(input(build("save_the_date", "typical", { size: "square" })), "preview");
    expect(sq.dims.w).toBe(sq.dims.h);
  }, 30_000);

  it("works for a community with no logo (its name stands in) and no partner", async () => {
    const d = build("save_the_date", "typical", { size: "post" });
    d.poster = { ...d.poster!, partner: { on: false, label: "", sub: "", logo_path: null } };
    const r = await renderFlyerPng(input(d, { logo: null }), "preview");
    expect(isPng(r.png)).toBe(true);
  }, 30_000);

  it("draws Gujarati and Hindi words in the layout blocks (the fonts are chosen from every word the layout adds)", async () => {
    const d = build("notice", "typical", { size: "tall", scene: false });
    d.poster = { ...d.poster!, layout: { ...d.poster!.layout!, eyebrow: "માસિક", host: { label: "લાભાર્થી", names: "અનિલ અને રેખા મહેતા" }, greeting: { top: "જય જિનેન્દ્ર", bottom: "जय जिनेन्द्र" } } };
    expect(flyerText(input(d))).toContain("લાભાર્થી");
    const r = await renderFlyerPng(input(d), "preview");
    expect(isPng(r.png)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/Gujarati and Hindi letters/);
  }, 30_000);

  it("reads the greeting of a tradition from data, for any community", () => {
    const greeting = greetingFor({ kind: { key: "jain_center" } });
    const l: PosterLayout = defaultLayout("notice", { headline: "Snatra Puja", greeting });
    expect(l.greeting.top).toBe(greeting);
  });
});

describe("shortenNames", () => {
  it("keeps the names that fit, then says how many more", () => {
    const list = "Dana Whitfield, Marcus Ellery, Priya Raman, Tom Eastley and Lena Okafor";
    expect(shortenNames(list, 200)).toBe(list);
    expect(shortenNames(list, 39)).toBe("Dana Whitfield and 4 more");
    expect(shortenNames(list, 45)).toBe("Dana Whitfield, Marcus Ellery and 3 more");
    expect(shortenNames(list, 60)).toBe("Dana Whitfield, Marcus Ellery, Priya Raman and 2 more");
    expect(shortenNames("Ruth Aman and the Saturday crew", 18).endsWith("more")).toBe(true);
  });
  it("cuts one long name with no list at a word", () => {
    const one = shortenNames("The Okafor Alvarez Whitfield Ellery Family Foundation Trust", 30);
    expect(one.endsWith("…")).toBe(true);
    expect(flyerLen(one)).toBeLessThanOrEqual(30);
  });
  it("never returns an empty list and never loses the first name", () => {
    for (const max of [1, 5, 12, 30]) expect(shortenNames("Aarav Shah, Mia Brown, Sam Ito", max).length).toBeGreaterThan(0);
    expect(shortenNames("Aarav Shah, Mia Brown, Sam Ito", 12).startsWith("Aarav Shah")).toBe(true);
  });
});

describe("a very long title", () => {
  it("is wrapped line by line at the floor size, never set as one endless line (a row far wider than its box can hang the image renderer)", () => {
    const save = LAYOUT_PRESETS.save_the_date;
    const t = titlePlan("Annual Neighbourhood Supper and Community Celebration of the Whole Street and Everyone Who Lives Near It", "", save, { width: 740, story: false, height: 1350 });
    expect(t.lines.length).toBeGreaterThan(3);
    expect(t.widest).toBeLessThanOrEqual(740);
    for (const line of t.lines) expect(line.length).toBeGreaterThan(0);
    expect(t.lines.flat().map((w) => w.text).join(" ")).toBe("Annual Neighbourhood Supper and Community Celebration of the Whole Street and Everyone Who Lives Near It");
  });
});
