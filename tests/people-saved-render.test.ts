import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// What the saved-views screens draw. Nothing is called here, only rendered; the buttons' behaviour is checked in the browser
// (the dev preview /dev/people-views) and the actions in tests/people-saved-actions.test.ts.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({
  ...((await orig()) as object),
  usePathname: () => "/people",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/(app)/search/find-actions", () => ({ findAction: vi.fn() }));
vi.mock("@/app/(app)/people/saved-actions", () => ({ saveViewAction: vi.fn(), renameViewAction: vi.fn(), deleteViewAction: vi.fn(), setPinAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { PeopleHome } from "@/components/people-v2/people-home";
import { GapList } from "@/components/people-v2/gap-list";
import { PinnedFamilies } from "@/components/people-v2/saved/pinned-families";
import { PinStar } from "@/components/people-v2/saved/pin-star";
import { SaveViewControl } from "@/components/people-v2/saved/save-view-control";
import { SavedViewsStrip } from "@/components/people-v2/saved/saved-views-strip";
import { listsMenu } from "@/lib/find/lists";
import type { PeopleHomeModel } from "@/lib/people-v2/home-model";
import type { GapSection } from "@/lib/people-v2/model";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

const VIEWS = [
  { id: "v1", name: "Adults with no email address", href: "/people?noemail=1&band=adults&view=people", summary: "Adults only · No email on file" },
  { id: "v2", name: "名簿の更新", href: "/people?ending=60&view=households", summary: "Membership ends within 60 days" },
];

describe("the Saved views strip", () => {
  const strip = (over: Partial<Parameters<typeof SavedViewsStrip>[0]> = {}) =>
    html(createElement(SavedViewsStrip, { endingSoon: { count: 23, href: "/people?ending=60" }, contactGapHref: "/people?noemail=1&view=people", views: VIEWS, max: 30, ...over }));

  it("shows the views everyone has and the person's own, each opening its list", () => {
    const out = strip();
    expect(out).toContain("Memberships ending soon · 23");
    expect(out).toContain("Adults with no email");
    expect(out).toContain('href="/people?noemail=1&amp;band=adults&amp;view=people"');
    expect(out).toContain("名簿の更新");
    expect(out).toContain("2 of 30 saved views. Only you see them.");
  });

  it("gives every own view a way to rename or delete it, named for screen readers, and none to the built-in ones", () => {
    const out = strip();
    expect(out).toContain('aria-label="Rename or delete the saved view Adults with no email address"');
    expect(out).toContain('aria-label="Rename or delete the saved view 名簿の更新"');
    expect((out.match(/Rename or delete the saved view/g) ?? []).length).toBe(2);
  });

  it("says there are none yet, in words, and how to make one", () => {
    const out = strip({ views: [] });
    expect(out).toContain("Your own saved views show up here.");
    expect(out).toContain("Save this view");
  });

  it("says when the views could not be read, instead of looking empty", () => {
    const out = strip({ views: [], loadError: "the database could not be reached — check the connection and try again" });
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not load your saved views — the database could not be reached");
    expect(out).not.toContain("Your own saved views show up here.");
  });

  it("has no 'coming next' left", () => {
    expect(strip().toLowerCase()).not.toContain("coming next");
  });
});

describe("pinned families", () => {
  const pins = [
    { id: "p1", householdId: "h1", title: "Hassan household", cardLine: "No. 0301 · RCC-H-1102 · Samira & Karim · Riverside", href: "/households/h1" },
    { id: "p2", householdId: "h2", title: "Фёдоров household", cardLine: "No. 0540 · Oleg Фёдоров · Moscow", href: "/households/h2" },
  ];

  it("draws each as the household card line, with a way to unpin that names the family", () => {
    const out = html(createElement(PinnedFamilies, { pins, hidden: 0 }));
    expect(out).toContain("Hassan household");
    expect(out).toContain("No. 0301 · RCC-H-1102");
    expect(out).toContain("Фёдоров household");
    expect(out).toContain('aria-label="Unpin Hassan household, No. 0301 · RCC-H-1102 · Samira &amp; Karim · Riverside"');
    expect(out).toContain('href="/households/h1"');
  });

  it("says how many pins are not shown, and when there are none says how to pin", () => {
    expect(html(createElement(PinnedFamilies, { pins, hidden: 1 }))).toContain("1 pinned family is not shown");
    expect(html(createElement(PinnedFamilies, { pins, hidden: 3 }))).toContain("3 pinned families are not shown");
    expect(html(createElement(PinnedFamilies, { pins: [], hidden: 0 }))).toContain("Pin a family with the star");
    // Every pin hidden: still said, not an empty strip.
    expect(html(createElement(PinnedFamilies, { pins: [], hidden: 2 }))).toContain("2 pinned families are not shown");
  });
});

describe("pinned families that could not be read", () => {
  it("says so in words with a way to try again, and does not look like there are none", () => {
    const out = html(createElement(PinnedFamilies, { pins: [], hidden: 0, loadError: "the database could not be reached" }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not load your pinned families — the database could not be reached");
    expect(out).toContain("Try again");
    expect(out).not.toContain("Pin a family with the star");
  });
});

describe("the pin star", () => {
  it("shows the state, and what a press does", () => {
    const off = html(createElement(PinStar, { pin: { householdId: "h1", pinned: false, loadError: null }, familyName: "Hassan household" }));
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('aria-label="Pin Hassan household"');
    expect(off).not.toMatch(/<button[^>]*\sdisabled=""/);
    const on = html(createElement(PinStar, { pin: { householdId: "h1", pinned: true, loadError: null }, familyName: "Hassan household" }));
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('aria-label="Unpin Hassan household"');
  });

  it("says when it could not be checked, and is switched off with the reason", () => {
    const out = html(createElement(PinStar, { pin: { householdId: "h1", pinned: null, loadError: "the database could not be reached" }, familyName: "Hassan household" }));
    expect(out).toMatch(/<button[^>]*\sdisabled=""/);
    expect(out).toContain("Could not check whether this family is pinned — the database could not be reached");
    expect(out).not.toContain("aria-pressed");
  });
});

describe("Save this view", () => {
  it("is a button that opens a name field when the list has a filter", () => {
    const out = html(createElement(SaveViewControl, { list: "people", params: { noemail: "1" }, sort: null, suggested: "Adults with no email", blockedReason: null }));
    expect(out).toContain("Save this view");
    expect(out).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("is switched off with the reason in words when there is no filter yet", () => {
    const out = html(createElement(SaveViewControl, { list: "households", params: {}, sort: null, suggested: "My view", blockedReason: "Add a filter first; then you can save this list as a view." }));
    expect(out).toMatch(/<button[^>]*\sdisabled=""/);
    expect(out).toContain("Add a filter first; then you can save this list as a view.");
  });
});

describe("the list of adults with a gap", () => {
  const section: GapSection = {
    count: "2 adults",
    rows: [
      { id: "p1", href: "/households/h1?person=p1", name: "Anil Patel", ids: "Member 1042", relationship: "Parent", family: "Patel household", cardLine: "No. 0127 · RCC-H-0961 · Priya & Anil · Riverside", mobile: "(713) 555-0138", email: "—", app: "Not on the app", age: "74" },
      { id: "p2", href: "/people/p2", name: "田中 花子", ids: "No member number", relationship: "—", family: "Not in a family", cardLine: null, mobile: "—", email: "—", app: "On the app", age: "—" },
    ],
    paging: { showing: "Showing all 2", prevHref: null, nextHref: null },
    emptyTitle: "No adult matches",
    emptyHint: "Remove a filter to see more.",
  };

  it("shows who, which family (the card line, never a name alone), and what is missing in words", () => {
    const out = html(createElement(GapList, { section }));
    expect(out).toContain("Anil Patel");
    expect(out).toContain("No. 0127 · RCC-H-0961 · Priya &amp; Anil · Riverside");
    expect(out).toContain("Patel household");
    expect(out).toContain("(713) 555-0138");
    expect(out).toContain("None on file");
    expect(out).toContain("Not on the app");
    expect(out).toContain("田中 花子");
    expect(out).toContain("Not in a family");
    expect(out).toContain('href="/households/h1?person=p1"');
    expect(out).toContain("Adults only: a child&#x27;s record is never part of a list like this.");
  });

  it("says when no adult matches", () => {
    const out = html(createElement(GapList, { section: { ...section, rows: [], paging: { showing: "", prevHref: null, nextHref: null } } }));
    expect(out).toContain("No adult matches");
    expect(out).toContain("Remove a filter to see more.");
  });
});

describe("the People home", () => {
  const model: PeopleHomeModel = {
    summary: "11 families · 24 people",
    cookieName: null,
    recents: [{ id: "r1", title: "Osei household", cardLine: "No. 0614", href: "/households/r1" }],
    inbox: [],
    endingSoon: { count: 23, href: "/people?ending=60" },
    canAddFamily: true,
    pins: [{ id: "p1", householdId: "h1", title: "Hassan household", cardLine: "No. 0301 · RCC-H-1102 · Samira & Karim", href: "/households/h1" }],
    pinsHidden: 0,
    savedViews: VIEWS,
    maxViews: 30,
    contactGapHref: "/people?noemail=1&view=people",
    lists: listsMenu([{ href: "/people/directory" }, { href: "/people/voting" }, { href: "/memberships/applications" }]),
    problems: [],
  };

  it("puts pinned families above the recent ones, and the saved views below, with the Lists menu intact", () => {
    const out = html(createElement(PeopleHome, { model }));
    const pinned = out.indexOf("Pinned families");
    const recent = out.indexOf("Recent families");
    const saved = out.indexOf("Saved views");
    expect(pinned).toBeGreaterThan(-1);
    expect(pinned).toBeLessThan(recent);
    expect(recent).toBeLessThan(saved);
    expect(out).toContain("Hassan household");
    expect(out).toContain("名簿の更新");
    for (const label of ["Directory &amp; expertise", "Voting eligibility", "Memberships history"]) expect(out).toContain(label);
    expect(out.toLowerCase()).not.toContain("coming next");
  });

  it("shows a problem reading the pinned families once, where the pins would be", () => {
    const out = html(createElement(PeopleHome, { model: { ...model, pins: [], problems: [{ what: "your pinned families", message: "it failed" }] } }));
    expect((out.match(/Could not load your pinned families/g) ?? []).length).toBe(1);
    expect(out.indexOf("Could not load your pinned families")).toBeGreaterThan(out.indexOf("Pinned families"));
  });

  it("shows a problem reading the saved views once, in the strip", () => {
    const out = html(createElement(PeopleHome, { model: { ...model, savedViews: [], problems: [{ what: "your saved views", message: "it failed" }] } }));
    expect((out.match(/Could not load your saved views/g) ?? []).length).toBe(1);
  });
});
