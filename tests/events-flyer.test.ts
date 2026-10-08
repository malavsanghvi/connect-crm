import { describe, expect, it } from "vitest";

import {
  FLYER_ART_BLOCKED_TERMS,
  FLYER_ART_GUARDRAIL,
  FLYER_LAYER_GUARDRAIL,
  buildFlyerArtPrompt,
  colorWord,
  defaultFlyerDesign,
  findBlockedArtTerm,
  firstSentence,
  fitFontSize,
  flyerDateLine,
  flyerFileName,
  flyerMadeFor,
  flyerOutOfDate,
  isFlyerArtPath,
  memberAppEventLink,
  outOfDateWhat,
  parseFlyerDesign,
  readArtJob,
  readFlyerMadeFor,
  readFlyerSource,
  withArtGuardrail,
  withLayerGuardrail,
} from "@/lib/events/flyer";
import { LOGO_NOTE, LOGO_WEBP_NOTE, flyerBrandSummary, logoTypeNote, readFlyerBrand } from "@/lib/events/flyer-brand";
import { patternSvg } from "@/lib/events/flyer-patterns";

import * as workerGuard from "../worker/src/flyer-guard";

const C = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";
const ART = `${C}/events/${E}/art-1759300000000.jpg`;

const design = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  template: "classic",
  size: "post",
  headline: "Diwali Mela",
  tagline: "An evening of lights.",
  date_line: "Sat, Nov 8 · 6:00 PM–9:00 PM",
  venue_line: "Main hall",
  show_qr: true,
  background: { source: "pattern", pattern: "diya" },
  ...over,
});

describe("parseFlyerDesign", () => {
  it("accepts a complete design and tidies its text", () => {
    const r = parseFlyerDesign(design({ headline: "  Diwali\nMela  " }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.design.headline).toBe("Diwali Mela");
      expect(r.design.v).toBe(1);
      expect(r.design.background).toEqual({ source: "pattern", pattern: "diya" });
    }
  });

  it("checks every limit with a plain sentence", () => {
    expect(parseFlyerDesign(design({ headline: "" }))).toEqual({ ok: false, error: "The headline is required." });
    expect(parseFlyerDesign(design({ headline: "x".repeat(91) }))).toEqual({ ok: false, error: "The headline is longer than 90 characters." });
    expect(parseFlyerDesign(design({ headline: "x".repeat(90) })).ok).toBe(true);
    expect(parseFlyerDesign(design({ tagline: "x".repeat(181) }))).toEqual({ ok: false, error: "The tagline is longer than 180 characters." });
    expect(parseFlyerDesign(design({ date_line: "x".repeat(91) }))).toEqual({ ok: false, error: "The date line is longer than 90 characters." });
    expect(parseFlyerDesign(design({ venue_line: "x".repeat(121) }))).toEqual({ ok: false, error: "The venue line is longer than 120 characters." });
    expect(parseFlyerDesign(design({ tagline: "", date_line: "", venue_line: "" })).ok).toBe(true);
  });

  it("counts letters as people do, not UTF-16 units", () => {
    expect(parseFlyerDesign(design({ headline: "દિવાળી ".repeat(12).trim() })).ok).toBe(true);
  });

  it("refuses unknown templates, sizes and backgrounds", () => {
    expect(parseFlyerDesign(design({ template: "neon" }))).toEqual({ ok: false, error: "Choose a template: Poster, Classic, Festival, Minimal or Photo." });
    expect(parseFlyerDesign(design({ size: "a3" }))).toEqual({ ok: false, error: "Choose a size: Post, Tall, Story or Print." });
    expect(parseFlyerDesign(design({ background: { source: "pattern", pattern: "paisley" } })).ok).toBe(false);
    expect(parseFlyerDesign(design({ background: { source: "photo", photo_id: "nope" } })).ok).toBe(false);
    expect(parseFlyerDesign(design({ background: { source: "ai", path: "https://evil.example/x.jpg", prompt: "" } })).ok).toBe(false);
    expect(parseFlyerDesign(design({ background: { source: "web" } })).ok).toBe(false);
    expect(parseFlyerDesign(null).ok).toBe(false);
    expect(parseFlyerDesign([]).ok).toBe(false);
    expect(parseFlyerDesign(design({ v: 2 })).ok).toBe(false);
  });

  it("needs a photo or AI art for the Photo template", () => {
    expect(parseFlyerDesign(design({ template: "photo" }))).toEqual({ ok: false, error: "The Photo template needs a photo or AI art background." });
    expect(parseFlyerDesign(design({ template: "photo", background: { source: "plain" } })).ok).toBe(false);
    expect(parseFlyerDesign(design({ template: "photo", background: { source: "photo", photo_id: E } })).ok).toBe(true);
    expect(parseFlyerDesign(design({ template: "photo", background: { source: "ai", path: ART, prompt: "Soft mandala" } })).ok).toBe(true);
  });

  it("reads show_qr strictly", () => {
    const r = parseFlyerDesign(design({ show_qr: "yes" }));
    expect(r.ok && r.design.show_qr).toBe(false);
  });
});

