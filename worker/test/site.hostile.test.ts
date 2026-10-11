import { describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import type { Http } from "../src/http";
import { crawlSite, type CrawlLimits } from "../src/web/site/crawl";
import { makeDeps } from "../src/web/site/deps";
import { MAX_DEPTH, parseHtml, stripHtmlComments, textOf } from "../src/web/site/dom";
import { extractPage } from "../src/web/site/extract";
import { findEmails } from "../src/web/site/facts";
import { cssRules, extractFonts, extractPalette, stripComments } from "../src/web/site/style";

/** Runs a function and says how long it took (milliseconds). */
function timed<T>(f: () => T): { value: T; ms: number } {
  const t = performance.now();
  const value = f();
  return { value, ms: performance.now() - t };
}
const FAST = 1500;

describe("a hostile or broken page cannot make the readers slow or crash them", () => {
  it("reads comments in one pass, whatever they hold", () => {
    expect(stripHtmlComments("a<!-- x -->b<!--y-->c")).toBe("abc");
    expect(stripHtmlComments("a<!-- never ends")).toBe("a");
    const { ms, value } = timed(() => stripHtmlComments("<!--".repeat(300_000)));
    expect(value).toBe("");
    expect(ms).toBeLessThan(FAST);
    expect(stripComments("a/* x */b/* y */c")).toBe("a b c");
    expect(timed(() => stripComments("/*".repeat(300_000))).ms).toBeLessThan(FAST);
  });
  it("reads a stylesheet's rules in one pass (nested @media rules included)", () => {
    const rules = cssRules("@font-face{font-family:X;src:url(x)} a{color:red} @media (max-width:600px){ .b{color:blue} .c{color:green} } d{e:f}");
    expect(rules.map((r) => r.selector)).toEqual(["@font-face", "a", ".b", ".c", "d"]);
    expect(rules[2]!.decls).toBe("color:blue");
    expect(cssRules("a{color:red")).toEqual([]);
    expect(timed(() => cssRules("a{".repeat(200_000))).ms).toBeLessThan(FAST);
    expect(timed(() => cssRules("x".repeat(600_000))).ms).toBeLessThan(FAST);
    expect(timed(() => cssRules("}".repeat(600_000))).ms).toBeLessThan(FAST);
  });
  it("finds the palette and fonts of a huge or garbled stylesheet quickly", () => {
    const garbage = "color:#8c1c13;".repeat(40_000) + "{".repeat(50_000) + "@font-face".repeat(30_000);
    const { ms } = timed(() => {
      extractPalette({ themeColors: [], css: [garbage, "x".repeat(500_000)], inline: [] });
      extractFonts({ css: [garbage], inline: [], links: [] });
    });
    expect(ms).toBeLessThan(3000);
  });
  it("finds email addresses around each @ only", () => {
    expect(findEmails("Write to a.b+c@club.example.org, or x@y.co. Not @home or me@ or @@ or a@b")).toEqual(["a.b+c@club.example.org", "x@y.co"]);
    expect(timed(() => findEmails("a".repeat(400_000))).ms).toBeLessThan(FAST);
    expect(timed(() => findEmails("a@".repeat(200_000))).ms).toBeLessThan(FAST);
    expect(findEmails("@".repeat(5000)).length).toBeLessThanOrEqual(400);
  });
  it("does not recurse without limit on a page nested 30,000 deep", { timeout: 30_000 }, () => {
    const html = "<html><body>" + "<div>".repeat(30_000) + "deep text" + "</div>".repeat(30_000) + "</body></html>";
    const { value, ms } = timed(() => extractPage(html, "https://x.example/deep"));
    expect(ms).toBeLessThan(15_000);
    expect(value.path).toBe("/deep");
    const doc = parseHtml(html);
    let depth = 0;
    for (let e: typeof doc.root | undefined = doc.root; e; e = e.children.find((c): c is typeof doc.root => c.kind === "el")) depth++;
    expect(depth).toBeLessThanOrEqual(MAX_DEPTH + 3);
    expect(textOf(doc.root)).toContain("deep text");
  });
  it("copes with a page of unfinished tags, quotes and comments in a few seconds", { timeout: 60_000 }, () => {
    const pages = ['<a href="x'.repeat(80_000), "<!--".repeat(100_000) + "<p>text</p>", "<p>".repeat(100_000), "<div class='x' ".repeat(50_000), "<img src=a>".repeat(50_000), "<table>" + "<tr><td>x".repeat(30_000), "<script>".repeat(20_000)];
    for (const p of pages) {
      const { ms } = timed(() => extractPage(`<html><body>${p}</body></html>`, "https://x.example/junk"));
      expect(ms).toBeLessThan(10_000);
    }
  });
});

// ── The crawl itself ──────────────────────────────────────────────────────────────────────────────────────────────
type Route = { status?: number; type?: string; body?: string };
function fakeHttp(routes: Record<string, Route>): Http & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async request(url) {
      seen.push(url);
      const r = routes[url];
      const status = r ? (r.status ?? 200) : 404;
      const bytes = new TextEncoder().encode(r ? (r.body ?? "") : "Not found");
      const text = new TextDecoder().decode(bytes);
      return { status, ok: status < 400, headers: new Headers({ "content-type": r?.type ?? "text/html" }), text, json: () => JSON.parse(text), bytes: () => bytes };
    },
  };
}
const limits: CrawlLimits = { maxBytes: 1e9, deadlineMs: 1e9, minDelayMs: 0, now: () => 0, sleep: async () => {} };

