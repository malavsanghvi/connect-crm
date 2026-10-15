import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// SiteLink reads the request's host (an async server component); the pages are rendered here with a plain link instead.
vi.mock("@/components/site/ui", async (importOriginal) => {
  const { createElement: h } = await import("react");
  const real = await importOriginal<typeof import("@/components/site/ui")>();
  return { ...real, SiteLink: ({ to, className, children }: { to: string; className?: string; children: ReactNode }) => h("a", { href: to, className }, children) };
});

import HomePage from "@/app/site/page";
import PricingPage, { metadata as pricingMetadata } from "@/app/site/pricing/page";
import { OWNER_FACTS } from "@/components/site/facts";
import { RESOURCES_MENU } from "@/components/site/header";
import { TipCheckoutMock } from "@/components/site/mockups";

// Owner decision 2026-10-15 ("Remove $25 from everywhere"): the optional Chip In stays, but no fixed dollar limit appears on the
// website or in its code. The yearly limit per account is a per-organization setting, counted per calendar year and changed only by
// a platform admin; until one sets it for an organization, nobody there is asked for a Chip In (docs/DECISIONS.md, docs/BACKLOG.md B51).

/** Things the website must never say again. Each pattern is tested against the sources and against the rendered pages. */
const NEVER: [string, RegExp][] = [
  // "$251.00" in a sample giving screen is a different number, so only "$25" followed by a non-digit counts.
  ["a $25 figure", /\$\s?25(?![\d,])/],
  ["\"25 a year\" (or per year)", /\b25\s*(?:a|per|\/)\s*(?:year|yr)\b/i],
  ["twenty-five", /twenty[- ]five/i],
  ["a cap on the Chip In", /\bcapped at\b|\b(?:yearly|annual) cap\b|\bcap reached\b|\bthe cap\b|\bwe cap\b/i],
  ["the removed constant", /TIP_YEARLY_CAP|YEARLY_CAP|CAP_CENTS/],
];

const WEBSITE_DIRS = ["src/app/site", "src/components/site"];
const WEBSITE_FILES = ["src/lib/site.ts"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : /\.(?:tsx?|css|json|csv)$/.test(entry.name) ? [path] : [];
  });
}

const offences = (text: string) => NEVER.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'");

describe("the website names no fixed Chip In amount", () => {
  it("has none in any source file of the website", () => {
    const files = [...WEBSITE_DIRS.flatMap(filesUnder), ...WEBSITE_FILES];
    expect(files.length).toBeGreaterThan(8);
    const found = files.flatMap((file) => offences(readFileSync(file, "utf8")).map((label) => `${file}: ${label}`));
    expect(found).toEqual([]);
  });

  it("has none in the rendered home page, pricing page, checkout sketch, menu or page description", () => {
    const rendered: Record<string, string> = {
      home: html(createElement(HomePage)),
      pricing: html(createElement(PricingPage)),
      checkout: html(createElement(TipCheckoutMock)),
      menu: RESOURCES_MENU.map((entry) => `${entry.title} ${entry.body}`).join(" "),
      description: String(pricingMetadata.description),
    };
    for (const [name, text] of Object.entries(rendered)) {
      expect(text.length, name).toBeGreaterThan(40);
      expect(offences(plain(text)), name).toEqual([]);
    }
  });

  it("has none in the brand kit's wording either", () => {
    expect(offences(readFileSync("brand/README.md", "utf8"))).toEqual([]);
  });
});

describe("the pricing page promises only the optional Chip In and a yearly limit that is set per organization", () => {
  const page = plain(html(createElement(PricingPage)));

  it("says the Chip In is optional, one tap to skip, added on top and never required", () => {
    expect(page).toContain("Always optional: one tap on “No Chip In” and they pay exactly what you charged");
    expect(page).toContain("Added on top of the amount you set, never taken out of it");
    expect(page).toContain("Paying never requires a Chip In.");
    expect(page).toContain("A suggested Chip In will appear at checkout.");
  });

  it("says the organization never pays Weaver and Weaver takes no percentage", () => {
    expect(page).toContain("Your organization never pays us, and we take no percentage of what your members pay you");
    expect(page).toContain("Your organization pays us");
    expect(page).toContain("No. We do not take a cut of what your members pay your organization.");
  });

  it("says there is a yearly limit per account, set for each organization, counted per calendar year, and that we stop asking once it is reached", () => {
    expect(page).toContain("Always optional, with a yearly limit on every account");
    expect(page).toContain("counted per calendar year across every transaction and set separately for each organization");
    expect(page).toContain("Once an account reaches it, we stop asking until the next year.");
    expect(page).toContain("Until a limit is set for an organization, its members are not asked for a Chip In at all.");
  });

  it("shows the checkout cases instead of a table that ends at a limit", () => {
    expect(page).toContain("What happens at checkout");
    for (const when of ["Chooses “No Chip In”", "Adds a Chip In", "Has reached their yearly limit"]) expect(page).toContain(when);
    expect(page).not.toContain("Chip Ins so far");
  });

  it("describes the model in the future tense in the page description, as the home page does", () => {
    expect(pricingMetadata.description).toContain("Members will be able to add an optional Chip In, with a yearly limit on each account.");
  });
});

describe("the checkout sketch", () => {
  const sketch = plain(html(createElement(TipCheckoutMock)));

  it("offers 'No Chip In' and shows no limit and no running total", () => {
    expect(sketch).toContain("Checkout · example");
    expect(sketch).toContain("No Chip In");
    expect(sketch).toContain("Each account has a yearly limit, and once it is reached we stop asking.");
    expect(sketch).not.toMatch(/Chip Ins this year|progressbar|\d of \$/i);
  });
});

describe("the home page's answer about the Chip In", () => {
  it("says members will be able to add an optional Chip In, one tap to skip, with a yearly limit (no start date while the owner has none)", () => {
    expect(OWNER_FACTS.chipInStarts).toBeNull();
    const home = plain(html(createElement(HomePage)));
    expect(home).toContain("Members will be able to add an optional Chip In. It is always one tap to skip, and each account has a yearly limit.");
    expect(home).not.toMatch(/From [A-Z][a-z]+ \d{4}, members/);
  });

  it("starts the sentence with the owner's date once there is one", () => {
    const before = OWNER_FACTS.chipInStarts;
    try {
      OWNER_FACTS.chipInStarts = "January 2027";
      expect(plain(html(createElement(HomePage)))).toContain("From January 2027, members will be able to add an optional Chip In. It is always one tap to skip, and each account has a yearly limit.");
    } finally {
      OWNER_FACTS.chipInStarts = before;
    }
  });

  it("links to the pricing page from the menu with a yearly limit and no number", () => {
    const entry = RESOURCES_MENU.find((e) => e.to === "/pricing#how-we-stay-free");
    expect(entry?.body).toBe("Optional Chip Ins, with a yearly limit on each account");
  });
});
