import { describe, expect, it } from "vitest";

import {
  POSTER_AGENDA_MAX,
  POSTER_LIMITS,
  defaultFlyerDesign,
  defaultPoster,
  flyerTextLength,
  isPartnerLogoPath,
  parseFlyerDesign,
  parsePosterContent,
  posterLayersBelongTo,
  posterWhen,
  type FlyerDesign,
  type PosterContent,
} from "@/lib/events/flyer";
import { FLYER_OCCASIONS, flyerArtPath, type FlyerOccasion } from "@/lib/events/flyer-art";
import { artPack, brandPalette, flattenOpacity, frameEdgeSvg, mix, packLayerThumbnailSvg, packThumbnailSvg, plainPaperSvg, ribbonSvg, svgDataUri } from "@/lib/events/flyer-art-packs";
import { readFlyerBrand } from "@/lib/events/flyer-brand";
import { POSTER_ICONS, POSTER_ICON_LABEL, isPosterIcon, posterIconSvg, posterIconUri } from "@/lib/events/flyer-icons";
import { POSTER_UNITS, SECTION_LABEL, badgeSizes, headlineFit, lineCount, planPoster, posterNotes, posterText, textWidth, type PosterSection } from "@/lib/events/flyer-poster";
import { contrastRatio } from "@/lib/setup";

const C = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";
const brand = readFlyerBrand(null, undefined);

const poster = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  occasion: "convention",
  frame: { source: "code" },
  scene: { source: "code" },
  logo: true,
  partner: { on: true, label: "JAINA", sub: "2027", logo_path: null },
  subhead: "HOUSTON HOST CITY KICK-OFF",
  slogan: "LET'S MAKE JSH PROUD!",
  stat: { on: true, icon: "people", label: "MORE THAN", value: "80%", caption: "OF CONVENTION REGISTRATIONS ARE FILLED!" },
  ribbon: { on: true, date: "Saturday, October 3, 2026", time: "5:00 PM onwards" },
  agenda: [
    { icon: "clock", time: "5:00–6:00 PM", text: "Convention Kick-Off & Meet and Greet with JAINA Leaders" },
    { icon: "dinner", time: "6:00 PM onwards", text: "Dinner & Fellowship" },
    { icon: "dancers", time: "After Dinner", text: "Garba Night!" },
  ],
  paragraph: "Connect with Jains nationwide.",
  footer: "JAINA 2027 Host City Team",
  ...over,
});

const design = (over: Record<string, unknown> = {}) => ({
  v: 1,
  template: "poster",
  size: "tall",
  headline: "JAINA 2027",
  tagline: "",
  date_line: "",
  venue_line: "JSH Main Hall",
  show_qr: true,
  background: { source: "plain" },
  poster: poster(),
  ...over,
});

