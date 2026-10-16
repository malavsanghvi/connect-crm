import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The engagement signs' screens (DonorDelight slice 4), drawn once on the server (the repo has no browser test environment): the
// dashboard, the Sign column of the Households list and the "How the relationship is going" box of the Care card. The database decides who
// is let in and which facts come back; these tests check what the portal does with the answer, in words.
vi.mock("next/navigation", () => ({
  usePathname: () => "/care/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const session = {
  permissions: ["care.view"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: undefined as unknown,
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago", currency: "USD" },
};
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const answers = vi.hoisted(() => ({ dashboard: null as unknown, list: null as unknown, health: null as unknown }));
vi.mock("@/lib/data/care", async () => {
  const { careCan } = await import("@/lib/permissions");
  return {
    CARE_PAGE_SIZE: 50,
    seesCare: (s: Parameters<typeof careCan>[0]) => careCan(s, "own"),
    loadCareDashboard: async () => answers.dashboard,
    loadCareList: async () => answers.list,
    loadHealth: async () => answers.health,
  };
});

import CarePage from "@/app/(app)/care/page";
import CareDashboardPage from "@/app/(app)/care/dashboard/page";
import { CareCard } from "@/components/care/care-card";
import { classifyHealth, parseCareDashboard, type HealthFacts } from "@/lib/care/health";
import { parseCard, parseList } from "@/lib/care/model";
import type { CareCardLoad } from "@/lib/data/care";
import type { KindProfile } from "@/lib/kind";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
void h;
const church: KindProfile = { key: "church", label: "Church", faithBased: true, usesTradition: false, terms: {}, modules: { care: { availability: "default_off", label: "Member care" } } };

const household = {
  id: "h1",
  name: "Mensah, Ama",
  number: "GC-H-0041",
  org_household_id: null,
  city: "Austin",
  zone: null,
  primary_member: "Ama Mensah",
  adults: [{ person_id: "pa", name: "Ama Mensah", is_primary: true }],
  merged: false,
};

const dash = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  data: parseCareDashboard({
    state: "ok", today: "2026-10-16", history_months: 30,
    giving: { donors_last: 41, donors_prev: 52, kept: 36, lybunt: 16, sybunt: 22, retention: 0.692, first_year: { cohort: 9, kept: 5, rate: 0.556 } },
    thanks: { gifts: 60, thanked: 52, open: 8, overdue: 3, median_hours: 26, on_time_share: 0.8 },
    touches: { asks: 6, no_ask: 12, per_ask: 2.0 },
    key: { households: 50, with_owner: 40, share: 0.8 },
    ...over,
  }),
});
const drawDash = async () => renderToStaticMarkup(await CareDashboardPage());

beforeEach(() => {
  session.kind = church;
  session.permissions = ["care.view"];
  session.isPlatformAdmin = false;
  answers.dashboard = dash();
});

describe("the dashboard", () => {
  it("shows the organization's numbers in words: keeping, thanking and caring beyond the ask", async () => {
    const html = await drawDash();
    expect(html).toContain("Member care: dashboard");
    expect(html).toContain("Households that gave");
    expect(html).toContain("41");
    expect(html).toContain("52 in the 12 months before");
    expect(html).toContain("69%");
    expect(html).toContain("36 of 52 households that gave the year before");
    expect(html).toContain("Gave last year, not this");
    expect(html).toContain("22 gave in some earlier year and not in the last 12 months");
    expect(html).toContain("56%");
    expect(html).toContain("5 of 9 households whose first gift was the year before");
    expect(html).toContain("80% on time");
    expect(html).toContain("about 26 hours");
    expect(html).toContain("3 overdue");
    expect(html).toContain("2.0 for each ask (aim for 3 or more)");
    expect(html).toContain("80%");
    expect(html).toContain("40 of 50 have a relationship owner");
  });

  it("never shows an amount or a household", async () => {
    const html = await drawDash();
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain("Mensah");
  });

  it("says 'Not enough yet' for a two-year comparison until Weaver holds about two years of records", async () => {
    answers.dashboard = dash({ history_months: 14 });
    const html = await drawDash();
    expect(html).toContain("Not enough yet");
    expect(html).toContain("Weaver has about 14 months of records; this compares two years");
    expect(html).not.toContain("69%");
    expect(html).not.toContain("36 of 52");
    expect(html).toContain("In the last 12 months");
  });

  it("says so when Giving is off, and when the thank-you rules are not chosen yet (a manager is sent to choose them)", async () => {
    answers.dashboard = dash({ giving: null, thanks: null });
    const off = await drawDash();
    expect(off).toContain("Giving is off, so there are no gift numbers here.");
    expect(off).toContain("Giving is off, so there are no gifts to thank.");
    answers.dashboard = dash({ thanks: null });
    const view = await drawDash();
    expect(view).toContain("Thank-you speed shows once the thank-you rules are chosen.");
    expect(view).toContain("Someone who manages care chooses them.");
    expect(view).not.toContain('href="/care/settings"');
    session.permissions = ["care.manage"];
    const manager = await drawDash();
    expect(manager).toContain('href="/care/settings"');
    expect(manager).toContain("Choose how gifts are thanked");
  });

  it("says 'No ask recorded' with no ask, and 'No key households yet' with none", async () => {
    answers.dashboard = dash({ touches: { asks: 0, no_ask: 4, per_ask: null }, key: { households: 0, with_owner: 0, share: null } });
    const html = await drawDash();
    expect(html).toContain("No ask recorded in the last 12 months");
    expect(html).toContain("No key households yet");
  });

  it("links to the households that need an owner when some do not have one", async () => {
    expect(await drawDash()).toContain('href="/care?show=needs_owner"');
    answers.dashboard = dash({ key: { households: 50, with_owner: 50, share: 1 } });
    expect(await drawDash()).not.toContain("needs_owner");
  });

  it("says 'You don't have access to this area' to a relationship owner and to a platform admin, never an empty page", async () => {
    session.permissions = ["care.own"];
    const owner = await drawDash();
    expect(owner).toContain("You don&#x27;t have access to this area");
    expect(owner).not.toContain("Households that gave");
    session.permissions = ["people.view"];
    session.isPlatformAdmin = true;
    expect(await drawDash()).toContain("You don&#x27;t have access to this area");
  });

  it("says a refusal or a failed read in words, with a retry for the failure", async () => {
    answers.dashboard = { status: "no_access" };
    expect(await drawDash()).toContain("You don&#x27;t have access to this area");
    answers.dashboard = { status: "off", message: "Member care is turned off for your organization." };
    expect(await drawDash()).toContain("Member care is turned off for your organization.");
    answers.dashboard = { status: "error", error: "the database could not be reached" };
    const failed = await drawDash();
    expect(failed).toContain("Could not load the dashboard");
    expect(failed).toContain("The database could not be reached.");
    expect(failed).toContain("Try again");
  });
});

const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  householdId: "h1", gifts12: 4, giftsPrev12: 2, firstGiftOn: null, lastGiftOn: "2026-10-01", part12: 2, lastPartOn: "2026-10-06", opened12: 0,
  touches12: 4, asks12: 1, noAsk12: 3, lastTouchAt: null, unthanked: null, ...over,
});
const ctx = { today: "2026-10-16", historyMonths: 30, giving: true };