describe("the crawl checks every page's own name, not only the start page's", () => {
  it("does not read www.example.org when that name points inside, even though example.org is public", async () => {
    const http = fakeHttp({
      "https://example.org/robots.txt": { type: "text/plain", body: "" },
      "https://example.org/": { body: `<html><body><main><h1>Home</h1><p>${"Welcome text for the visitors. ".repeat(10)}</p><a href="https://www.example.org/inside">x</a><a href="/ok">ok</a></main></body></html>` },
      "https://example.org/ok": { body: "<html><body><main><h1>Ok</h1><p>Fine page with some text on it for readers.</p></main></body></html>" },
      "https://www.example.org/inside": { body: "<html><body>SECRET</body></html>" },
    });
    const resolve = async (host: string) => (host === "www.example.org" ? ["10.0.0.7"] : ["93.184.216.34"]);
    const { pages, stats } = await crawlSite(makeDeps(http, { allowPrivate: false, resolve }, limits), { start_url: "https://example.org/", mode: "own" });
    expect(http.seen).not.toContain("https://www.example.org/inside");
    expect(pages.map((p) => p.path)).toEqual(["/", "/ok"]);
    expect(stats.skipped.errors).toBe(1);
  });
  it("loses one unreadable page, not the crawl", async () => {
    const http = fakeHttp({
      "https://example.org/robots.txt": { type: "text/plain", body: "" },
      "https://example.org/": { body: `<html><body><main><h1>Home</h1><p>${"Welcome text for the visitors. ".repeat(10)}</p><a href="/ok">ok</a></main></body></html>` },
      "https://example.org/ok": { body: "<html><body><main><h1>Ok</h1><p>Fine page with some text on it for readers.</p></main></body></html>" },
    });
    const { pages } = await crawlSite(makeDeps(http, { allowPrivate: false, resolve: async () => ["93.184.216.34"] }, limits), { start_url: "https://example.org/", mode: "own" });
    expect(pages).toHaveLength(2);
    await expect(crawlSite(makeDeps(fakeHttp({}), { allowPrivate: false, resolve: async () => ["10.1.1.1"] }, limits), { start_url: "https://example.org/", mode: "own" })).rejects.toBeInstanceOf(PermanentError);
  });
});