describe("parsePosterContent", () => {
  it("accepts the reference poster (the owner's JAINA 2027 kick-off) as it is", () => {
    const r = parsePosterContent(poster());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.poster.agenda).toHaveLength(3);
      expect(r.poster.stat).toEqual({ on: true, icon: "people", label: "MORE THAN", value: "80%", caption: "OF CONVENTION REGISTRATIONS ARE FILLED!" });
      expect(r.poster.ribbon).toEqual({ on: true, date: "Saturday, October 3, 2026", time: "5:00 PM onwards" });
    }
  });

  it("has every section optional: an empty poster is a valid poster", () => {
    const r = parsePosterContent({ occasion: "general" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.poster).toMatchObject({
        occasion: "general",
        frame: { source: "code" },
        scene: { source: "code" },
        logo: true,
        partner: { on: false, label: "", sub: "", logo_path: null },
        subhead: "",
        slogan: "",
        stat: { on: false, label: "", value: "", caption: "" },
        ribbon: { on: true, date: "", time: "" },
        agenda: [],
        paragraph: "",
        footer: "",
      });
    }
  });

  it("refuses an occasion that is not one of the eight packs", () => {
    expect(parsePosterContent({ occasion: "birthday" })).toEqual({ ok: false, error: "Choose an occasion for the poster's art." });
    expect(parsePosterContent({})).toEqual({ ok: false, error: "Choose an occasion for the poster's art." });
    expect(parsePosterContent(null)).toMatchObject({ ok: false });
    expect(parsePosterContent([])).toMatchObject({ ok: false });
  });

  it("checks every limit with a plain sentence that names the field", () => {
    const over = (key: string, value: unknown, error: string) => expect(parsePosterContent(poster({ [key]: value })), key).toEqual({ ok: false, error });
    over("subhead", "x".repeat(POSTER_LIMITS.subhead + 1), `The subhead is longer than ${POSTER_LIMITS.subhead} characters.`);
    over("slogan", "x".repeat(POSTER_LIMITS.slogan + 1), `The slogan line is longer than ${POSTER_LIMITS.slogan} characters.`);
    over("paragraph", "x".repeat(POSTER_LIMITS.paragraph + 1), `The paragraph is longer than ${POSTER_LIMITS.paragraph} characters.`);
    over("footer", "x".repeat(POSTER_LIMITS.footer + 1), `The footer line is longer than ${POSTER_LIMITS.footer} characters.`);
    over("stat", { on: true, icon: "people", label: "x".repeat(25), value: "80%", caption: "" }, "The highlight's small label is longer than 24 characters.");
    over("stat", { on: true, icon: "people", label: "", value: "x".repeat(11), caption: "" }, "The highlight's big number is longer than 10 characters.");
    over("stat", { on: true, icon: "people", label: "", value: "1", caption: "x".repeat(81) }, "The highlight's caption is longer than 80 characters.");
    over("ribbon", { on: true, date: "x".repeat(45), time: "" }, "The ribbon's date is longer than 44 characters.");
    over("ribbon", { on: true, date: "", time: "x".repeat(37) }, "The ribbon's time is longer than 36 characters.");
    over("partner", { on: true, label: "x".repeat(11), sub: "" }, "The partner badge's first line is longer than 10 characters.");
    over("partner", { on: true, label: "", sub: "x".repeat(9) }, "The partner badge's second line is longer than 8 characters.");
    over("agenda", [{ icon: "clock", time: "x".repeat(23), text: "a" }], "The agenda time is longer than 22 characters.");
    over("agenda", [{ icon: "clock", time: "6 PM", text: "x".repeat(81) }], "The agenda line is longer than 80 characters.");
    // At the limit is fine, counted as a person counts (a Gujarati letter with its sign is one symbol).
    expect(parsePosterContent(poster({ subhead: "x".repeat(POSTER_LIMITS.subhead) })).ok).toBe(true);
    expect(parsePosterContent(poster({ slogan: "દિવાળી ".repeat(8).trim() })).ok).toBe(true);
    expect(flyerTextLength("દિવાળી")).toBe(6);
  });

  it("has room for five agenda rows, no more, and drops a row with neither a time nor a line", () => {
    const row = (i: number) => ({ icon: "clock", time: `${i}:00 PM`, text: `Item ${i}` });
    expect(parsePosterContent(poster({ agenda: [1, 2, 3, 4, 5].map(row) })).ok).toBe(true);
    expect(parsePosterContent(poster({ agenda: [1, 2, 3, 4, 5, 6].map(row) }))).toEqual({ ok: false, error: `The agenda has room for ${POSTER_AGENDA_MAX} rows.` });
    const r = parsePosterContent(poster({ agenda: [row(1), { icon: "star", time: "", text: "" }, { icon: "star", time: "  ", text: "\n" }, { icon: "flag", time: "", text: "Only words" }] }));
    expect(r.ok && r.poster.agenda.map((a) => [a.icon, a.time, a.text])).toEqual([
      ["clock", "1:00 PM", "Item 1"],
      ["flag", "", "Only words"],
    ]);
  });

  it("falls back to the clock for an icon that is not in the library", () => {
    const r = parsePosterContent(poster({ agenda: [{ icon: "rocket", time: "6 PM", text: "x" }], stat: { on: true, icon: "<script>", label: "", value: "1", caption: "" } }));
    expect(r.ok && r.poster.agenda[0]?.icon).toBe("clock");
    expect(r.ok && r.poster.stat.icon).toBe("people");
  });

  it("needs the highlight's big number only while the highlight is on", () => {
    expect(parsePosterContent(poster({ stat: { on: true, icon: "people", label: "MORE THAN", value: "", caption: "x" } }))).toEqual({
      ok: false,
      error: "The highlight needs its big number (or switch the highlight off).",
    });
    expect(parsePosterContent(poster({ stat: { on: false, icon: "people", label: "MORE THAN", value: "", caption: "x" } })).ok).toBe(true);
  });

  it("tidies text the way the other fields are tidied (line breaks and no-break spaces become spaces)", () => {
    const r = parsePosterContent(poster({ subhead: "  Houston\nHost\u00A0City\u202FKick-off ", agenda: [{ icon: "clock", time: "5:00\u202FPM", text: "Kick-off" }] }));
    expect(r.ok && r.poster.subhead).toBe("Houston Host City Kick-off");
    expect(r.ok && r.poster.agenda[0]?.time).toBe("5:00 PM");
  });

  it("reads switches strictly: the logo and the ribbon are on unless turned off; the partner and the highlight only when turned on", () => {
    const r = parsePosterContent({ occasion: "garba", logo: "no", ribbon: { on: "false" }, partner: { on: "true" }, stat: { on: 1, value: "1" } });
    expect(r.ok && [r.poster.logo, r.poster.ribbon.on, r.poster.partner.on, r.poster.stat.on]).toEqual([true, true, false, false]);
    const off = parsePosterContent({ occasion: "garba", logo: false, ribbon: { on: false } });
    expect(off.ok && [off.poster.logo, off.poster.ribbon.on]).toEqual([false, false]);
  });
});

describe("the poster's art layers", () => {
  const art = (occasion: FlyerOccasion, layer: "frame" | "scene", seed = 5) => flyerArtPath(C, occasion, layer, seed, "jpg");

  it("accepts a picture made for this occasion and layer", () => {
    const r = parsePosterContent(poster({ occasion: "garba", frame: { source: "ai", path: art("garba", "frame") }, scene: { source: "none" } }));
    expect(r.ok && r.poster.frame).toEqual({ source: "ai", path: art("garba", "frame") });
    expect(r.ok && r.poster.scene).toEqual({ source: "none" });
  });

  it("refuses a picture made for another occasion, or for the other layer, or not made by the flyer maker", () => {
    expect(parsePosterContent(poster({ occasion: "garba", frame: { source: "ai", path: art("diwali", "frame") } }))).toEqual({
      ok: false,
      error: "The AI frame was made for another occasion. Choose one made for this occasion, or use the drawn frame.",
    });
    expect(parsePosterContent(poster({ occasion: "garba", scene: { source: "ai", path: art("garba", "frame") } }))).toEqual({
      ok: false,
      error: "The AI bottom scene is not one the flyer maker made. Choose it again, or use the drawn bottom scene.",
    });
    for (const path of ["https://evil.example/frame-1.jpg", `${C}/events/${E}/art-1.jpg`, `${C}/flyer-art/garba/frame-1.gif`, ""]) {
      expect(parsePosterContent(poster({ occasion: "garba", frame: { source: "ai", path } })).ok, path).toBe(false);
    }
    expect(parsePosterContent(poster({ frame: { source: "web" } }))).toEqual({ ok: false, error: "Choose a frame: the drawn one, AI art, or none." });
  });

  it("belongs to one community: posterLayersBelongTo", () => {
    const p = parsePosterContent(poster({ occasion: "garba", frame: { source: "ai", path: art("garba", "frame") } }));
    expect(p.ok && posterLayersBelongTo(p.poster, C)).toBe(true);
    expect(p.ok && posterLayersBelongTo(p.poster, "99999999-9999-4999-8999-999999999999")).toBe(false);
    const drawn = parsePosterContent(poster());
    expect(drawn.ok && posterLayersBelongTo(drawn.poster, "99999999-9999-4999-8999-999999999999")).toBe(true);
  });
});

