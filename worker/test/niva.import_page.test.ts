import { describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import type { Http, HttpResponse } from "../src/http";
import { run } from "../src/handlers/niva.import_page";
import { assertPublicPage, fetchPage, MAX_PAGE_BYTES } from "../src/web/fetch_page";
import { decodeEntities, htmlToBlocks, MAX_SECTION_CHARS, MAX_SECTIONS, sectionize } from "../src/web/page_text";
import { parseRobots, robotsAllows } from "../src/web/robots";
import { captureLog, fakeDb, job } from "./helpers";

// ── robots.txt ────────────────────────────────────────────────────────────────
describe("robots.txt", () => {
  const agent = "CommunityConnect-Niva/1.0";
  it("allows everything when there are no rules or the file is unreadable", () => {
    expect(robotsAllows(parseRobots("", agent), "/a")).toBe(true);
    expect(robotsAllows(parseRobots("<html>not a robots file</html>", agent), "/a")).toBe(true);
  });
  it("applies the * group, longest match wins, Allow wins a tie", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private/\nAllow: /private/faq\nDisallow: /tmp$", agent);
    expect(robotsAllows(rules, "/private/x")).toBe(false);
    expect(robotsAllows(rules, "/private/faq")).toBe(true);
    expect(robotsAllows(rules, "/tmp")).toBe(false);
    expect(robotsAllows(rules, "/tmp/ok")).toBe(true);
    expect(robotsAllows(rules, "/about")).toBe(true);
  });
  it("prefers a group that names our agent over *, and an empty Disallow allows all", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: CommunityConnect-Niva\nDisallow:\n", agent);
    expect(robotsAllows(rules, "/anything")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /", agent), "/anything")).toBe(false);
  });
  it("supports * inside a pattern and ignores comments", () => {
    const rules = parseRobots("User-agent: *\nDisallow: *?lightbox=  # galleries\nDisallow: /a/*/edit", agent);
    expect(robotsAllows(rules, "/p?lightbox=1")).toBe(false);
    expect(robotsAllows(rules, "/a/12/edit")).toBe(false);
    expect(robotsAllows(rules, "/a/12/view")).toBe(true);
  });
});

// ── HTML to sections ──────────────────────────────────────────────────────────
const PAGE = `<!doctype html><html><head><title>Relocation | JSH</title><script>var x = "<div>not text</div>";</script><style>.a{}</style></head>
<body><header><nav><ul><li>Home</li><li>Pathshala</li></ul></nav></header>
<main>
  <h2>JSH Relocation FAQs</h2>
  <p>What are the changes&nbsp;in motion?</p>
  <p>We are building a <strong>Facilities</strong> building &amp; a Temple.</p>
  <ul><li>13 pathshala rooms</li><li>Kitchen of 3,400 sq.ft.</li></ul>
  <div hidden>secret hidden text</div>
  <button>Donate now</button>
  <p>Caf&eacute; &#8212; open &#x2019;til noon</p>
</main>
<footer>Quick Links: Panchang</footer></body></html>`;

