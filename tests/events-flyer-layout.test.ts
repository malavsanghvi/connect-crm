import { describe, expect, it } from "vitest";

import { defaultFlyerDesign, defaultPoster, FLYER_SIZES, FLYER_SIZE_KEYS, parseFlyerDesign, parsePosterContent, type PosterContent } from "@/lib/events/flyer";
import { FLYER_TRADITIONS } from "@/lib/events/flyer-occasions";
import { POSTER_ICONS, POSTER_ICON_LABEL, posterIconSvg } from "@/lib/events/flyer-icons";
import {
  BLOCK_LABEL,
  CREDIT_GROUPS_MAX,
  FLYER_GREETINGS,
  HERO_SHAPES,
  LAYOUT_BLOCKS,
  LAYOUT_CONTACTS_MAX,
  LAYOUT_LIMITS,
  LAYOUT_PRESETS,
  LAYOUT_PRESET_KEYS,
  blockPresent,
  defaultAccent,
  defaultLayout,
  greetingFor,
  isBlockKey,
  layoutNames,
  layoutPeople,
  layoutText,
  originalThumbnailSvg,
  parseLayout,
  presentBlocks,
  presetThumbnailSvg,
  scriptSafe,
  titleWords,
  withLayoutPreset,
  withoutLayout,
  type LayoutPreset,
  type PosterLayout,
} from "@/lib/events/flyer-layout";
import { cleanLine, flyerTextLength } from "@/lib/events/flyer-text";

const base = () => defaultPoster({ name: "Community Supper", description: null, startsAt: "2026-10-18T17:30:00Z", endsAt: null, tz: "UTC" });
const layoutOf = (preset: LayoutPreset = "notice", over: Partial<PosterLayout> = {}): PosterLayout => ({ ...defaultLayout(preset, { headline: "Community Supper" }), ...over });
const church = { kind: { key: "church" } };
const chamber = { kind: { key: "chamber" } };
const jainCentre = { kind: { key: "jain_center" } };

describe("the layout presets are data", () => {
  it("each preset lists every block exactly once, in an order of its own, and says what to leave out first", () => {
    for (const key of LAYOUT_PRESET_KEYS) {
      const spec = LAYOUT_PRESETS[key];
      expect(spec.key).toBe(key);
      expect([...spec.order].sort()).toEqual([...LAYOUT_BLOCKS].filter((b) => b !== "qr" || spec.style.qr === "block").sort());
      // The title and the logos are never left out for lack of room.
      expect(spec.dropOrder).not.toContain("title");
      expect(spec.dropOrder).not.toContain("logos");
      for (const b of spec.dropOrder) expect(spec.order).toContain(b);
      expect(new Set(spec.dropOrder).size).toBe(spec.dropOrder.length);
    }
  });

  it("names no faith, tradition or community in the preset data: that comes from data by tradition", () => {
    const words = /jain|hindu|puja|garba|church|mosque|temple|christian|muslim|sikh|jewish|buddhist|derasar|diwali|easter|eid/i;
    for (const spec of Object.values(LAYOUT_PRESETS)) {
      expect(JSON.stringify({ label: spec.label, blurb: spec.blurb, seed: spec.seed, style: spec.style })).not.toMatch(words);
    }
  });

  it("has the five layouts of the brief, each with a window only when it draws one, and the window's blocks inside its own order", () => {
    expect([...LAYOUT_PRESET_KEYS]).toEqual(["notice", "save_the_date", "ceremony", "event_day", "thank_you"]);
    expect(layoutNames()).toBe("Notice, Save the date, Ceremony, Event day or Thank you");
    for (const spec of Object.values(LAYOUT_PRESETS)) {
      if (spec.style.window) {
        expect(spec.style.window.width).toBeGreaterThan(500);
        expect(spec.style.window.width).toBeLessThanOrEqual(900);
        for (const b of spec.style.window.blocks) expect(spec.order).toContain(b);
      }
      expect(HERO_SHAPES).toContain(spec.seed.hero_shape);
    }
    expect(LAYOUT_PRESETS.ceremony.style.window).not.toBeNull();
    expect(LAYOUT_PRESETS.notice.style.window).toBeNull();
    // The thank-you has no date by default; the others do.
    expect(LAYOUT_PRESETS.thank_you.seed.when).toBe(false);
    expect(LAYOUT_PRESETS.event_day.seed.when).toBe(true);
  });

  it("has a label for every block", () => {
    for (const b of LAYOUT_BLOCKS) expect(BLOCK_LABEL[b].length).toBeGreaterThan(2);
    expect(isBlockKey("host")).toBe(true);
    expect(isBlockKey("hero")).toBe(true);
    expect(isBlockKey("sparkles")).toBe(false);
  });

  it("draws a thumbnail for each preset and for the original, in the palette it is given", () => {
    const c = { paper: "#FBF7F0", ink: "#1B2C5C", accent: "#8C1D2E", gold: "#C9A227" };
    for (const key of LAYOUT_PRESET_KEYS) {
      const svg = presetThumbnailSvg(key, c);
      expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 100 1(?:00|25)"/);
      expect(svg).toContain("#C9A227");
      expect(svg.match(/<rect/g)!.length).toBeGreaterThan(5);
    }
    expect(originalThumbnailSvg(c)).toContain("<svg");
    // The square layout is drawn square.
    expect(presetThumbnailSvg("save_the_date", c)).toContain('viewBox="0 0 100 100"');
    // Every preset has its own drawing (a thumbnail is made from the preset's blocks, so a new preset needs none by hand).
    expect(new Set(LAYOUT_PRESET_KEYS.map((k) => presetThumbnailSvg(k, c))).size).toBe(LAYOUT_PRESET_KEYS.length);
  });
});

