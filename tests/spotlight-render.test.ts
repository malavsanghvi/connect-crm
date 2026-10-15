import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The demo banner's Leave button calls a Server Action; here nothing is called, only rendered.
vi.mock("@/app/demo/actions", () => ({ startDemoAction: vi.fn(), leaveDemoAction: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

import { DemoBanner } from "@/components/demo-banner";
import { SpotlightCard, type SpotlightCardProps } from "@/components/spotlight/spotlight-card";
import { SpotlightContext, SpotlightProvider, type SpotlightApi } from "@/components/spotlight/spotlight-provider";
import { TourBannerLink } from "@/components/spotlight/tour-banner-link";
import { TourInvite, TourInviteView } from "@/components/spotlight/tour-invite";
import { TourMenuItem, TourMenuPanelView } from "@/components/spotlight/tour-menu";
import { sessionPermissions, type RoleLike } from "@/lib/permissions";
import { toursFor } from "@/lib/spotlight/registry";
import { TREASURER_BANK_MATCH } from "@/lib/spotlight/tours/treasurer-bank-match";
import type { TourDef } from "@/lib/spotlight/types";

// What the tour draws, as markup (no browser): the card (aria, the step counter, Skip tour on every step, the "not available" note), the
// invitation, the Tour menu, the demo banner link, and that none of it shows for anyone who has no tour.

const render = (el: ReactElement) => renderToStaticMarkup(el);
/** createElement with the children as extra arguments, for a component whose `children` prop is required. */
const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
/** The visible words of some markup. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const TOTAL = TREASURER_BANK_MATCH.steps.length;

function card(over: Partial<SpotlightCardProps> = {}): string {
  const noop = () => {};
  return render(
    createElement(SpotlightCard, {
      step: { title: "A title", body: "One plain sentence." },
      index: 1,
      total: TOTAL,
      phase: "ready",
      missingNote: "This part is not on the screen.",
      sheet: false,
      onNext: noop,
      onBack: noop,
      onSkip: noop,
      onFinish: noop,
      onRetry: noop,
      ...over,
    }),
  );
}

describe("the card", () => {
  it("is a dialog that is not modal, named by its title and described by its body", () => {
    const html = card();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="false"');
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)![1];
    const described = /aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toMatch(new RegExp(`<h2 id="${labelled}"[^>]*>A title</h2>`));
    expect(html).toMatch(new RegExp(`<p id="${described}"[^>]*>One plain sentence.</p>`));
    // Focus moves here when a step opens, so it can take focus without being a tab stop of its own.
    expect(html).toContain('tabindex="-1"');
  });

  it("says which step it is: Step 2 of 8", () => {
    expect(words(card({ index: 1 }))).toContain(`Step 2 of ${TOTAL}`);
    expect(words(card({ index: 0 }))).toContain(`Step 1 of ${TOTAL}`);
  });

  it("shows Skip tour, in words and not only an X, on every step including the first and the last", () => {
    for (let index = 0; index < TOTAL; index++) {
      const html = card({ index });
      expect(html, `step ${index + 1}`).toContain('data-testid="spotlight-skip"');
      expect(words(html), `step ${index + 1}`).toContain("Skip tour");
      expect(html, `step ${index + 1}`).toContain('aria-label="Close tour"');
    }
  });

  it("keeps Skip tour in the same place: before Back and Next, on every step", () => {
    for (let index = 0; index < TOTAL; index++) {
      const html = card({ index });
      const skip = html.indexOf('data-testid="spotlight-skip"');
      for (const other of ["spotlight-back", "spotlight-next", "spotlight-finish", "spotlight-close"]) {
        const at = html.indexOf(`data-testid="${other}"`);
        if (at !== -1) expect(skip, `${other} on step ${index + 1}`).toBeLessThan(at);
      }
    }
  });

  it("the first step has Next and no Back; a middle step has both", () => {
    const first = card({ index: 0 });
    expect(first).toContain('data-testid="spotlight-next"');
    expect(first).not.toContain('data-testid="spotlight-back"');
    const middle = card({ index: 3 });
    expect(middle).toContain('data-testid="spotlight-back"');
    expect(middle).toContain('data-testid="spotlight-next"');
    expect(middle).not.toContain('data-testid="spotlight-finish"');
  });

  it("the last step offers Finish and a plain Close as well as Skip tour and Back", () => {
    const last = card({ index: TOTAL - 1 });
    const text = words(last);
    expect(text).toContain("Finish");
    expect(text).toContain("Close");
    expect(text).toContain("Skip tour");
    expect(last).toContain('data-testid="spotlight-back"');
    expect(last).not.toContain('data-testid="spotlight-next"');
  });

  it("a step whose target is not on the screen says so in plain words and still offers Try again, Next and Skip tour", () => {
    const html = card({ phase: "missing", missingNote: "This screen is not available to you here." });
    expect(html).toContain('data-testid="spotlight-missing"');
    expect(words(html)).toContain("This screen is not available to you here.");
    expect(html).toContain('data-testid="spotlight-retry"');
    expect(html).toContain('data-testid="spotlight-next"');
    expect(html).toContain('data-testid="spotlight-skip"');
  });

  it("no note when the step is lit", () => {
    const html = card({ phase: "ready" });
    expect(html).not.toContain('data-testid="spotlight-missing"');
    expect(html).not.toContain('data-testid="spotlight-waiting"');
    expect(html).not.toContain("aria-busy");
  });

  it("while it looks for the target it says so, and is marked busy, with Skip tour still there", () => {
    const html = card({ phase: "waiting" });
    expect(words(html)).toContain("Finding this part of the screen");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-testid="spotlight-skip"');
  });

  it("every button is at least 44px high", () => {
    for (const html of [card({ index: 0 }), card({ index: 3 }), card({ index: TOTAL - 1 }), card({ phase: "missing" })]) {
      const buttons = html.match(/<button\b[^>]*>/g) ?? [];
      expect(buttons.length).toBeGreaterThanOrEqual(3);
      for (const b of buttons) expect(b, b).toContain("min-h-[44px]");
    }
  });

  it("is a sheet at the bottom of a narrow screen", () => {
    const html = card({ sheet: true });
    expect(html).toContain('data-sheet="true"');
    expect(html).toContain("sp-card-sheet");
    expect(card({ sheet: false })).not.toContain("sp-card-sheet");
  });

  it("relies on words, not colour alone: every control has text or a label", () => {
    const html = card({ index: TOTAL - 1 });
    for (const button of html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []) {
      expect(words(button) !== "" || /aria-label="[^"]+"/.test(button), button).toBe(true);
    }
  });
});

describe("the invitation on Home", () => {
  const invite = [{ id: TREASURER_BANK_MATCH.id, title: TREASURER_BANK_MATCH.title, summary: TREASURER_BANK_MATCH.summary, minutes: 1 }];
  const noop = () => {};

  it("offers the tour and two plain ways to decline, without ever starting it", () => {
    const html = render(createElement(TourInviteView, { tours: invite, onStart: noop, onNotNow: noop, onNever: noop }));
    const text = words(html);
    expect(text).toContain("Take the 1-minute tour");
    expect(text).toContain("Match a bank line to the right household");
    expect(text).toContain("Take the tour");
    expect(text).toContain("Not now");
    expect(text).toContain("Don't show tours again");
    expect(text).toContain("Nothing changes while you look");
    expect(html).toContain('data-testid="tour-invite-not-now"');
    expect(html).toContain('data-testid="tour-invite-never"');
    // An invitation, not a forced overlay: no dialog, no dimmed page.
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("sp-ring");
    for (const b of html.match(/<button\b[^>]*>/g) ?? []) expect(b).toContain("min-h-[44px]");
  });

  it("draws nothing when there is nobody to invite", () => {
    expect(render(createElement(TourInviteView, { tours: [], onStart: noop, onNotNow: noop, onNever: noop }))).toBe("");
  });
});

describe("the Tour menu", () => {
  const noop = () => {};
  const tours = [{ id: TREASURER_BANK_MATCH.id, title: TREASURER_BANK_MATCH.title, summary: TREASURER_BANK_MATCH.summary }];

  it("with tours on: replay a tour any time, or turn tours off", () => {
    const html = render(createElement(TourMenuPanelView, { tours, toursOff: false, statusOf: () => "dismissed" as const, onStart: noop, onTurnOff: noop, onTurnOn: noop }));
    const text = words(html);
    expect(text).toContain("Match a bank line to the right household");
    expect(text).toContain("You have taken this tour before.");
    expect(html).toContain('data-testid="tour-menu-start"');
    expect(text).toContain("Don't show tours again");
    expect(html).not.toContain('data-testid="tour-turn-on"');
  });

  it("with tours off: says so and offers one thing, turning them back on", () => {
    const html = render(createElement(TourMenuPanelView, { tours, toursOff: true, statusOf: () => "not_started" as const, onStart: noop, onTurnOff: noop, onTurnOn: noop }));
    expect(words(html)).toContain("Tours are turned off for you here.");
    expect(words(html)).toContain("Turn tours back on");
    expect(html).toContain('data-testid="tour-turn-on"');
    expect(html).not.toContain('data-testid="tour-menu-start"');
    expect(html).not.toContain('data-testid="tour-turn-off"');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Entry points: only for a person who has a tour, only while tours are on.

function api(over: Partial<SpotlightApi> = {}): SpotlightApi {
  const tours: readonly TourDef[] = over.tours ?? [TREASURER_BANK_MATCH];
  return {
    tours,
    active: null,
    loaded: true,
    toursOff: false,
    invitations: tours,
    statusOf: () => "not_started",
    start: () => {},
    stop: () => {},
    decline: () => ({ ok: true }),
    setToursOff: () => ({ ok: true }),
    ...over,
  };
}

const withApi = (value: SpotlightApi, ...children: ReactElement[]) => render(createElement(SpotlightContext.Provider, { value }, ...children));

describe("entry points", () => {
  it("a person who has the tour sees the banner link, the Tour menu item and the invitation", () => {
    const html = withApi(api(), createElement(TourBannerLink), createElement(TourMenuItem, { variant: "bar" }), createElement(TourInvite));
    expect(html).toContain('data-testid="demo-banner-tour"');
    expect(words(html)).toContain("Take the tour");
    expect(html).toContain('data-testid="tour-menu"');
    expect(html).toContain('data-testid="tour-invite"');
  });

  it("a person with no tour sees nothing new anywhere", () => {
    const none = api({ tours: [], invitations: [] });
    const html = withApi(none, createElement(TourBannerLink), createElement(TourMenuItem, { variant: "bar" }), createElement(TourMenuItem, { variant: "menu" }), createElement(TourMenuItem, { variant: "block" }), createElement(TourInvite));
    expect(html).toBe("");
  });

  it("tours off: no banner link and no invitation (the menu item stays, to turn them back on)", () => {
    const off = api({ toursOff: true, invitations: [] });
    const html = withApi(off, createElement(TourBannerLink), createElement(TourInvite));
    expect(html).toBe("");
    expect(withApi(off, createElement(TourMenuItem, { variant: "bar" }))).toContain('data-testid="tour-menu"');
  });

  it("the invitation waits until this browser's memory has been read, so it cannot flash and go", () => {
    expect(withApi(api({ loaded: false, invitations: [] }), createElement(TourInvite))).toBe("");
  });

  it("a tour that is running, or one the person already started, is not offered again", () => {
    expect(withApi(api({ active: TREASURER_BANK_MATCH.id }), createElement(TourInvite))).toBe("");
    expect(withApi(api({ invitations: [] }), createElement(TourInvite))).toBe("");
  });

  it("the banner link stays while a tour runs, so focus can return to it when the tour closes", () => {
    expect(withApi(api({ active: TREASURER_BANK_MATCH.id }), createElement(TourBannerLink))).toContain('data-testid="demo-banner-tour"');
  });

  it("the menu item is on the account menu in each look: the top bar, the redesigned menu and the phone menu", () => {
    const bar = withApi(api(), createElement(TourMenuItem, { variant: "bar" }));
    const menu = withApi(api(), createElement(TourMenuItem, { variant: "menu" }));
    const block = withApi(api(), createElement(TourMenuItem, { variant: "block" }));
    expect(bar).toContain("hidden sm:block");
    expect(menu).toContain("v2-menu-item");
    expect(words(block)).toContain("Tour");
    for (const html of [bar, menu, block]) {
      expect(words(html)).toBe("Tour");
      expect(html).toContain('aria-expanded="false"');
    }
  });
});

describe("only the treasurer sees any of it", () => {
  const roles: RoleLike[] = [
    { key: "treasurer", tier: "center", permissions: ["giving.view", "giving.manage", "giving.record_offline", "accounting.manage"] },
    { key: "membership_coordinator", tier: "center", permissions: ["people.view", "people.manage", "people.approve"] },
    { key: "center_admin", tier: "center", permissions: ["giving.view", "giving.manage", "giving.record_offline", "accounting.manage", "people.view"] },
  ];
  const ctxFor = (roleKey: string, isOwner = false) => {
    const grants = [{ role_key: roleKey, scope_kind: "center", starts_at: "2020-01-01T00:00:00Z", ends_at: null }];
    return {
      permissions: sessionPermissions(grants, roles, isOwner),
      isPlatformAdmin: false,
      isOwner,
      grants: grants.map((g) => ({ role_key: g.role_key, scope_kind: g.scope_kind, scope_id: null })),
    };
  };
  const banner = () => createElement(DemoBanner, { info: { role: "Treasurer", name: "Meera", centerName: "Demo", secondsLeft: 3000 } });
  /** What the layout mounts, once this browser's memory has been read: the banner and the pages' entry points, with the person's tours. */
  const page = (tours: readonly TourDef[]) =>
    withApi(api({ tours, invitations: tours }), banner(), createElement(TourMenuItem, { variant: "bar" }));
  /** The same on the server, through the real provider (this browser's memory is not known yet). */
  const serverPage = (tours: readonly TourDef[]) => render(h(SpotlightProvider, { userId: "u-1", tours }, banner(), createElement(TourMenuItem, { variant: "bar" })));

  it("the treasurer's page has the banner link and the Tour menu item", () => {
    const html = page(toursFor(ctxFor("treasurer")));
    expect(html).toContain('data-testid="demo-banner-tour"');
    expect(html).toContain('data-testid="tour-menu"');
  });

  it("the membership coordinator and the owner see a page exactly as it was before: the banner, with no tour link and no menu item", () => {
    for (const html of [page(toursFor(ctxFor("membership_coordinator"))), page(toursFor(ctxFor("center_admin", true)))]) {
      expect(html).toContain('data-testid="demo-banner"');
      expect(html).not.toContain("demo-banner-tour");
      expect(html).not.toContain("tour-menu");
      expect(words(html)).not.toMatch(/tour/i);
    }
  });

  it("idle costs nothing: no overlay, no ring, no card until a tour starts; the provider only adds a quiet live region", () => {
    const html = serverPage(toursFor(ctxFor("treasurer")));
    expect(html).not.toContain("spotlight-overlay");
    expect(html).not.toContain("sp-ring");
    expect(html).not.toContain("sp-shield");
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('data-testid="spotlight-live"');
    expect(html).toContain('aria-live="polite"');
  });

  it("on the server the banner link waits for this browser's memory (so it never flashes for a person who turned tours off); the Tour menu item is there", () => {
    const html = serverPage(toursFor(ctxFor("treasurer")));
    expect(html).not.toContain("demo-banner-tour");
    expect(html).toContain('data-testid="tour-menu"');
  });

  it("the live region is for the screen reader only", () => {
    expect(serverPage([])).toMatch(/class="sr-only"[^>]*role="status"|role="status"[^>]*class="sr-only"/);
  });
});
