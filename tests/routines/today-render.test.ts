import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Today, rendered on the server with made-up data. Nothing is called: server actions are replaced.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/(app)/approvals/actions", () => ({ approveAsSecondAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { MyTasksCard } from "@/components/home/my-tasks-card";
import { NivaContext, type NivaApi } from "@/components/niva/niva-context";
import { AskBox } from "@/components/today/ask-box";
import { BriefingCard } from "@/components/today/briefing-card";
import { RoutineCard } from "@/components/today/routine-card";
import { TodayView } from "@/components/today/today-view";
import { buildBriefing } from "@/lib/routines/briefing";
import { resolveRoutine } from "@/lib/routines/resolve";
import type { HomeTask } from "@/lib/tasks";

import { FRIDAY, TUESDAY, event, facts, viewer } from "./fixtures";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToStaticMarkup(el);

const task = (over: Partial<HomeTask> = {}): HomeTask => ({
  id: "deposits:all",
  source: "deposits",
  tag: "Deposits",
  color: "brown",
  title: "12 bank lines to match",
  meta: "Money in without a matched gift",
  links: [{ label: "Open", href: "/giving/bank" }],
  ...over,
});

const treasurer = viewer(["treasurer"]);
const treasurerFacts = facts({
  today: FRIDAY,
  counts: { deposits: 1, giving_approvals: 0, credits: 0, quickbooks_problems: 0, bank_lines: 12, applications: 2, pledges_overdue: 5, pledges_due_week: 3, events_week: 1 },
  events: [event(4)],
});

function view(props: Partial<Parameters<typeof TodayView>[0]> = {}) {
  return h(TodayView, {
    greeting: "Good morning",
    firstName: "Priya",
    dateLabel: "Friday, October 16",
    routine: resolveRoutine(treasurer, treasurerFacts),
    briefing: buildBriefing(treasurer, treasurerFacts),
    tasks: [task()],
    failures: [],
    hasSources: true,
    ...props,
  });
}

/** A Niva that is on (or on without a model key), with only what Today's box reads. */
function withNiva(api: Partial<NivaApi>, child: ReactElement) {
  const value = { enabled: true, aiReady: true, ask: vi.fn(), openPalette: vi.fn(), ...api } as unknown as NivaApi;
  return h(NivaContext.Provider, { value }, child);
}

describe("Today", () => {
  const out = html(view());

  it("greets the person and gives the date", () => {
    expect(out).toContain("Good morning, Priya");
    expect(out).toContain("Friday, October 16");
  });

  it("shows the routine grouped by when, with what ticks itself and what is by hand", () => {
    expect(out).toContain("Your routine");
    expect(out).toContain("Every sign-in");
    expect(out).toContain("This week");
    expect(out).toContain("Match bank lines and Zelle payments to gifts");
    expect(out).toContain("Bank lines or Zelle reports are waiting to be matched");
    expect(out).toContain("Auto-checked");
    expect(out).toContain("You do this");
    expect(out).toContain("You tick this one yourself");
    expect(out).toContain("No approvals are waiting");
  });

  it("highlights the first step still to do, and shows progress", () => {
    expect(out).toContain('aria-current="step"');
    expect(out).toContain("Do this next");
    expect(out).toMatch(/role="progressbar"[^>]*aria-valuenow="\d+"/);
  });

  it("is honest that hand ticks are not remembered", () => {
    expect(out).toContain("Those ticks are not saved yet");
  });

  it("shows the morning briefing as numbers with links", () => {
    expect(out).toContain("This morning");
    expect(out).toContain("12");
    expect(out).toContain("bank lines to match");
    expect(out).toContain('href="/giving/bank"');
    expect(out).toContain("pledges past their due date");
    expect(out).toContain('href="/giving/pledges"');
  });

  it("shows My tasks below, as on the classic Home", () => {
    expect(out).toContain("My tasks");
    expect(out).toContain("12 bank lines to match");
    expect(out).toContain("1 waiting · filtered by your permissions");
  });

  it("puts the search box where the Niva box would be when Niva is off", () => {
    expect(out).toContain('role="combobox"');
    expect(out).toContain("Search households and people");
    expect(out).not.toContain("Ask Niva anything");
  });

  it("says so, in the page, when the routine could not be built — and still shows the tasks", () => {
    const broken = html(view({ problem: "Something went wrong while counting what is due." }));
    expect(broken).toContain("Could not prepare your routine and this morning");
    expect(broken).toContain("Something went wrong while counting what is due.");
    expect(broken).toContain("My tasks");
    expect(broken).not.toContain("Your routine");
  });
});

describe("the one box", () => {
  it("is Niva's when Niva is on: one input, no search results box", () => {
    const out = html(withNiva({}, h(AskBox, {})));
    expect(out).toContain('aria-label="Ask Niva"');
    expect(out).toContain('name="ask"');
    expect(out).toContain("Ask Niva anything");
    expect(out).toContain("Press Enter. Niva opens beside your work");
    expect(out).not.toContain('role="combobox"');
  });

  it("starts with the Ask button off until there are words", () => {
    expect(html(withNiva({}, h(AskBox, {})))).toMatch(/<button[^>]*disabled=""[^>]*>Ask<\/button>/);
  });

  it("says what Enter does when Niva has no chat yet", () => {
    const out = html(withNiva({ aiReady: false }, h(AskBox, {})));
    expect(out).toContain("command search");
    expect(out).toContain('name="ask"');
  });

  it("is the search box when Niva is switched off", () => {
    const out = html(withNiva({ enabled: false }, h(AskBox, {})));
    expect(out).toContain('role="combobox"');
    expect(out).not.toContain('name="ask"');
  });
});

