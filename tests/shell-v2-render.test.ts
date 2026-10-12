import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The redesigned shell, rendered once on the server (the repo has no browser test environment): the rail and the phone's bottom bar
// show the right workspaces for the person, and the whole portal renders in both looks. Server actions are replaced; nothing is called.
let pathname = "/giving/payments";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/(app)/search/find-actions", () => ({ findAction: vi.fn() }));
vi.mock("@/app/auth-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/tenancy-actions", () => ({ switchCenterAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));
vi.mock("@/app/look-actions", () => ({ setLookAction: vi.fn() }));

import { NivaContext, type NivaApi } from "@/components/niva/niva-context";
import { initialChatState } from "@/lib/assistant/chat-state";
import { AppShell } from "@/components/shell/app-shell";
import { LookProvider } from "@/components/shell/look-context";
import { ModulesProvider, ModuleTabs } from "@/components/shell/module-tabs";
import { NivaSunButton } from "@/components/shell/niva-sun-button";
import { PhoneBar } from "@/components/shell/phone-bar";
import { UserMenu } from "@/components/shell/user-menu";
import { AccountPanel, UserMenuV2 } from "@/components/shell/user-menu-v2";
import { WorkspaceRail } from "@/components/shell/workspace-rail";
import { LEGACY_KIND } from "@/lib/kind";
import { visibleNav, type ScopedContext } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { visibleWorkspaces } from "@/lib/workspaces";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement) => renderToStaticMarkup(el);
const noop = () => {};

const ctx = (c: Partial<ScopedContext> = {}): ScopedContext => ({ permissions: [], isPlatformAdmin: false, ...c });
const asItems = (c: ScopedContext) => visibleWorkspaces(c).map(({ key, label, href, icon, placement, paths, tabs }) => ({ key, label, href, icon, placement, paths, tabs }));

function niva(over: Partial<NivaApi> = {}): NivaApi {
  return {
    enabled: true,
    aiReady: true,
    commands: [],
    nav: [],
    context: { path: "/" },
    dockOpen: false,
    paletteOpen: false,
    paletteQuery: "",
    openDock: noop,
    closeDock: noop,
    toggleDock: noop,
    openPalette: noop,
    closePalette: noop,
    chat: initialChatState,
    send: noop,
    stop: noop,
    retry: noop,
    newChat: noop,
    ask: noop,
    showResult: noop,
    showProposal: noop,
    ...over,
  };
}

/** The visible label of each link in a piece of markup, in order. */
const linkLabels = (html: string) => [...html.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((m) => (m[1].match(/class="v2-nav-label">([^<]*)</) ?? [])[1]);
const linkHrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  pathname = "/giving/payments";
});

