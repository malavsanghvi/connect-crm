import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The gesture library and the ideas on the Care card (DonorDelight slice 6), drawn once on the server (the repo has no browser test environment). The
// database decides who is let in and what suits whom; these tests check what the portal does with the answer, in words.
vi.mock("@/app/(app)/households/[id]/care-actions", () => ({
  addCareNoteAction: vi.fn(), archiveCareNoteAction: vi.fn(), editCareNoteAction: vi.fn(), logCareTouchAction: vi.fn(), moreCareTouchesAction: vi.fn(),
  saveCareProfileAction: vi.fn(), setCareOwnerAction: vi.fn(), voidCareTouchAction: vi.fn(),
}));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => "/care/gestures",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const session = {
  permissions: ["care.own"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: { key: "church", label: "Church", faithBased: true, usesTradition: false, terms: {}, modules: { care: { availability: "default_off", label: "Member care" } } } as unknown,
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago" },
};
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const answers = vi.hoisted(() => ({ gestures: null as unknown }));
vi.mock("@/lib/data/care", async () => {
  const { careCan } = await import("@/lib/permissions");
  return { seesCare: (s: Parameters<typeof careCan>[0]) => careCan(s, "own"), loadGestures: async () => answers.gestures };
});

import GesturesPage from "@/app/(app)/care/gestures/page";
import { CareCard } from "@/components/care/care-card";
import { parseGestures } from "@/lib/care/gestures";
import { parseCard, parseTouchPage } from "@/lib/care/model";
import type { CareCardLoad } from "@/lib/data/care";

const html = async (page: Promise<ReactElement>) => renderToStaticMarkup(await page);
const gesture = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-0000000000g1".replace("g", "a"), key: "thank_you_call", name: "A thank-you call with no ask", description: "A short call to say thank you and to listen.", cost: "free", effort: "quick", who: "anyone",
  suits_thanks: ["call"], suits_recognition: [], needs: [], suggest: true, kind: "thank_you", channel: "phone", draft: "Hello {{name}}, it is {{me}} from {{org}}.", enabled: true, starter_key: "thank_you_call", ...over,
});
const library = (canManage: boolean, gestures: unknown[] = [gesture(), gesture({ id: "00000000-0000-4000-8000-0000000000a2", key: "leader_video", name: "A short video from a leader", who: "leader", cost: "low", suits_thanks: [], enabled: false, suggest: false })], missing = 3) => ({
  status: "ok",
  data: parseGestures({ audience: "faith", starters_missing: missing, can_manage: canManage, label: "Member care", gestures }),
});

