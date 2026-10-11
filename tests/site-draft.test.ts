import { describe, expect, it } from "vitest";

import { readOwnCrawl } from "@/lib/site-draft/crawl";
import { generateDraft } from "@/lib/site-draft/generate";
import { parseStoredDraft, parseTheme, summarizeDraft } from "@/lib/site-draft/parse";
import { clockTime, cutText, joinWords, keepText, longDate, stripFooter, stripMenu, tidyTitle } from "@/lib/site-draft/text";
import { parseWeaverData } from "@/lib/site-draft/weaver";

import { JAIN, weaver, weaverJson } from "./fixtures/site-draft";
import { ownResult } from "./fixtures/site-found";

describe("Weaver's records", () => {
  it("are read field by field; a record that is not what was expected is dropped", () => {
    const w = parseWeaverData(weaverJson({ events: { on: true, items: [{ title: "No date" }, { title: "Real", starts_at: "2026-11-01T10:00:00Z" }] }, albums: [{ title: "" }, { title: "Real album", photos: "3" }] }))!;
    expect(w.events.items.map((e) => e.title)).toEqual(["Real"]);
    expect(w.albums).toEqual([{ title: "Real album", photos: 3 }]);
    expect(w.about).toBe("Maple Hall Community was started by a few families.\n\nToday it hosts classes, meals and celebrations.");
    expect(parseWeaverData(null)).toBeNull();
    expect(parseWeaverData({ center: { name: "" } })).toBeNull();
    expect(parseWeaverData(weaverJson({ profile: { social: { facebook: "javascript:alert(1)" }, latitude: 120, longitude: 10 } }))!.social).toEqual([]);
  });
});


describe("a stored draft is read back safely", () => {
  it("keeps what is well formed and drops the rest, and summarises each page", () => {
    const draft = generateDraft({ own: readOwnCrawl(JSON.parse(JSON.stringify(ownResult)))!, references: [], weaver: weaver(), kind: JAIN });
    const stored = {
      site: { name: draft.name, draft_version: 2, built_at: "2026-10-11T12:00:00Z", theme: draft.theme },
      pages: draft.pages.map((p, i) => ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        slug: p.slug,
        title: p.title,
        kind: p.kind,
        status: i === 0 ? "approved" : "draft",
        approved_at: i === 0 ? "2026-10-11T12:30:00Z" : null,
        source_path: p.source_path,
        blocks: [...p.blocks.map((b, j) => ({ ...b, id: `b${i}-${j}` })), { id: "bad", type: "hero", source: "written", content: { heading: "" } }, { id: "worse", type: "script", source: "written", content: {} }],
      })),
    };
    const parsed = parseStoredDraft(JSON.parse(JSON.stringify(stored)))!;
    expect(parsed.pages).toHaveLength(draft.pages.length);
    expect(parsed.pages[0]!.blocks).toHaveLength(draft.pages[0]!.blocks.length);
    expect(parsed.pages[0]!.status).toBe("approved");
    const s = summarizeDraft(parsed);
    expect(s.draftVersion).toBe(2);
    expect(s.pages[0]).toMatchObject({ slug: "home", status: "approved", blocks: draft.pages[0]!.blocks.length });
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft({ site: {}, pages: "x" })).toBeNull();
  });

  it("refuses a block kept from the old website that names no page, and a page address that is not a web address", () => {
    const base = { id: "b1", type: "text", content: { heading: "H", paragraphs: ["p"] }, needs_text: false };
    const page = (blocks: unknown[]) => ({ site: { name: "X", draft_version: 1, theme: {} }, pages: [{ id: "p1", slug: "home", title: "Home", kind: "home", status: "draft", blocks }] });
    expect(parseStoredDraft(page([{ ...base, source: "own_site", source_page: "javascript:alert(1)" }]))!.pages[0]!.blocks).toEqual([]);
    expect(parseStoredDraft(page([{ ...base, source: "own_site", source_page: "https://old.example.org/about" }]))!.pages[0]!.blocks).toHaveLength(1);
    expect(parseStoredDraft(page([{ ...base, source: "weaver_data", source_page: "https://leak.example.org" }]))!.pages[0]!.blocks[0]!.source_page).toBeNull();
  });

  it("repairs a theme that is not what was expected", () => {
    const t = parseTheme({ palette: { primary: "red; background:url(x)", text: "#12345" }, fonts: { heading: "Georgia; } body { display:none", body: "Lato" }, logo: { src: "javascript:alert(1)" }, hero_style: "huge" });
    expect(t.palette.primary).toBe("#1b2c5c");
    expect(t.palette.text).toBe("#1b1f23");
    expect(t.fonts).toEqual({ heading: null, body: "Lato" });
    expect(t.logo).toBeNull();
    expect(t.hero_style).toBe("text");
  });
});