describe("the rail", () => {
  const treasurer = ctx({ permissions: ["giving.view", "giving.manage", "people.view"] });
  const html = render(
    h(WorkspaceRail, { workspaces: asItems(treasurer), todayBadge: "3", todayBadgeLabel: "3 tasks waiting", account: h("a", { id: "me", href: "/account/security" }, "PM") }, h("button", { id: "niva-slot" }, "Niva")),
  );

  it("is a labelled navigation landmark of the workspaces the person may open, in order, each opening its first page (Giving its own page)", () => {
    expect(html).toContain('<nav aria-label="Workspaces"');
    expect(linkLabels(html).filter(Boolean)).toEqual(visibleWorkspaces(treasurer).map((w) => w.label));
    expect(linkHrefs(html).slice(0, 2)).toEqual(["/", "/households"]);
    expect(linkHrefs(html)).toContain("/giving");
  });

  it("marks the current workspace with aria-current and no other", () => {
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    const current = html.match(/<a [^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/)![1];
    expect(current).toContain(">Giving<");
  });

  it("marks Giving current on a Bolis page, because Bolis is part of the Giving workspace", () => {
    pathname = "/bolis/upload";
    const page = render(h(WorkspaceRail, { workspaces: asItems(ctx({ isPlatformAdmin: true })), account: h("span", null) }));
    expect(page.match(/<a [^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/)![1]).toContain(">Giving<");
  });

  it("says how many tasks are waiting on Today, in words for a screen reader", () => {
    expect(html).toContain('aria-hidden="true">3</span>');
    expect(html).toContain(", 3 tasks waiting");
  });

  it("puts Niva's button above the account link, at the bottom", () => {
    expect(html.indexOf('id="niva-slot"')).toBeGreaterThan(html.indexOf("</nav>"));
    expect(html.indexOf('id="me"')).toBeGreaterThan(html.indexOf('id="niva-slot"'));
  });

  it("is hidden below 768px (the phone has the bottom bar)", () => {
    expect(html).toMatch(/class="v2-rail hidden md:flex"/);
  });

  it("shows no Giving to a role without giving access", () => {
    const other = render(h(WorkspaceRail, { workspaces: asItems(ctx({ permissions: ["people.view"] })), account: h("span", null) }));
    expect(other).not.toContain(">Giving<");
    expect(other).toContain(">People<");
    expect(other).not.toContain(">Platform<");
  });

  it("keeps Settings and Platform apart at the bottom of the list", () => {
    const admin = render(h(WorkspaceRail, { workspaces: asItems(ctx({ isPlatformAdmin: true })), account: h("span", null) }));
    expect(linkLabels(admin).filter(Boolean)).toEqual(["Today", "People", "Giving", "Events", "Messages", "Learning", "Store", "Content", "Reports", "Settings", "Platform"]);
    expect(admin.indexOf("v2-rail-end")).toBeGreaterThan(admin.indexOf(">Reports<"));
    expect(admin.indexOf("v2-rail-end")).toBeLessThan(admin.indexOf(">Settings<"));
  });
});

describe("Niva's button in the rail and the bottom bar", () => {
  const button = (value: NivaApi | null, variant: "rail" | "bar") => render(h(NivaContext.Provider, { value }, h(NivaSunButton, { variant })));

  it("is the sun-gradient button, and says what it does", () => {
    const html = button(niva(), "rail");
    expect(html).toContain("v2-niva-rail");
    expect(html).toContain("v2-niva-orb");
    expect(html).toContain('aria-controls="niva-panel"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Niva");
  });

  it("shows nothing when Niva is off for this community, or outside the shell", () => {
    expect(button(niva({ enabled: false }), "bar")).toBe("");
    expect(button(null, "bar")).toBe("");
  });

  it("reports an open panel to assistive technology", () => {
    expect(button(niva({ dockOpen: true }), "bar")).toContain('aria-expanded="true"');
  });
});

describe("the phone's bottom bar", () => {
  const bar = (c: ScopedContext, children?: ReactElement) =>
    render(h(PhoneBar, { workspaces: asItems(c), todayBadge: null, footer: "Treasurer · 4 permissions." }, children));

  it("has Today, People, Giving, Events and More, in a labelled navigation", () => {
    const html = bar(ctx({ isPlatformAdmin: true }));
    expect(html).toContain('<nav aria-label="Main workspaces"');
    expect(html).toMatch(/class="v2-bar md:hidden"/);
    const labels = [...html.matchAll(/class="v2-nav-label">([^<]*)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Today", "People", "Giving", "Events", "More"]);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("marks the current workspace, and does not draw the sheet until More is opened", () => {
    const html = bar(ctx({ isPlatformAdmin: true }));
    expect(html.match(/<a [^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/)![1]).toContain(">Giving<");
    expect(html).not.toContain("v2-sheet");
  });

  it("marks More current when the page is in a workspace that lives under More", () => {
    pathname = "/comms/inbox";
    const html = bar(ctx({ isPlatformAdmin: true }));
    expect(html).toContain('data-active="true"');
    expect(html).not.toContain('aria-current="page"');
  });

  it("leaves out the workspaces the person cannot open, and More when there is nothing under it", () => {
    const html = bar(ctx({ permissions: ["giving.record_offline"] }));
    const labels = [...html.matchAll(/class="v2-nav-label">([^<]*)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Today", "Giving"]);
    const withMore = bar(ctx({ permissions: ["giving.record_offline", "reports.view"] }));
    expect([...withMore.matchAll(/class="v2-nav-label">([^<]*)</g)].map((m) => m[1])).toEqual(["Today", "Giving", "More"]);
    const none = bar(ctx());
    expect([...none.matchAll(/class="v2-nav-label">([^<]*)</g)].map((m) => m[1])).toEqual(["Today"]);
    expect(none).not.toContain(">More<");
  });

  it("puts Niva's button last, and leaves no empty slot when Niva is off", () => {
    const withNiva = render(h(NivaContext.Provider, { value: niva() }, h(PhoneBar, { workspaces: asItems(ctx({ isPlatformAdmin: true })), todayBadge: null, footer: "" }, h(NivaSunButton, { variant: "bar" }))));
    expect([...withNiva.matchAll(/class="v2-nav-label">([^<]*)</g)].map((m) => m[1]).slice(-2)).toEqual(["More", "Niva"]);
    const off = render(h(NivaContext.Provider, { value: null }, h(PhoneBar, { workspaces: asItems(ctx({ isPlatformAdmin: true })), todayBadge: null, footer: "" }, h(NivaSunButton, { variant: "bar" }))));
    // The wrapper list item is empty, which the stylesheet hides (.v2-bar-list > li:empty).
    expect(off).toMatch(/<li><\/li><\/ul>/);
  });
});

describe("the sub-navigation inside a workspace", () => {
  const admin = ctx({ isPlatformAdmin: true });
  const tabs = (look: "classic" | "v2") => render(h(LookProvider, { look }, h(ModulesProvider, { modules: visibleNav(admin) }, h(ModuleTabs, null))));

  it("keeps the module's own tab strip in both looks", () => {
    for (const look of ["classic", "v2"] as const) {
      const html = tabs(look);
      expect(html).toContain('aria-label="Giving sections"');
      expect(html).toContain(">Pledges<");
      expect(html).toContain('aria-current="page"');
    }
  });

  it("adds a row to reach the workspace's other modules in the new look only", () => {
    const v2 = tabs("v2");
    expect(v2).toContain('aria-label="Giving areas"');
    expect(linkHrefs(v2.slice(v2.indexOf("Giving areas")))).toContain("/bolis");
    expect(v2).toContain(">Accounting<");
    expect(tabs("classic")).not.toContain("areas");
  });

  it("adds no row where the workspace is one module", () => {
    pathname = "/reports";
    expect(tabs("v2")).not.toContain("areas");
    expect(tabs("v2")).toContain('aria-label="Reports sections"');
  });

  it("is exactly the old strip, character for character, in the classic look", () => {
    const classic = tabs("classic");
    expect(classic).toMatch(/^<nav aria-label="Giving sections" class="cc-tabs mt-4">/);
    expect(classic).not.toContain("v2-");
  });
});

describe("the look switch in the user menu", () => {
  const classicMenu = (look?: "classic" | "v2") =>
    render(h(UserMenu, { name: "Priya Mehta", email: "p@example.org", role: "Treasurer", roles: ["Treasurer"], initials: "P", look }));
  const panel = () =>
    render(h(AccountPanel, { id: "acct", name: "Priya Mehta", email: "p@example.org", role: "Treasurer", roles: ["Treasurer", "Event lead"], action: noop, pending: false, error: null, onNavigate: noop }));

  it("offers the New look in the classic top bar (to anyone who never chose, too)", () => {
    expect(classicMenu()).toContain(">New look<");
    expect(classicMenu("classic")).toContain(">New look<");
    expect(classicMenu("classic")).not.toContain("Classic look");
  });

  it("keeps the classic user menu's other buttons", () => {
    expect(classicMenu()).toContain(">Account<");
    expect(classicMenu()).toContain(">Sign out<");
  });

  it("is one avatar button in the new top bar, closed until opened", () => {
    const html = render(h(UserMenuV2, { name: "Priya Mehta", email: "p@example.org", role: "Treasurer", roles: ["Treasurer"], initials: "P" }));
    expect(html).toContain('aria-label="Priya Mehta, account menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Classic look");
  });

  it("offers the way back, Account and Sign out in the new account menu, with the person's name and roles", () => {
    const html = panel();
    expect(html).toContain(">Classic look<");
    expect(html).not.toContain(">New look<");
    expect(html).toContain("Account and security");
    expect(html).toContain('href="/account/security"');
    expect(html).toContain(">Sign out<");
    expect(html).toContain("Priya Mehta");
    expect(html).toContain("p@example.org");
    expect(html).toContain("Treasurer, Event lead");
  });

  it("shows a failed sign-out next to the button", () => {
    const html = render(h(AccountPanel, { id: "acct", name: "P", email: null, role: "Treasurer", roles: [], action: noop, pending: false, error: "Could not sign out — try again.", onNavigate: noop }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not sign out — try again.");
  });
});

describe("the whole portal in both looks", () => {
  const session = (over: Record<string, unknown> = {}) =>
    ({
      permissions: ["dashboard", "households", "pledges", "payments"],
      isPlatformAdmin: false,
      isOwner: false,
      userId: "u1",
      email: "treasurer@example.org",
      center: {
        id: "c1",
        slug: "jsh",
        name: "Jain Society",
        short_name: "JSH",
        time_zone: "America/New_York",
        currency: "USD",
        branding: {},
        feature_flags: {},
        rules: {},
        status: "active",
        environment: "production",
      },
      person: { id: "p1", name: "Priya Mehta", memberNumber: "1001" },
      roles: [{ key: "treasurer", name: "Treasurer", scopeKind: "center" }],
      grants: [{ role_key: "treasurer", scope_kind: "center", scope_id: null }],
      requestId: "r1",
      modulesOff: [],
      modulesStatus: "ok",
      kind: LEGACY_KIND,
      kindStatus: "ok",
      aal: "aal1",
      amr: [],
      centerSource: "default",
      switchable: [],
      ...over,
    }) as unknown as CrmSession;

  const shell = (s: CrmSession, look?: "classic" | "v2", tasks: unknown = null) =>
    render(h(AppShell, { session: s, tasks, look }, createElement("section", { id: "page" }, "Payments page")));

  it("renders the classic shell when no look is given, exactly as before", () => {
    const html = shell(session());
    expect(html).toContain('data-look="classic"');
    expect(html).toContain("cc-sidebar");
    expect(html).toContain("cc-topbar");
    expect(html).not.toContain("v2-rail");
    expect(html).not.toContain("v2-topbar");
    expect(html).toContain('<section id="page">Payments page</section>');
    expect(html).toContain("Sign out");
    expect(html).toContain(">New look<");
  });

  it("renders the same classic shell when the look is classic", () => {
    expect(shell(session(), "classic")).toBe(shell(session()));
  });

  it("renders the new shell without throwing: top bar, rail, page, bottom bar", () => {
    const html = shell(session(), "v2");
    expect(html).toContain('data-look="v2"');
    expect(html).toContain("v2-topbar");
    expect(html).toContain("v2-rail");
    expect(html).toContain("v2-bar");
    expect(html).not.toContain("cc-sidebar");
    expect(html).not.toContain("cc-topbar");
    expect(html).toContain('<main id="v2-main" tabindex="-1"');
    expect(html).toContain('<section id="page">Payments page</section>');
    expect(html).toContain("Jain Society");
    expect(html).toContain('aria-label="Priya Mehta, account menu"');
  });

  it("has the landmarks and a way past the navigation", () => {
    const html = shell(session(), "v2");
    expect(html).toContain('href="#v2-main"');
    expect(html).toContain("<header");
    expect(html).toContain('<nav aria-label="Workspaces"');
    expect(html).toContain('<nav aria-label="Main workspaces"');
    expect(html.indexOf('href="#v2-main"')).toBeLessThan(html.indexOf("<header"));
    expect(html).toContain('aria-label="Weaver home, Jain Society"');
  });

  it("shows the same workspaces as the classic sidebar shows modules (gating is shared)", () => {
    const s = session({ permissions: ["dashboard", "people.view"] });
    const v2 = shell(s, "v2");
    const rail = v2.slice(v2.indexOf('<nav aria-label="Workspaces"'), v2.indexOf("</nav>", v2.indexOf('<nav aria-label="Workspaces"')));
    expect(rail).toContain(">Today<");
    expect(rail).toContain(">People<");
    expect(rail).not.toContain(">Giving<");
    expect(rail).not.toContain(">Platform<");
    const classic = shell(s, "classic");
    expect(classic).not.toContain("/giving/pledges");
  });

  it("gives the Today link the number of tasks waiting, as in the classic sidebar", () => {
    const v2 = shell(session(), "v2", { ok: true, count: 4 });
    expect(v2).toContain("4 tasks waiting");
    expect(shell(session(), "classic", { ok: true, count: 4 })).toContain("4 tasks waiting");
  });

  it("shows a platform admin the Platform workspace and the sandbox watermark in the new look", () => {
    const v2 = shell(session({ isPlatformAdmin: true, center: { ...session().center, environment: "sandbox" } }), "v2");
    expect(v2).toContain(">Platform<");
    expect(v2).toContain("Sandbox");
  });

  it("keeps the staff-role notice for someone with no staff role", () => {
    const s = session({ permissions: [], roles: [], grants: [] });
    for (const look of ["classic", "v2"] as const) expect(shell(s, look)).toContain("hold no staff role at Jain Society");
  });
});