describe("firstSentence", () => {
  it("cuts at the first sentence end followed by a space", () => {
    expect(firstSentence("An evening of lights. Food, music and garba follow!")).toBe("An evening of lights.");
    expect(firstSentence("Join us! It is free.")).toBe("Join us!");
    expect(firstSentence("Version 2.0 is out")).toBe("Version 2.0 is out");
  });

  it("keeps short text whole and cuts long text at a word boundary with an ellipsis", () => {
    expect(firstSentence("A gathering for everyone")).toBe("A gathering for everyone");
    const long = firstSentence("word ".repeat(60), 40);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).not.toMatch(/\s…$/);
    expect(firstSentence("", 40)).toBe("");
    expect(firstSentence(null)).toBe("");
  });
});

describe("flyerDateLine", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("is the date, then the start and end times, in the community's zone", () => {
    expect(flyerDateLine("2026-11-08T00:00:00Z", "2026-11-08T03:00:00Z", "America/Chicago", now)).toBe("Sat, Nov 7 · 6:00 PM–9:00 PM");
    expect(flyerDateLine("2026-11-08T18:00:00Z", null, "UTC", now)).toBe("Sun, Nov 8 · 6:00 PM");
  });

  it("is empty without a start", () => {
    expect(flyerDateLine(null, null, "UTC")).toBe("");
  });
});

describe("defaultFlyerDesign", () => {
  const base = { description: "An evening of lights. Bring your family.", venue: "JSH temple hall", startsAt: "2026-11-08T00:00:00Z", endsAt: null, tz: "UTC" };
  it("starts as a Poster at its own 2:3 size, from the event's own words, with a motif chosen from the name", () => {
    const d = defaultFlyerDesign({ ...base, name: "Diwali Mela 2026", qrAvailable: true });
    expect(d).toMatchObject({ v: 1, template: "poster", size: "tall", headline: "Diwali Mela 2026", tagline: "An evening of lights.", venue_line: "JSH temple hall", show_qr: true });
    expect(d.poster).toMatchObject({ occasion: "diwali", frame: { source: "code" }, scene: { source: "code" } });
    expect(d.background).toEqual({ source: "pattern", pattern: "diya" });
    expect(d.date_line).toContain("Nov 8");
    expect(parseFlyerDesign(d).ok).toBe(true);
  });

  it("picks lotus for Paryushan and Samvatsari, rangoli for Navratri, mandala otherwise", () => {
    const motif = (name: string) => {
      const bg = defaultFlyerDesign({ ...base, name, qrAvailable: false }).background;
      return bg.source === "pattern" ? bg.pattern : null;
    };
    expect(motif("Paryushan Parva")).toBe("lotus");
    expect(motif("Samvatsari Pratikraman")).toBe("lotus");
    expect(motif("Navratri Garba Night")).toBe("rangoli");
    expect(motif("Annual picnic")).toBe("mandala");
  });

  it("follows whether a QR link exists", () => {
    expect(defaultFlyerDesign({ ...base, name: "Picnic", qrAvailable: false }).show_qr).toBe(false);
  });

  it("never produces a design its own parser refuses", () => {
    const d = defaultFlyerDesign({ ...base, name: "x".repeat(200), description: "y".repeat(500), venue: "z".repeat(300), qrAvailable: true });
    expect(parseFlyerDesign(d).ok).toBe(true);
    expect(defaultFlyerDesign({ ...base, name: "  ", qrAvailable: true }).headline).toBe("Upcoming event");
  });
});

