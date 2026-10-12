import { describe, expect, it } from "vitest";

import { FLYER_SIZES, FLYER_SIZE_KEYS, defaultPoster, type FlyerDesign, type FlyerSize, type PosterContent } from "@/lib/events/flyer";
import { FLYER_OCCASIONS } from "@/lib/events/flyer-art";
import { artPack } from "@/lib/events/flyer-art-packs";
import { readFlyerBrand } from "@/lib/events/flyer-brand";
import { BUNDLED_SCRIPT, BUNDLED_SCRIPT_FILE, flyerFontPath, getFlyerFonts } from "@/lib/events/flyer-fonts";
import { LAYOUT_PRESETS, LAYOUT_PRESET_KEYS, defaultLayout, greetingFor, withLayoutPreset, type LayoutPreset, type PosterLayout } from "@/lib/events/flyer-layout";
import { LAYOUT_SCALES, breakWords, layoutColors, layoutNotes, planLayout, splitDate, splitDetail, stackBottom, titlePlan } from "@/lib/events/flyer-layout-render";
import { flyerDims, flyerText, isPng, renderFlyerPng, type FlyerRenderInput } from "@/lib/events/flyer-render";
import { contrastRatio } from "@/lib/setup";
import { readFile } from "node:fs/promises";

const brand = readFlyerBrand(null, undefined);
const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const logo = { dataUri: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60"><rect width="200" height="60" rx="8" fill="#7A2E1F"/></svg>'), w: 200, h: 60 };
const PRESETS: readonly LayoutPreset[] = LAYOUT_PRESET_KEYS;

type Content = "bare" | "typical" | "longest";

const long = (s: string, n: number) => `${s} ${"and more words ".repeat(40)}`.slice(0, n).trimEnd();

/** A layout poster at one of three amounts of content: only a headline, an ordinary flyer, or every field at its limit. */
function build(preset: LayoutPreset, content: Content, over: { size?: FlyerSize; qr?: boolean; scene?: boolean; occasion?: PosterContent["occasion"]; headline?: string } = {}): FlyerDesign {
  const headline = over.headline ?? (content === "longest" ? long("Annual Neighbourhood Supper and Community Celebration of the Whole Street", 90) : content === "bare" ? "Supper" : "Community Supper");
  const base = defaultPoster({ name: headline, description: null, startsAt: null, endsAt: null, tz: "UTC" });
  let poster: PosterContent = { ...base, occasion: over.occasion ?? "general", partner: { on: content !== "bare", label: "", sub: "", logo_path: null } };
  poster = withLayoutPreset(poster, preset, { headline, greeting: content === "bare" ? "" : "Welcome" });
  if (content === "typical") {
    poster = {
      ...poster,
      subhead: "October 2026",
      slogan: "Come hungry, bring a friend",
      ribbon: { on: true, date: "Sunday, October 18, 2026", time: "12:30–3:00 PM" },
      layout: {
        ...poster.layout!,
        eyebrow: "Monthly",
        host: { label: "Hosted by", names: "The Okafor & Alvarez Families" },
        note: { icon: "food", text: "Please bring a dish to share and stay to help clear the tables afterwards." },
        cta: "Would your family like to host a future supper?",
        contacts: [
          { name: "Dana Whitfield", detail: "555-0142" },
          { name: "Marcus Ellery", detail: "marcus@example.org" },
        ],
      },
    };
  }
  if (content === "longest") {
    poster = {
      ...poster,
      subhead: long("Our thirtieth year", 48),
      slogan: long("Come hungry and bring someone new", 60),
      stat: { on: true, icon: "people", label: long("MORE THAN", 24), value: "1,250", caption: long("PEOPLE HAVE ALREADY SAID YES", 80) },
      ribbon: { on: true, date: long("Thursday, September 10 – Thursday, September 17, 2026", 44), time: long("6:00 PM–9:30 PM each evening", 36) },
      agenda: [1, 2, 3, 4, 5].map((n) => ({ icon: "clock" as const, time: long(`${n}:00 PM`, 22), text: long("Doors open and everyone is welcome to come in", 80) })),
      paragraph: long("Connect with your neighbours. Meet the people who live on your street.", 320),
      footer: long("The organising team", 60),
      layout: {
        ...poster.layout!,
        accent: "Celebration",
        eyebrow: long("Our annual", 28),
        greeting: { top: long("Welcome, friends", 32), bottom: long("See you at the table", 32) },
        host: { label: long("Sponsored by", 24), names: long("The Okafor, Alvarez, Whitfield and Ellery Families", 90) },
        note: { icon: "leaf", text: long("Please bring a dish to share and stay to help clear the tables", 160) },
        cta: long("Would your family like to host a future supper?", 90),
        contacts_label: long("Please contact", 32),
        contacts: [1, 2, 3].map((n) => ({ name: long(`Dana Whitfield ${n}`, 32), detail: long("dana.whitfield@neighbourhoodsupper.example", 40) })),
      },
    };
  }
  return {
    v: 1,
    template: "poster",
    size: over.size ?? "tall",
    headline,
    tagline: "",
    date_line: "",
    venue_line: content === "bare" ? "" : content === "longest" ? long("Fellowship Hall of the Greater Riverside Community Centre, 120 Maple Street", 120) : "Fellowship Hall, 120 Maple Street",
    show_qr: over.qr ?? false,
    background: { source: "plain" },
    poster: over.scene === false ? { ...poster, scene: { source: "none" } } : poster,
  };
}

const dimsOf = (size: FlyerSize) => flyerDims(size, "full");
const planOf = (d: FlyerDesign, size: FlyerSize = d.size) => {
  const poster = d.poster!;
  const input = { design: d, poster, logo, assets: { frame: null, scene: null, partnerLogo: null }, centerName: "Maple Street Neighbours" };
  return planLayout(input, dimsOf(size), artPack(poster.occasion, brand), {});
};

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
            expect(plan.blocks).toContain("title");
            expect(plan.k).toBeGreaterThanOrEqual(LAYOUT_SCALES.floor);
            expect(plan.k).toBeLessThanOrEqual(LAYOUT_SCALES.max);
            // Only the blocks the preset says may be left out go, and the title and the logos never.
            const spec = LAYOUT_PRESETS[preset];
            for (const b of plan.dropped) {
              expect(spec.dropOrder).toContain(b);
              expect(plan.blocks).not.toContain(b);
            }
            // The stack ends above the scene (unless nothing more could be done: the scale is at its floor).
            if (plan.k > LAYOUT_SCALES.floor + 0.001) expect(stackBottom(plan)).toBeLessThanOrEqual(plan.H - plan.reserve + 1);
            // And it starts below the top edge.
            expect(plan.top).toBeGreaterThanOrEqual(0);
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
      expect(plan.dropped).toEqual([]);
      expect(plan.k).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("says in plain sentences what was left out or set small", () => {
    const d = build("notice", "longest", { size: "square" });
    const notes = layoutNotes({ design: d, poster: d.poster!, brand, logo, assets: { frame: null, scene: null, partnerLogo: null }, centerName: "x" }, dimsOf("square"));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).toMatch(/^(There was not room for|This flyer is crowded)/);
    const fine = build("notice", "typical", { size: "tall", scene: false });
    expect(layoutNotes({ design: fine, poster: fine.poster!, brand, logo, assets: { frame: null, scene: null, partnerLogo: null }, centerName: "x" }, dimsOf("tall"))).toEqual([]);
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
    posterAssets: { frame: null, scene: null, partnerLogo: null },
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
