import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The home draws the find box and the Add a family sheet, which call server actions and the router; here nothing is called, only rendered.
vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/search/find-actions", () => ({ findAction: vi.fn() }));
vi.mock("@/app/(app)/people/add-family-actions", () => ({ addFamilyAction: vi.fn(), findFamilyMatchesAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/people" }));

import { sampleHome } from "@/app/dev/people-home/fixtures";
import { AddFamilyButton } from "@/components/people-v2/add-family-button";
import { PeopleHome } from "@/components/people-v2/people-home";

const home = (canAddFamily: boolean) => renderToStaticMarkup(createElement(PeopleHome, { model: { ...sampleHome({ recents: false, withInbox: false }), canAddFamily } }));

describe("Add a family on the People home", () => {
  it("is offered to a role that may add a family, next to the Lists menu", () => {
    const html = home(true);
    expect(html).toContain("+ Add a family");
    expect(html).toContain("Lists");
  });

  it("is not offered to a role that may not, and the rest of the home is unchanged", () => {
    const html = home(false);
    expect(html).not.toContain("Add a family");
    expect(html).toContain("Lists");
    expect(html).toContain("Find a family or a person");
  });

  it("opens nothing until it is pressed: the sheet is closed on arrival", () => {
    const html = renderToStaticMarkup(createElement(AddFamilyButton));
    expect(html).toContain("+ Add a family");
    expect(html).not.toContain('role="dialog"');
  });
});