describe("the partner's logo", () => {
  it("is a PNG or JPEG kept in this event's own folder", () => {
    expect(isPartnerLogoPath(`${C}/events/${E}/partner-1759300000000.png`, C, E)).toBe(true);
    expect(isPartnerLogoPath(`${C}/events/${E}/partner-1.jpg`, C, E)).toBe(true);
    expect(isPartnerLogoPath(`${C}/events/${E}/partner-1.webp`, C, E)).toBe(false);
    expect(isPartnerLogoPath(`${C}/events/${E}/art-1.png`, C, E)).toBe(false);
    expect(isPartnerLogoPath(`${C}/events/${C}/partner-1.png`, C, E)).toBe(false);
    expect(isPartnerLogoPath(`${E}/events/${E}/partner-1.png`, C, E)).toBe(false);
  });

  it("is recorded in the design only when it is such a path", () => {
    const ok = parsePosterContent(poster({ partner: { on: true, label: "", sub: "", logo_path: `${C}/events/${E}/partner-7.png` } }));
    expect(ok.ok && ok.poster.partner.logo_path).toBe(`${C}/events/${E}/partner-7.png`);
    expect(parsePosterContent(poster({ partner: { on: true, logo_path: "https://evil.example/logo.png" } }))).toEqual({
      ok: false,
      error: "The partner logo is not one uploaded here. Upload it again.",
    });
  });
});

describe("the Poster in a design", () => {
  it("is checked strictly when the Poster is the template", () => {
    const r = parseFlyerDesign(design());
    expect(r.ok && r.design.poster?.occasion).toBe("convention");
    expect(parseFlyerDesign(design({ poster: poster({ stat: { on: true, value: "" } }) }))).toEqual({ ok: false, error: "The highlight needs its big number (or switch the highlight off)." });
    expect(parseFlyerDesign(design({ poster: undefined }))).toEqual({ ok: false, error: "The poster's content is missing. Reload the page and try again." });
  });

  it("is kept, but never blocks, while another template is chosen (switching back loses nothing)", () => {
    const valid = parseFlyerDesign(design({ template: "classic" }));
    expect(valid.ok && valid.design.poster?.occasion).toBe("convention");
    const broken = parseFlyerDesign(design({ template: "classic", poster: { occasion: "birthday" } }));
    expect(broken.ok && broken.design.poster).toBeUndefined();
    expect(parseFlyerDesign(design({ template: "classic", poster: undefined })).ok).toBe(true);
  });

  it("takes its headline and venue from the design, and an event with no flyer starts as a Poster", () => {
    const d = defaultFlyerDesign({ name: "Garba Night", description: "Dance the night away. Bring dandiya sticks.", venue: "JSH Main Hall", startsAt: "2026-10-03T23:00:00Z", endsAt: null, tz: "America/Chicago", qrAvailable: true });
    expect(d).toMatchObject({ template: "poster", size: "tall", headline: "Garba Night", venue_line: "JSH Main Hall" });
    expect(d.poster).toMatchObject({ occasion: "garba", ribbon: { on: true, date: "Saturday, October 3, 2026", time: "6:00 PM onwards" }, paragraph: "Dance the night away. Bring dandiya sticks." });
    expect(parseFlyerDesign(d).ok).toBe(true);
  });
});