describe("AI background art", () => {
  it("the art prompt never contains the event name and passes the guardrail check", () => {
    const p = buildFlyerArtPrompt({ eventName: "Mahavir Jayanti", primary: "#1B2C5C", accent: "#C9731C" });
    expect(p.toLowerCase()).not.toContain("mahavir");
    expect(p.toLowerCase()).not.toContain("jayanti");
    expect(findBlockedArtTerm(p)).toBeNull();
    expect(p).toContain("navy");
    expect(p).toContain("saffron");
    const sent = withArtGuardrail(p);
    expect(sent.split(FLYER_ART_GUARDRAIL).length - 1).toBe(1);
    expect(sent.startsWith(p)).toBe(true);
    expect(buildFlyerArtPrompt({ eventName: "Diwali", primary: "#1B2C5C", accent: "#C9731C" })).toMatch(/oil lamps/);
  });

  it("finds people, deities and lettering, as typed", () => {
    expect(findBlockedArtTerm("A portrait of Mahavir")).toBe("portrait");
    expect(findBlockedArtTerm("Mahavir in gold")).toBe("Mahavir");
    expect(findBlockedArtTerm("a murti with flowers")).toBe("murti");
    expect(findBlockedArtTerm("happy people")).toBe("people");
    expect(findBlockedArtTerm("Happy Diwali text")).toBe("text");
    expect(findBlockedArtTerm("gold LETTERS")).toBe("LETTERS");
  });

  it("finds plurals and the names this community would type", () => {
    expect(findBlockedArtTerm("goddesses in a garden")).toBe("goddesses");
    expect(findBlockedArtTerm("tirthankaras in a row")).toBe("tirthankaras");
    expect(findBlockedArtTerm("sadhus walking")).toBe("sadhus");
    expect(findBlockedArtTerm("the 24 Jinas")).toBe("Jinas");
    expect(findBlockedArtTerm("garba dancers in a circle")).toBe("dancers");
    expect(findBlockedArtTerm("Durga and Amba for Navratri")).toBe("Durga");
    expect(findBlockedArtTerm("Ambe Mataji aarti")).toBe("Ambe");
    expect(findBlockedArtTerm("Mataji")).toBe("Mataji");
    expect(findBlockedArtTerm("Padmavati devi")).toBe("Padmavati");
    expect(findBlockedArtTerm("devotees with diyas")).toBe("devotees");
    expect(findBlockedArtTerm("two gurus")).toBe("gurus");
  });

  it("does not flag ornament words that only contain a blocked word", () => {
    for (const ok of [
      "lotus petals",
      "diya flames",
      "a mandala",
      "mandalas and lotuses",
      "in context",
      "Paryushan",
      "rangoli dots",
      "surface texture",
      "manuscript borders",
      "goldenrod",
      "amber glow",
      "ambient light",
      "community colours",
      "crystal facets",
      "dance of light",
    ]) {
      expect(findBlockedArtTerm(ok), ok).toBeNull();
    }
  });

  it("ignores the guardrail's own words", () => {
    expect(findBlockedArtTerm(FLYER_ART_GUARDRAIL)).toBeNull();
    expect(findBlockedArtTerm(withArtGuardrail("Soft lotus pattern"))).toBeNull();
  });

  it("adds the guardrail once, idempotently, and never cuts it", () => {
    const once = withArtGuardrail("Soft lotus pattern");
    expect(withArtGuardrail(once)).toBe(once);
    expect(withArtGuardrail("")).toBe(FLYER_ART_GUARDRAIL);
    const long = withArtGuardrail("petal ".repeat(500));
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long.endsWith(FLYER_ART_GUARDRAIL)).toBe(true);
  });

  it("holds exactly the worker's blocked words and guardrail", () => {
    expect([...FLYER_ART_BLOCKED_TERMS]).toEqual([...workerGuard.FLYER_ART_BLOCKED_TERMS]);
    expect(FLYER_ART_GUARDRAIL).toBe(workerGuard.FLYER_ART_GUARDRAIL);
    expect(FLYER_LAYER_GUARDRAIL).toBe(workerGuard.FLYER_LAYER_GUARDRAIL);
    for (const t of ["Portrait of Bhagwan", "lotus", "text and letters", "garba dancers", "amber glow", withArtGuardrail("soft mandala"), withLayerGuardrail("soft mandala")]) {
      expect(findBlockedArtTerm(t)).toBe(workerGuard.findBlockedArtTerm(t));
      expect(withArtGuardrail(t)).toBe(workerGuard.withArtGuardrail(t));
      expect(withLayerGuardrail(t)).toBe(workerGuard.withLayerGuardrail(t));
    }
  });

  it("knows this event's art files", () => {
    expect(isFlyerArtPath(ART, C, E)).toBe(true);
    expect(isFlyerArtPath(`${C}/events/${E}/flyer-1.png`, C, E)).toBe(false);
    expect(isFlyerArtPath(`${C}/events/${C}/art-1.jpg`, C, E)).toBe(false);
    expect(isFlyerArtPath(`${C}/events/${E}/art-1.webp`, C, E)).toBe(false);
  });
});

