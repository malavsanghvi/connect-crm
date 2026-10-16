import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The top bar's workspaces and the left section panel (docs/CRM_NAV_REDESIGN_PLAN.md), rendered once on the server (the repo has no
// browser test environment): which links they draw, in what order, which one is lit. How many links fit is workspace-fit.test.ts.
let pathname = "/giving/pledges";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/auth-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/look-actions", () => ({ setLookAction: vi.fn() }));

import { AccountPanel } from "@/components/shell/user-menu-v2";
import { SectionPanel, monogram } from "@/components/shell/section-panel";
import { WorkspaceMenu } from "@/components/shell/workspace-menu";
import { ROLE_PERMISSIONS } from "@/lib/giving-today/fixtures";
import type { TabContext } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND } from "@/lib/kind";
import { visibleWorkspaces } from "@/lib/workspaces";
import { sectionsFor } from "@/lib/workspace-sections";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement) => renderToStaticMarkup(el);
const noop = () => {};

const ctx = (permissions: string[], extra: Partial<TabContext> = {}): TabContext => ({ permissions, isPlatformAdmin: false, modulesOff: ["bolis"], kind: NEUTRAL_KIND, ...extra });
const items = (c: TabContext) => visibleWorkspaces(c).map(({ key, label, href, icon, placement, paths, tabs }) => ({ key, label, href, icon, placement, paths, tabs }));
const labels = (html: string) => [...html.matchAll(/class="v2-top-item"[^>]*>([^<]*)</g)].map((m) => m[1]);

beforeEach(() => {
  pathname = "/giving/pledges";
});

describe("the top bar's workspaces", () => {
  const admin = ctx(ROLE_PERMISSIONS.treasurer, { isPlatformAdmin: true });

  it("draws the workspaces the person may open as text links, in order, with Settings and Platform left to the gear and the account menu", () => {
    const html = render(h(WorkspaceMenu, { workspaces: items(admin) }));
    expect(html).toContain('<nav aria-label="Workspaces" class="v2-top-menu">');
    const row = html.slice(html.indexOf('<ul class="v2-top-list">'), html.indexOf("</ul>"));
    expect(labels(row)).toEqual(visibleWorkspaces(admin).filter((w) => w.placement === "start").map((w) => w.label));
    expect(row).not.toContain(">Settings<");
    expect(row).not.toContain(">Platform<");
  });

  it("lights the open workspace and no other, also on a page of a module that belongs to it", () => {
    const html = render(h(WorkspaceMenu, { workspaces: items(admin) }));
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    expect(html.match(/<a [^>]*aria-current="page"[^>]*>([^<]*)</)?.[1]).toBe("Giving");
    pathname = "/accounting/close";
    expect(render(h(WorkspaceMenu, { workspaces: items(admin) })).match(/<a [^>]*aria-current="page"[^>]*>([^<]*)</)?.[1]).toBe("Giving");
  });

  it("lights none of the row while Settings is open", () => {
    pathname = "/setup";
    expect(render(h(WorkspaceMenu, { workspaces: items(admin) }))).not.toContain('aria-current="page"');
  });

  it("keeps the spotlight marker of every workspace, so a guided tour still finds it", () => {
    const html = render(h(WorkspaceMenu, { workspaces: items(admin) }));
    expect(html).toContain('data-spotlight="nav-giving"');
    expect(html).toContain('data-spotlight="nav-people"');
  });

  it("says how many tasks are waiting on Today, in words for a screen reader", () => {
    const html = render(h(WorkspaceMenu, { workspaces: items(admin), todayBadge: "3", todayBadgeLabel: "3 tasks waiting" }));
    expect(html).toContain('aria-hidden="true">3</span>');
    expect(html).toContain(", 3 tasks waiting");
  });

  it("lists Platform in the account menu for the person who has it", () => {
    const panel = render(
      h(AccountPanel, { id: "a", name: "P", email: null, role: "Admin", roles: [], action: noop, pending: false, error: null, onNavigate: noop, links: [{ label: "Platform", href: "/platform" }] }),
    );
    expect(panel).toContain(">Platform<");
    expect(panel).toContain('href="/platform"');
    expect(render(h(AccountPanel, { id: "a", name: "P", email: null, role: "Admin", roles: [], action: noop, pending: false, error: null, onNavigate: noop }))).not.toContain(">Platform<");
  });
});

describe("the left section panel", () => {
  const treasurer = ctx(ROLE_PERMISSIONS.treasurer);
  const panel = (c: TabContext, initial: "open" | "closed" | "auto" = "auto") => render(h(SectionPanel, { workspaces: items(c), sections: sectionsFor(visibleWorkspaces(c), c), initial }));

  it("lists the open workspace's sections under their headings and lights the page being read", () => {
    const html = panel(treasurer);
    expect(html).toContain('aria-label="Giving sections"');
    for (const heading of ["Money in", "Bank and books", "Campaigns", "Donors and insights"]) expect(html).toContain(heading);
    expect(html.match(/<a [^>]*aria-current="page"[^>]*aria-label="([^"]*)"/)?.[1]).toBe("Pledges");
    expect(html).toContain('href="/giving/payments/bank"');
  });

  it("gives every link its name for a screen reader, so the collapsed strip is usable", () => {
    const links = [...panel(treasurer).matchAll(/<a [^>]*class="v2-panel-item"[^>]*>/g)].map((m) => m[0]);
    expect(links.length).toBeGreaterThan(5);
    for (const a of links) expect(a).toMatch(/aria-label="[^"]+"/);
  });

  it("carries the person's choice to the stylesheet", () => {
    expect(panel(treasurer, "closed")).toContain('data-state="closed"');
    expect(panel(treasurer, "open")).toContain('data-state="open"');
    expect(panel(treasurer)).toContain('data-state="auto"');
  });

  it("shows Books' views under Books while Books is open, and not otherwise", () => {
    pathname = "/accounting/qbo/mapping";
    const open = panel(treasurer);
    expect(open).toContain('class="v2-panel-sub"');
    expect(open.match(/<a aria-current="page" class="v2-panel-subitem" href="([^"]*)"/)?.[1]).toBe("/accounting/qbo/mapping");
    pathname = "/giving/pledges";
    expect(panel(treasurer)).not.toContain('class="v2-panel-sub"');
  });

  it("is not drawn for a page outside every workspace, or for a workspace with fewer than two sections", () => {
    pathname = "/account/security";
    expect(panel(treasurer)).toBe("");
    pathname = "/";
    expect(panel(treasurer)).toBe("");
  });

  it("names a section with two letters for the collapsed strip", () => {
    expect(monogram("Payment confirmations")).toBe("Pc");
    expect(monogram("Pledges")).toBe("Pl");
    expect(monogram("Campaigns & opportunities")).toBe("Co");
    expect(monogram("")).toBe("");
  });
});
