import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Care card and the WeCare area (slice 2), drawn once on the server (the repo has no browser test environment). The
// writes are Server Actions; here nothing is called, only drawn. The database is stood in for by what its read functions
// return (0763).
vi.mock("@/app/(app)/households/[id]/care-actions", () => ({
  addCareNoteAction: vi.fn(),
  archiveCareNoteAction: vi.fn(),
  editCareNoteAction: vi.fn(),
  logCareTouchAction: vi.fn(),
  moreCareTouchesAction: vi.fn(),
  saveCareProfileAction: vi.fn(),
  setCareOwnerAction: vi.fn(),
  voidCareTouchAction: vi.fn(),
}));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => "/care",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const session = {
  permissions: ["care.own"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: undefined as unknown,
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago" },
};
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const listResult = vi.hoisted(() => ({ value: null as unknown }));
// The loader module is server-only; its stand-in keeps the same rule for who sees WeCare (careCan) and hands back the list.
vi.mock("@/lib/data/care", async () => {
  const { careCan } = await import("@/lib/permissions");
  return {
    CARE_PAGE_SIZE: 50,
    seesCare: (s: Parameters<typeof careCan>[0]) => careCan(s, "own"),
    loadCareList: async () => listResult.value,
  };
});

import CarePage from "@/app/(app)/care/page";
import { CareCard } from "@/components/care/care-card";
import { parseCard, parseList, parseTouchPage } from "@/lib/care/model";
import type { CareCardLoad } from "@/lib/data/care";
import type { KindProfile } from "@/lib/kind";

const church: KindProfile = { key: "church", label: "Church", faithBased: true, usesTradition: false, terms: {}, modules: { care: { availability: "default_off", label: "Member care" } } };

const household = {
  id: "h1",
  name: "Mensah, Ama",
  number: "GC-H-0041",
  org_household_id: null,
  city: "Austin",
  zone: null,
  primary_member: "Ama Mensah",
  adults: [
    { person_id: "pa", name: "Ama Mensah", is_primary: true },
    { person_id: "pb", name: "Kofi Mensah", is_primary: false },
  ],
  merged: false,
};

function load(extra: Record<string, unknown> = {}, touches: unknown = { rows: [], more: false, amounts: false }): CareCardLoad {
  return {
    card: {
      status: "ok",
      data: parseCard({
        household,
        label: "Member care",
        access: { level: "own", manage: false, amounts: false, people: false },
        owners: { owner: { user_id: "u1", name: "Sam K", holds: true }, backup: null, needs_owner: false },
        profile: { thanks: "card", recognition: "anonymous", channel: "post", language: "es", do_not_ask: true, rest_until: "2026-11-12", resting: true },
        languages: ["en", "es"],
        today: "2026-10-13",
        people: null,
        special_days: null,
        notes: [{ id: "n1", body: "Prefers mornings.", by: "Sam K", mine: true, created_at: "2026-10-02T15:00:00Z" }],
        notes_total: 1,
        last_touch: null,
        touches_12m: 0,
        asks_12m: 0,
        ...extra,
      }),
    },
    touches: { status: "ok", data: parseTouchPage(touches) },
    holders: null,
  };
}

const draw = (l: CareCardLoad) => renderToStaticMarkup(h(CareCard, { load: l, householdId: "h1", timeZone: "America/Chicago", retryHref: "/households/h1" }));

describe("the Care card", () => {
  it("draws the household's care in the kind's own words, with the rest notice and the one-tap touches", () => {
    const html = draw(load());
    expect(html).toContain("Member care");
    expect(html).toContain("Owner: Sam K");
    expect(html).toContain("Do not ask until 12 November 2026");
    expect(html).toContain("Anonymous");
    expect(html).toContain("Called, no answer");
    expect(html).toContain("Card sent");
    expect(html).toContain("Visited");
    expect(html).toContain("Prefers mornings.");
    expect(html).toContain("Weaver staff cannot.");
    expect(html).toContain("Interests, best call time, special days and dietary needs show here for roles that can also see People.");
  });

  it("shows a receipt's amount only when the database sent it", () => {
    const row = { source: "receipt", id: "p1", at: "2026-10-10T15:00:00Z", label: "Receipt R-1", outcome: "done", can_remove: false };
    expect(draw(load({}, { rows: [{ ...row, amount_cents: null }], more: false, amounts: false }))).not.toContain("$");
    expect(draw(load({}, { rows: [{ ...row, amount_cents: 5000 }], more: false, amounts: true }))).toContain("$50.00");
  });

  it("says when a household needs an owner", () => {
    const html = draw(load({ owners: { owner: { user_id: "u9", name: "Pat L", holds: false }, backup: null, needs_owner: true } }));
    expect(html).toContain("Needs an owner (Pat L no longer has a care role)");
  });

  it("says 'You don't have access to this area' when the database refuses, and offers a retry when the read failed", () => {
    expect(draw({ card: { status: "no_access" }, touches: { status: "no_access" }, holders: null })).toContain("You don&#x27;t have access to this area.");
    const failed = draw({ card: { status: "error", error: "the database could not be reached" }, touches: { status: "error", error: "x" }, holders: null });
    expect(failed).toContain("Could not load the care record — the database could not be reached.");
    expect(failed).toContain("Try again");
    expect(draw({ card: { status: "off", message: "Member care is not on for this community." }, touches: { status: "no_access" }, holders: null })).toContain(
      "Member care is not on for this community.",
    );
  });

  it("never names a child: it draws only the adults the database returns", () => {
    const html = draw(load());
    expect(html).toContain("Kofi Mensah");
    expect(html).not.toMatch(/child/i);
  });
});

describe("the WeCare area", () => {
  beforeEach(() => {
    session.kind = church;
    session.permissions = ["care.own"];
    session.isPlatformAdmin = false;
  });

  it("lists my households with their owner and when they were last touched", async () => {
    listResult.value = {
      status: "ok",
      data: parseList({
        filter: "mine",
        total: 1,
        limit: 50,
        offset: 0,
        rows: [{ household, owner: "Sam K", owner_holds: true, mine: true, needs_owner: false, resting: true, rest_until: "2026-11-12", last_touch_at: "2026-10-10T15:00:00Z" }],
        counts: { mine: 1, resting: 1, all: null, needs_owner: null },
        label: "Member care",
        can: { all: false, manage: false },
      }),
    };
    const html = renderToStaticMarkup(await CarePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Member care");
    expect(html).toContain("My households (1)");
    expect(html).not.toContain("All households");
    expect(html).toContain("GC-H-0041 · Austin · Ama Mensah");
    expect(html).toContain("Do not ask until 12 November 2026");
    expect(html).toContain("Oct 10, 2026");
  });

  it("says 'You don't have access to this area' to a platform admin, never an empty table", async () => {
    session.permissions = ["people.view"];
    session.isPlatformAdmin = true;
    const html = renderToStaticMarkup(await CarePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("<table");
  });

  it("shows a failed read with a retry", async () => {
    listResult.value = { status: "error", error: "the database could not be reached" };
    const html = renderToStaticMarkup(await CarePage({ searchParams: Promise.resolve({ show: "mine" }) }));
    expect(html).toContain("Could not load the households");
    expect(html).toContain("Try again");
  });
});