describe("flyerOutOfDate", () => {
  const ev = { starts_at: "2026-11-08T23:00:00+00:00", ends_at: "2026-11-09T02:00:00+00:00", venue: "Main hall" };
  const saved = { ...design(), made_for: flyerMadeFor(ev) };

  it("records the event's start, end and venue, and the design parser leaves them out", () => {
    expect(flyerMadeFor({ ...ev, venue: "  Main   hall " })).toEqual({ starts_at: ev.starts_at, ends_at: ev.ends_at, venue: "Main hall" });
    expect(flyerMadeFor({ starts_at: "not a date", ends_at: null, venue: null })).toEqual({ starts_at: null, ends_at: null, venue: "" });
    expect(readFlyerMadeFor(saved)).toEqual(flyerMadeFor(ev));
    const parsed = parseFlyerDesign(saved);
    expect(parsed.ok && "made_for" in parsed.design).toBe(false);
  });

  it("is not out of date while the event is unchanged, whatever the time zone of the stored times", () => {
    expect(flyerOutOfDate(saved, ev)).toEqual({ date: false, venue: false });
    expect(flyerOutOfDate(saved, { ...ev, starts_at: "2026-11-08T17:00:00-06:00" })).toEqual({ date: false, venue: false });
    expect(flyerOutOfDate(saved, { ...ev, venue: "Main  hall " })).toEqual({ date: false, venue: false });
  });

  it("says which of the date and venue changed after the flyer was made", () => {
    expect(flyerOutOfDate(saved, { ...ev, starts_at: "2026-11-15T23:00:00+00:00" })).toEqual({ date: true, venue: false });
    expect(flyerOutOfDate(saved, { ...ev, ends_at: null })).toEqual({ date: true, venue: false });
    expect(flyerOutOfDate(saved, { ...ev, venue: "Upashray" })).toEqual({ date: false, venue: true });
    expect(outOfDateWhat(flyerOutOfDate(saved, { ...ev, starts_at: null, venue: null }))).toBe("date and venue");
    expect(outOfDateWhat({ date: false, venue: true })).toBe("venue");
    expect(outOfDateWhat({ date: false, venue: false })).toBeNull();
  });

  it("flags nothing for a design with no record of what it was made for", () => {
    expect(readFlyerMadeFor(design())).toBeNull();
    expect(readFlyerMadeFor(null)).toBeNull();
    expect(flyerOutOfDate(design(), { ...ev, venue: "Elsewhere" })).toEqual({ date: false, venue: false });
  });
});

