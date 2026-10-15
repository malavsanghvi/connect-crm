import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PORTAL_PATH_PREFIXES, memberAppDemoFamilyUrl, memberAppDemoPersonUrl, memberAppDemoUrl, memberAppUrl, portalUrl, siteRoute } from "@/lib/site";

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

  it("the band has a second, quieter link under the Start button that steps into the member app's demo as a family", () => {
    const band = read("src/components/site/experience-band.tsx");
    expect(band).toMatch(/<a\s+href=\{memberAppDemoFamilyUrl\(\)\}[\s\S]{0,300}?>\s*Or step into the member app as a family\s*<\/a>/);
    expect(band).not.toContain("Or see the member app in your browser");
    // Quieter: the big gold button comes first, and the link is not a button.
    expect(band.indexOf("Start the demo")).toBeLessThan(band.indexOf("Or step into the member app as a family"));
    const link = band.slice(band.indexOf("href={memberAppDemoFamilyUrl()}") - 20, band.indexOf("Or step into the member app as a family"));
    expect(link).not.toContain("buttonStyles");
    // What the band claims stays true for it: the same invented people, nothing real is sent, practice payments.
    expect(band).toContain("Everything in the demo is invented");
    expect(band).toContain("nothing real is ever sent");
  });

  it("the band's member app link is <member app>/demo?as=family, and a community can be named", () => {
    expect(memberAppDemoFamilyUrl(null, null, "weaverams.org")).toBe("https://app.weaverams.org/demo?as=family");
    expect(memberAppDemoFamilyUrl(undefined, "", "weaverams.org")).toBe("https://app.weaverams.org/demo?as=family");
    expect(memberAppDemoFamilyUrl("", "https://app.weaverams.org/", "weaverams.org")).toBe("https://app.weaverams.org/demo?as=family");
    expect(memberAppDemoFamilyUrl("sunrise-demo", "https://app.weaverams.org", "weaverams.org")).toBe("https://app.weaverams.org/demo?as=family&community=sunrise-demo");
    expect(memberAppDemoFamilyUrl("a b&c", "https://members.example.org", "weaverams.org")).toBe("https://members.example.org/demo?as=family&community=a%20b%26c");
    // An address that is not http(s) never reaches a link.
    expect(memberAppDemoFamilyUrl(null, "javascript:alert(1)", "example.org")).toBe("https://app.example.org/demo?as=family");
  });

  it("a demo person's member app link is <member app>/demo?persona=<id>, the id encoded", () => {
    const id = "6c4a2d8f-0d0c-4a8e-9a55-0f1d2c3b4a52";
    expect(memberAppDemoPersonUrl(id, null, "weaverams.org")).toBe(`https://app.weaverams.org/demo?persona=${id}`);
    expect(memberAppDemoPersonUrl(id, "https://app.weaverams.org/", "weaverams.org")).toBe(`https://app.weaverams.org/demo?persona=${id}`);
    expect(memberAppDemoPersonUrl(` ${id} `, "https://members.example.org", "weaverams.org")).toBe(`https://members.example.org/demo?persona=${id}`);
    // Nothing but an id can ride in the address.
    expect(memberAppDemoPersonUrl("x&as=family#top", null, "weaverams.org")).toBe("https://app.weaverams.org/demo?persona=x%26as%3Dfamily%23top");
    expect(memberAppDemoPersonUrl(id, "not a url", "example.org")).toBe(`https://app.example.org/demo?persona=${id}`);
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
