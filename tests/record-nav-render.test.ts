import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A record page hands its sections to the left panel (docs/CRM_NAV_REDESIGN_PLAN.md, slice 3). Rendered once on the server: what the
// panel draws while a record is registered, and that the registering part draws nothing itself.
let pathname = "/households/hh-1";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { RecordNav, RecordNavProvider, type RecordNavData } from "@/components/shell/record-nav";
import { SectionPanel } from "@/components/shell/section-panel";
import { NEUTRAL_KIND } from "@/lib/kind";
import type { TabContext } from "@/lib/giving-today/tabs";
import { visibleWorkspaces } from "@/lib/workspaces";
import { sectionsFor } from "@/lib/workspace-sections";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement) => renderToStaticMarkup(el);

const ctx: TabContext = { permissions: ["people.view", "people.manage", "giving.view"], isPlatformAdmin: false, modulesOff: [], kind: NEUTRAL_KIND };
const record: RecordNavData = {
  title: "Hassan household",
  subtitle: "No. 0301 · RCC-H-1102 · Riverside",
  backHref: "/households",
  backLabel: "Households",
  items: [
    { key: "giving", label: "Giving", href: "/households/hh-1?tab=giving", active: true },
    { key: "memberships", label: "Memberships", href: "/households/hh-1?tab=memberships", active: false },
    { key: "history", label: "History", href: "/households/hh-1?tab=history", active: false },
  ],
};
const items = visibleWorkspaces(ctx).map(({ key, label, href, icon, placement, paths, tabs }) => ({ key, label, href, icon, placement, paths, tabs }));
const panel = (initial: RecordNavData | null) =>
  render(h(RecordNavProvider, { initial }, h(SectionPanel, { workspaces: items, sections: sectionsFor(visibleWorkspaces(ctx), ctx), initial: "auto" })));

beforeEach(() => {
  pathname = "/households/hh-1";
});

describe("the left panel on a record page", () => {
  it("lists the workspace's sections until a record is registered", () => {
    const html = panel(null);
    expect(html).toContain('aria-label="People sections"');
    expect(html).toContain(">Membership applications<");
    expect(html).not.toContain("Hassan household");
  });

  it("swaps them for the record's own: a way back, its name and card line, its sections with the open one lit", () => {
    const html = panel(record);
    expect(html).toContain('aria-label="Hassan household sections"');
    expect(html).toMatch(/<a [^>]*href="\/households"[^>]*>[\s\S]*?Households<\/a>/);
    expect(html).toContain("Hassan household");
    expect(html).toContain("No. 0301 · RCC-H-1102 · Riverside");
    expect(html.match(/<a [^>]*aria-current="page"[^>]*aria-label="([^"]*)"/)?.[1]).toBe("Giving");
    for (const t of ["Giving", "Memberships", "History"]) expect(html).toContain(`aria-label="${t}"`);
    expect(html).not.toContain(">Membership applications<");
  });

  it("keeps a way to the rest of the workspace", () => {
    expect(panel(record)).toMatch(/<a [^>]*class="v2-panel-foot-link"[^>]*>All People sections<\/a>/);
  });

  it("draws nothing itself when a page registers a record", () => {
    expect(render(h(RecordNavProvider, {}, h(RecordNav, record)))).toBe("");
  });
});