describe("readArtJob", () => {
  it("reads the image bytes, or the stored file once the portal kept it", () => {
    expect(readArtJob({ status: "done", result: { image_b64: "ZmFrZQ==", content_type: "image/jpeg", prompt: "p" } })).toEqual({
      status: "image",
      imageB64: "ZmFrZQ==",
      contentType: "image/jpeg",
      prompt: "p",
      layer: null,
    });
    expect(readArtJob({ status: "done", result: { stored_path: ART, prompt: "p" } })).toEqual({ status: "stored", storedPath: ART, prompt: "p", layer: null });
    expect(readArtJob({ status: "done", result: { stored_path: ART, image_b64: "x" } })).toMatchObject({ status: "stored" });
  });

  it("reads waiting, failure and nothing", () => {
    expect(readArtJob({ status: "queued", job_id: "4" })).toEqual({ status: "queued" });
    expect(readArtJob({ status: "running" })).toEqual({ status: "running" });
    expect(readArtJob({ status: "unavailable", reason: "Off" })).toEqual({ status: "unavailable", reason: "Off" });
    expect(readArtJob({ status: "failed", error: "Gemini had a problem (HTTP 500)" })).toEqual({ status: "failed", reason: "Gemini had a problem (HTTP 500)" });
    expect(readArtJob({ status: "done", result: {} })).toMatchObject({ status: "failed" });
    expect(readArtJob({ status: "missing" })).toMatchObject({ status: "failed" });
    expect(readArtJob({ status: "none" })).toEqual({ status: "none" });
    expect(readArtJob(null)).toEqual({ status: "none" });
  });
});

describe("readFlyerSource", () => {
  it("accepts designed, manual and ai", () => {
    expect(readFlyerSource("designed")).toBe("designed");
    expect(readFlyerSource("manual")).toBe("manual");
    expect(readFlyerSource("ai")).toBe("ai");
    expect(readFlyerSource("other")).toBeNull();
    expect(readFlyerSource(null)).toBeNull();
  });
});

describe("small helpers", () => {
  it("names the downloaded file after the event and size", () => {
    expect(flyerFileName("Diwali Mela", "post", "png")).toBe("diwali-mela-flyer-post.png");
    expect(flyerFileName("Paryushan Parva — Day 1!", "print", "pdf")).toBe("paryushan-parva-day-1-flyer-print.pdf");
    expect(flyerFileName("દિવાળી", "story", "png")).toBe("event-flyer-story.png");
  });

  it("builds the member app link only from an http(s) address", () => {
    expect(memberAppEventLink("https://app.jsh.org/", E)).toBe(`https://app.jsh.org/e/${E}`);
    expect(memberAppEventLink("http://localhost:8081", E)).toBe(`http://localhost:8081/e/${E}`);
    expect(memberAppEventLink("", E)).toBeNull();
    expect(memberAppEventLink(undefined, E)).toBeNull();
    expect(memberAppEventLink("javascript:alert(1)", E)).toBeNull();
    expect(memberAppEventLink("app.jsh.org", E)).toBeNull();
  });

  it("names colours for a prompt", () => {
    expect(colorWord("#1B2C5C")).toBe("deep navy");
    expect(colorWord("#C9731C")).toBe("saffron");
    expect(colorWord("#FBF7F0")).toBe("ivory cream");
    expect(colorWord("#1F7A4D")).toBe("emerald green");
    expect(colorWord("not a colour")).toBe("warm");
  });

  it("shrinks long text, but never below 55% of the base size", () => {
    expect(fitFontSize("Diwali Mela", 30, 92)).toBe(92);
    const longer = fitFontSize("x".repeat(60), 30, 92);
    expect(longer).toBeLessThan(92);
    expect(longer).toBeGreaterThan(fitFontSize("x".repeat(90), 30, 92));
    expect(fitFontSize("x".repeat(900), 30, 92)).toBeCloseTo(92 * 0.55, 1);
    // Capitals take about a third more room, and a lower floor can be asked for.
    expect(fitFontSize("x".repeat(30), 30, 92)).toBe(92);
    expect(fitFontSize("X".repeat(30), 30, 92)).toBeLessThan(92);
    expect(fitFontSize("x".repeat(900), 30, 92, 0.5)).toBeCloseTo(46, 1);
  });
});

describe("patternSvg", () => {
  for (const kind of ["lotus", "rangoli", "diya", "mandala"] as const) {
    it(`${kind}: a complete SVG in the brand colours, with no text`, () => {
      const svg = patternSvg(kind, { w: 1080, h: 1350, primary: "#123456", accent: "#ABCDEF", background: "#FEFEFE" });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain('viewBox="0 0 1080 1350"');
      expect(svg).not.toMatch(/<text/i);
      expect(svg).toContain("#123456");
      expect(svg).toContain("#ABCDEF");
      expect(svg).toContain("#FEFEFE");
      expect(svg.length).toBeLessThan(200_000);
    });
  }

  it("refuses colours that are not hex codes (no markup can be injected)", () => {
    const svg = patternSvg("mandala", { w: 100, h: 100, primary: '"/><script>', accent: "red", background: "#FFF" });
    expect(svg).not.toContain("<script");
    expect(svg).toContain("#1B2C5C");
  });

  it("can leave out its own background", () => {
    expect(patternSvg("lotus", { w: 100, h: 100, primary: "#123456", accent: "#ABCDEF", background: "#FEFEFE", transparent: true })).not.toContain("#FEFEFE");
  });
});

