import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FilterMenu } from "@/components/list-toolbar/filter-menu";
import { ListToolbar } from "@/components/list-toolbar/list-toolbar";
import { menuView } from "@/lib/list-toolbar";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToStaticMarkup(el);
const chip = (key: string, label: string, on = false, count: number | null = null) => ({ key, label, href: `/list?f=${key}`, count, on });

describe("the one-line list toolbar", () => {
  const methods = [chip("", "All methods", true), chip("check", "Check"), chip("zelle", "Zelle")];
  const buckets = [chip("1_30", "1 to 30 days · $96,200", false, 64), chip("90", "Over 90 days · $27,100", false, 14)];

  it("draws the switch as links with the lit one marked, and a dropdown for each other filter, on one row", () => {
    const out = html(
      h(ListToolbar, {
        search: h("input", { "aria-label": "Search" }),
        switchLabel: "Pledges to show",
        switchChips: [chip("open", "Open", true, 6), chip("closed", "Closed", false, 31)],
        menus: [{ label: "Method", view: menuView(methods) }],
        summary: "$412,300 open across 312 pledges",
      }),
    );
    expect(out).toContain('<nav aria-label="Pledges to show"');
    expect(out).toMatch(/aria-current="page"[^>]*>Open<span[^>]*>6<\/span>/);
    expect(out).toMatch(/<button[^>]*data-on="false"[^>]*>Method</);
    expect(out).toContain("$412,300 open across 312 pledges");
    expect(out.match(/<input/g)).toHaveLength(1);
  });

  it("keeps a dropdown's options out of the page until it is opened, so a list is not buried under them", () => {
    const out = html(h(ListToolbar, { menus: [{ label: "Method", view: menuView(methods) }] }));
    expect(out).not.toContain("Zelle");
    expect(out).toContain('aria-expanded="false"');
  });

  it("says the chosen value on the chip, and marks it on", () => {
    const v = menuView([chip("", "All methods"), chip("check", "Check"), chip("zelle", "Zelle", true)]);
    expect(html(h(FilterMenu, { label: "Method", view: v }))).toMatch(/<button[^>]*data-on="true"[^>]*>Method: Zelle</);
  });

  it("opens to links, each the address the list already builds, with the lit option marked", () => {
    const out = html(h(FilterMenu, { label: "Behind by", view: menuView(buckets, { label: "Any", href: "/list" }), startOpen: true }));
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('href="/list"');
    expect(out).toContain('href="/list?f=1_30"');
    expect(out).toContain("Over 90 days · $27,100");
    expect(out).toMatch(/aria-current="page"[^>]*>Any</);
    expect(out).toContain(">64<");
  });

  it("draws nothing for a filter with no options", () => {
    expect(html(h(FilterMenu, { label: "Source", view: menuView([]) }))).toBe("");
  });
});