describe("tidying the old website's words", () => {
  const menu = ["Home", "Our Story", "What's On", "Give"];
  it("takes the menu off the front of a page's text, glued or spaced, but not a word that only begins like a label", () => {
    expect(stripMenu("HomeOur StoryWhat's OnGive Our Story Grace was planted by families.", menu)).toBe("Grace was planted by families.");
    expect(stripMenu("Home Our Story Welcome to our house of prayer.", menu)).toBe("Welcome to our house of prayer.");
    expect(stripMenu("Homes for everyone start here.", menu)).toBe("Homes for everyone start here.");
    expect(stripMenu("Home page changes every week.", menu)).toBe("Home page changes every week.");
  });

  it("takes the footer off the end of a page's text, with the organization's name that heads it", () => {
    const text = "Sunday school runs during both services for children of every age. Grace Fellowship Church 78 Maple Ridge Drive, Maple Ridge © 2026";
    expect(stripFooter(text, ["78 Maple Ridge Drive, Maple Ridge"], ["Grace Fellowship Church"])).toBe("Sunday school runs during both services for children of every age.");
    expect(stripFooter("Short. © 2026 Grace", [], [])).toBe("Short. © 2026 Grace");
  });

  it("takes the organization's name off a page title", () => {
    expect(tidyTitle("Our Story — Grace Fellowship Church", ["Grace Fellowship Church"])).toBe("Our Story");
    expect(tidyTitle("Giving | Grace Fellowship Church", ["grace fellowship church"])).toBe("Giving");
    expect(tidyTitle("Grace Fellowship Church", ["Grace Fellowship Church"])).toBe("Grace Fellowship Church");
    expect(tidyTitle("Kids & Youth", ["Grace Fellowship Church"])).toBe("Kids & Youth");
  });

  it("repeats no heading at the start of a section and keeps nothing too short to be worth a block", () => {
    const body = "A home for worship, culture and service since the early years, open to every family in town.";
    expect(keepText("Welcome", `Welcome ${body}`)).toBe(body);
    expect(keepText("Our Pastors", "Our Pastors and Elders Rev. David Hall Lead Pastor Karen Wills Youth Pastor")).toMatch(/^Our Pastors and Elders/);
    expect(keepText("Hi", "Hi there")).toBe("");
  });

  it("cuts at the end of a sentence, and writes dates and times out in words", () => {
    expect(cutText("One sentence here. Another sentence follows it, and it is long enough to be cut off somewhere.", 30)).toBe("One sentence here.");
    expect(cutText("short", 40)).toBe("short");
    expect(longDate("2027-05-02")).toBe("May 2, 2027");
    expect(clockTime("00:30")).toBe("12:30 AM");
    expect(clockTime("12:00")).toBe("12:00 PM");
    expect(joinWords(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("a draft from a report with odd values", () => {
  const o = readOwnCrawl(JSON.parse(JSON.stringify(ownResult)))!;

  it("is read without the social link that is not a web address, the colour that is not a colour or the section kind Weaver does not know", () => {
    expect(o.social).toEqual([{ network: "facebook", url: "https://www.facebook.com/jshouston" }]);
    expect(o.palette.map((p) => p.hex)).toEqual(["#8c1c13", "#f4a300", "#ffffff", "#222222"]);
    expect(o.homePattern).toEqual(["header", "hero", "about", "events", "donate", "newsletter", "footer"]);
  });

  it("keeps the about page's own sentence with its page named, takes the logo from the header, and lets Weaver's contact details win", () => {
    const d = generateDraft({ own: o, references: [], weaver: weaver(), kind: JAIN });
    const about = d.pages.find((p) => p.kind === "about")!.blocks[0]!;
    expect(about).toMatchObject({ type: "text", source: "own_site", source_page: "https://www.jsh.example.org/about", needs_text: false });
    expect(about.type === "text" && about.content.paragraphs[0]).toBe("OWN-SITE-SENTENCE: everyone is welcome at our temple.");
    expect(d.theme.logo).toEqual({ src: "https://www.jsh.example.org/wp-content/logo.png", alt: "JSH logo" });
    expect(d.theme.palette).toMatchObject({ primary: "#8c1c13", secondary: "#f4a300", background: "#ffffff", text: "#222222", on_primary: "#ffffff" });
    expect(d.theme.hero_style).toBe("slider");
    const contact = d.pages.find((p) => p.kind === "contact")!.blocks[0]!;
    expect(contact.source).toBe("weaver_data");
    expect(contact.type === "contact" && contact.content.phones).toEqual(["(281) 555-0199"]);
  });

  it("drops the page built by scripts and the page the reader was unsure of", () => {
    const d = generateDraft({ own: o, references: [], weaver: weaver({ profile: {} }), kind: JAIN });
    const kept = d.pages.flatMap((p) => p.blocks).filter((b) => b.source === "own_site").map((b) => b.source_page);
    expect(kept).not.toContain("https://www.jsh.example.org/app/portal");
    expect(kept).not.toContain("https://www.jsh.example.org/spring-fair");
  });
});
