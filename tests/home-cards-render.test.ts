import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The two Home cards, rendered on the server with made-up data. Nothing is called: server actions and the loaders are replaced.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/(app)/approvals/actions", () => ({ approveAsSecondAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { AssignmentsCard } from "@/components/home/assignments-card";
import { MemberAppCard } from "@/components/home/member-app-card";
import { StartHereCard } from "@/components/home/start-here-card";
import { TodayView } from "@/components/today/today-view";
import { buildAssignments, scopedAssignments, type AssignmentFacts } from "@/lib/home/assignments";
import type { HomeCards } from "@/lib/home/cards";
import { NO_MEMBER_APP_LINK, buildMemberWork, type MemberWorkData } from "@/lib/home/member-work";
import { readFailed, readOk } from "@/lib/home/read";
import { buildStartHere, type StartScreen } from "@/lib/home/start-here";
import { buildBriefing } from "@/lib/routines/briefing";
import { resolveRoutine } from "@/lib/routines/resolve";

import { facts as routineFacts, viewer } from "./routines/fixtures";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToStaticMarkup(el);

const URL = "https://app.example.org";
const EV = "11111111-1111-4111-8111-111111111111";
const ZONE = "44444444-4444-4444-8444-444444444444";

function data(over: Partial<MemberWorkData> = {}): MemberWorkData {
  return {
    linked: true,
    adult: readOk(true),
    application: readOk({ status: "awaiting_reference" }),
    vouch: readOk(0),
    pledges: readOk({ count: 1, leftCents: 5100, paidCents: 0 }),
    events: readOk({ upcoming: 2, going: 0, open: 2 }),
    notices: readOk(1),
    ...over,
  };
}
const work = (d: MemberWorkData, memberAppUrl: string | null = URL) => buildMemberWork(d, { currency: "USD", memberAppUrl });

