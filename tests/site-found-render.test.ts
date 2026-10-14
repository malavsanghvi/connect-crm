import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The form calls server actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/setup/website/actions", () => ({
  saveSiteAddressesAction: vi.fn(),
  lookAtWebsiteAction: vi.fn(),
  siteStatusAction: vi.fn(),
}));
vi.mock("@/app/(app)/setup/website/draft-actions", () => ({ buildFirstDraftAction: vi.fn(), setDraftPageStatusAction: vi.fn() }));

import { FoundReport, REFERENCE_PROMISE } from "@/app/(app)/setup/website/found-report";
import type { Snapshot } from "@/app/(app)/setup/website/load";
import { WebsiteForm } from "@/app/(app)/setup/website/website-form";
import { buildFoundView, parseSiteStatus, type FoundView } from "@/lib/site-found";

import { hostileReferenceResult, ownResult, referenceResult } from "./fixtures/site-found";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const view = (result: unknown): FoundView => {
  const v = buildFoundView(result);
  if (!v) throw new Error("fixture is not a report");
  return v;
};

describe("What we found · the organization's own website", () => {
  const html = render(createElement(FoundReport, { view: view(ownResult) }));

  it("says what was read and that the words and pictures are the organization's own to reuse", () => {
    expect(html).toContain("What we found on jsh.example.org");
    expect(html).toContain("7 pages read");
    expect(html).toContain("its words and pictures can be reused");
  });

  it("lists the pages by kind with counts and how sure Weaver is, flagging the unsure ones", () => {
    expect(html).toContain("Pages by kind");
    for (const [label, count] of [["Home page", "1 page"], ["About us", "2 pages"], ["Events", "2 pages"], ["Giving and donations", "1 page"], ["Other pages", "1 page"]] as const) {
      expect(html).toContain(label);
      expect(html).toContain(`· ${count}`);
    }
    expect(html).toContain("Sure (92%)");
    expect(html).toContain("Probably (55%)");
    expect(html).toContain("Not sure (40%) — please check");
    expect(html).toContain("2 pages could not be sorted with confidence");
  });

  it("flags the page built by scripts", () => {
    expect(html).toContain('data-found-section="scripts"');
    expect(html).toContain("1 page built by scripts");
    expect(html).toContain("Member portal");
  });

  it("shows the home page's section order, top to bottom", () => {
    const order = ["Top bar and menu", "Big banner", "Newsletter sign-up"].map((s) => html.indexOf(`<li>${s}</li>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("A tall banner at the top with a sliding set of pictures and a button.");
  });

  it("shows the palette as swatches with their names and contrast notes in words", () => {
    for (const hex of ["#8c1c13", "#f4a300", "#ffffff", "#222222"]) expect(html).toContain(`data-swatch="${hex}"`);
    expect(html).toContain("Main colour");
    expect(html).toContain("Page background");
    expect(html).toContain("White on the main colour: 8.9:1, easy to read at any size.");
    expect(html).toContain("Easy to read");
    expect(html).toContain("Hard to read");
    expect(html).not.toContain("not-a-colour");
  });

  it("names the fonts", () => {
    expect(html).toContain("Playfair Display");
    expect(html).toContain("Open Sans");
    expect(html).toContain("Noto Sans Gujarati");
  });

  it("shows a logo from the organization's own website, and none from another host", () => {
    expect(html).toContain('src="https://www.jsh.example.org/wp-content/logo.png"');
    expect(html).toContain("Picture in the page header");
    expect(html).not.toContain("somewhere-else.net");
    expect(html).toContain("1 more picture is kept on another website");
  });

  it("shows the menu structure, the footer, and the contact and social details", () => {
    expect(html).toContain("Our history, Leaders");
    expect(html).toContain("Menu levels");
    expect(html).toContain("2 (it has drop-down menus)");
    expect(html).toContain("Button in the menu");
    expect(html).toContain("office@jsh.example.org");
    expect(html).toContain("+1 713 555 0100");
    expect(html).toContain('href="https://www.facebook.com/jshouston"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("javascript:");
  });

  it("words the notes about the read", () => {
    expect(html).toContain("1 page has very little text because it is built by scripts.");
    expect(html).toContain("The read stopped at the page limit");
  });
});

describe("What we found · a website the organization likes", () => {
  const html = render(createElement(FoundReport, { view: view(referenceResult) }));

  it("says that only patterns are used and that other websites' words and pictures are never copied", () => {
    expect(html).toContain("A website you like: lovely-temple.example.net");
    expect(html).toContain(REFERENCE_PROMISE);
    expect(REFERENCE_PROMISE).toMatch(/words and pictures are never copied/);
  });

  it("shows section order, menu depth, palette, fonts and density", () => {
    expect(html).toContain("Order of the home page");
    expect(html).toContain("Photo gallery");
    expect(html).toContain("A tall banner at the top with a video.");
    expect(html).toContain("2 (drop-down menus)");
    expect(html).toContain('data-swatch="#1b4d3e"');
    expect(html).toContain("Cormorant Garamond");
    expect(html).toContain("Lato");
    expect(html).toContain("short pages with little text (about 140 words a page)");
    expect(html).toContain("led by pictures more than words");
    expect(html).toContain("9.4:1, easy to read at any size.");
  });

  it("has no link, no image and no address anywhere", () => {
    expect(html).not.toMatch(/<img|<a |<a>/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("src=");
  });

  it("shows no sentence, image address, page title or contact detail even from a faulty report that held them", () => {
    const hostile = render(createElement(FoundReport, { view: view(hostileReferenceResult) }));
    expect(hostile).not.toContain("HOSTILE");
    expect(hostile).not.toContain("hostile@");
    expect(hostile).not.toMatch(/<img|<a |<a>/);
    expect(hostile).not.toMatch(/https?:\/\//);
    expect(hostile).not.toMatch(/\.(png|jpg|jpeg|gif|webp|svg)/i);
    expect(hostile).not.toContain("welcome every family");
    expect(hostile).toContain("Cormorant Garamond");
  });
});

// ── The screen ───────────────────────────────────────────────────────────────
const statusOf = (over: Record<string, unknown> = {}) => {
  const s = parseSiteStatus({ own_url: null, reference_urls: [], saved_at: null, profile_website: null, jobs: [], reads_last_hour: 0, max_reads_per_hour: 8, ...over });
  if (!s) throw new Error("status fixture");
  return s;
};
const job = (over: Record<string, unknown>) => ({
  id: 1, slot: "own", mode: "own", url: "https://www.example.org", run: "r", status: "queued", attempts: 0, max_attempts: 2, last_error: null,
  created_at: new Date().toISOString(), finished_at: null, pages_read: null, ...over,
});
const screen = (snap: Snapshot) => render(createElement(WebsiteForm, { initial: snap }));

describe("Setup › Your website", () => {
  it("starts empty: two kinds of address, the promise about other sites, and no way to look until there is an address", () => {
    const html = screen({ status: statusOf(), views: {} });
    expect(html).toContain("Your website&#x27;s address");
    expect(html).toContain("Websites you like (up to 3, optional)");
    expect(html).toContain("Text and pictures from other websites are never copied");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Look at my website<\/button>/);
    expect(html).not.toContain("How it is going");
    expect(html).not.toContain("What we found");
  });

  it("offers the website on the public profile as the starting address, and says so", () => {
    const html = screen({ status: statusOf({ profile_website: "https://profile.example.org" }), views: {} });
    expect(html).toContain('value="https://profile.example.org"');
    expect(html).toContain("This is the website on your profile. Save to use it here.");
    expect(html).not.toMatch(/disabled=""[^>]*>Look at my website/);
  });

  it("shows a read in progress for each saved website, and cannot be started twice", () => {
    const html = screen({
      status: statusOf({
        own_url: "https://www.example.org",
        reference_urls: ["https://one.example.net"],
        jobs: [job({ status: "running", attempts: 1 }), job({ id: 2, slot: "ref1", mode: "reference", url: "https://one.example.net" })],
        reads_last_hour: 2,
      }),
      views: {},
    });
    expect(html).toContain("How it is going");
    expect(html).toContain("Your website");
    expect(html).toContain("A website you like (1)");
    expect(html).toContain("Reading the website…");
    expect(html).toContain("Waiting to start…");
    expect(html).toContain("2 of 8 reads used in the last hour");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Looking…<\/button>/);
    expect(html).not.toContain("What we found");
  });

  it("puts a failure next to the website it happened to, with its reason and Try again", () => {
    const html = screen({
      status: statusOf({
        own_url: "https://www.example.org",
        jobs: [job({ status: "failed", attempts: 2, last_error: "The website did not answer.", finished_at: new Date().toISOString() })],
      }),
      views: {},
    });
    expect(html).toContain("Could not read this website");
    expect(html).toContain("The website did not answer.");
    expect(html).toContain("Try again");
  });

  it("shows What we found for a finished read, and a reason with Try again when its report cannot be shown", () => {
    const status = statusOf({
      own_url: "https://www.jsh.example.org",
      reference_urls: ["https://lovely-temple.example.net"],
      jobs: [
        job({ id: 11, status: "done", url: "https://www.jsh.example.org", pages_read: 7, finished_at: new Date().toISOString() }),
        job({ id: 12, slot: "ref1", mode: "reference", status: "done", url: "https://lovely-temple.example.net", pages_read: 5, finished_at: new Date().toISOString() }),
      ],
    });
    const html = screen({
      status,
      views: { "11": { ok: true, view: view(ownResult) }, "12": { ok: false, error: "Could not load what was found — you don't have permission to make this change." } },
    });
    expect(html).toContain("What we found");
    expect(html).toContain("What we found on jsh.example.org");
    expect(html).toContain("Could not load what was found");
    expect(html).toContain("7 pages read.");
    expect(html).toMatch(/Could not load what was found[^<]*<button[^>]*>Try again<\/button>/);
  });

  it("says a report was read before the address was changed", () => {
    const status = statusOf({
      own_url: "https://www.jsh.example.org",
      jobs: [job({ id: 11, status: "done", url: "https://www.old-address.example.org", pages_read: 7, finished_at: new Date().toISOString() })],
    });
    const html = screen({ status, views: { "11": { ok: true, view: view(ownResult) } } });
    expect(html).toContain("This was read before you changed the address.");
  });
});