describe("htmlToBlocks / sectionize", () => {
  it("keeps only <main>, drops menus, scripts, hidden text and buttons, and decodes entities", () => {
    const { blocks, title } = htmlToBlocks(PAGE);
    const text = blocks.map((b) => b.text);
    expect(title).toBe("Relocation");
    expect(text).toEqual([
      "JSH Relocation FAQs",
      "What are the changes in motion?",
      "We are building a Facilities building & a Temple.",
      "13 pathshala rooms",
      "Kitchen of 3,400 sq.ft.",
      "Café — open ’til noon",
    ]);
    expect(blocks[0]!.heading).toBe(true);
    expect(blocks[3]!.list).toBe(true);
    expect(text.join(" ")).not.toMatch(/Home|Panchang|secret|not text|Donate/);
  });
  it("without <main> it drops nav/header/footer but keeps the rest of the body", () => {
    const { blocks } = htmlToBlocks("<body><nav>Menu</nav><h1>About us</h1><p>We are a community.</p><footer>Bye</footer></body>");
    expect(blocks.map((b) => b.text)).toEqual(["About us", "We are a community."]);
  });
  it("survives malformed markup and never throws", () => {
    expect(() => htmlToBlocks("<div><p>unclosed <b>bold <i>italic</div><<>>&&; <p")).not.toThrow();
    expect(htmlToBlocks("").blocks).toEqual([]);
    expect(htmlToBlocks("<script>alert(1)").blocks).toEqual([]);
  });
  it("names the page by its first heading when that opens the page, and titles a section by its heading or question", () => {
    const s = sectionize(htmlToBlocks(PAGE));
    expect(s.pageTitle).toBe("JSH Relocation FAQs");
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0]!.title).toBe("JSH Relocation FAQs");
    expect(s.sections[0]!.body).toContain("- 13 pathshala rooms\n- Kitchen of 3,400 sq.ft.");
    expect(s.truncated).toBe(false);
  });
  it("splits a long page into sections under the size limit and keeps a question with its answer", () => {
    const filler = "This sentence is here to give the section some length. ".repeat(10).trim();
    let html = "<main><h1>Big FAQ</h1>";
    for (let i = 1; i <= 12; i++) html += `<p>Question number ${i}?</p><p>${filler} Answer ${i}.</p>`;
    html += "</main>";
    const s = sectionize(htmlToBlocks(html));
    expect(s.sections.length).toBeGreaterThan(1);
    for (const sec of s.sections) expect(sec.body.length).toBeLessThanOrEqual(MAX_SECTION_CHARS);
    // every section after the first opens with a question, never with a stranded answer
    for (const sec of s.sections.slice(1)) expect(sec.body.split("\n\n")[0]).toMatch(/\?$/);
    expect(s.sections[1]!.title).toMatch(/^Big FAQ: Question number \d+\?$/);
    // nothing was lost between sections
    const all = s.sections.map((x) => x.body).join("\n\n");
    for (let i = 1; i <= 12; i++) expect(all).toContain(`Answer ${i}.`);
  });
  it("splits one enormous paragraph on sentence ends", () => {
    const html = `<main><p>${"A short sentence here. ".repeat(600)}</p></main>`;
    const s = sectionize(htmlToBlocks(html));
    expect(s.sections.length).toBeGreaterThan(2);
    for (const sec of s.sections) expect(sec.body.length).toBeLessThanOrEqual(MAX_SECTION_CHARS);
  });
  it("stops at 40 sections and says the page was truncated", () => {
    let html = "<main>";
    for (let i = 0; i < 80; i++) html += `<h2>Topic ${i}</h2><p>${"Words about the topic. ".repeat(30)}</p>`;
    const s = sectionize(htmlToBlocks(html + "</main>"));
    expect(s.sections).toHaveLength(MAX_SECTIONS);
    expect(s.truncated).toBe(true);
  });
  it("yields no sections for a page with no text", () => {
    expect(sectionize(htmlToBlocks("<html><body><div id='root'></div><script>render()</script></body></html>")).sections).toEqual([]);
  });
  it("decodes named, decimal and hex entities and leaves unknown ones alone", () => {
    expect(decodeEntities("a&amp;b &lt;i&gt; &#65;&#x42; &bogus; &#0;")).toBe("a&b <i> AB &bogus;  ");
  });
});

// ── Safe fetching ─────────────────────────────────────────────────────────────
type Route = { status?: number; type?: string; body?: string; location?: string; length?: number };
function fakeHttp(routes: Record<string, Route>): Http & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async request(url) {
      seen.push(url);
      const r = routes[url];
      if (!r) return response(404, "text/plain", "");
      const headers = new Headers();
      headers.set("content-type", r.type ?? "text/html");
      if (r.location) headers.set("location", r.location);
      if (r.length !== undefined) headers.set("content-length", String(r.length));
      return { ...response(r.status ?? 200, r.type ?? "text/html", r.body ?? ""), headers } as HttpResponse;
    },
  };
}
function response(status: number, type: string, text: string): HttpResponse {
  return { status, ok: status < 400, headers: new Headers({ "content-type": type }), text, json: () => JSON.parse(text) };
}
const PUBLIC = async () => ["93.184.216.34"];
const ok = { allowPrivate: false, resolve: PUBLIC };