describe("Your work is in the member app", () => {
  it("says where the work is, links to the member app, and counts what waits there in plain sentences", () => {
    const out = html(h(MemberAppCard, { work: work(data()) }));
    expect(out).toContain("Your work is in the member app");
    expect(out).toContain(`href="${URL}"`);
    expect(out).toContain("Open the member app");
    expect(out).toContain("Your family&#x27;s membership application is waiting for your reference to answer.");
    expect(out).toContain("A pledge of $51.00 is open.");
    expect(out).toContain("2 upcoming events are open for your family to RSVP to.");
    expect(out).toContain("Your community has posted 1 notice.");
    expect(out).not.toContain("Nothing here for your role");
    expect(out).not.toContain(NO_MEMBER_APP_LINK.slice(0, 20));
  });

  it("with no member app address: no link at all, and it says so plainly", () => {
    for (const memberAppUrl of [null, "", "not an address"]) {
      const out = html(h(MemberAppCard, { work: work(data(), memberAppUrl) }));
      expect(out).not.toContain("<a ");
      expect(out).not.toContain("Open the member app");
      expect(out).toContain("There is no link here yet because the member app&#x27;s address has not been set up for this community.");
      // The counts are still there.
      expect(out).toContain("A pledge of $51.00 is open.");
    }
  });

  it("a child: events and notices, and not a word about pledges, payments or RSVPs", () => {
    const child = data({ adult: readOk(false), application: null, vouch: null, pledges: null, events: readOk({ upcoming: 2, going: 0, open: 0 }), notices: readOk(1) });
    const out = html(h(MemberAppCard, { work: work(child) }));
    expect(out).toContain("Events and notices are in the member app.");
    expect(out).toContain("2 upcoming events to see.");
    expect(out).toContain("Your community has posted 1 notice.");
    expect(out).not.toMatch(/pledge|payment|\$|rsvp|membership application|vouch/i);
  });

  it("a read that failed: a plain sentence with the reason and a retry, never a zero", () => {
    const out = html(
      h(MemberAppCard, {
        work: work(data({ pledges: readFailed("the database could not be reached — check the connection and try again"), application: readOk(null), events: readOk({ upcoming: 0, going: 0, open: 0 }), notices: readOk(0) })),
      }),
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not load your family&#x27;s open pledges — the database could not be reached — check the connection and try again.");
    expect(out).toContain("Try again");
    expect(out).toContain('href="/"');
    expect(out).not.toContain("Nothing is waiting for you right now.");
    expect(out).not.toMatch(/\$0/);
  });

  it("nothing waiting: said, with the link", () => {
    const out = html(h(MemberAppCard, { work: work(data({ application: readOk(null), pledges: readOk({ count: 0, leftCents: 0, paidCents: 0 }), events: readOk({ upcoming: 0, going: 0, open: 0 }), notices: readOk(0) })) }));
    expect(out).toContain("Nothing is waiting for you right now.");
    expect(out).toContain(`href="${URL}"`);
  });

  it("a sign-in that is not linked to a person yet: said, no counts", () => {
    const out = html(h(MemberAppCard, { work: work(data({ linked: false })) }));
    expect(out).toContain("Your sign-in is not linked to a person in this community yet.");
    expect(out).toContain("find your family and link your sign-in");
    expect(out).not.toMatch(/pledge|upcoming/i);
  });
});

describe("My assignments", () => {
  const facts: AssignmentFacts = {
    events: readOk(new Map([[EV, { name: "Tapasvi Dinner", status: "published", starts_at: "2026-10-19T23:00:00Z", ends_at: null, venue: "Main hall" }]])),
    classes: null,
    zones: readOk(new Map([[ZONE, { name: "North" }]])),
    numbers: new Map([[EV, readOk({ rsvpPeople: 24, confirmed: 12, checkedIn: 3 })]]),
    zoneOpen: readOk(new Map([[ZONE, 2]])),
  };
  const names = new Map([
    ["event_lead", "Event lead"],
    ["zone_lead", "Zone lead"],
  ]);
  const ctx = viewer([
    { key: "event_lead", scope: { kind: "event", id: EV } },
    { key: "zone_lead", scope: { kind: "zone", id: ZONE } },
  ]);
  const card = buildAssignments(ctx, scopedAssignments(ctx.grants ?? []), facts, { timeZone: "America/Chicago", roleNames: names, now: new Date("2026-10-14T15:00:00Z") });

  it("one line per assignment with its title, role, date, numbers and links", () => {
    const out = html(h(AssignmentsCard, { card }));
    expect(out).toContain("My assignments");
    expect(out).toContain("Tapasvi Dinner");
    expect(out).toContain("Event lead · Mon, Oct 19, 6:00 PM · Main hall");
    expect(out).toContain("24 people on RSVPs · 12 confirmed · 3 checked in");
    expect(out).toContain(`href="/events/${EV}"`);
    expect(out).toContain(`href="/ops/${EV}/checkin"`);
    expect(out).toContain("North zone");
    expect(out).toContain("2 open conversations in the zone&#x27;s inbox");
    expect(out).toContain('href="/comms/inbox"');
  });

  it("a line with no page to open says so instead of linking nowhere", () => {
    const recorder = viewer([{ key: "boli_recorder", scope: { kind: "event", id: EV } }]);
    const c = buildAssignments(recorder, scopedAssignments(recorder.grants ?? []), facts, { timeZone: "America/Chicago", roleNames: names });
    const out = html(h(AssignmentsCard, { card: c }));
    expect(out).toContain("Tapasvi Dinner");
    // A role the community has no name for is written from its key.
    expect(out).toContain("Boli recorder");
    expect(out).toContain("Your part of this event is done in the event-day app, not in this portal.");
    expect(out).not.toContain("<a ");
  });

  it("a failed read is a line that says so, with a retry", () => {
    const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: EV } }]);
    const c = buildAssignments(lead, scopedAssignments(lead.grants ?? []), { ...facts, numbers: new Map([[EV, readFailed("it failed")]]) }, { timeZone: "America/Chicago", roleNames: names });
    const out = html(h(AssignmentsCard, { card: c }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not count the people for this event — it failed.");
    expect(out).toContain("Try again");
    expect(out).not.toMatch(/\b0 checked in\b/);
  });

  it("past the limit it says how many are not listed", () => {
    const out = html(h(AssignmentsCard, { card: { lines: card.lines, more: 3 } }));
    expect(out).toContain("And 3 more assignments that are not listed here.");
  });
});