describe("the greeting comes from data by tradition", () => {
  it("is offered to a community of a tradition that has one, and is none for everyone else", () => {
    expect(greetingFor(jainCentre)).toBe(FLYER_GREETINGS.jain);
    expect(greetingFor({ kind: { key: "temple" }, tradition: "sikh" })).toBe(FLYER_GREETINGS.sikh);
    expect(greetingFor({ kind: { key: "temple" }, tradition: "sthanakvasi" })).toBe(FLYER_GREETINGS.jain);
    // A church's tradition has no greeting row, so it gets none; a chamber and a club have no tradition at all.
    expect(greetingFor(church)).toBe("");
    expect(greetingFor(chamber)).toBe("");
    expect(greetingFor({ kind: { key: "club" } })).toBe("");
    expect(greetingFor(null)).toBe("");
    expect(greetingFor(undefined)).toBe("");
  });

  it("has a row only for a tradition the flyer art knows", () => {
    for (const key of Object.keys(FLYER_GREETINGS)) expect(FLYER_TRADITIONS as readonly string[]).toContain(key);
  });

  it("seeds the notice with the greeting at the top and the bottom, and the save-the-date with none (the organizer may type their own)", () => {
    const g = greetingFor(jainCentre);
    expect(defaultLayout("notice", { headline: "Snatra Puja", greeting: g }).greeting).toEqual({ top: g, bottom: g });
    expect(defaultLayout("save_the_date", { headline: "Picnic", greeting: g }).greeting).toEqual({ top: "", bottom: "" });
    expect(defaultLayout("notice", { headline: "Community Supper" }).greeting).toEqual({ top: "", bottom: "" });
  });
});