describe("posterWhen: the ribbon's date and time, from the event, in the community's time zone", () => {
  const tz = "America/Chicago";
  it("is empty without a start", () => {
    expect(posterWhen(null, null, tz)).toEqual({ date: "", time: "" });
    expect(posterWhen("not a date", null, tz)).toEqual({ date: "", time: "" });
  });

  it("says 'onwards' when there is no end", () => {
    expect(posterWhen("2026-10-03T22:00:00Z", null, tz)).toEqual({ date: "Saturday, October 3, 2026", time: "5:00 PM onwards" });
  });

  it("joins the times of one day, writing AM or PM once when they agree", () => {
    expect(posterWhen("2026-10-03T22:00:00Z", "2026-10-04T01:30:00Z", tz)).toEqual({ date: "Saturday, October 3, 2026", time: "5:00–8:30 PM" });
    expect(posterWhen("2026-10-03T15:00:00Z", "2026-10-03T18:00:00Z", tz)).toEqual({ date: "Saturday, October 3, 2026", time: "10:00 AM–1:00 PM" });
  });

  it("writes several days as a range, with the first day's start (an event records no daily end time, so none is invented)", () => {
    expect(posterWhen("2026-09-10T23:00:00Z", "2026-09-17T02:30:00Z", tz)).toEqual({ date: "September 10–16, 2026", time: "6:00 PM onwards" });
    // The clocks go back on November 1: 02:30 UTC on the 2nd is 8:30 PM on the 1st in Houston, so the range ends on November 1.
    expect(posterWhen("2026-10-30T23:00:00Z", "2026-11-02T02:30:00Z", tz)).toEqual({ date: "October 30 – November 1, 2026", time: "6:00 PM onwards" });
    // In December Houston is on standard time (UTC-6): 23:00 UTC is 5:00 PM.
    expect(posterWhen("2026-12-30T23:00:00Z", "2027-01-02T02:30:00Z", tz)).toEqual({ date: "December 30, 2026 – January 1, 2027", time: "5:00 PM onwards" });
  });

  it("never writes an impossible range for a weekend that ends earlier in the day than it starts", () => {
    // A retreat from Friday 6 PM to Sunday 12 PM is not "6:00–12:00 PM each day".
    expect(posterWhen("2026-10-16T23:00:00Z", "2026-10-18T17:00:00Z", tz)).toEqual({ date: "October 16–18, 2026", time: "6:00 PM onwards" });
  });

  it("keeps an evening that runs past midnight as one date, with both times written in full", () => {
    // A Garba night: Friday 7:00 PM to Saturday 12:30 AM (Houston) is one evening, not two days "each day".
    expect(posterWhen("2026-10-17T00:00:00Z", "2026-10-17T05:30:00Z", tz)).toEqual({ date: "Friday, October 16, 2026", time: "7:00 PM–12:30 AM" });
    // Overnight, and ending exactly at midnight.
    expect(posterWhen("2026-10-17T02:00:00Z", "2026-10-17T11:00:00Z", tz)).toEqual({ date: "Friday, October 16, 2026", time: "9:00 PM–6:00 AM" });
    expect(posterWhen("2026-10-17T02:00:00Z", "2026-10-17T05:00:00Z", tz)).toEqual({ date: "Friday, October 16, 2026", time: "9:00 PM–12:00 AM" });
    // Fourteen hours is the longest "evening"; a minute more is a second day.
    expect(posterWhen("2026-10-17T00:00:00Z", "2026-10-17T14:00:00Z", tz)).toEqual({ date: "Friday, October 16, 2026", time: "7:00 PM–9:00 AM" });
    expect(posterWhen("2026-10-17T00:00:00Z", "2026-10-17T14:01:00Z", tz)).toEqual({ date: "October 16–17, 2026", time: "7:00 PM onwards" });
  });

  it("treats an end that is not after the start as no end at all", () => {
    expect(posterWhen("2026-10-03T22:00:00Z", "2026-10-03T22:00:00Z", tz)).toEqual({ date: "Saturday, October 3, 2026", time: "5:00 PM onwards" });
    expect(posterWhen("2026-10-03T22:00:00Z", "2026-10-03T21:00:00Z", tz)).toEqual({ date: "Saturday, October 3, 2026", time: "5:00 PM onwards" });
    expect(posterWhen("2026-10-03T22:00:00Z", "not a date", tz)).toEqual({ date: "Saturday, October 3, 2026", time: "5:00 PM onwards" });
  });

  it("writes AM and PM on both ends when a day starts before noon and ends after it", () => {
    expect(posterWhen("2026-10-03T15:30:00Z", "2026-10-03T19:00:00Z", tz)).toEqual({ date: "Saturday, October 3, 2026", time: "10:30 AM–2:00 PM" });
    expect(posterWhen("2026-10-03T15:00:00Z", "2026-10-03T16:30:00Z", tz)).toEqual({ date: "Saturday, October 3, 2026", time: "10:00–11:30 AM" });
  });

  it("uses the community's zone, not the server's", () => {
    expect(posterWhen("2026-10-03T02:00:00Z", null, "Asia/Kolkata").date).toBe("Saturday, October 3, 2026");
    expect(posterWhen("2026-10-03T02:00:00Z", null, "America/Chicago").date).toBe("Friday, October 2, 2026");
  });

  it("never carries a no-break space into the poster's text", () => {
    const w = posterWhen("2026-10-03T22:00:00Z", "2026-10-04T01:30:00Z", tz);
    expect(`${w.date}${w.time}`).not.toMatch(/[\u00A0\u202F]/);
  });
});

describe("defaultPoster", () => {
  const e = { name: "Paryushan Mahaparva", description: "Eight days of reflection. Everyone is welcome.", startsAt: "2026-09-10T23:00:00Z", endsAt: "2026-09-17T02:30:00Z", tz: "America/Chicago" };
  it("suggests the pack from the name, with every optional section ready to fill", () => {
    expect(defaultPoster(e)).toEqual({
      occasion: "paryushan",
      frame: { source: "code" },
      scene: { source: "code" },
      logo: true,
      partner: { on: false, label: "", sub: "", logo_path: null },
      subhead: "",
      slogan: "",
      stat: { on: false, icon: "people", label: "", value: "", caption: "" },
      ribbon: { on: true, date: "September 10–16, 2026", time: "6:00 PM onwards" },
      agenda: [],
      paragraph: "Eight days of reflection. Everyone is welcome.",
      footer: "",
    });
  });

  it("always makes a poster its own parser accepts, however long the event's words are", () => {
    const long = defaultPoster({ ...e, description: "A sentence that goes on. ".repeat(60) });
    expect(flyerTextLength(long.paragraph)).toBeLessThanOrEqual(POSTER_LIMITS.paragraph);
    expect(parsePosterContent(long).ok).toBe(true);
    expect(parsePosterContent(defaultPoster({ name: "x", description: null, startsAt: null, endsAt: null, tz: "UTC" })).ok).toBe(true);
  });

  it("cuts a long description at a sentence end when it can", () => {
    const sentence = "This is a full sentence of reasonable length. ";
    const p = defaultPoster({ ...e, description: sentence.repeat(20) });
    expect(p.paragraph.endsWith(".")).toBe(true);
    expect(p.paragraph.length).toBeLessThanOrEqual(POSTER_LIMITS.paragraph);
  });
});

