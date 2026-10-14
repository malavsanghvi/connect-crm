import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The component only asks the router to re-render the page; here nothing is mounted, only rendered once.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { RefreshWhileBusy } from "@/components/refresh-while-busy";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("RefreshWhileBusy (a page that waits on a background job refreshes itself)", () => {
  it("shows nothing while nothing is running", () => {
    expect(render(createElement(RefreshWhileBusy, { active: false }))).toBe("");
  });

  it("says in plain words that the page checks again by itself while something runs", () => {
    const html = render(createElement(RefreshWhileBusy, { active: true }));
    expect(html).toContain("This page checks again by itself every few seconds.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Reload this page");
  });

  it("takes a class for its place on the page", () => {
    expect(render(createElement(RefreshWhileBusy, { active: true, className: "mt-1" }))).toContain("mt-1");
  });
});