describe("Start here", () => {
  const library: StartScreen = { key: "content", screen: "Content › Library", href: "/content/library", sentence: "Your work is in Content › Library: the drafts you write and send for approval." };
  const reports: StartScreen = { key: "reports", screen: "Reports › Center health", href: "/reports", sentence: "Reports › Center health shows how your community is doing." };

  it("one sentence naming the screen, a button to it, and what waits there", () => {
    const out = html(h(StartHereCard, { start: buildStartHere(library, { drafts: readOk(2) }) }));
    expect(out).toContain("Start here");
    expect(out).toContain("Your work is in Content › Library: the drafts you write and send for approval.");
    expect(out).toContain('href="/content/library"');
    expect(out).toContain("Open Content › Library");
    expect(out).toContain("2 drafts to finish.");
    expect(out).not.toContain("Nothing here for your role");
  });

  it("a screen with nothing to count is just the sentence and the button", () => {
    const out = html(h(StartHereCard, { start: buildStartHere(reports, {}) }));
    expect(out).toContain("Reports › Center health shows how your community is doing.");
    expect(out).toContain('href="/reports"');
    expect(out).not.toContain("<ul");
    expect(out).not.toContain("Nothing is waiting right now.");
  });

  it("nothing waiting is said so", () => {
    const out = html(h(StartHereCard, { start: buildStartHere(library, { drafts: readOk(0) }) }));
    expect(out).toContain("Nothing is waiting right now.");
  });

  it("a count that failed is a red line with the reason and a retry, never a zero", () => {
    const out = html(h(StartHereCard, { start: buildStartHere(library, { drafts: readFailed("the database could not be reached — check the connection and try again") }) }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not count the drafts — the database could not be reached — check the connection and try again.");
    expect(out).toContain("Try again");
    expect(out).toContain('href="/"');
    expect(out).not.toContain("Nothing is waiting right now.");
    expect(out).not.toMatch(/\b0 drafts\b/);
    // The button to the screen is still there.
    expect(out).toContain('href="/content/library"');
  });

  it("in Today it replaces 'Nothing here for your role'", () => {
    const treasurer = viewer(["treasurer"]);
    const out = html(
      h(TodayView, {
        greeting: "Good morning",
        firstName: "Nikhil",
        dateLabel: "Friday, October 16",
        routine: resolveRoutine(treasurer, routineFacts()),
        briefing: buildBriefing(treasurer, routineFacts()),
        tasks: [],
        failures: [],
        hasSources: false,
        cards: { memberWork: null, assignments: null, startHere: buildStartHere(library, { drafts: readOk(2) }) },
      }),
    );
    expect(out).toContain("Start here");
    expect(out).toContain("2 drafts to finish.");
    expect(out).not.toContain("Nothing here for your role");
    expect(out).not.toContain("My tasks");
  });
});

describe("Today, with the cards", () => {
  const treasurer = viewer(["treasurer"]);
  const tasks = [
    { id: "deposits:all", source: "deposits", tag: "Deposits", color: "brown", title: "12 bank lines to match", meta: "Money in without a matched gift", links: [{ label: "Open", href: "/giving/bank" }] },
  ] as const;

  function today(over: { cards?: HomeCards; tasks?: boolean; hasSources: boolean }) {
    return h(TodayView, {
      greeting: "Good morning",
      firstName: "Priya",
      dateLabel: "Friday, October 16",
      routine: resolveRoutine(treasurer, routineFacts()),
      briefing: buildBriefing(treasurer, routineFacts()),
      tasks: over.tasks ? [...tasks] : [],
      failures: [],
      hasSources: over.hasSources,
      cards: over.cards,
    });
  }
  const memberCards: HomeCards = { memberWork: work(data()), assignments: null, startHere: null };

  it("a person with no staff queue and a card sees the card, and is not told there is nothing for their role", () => {
    const out = html(today({ hasSources: false, cards: memberCards }));
    expect(out).toContain("Your work is in the member app");
    expect(out).toContain("A pledge of $51.00 is open.");
    expect(out).not.toContain("Nothing here for your role");
    expect(out).not.toContain("My tasks");
  });

  it("a person with a staff queue keeps My tasks, and gets My assignments too when they hold one", () => {
    const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: EV } }]);
    const assignments = buildAssignments(
      lead,
      scopedAssignments(lead.grants ?? []),
      { events: readOk(new Map([[EV, { name: "Tapasvi Dinner", status: "published", starts_at: null, ends_at: null, venue: null }]])), classes: null, zones: null, numbers: new Map(), zoneOpen: null },
      { timeZone: "America/Chicago", roleNames: new Map([["event_lead", "Event lead"]]) },
    );
    const out = html(today({ hasSources: true, tasks: true, cards: { memberWork: null, assignments, startHere: null } }));
    expect(out).toContain("My tasks");
    expect(out).toContain("12 bank lines to match");
    expect(out).toContain("My assignments");
    expect(out).toContain("Tapasvi Dinner");
    expect(out).not.toContain("Your work is in the member app");
  });

  it("a person with a queue and no assignments sees neither card", () => {
    const out = html(today({ hasSources: true, tasks: true, cards: { memberWork: null, assignments: null, startHere: null } }));
    expect(out).toContain("My tasks");
    expect(out).not.toContain("My assignments");
    expect(out).not.toContain("Your work is in the member app");
  });

  it("a person with neither keeps the old empty message", () => {
    const out = html(today({ hasSources: false, cards: { memberWork: null, assignments: null, startHere: null } }));
    expect(out).toContain("Nothing here for your role.");
  });

  it("without cards (an older caller) it renders as before", () => {
    const out = html(today({ hasSources: true, tasks: true }));
    expect(out).toContain("12 bank lines to match");
    expect(out).not.toContain("home-notices");
  });

  it("the owner's notice from the Weaver team sits above the routine and the tasks", () => {
    const notice = { key: "chip-in-settings", tone: "info" as const, title: "Weaver's team changed your Chip In settings on Oct 19, 2026", lines: ["Your members are not asked for a Chip In."] };
    const out = html(h(TodayView, { ...(today({ hasSources: true, tasks: true }).props as object), notices: [notice] }));
    expect(out).toContain('data-testid="home-notices"');
    expect(out).toContain("Your members are not asked for a Chip In.");
    expect(out.indexOf("home-notices")).toBeLessThan(out.indexOf("12 bank lines to match"));
  });
});