describe("parseLayout", () => {
  it("accepts a layout and cleans every line", () => {
    const r = parseLayout({
      preset: "notice",
      off: ["host", "host", "nonsense"],
      accent: "  Supper ",
      eyebrow: "Monthly\n",
      greeting: { top: " Welcome ", bottom: "" },
      host: { label: "Hosted by", names: "The\tOkafor family" },
      note: { icon: "food", text: "Bring a dish." },
      cta: "Host a supper?",
      contacts_label: "Please contact",
      contacts: [{ name: " Dana ", detail: "555-0142" }, { name: "", detail: "" }, { name: "Marcus", detail: "" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layout.off).toEqual(["host"]);
      expect(r.layout.accent).toBe("Supper");
      expect(r.layout.eyebrow).toBe("Monthly");
      expect(r.layout.host.names).toBe("The Okafor family");
      expect(r.layout.contacts).toEqual([
        { name: "Dana", detail: "555-0142" },
        { name: "Marcus", detail: "" },
      ]);
      expect(r.layout.note.icon).toBe("food");
    }
  });

  it("falls back to sensible values for an empty layout", () => {
    const r = parseLayout({ preset: "save_the_date" });
    expect(r).toEqual({
      ok: true,
      layout: {
        preset: "save_the_date",
        off: [],
        accent: "",
        eyebrow: "",
        greeting: { top: "", bottom: "" },
        host: { label: "", names: "" },
        note: { icon: "leaf", text: "" },
        cta: "",
        contacts_label: "",
        contacts: [],
        hero: { photo_id: null, shape: "rounded" },
        credits: [],
        donors: { heading: "", names: "" },
        closing: "",
      },
    });
  });

  it("says in plain words what is wrong", () => {
    expect(parseLayout(null)).toEqual({ ok: false, error: "The layout is missing. Choose a layout again." });
    expect(parseLayout({ preset: "poster" })).toEqual({ ok: false, error: "Choose a layout: Notice, Save the date, Ceremony, Event day or Thank you." });
    expect(parseLayout({ preset: "notice", contacts: [1, 2, 3, 4].map((n) => ({ name: `P${n}`, detail: "" })) })).toEqual({
      ok: false,
      error: `The contacts block has room for ${LAYOUT_CONTACTS_MAX} people.`,
    });
    expect(parseLayout({ preset: "notice", note: { text: "x".repeat(LAYOUT_LIMITS.note_text + 1) } })).toEqual({ ok: false, error: `The note is longer than ${LAYOUT_LIMITS.note_text} characters.` });
    expect(parseLayout({ preset: "notice", host: { names: "n".repeat(LAYOUT_LIMITS.host_names + 1) } })).toEqual({ ok: false, error: `The host card's names is longer than ${LAYOUT_LIMITS.host_names} characters.` });
    expect(parseLayout({ preset: "notice", contacts: [{ name: "n".repeat(LAYOUT_LIMITS.contact_name + 1), detail: "" }] })).toEqual({
      ok: false,
      error: `The contact's name is longer than ${LAYOUT_LIMITS.contact_name} characters.`,
    });
  });

  it("reads the picture, the thank-you cards, the donors and the closing message, and refuses what is wrong in plain words", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const r = parseLayout({
      preset: "thank_you",
      hero: { photo_id: id.toUpperCase(), shape: "arch" },
      credits: [{ heading: " Welcome team ", names: "Dana, Marcus", icon: "people" }, { heading: "", names: "" }, { heading: "Music", names: "", icon: "nonsense" }],
      donors: { heading: "Our donors", names: "Ava and Sam" },
      closing: " Thank you all ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layout.hero).toEqual({ photo_id: id, shape: "arch" });
      expect(r.layout.credits).toEqual([
        { heading: "Welcome team", names: "Dana, Marcus", icon: "people" },
        { heading: "Music", names: "", icon: "people" },
      ]);
      expect(r.layout.donors).toEqual({ heading: "Our donors", names: "Ava and Sam" });
      expect(r.layout.closing).toBe("Thank you all");
    }
    // A shape it does not know is the rounded frame, not an error (a newer version may add one).
    expect(parseLayout({ preset: "thank_you", hero: { shape: "star" } })).toMatchObject({ ok: true, layout: { hero: { photo_id: null, shape: "rounded" } } });
    expect(parseLayout({ preset: "thank_you", hero: { photo_id: "not-a-photo" } })).toEqual({ ok: false, error: "Choose a picture from one of the albums." });
    expect(parseLayout({ preset: "thank_you", credits: Array.from({ length: CREDIT_GROUPS_MAX + 1 }, (_, i) => ({ heading: `G${i}`, names: "" })) })).toEqual({
      ok: false,
      error: `The thank-you cards have room for ${CREDIT_GROUPS_MAX} groups.`,
    });
    expect(parseLayout({ preset: "thank_you", credits: [{ heading: "h".repeat(LAYOUT_LIMITS.credit_heading + 1), names: "" }] })).toEqual({
      ok: false,
      error: `The thank-you card's heading is longer than ${LAYOUT_LIMITS.credit_heading} characters.`,
    });
    expect(parseLayout({ preset: "thank_you", donors: { names: "n".repeat(LAYOUT_LIMITS.donors_names + 1) } })).toEqual({ ok: false, error: `The donors' names is longer than ${LAYOUT_LIMITS.donors_names} characters.` });
    expect(parseLayout({ preset: "thank_you", closing: "c".repeat(LAYOUT_LIMITS.closing + 1) })).toEqual({ ok: false, error: `The closing message is longer than ${LAYOUT_LIMITS.closing} characters.` });
  });

  it("counts a letter with its sign as one character (Gujarati), like the rest of the flyer", () => {
    const name = "અનિલ".repeat(LAYOUT_LIMITS.contact_name / 4);
    expect(flyerTextLength(name)).toBeLessThanOrEqual(LAYOUT_LIMITS.contact_name);
    expect(parseLayout({ preset: "notice", contacts: [{ name, detail: "" }] }).ok).toBe(true);
  });
});

describe("a layout in the poster and in the design", () => {
  it("is kept by parsePosterContent and parseFlyerDesign, and an old poster without one is read exactly as before", () => {
    const withLayout = withLayoutPreset(base(), "notice", { headline: "Community Supper", greeting: "" });
    const r = parsePosterContent(withLayout);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.poster.layout).toMatchObject({ preset: "notice", accent: "Supper" });
    const old = parsePosterContent(base());
    expect(old.ok).toBe(true);
    if (old.ok) expect("layout" in old.poster).toBe(false);
  });

  it("refuses a bad layout inside a poster with the layout's own sentence", () => {
    const r = parsePosterContent({ ...base(), layout: { preset: "mystery" } });
    expect(r).toEqual({ ok: false, error: "Choose a layout: Notice, Save the date, Ceremony, Event day or Thank you." });
  });

  it("has the Square size (1080 by 1080) among the sizes, and the message names it", () => {
    expect(FLYER_SIZES.square).toEqual({ w: 1080, h: 1080, label: "Square 1080×1080" });
    expect([...FLYER_SIZE_KEYS]).toEqual(["post", "square", "tall", "story", "print"]);
    const d = defaultFlyerDesign({ name: "Picnic", description: null, venue: "Park", startsAt: null, endsAt: null, tz: "UTC", qrAvailable: false });
    expect(parseFlyerDesign({ ...d, size: "square" }).ok).toBe(true);
    expect(parseFlyerDesign({ ...d, size: "a3" })).toEqual({ ok: false, error: "Choose a size: Post, Square, Tall, Story or Print." });
  });

  it("lists the names typed into every block that carries people (host, contacts, thank-you cards, donors), unless the block is off", () => {
    const l = layoutOf("thank_you", { host: { label: "", names: "The Okafors" }, contacts: [{ name: "Dana", detail: "555" }], credits: [{ heading: "Welcome", names: "Marcus, Lena", icon: "people" }], donors: { heading: "", names: "Ava Lindqvist" } });
    expect(layoutPeople(l)).toEqual(["The Okafors", "Dana", "Marcus, Lena", "Ava Lindqvist"]);
    expect(layoutPeople({ ...l, off: ["credits", "donors"] })).toEqual(["The Okafors", "Dana"]);
    expect(layoutText(l)).toContain("Ava Lindqvist");
    expect(layoutText(l)).toContain("Marcus, Lena");
  });

  it("starts new flyers as the original poster: no layout until one is chosen", () => {
    const d = defaultFlyerDesign({ name: "Picnic", description: null, venue: "Park", startsAt: null, endsAt: null, tz: "UTC", qrAvailable: false });
    expect(d.poster && "layout" in d.poster).toBe(false);
  });
});

describe("choosing a layout", () => {
  it("keeps everything already typed and seeds only what is empty", () => {
    const typed: PosterContent = { ...base(), subhead: "October 2026", slogan: "Come hungry", footer: "The supper team", agenda: [{ icon: "clock", time: "5 PM", text: "Doors" }] };
    const a = withLayoutPreset(typed, "notice", { headline: "Community Supper", greeting: "Welcome" });
    expect(a).toMatchObject({ subhead: "October 2026", slogan: "Come hungry", footer: "The supper team" });
    expect(a.agenda).toEqual(typed.agenda);
    expect(a.layout?.greeting).toEqual({ top: "Welcome", bottom: "Welcome" });
    const b = withLayoutPreset({ ...a, layout: { ...a.layout!, eyebrow: "Monthly", host: { label: "Sponsored by", names: "Brightwater" } } }, "save_the_date", { headline: "Community Supper" });
    // Moving to another layout loses nothing, and the greeting typed stays.
    expect(b.layout).toMatchObject({ preset: "save_the_date", eyebrow: "Monthly", host: { label: "Sponsored by", names: "Brightwater" }, greeting: { top: "Welcome", bottom: "Welcome" } });
    expect(b.subhead).toBe("October 2026");
  });

  it("starts the save-the-date's sub-title as its own words only when the poster has none", () => {
    expect(withLayoutPreset(base(), "save_the_date", { headline: "Picnic" }).subhead).toBe("Save the date");
    expect(withLayoutPreset({ ...base(), subhead: "Our words" }, "save_the_date", { headline: "Picnic" }).subhead).toBe("Our words");
  });

  it("follows the preset in the bottom scene: a notice has none, a save-the-date has one", () => {
    expect(withLayoutPreset(base(), "notice", { headline: "x" }).scene).toEqual({ source: "none" });
    expect(withLayoutPreset({ ...base(), scene: { source: "none" } }, "save_the_date", { headline: "x" }).scene).toEqual({ source: "code" });
    const ai = { source: "ai" as const, path: "p" };
    expect(withLayoutPreset({ ...base(), scene: ai }, "save_the_date", { headline: "x" }).scene).toEqual(ai);
    // The frame is never touched by a layout.
    expect(withLayoutPreset({ ...base(), frame: { source: "none" } }, "notice", { headline: "x" }).frame).toEqual({ source: "none" });
  });

  it("shows the date for a layout that has one and hides it for the thank-you, keeping what was typed", () => {
    const typed: PosterContent = { ...base(), ribbon: { on: true, date: "Sunday", time: "5 PM" } };
    const ty = withLayoutPreset(typed, "thank_you", { headline: "x" });
    expect(ty.ribbon).toEqual({ on: false, date: "Sunday", time: "5 PM" });
    expect(withLayoutPreset(ty, "event_day", { headline: "x" }).ribbon).toEqual({ on: true, date: "Sunday", time: "5 PM" });
  });

  it("seeds the ceremony with the greeting at the bottom only", () => {
    expect(defaultLayout("ceremony", { headline: "Navpad Puja", greeting: "Welcome" }).greeting).toEqual({ top: "", bottom: "Welcome" });
    expect(defaultLayout("thank_you", { headline: "Thanks", greeting: "Welcome" }).greeting).toEqual({ top: "", bottom: "Welcome" });
    expect(defaultLayout("event_day", { headline: "Kick-off", greeting: "Welcome" }).greeting).toEqual({ top: "", bottom: "" });
  });

  it("goes back to the original poster with every word it had", () => {
    const withIt = withLayoutPreset(base(), "notice", { headline: "x" });
    const back = withoutLayout(withIt);
    expect("layout" in back).toBe(false);
    expect(back).toMatchObject({ subhead: withIt.subhead, ribbon: withIt.ribbon });
  });

  it("starts the title's accent as its last word, when there are two words or more and it is short", () => {
    expect(defaultAccent("Community Supper")).toBe("Supper");
    expect(defaultAccent("Supper")).toBe("");
    expect(defaultAccent("Monthly Anuvratadhishthatapushpa")).toBe("");
    expect(defaultLayout("save_the_date", { headline: "Maple Street Picnic" }).accent).toBe("");
  });
});

describe("which blocks are drawn", () => {
  const opts = { hasLogo: true, venue: "" };
  it("draws a block only when it has something to say, in the preset's order", () => {
    const poster: PosterContent = { ...base(), logo: false, partner: { on: false, label: "", sub: "", logo_path: null }, ribbon: { on: false, date: "", time: "" } };
    expect(presentBlocks(poster, layoutOf("notice"), opts)).toEqual(["title"]);
    const full = layoutOf("notice", {
      eyebrow: "Monthly",
      greeting: { top: "Welcome", bottom: "Bye" },
      host: { label: "Hosted by", names: "The Okafors" },
      note: { icon: "leaf", text: "Bring a dish" },
      cta: "Host one?",
      contacts: [{ name: "Dana", detail: "555" }],
    });
    const p2: PosterContent = { ...poster, logo: true, subhead: "October", slogan: "Come", footer: "Team", ribbon: { on: true, date: "Sunday", time: "5 PM" } };
    expect(presentBlocks(p2, full, { ...opts, qr: true })).toEqual(["greeting_top", "logos", "eyebrow", "title", "subhead", "tagline", "host", "when", "note", "cta", "contacts", "qr", "footer", "greeting_bottom"]);
  });

  it("leaves a block out when it is switched off, but keeps what was typed in it", () => {
    const l = layoutOf("notice", { host: { label: "Hosted by", names: "The Okafors" }, off: ["host"] });
    expect(blockPresent("host", { poster: base(), layout: l, ...opts })).toBe(false);
    expect(l.host.names).toBe("The Okafors");
    // The title cannot be switched off.
    expect(blockPresent("title", { poster: base(), layout: { ...l, off: ["title"] }, ...opts })).toBe(true);
  });

  it("draws the picture only when one is chosen and the renderer has it, and a thank-you's cards, donors and closing when they have words", () => {
    const l = layoutOf("thank_you", { hero: { photo_id: "33333333-3333-4333-8333-333333333333", shape: "arch" }, credits: [{ heading: "Welcome", names: "", icon: "people" }], donors: { heading: "h", names: "Ava" }, closing: "Thanks" });
    const p = { poster: base(), layout: l, ...opts };
    expect(blockPresent("hero", p)).toBe(false);
    expect(blockPresent("hero", { ...p, hero: true })).toBe(true);
    expect(blockPresent("hero", { ...p, hero: true, layout: { ...l, hero: { ...l.hero, photo_id: null } } })).toBe(false);
    expect(blockPresent("credits", p)).toBe(true);
    expect(blockPresent("credits", { ...p, layout: { ...l, credits: [{ heading: "", names: "", icon: "people" }] } })).toBe(false);
    expect(blockPresent("donors", p)).toBe(true);
    expect(blockPresent("closing", p)).toBe(true);
    expect(blockPresent("donors", { ...p, layout: { ...l, off: ["donors"] } })).toBe(false);
  });

  it("shows the date block for a venue alone, and the RSVP code only when there is one", () => {
    const poster: PosterContent = { ...base(), ribbon: { on: true, date: "", time: "" } };
    expect(blockPresent("when", { poster, layout: layoutOf(), hasLogo: true, venue: "Hall" })).toBe(true);
    expect(blockPresent("when", { poster, layout: layoutOf(), hasLogo: true, venue: "" })).toBe(false);
    expect(blockPresent("qr", { poster, layout: layoutOf(), ...opts })).toBe(false);
    expect(blockPresent("qr", { poster, layout: layoutOf(), ...opts, qr: true })).toBe(true);
  });

  it("never lists the RSVP code in a layout that keeps it in the corner", () => {
    const l = layoutOf("save_the_date");
    expect(presentBlocks(base(), l, { ...opts, qr: true })).not.toContain("qr");
  });
});

describe("the title's words", () => {
  it("marks the accent word, whatever its case or punctuation", () => {
    expect(titleWords("Community Supper", "supper")).toEqual([
      { text: "Community", accent: false },
      { text: "Supper", accent: true },
    ]);
    expect(titleWords("Snatra Puja!", "Puja")).toEqual([
      { text: "Snatra", accent: false },
      { text: "Puja!", accent: true },
    ]);
    expect(titleWords("The Annual Gala Night", "Gala Night").map((w) => w.accent)).toEqual([false, false, true, true]);
  });

  it("marks nothing when the accent is not in the title (the title may change after the accent was typed)", () => {
    expect(titleWords("Community Supper", "Gala").every((w) => !w.accent)).toBe(true);
    expect(titleWords("Community Supper", "").every((w) => !w.accent)).toBe(true);
    expect(titleWords("", "x")).toEqual([]);
  });

  it("sets in script only letters the bundled script font has", () => {
    expect(scriptSafe("Save the date, 10 Oct!")).toBe(true);
    expect(scriptSafe("Café – résumé")).toBe(true);
    expect(scriptSafe("સ્નાત્ર પૂજા")).toBe(false);
    expect(scriptSafe("पूजा")).toBe(false);
    expect(scriptSafe("Tapasyās")).toBe(false);
  });

  it("gives the fonts every word the layout adds", () => {
    const t = layoutText(layoutOf("notice", { eyebrow: "માસિક", host: { label: "Hosted by", names: "Anil" }, contacts: [{ name: "Dana", detail: "555-0142" }] }));
    expect(t).toContain("માસિક");
    expect(t).toContain("555-0142");
  });
});

describe("the text helpers the flyer shares", () => {
  it("cleans a line the way the flyer always did", () => {
    expect(cleanLine("  a\tb c  d ")).toBe("a b c d");
    expect(cleanLine(5)).toBe("");
    expect(flyerTextLength("અનિલ")).toBe(4);
  });
});

describe("the icon set", () => {
  it("has the icons the layouts need, each drawn and named", () => {
    for (const name of ["calendar", "clock", "pin", "dinner", "food", "people", "phone", "mail", "globe", "heart", "leaf", "star", "ticket", "book"] as const) {
      expect(POSTER_ICONS).toContain(name);
      expect(POSTER_ICON_LABEL[name].length).toBeGreaterThan(2);
      expect(posterIconSvg(name, "#1B2C5C")).toMatch(/^<svg [^>]*viewBox="0 0 48 48"[^>]*><(?:path|circle|rect|ellipse)/);
    }
    expect(new Set(POSTER_ICONS).size).toBe(POSTER_ICONS.length);
  });
});
