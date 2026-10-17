import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// "Your 5 this week" and Playbooks (DonorDelight slice 5), drawn once on the server (the repo has no browser test environment). The database decides who
// is let in and which task is whose; these tests check what the portal does with the answer, in words.
vi.mock("next/navigation", () => ({
  usePathname: () => "/care/week",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const session = {
  permissions: ["care.own"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: { key: "church", label: "Church", faithBased: true, usesTradition: false, terms: {}, modules: { care: { availability: "default_off", label: "Member care" } } } as unknown,
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago", currency: "USD" },
};
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const answers = vi.hoisted(() => ({ week: null as unknown, playbooks: null as unknown, settings: null as unknown }));
vi.mock("@/lib/data/care", async () => {
  const { careCan } = await import("@/lib/permissions");
  return {
    seesCare: (s: Parameters<typeof careCan>[0]) => careCan(s, "own"),
    loadWeek: async () => answers.week,
    loadPlaybooks: async () => answers.playbooks,
    loadWeekSettings: async () => answers.settings,
  };
});

import PlaybooksPage from "@/app/(app)/care/playbooks/page";
import WeekPage from "@/app/(app)/care/week/page";
import { parsePlaybooks } from "@/lib/care/playbooks";
import { parseWeek, parseWeekSettings } from "@/lib/care/week";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
void h;

const household = { id: "h1", name: "Mensah, Ama", number: "GC-H-0041", org_household_id: null, city: "Austin", zone: null, primary_member: "Ama Mensah", adults: [], merged: false };
const week = (over: Record<string, unknown> = {}, tasks: unknown[] | null = null) => ({
  status: "ok",
  data: parseWeek({
    state: "ok", today: "2026-10-17", total: 6, overdue: 1, needs_owner: 0, me: "Ravi", org: "Grace Church", label: "Member care", playbooks: 10,
    tasks: tasks ?? [
      { kind: "step", run_id: "00000000-0000-4000-8000-000000000001", step_id: "00000000-0000-4000-8000-000000000002", household, contact: "Ama", due_on: "2026-10-14", overdue: true, title: "Welcome them", why: "First contact.", touch_kind: "welcome", channel: "phone", draft: "Hello {{name}}, it is {{me}} from {{org}}.", personal: false },
      { kind: "thank", run_id: null, step_id: null, thank_id: "00000000-0000-4000-8000-000000000003", household, contact: "Ama", due_on: "2026-10-19", overdue: false, title: "Thank them for their gift", why: "Their gift of October 10 has not been thanked yet.", touch_kind: "thank_you", channel: "post", draft: "Dear {{name}}, thank you. {{me}}", personal: true },
    ],
    ...over,
  }),
});
const html = async (page: Promise<ReactElement>) => renderToStaticMarkup(await page);

describe("the week page", () => {
  it("draws each task with why, its filled draft and one tap, and says the true total", async () => {
    answers.week = week();
    const out = await html(WeekPage());
    expect(out).toContain("6 tasks this week, 1 overdue");
    expect(out).toContain("Welcome them");
    expect(out).toContain("Overdue by 3 days");
    expect(out).toContain("Why: </span>First contact.");
    expect(out).toContain("Hello Ama, it is Ravi from Grace Church.");
    expect(out).toContain("you send it, Weaver sends nothing");
    expect(out).toMatch(/Done · Phone/);
    expect(out).toContain("Mensah, Ama");
    expect(out).toContain("GC-H-0041");
    expect(out).toContain("4 more tasks are waiting");
  });
  it("a thank-you task offers the tracker's own ways to thank, a personal one only the personal ways", async () => {
    answers.week = week();
    const out = await html(WeekPage());
    expect(out).toContain("Called");
    expect(out).toContain("Card sent");
    expect(out).toContain("Visited");
    expect(out).not.toContain("Texted");
  });
  it("no playbooks: says so and where to add them; a quiet week says so", async () => {
    answers.week = week({ total: 0, overdue: 0, playbooks: 0 }, []);
    expect(await html(WeekPage())).toContain("There are no playbooks yet, so no household has a task");
    answers.week = week({ total: 0, overdue: 0, playbooks: 10 }, []);
    const out = await html(WeekPage());
    expect(out).toContain("Nothing waits for you this week.");
    expect(out).toContain("See the playbooks");
  });
  it("a manager is told about households with a task and no owner; an owner is not", async () => {
    answers.week = week({ needs_owner: 3 });
    expect(await html(WeekPage())).not.toContain("no relationship owner");
    session.permissions = ["care.view"];
    expect(await html(WeekPage())).toContain("3 households have a task and no relationship owner");
    session.permissions = ["care.own"];
  });
  it("refusals are words: no access, off, and a failed read with a retry", async () => {
    answers.week = { status: "no_access" };
    expect(await html(WeekPage())).toContain("You don&#x27;t have access to this area");
    answers.week = { status: "off", message: "Member care is not on for this community." };
    expect(await html(WeekPage())).toContain("Member care is not on for this community.");
    answers.week = { status: "error", error: "the database did not answer" };
    const out = await html(WeekPage());
    expect(out).toContain("Could not load your week");
    expect(out).toContain("The database did not answer.");
    expect(out).toContain("Try again");
    session.permissions = ["people.view"];
    expect(await html(WeekPage())).toContain("You don&#x27;t have access to this area");
    session.permissions = ["care.own"];
  });
});

const playbooks = (canManage: boolean, missing = 2) => ({
  status: "ok",
  data: parsePlaybooks({
    audience: "faith", starters_missing: missing, can_manage: canManage, label: "Member care",
    playbooks: [
      { id: "00000000-0000-4000-8000-0000000000a1", key: "first_gift", name: "Thank a first gift", summary: "Start well.", trigger_key: "first_gift", window_days: 60, cooldown_days: 365, enabled: true,
        steps: [{ id: "s1", position: 1, after_days: 0, title: "Thank them personally", why: "Remembered.", kind: "thank_you", channel: "phone", draft: "Hello {{name}}." }] },
      { id: "00000000-0000-4000-8000-0000000000a2", key: "steady", name: "Stay close", summary: null, trigger_key: "steady", window_days: 60, cooldown_days: 120, enabled: false, steps: [] },
    ],
  }),
});

describe("the playbooks page", () => {
  it("everyone with a care key reads the playbooks; only a manager gets the controls", async () => {
    answers.playbooks = playbooks(false);
    answers.settings = { status: "ok", data: parseWeekSettings({ notify: false, notify_dow: 1, can_manage: false }) };
    const out = await html(PlaybooksPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Thank a first gift");
    expect(out).toContain("A household&#x27;s first gift");
    expect(out).toContain("The day they enter");
    expect(out).toContain("Paused");
    expect(out).not.toContain("Edit");
    expect(out).not.toContain("starter");
    expect(out).toContain("Someone who manages this area can change this.");
  });
  it("a manager can add the starters, edit, pause and set the weekly reminder", async () => {
    answers.playbooks = playbooks(true);
    answers.settings = { status: "ok", data: parseWeekSettings({ notify: true, notify_dow: 4, can_manage: true }) };
    session.permissions = ["care.manage"];
    const out = await html(PlaybooksPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Add the 2 starter playbooks");
    expect(out).toContain("Edit");
    expect(out).toContain("Pause");
    expect(out).toContain("Resume");
    expect(out).toContain("New playbook");
    expect(out).toContain("Remind relationship owners once a week");
    expect(out).toContain("no names, no notes");
    session.permissions = ["care.own"];
  });
  it("editing shows the playbook's steps in a form that says a step never asks; a stranger cannot open it", async () => {
    answers.playbooks = playbooks(true);
    answers.settings = { status: "ok", data: parseWeekSettings({ notify: false, notify_dow: 1, can_manage: true }) };
    session.permissions = ["care.manage"];
    const out = await html(PlaybooksPage({ searchParams: Promise.resolve({ edit: "00000000-0000-4000-8000-0000000000a1" }) }));
    expect(out).toContain("Change the playbook");
    expect(out).toContain("it never asks for money");
    expect(out).toContain("Thank them personally");
    expect(out).toContain("Save the playbook");
    expect(out).toContain("Add a step");
    const fresh = await html(PlaybooksPage({ searchParams: Promise.resolve({ edit: "new" }) }));
    expect(fresh).toContain("A new playbook");
    answers.playbooks = playbooks(false);
    session.permissions = ["care.own"];
    const denied = await html(PlaybooksPage({ searchParams: Promise.resolve({ edit: "new" }) }));
    expect(denied).not.toContain("A new playbook");
    expect(denied).toContain("Thank a first gift");
  });
  it("an empty list says how to begin; a failed read says so with a retry", async () => {
    answers.playbooks = { status: "ok", data: parsePlaybooks({ can_manage: false, playbooks: [] }) };
    answers.settings = { status: "no_access" };
    expect(await html(PlaybooksPage({ searchParams: Promise.resolve({}) }))).toContain("Someone who manages this area adds the playbooks.");
    answers.playbooks = { status: "error", error: "the database did not answer" };
    const out = await html(PlaybooksPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Could not load the playbooks");
    expect(out).toContain("Try again");
  });
});