describe("the routine card", () => {
  it("says there is no routine yet for a role that has none, and points to the tasks", () => {
    const out = html(h(RoutineCard, { routine: resolveRoutine(viewer(["store_lead"]), facts()) }));
    expect(out).toContain("No routine for your role yet");
    expect(out).toContain("Your tasks are below");
    expect(out).not.toContain('role="progressbar"');
  });

  it("says when nothing is due today and lists what is coming up", () => {
    const out = html(h(RoutineCard, { routine: resolveRoutine(viewer([{ key: "event_lead", scope: { kind: "event", id: "e1" } }]), facts()) }));
    expect(out).toContain("Nothing in your routine is due today");
    expect(out).toContain("Coming up");
    expect(out).toContain("Check RSVPs against capacity");
  });

  it("says the routine is done when every counter is clear and nothing is by hand", () => {
    const routine = resolveRoutine(viewer(["membership_coordinator"]), facts({ counts: { applications: 0, voting_overrides: 0 } }));
    // The one by-hand step is still to do.
    expect(html(h(RoutineCard, { routine }))).not.toContain("Your routine is done for today");
    const clear = { ...routine, groups: routine.groups.map((g) => ({ ...g, steps: g.steps.filter((s) => s.state === "done") })) };
    expect(html(h(RoutineCard, { routine: clear }))).toContain("Your routine is done for today");
  });

  it("tags each step with its role only when the person holds more than one", () => {
    const one = html(h(RoutineCard, { routine: resolveRoutine(viewer(["treasurer"]), facts({ today: TUESDAY })) }));
    expect(one).not.toContain("Membership coordinator");
    const two = html(h(RoutineCard, { routine: resolveRoutine(viewer(["treasurer", "membership_coordinator"]), facts({ today: TUESDAY })) }));
    expect(two).toContain("Membership coordinator");
    expect(two).toContain("Treasurer");
  });

  it("offers Ask Niva on a step only when Niva is on, and never on a Pathshala step", () => {
    const routine = resolveRoutine(viewer(["treasurer", "pathshala_principal"]), facts({ today: FRIDAY }));
    expect(html(h(RoutineCard, { routine }))).not.toContain("Ask Niva");
    const on = html(withNiva({}, h(RoutineCard, { routine })));
    expect(on).toContain("Which pledges are behind, oldest first?");
    // The announcement and placement steps are about learners' classes: they carry no question.
    const pathshala = routine.groups.flatMap((g) => g.steps).filter((s) => s.key.startsWith("pathshala."));
    expect(pathshala.length).toBeGreaterThan(0);
    for (const s of pathshala) expect(s.ask).toBeUndefined();
  });
});

describe("the briefing card", () => {
  it("says a number could not be counted, in the page, with how to try again", () => {
    const items = buildBriefing(treasurer, facts({ failed: { bank_lines: "the server did not respond" } }));
    const out = html(h(BriefingCard, { items }));
    expect(out).toContain("Could not count this — the server did not respond. Reload to try again.");
    expect(out).toContain('role="alert"');
  });

  it("says there is nothing to count for a role that sees none of it", () => {
    expect(html(h(BriefingCard, { items: [] }))).toContain("Nothing to count for your role yet");
  });

  it("is only numbers and fixed labels: nothing invented", () => {
    const items = buildBriefing(treasurer, treasurerFacts);
    const out = html(h(BriefingCard, { items }));
    for (const i of items) expect(out).toContain(i.label);
  });
});

describe("no learner appears (D2)", () => {
  const LEARNER = "Kiran Shah";

  it("a Pathshala principal's Today shows counts only", () => {
    const principal = viewer(["pathshala_principal"]);
    const f = facts({ today: FRIDAY, counts: { pathshala_to_place: 4, pathshala_assistance: 1, classes_today: 2, attendance_missing: 1, gyan_signoffs: 3 } });
    const out = html(
      h(TodayView, {
        greeting: "Good morning",
        dateLabel: "Friday, October 16",
        routine: resolveRoutine(principal, f),
        briefing: buildBriefing(principal, f),
        tasks: [task({ id: "pathshala:queue", source: "pathshala", tag: "Pathshala", title: "3 Gyan Path sign-offs waiting on teachers", meta: "Classes, sign-offs and checks" })],
        failures: [],
        hasSources: true,
      }),
    );
    expect(out).toContain("4 registrations waiting to be placed");
    expect(out).toContain("1 class without attendance so far");
    expect(out).toContain("3 sign-offs waiting on teachers");
    expect(out).not.toContain(LEARNER);
    expect(out).not.toMatch(/\bage\b/i);
  });

  it("the facts a routine reads are numbers: there is nowhere for a name to go", () => {
    const f = facts({ counts: { attendance_missing: 1 } });
    expect(Object.values(f.counts).every((v) => typeof v === "number")).toBe(true);
    expect(JSON.stringify(f)).not.toContain(LEARNER);
  });

  it("the task list card is unchanged for a person with no sources", () => {
    expect(html(h(MyTasksCard, { tasks: [], failures: [], hasSources: false }))).toContain("Nothing here for your role.");
  });
});
