import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PORTAL_PATH_PREFIXES, portalUrl, siteRoute } from "@/lib/site";

// The pages of the website are rendered by the server as a whole (their header suspends), so, as the in-page link tests do, this reads
// their source: each page has the button, pointing at the portal's /demo, beside Get started free.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const BUTTON = /<a href=\{portalUrl\("\/demo"\)\}[\s\S]{0,200}?>\s*Try the demo\s*<\/a>/;

describe("Try the demo on the public website", () => {
  it("is on the home page, in the hero beside Get started free", () => {
    const src = read("src/app/site/page.tsx");
    expect(src).toMatch(BUTTON);
    const hero = src.slice(src.indexOf("Get started free"), src.indexOf("Try the demo") + 20);
    expect(hero).toContain("Take the tour");
  });

  it("is on the pricing page, beside Get started free", () => {
    const src = read("src/app/site/pricing/page.tsx");
    expect(src).toMatch(BUTTON);
    const at = src.indexOf('portalUrl("/demo")');
    expect(src.slice(at - 400, at)).toContain("Get started free");
  });

  it("opens the portal's demo page, not a page of the website", () => {
    expect(portalUrl("/demo")).toMatch(/^https:\/\/admin\.[a-z0-9.-]+\/demo$/);
    expect(PORTAL_PATH_PREFIXES).toContain("/demo");
    const out = siteRoute({ host: "www.weaverams.org", pathname: "/demo", search: "?kind=faith", https: true, domain: "weaverams.org", portal: "https://admin.weaverams.org" });
    expect(out).toEqual({ kind: "redirect", location: "https://admin.weaverams.org/demo?kind=faith" });
  });
});