describe("the icon library", () => {
  it("has the icons the brief names, each with a label and a drawing", () => {
    for (const name of ["clock", "dinner", "dancers", "puja", "lecture", "music", "kids", "prayer", "flag"]) expect(POSTER_ICONS as readonly string[]).toContain(name);
    for (const icon of POSTER_ICONS) {
      expect(POSTER_ICON_LABEL[icon].length, icon).toBeGreaterThan(2);
      const svg = posterIconSvg(icon, "#1B2C5C");
      expect(svg.startsWith("<svg"), icon).toBe(true);
      expect(svg).toContain('viewBox="0 0 48 48"');
      expect(svg).not.toMatch(/<text|<script|<image|NaN|undefined/i);
      expect(svg.length).toBeGreaterThan(200);
    }
  });

  it("draws the ribbon's own icons and refuses a colour that is not hex (no markup can be injected)", () => {
    expect(posterIconSvg("calendar", "#C9A227")).toContain("#C9A227");
    expect(posterIconSvg("pin", '"/><script>')).not.toContain("<script");
    expect(posterIconSvg("pin", '"/><script>')).toContain("#1B2C5C");
    expect(posterIconUri("clock", "#112233").startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("knows its names", () => {
    expect(isPosterIcon("clock")).toBe(true);
    expect(isPosterIcon("calendar")).toBe(false);
    expect(isPosterIcon(undefined)).toBe(false);
  });
});

describe("the art packs: drawn in code, free, always available", () => {
  const heights = [1350, 1398, 1620, 1920];

  it("has a pack for each of the eight occasions, with a palette that reads", () => {
    for (const o of FLYER_OCCASIONS) {
      const p = artPack(o, brand);
      expect(p.occasion).toBe(o);
      expect(p.blurb.length).toBeGreaterThan(10);
      expect(p.scene.height).toBeGreaterThan(300);
      expect(p.scene.busy).toBeLessThanOrEqual(p.scene.height);
      expect(p.fade.from).toBeLessThan(p.fade.to);
      expect(p.topInset).toBeGreaterThanOrEqual(54);
      const c = p.palette;
      const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 0;
      // Text on the paper: the headline and the paragraph well past AA; the big number, agenda times and the gold subhead
      // (large bold type, so 3:1 is the rule for it, and the reference poster's own gold is 3.7:1) readable.
      expect(ratio(c.ink, c.paper), `${o} ink`).toBeGreaterThanOrEqual(7);
      expect(ratio(c.body, c.paper), `${o} body`).toBeGreaterThanOrEqual(7);
      expect(ratio(c.accent, c.paper), `${o} accent`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.goldText, c.paper), `${o} gold text`).toBeGreaterThanOrEqual(3.5);
      // The ribbon and the footer band.
      expect(ratio(c.onAccent, c.accent), `${o} ribbon date`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.ribbonHi, c.accent), `${o} ribbon time`).toBeGreaterThanOrEqual(3.9);
      expect(ratio(c.footerText, c.footerBg), `${o} footer`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("draws every frame and scene as clean SVG: no text, no scripts, no pictures, no broken numbers", () => {
    for (const o of FLYER_OCCASIONS) {
      const p = artPack(o, brand);
      for (const H of heights) {
        const frame = p.frame(1080, H);
        expect(frame.startsWith("<svg"), `${o} frame ${H}`).toBe(true);
        expect(frame).toContain(`viewBox="0 0 1080 ${H}"`);
        expect(frame.length, `${o} frame ${H}`).toBeLessThan(400_000);
        for (const svg of [frame, p.scene.draw(1080, p.scene.height), p.scene.draw(1500, p.scene.height)]) {
          expect(svg, o).not.toMatch(/<text|<script|<image|<foreignObject|<use |href=|\son[a-z]+=|NaN|undefined|Infinity/i);
        }
      }
      const scene = p.scene.draw(1080, p.scene.height);
      expect(scene).toContain(`viewBox="0 0 1080 ${p.scene.height}"`);
    }
  });

  it("never puts opacity on a single shape: that is a full-size layer per shape for the renderer (half a minute at Print size)", () => {
    const single = /<(?!g\b)[a-z]+\b[^>]*\sopacity=/;
    for (const o of FLYER_OCCASIONS) {
      const p = artPack(o, brand);
      for (const svg of [p.frame(1080, 1620), p.frame(1080, 1398), p.scene.draw(1080, p.scene.height), p.scene.draw(1500, p.scene.height), plainPaperSvg(1080, 1620, p.palette), ribbonSvg({ W: 1080, H: 142, band: 118, pal: p.palette }), frameEdgeSvg(1080, 1620, "#C9A227")]) {
        expect(svg, o).not.toMatch(single);
      }
    }
  });

  it("flattenOpacity turns a shape's opacity into fill-opacity and stroke-opacity, and leaves groups and gradients alone", () => {
    expect(flattenOpacity('<circle cx="1" r="3" fill="#FFF" opacity="0.35"/>')).toBe('<circle cx="1" r="3" fill="#FFF" fill-opacity="0.35"/>');
    expect(flattenOpacity('<path d="M0 0" stroke="#000" fill="none" opacity="0.7"/>')).toBe('<path d="M0 0" stroke="#000" fill="none" stroke-opacity="0.7"/>');
    expect(flattenOpacity('<rect width="1" fill="#123456" stroke="#000" opacity="0.5"/>')).toBe('<rect width="1" fill="#123456" stroke="#000" fill-opacity="0.5" stroke-opacity="0.5"/>');
    expect(flattenOpacity('<ellipse rx="1" fill="red" stroke-opacity="0.5"/>')).toBe('<ellipse rx="1" fill="red" stroke-opacity="0.5"/>');
    expect(flattenOpacity('<g opacity="0.95"><circle r="1"/></g>')).toBe('<g opacity="0.95"><circle r="1"/></g>');
    expect(flattenOpacity('<stop offset="0" stop-color="#FFF" stop-opacity="0.95"/>')).toBe('<stop offset="0" stop-color="#FFF" stop-opacity="0.95"/>');
    expect(flattenOpacity('<path d="M0 0" stroke="none" fill="#000" opacity="0.2"></path>')).toBe('<path d="M0 0" stroke="none" fill="#000" fill-opacity="0.2"></path>');
  });

  it("is the same picture every time it is drawn (the same flyer, the same art)", () => {
    for (const o of FLYER_OCCASIONS) {
      const a = artPack(o, brand);
      const b = artPack(o, brand);
      expect(a.frame(1080, 1620)).toBe(b.frame(1080, 1620));
      expect(a.scene.draw(1080, a.scene.height)).toBe(b.scene.draw(1080, b.scene.height));
    }
  });

  it("the General pack takes the community's own brand colours, and every one of its text colours reads", () => {
    const own = artPack("general", readFlyerBrand({ primary: "#7A2E1F", accent: "#C9731C", background: "#FFF8EE" }, undefined));
    expect(own.palette.paper).toBe("#FFF8EE");
    expect(own.frame(1080, 1620)).toContain("#C9731C");
    // Colours chosen badly (a pale primary on a pale page) are still made readable.
    for (const b of [
      { primary: "#F5F5F5", accent: "#FFFF00", background: "#FFFFFF" },
      { primary: "#222222", accent: "#333333", background: "#111111" },
      { primary: "#FFD700", accent: "#FFD700", background: "#FFFDE7" },
    ]) {
      const c = brandPalette(b);
      expect(contrastRatio(c.ink, c.paper) ?? 0, JSON.stringify(b)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.body, c.paper) ?? 0, JSON.stringify(b)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.accent, c.paper) ?? 0, JSON.stringify(b)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.onAccent, c.accent) ?? 0, JSON.stringify(b)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.footerText, c.footerBg) ?? 0, JSON.stringify(b)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("offers a thumbnail for the picker and for each layer (the same drawings the renderer uses)", () => {
    const p = artPack("diwali", brand);
    const both = packThumbnailSvg(p, { frame: true, scene: true });
    expect(both.startsWith("<svg")).toBe(true);
    expect(both).not.toMatch(/<text|<script|NaN|undefined/);
    expect(packThumbnailSvg(p, { frame: false, scene: false }).length).toBeLessThan(both.length);
    expect(packLayerThumbnailSvg(p, "frame")).toMatchObject({ w: 1080, h: 1620 });
    expect(packLayerThumbnailSvg(p, "scene")).toMatchObject({ w: 1080, h: p.scene.height });
    expect(packLayerThumbnailSvg(p, "none").svg).toBe(plainPaperSvg(1080, 1620, p.palette));
    expect(svgDataUri("<svg/>")).toBe(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`);
  });

  it("draws the ribbon and the edge drawn over an AI frame with no text either", () => {
    const pal = artPack("garba", brand).palette;
    expect(ribbonSvg({ W: 1080, H: 142, band: 118, pal })).not.toMatch(/<text|NaN/);
    expect(frameEdgeSvg(1080, 1620, "#C9A227")).not.toMatch(/<text|NaN/);
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#102030", "#102030", 0.7)).toBe("#102030");
  });
});

describe("the poster's layout plan", () => {
  const logo = { dataUri: "data:image/png;base64,AA", w: 200, h: 60 };
  const assets = { frame: null, scene: null, partnerLogo: null };
  const dims = { post: { w: 1080, h: 1350 }, tall: { w: 1080, h: 1620 }, story: { w: 1080, h: 1920 }, print: { w: 2550, h: 3300 } } as const;

  function plan(over: { design?: Record<string, unknown>; poster?: Record<string, unknown>; size?: keyof typeof dims; logo?: typeof logo | null } = {}) {
    const parsed = parseFlyerDesign(design({ ...over.design, size: over.size ?? "tall", poster: poster(over.poster) }));
    if (!parsed.ok) throw new Error(parsed.error);
    const d = parsed.design as FlyerDesign & { poster: PosterContent };
    return planPoster({ design: d, poster: d.poster, logo: over.logo === undefined ? logo : over.logo, assets }, dims[over.size ?? "tall"], artPack(d.poster.occasion, brand));
  }
  const off = { partner: { on: false }, subhead: "", slogan: "", stat: { on: false }, ribbon: { on: false }, agenda: [], paragraph: "", footer: "" };

  it("plans every section of the reference poster, at about its own size on the tall poster", () => {
    const p = plan();
    expect(Object.keys(p.heights).sort()).toEqual(["agenda", "header", "headline", "paragraph", "ribbon", "slogan", "stat", "subhead"].sort() as PosterSection[]);
    expect(p.k).toBeGreaterThan(0.85);
    expect(p.k).toBeLessThanOrEqual(1.08);
    expect(p.H).toBe(1620);
  });

  it("leaves out what is switched off or empty, and the rest closes up (a bigger scale, never a smaller one)", () => {
    const all = plan();
    const sections: [string, Record<string, unknown>, PosterSection][] = [
      ["the stat box", { stat: { on: false } }, "stat"],
      ["the ribbon", { ribbon: { on: false } }, "ribbon"],
      ["the agenda", { agenda: [] }, "agenda"],
      ["the paragraph", { paragraph: "" }, "paragraph"],
      ["the subhead", { subhead: "" }, "subhead"],
      ["the slogan", { slogan: "" }, "slogan"],
    ];
    for (const [what, over, section] of sections) {
      const p = plan({ poster: over });
      expect(p.heights[section], what).toBeUndefined();
      expect(p.k, what).toBeGreaterThanOrEqual(all.k);
    }
    // No logo and no partner: no header.
    expect(plan({ logo: null, poster: { partner: { on: false } } }).heights.header).toBeUndefined();
    expect(plan({ poster: { logo: false, partner: { on: false } } }).heights.header).toBeUndefined();
    // A partner alone (or the community's logo alone) keeps it.
    expect(plan({ logo: null, poster: { partner: { on: true, label: "JAINA", sub: "" } } }).heights.header).toBe(132);
    expect(plan({ poster: { partner: { on: false } } }).heights.header).toBe(132);
    // Nothing at all but the headline.
    expect(Object.keys(plan({ logo: null, poster: off }).heights)).toEqual(["headline"]);
  });

  it("a ribbon with no date, time or venue is left out even when switched on", () => {
    const p = plan({ design: { venue_line: "" }, poster: { ribbon: { on: true, date: "", time: "" } } });
    expect(p.heights.ribbon).toBeUndefined();
  });

  it("shrinks the stack to fit the longest content on every size and pack, and leaves out only what cannot fit", () => {
    const longest = {
      subhead: "x ".repeat(24).trim(),
      slogan: "word ".repeat(12).trim(),
      stat: { on: true, icon: "people", label: "MORE THAN", value: "100K+", caption: "caption words ".repeat(5).trim() },
      ribbon: { on: true, date: "Thursday, Sept 10 – Thursday, Sept 17", time: "6:00 PM–9:30 PM each evening" },
      agenda: Array.from({ length: 5 }, (_, i) => ({ icon: "clock", time: `${i + 5}:00–${i + 6}:00 PM`, text: "A long agenda line that wraps onto a second line of its own, for sure" })),
      paragraph: "A long paragraph. ".repeat(18).trim().slice(0, POSTER_LIMITS.paragraph),
    };
    for (const size of Object.keys(dims) as (keyof typeof dims)[]) {
      for (const occasion of FLYER_OCCASIONS) {
        const p = plan({ size, poster: { ...longest, occasion }, design: { headline: "Paryushan Mahaparva Pratikraman and Samvatsari Celebration for the Whole Jain Community".slice(0, 90) } });
        // The words never go below 57% of their usual size while a section can still be left out instead.
        expect(p.k, `${occasion} ${size}`).toBeGreaterThanOrEqual(0.57);
        expect(p.k, `${occasion} ${size}`).toBeLessThanOrEqual(1.08);
        expect(p.dropped.every((d, i) => d === ["paragraph", "slogan", "subhead", "stat"][i]), `${occasion} ${size}: ${p.dropped.join(",")}`).toBe(true);
        expect(p.sceneScale, `${occasion} ${size}`).toBeGreaterThanOrEqual(0.6);
        expect(p.top, `${occasion} ${size}`).toBeGreaterThan(0);
      }
    }
  });

  const manyRows = Array.from({ length: 5 }, (_, i) => ({ icon: "clock", time: `${i + 5}:00–${i + 6}:00 PM`, text: "A long agenda line that wraps onto a second line of its own, for sure" }));

  const crowded = {
    paragraph: "A long paragraph. ".repeat(18).trim().slice(0, POSTER_LIMITS.paragraph),
    slogan: "word ".repeat(12).trim(),
    subhead: "x ".repeat(24).trim(),
    stat: { on: true, icon: "people", label: "MORE THAN", value: "100K+", caption: "caption words ".repeat(5).trim() },
    agenda: manyRows,
  };

  it("leaves the least important sections out, in order, when a poster is too full for its size, and says so in plain English", () => {
    const p = plan({ size: "post", poster: crowded });
    expect(p.dropped[0]).toBe("paragraph");
    // What went is no longer planned for (the render tests check the footer is still on the page).
    for (const gone of p.dropped) expect(p.heights[gone], gone).toBeUndefined();
    const d = parseFlyerDesign(design({ size: "post", poster: poster(crowded) }));
    if (!d.ok || !d.design.poster) throw new Error("design");
    const notes = posterNotes({ design: d.design, poster: d.design.poster, brand, logo, assets }, dims.post);
    expect(notes[0]).toMatch(/^There was not room for the paragraph.* so (it was|they were) left out\. Shorten the text, switch a section off, or choose the Tall or Story size, which have more room\.$/);
    expect(SECTION_LABEL.paragraph).toBe("paragraph");
  });

  it("says nothing when the poster has room (the reference poster on Tall and Story)", () => {
    for (const size of ["tall", "story"] as const) {
      const d = parseFlyerDesign(design({ size }));
      if (!d.ok || !d.design.poster) throw new Error("design");
      const p = planPoster({ design: d.design, poster: d.design.poster, logo, assets }, dims[size], artPack("convention", brand));
      expect(p.dropped).toEqual([]);
      expect(posterNotes({ design: d.design, poster: d.design.poster, brand, logo, assets }, dims[size]), size).toEqual([]);
    }
  });

  it("says when the words are set small, and by how much", () => {
    const d = parseFlyerDesign(design({ size: "tall", poster: poster(crowded) }));
    if (!d.ok || !d.design.poster) throw new Error("design");
    const p = planPoster({ design: d.design, poster: d.design.poster, logo, assets }, dims.tall, artPack("convention", brand));
    const notes = posterNotes({ design: d.design, poster: d.design.poster, brand, logo, assets }, dims.tall);
    expect(p.k).toBeLessThan(0.7);
    expect(notes.join(" ")).toContain(`This poster is crowded, so its words are set small (${Math.round(p.k * 100)}% of the usual size).`);
  });

  it("gives the scene less room on a short poster than on a tall one", () => {
    expect(plan({ size: "post" }).sceneScale).toBeLessThan(plan({ size: "story" }).sceneScale);
  });

  it("reserves room above the footer for the RSVP card, which is big enough to scan (the first one was 120 units wide and could not be read below 900 pixels)", () => {
    expect(POSTER_UNITS.qrCard).toBeGreaterThan(250);
    for (const size of ["tall", "post", "story"] as const) {
      const withQr = plan({ size, design: { show_qr: true } });
      const without = plan({ size, design: { show_qr: false }, poster: { scene: { source: "none" } } });
      expect(withQr.reserve, size).toBeGreaterThanOrEqual(POSTER_UNITS.qrCard * Math.max(withQr.sceneScale, 0.8) + 18);
      expect(without.reserve, size).toBeLessThan(withQr.reserve);
    }
  });

  it("starts the words below a toran that hangs down the middle (Diwali, Mahavir)", () => {
    expect(plan({ poster: { occasion: "diwali" } }).top).toBeGreaterThan(plan({ poster: { occasion: "paryushan" } }).top);
  });
});

describe("estimating text", () => {
  it("is generous on purpose: capitals and wide letters take more room than narrow ones", () => {
    expect(textWidth("WWWW", 40)).toBeGreaterThan(textWidth("iiii", 40) * 2);
    expect(textWidth("ab cd", 40, { spacing: 5 })).toBeGreaterThan(textWidth("ab cd", 40));
    expect(textWidth("ab", 40, { caps: true })).toBeGreaterThan(textWidth("ab", 40));
    expect(textWidth("ab", 40, { serif: true })).toBeGreaterThan(textWidth("ab", 40));
  });

  it("counts lines: none for nothing, one when it fits, more when it wraps", () => {
    expect(lineCount("", 30, 800)).toBe(0);
    expect(lineCount("   ", 30, 800)).toBe(0);
    expect(lineCount("Short", 30, 800)).toBe(1);
    expect(lineCount("word ".repeat(60), 30, 800)).toBeGreaterThan(2);
  });

  it("counts lines word by word, the way the renderer wraps (an average over the whole text hides words that cannot sit side by side)", () => {
    // Each word is a little over half a line wide (560 of 1000): never two on a line, so four words take four lines. Dividing the
    // total width by the line width said three, and the poster's last lines ran into the footer.
    const word = "a".repeat(10);
    expect(textWidth(word, 100)).toBeGreaterThan(500);
    expect(textWidth(word, 100)).toBeLessThan(600);
    expect(lineCount(Array(4).fill(word).join(" "), 100, 1000)).toBe(4);
    // A word that fits the line by itself starts a new one rather than hanging over; short words pack into one.
    expect(lineCount("a b c d e f g h", 100, 1000)).toBe(1);
    expect(lineCount(`${word} ${"a".repeat(6)}`, 100, 1000)).toBe(1);
  });

  it("breaks a word that is wider than a whole line across lines, as the poster's word-break does, and counts the lines it takes", () => {
    expect(lineCount("a".repeat(40), 100, 1000)).toBe(3);
    // The pieces carry on into the next word.
    expect(lineCount(`${"a".repeat(40)} b`, 100, 1000)).toBe(3);
    // Spaces in the text collapse like they do on the page.
    expect(lineCount("  one   two  ", 30, 800)).toBe(1);
  });

  it("leaves a few percent of each line free, because the estimate of a word's width can be a few percent low (capitals)", () => {
    // 95% of a 1000-wide line: a text that is 98% of it wraps; one that is 90% of it does not.
    const w = (n: number) => textWidth("a".repeat(n), 100);
    expect(w(17)).toBeGreaterThan(950);
    expect(lineCount("a".repeat(17), 100, 1000)).toBeGreaterThan(1);
    expect(w(16)).toBeLessThan(950);
    expect(lineCount("a".repeat(16), 100, 1000)).toBe(1);
  });

  it("sets a short headline as big as possible on one line and gives a long one more lines at smaller sizes", () => {
    const short = headlineFit("JAINA 2027");
    expect(short.lines).toBe(1);
    expect(short.size).toBeGreaterThanOrEqual(120);
    expect(short.size).toBeLessThanOrEqual(142);
    const mid = headlineFit("Annual General Meeting");
    expect(mid.lines).toBeGreaterThanOrEqual(2);
    const long = headlineFit("Paryushan Mahaparva Pratikraman and Samvatsari Celebration for the Whole Jain Community");
    expect(long.lines).toBeGreaterThan(mid.lines - 1);
    expect(long.size).toBeLessThanOrEqual(mid.size);
    expect(long.size).toBeGreaterThanOrEqual(44);
  });

  it("sets a headline of long words smaller, on more lines, than its total width suggests (the headlines that overflowed the poster)", () => {
    // Four long words that cannot pair up on a line at the sizes the first estimate chose: three or four lines, never fewer than the words need.
    for (const h of [
      "Pathshala Orientation Registration Celebration",
      "Swamivatsalya Pratikraman Celebration Programme",
      "Samvatsari Pratikraman Kshamapana Celebration",
      "Diwali Annakut Mahotsav Celebration Programme",
    ]) {
      const fit = headlineFit(h);
      expect(fit.lines, h).toBeGreaterThanOrEqual(3);
      expect(fit.size, h).toBeLessThan(100);
      // Every word fits its line at that size (the real renderer is checked in tests/events-flyer-render.test.ts).
      for (const word of h.split(" ")) expect(textWidth(word, fit.size, { serif: true }), `${h}: ${word}`).toBeLessThanOrEqual(920);
    }
  });

  it("never sets a word wider than the line: a long single word makes the headline's type smaller until it fits on its line", () => {
    for (const word of ["Dasalakshanaparva", "Pratishthamahotsav", "Samvatsaripratikraman", "Mahamastakabhisheka", "SWAMIVATSALYA"]) {
      const fit = headlineFit(word);
      expect(fit.lines, word).toBe(1);
      expect(textWidth(word, fit.size, { serif: true }), word).toBeLessThanOrEqual(920);
      expect(fit.size, word).toBeGreaterThanOrEqual(44);
    }
    // A word that cannot fit even at the smallest size is broken, so the headline takes more lines, never overflows.
    const wide = headlineFit("Abcdefghijklmnopqrstuvwxyzabcdefghijklmn");
    expect(wide.size).toBe(44);
    expect(wide.lines).toBeGreaterThan(1);
  });

  it("sets every line of the partner badge as large as fits across the disc, and no larger than its usual size", () => {
    // A short acronym and a year barely need to give way.
    expect(badgeSizes("JAINA", "2027").sub).toBe(18);
    expect(badgeSizes("JAINA", "2027").label).toBeGreaterThan(20);
    const fits = (label: string, sub: string) => {
      const b = badgeSizes(label, sub);
      expect(b.label).toBeLessThanOrEqual(26);
      expect(b.sub).toBeLessThanOrEqual(18);
      expect(textWidth(label, b.label, { caps: true, serif: true, spacing: b.labelGap }), `${label}`).toBeLessThanOrEqual(92 + 0.5);
      if (sub) expect(textWidth(sub, b.sub, { caps: true, spacing: b.subGap }), `${sub}`).toBeLessThanOrEqual(92 + 0.5);
      return b;
    };
    // The default label, long ones, the widest letters, and a short acronym that keeps its full size.
    fits("PARTNER", "");
    fits("WELCOME", "2027");
    fits("FEDERATION", "OF JAINS");
    fits("MMMMMMMMMM", "WWWWWWWW");
    fits("Jaina", "Houston");
    expect(fits("YJP", "").label).toBe(26);
    // A longer line is smaller than a shorter one.
    expect(badgeSizes("FEDERATION", "").label).toBeLessThan(badgeSizes("JAINA", "").label);
    expect(badgeSizes("", "ABCDEFGH").sub).toBeLessThan(18);
  });

  it("lists every word on the poster, for choosing fonts", () => {
    const p = parsePosterContent(poster());
    const text = p.ok ? posterText(p.poster) : "";
    for (const word of ["JAINA", "HOUSTON", "80%", "Dinner", "Garba", "RSVP"]) expect(text).toContain(word);
  });
});