describe("the gestures page", () => {
  it("shows each gesture with its cost, effort, who, what it records and that it asks for nothing", async () => {
    answers.gestures = library(false);
    const out = await html(GesturesPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("A thank-you call with no ask");
    expect(out).toContain("Free · A few minutes · Anyone");
    expect(out).toContain("Low cost · A few minutes · A leader");
    expect(out).toContain("no ask");
    expect(out).toContain("Suits households who like to be thanked a call");
    expect(out).toContain("Paused");
    expect(out).toContain("Chosen by a person");
    expect(out).not.toContain("starter");
    expect(out).not.toContain("Edit");
  });
  it("filters by who should do it", async () => {
    answers.gestures = library(false);
    const out = await html(GesturesPage({ searchParams: Promise.resolve({ who: "leader" }) }));
    expect(out).toContain("A short video from a leader");
    expect(out).toContain("A thank-you call with no ask");
    const volunteers = await html(GesturesPage({ searchParams: Promise.resolve({ who: "volunteer" }) }));
    expect(volunteers).toContain("A thank-you call with no ask");
    expect(volunteers).not.toContain("A short video from a leader");
  });
  it("a manager can add the starters, edit and pause; the editor says a gesture is never paired with an ask", async () => {
    answers.gestures = library(true);
    session.permissions = ["care.manage"];
    const out = await html(GesturesPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Add the 3 starter gestures");
    expect(out).toContain("Edit");
    expect(out).toContain("New gesture");
    const edit = await html(GesturesPage({ searchParams: Promise.resolve({ edit: "00000000-0000-4000-8000-0000000000a1" }) }));
    expect(edit).toContain("Change the gesture");
    expect(edit).toContain("never paired with an ask");
    expect(edit).toContain("Save the gesture");
    session.permissions = ["care.own"];
    answers.gestures = library(false);
    const denied = await html(GesturesPage({ searchParams: Promise.resolve({ edit: "new" }) }));
    expect(denied).not.toContain("A new gesture");
  });
  it("an empty library says how to begin; refusals are words", async () => {
    answers.gestures = library(false, [], 0);
    expect(await html(GesturesPage({ searchParams: Promise.resolve({}) }))).toContain("Someone who manages this area adds the gestures.");
    answers.gestures = { status: "no_access" };
    expect(await html(GesturesPage({ searchParams: Promise.resolve({}) }))).toContain("You don&#x27;t have access to this area");
    answers.gestures = { status: "error", error: "the database did not answer" };
    const out = await html(GesturesPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Could not load the gestures");
    expect(out).toContain("Try again");
    session.permissions = ["people.view"];
    expect(await html(GesturesPage({ searchParams: Promise.resolve({}) }))).toContain("You don&#x27;t have access to this area");
    session.permissions = ["care.own"];
  });
});

const household = { id: "h1", name: "Mensah, Ama", number: "GC-H-0041", org_household_id: null, city: "Austin", zone: null, primary_member: "Ama Mensah", adults: [{ person_id: "pa", name: "Ama Mensah", is_primary: true }], merged: false };
function load(gestures: CareCardLoad["gestures"], profile: Record<string, unknown> | null = { thanks: "call" }): CareCardLoad {
  return {
    card: {
      status: "ok",
      data: parseCard({
        household, label: "Member care", access: { level: "own", manage: false, amounts: false, people: false },
        owners: { owner: { user_id: "u1", name: "Sam K", holds: true }, backup: null, needs_owner: false },
        profile: profile && { thanks: null, recognition: null, channel: null, language: null, contact_person_id: null, contact_name: null, do_not_ask: false, rest_until: null, resting: false, ...profile },
        languages: ["en"], today: "2026-10-17", people: null, special_days: null, notes: [], notes_total: 0, last_touch: null, touches_12m: 0, asks_12m: 0,
      }),
    },
    touches: { status: "ok", data: parseTouchPage({ rows: [], more: false, amounts: false }) },
    holders: null,
    gestures,
    org: "Grace Church",
  };
}

describe("ideas on the Care card", () => {
  it("lists the gestures that suit this household, with why, a filled draft and one tap that records no ask", () => {
    const out = renderToStaticMarkup(h(CareCard, { load: load(library(false) as CareCardLoad["gestures"]), householdId: "h1", timeZone: "America/Chicago", retryHref: "/households/h1" }));
    expect(out).toContain("Ideas for this household (1)");
    expect(out).toContain("A thank-you call with no ask");
    expect(out).toContain("Why: They like to be thanked a call");
    expect(out).toContain("Hello Ama, it is [your name] from Grace Church.");
    expect(out).toContain("I did this · Phone");
    expect(out).toContain("Never an ask.");
    expect(out).not.toContain("A short video from a leader");
  });
  it("offers nothing to a household that asked for no thanks, and nothing when the library is empty", () => {
    expect(renderToStaticMarkup(h(CareCard, { load: load(library(false) as CareCardLoad["gestures"], { thanks: "none" }), householdId: "h1", timeZone: "America/Chicago", retryHref: "/" }))).not.toContain("Ideas for this household");
    expect(renderToStaticMarkup(h(CareCard, { load: load(library(false, []) as CareCardLoad["gestures"]), householdId: "h1", timeZone: "America/Chicago", retryHref: "/" }))).not.toContain("Ideas for this household");
  });
  it("a failed read is said in words next to the ideas, never an empty box", () => {
    const out = renderToStaticMarkup(h(CareCard, { load: load({ status: "error", error: "the database did not answer" }), householdId: "h1", timeZone: "America/Chicago", retryHref: "/" }));
    expect(out).toContain("Could not load the ideas for this household — the database did not answer.");
  });
});
