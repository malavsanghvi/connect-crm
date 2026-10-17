import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The care plan page and the Niva tick (DonorDelight slice 8), drawn once on the server (the repo has no browser test environment). The database decides who is
// let in; these tests check what the portal does with the answer, in words.
vi.mock("next/navigation", () => ({
  usePathname: () => "/care/plan",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const session = {
  permissions: ["care.manage"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: { key: "church", label: "Church", faithBased: true, usesTradition: false, terms: {}, modules: { care: { availability: "default_off", label: "Member care" } } } as unknown,
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago", currency: "USD" },
};
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const answers = vi.hoisted(() => ({ plan: null as unknown }));
vi.mock("@/lib/data/care", async () => {
  const { careCan } = await import("@/lib/permissions");
  return { seesCare: (s: Parameters<typeof careCan>[0]) => careCan(s, "own"), loadCarePlan: async () => answers.plan };
});

import CarePlanPage from "@/app/(app)/care/plan/page";
import { NivaTick } from "@/components/care/plan-controls";
import { parsePlan } from "@/lib/care/plan";

const html = async (page: Promise<ReactElement>) => renderToStaticMarkup(await page);
const plan = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  data: parsePlan({
    year: 2027, exists: true, status: "draft", summary: "Our mission: to welcome. This plan says who we thank, and when, before anyone is asked.", today: "2027-03-01", can_manage: true, label: "Member care", years: [2027],
    approved_at: null, updated_at: "2027-02-01T00:00:00Z",
    items: [
      { id: "aaa111222", on: "2027-03-10", title: "Call a few steady givers, only to say thank you", group: "steady", kind: "thank_you", note: "No ask on this call." },
      { id: "bbb111222", on: "2027-10-07", title: "Greet households around Harvest supper", group: "all", kind: "greeting", note: null },
    ],
    ...over,
  }),
});

describe("the care plan page", () => {
  it("a draft shows its summary, what is coming up, the moments by month with who and what, and a manager can edit and approve it", async () => {
    answers.plan = plan();
    const out = await html(CarePlanPage({ searchParams: Promise.resolve({ year: "2027" }) }));
    expect(out).toContain("Draft: not approved");
    expect(out).toContain("A draft runs nothing.");
    expect(out).toContain("This plan says who we thank, and when, before anyone is asked.");
    expect(out).toContain("Coming up in the next 30 days");
    expect(out).toContain("10 March 2027");
    expect(out).toContain("A steady giver · Thank-you");
    expect(out).toContain("No ask on this call.");
    expect(out).toContain("October");
    expect(out).toContain("Approve the 2027 plan");
    expect(out).toContain("/care/plan?year=2027&amp;edit=1");
    expect(out).toContain("Start again from the mission and calendar");
  });
  it("an approved plan says so, and says that editing returns it to draft; no Approve button", async () => {
    answers.plan = plan({ status: "approved", approved_at: "2027-02-03T10:00:00Z" });
    const out = await html(CarePlanPage({ searchParams: Promise.resolve({ year: "2027" }) }));
    expect(out).toContain("Approved");
    expect(out).toContain("Editing it returns it to draft.");
    expect(out).not.toContain("Approve the 2027 plan");
  });
  it("a relationship owner reads the plan but cannot change it", async () => {
    answers.plan = plan({ can_manage: false });
    session.permissions = ["care.own"];
    const out = await html(CarePlanPage({ searchParams: Promise.resolve({ year: "2027" }) }));
    expect(out).toContain("Call a few steady givers");
    expect(out).not.toContain("Approve the 2027 plan");
    expect(out).not.toContain("Start again");
    expect(out).not.toContain("edit=1");
    session.permissions = ["care.manage"];
  });
  it("no plan yet: a manager can draft one from the mission and calendar; anyone else is told who can", async () => {
    answers.plan = plan({ exists: false, status: "none", summary: null, items: [], years: [] });
    let out = await html(CarePlanPage({ searchParams: Promise.resolve({ year: "2027" }) }));
    expect(out).toContain("There is no plan for 2027 yet.");
    expect(out).toContain("Draft the 2027 plan");
    answers.plan = plan({ exists: false, status: "none", summary: null, items: [], years: [], can_manage: false });
    out = await html(CarePlanPage({ searchParams: Promise.resolve({ year: "2027" }) }));
    expect(out).toContain("Someone who manages this area drafts the plan.");
    expect(out).not.toContain("Draft the 2027 plan");
  });
  it("the editor shows each moment and says a moment never asks", async () => {
    answers.plan = plan();
    const out = await html(CarePlanPage({ searchParams: Promise.resolve({ year: "2027", edit: "1" }) }));
    expect(out).toContain("Edit the 2027 plan");
    expect(out).toContain("It never asks for money.");
    expect(out).toContain("Save the plan");
    expect(out).toContain("Add a moment");
    expect(out).toContain("Call a few steady givers, only to say thank you");
  });
  it("no access, off and a failed read are said in words", async () => {
    answers.plan = { status: "no_access" };
    expect(await html(CarePlanPage({ searchParams: Promise.resolve({}) }))).toContain("You don&#x27;t have access to this area");
    answers.plan = { status: "off", message: "Member care is not on for this community." };
    expect(await html(CarePlanPage({ searchParams: Promise.resolve({}) }))).toContain("Member care is not on for this community.");
    answers.plan = { status: "error", error: "the database did not answer" };
    const out = await html(CarePlanPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Could not load the care plan");
    expect(out).toContain("Try again");
    session.permissions = ["people.view"];
    expect(await html(CarePlanPage({ searchParams: Promise.resolve({}) }))).toContain("You don&#x27;t have access to this area");
    session.permissions = ["care.manage"];
  });
});

describe("the Niva tick", () => {
  it("says what Niva can do and cannot see, and who can tick it", () => {
    const out = renderToStaticMarkup(h(NivaTick, { enabled: false, ai: true, canManage: true }));
    expect(out).toContain("adults only, no amounts, no notes");
    expect(out).toContain("It drafts; a person sends.");
    expect(out).toContain("Niva may help with relationship care");
    expect(out).not.toContain("iWeaver is not on");
  });
  it("without iWeaver it says so and what to do", () => {
    const out = renderToStaticMarkup(h(NivaTick, { enabled: false, ai: false, canManage: true }));
    expect(out).toContain("iWeaver is not on for your organization, so Niva cannot help yet.");
  });
  it("someone who cannot change it is told the state", () => {
    expect(renderToStaticMarkup(h(NivaTick, { enabled: true, ai: true, canManage: false }))).toContain("Niva may help with relationship care. Someone who manages this area can change that.");
    expect(renderToStaticMarkup(h(NivaTick, { enabled: false, ai: true, canManage: false }))).toContain("Niva is not set up for relationship care.");
  });
});