describe("fetchPage", () => {
  const html = "<main><p>Hello</p></main>";
  it("refuses non-http addresses, credentials and private networks with plain reasons", async () => {
    await expect(assertPublicPage("ftp://example.org/x", ok)).rejects.toThrow(/must start with https/);
    await expect(assertPublicPage("https://user:pw@example.org/", ok)).rejects.toThrow(/user name or password/);
    await expect(assertPublicPage("not a url", ok)).rejects.toBeInstanceOf(PermanentError);
    await expect(assertPublicPage("http://localhost/x", ok)).rejects.toThrow(/private network/);
    await expect(assertPublicPage("http://169.254.169.254/latest/meta-data", ok)).rejects.toThrow(/private network/);
    await expect(assertPublicPage("https://intranet.example.org/", { allowPrivate: false, resolve: async () => ["10.0.0.5"] })).rejects.toThrow(/private network/);
    await expect(assertPublicPage("http://localhost/x", { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
  it("reads a public page after checking its robots.txt", async () => {
    const http = fakeHttp({ "https://example.org/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /" }, "https://example.org/faq": { body: html } });
    const got = await fetchPage(http, "https://example.org/faq", ok);
    expect(got.html).toBe(html);
    expect(http.seen).toEqual(["https://example.org/robots.txt", "https://example.org/faq"]);
  });
  it("does not fetch a page robots.txt disallows", async () => {
    const http = fakeHttp({ "https://example.org/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /members" }, "https://example.org/members": { body: html } });
    await expect(fetchPage(http, "https://example.org/members", ok)).rejects.toThrow(/asks robots not to read this page/);
    expect(http.seen).not.toContain("https://example.org/members");
  });
  it("treats a missing robots.txt as permission but a robots.txt outage as try-again", async () => {
    const missing = fakeHttp({ "https://example.org/faq": { body: html } });
    await expect(fetchPage(missing, "https://example.org/faq", ok)).resolves.toMatchObject({ html });
    const down = fakeHttp({ "https://example.org/robots.txt": { status: 503 }, "https://example.org/faq": { body: html } });
    const err = await fetchPage(down, "https://example.org/faq", ok).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentError);
  });
  it("re-checks every redirect hop and refuses one that leads to a private address", async () => {
    const resolve = async (h: string) => (h === "evil.example.org" ? ["127.0.0.1"] : ["93.184.216.34"]);
    const http = fakeHttp({ "https://example.org/go": { status: 302, location: "https://evil.example.org/x" } });
    await expect(fetchPage(http, "https://example.org/go", { allowPrivate: false, resolve })).rejects.toThrow(/private network/);
  });
  it("says plainly when the page is missing, blocked, not HTML or too big", async () => {
    const at = (r: Route) => fakeHttp({ "https://example.org/p": r });
    await expect(fetchPage(at({ status: 404 }), "https://example.org/p", ok)).rejects.toThrow(/was not found/);
    await expect(fetchPage(at({ status: 403 }), "https://example.org/p", ok)).rejects.toThrow(/would not let the importer/);
    await expect(fetchPage(at({ type: "application/pdf", body: "%PDF" }), "https://example.org/p", ok)).rejects.toThrow(/not a web page.*PDFs and files are not imported yet/);
    await expect(fetchPage(at({ length: MAX_PAGE_BYTES + 1 }), "https://example.org/p", ok)).rejects.toThrow(/larger than 2 MB/);
    const err = await fetchPage(at({ status: 502 }), "https://example.org/p", ok).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(PermanentError); // a server error is retried
  });
});

// ── The job ───────────────────────────────────────────────────────────────────
function ctxWith(http: Http, db = fakeDb().db) {
  const { log } = captureLog();
  return { db, http, log, env: { NIVA_IMPORT_ALLOW_PRIVATE: "1" }, workerId: "w", secret: async () => null, storeSecret: async () => ({ fingerprint: "" }), removeOauthCode: async () => false } as never;
}

describe("niva.import_page", () => {
  const good = "<main><h1>Membership</h1><p>Membership is open to every family in the Houston area.</p></main>";
  it("reads the page and saves its sections as drafts through the worker function", async () => {
    const f = fakeDb({ query: () => [{ r: { sections: 1, created: 1, updated: 0, kept_as_approved: 0 } }] });
    const http = fakeHttp({ "https://example.org/membership": { body: good } });
    const j = job({ kind: "niva.import_page", payload: { url: "https://example.org/membership" }, created_by: "u-1" });
    const out = (await run(j, ctxWith(http, f.db))) as Record<string, unknown>;
    expect(out).toMatchObject({ url: "https://example.org/membership", page_title: "Membership", sections: 1, created: 1, truncated: false });
    const call = f.calls.find((c) => c.fn === "query")!;
    expect(String(call.args[0])).toContain("app.niva_worker_save_import");
    const params = call.args[1] as unknown[];
    expect(params[0]).toBe(j.center_id);
    expect(params[1]).toBe("https://example.org/membership");
    expect(params[4]).toBe("u-1");
    expect(JSON.parse(params[3] as string)).toEqual([{ title: "Membership", body: expect.stringContaining("open to every family") }]);
  });
  it("fails permanently, in plain English, without a page address or a community", async () => {
    await expect(run(job({ payload: {} }), ctxWith(fakeHttp({})))).rejects.toThrow(/does not say which web page/);
    await expect(run(job({ center_id: null, payload: { url: "https://example.org/a" } }), ctxWith(fakeHttp({})))).rejects.toThrow(/which community/);
  });
  it("saves nothing and says so when the page has no readable text", async () => {
    const f = fakeDb();
    const http = fakeHttp({ "https://example.org/app": { body: "<html><body><div id='root'></div><script>render()</script></body></html>" } });
    const err = await run(job({ payload: { url: "https://example.org/app" } }), ctxWith(http, f.db)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/No readable text was found.*paste its text in by hand/);
    expect(f.calls.filter((c) => c.fn === "query")).toHaveLength(0);
  });
});