describe("the Sign column of the Households list", () => {
  const list = (rows: unknown[] = [{ household, owner: "Esi Boateng", owner_holds: true, backup: null, mine: false, needs_owner: false, resting: false, rest_until: null, last_touch_at: null }]) => ({
    status: "ok",
    data: parseList({ filter: "all", total: rows.length, limit: 50, offset: 0, rows, counts: { all: rows.length, mine: 0, needs_owner: 0, resting: 0 }, label: "Member care", can: { all: true, manage: false } }),
  });
  const drawList = async () => renderToStaticMarkup(await CarePage({ searchParams: Promise.resolve({}) }));

  it("shows each household's sign beside its owner", async () => {
    answers.list = list();
    answers.health = { status: "ok", data: { h1: classifyHealth(facts({ gifts12: 1, giftsPrev12: 3 }), ctx) } };
    const html = await drawList();
    expect(html).toContain('scope="col">Sign<');
    expect(html).toContain("Cooling");
  });

  it("keeps the list when the signs cannot be read, and says so in words", async () => {
    answers.list = list();
    answers.health = { status: "error", error: "the database could not be reached" };
    const html = await drawList();
    expect(html).toContain("Mensah, Ama");
    expect(html).toContain("Could not load the engagement signs");
    expect(html).toContain("Reload the page to try again.");
  });
});

describe("the Care card's 'How the relationship is going'", () => {
  function card(health: CareCardLoad["health"]): CareCardLoad {
    return {
      card: {
        status: "ok",
        data: parseCard({
          household,
          label: "Member care",
          access: { level: "view", manage: false, amounts: false, people: false },
          owners: { owner: null, backup: null, needs_owner: true },
          profile: null,
          languages: ["en"],
          notes: [],
          notes_total: 0,
          last_touch: null,
          touch_counts: { total: 0, ask: 0, no_ask: 0 },
          people: {},
        }),
      },
      touches: { status: "ok", data: { rows: [], more: false, amounts: false } },
      holders: null,
      health,
    };
  }
  const draw = (load: CareCardLoad) => renderToStaticMarkup(createElement(CareCard, { load, householdId: "h1", timeZone: "America/Chicago", retryHref: "/households/h1" }) as ReactElement);

  it("shows the sign and every reason behind it", () => {
    const html = draw(card({ status: "ok", data: classifyHealth(facts(), ctx) }));
    expect(html).toContain("How the relationship is going");
    expect(html).toContain("Thriving");
    expect(html).toContain("Steady giving, taking part, and the touches are in balance");
    expect(html).toContain("Gave 4 times in the last 12 months (2 the year before)");
    expect(html).toContain("no score, no amounts");
  });

  it("explains a Cooling household in its own words", () => {
    const html = draw(card({ status: "ok", data: classifyHealth(facts({ gifts12: 1, giftsPrev12: 3 }), ctx) }));
    expect(html).toContain("Cooling");
    expect(html).toContain("Gave fewer times (1) than the year before (3)");
  });

  it("draws nothing without a sign, and says so when the read failed", () => {
    expect(draw(card({ status: "ok", data: null }))).not.toContain("How the relationship is going");
    expect(draw(card(null))).not.toContain("How the relationship is going");
    const failed = draw(card({ status: "error", error: "the database could not be reached" }));
    expect(failed).toContain("Could not load how this relationship is going");
    expect(failed).toContain("Reload the page to try again.");
  });
});
