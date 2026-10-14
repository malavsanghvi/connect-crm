import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The classic Home page, with the session and the loaders replaced: which cards it puts in front of whom (docs/DEMO_ROLE_WORK.md).
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/app/(app)/approvals/actions", () => ({ approveAsSecondAction: vi.fn() }));
vi.mock("@/app/(app)/today-home", () => ({ TodayHome: () => null }));
vi.mock("@/lib/platform-setup/view", () => ({ isSetupComplete: vi.fn(async () => true) }));

const state = vi.hoisted(() => ({
  session: undefined as unknown,
  tasks: { tasks: [] as unknown[], failures: [] as unknown[] },
  kpis: [] as unknown[],
  cards: { memberWork: null, assignments: null, startHere: null } as unknown,
}));
vi.mock("@/lib/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: async () => state.tasks }));
vi.mock("@/lib/data/home-kpis", () => ({ loadHomeKpis: async () => state.kpis }));
vi.mock("@/lib/data/home-cards", () => ({ loadHomeCards: async () => state.cards }));

import HomePage from "@/app/(app)/page";
import { buildAssignments, scopedAssignments } from "@/lib/home/assignments";
import { buildMemberWork } from "@/lib/home/member-work";
import { buildStartHere } from "@/lib/home/start-here";
import { readOk } from "@/lib/home/read";

import { viewer } from "./routines/fixtures";

const EV = "11111111-1111-4111-8111-111111111111";

function session(held: Parameters<typeof viewer>[0]) {
  return {
    ...viewer(held),
    center: { time_zone: "America/Chicago" },
    person: { id: "p", name: "Priya Wadhwa", memberNumber: null },
    roles: [],
    modulesOff: [],
  };
}

const memberWork = buildMemberWork(
  {
    linked: true,
    adult: readOk(true),
    application: readOk(null),
    vouch: readOk(0),
    pledges: readOk({ count: 1, leftCents: 5100, paidCents: 0 }),
    events: readOk({ upcoming: 0, going: 0, open: 0 }),
    notices: readOk(0),
  },
  { currency: "USD", memberAppUrl: "https://app.example.org" },
);

const render = async () => renderToStaticMarkup((await HomePage()) as ReactElement);

beforeEach(() => {
  state.tasks = { tasks: [], failures: [] };
  state.kpis = [];
  state.cards = { memberWork: null, assignments: null, startHere: null };
});

describe("Home", () => {
  it("a family member with no staff queue: the member-app card, and never 'Nothing here for your role'", async () => {
    state.session = session(["community_member"]);
    state.cards = { memberWork, assignments: null, startHere: null };
    const out = await render();
    expect(out).toContain("Your work is in the member app");
    expect(out).toContain("A pledge of $51.00 is open.");
    expect(out).not.toContain("Nothing here for your role");
    expect(out).not.toContain("My tasks");
    // "At a glance" with nothing in it is left out under a person's cards.
    expect(out).not.toContain("At a glance");
  });

  it("an event lead: My assignments, with the member-app card below it", async () => {
    const lead = session([{ key: "event_lead", scope: { kind: "event", id: EV } }]);
    const leadCtx = viewer([{ key: "event_lead", scope: { kind: "event", id: EV } }]);
    state.session = lead;
    const assignments = buildAssignments(
      leadCtx,
      scopedAssignments(leadCtx.grants ?? []),
      { events: readOk(new Map([[EV, { name: "Tapasvi Dinner", status: "published", starts_at: null, ends_at: null, venue: null }]])), classes: null, zones: null, numbers: new Map(), zoneOpen: null },
      { timeZone: "America/Chicago", roleNames: new Map([["event_lead", "Event lead"]]) },
    );
    state.cards = { memberWork, assignments, startHere: null };
    const out = await render();
    expect(out).toContain("My assignments");
    expect(out).toContain(`href="/ops/${EV}/checkin"`);
    expect(out.indexOf("My assignments")).toBeLessThan(out.indexOf("Your work is in the member app"));
    expect(out).not.toContain("Nothing here for your role");
  });

  it("a staff member with a queue keeps My tasks and At a glance, and sees no member-app card", async () => {
    state.session = session(["treasurer"]);
    state.tasks = {
      tasks: [{ id: "deposits:all", source: "deposits", tag: "Deposits", color: "brown", title: "12 bank lines to match", meta: "Money in", links: [{ label: "Open", href: "/giving/bank" }] }],
      failures: [],
    };
    const out = await render();
    expect(out).toContain("12 bank lines to match");
    expect(out).toContain("At a glance");
    expect(out).not.toContain("Your work is in the member app");
    expect(out).not.toContain("My assignments");
  });

  it("a person with a screen and no queue: Start here, not 'Nothing here for your role'", async () => {
    state.session = session(["executive_viewer"]);
    state.cards = {
      memberWork: null,
      assignments: null,
      startHere: buildStartHere({ key: "reports", screen: "Reports › Center health", href: "/reports", sentence: "Reports › Center health shows how your community is doing." }, {}),
    };
    state.kpis = [{ state: "ok", label: "Next event", value: "24", sub: "people", tone: "navy", href: "/events" }];
    const out = await render();
    expect(out).toContain("Start here");
    expect(out).toContain("Reports › Center health shows how your community is doing.");
    expect(out).toContain('href="/reports"');
    expect(out).not.toContain("Nothing here for your role");
    expect(out).not.toContain("My tasks");
    expect(out).toContain("At a glance");
  });

  it("a person with a queue never gets it", async () => {
    state.session = session(["treasurer"]);
    state.tasks = {
      tasks: [{ id: "deposits:all", source: "deposits", tag: "Deposits", color: "brown", title: "12 bank lines to match", meta: "Money in", links: [{ label: "Open", href: "/giving/bank" }] }],
      failures: [],
    };
    const out = await render();
    expect(out).toContain("12 bank lines to match");
    expect(out).not.toContain("Start here");
  });

  it("when the loader finds nothing for a person at all, the old message remains", async () => {
    state.session = session(["executive_viewer"]);
    const out = await render();
    expect(out).toContain("Nothing here for your role.");
    expect(out).toContain("At a glance");
  });
});
