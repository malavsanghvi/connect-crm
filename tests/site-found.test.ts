import { describe, expect, it } from "vitest";

import {
  GIVE_UP_AFTER_MS,
  STALE_MS,
  buildFoundView,
  checkSiteInputs,
  cleanSiteAddress,
  confidenceWords,
  contrastWords,
  describeNotes,
  hostKey,
  isBusy,
  jobLine,
  nextPollDelay,
  onSite,
  parseSiteStatus,
  readIsCurrent,
  savedSlots,
  type OwnView,
  type ReferenceView,
  type SiteJob,
} from "@/lib/site-found";

import { hostileReferenceResult, ownResult, referenceResult } from "./fixtures/site-found";

const bad = (raw: string) => {
  const r = cleanSiteAddress(raw);
  if (r.ok) throw new Error(`expected "${raw}" to be refused`);
  return r.error;
};

describe("one website address (the same answers as app.site_clean_address, migration 0640)", () => {
  it("reads a bare name as https and leaves a good address alone", () => {
    expect(cleanSiteAddress("www.example.org")).toEqual({ ok: true, address: "https://www.example.org" });
    expect(cleanSiteAddress("  http://example.org/about  ")).toEqual({ ok: true, address: "http://example.org/about" });
    expect(cleanSiteAddress("example.org:8080/x")).toEqual({ ok: true, address: "https://example.org:8080/x" });
    expect(cleanSiteAddress("https://xn--80aswg.xn--p1ai")).toEqual({ ok: true, address: "https://xn--80aswg.xn--p1ai" });
  });
  it("treats a blank as no address", () => {
    expect(cleanSiteAddress("   ")).toEqual({ ok: true, address: null });
    expect(cleanSiteAddress("")).toEqual({ ok: true, address: null });
  });
  it("allows only http and https", () => {
    expect(bad("ftp://example.org")).toMatch(/must start with http/);
    expect(bad("javascript:alert(1)")).toMatch(/not a website address/);
    expect(bad("mailto:a@example.org")).toMatch(/not a website address/);
    expect(bad("file:///etc/passwd")).toMatch(/must start with http/);
    expect(bad("data:text/html,hello")).toMatch(/not a website address/);
  });
  it("refuses private and internal addresses, numbers, user names and spaces", () => {
    for (const raw of ["http://localhost:3000", "http://127.0.0.1/", "http://10.0.0.5/admin", "http://192.168.1.1", "http://169.254.169.254/latest", "http://intranet/", "https://printer.local", "https://wiki.internal/home", "http://2130706433/", "https://router.lan", "https://x.localhost"]) {
      expect(bad(raw), raw).toMatch(/private network/);
    }
    expect(bad("http://[::1]/")).toMatch(/not a website address/);
    expect(bad("http://[fd00::1]:8080/")).toMatch(/not a website address/);
    expect(bad("https://admin:pw@example.org")).toMatch(/user name or password/);
    expect(bad("https://exa mple.org")).toMatch(/has a space/);
    expect(bad("https://example.org:99999")).toMatch(/port number/);
    expect(bad("https://-bad-.org")).toMatch(/not a website name/);
    expect(bad(`https://${"a".repeat(2001)}.org`)).toMatch(/too long/);
  });
  it("says which website an address is on, ignoring www and the page", () => {
    expect(hostKey("https://WWW.Example.org/about")).toBe("example.org");
    expect(hostKey("http://example.org:8080")).toBe("example.org");
    expect(onSite("https://cdn.example.org/logo.png", "example.org")).toBe(true);
    expect(onSite("https://www.example.org/logo.png", "example.org")).toBe(true);
    expect(onSite("https://example.org.evil.net/logo.png", "example.org")).toBe(false);
    expect(onSite("https://evil-example.org/logo.png", "example.org")).toBe(false);
    expect(onSite("https://example.org/logo.png", "")).toBe(false);
  });
});