describe("readFlyerBrand", () => {
  const url = "https://abc.supabase.co";
  it("falls back to the Weaver defaults", () => {
    expect(readFlyerBrand(null, url)).toEqual({
      primary: "#1B2C5C",
      accent: "#C9731C",
      background: "#FBF7F0",
      displayFont: "Fraunces",
      bodyFont: "DM Sans",
      logoUrl: null,
      logoDarkUrl: null,
      markUrl: null,
    });
  });

  it("reads colours, fonts and brand-kit files as public branding-bucket URLs", () => {
    const b = readFlyerBrand(
      { primary: "#7a2e1f", accent: "C9731C", background: "#ffffff", display_font: "Playfair Display", body_font: "Inter", logo_path: `${C}/logo.png`, logo_dark_path: `${C}/logo-dark.png` },
      url,
    );
    expect(b.primary).toBe("#7A2E1F");
    expect(b.accent).toBe("#C9731C");
    expect(b.displayFont).toBe("Playfair Display");
    expect(b.bodyFont).toBe("Inter");
    expect(b.logoUrl).toBe(`${url}/storage/v1/object/public/branding/${C}/logo.png`);
    expect(b.logoDarkUrl).toBe(`${url}/storage/v1/object/public/branding/${C}/logo-dark.png`);
    expect(flyerBrandSummary(b)).toBe("Using your brand kit: #7A2E1F / #C9731C · Playfair Display + Inter · logo");
  });

  it("prefers the logo, then its URL, then the mark; https only", () => {
    expect(readFlyerBrand({ logo_url: "https://cdn.example.org/logo.svg", mark_path: `${C}/mark.png` }, url).logoUrl).toBe("https://cdn.example.org/logo.svg");
    expect(readFlyerBrand({ mark_path: `${C}/mark.png` }, url).logoUrl).toBe(`${url}/storage/v1/object/public/branding/${C}/mark.png`);
    expect(readFlyerBrand({ logo_url: "http://cdn.example.org/logo.svg" }, url).logoUrl).toBeNull();
    expect(readFlyerBrand({ mark_url: "https://cdn.example.org/mark.png" }, url).logoUrl).toBe("https://cdn.example.org/mark.png");
    expect(readFlyerBrand({ logo_path: `${C}/../x.png` }, url).logoUrl).toBeNull();
    expect(readFlyerBrand({ logo_path: `${C}/logo.png` }, undefined).logoUrl).toBeNull();
    expect(readFlyerBrand({ logo_path: `${C}/logo.webp`, mark_path: `${C}/mark.png` }, url).markUrl).toBe(`${url}/storage/v1/object/public/branding/${C}/mark.png`);
  });

  it("says what to do when the logo is a WebP file the flyer maker can't draw", () => {
    for (const ok of ["image/png", "image/jpeg", "image/svg+xml"]) expect(logoTypeNote(ok)).toBeNull();
    expect(logoTypeNote("image/webp")).toBe(LOGO_WEBP_NOTE);
    expect(LOGO_WEBP_NOTE).toMatch(/WebP.*upload a PNG or SVG version in Setup › Profile & brand/);
    expect(logoTypeNote("image/heic")).toBe(LOGO_NOTE);
    expect(logoTypeNote(null)).toBe(LOGO_NOTE);
  });

  it("refuses font names that could not be a font family", () => {
    expect(readFlyerBrand({ display_font: "Comic'); drop", body_font: "x".repeat(41) }, url)).toMatchObject({ displayFont: "Fraunces", bodyFont: "DM Sans" });
    expect(readFlyerBrand({ primary: "navy" }, url).primary).toBe("#1B2C5C");
  });
});
