// The four invented sites in test/fixtures/sites (a temple, a chamber of commerce, a church and a garden club):
// saved pages with the kind each one should be classified as. Nothing here is copied from a real website.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PageKind } from "../src/web/site/types";

const ROOT = join(__dirname, "fixtures", "sites");
type Expected = Record<string, { base: string; pages: Record<string, { kind: PageKind; path: string }> }>;
const expected = JSON.parse(readFileSync(join(ROOT, "expected.json"), "utf8")) as Expected;

export const SITES = Object.keys(expected);
export type FixturePage = { site: string; file: string; kind: PageKind; path: string; url: string; html: string };

export function sitePages(site: string): FixturePage[] {
  const e = expected[site]!;
  return Object.entries(e.pages).map(([file, p]) => ({ site, file, kind: p.kind, path: p.path, url: e.base + (p.path === "/" ? "/" : p.path), html: readFileSync(join(ROOT, site, file), "utf8") }));
}
export const siteBase = (site: string) => expected[site]!.base;
export const fixtureHtml = (site: string, file: string) => readFileSync(join(ROOT, site, file), "utf8");
export const fixtureFiles = (site: string) => readdirSync(join(ROOT, site));
/** Every page except the two special ones (a page built by scripts, a page that tries to give orders). */
export const ordinaryPages = (site: string) => sitePages(site).filter((p) => p.file !== "script-built.html" && p.file !== "news-injection.html");
