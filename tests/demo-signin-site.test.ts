import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PORTAL_PATH_PREFIXES, memberAppDemoUrl, memberAppUrl, portalUrl, siteRoute } from "@/lib/site";

// The pages of the website are rendered by the server as a whole (their header suspends), so, as the in-page link tests do, this reads
// their source: each page has the button, pointing at the portal's /demo, beside Get started free.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const BUTTON = /<a href=\{portalUrl\("\/demo"\)\}[\s\S]{0,200}?>\s*Try the demo\s*<\/a>/;

describe("Try the demo on the public website", () => {
  it("is on the home page, in the hero beside Get started free", () => {
    const src = read("src/app/site/page.tsx");
    expect(src).toMatch(BUTTON);
    // The hero comes first in the file: its demo button sits right after its Get started free.
    expect(src.indexOf("Try the demo") - src.indexOf("Get started free")).toBeLessThan(400);
  });

  it("is on the pricing page, beside Get started free", () => {
    const src = read("src/app/site/pricing/page.tsx");
    expect(src).toMatch(BUTTON);
    const at = src.indexOf('portalUrl("/demo")');
    expect(src.slice(at - 400, at)).toContain("Get started free");
  });

  it("is also a band right under the hero that says it takes under a minute and links to the demo", () => {
    const home = read("src/app/site/page.tsx");
    expect(home).toContain("<ExperienceBand />");
    expect(home.indexOf("<Hero />")).toBeLessThan(home.indexOf("<ExperienceBand />"));
    expect(home.indexOf("<ExperienceBand />")).toBeLessThan(home.indexOf("<WhoWeServe />"));
    expect(home).toContain('href="#experience"');
    const band = read("src/components/site/experience-band.tsx");
    expect(band).toContain("Experience Weaver in less than a minute");
    expect(band).toContain('id="experience"');
    expect(band).toMatch(/<a href=\{portalUrl\("\/demo"\)\}[\s\S]{0,200}?>\s*Start the demo/);
    // Only what the demo does today: invented people, nothing sent, practice payments.
    expect(band).toContain("nothing real is ever sent");
    expect(band).toContain("payments are only for practice");
  });

  it("the demo page itself says it takes under a minute", () => {
    expect(read("src/app/demo/page.tsx")).toContain("in less than a minute");
  });

  it("the band has a second, quieter link under the Start button to the member app's own demo", () => {
    const band = read("src/components/site/experience-band.tsx");
    expect(band).toMatch(/<a\s+href=\{memberAppDemoUrl\(\)\}[\s\S]{0,300}?>\s*Or see the member app in your browser\s*<\/a>/);
    // Quieter: the big gold button comes first, and the link is not a button.
    expect(band.indexOf("Start the demo")).toBeLessThan(band.indexOf("Or see the member app in your browser"));
    const link = band.slice(band.indexOf("href={memberAppDemoUrl()}") - 20, band.indexOf("Or see the member app in your browser"));
    expect(link).not.toContain("buttonStyles");
  });

  it("the demo page points to the member app's demo in one sentence", () => {
    const page = read("src/app/demo/page.tsx");
    expect(page).toContain("href={memberAppDemoUrl()}");
    expect(page).toContain("Try the member app in your browser");
  });

  it("the member app's demo address is the member app's own: its configured address, else app.<domain>, plus /demo", () => {
    expect(memberAppDemoUrl(null, "weaverams.org")).toBe("https://app.weaverams.org/demo");
    expect(memberAppDemoUrl("", "weaverams.org")).toBe("https://app.weaverams.org/demo");
    expect(memberAppDemoUrl("https://app.weaverams.org/", "weaverams.org")).toBe("https://app.weaverams.org/demo");
    expect(memberAppDemoUrl("https://members.example.org", "weaverams.org")).toBe("https://members.example.org/demo");
    expect(memberAppDemoUrl("not a url", "example.org")).toBe("https://app.example.org/demo");
    expect(memberAppDemoUrl("javascript:alert(1)", "example.org")).toBe("https://app.example.org/demo");
    expect(memberAppUrl("https://app.weaverams.org///", "weaverams.org")).toBe("https://app.weaverams.org");
  });

  it("opens the portal's demo page, not a page of the website", () => {
    expect(portalUrl("/demo")).toMatch(/^https:\/\/admin\.[a-z0-9.-]+\/demo$/);
    expect(PORTAL_PATH_PREFIXES).toContain("/demo");
    const out = siteRoute({ host: "www.weaverams.org", pathname: "/demo", search: "?kind=faith", https: true, domain: "weaverams.org", portal: "https://admin.weaverams.org" });
    expect(out).toEqual({ kind: "redirect", location: "https://admin.weaverams.org/demo?kind=faith" });
  });
});
