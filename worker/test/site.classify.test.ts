import { describe, expect, it } from "vitest";

import { classifyPage, kindOfLabel, type PageSignals } from "../src/web/site/classify";
import { extractPage } from "../src/web/site/extract";
import { ordinaryPages, SITES } from "./site-fixtures";

const base: PageSignals = {
  path: "/", title: "", h1: "", headings: [], description: "", isStart: false, eventCount: 0, donateLinkCount: 0, formCount: 0, hasCalendarEmbed: false,
  imageCount: 0, textChars: 800, hasContactDetails: false, personBlocks: 0, isPost: false, amountMentions: 0, jsonLdTypes: [],
};
const classify = (over: Partial<PageSignals>) => classifyPage({ ...base, ...over });

describe("classifyPage: the signals", () => {
  it("reads the address first: the last part counts most", () => {
    expect(classify({ path: "/events" }).kind).toBe("events");
    expect(classify({ path: "/about-us/history" }).kind).toBe("about");
    expect(classify({ path: "/events/diwali-gala" }).kind).toBe("events");
    expect(classify({ path: "/panchang-calendar" }).kind).toBe("calendar");
    expect(classify({ path: "/give" }).kind).toBe("donate");
    expect(classify({ path: "/board-of-trustees" }).kind).toBe("leadership");
    expect(classify({ path: "/pathshala" }).kind).toBe("school");
  });
  it("calls the root and the start page home, and a language folder too", () => {
    expect(classify({ path: "/" }).kind).toBe("home");
    expect(classify({ path: "/en" }).kind).toBe("home");
    expect(classify({ path: "/welcome-to-our-site", isStart: true }).kind).toBe("home");
  });
  it("uses the page's own heading and title when the address says nothing", () => {
    expect(classify({ path: "/page-12", h1: "Upcoming events and festivals" }).kind).toBe("events");
    expect(classify({ path: "/p/7", title: "Meet our board of trustees", h1: "Our Team" }).kind).toBe("leadership");
  });
  it("uses what is on the page: dates, an embedded calendar, many photos, a row of people, a dated address", () => {
    expect(classify({ path: "/x1", eventCount: 5 }).kind).toBe("events");
    expect(classify({ path: "/x2", hasCalendarEmbed: true }).kind).toBe("calendar");
    expect(classify({ path: "/x3", imageCount: 24, textChars: 600 }).kind).toBe("gallery");
    expect(classify({ path: "/x4", personBlocks: 6 }).kind).toBe("leadership");
    expect(classify({ path: "/2026/03/spring-service" }).kind).toBe("news");
    expect(classify({ path: "/pages/8", isPost: true }).kind).toBe("news");
    expect(classify({ path: "/?page_id=212", h1: "Upcoming events" }).kind).toBe("events");
    expect(classify({ path: "/page-id-42", h1: "Daily Aarti and Darshan Times" }).kind).toBe("calendar");
  });
  it("says 'other' with a low confidence when nothing points anywhere, and names what it saw", () => {
    const c = classify({ path: "/privacy-policy", title: "Privacy policy", h1: "Privacy policy" });
    expect(c.kind).toBe("other");
    expect(c.confidence).toBeLessThan(0.5);
    const e = classify({ path: "/events" });
    expect(e.reasons).toContain("path:events");
    expect(e.confidence).toBeGreaterThan(0.5);
  });
  it("is less sure when two kinds are close, and names the runner-up", () => {
    const c = classify({ path: "/events-calendar" });
    expect(["events", "calendar"]).toContain(c.kind);
    expect(c.runner_up).not.toBeNull();
    expect(c.confidence).toBeLessThan(0.5);
  });
  it("reads a menu label as a kind (how the reference mode keeps a menu without its words)", () => {
    expect(kindOfLabel("Home")).toBe("home");
    expect(kindOfLabel("About Us")).toBe("about");
    expect(kindOfLabel("Give")).toBe("donate");
    expect(kindOfLabel("Upcoming Events")).toBe("events");
    expect(kindOfLabel("Kids & Youth")).toBe("school");
    expect(kindOfLabel("Resources")).toBe("other");
  });
});

describe("classifyPage: accuracy on the four invented sites", () => {
  const rows = SITES.flatMap((site) =>
    ordinaryPages(site).map((p) => {
      const facts = extractPage(p.html, p.url, { isStart: p.path === "/" });
      return { site, file: p.file, want: p.kind, got: facts.classification.kind, confidence: facts.classification.confidence };
    }),
  );
  it("gets at least 90% of the pages right, and every site above 80%", () => {
    const right = rows.filter((r) => r.got === r.want).length;
    const wrong = rows.filter((r) => r.got !== r.want).map((r) => `${r.site}/${r.file}: wanted ${r.want}, got ${r.got}`);
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(right / rows.length, `wrong: ${wrong.join("; ")}`).toBeGreaterThanOrEqual(0.9);
    for (const site of SITES) {
      const mine = rows.filter((r) => r.site === site);
      expect(mine.filter((r) => r.got === r.want).length / mine.length, `${site}: ${wrong.filter((w) => w.startsWith(site)).join("; ")}`).toBeGreaterThan(0.8);
    }
  });
  it("finds every kind on at least two sites, so the check is not one site's habit", () => {
    for (const kind of ["home", "about", "events", "calendar", "donate", "contact", "school", "gallery", "news", "leadership", "membership"]) {
      const sites = new Set(rows.filter((r) => r.want === kind).map((r) => r.site));
      expect(sites.size, kind).toBeGreaterThanOrEqual(2);
    }
  });
  it("is confident about the pages it gets right more often than not", () => {
    const right = rows.filter((r) => r.got === r.want && r.want !== "other");
    expect(right.filter((r) => r.confidence >= 0.5).length / right.length).toBeGreaterThan(0.8);
  });
});
