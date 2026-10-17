import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Who to approach (DonorDelight slice 7), drawn once on the server (the repo has no browser test environment): the page and the Care card's Asking
// block. The database decides who is let in and which household is ready or held; these tests check what the portal does with the answer, in words.
vi.mock("@/app/(app)/households/[id]/care-actions", () => ({
  addCareNoteAction: vi.fn(), archiveCareNoteAction: vi.fn(), editCareNoteAction: vi.fn(), logCareTouchAction: vi.fn(), moreCareTouchesAction: vi.fn(),
  saveCareProfileAction: vi.fn(), setCareOwnerAction: vi.fn(), voidCareTouchAction: vi.fn(),
}));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => "/care/approach",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const session = {
  permissions: ["care.view"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: { key: "church", label: "Church", faithBased: true, usesTradition: false, terms: {}, modules: { care: { availability: "default_off", label: "Member care" } } } as unknown,
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago", currency: "USD", country: "US" },
};
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const answers = vi.hoisted(() => ({ list: null as unknown, settings: null as unknown }));
vi.mock("@/lib/data/care", async () => {
  const { careCan } = await import("@/lib/permissions");
  return { seesCare: (s: Parameters<typeof careCan>[0]) => careCan(s, "own"), loadApproach: async () => answers.list, loadApproachSettings: async () => answers.settings };
});

import ApproachPage from "@/app/(app)/care/approach/page";
import { CareCard } from "@/components/care/care-card";
import { parseApproach, parseApproachHousehold, parseApproachSettings } from "@/lib/care/approach";
import { parseCard, parseTouchPage } from "@/lib/care/model";
import type { CareCardLoad } from "@/lib/data/care";

const html = async (page: Promise<ReactElement>) => renderToStaticMarkup(await page);
const hh = (id: string, name: string) => ({ id, name, number: `GC-${id}`, org_household_id: null, city: "Austin", zone: null, primary_member: name, adults: [], merged: false });
const list = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  data: parseApproach({
    state: "ok", ready_total: 1, held_total: 1, not_shown: 2, fund: null, funds: [{ id: "00000000-0000-4000-8000-0000000000f1", name: "Roof fund" }], amounts: true, all: true,
    touch_balance: 3, rest_days: 60, can_manage: true, label: "Member care", today: "2026-10-17",
    ready: [{ household: hh("h1", "Mensah, Ama"), owner: "Ravi", state: "ready", holds: [], score: 55,
      signals: [{ key: "years", points: 32, n: 4 }, { key: "recent", points: 15, days: 30 }, { key: "took_part", points: 8, n: 1 }, { key: "well_thanked", points: 0 }],
      last_gift_on: "2026-09-17", last_ask_on: null, no_ask_since: 3, gifts: 4, range: { low: 13500, high: 20000, n: 4 } }],
    held: [{ household: hh("h2", "Okafor, Chidi"), owner: null, state: "held", holds: [{ code: "balance", have: 2, need: 3 }, { code: "thank", n: 1 }], score: 31, signals: [], last_gift_on: "2026-08-01", last_ask_on: "2026-07-19", no_ask_since: 2, gifts: 3, range: null }],
    ...over,
  }),
});
const settings = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  data: parseApproachSettings({
    enabled: true, touch_balance: 3, rest_days: 60, weights: { years_per: 8, years_max: 40, recent_12: 15, recent_24: 10, recent_36: 5, took_part: 8, well_thanked: 4 },
    defaults: { years_per: 8, years_max: 40, recent_12: 15, recent_24: 10, recent_36: 5, took_part: 8, well_thanked: 4 }, can_manage: true,
    quiet_periods: [{ id: "q1", name: "A season of fasting", starts_on: "2027-02-10", ends_on: "2027-03-28", yearly: true }], ...over,
  }),
});

