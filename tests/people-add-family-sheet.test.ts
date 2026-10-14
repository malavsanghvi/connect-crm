import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The AddFamilySheet and its dev preview, drawn on the server (the typing, the live check and Enter are in the browser; their rules
// are tested in people-family.test.ts and the Server Actions in people-add-family-actions.test.ts). Server actions are replaced.
vi.mock("next/navigation", async (orig) => ({ ...((await orig()) as object), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/people/add-family-actions", () => ({ addFamilyAction: vi.fn(), findFamilyMatchesAction: vi.fn() }));

import AddFamilyPreview from "@/app/dev/people-add-family/page";
import { CJK_MATCHES, MATCHES } from "@/app/dev/people-add-family/fixtures";
import { AddFamilySheet, MatchesPanel, draftFromName } from "@/components/people-v2/add-family-sheet";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const draw = (props: Record<string, unknown>) => renderToStaticMarkup(h(AddFamilySheet, { open: true, onClose: () => {}, ...props }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

afterEach(() => vi.unstubAllEnvs());

describe("the sheet", () => {
  it("draws nothing while closed", () => {
    expect(draw({ open: false })).toBe("");
  });

  it("asks for the first adult, one box for a mobile or an email, and an optional street: no child, no birth date", () => {
    const html = draw({});
    const words = text(html);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    for (const w of ["Add a family", "First name", "Last name", "Mobile or email", "Street (optional)", "Add family", "Cancel", "Enter adds. Asks for nothing else."]) expect(words).toContain(w);
    expect(words).not.toMatch(/date of birth|relationship|child|spouse|Already here\?/i);
    expect(words).toContain("Everyone else is added from the family's page.");
  });

  it("starts from what was typed in the box: the last word is the last name", () => {
    expect(draftFromName("Priya Shah")).toEqual({ firstName: "Priya", lastName: "Shah" });
    expect(draftFromName("  Mary Ann  Smith ")).toEqual({ firstName: "Mary Ann", lastName: "Smith" });
    expect(draftFromName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(draftFromName("李 明")).toEqual({ firstName: "李", lastName: "明" });
    expect(draftFromName(undefined)).toEqual({ firstName: "", lastName: "" });
    const html = draw({ initialName: "Priya Shah" });
    expect(html).toContain('value="Priya"');
    expect(html).toContain('value="Shah"');
  });

  it("says 'You don't have access to this area' instead of the form when the role cannot add", () => {
    const words = text(draw({ canAdd: false }));
    expect(words).toContain("You don't have access to this area");
    expect(words).not.toContain("First name");
  });
});

describe("the 'Already here?' panel", () => {
  const panel = (props: Record<string, unknown>) => renderToStaticMarkup(h(MatchesPanel, { onOpen: () => {}, confirming: false, ...props }));

  it("shows each family as its household card with why, strongest first, and 'Open it'", () => {
    const html = panel({ view: { total: 3, matches: [MATCHES[2], MATCHES[0], MATCHES[1]] } });
    const words = text(html);
    expect(words).toContain("Already here?");
    expect(words).toContain("3 families may already be this one.");
    // The same mobile and name before the same last name alone.
    expect(words.indexOf("Priya Shah & Rahul Shah")).toBeLessThan(words.indexOf("Hana Shah & Omar Hassan"));
    expect(words).toContain("No. H-1001 · RNA-2041 · Austin · North Riverside");
    expect(words).toContain("Same mobile");
    expect(words).toContain("Same last name");
    expect((html.match(/>Open it<\/button>/g) ?? []).length).toBe(3);
    expect(html).toContain("Open Priya Shah and Rahul Shah, household H-1001");
  });

  it("says how many more there are than shown", () => {
    expect(text(panel({ view: { total: 12, matches: MATCHES } }))).toContain("and 9 more with a similar name.");
  });

  it("shows names in Chinese and Arabic as they are", () => {
    const words = text(panel({ view: { total: 1, matches: CJK_MATCHES } }));
    expect(words).toContain("李 明 & ليلى الحسن");
    expect(words).toContain("Same email");
  });

  it("says nothing alike in words, and a family the role cannot open without pretending it is not there", () => {
    expect(text(panel({ view: { total: 0, matches: [] } }))).toContain("No family like this yet.");
    const hidden = text(panel({ view: { total: 2, matches: [] } }));
    expect(hidden).toContain("2 families may already be this one.");
    expect(hidden).toContain("check with someone who does before adding");
  });
});

describe("the dev route", () => {
  const call = (sp: Record<string, string> = {}) => AddFamilyPreview({ searchParams: Promise.resolve(sp) });

  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("draws the sheet with sample data outside production, whatever the scenario", async () => {
    for (const scenario of ["default", "matches", "confirm", "nomatch", "error", "adderror", "noaccess", "cjk", "nonsense"]) {
      const words = text(renderToStaticMarkup(await call({ scenario })));
      expect(words, scenario).toContain("DEV PREVIEW · SAMPLE DATA · Riverside Neighbourhood Association");
      expect(words, scenario).toContain("Add a family");
    }
    expect(text(renderToStaticMarkup(await call({ scenario: "noaccess" })))).toContain("You don't have access to this area");
  });
});