describe("the organization's website and the ones it likes", () => {
  it("accepts an own website with up to three liked ones and returns the strings as typed (the database writes the final form)", () => {
    const r = checkSiteInputs(" www.example.org ", ["https://one.example.net", "two.example.net", " ", "https://three.example.net/x"]);
    expect(r).toEqual({ ok: true, own: "www.example.org", refs: ["https://one.example.net", "two.example.net", "https://three.example.net/x"] });
  });
  it("allows nothing at all, only the organization's own website, or only liked ones", () => {
    expect(checkSiteInputs("", [])).toEqual({ ok: true, own: "", refs: [] });
    expect(checkSiteInputs("example.org", [])).toMatchObject({ ok: true });
    expect(checkSiteInputs("", ["one.example.net"])).toMatchObject({ ok: true, own: "" });
  });
  it("refuses a fourth website it likes, and says how many to remove", () => {
    const r = checkSiteInputs("example.org", ["a.example.net", "b.example.net", "c.example.net", "d.example.net"]);
    expect(r).toEqual({ ok: false, error: "You can give at most 3 websites you like (this was 4). Remove 1 and save again." });
  });
  it("keeps the same website once, with or without www", () => {
    const r = checkSiteInputs("", ["https://one.example.net/", "https://www.one.example.net", "one.example.net/about", "b.example.net", "c.example.net"]);
    expect(r).toEqual({ ok: true, own: "", refs: ["https://one.example.net/", "b.example.net", "c.example.net"] });
  });
  it("refuses the organization's own website among the ones it likes", () => {
    const r = checkSiteInputs("https://www.example.org", ["example.org/about"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/own website/);
  });
  it("refuses a private address in either box, with the reason", () => {
    expect(checkSiteInputs("http://10.0.0.5", [])).toMatchObject({ ok: false, error: expect.stringMatching(/private network/) });
    expect(checkSiteInputs("example.org", ["http://localhost:3000"])).toMatchObject({ ok: false, error: expect.stringMatching(/private network/) });
    expect(checkSiteInputs("example.org", ["ftp://example.net"])).toMatchObject({ ok: false, error: expect.stringMatching(/must start with http/) });
  });
});

describe("polling politely", () => {
  it("starts at three seconds, slows down, and never asks faster than every three seconds", () => {
    const delays = Array.from({ length: 30 }, (_, i) => nextPollDelay(i));
    expect(delays[0]).toBe(3000);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(3000);
    expect(delays.every((d, i) => i === 0 || d >= delays[i - 1]!)).toBe(true);
    expect(delays[29]).toBe(12000);
  });
  it("gives up after ten minutes, a little longer than the background service waits to retry", () => {
    expect(GIVE_UP_AFTER_MS).toBe(10 * 60_000);
    expect(STALE_MS).toBe(15 * 60_000);
  });
});

const job = (over: Partial<SiteJob> = {}): SiteJob => ({
  id: 1,
  slot: "own",
  mode: "own",
  url: "https://www.example.org",
  run: "r1",
  status: "queued",
  attempts: 0,
  maxAttempts: 2,
  lastError: null,
  createdAt: "2026-10-11T10:00:00.000Z",
  finishedAt: null,
  pagesRead: null,
  ...over,
});
const at = (iso: string) => new Date(iso);

describe("how a read is going, in plain English", () => {
  it("waits, reads, and is done", () => {
    expect(jobLine(job(), at("2026-10-11T10:00:20Z"))).toMatchObject({ phase: "waiting", label: "Waiting to start…" });
    expect(jobLine(job({ status: "running", attempts: 1 }), at("2026-10-11T10:00:40Z"))).toMatchObject({ phase: "reading", label: "Reading the website…" });
    expect(jobLine(job({ status: "done", pagesRead: 12 }), at("2026-10-11T10:02:00Z"))).toMatchObject({ phase: "done", tone: "ok", detail: "12 pages read." });
    expect(jobLine(job({ status: "done", pagesRead: 1 }), at("2026-10-11T10:02:00Z")).detail).toBe("1 page read.");
  });
  it("says why a read failed, in the words the background service gave", () => {
    const l = jobLine(job({ status: "failed", lastError: "That address points to a private network; only public web pages can be imported." }), at("2026-10-11T10:03:00Z"));
    expect(l).toMatchObject({ phase: "failed", tone: "bad", label: "Could not read this website" });
    expect(l.detail).toContain("private network");
    expect(jobLine(job({ status: "failed" }), at("2026-10-11T10:03:00Z")).detail).toMatch(/did not say why/);
  });
  it("shows a second try as such", () => {
    expect(jobLine(job({ attempts: 1, lastError: "The website did not answer." }), at("2026-10-11T10:01:00Z"))).toMatchObject({ phase: "waiting", label: "Trying again…" });
  });
  it("stops waiting for a read queued 15 minutes ago and never finished", () => {
    const l = jobLine(job({ status: "queued" }), at("2026-10-11T10:16:00Z"));
    expect(l).toMatchObject({ phase: "stale", tone: "warn" });
    expect(isBusy(l)).toBe(false);
    expect(isBusy(jobLine(job(), at("2026-10-11T10:05:00Z")))).toBe(true);
    expect(isBusy(jobLine(job({ status: "done" }), at("2026-10-11T10:05:00Z")))).toBe(false);
  });
});

describe("the status the database gives", () => {
  const raw = {
    own_url: "https://www.example.org",
    reference_urls: ["https://one.example.net", "https://two.example.net"],
    saved_at: "2026-10-11T09:00:00Z",
    profile_website: "https://profile.example.org",
    reads_last_hour: 3,
    max_reads_per_hour: 8,
    jobs: [
      { id: 7, slot: "own", mode: "own", url: "https://www.example.org", run: "r", status: "done", attempts: 1, max_attempts: 2, last_error: null, created_at: "2026-10-11T10:00:00Z", finished_at: "2026-10-11T10:01:00Z", pages_read: 12 },
      { id: 8, slot: "ref1", mode: "reference", url: "https://old.example.net", run: "r", status: "failed", attempts: 2, max_attempts: 2, last_error: "The website did not answer.", created_at: "2026-10-11T10:00:00Z", finished_at: null, pages_read: null },
      { id: 9, slot: "nonsense", status: "done" },
      { id: 0, slot: "ref2", status: "done" },
    ],
  };
  it("is read field by field, dropping what it does not understand", () => {
    const s = parseSiteStatus(raw);
    expect(s).not.toBeNull();
    expect(s!.jobs.map((j) => [j.id, j.slot])).toEqual([[7, "own"], [8, "ref1"]]);
    expect(s).toMatchObject({ ownUrl: "https://www.example.org", referenceUrls: ["https://one.example.net", "https://two.example.net"], profileWebsite: "https://profile.example.org", readsLastHour: 3, maxReadsPerHour: 8 });
    expect(s!.jobs[0]).toMatchObject({ pagesRead: 12, maxAttempts: 2 });
    expect(s!.jobs[1]).toMatchObject({ lastError: "The website did not answer.", pagesRead: null });
  });
  it("is null for an answer in another shape", () => {
    expect(parseSiteStatus(null)).toBeNull();
    expect(parseSiteStatus({ jobs: "x" })).toBeNull();
    expect(parseSiteStatus({ jobs: [] })).toBeNull();
  });
  it("knows which slots have an address and whether a read is of the address saved now", () => {
    const s = parseSiteStatus(raw)!;
    expect(savedSlots(s)).toEqual(["own", "ref1", "ref2"]);
    expect(readIsCurrent(s.jobs[0]!, s)).toBe(true);
    expect(readIsCurrent(s.jobs[1]!, s)).toBe(false); // ref1 was read at old.example.net; the saved address is one.example.net
  });
});

describe("words", () => {
  it("says how sure a page's kind is", () => {
    expect(confidenceWords(0.92)).toEqual({ label: "Sure (92%)", level: "sure" });
    expect(confidenceWords(0.55)).toEqual({ label: "Probably (55%)", level: "probably" });
    expect(confidenceWords(0.4)).toEqual({ label: "Not sure (40%) — please check", level: "unsure" });
  });
  it("says what a contrast ratio means", () => {
    expect(contrastWords(8.9)).toEqual({ ok: true, words: "easy to read at any size" });
    expect(contrastWords(4.6).ok).toBe(true);
    expect(contrastWords(3.2).ok).toBe(false);
    expect(contrastWords(1.5).words).toMatch(/too faint/);
  });
  it("words the notes of a read, and leaves out a code it does not know", () => {
    const out = describeNotes([{ code: "scripts_built", count: 2 }, { code: "page_limit", count: 1 }, { code: "made_up", count: 5 }, { code: "robots_skipped", count: 1 }]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/2 pages have very little text/);
    expect(out[1]).toMatch(/page limit/);
    expect(out[2]).toBe("1 page was skipped because the site asks robots not to read it.");
  });
});

describe("What we found: the organization's own website", () => {
  const view = buildFoundView(ownResult) as OwnView;
  it("is an own-website view", () => {
    expect(view.mode).toBe("own");
    expect(view.site).toBe("jsh.example.org");
    expect(view.pagesRead).toBe(7);
    expect(view.pagesInSitemap).toBe(9);
  });
  it("groups pages by kind, with counts, in a reading order", () => {
    expect(view.groups.map((g) => [g.kind, g.count])).toEqual([["home", 1], ["about", 2], ["events", 2], ["donate", 1], ["other", 1]]);
    const about = view.groups.find((g) => g.kind === "about")!;
    expect(about.pages.map((p) => [p.path, p.sure])).toEqual([["/about", "sure"], ["/history", "probably"]]);
    expect(view.groups.find((g) => g.kind === "events")!.pages[1]).toMatchObject({ path: "/spring-fair", sure: "unsure", sureWords: "Not sure (40%) — please check" });
  });
  it("counts the pages it is not sure about and flags the ones built by scripts", () => {
    expect(view.notSure).toBe(2);
    expect(view.scriptPages).toEqual([{ title: "Member portal", path: "/app/portal" }]);
  });
  it("gives the home page's section order in words, dropping a block it does not know", () => {
    expect(view.homeSections.map((s) => s.label)).toEqual(["Top bar and menu", "Big banner", "About us", "Events", "Giving", "Newsletter sign-up", "Footer"]);
    expect(view.hero).toBe("A tall banner at the top with a sliding set of pictures and a button.");
    expect(view.hasSearch).toBe(true);
  });
  it("gives the colours as swatches, in hex, dropping what is not a colour, with contrast notes", () => {
    expect(view.swatches.map((s) => [s.hex, s.roleLabel, s.percent])).toEqual([["#8c1c13", "Main colour", 42], ["#f4a300", "Second colour", 20], ["#ffffff", "Page background", 30], ["#222222", "Text", 8]]);
    expect(view.themeColor).toBe("#8c1c13");
    expect(view.contrast).toHaveLength(2);
    expect(view.contrast[0]).toMatchObject({ foreground: "#ffffff", background: "#8c1c13", ratio: 8.9, ok: true });
    expect(view.contrast[1]).toMatchObject({ ok: false });
    expect(view.contrast[1]!.text).toMatch(/too faint/);
  });
  it("gives the fonts", () => {
    expect(view.fonts).toEqual({ heading: "Playfair Display", body: "Open Sans", others: ["Noto Sans Gujarati"] });
  });
  it("shows logo candidates from the organization's own website only", () => {
    expect(view.logos.map((l) => [l.url, l.shown])).toEqual([["https://www.jsh.example.org/wp-content/logo.png", true], ["https://cdn.somewhere-else.net/shared/logo.png", false]]);
    expect(view.logos[0]).toMatchObject({ alt: "JSH logo", width: 240, height: 80, source: "Picture in the page header" });
  });
  it("gives the menu structure, the footer, and the contact and social details", () => {
    expect(view.menu).toMatchObject({ depth: 2, topLevel: 3, dropdowns: true, mobileToggle: true, button: "Donate" });
    expect(view.menu!.items[0]).toEqual({ label: "About", children: ["Our history", "Leaders"], moreChildren: 0 });
    expect(view.footer).toMatchObject({ columns: 3, linkCount: 12, social: true, newsletter: false });
    expect(view.organization).toMatchObject({ name: "Jain Society of Houston", languages: ["en", "gu"], emails: ["office@jsh.example.org"], phones: ["+1 713 555 0100"] });
    expect(view.organization.social).toEqual([{ network: "facebook", url: "https://www.facebook.com/jshouston" }]); // the javascript: link is dropped
    expect(view.organization.donate).toEqual([{ label: "Donate", url: "https://www.jsh.example.org/give" }]);
  });
  it("words the notes", () => {
    expect(view.notes).toEqual([
      "1 page has very little text because it is built by scripts. A person should look at it.",
      "The read stopped at the page limit; the site has more pages than were read.",
    ]);
    expect(view.stopped).toBeNull(); // the page-limit note already says so
  });
});

describe("What we found: a website the organization likes (patterns only)", () => {
  const view = buildFoundView(referenceResult) as ReferenceView;
  it("gives section order, menu depth, colours, fonts and density", () => {
    expect(view.mode).toBe("reference");
    expect(view.site).toBe("lovely-temple.example.net");
    expect(view.homeSections.map((s) => s.label)).toEqual(["Top bar and menu", "Big banner", "About us", "Events", "Photo gallery", "Giving", "Footer"]);
    expect(view.hero).toBe("A tall banner at the top with a video.");
    expect(view.menu).toEqual({ depth: 2, topLevel: 6, dropdowns: true, mobileToggle: true, button: true, search: false });
    expect(view.footer).toEqual({ columns: 4, linkCount: 18, social: true, newsletter: true, address: true });
    expect(view.swatches.map((s) => s.hex)).toEqual(["#1b4d3e", "#f7f3ea", "#d9a441"]);
    expect(view.contrast).toEqual([{ ratio: 9.4, ok: true, words: "easy to read at any size" }, { ratio: 2.4, ok: false, words: "too faint for text; use it for decoration only" }]);
    expect(view.fonts).toEqual({ heading: "Cormorant Garamond", body: "Lato", others: [] });
    expect(view.density).toEqual({ text: "short pages with little text", avgWords: 140, avgImages: 5.5, avgSections: 6, imagery: "led by pictures more than words" });
    expect(view.kinds.map((k) => [k.kind, k.count])).toEqual([["home", 1], ["about", 1], ["events", 2], ["donate", 1]]);
  });
  it("holds no page, no text and no address of that website: only fixed words, numbers, colours and font names", () => {
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/https?:\/\//);
    expect(Object.keys(view).sort()).toEqual(["density", "fonts", "footer", "hero", "homeSections", "kinds", "logoPresent", "menu", "mode", "notes", "pagesRead", "site", "stopped", "swatches", "contrast"].sort());
  });
  it("shows none of the text, addresses or images a faulty report held", () => {
    const hostile = buildFoundView(hostileReferenceResult) as ReferenceView;
    const json = JSON.stringify(hostile);
    expect(json).not.toContain("HOSTILE");
    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toMatch(/\.(png|jpg|jpeg|gif|webp|svg)/i);
    expect(json).not.toContain("hostile@");
    expect(hostile.fonts.others).toEqual([]);
    expect(hostile.notes).toEqual(["The site has no sitemap, so its pages were found by following links."]);
  });
});

describe("a report that is not one", () => {
  it("is null", () => {
    expect(buildFoundView(null)).toBeNull();
    expect(buildFoundView("text")).toBeNull();
    expect(buildFoundView({ schema: 2, mode: "own" })).toBeNull();
    expect(buildFoundView({ schema: 1, mode: "other" })).toBeNull();
  });
  it("shows an empty own report without failing", () => {
    const v = buildFoundView({ schema: 1, mode: "own" }) as OwnView;
    expect(v.groups).toEqual([]);
    expect(v.swatches).toEqual([]);
    expect(v.menu).toBeNull();
    expect(v.logos).toEqual([]);
  });
});