describe("the page", () => {
  it("shows who is ready with every reason and a range, and who is held with why; households are shown by their card and counted when not shown", async () => {
    answers.list = list();
    answers.settings = settings();
    const out = await html(ApproachPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("1 household ready · 1 held · 2 not shown");
    expect(out).toContain("Mensah, Ama");
    expect(out).toContain("GC-h1");
    expect(out).toContain("Gave in 4 of the last 5 years (+32)");
    expect(out).toContain("Last gift 1 month ago (+15)");
    expect(out).toContain("3 touches with no ask since the last ask");
    expect(out).toContain("If you do ask: $130 to $200, from 4 gifts of their own");
    expect(out).toContain("Score 55");
    expect(out).toContain("Okafor, Chidi");
    expect(out).toContain("Not yet: 2 of 3 touches with no ask since the last ask. One more first");
    expect(out).toContain("A gift has not been thanked yet: thank them first");
    expect(out).toContain("Needs an owner");
    expect(out).toContain("2 households are not shown.");
    expect(out).toContain("Roof fund");
  });
  it("without amounts there is no range; a relationship owner is told they see only their own", async () => {
    answers.list = list({ amounts: false, all: false, ready: [{ household: hh("h1", "Mensah, Ama"), state: "ready", holds: [], score: 55, signals: [], no_ask_since: 3, gifts: 4, range: null }] });
    answers.settings = settings({ can_manage: false });
    const out = await html(ApproachPage({ searchParams: Promise.resolve({}) }));
    expect(out).not.toContain("If you do ask");
    expect(out).toContain("You see only the households you own or back up.");
    expect(out).toContain("Someone who manages this area can change these.");
  });
  it("a manager reads what it uses and never uses, changes the touch balance, the rest, the weights and the quiet periods", async () => {
    answers.list = list();
    answers.settings = settings();
    const out = await html(ApproachPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("What it uses");
    expect(out).toContain("What it never uses");
    expect(out).toContain("wealth screening");
    expect(out).toContain("Touches with no ask before an ask");
    expect(out).toContain("Rest after an ask (days)");
    expect(out).toContain("How the score works (points)");
    expect(out).toContain("Last gift within 12 months");
    expect(out).toContain("A season of fasting");
    expect(out).toContain("every year");
    expect(out).toContain("Turn off");
  });
  it("off until a care manager has read it: a manager can turn it on, anyone else is told who can", async () => {
    answers.list = { status: "ok", data: parseApproach({ state: "off", can_manage: true, label: "Member care" }) };
    answers.settings = settings({ enabled: false });
    let out = await html(ApproachPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Who to approach is off");
    expect(out).toContain("I have read what it uses and what it never uses");
    expect(out).toContain("Turn on who to approach");
    answers.list = { status: "ok", data: parseApproach({ state: "off", can_manage: false, label: "Member care" }) };
    out = await html(ApproachPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Someone who manages this area turns it on.");
    expect(out).not.toContain("Turn on who to approach");
  });
  it("giving off, no access and a failed read are said in words", async () => {
    answers.list = { status: "ok", data: parseApproach({ state: "giving_off" }) };
    expect(await html(ApproachPage({ searchParams: Promise.resolve({}) }))).toContain("Giving is off, so there are no gifts to rank.");
    answers.list = { status: "no_access" };
    expect(await html(ApproachPage({ searchParams: Promise.resolve({}) }))).toContain("You don&#x27;t have access to this area");
    answers.list = { status: "error", error: "the database did not answer" };
    const out = await html(ApproachPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Could not load who to approach");
    expect(out).toContain("Try again");
    session.permissions = ["people.view"];
    expect(await html(ApproachPage({ searchParams: Promise.resolve({}) }))).toContain("You don&#x27;t have access to this area");
    session.permissions = ["care.view"];
  });
});

function load(approach: CareCardLoad["approach"]): CareCardLoad {
  return {
    card: {
      status: "ok",
      data: parseCard({
        household: hh("h1", "Mensah, Ama"), label: "Member care", access: { level: "view", manage: false, amounts: true, people: false },
        owners: { owner: { user_id: "u1", name: "Sam K", holds: true }, backup: null, needs_owner: false },
        profile: null, languages: ["en"], today: "2026-10-17", people: null, special_days: null, notes: [], notes_total: 0, last_touch: null, touches_12m: 0, asks_12m: 0,
      }),
    },
    touches: { status: "ok", data: parseTouchPage({ rows: [], more: false, amounts: false }) },
    holders: null,
    approach,
  };
}
const card = (a: CareCardLoad["approach"]) => renderToStaticMarkup(h(CareCard, { load: load(a), householdId: "h1", timeZone: "America/Chicago", retryHref: "/" }));

describe("the Asking block on the Care card", () => {
  it("ready: says so, with the reasons and the range from their own gifts", () => {
    const out = card({ status: "ok", data: parseApproachHousehold({ state: "ready", holds: [], score: 55, signals: [{ key: "years", points: 32, n: 4 }], no_ask_since: 3, gifts: 4, touch_balance: 3, rest_days: 60, range: { low: 13500, high: 20000, n: 4 } }) });
    expect(out).toContain("Asking");
    expect(out).toContain("Ready for an ask, when you choose to ask");
    expect(out).toContain("Gave in 4 of the last 5 years (+32)");
    expect(out).toContain("If you do ask: $130 to $200, from 4 gifts of their own");
    expect(out).toContain("Nothing is asked or sent for you.");
  });
  it("held: Not yet, with every reason", () => {
    const out = card({ status: "ok", data: parseApproachHousehold({ state: "held", holds: [{ code: "balance", have: 1, need: 3 }, { code: "pledge", days: 70 }], score: 20, signals: [], no_ask_since: 1, gifts: 3, touch_balance: 3, rest_days: 60 }) });
    expect(out).toContain("Not yet");
    expect(out).toContain("Not yet: 1 of 3 touches with no ask since the last ask. 2 more first");
    expect(out).toContain("Behind on a pledge by 70 days: remind them, do not ask");
    expect(out).not.toContain("If you do ask");
  });
  it("do not ask shows no reason; off, no history and a missing read show nothing; a failed read is said in words", () => {
    expect(card({ status: "ok", data: parseApproachHousehold({ state: "excluded", holds: [], score: 0, signals: [] }) })).toContain("Do not ask");
    expect(card({ status: "ok", data: parseApproachHousehold({ state: "off" }) })).not.toContain("care-approach");
    expect(card({ status: "ok", data: parseApproachHousehold({ state: "no_history" }) })).not.toContain("care-approach");
    expect(card(null)).not.toContain("care-approach");
    expect(card({ status: "error", error: "the database did not answer" })).toContain("Could not load whether to ask this household — the database did not answer.");
  });
});
