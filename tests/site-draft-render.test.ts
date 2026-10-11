import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The screens call server actions and read the session; here nothing is called for real.
vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/setup/website/draft-actions", () => ({ buildFirstDraftAction: vi.fn(), setDraftPageStatusAction: vi.fn() }));
vi.mock("@/app/(app)/setup/website/actions", () => ({ saveSiteAddressesAction: vi.fn(), lookAtWebsiteAction: vi.fn(), siteStatusAction: vi.fn() }));
vi.mock("@/components/shell/module-tabs", () => ({ ModuleTabs: () => null }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { DraftPanel } from "@/app/(app)/setup/website/draft-panel";
import WebsiteDraftPreviewPage from "@/app/(app)/setup/website/preview/page";
import { SitePreview } from "@/app/(app)/setup/website/preview/site-preview";
import { WebsiteForm } from "@/app/(app)/setup/website/website-form";
import { readOwnCrawl } from "@/lib/site-draft/crawl";
import { generateDraft } from "@/lib/site-draft/generate";
import { parseStoredDraft, summarizeDraft } from "@/lib/site-draft/parse";
import type { SiteDraft, StoredDraft } from "@/lib/site-draft/types";
import { getSession } from "@/lib/session";
import { parseSiteStatus } from "@/lib/site-found";

import { fakeDb, fakeSession } from "./commands/helpers";
import { JAIN, emptyWeaver, weaver } from "./fixtures/site-draft";
import { ownResult } from "./fixtures/site-found";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

/** What the database would hand back for a draft: ids on pages and blocks, every page a draft. */
function stored(draft: SiteDraft, over: { approved?: string[] } = {}) {
  return {
    site: { name: draft.name, status: "draft", theme: draft.theme, draft_version: 1, built_at: "2026-10-11T12:00:00Z", source_job: 11 },
    pages: draft.pages.map((p, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      slug: p.slug,
      title: p.title,
      kind: p.kind,
      sort: i,
      status: over.approved?.includes(p.slug) ? "approved" : "draft",
      approved_at: over.approved?.includes(p.slug) ? "2026-10-11T13:00:00Z" : null,
      source_path: p.source_path,
      blocks: p.blocks.map((b, j) => ({ ...b, id: `b${i}-${j}` })),
    })),
  };
}
const own = () => readOwnCrawl(JSON.parse(JSON.stringify(ownResult)))!;
const draft = generateDraft({ own: own(), references: [], weaver: weaver(), kind: JAIN });
const read = (raw: unknown): StoredDraft => parseStoredDraft(JSON.parse(JSON.stringify(raw)))!;

describe("the private preview", () => {
  const sd = read(stored(draft));
  const home = render(createElement(SitePreview, { draft: sd, page: sd.pages[0]!, basePath: "/setup/website/preview" }));

  it("draws the page with the draft's theme and name, and a menu to the other pages of the preview", () => {
    expect(home).toContain('data-site-preview="true"');
    expect(home).toContain("--sd-primary:#8c1c13");
    expect(home).toContain("Maple Hall Community");
    expect(home).toContain('href="/setup/website/preview?page=events"');
    expect(home).toContain('aria-current="page"');
    for (const slug of ["about", "give", "contact"]) expect(home).toContain(`?page=${slug}`);
  });

  it("says, on every block, where its words came from", () => {
    expect(home).toContain("From your old website");
    expect(home).toContain("From Weaver&#x27;s records");
    expect(home).toContain('data-source="own_site"');
    expect(home).toContain('data-source="weaver_data"');
    // The old page is named and linked, safely.
    expect(home).toMatch(/href="https:\/\/www\.jsh\.example\.org\/?[^"]*" target="_blank" rel="noopener noreferrer"/);
    // Every block has a badge.
    const blocks = home.match(/data-block="/g)?.length ?? 0;
    const badges = home.match(/data-source="(own_site|weaver_data|written)"><span>/g)?.length ?? 0;
    expect(blocks).toBeGreaterThan(2);
    expect(badges).toBe(blocks);
  });

  it("shows Weaver's events, the greeting of the kind and the giving button", () => {
    expect(home).toContain("Harvest Supper");
    expect(home).toContain("Jai Jinendra");
    const give = render(createElement(SitePreview, { draft: sd, page: sd.pages.find((p) => p.slug === "give")!, basePath: "/x" }));
    expect(give).toContain("Roof Fund");
    expect(give).toContain("Give online");
    expect(give).toContain("Items include Tea towels and Notebooks.");
  });

  it("marks a stand-in clearly, in words", () => {
    const bare = generateDraft({ own: null, references: [], weaver: emptyWeaver(), kind: JAIN });
    const sb = read(stored(bare));
    const html = render(createElement(SitePreview, { draft: sb, page: sb.pages[1]!, basePath: "/x" }));
    expect(html).toContain("Written by Weaver: replace this text");
    expect(html).toContain('data-source="written"');
    expect(html).toContain("Tell visitors about your organization");
  });

  it("shows a map placeholder, not a map from another website, and never loads anything it was not given", () => {
    const contact = render(createElement(SitePreview, { draft: sd, page: sd.pages.find((p) => p.slug === "contact")!, basePath: "/x" }));
    expect(contact).toContain("A map will appear here when the website is published.");
    expect(contact).not.toContain("<iframe");
    expect(contact).not.toContain("<script");
  });

  it("escapes text and refuses an address that is not a web address, whatever the stored draft held", () => {
    const raw = stored(draft);
    const hero = raw.pages[0]!.blocks[0]!;
    (hero.content as Record<string, unknown>).subheading = '<script>alert("x")</script> Welcome';
    (hero.content as Record<string, unknown>).image = { src: "javascript:alert(1)", alt: "x" };
    raw.site.theme = { ...(raw.site.theme as object), palette: { primary: "red;background:url(//evil)", text: "#12345" }, fonts: { heading: "Georgia;}body{display:none", body: "Lato" } } as never;
    const html = render(createElement(SitePreview, { draft: read(raw), page: read(raw).pages[0]!, basePath: "/x" }));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("evil");
    expect(html).not.toContain("display:none");
    expect(html).toContain("--sd-primary:#1b2c5c");
  });
});

describe("the preview page", () => {
  // The database answers null when there is no draft (the fake turns a plain null into an empty list, so a function is used).
  const dbWith = (draftJson: unknown, fail = false) => fakeDb({ rpc: { site_draft_get: () => draftJson }, failRpc: fail ? { site_draft_get: { code: "XX000", message: "boom" } } : {} });
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getSession).mockReset();
  });
  const page = async (sp: Record<string, string> = {}) => render(await WebsiteDraftPreviewPage({ searchParams: Promise.resolve(sp) }));

  it("refuses a person who may not change settings, and asks the database for nothing", async () => {
    const db = dbWith(stored(draft));
    vi.mocked(getSession).mockResolvedValue(fakeSession({ db, permissions: ["events.manage"] }));
    const html = await page();
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("data-site-preview");
    expect(db.rpcCalls).toEqual([]);
  });

  it("shows the draft to a person who may, with the page asked for, and tells search engines to stay away", async () => {
    const db = dbWith(stored(draft));
    vi.mocked(getSession).mockResolvedValue(fakeSession({ db, permissions: ["settings.manage"] }));
    const html = await page({ page: "events" });
    expect(html).toContain("Private preview");
    expect(html).toContain("Nothing has been published");
    expect(html).toContain('data-page="events"');
    expect(html).toContain("Approve page");
    // The draft, and the community's languages (for the style of the dates and times in the preview).
    expect(db.rpcCalls).toEqual([
      { fn: "site_draft_get", args: { p_center: "center-1", p_with_blocks: true } },
      { fn: "community_languages", args: { p_center: "center-1" } },
    ]);
    const meta = (await import("@/app/(app)/setup/website/preview/page")).metadata;
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it("opens the first page when the one asked for does not exist", async () => {
    vi.mocked(getSession).mockResolvedValue(fakeSession({ db: dbWith(stored(draft)), permissions: ["settings.manage"] }));
    expect(await page({ page: "no-such-page" })).toContain('data-page="home"');
  });

  it("says there is no draft yet, with where to start", async () => {
    vi.mocked(getSession).mockResolvedValue(fakeSession({ db: dbWith(null), permissions: ["settings.manage"] }));
    const html = await page();
    expect(html).toContain("There is no website draft yet");
    expect(html).toContain('href="/setup/website"');
  });

  it("says what went wrong, with a way to try again, when the draft cannot be read", async () => {
    vi.mocked(getSession).mockResolvedValue(fakeSession({ db: dbWith(null, true), permissions: ["settings.manage"] }));
    const html = await page();
    expect(html).toContain("Could not");
    expect(html).toContain("/setup/website/preview");
    expect(html).not.toContain("data-site-preview");
  });
});

describe("Your first website draft, on Setup › Your website", () => {
  const summary = summarizeDraft(read(stored(draft, { approved: ["home"] })));

  it("before any website has been read, explains what to do and offers no button that works", () => {
    const html = render(createElement(DraftPanel, { initial: null, canBuild: false, waitingReason: "Press Look at my website first. When Weaver has finished looking, you can build your draft.", loadError: null }));
    expect(html).toContain("Press Look at my website first");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Build my first draft<\/button>/);
    expect(html).toContain("Nothing is published");
  });

  it("after a finished read, offers Build my first draft", () => {
    const html = render(createElement(DraftPanel, { initial: null, canBuild: true, waitingReason: null, loadError: null }));
    expect(html).toMatch(/<button[^>]*>Build my first draft<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Build my first draft/);
  });

  it("with a draft, lists its pages with their state, opens the private preview, and asks before starting again", () => {
    const html = render(createElement(DraftPanel, { initial: summary, canBuild: true, waitingReason: null, loadError: null }));
    expect(html).toContain('data-draft-panel="ready"');
    expect(html).toContain("Approved");
    expect(html).toContain('href="/setup/website/preview"');
    expect(html).toContain("Open the private preview");
    expect(html).toContain("Start the draft again");
    expect(html).not.toContain("Yes, replace the draft");
    for (const p of draft.pages) expect(html).toContain(p.title);
  });

  it("says when the draft could not be read, instead of looking as if there is none", () => {
    const html = render(createElement(DraftPanel, { initial: null, canBuild: true, waitingReason: null, loadError: "Could not load the website draft — boom." }));
    expect(html).toContain("Could not load the website draft — boom. Reload the page to try again.");
    expect(html).toContain('role="alert"');
  });

  it("is part of the Your website screen, which no longer says drafting comes later", () => {
    const status = parseSiteStatus({
      own_url: "https://www.jsh.example.org",
      reference_urls: [],
      saved_at: null,
      profile_website: null,
      reads_last_hour: 0,
      max_reads_per_hour: 8,
      jobs: [{ id: 11, slot: "own", mode: "own", url: "https://www.jsh.example.org", run: "r", status: "done", attempts: 1, max_attempts: 2, last_error: null, created_at: "2026-10-11T10:00:00Z", finished_at: "2026-10-11T10:01:00Z", pages_read: 7 }],
    })!;
    const html = render(createElement(WebsiteForm, { initial: { status, views: {} }, draft: { summary: null, error: null } }));
    expect(html).toContain("Your first website draft");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Build my first draft/);
    const waiting = render(createElement(WebsiteForm, { initial: { status: { ...status, jobs: [] }, views: {} } }));
    expect(waiting).toMatch(/<button[^>]*disabled=""[^>]*>Build my first draft<\/button>/);
    expect(waiting).toContain("Press Look at my website first");
  });
});
