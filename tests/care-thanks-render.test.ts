import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The thank-you tracker's screens (DonorDelight slice 3), drawn once on the server (the repo has no browser test environment): the
// thank-yous page, the thank-you rules page and the "Thank-yous waiting" strip of the Care card. The database decides who is let in
// and what a row says; these tests check what the portal does with the answer, in words.
vi.mock("next/navigation", () => ({
  usePathname: () => "/care/thanks",
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
const answers = vi.hoisted(() => ({ queue: null as unknown, summary: null as unknown, settings: null as unknown }));
vi.mock("@/lib/data/care", async () => {
  const { careCan } = await import("@/lib/permissions");
  return {
    CARE_PAGE_SIZE: 50,
    THANKS_PAGE_SIZE: 50,
    seesCare: (s: Parameters<typeof careCan>[0]) => careCan(s, "own"),
    loadThanksQueue: async () => answers.queue,
    loadThanksSummary: async () => answers.summary,
    loadThanksSettings: async () => answers.settings,
  };
});

import ThanksPage from "@/app/(app)/care/thanks/page";
import CareSettingsPage from "@/app/(app)/care/settings/page";
import { CareCard } from "@/components/care/care-card";
import { parseCard } from "@/lib/care/model";
import { parseHouseholdThanks, parseThanksQueue, parseThanksSettings, parseThanksSummary } from "@/lib/care/thanks";
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
const row = (over: Record<string, unknown> = {}) => ({
  id: "s1", household, gift_on: "2026-10-11", due_on: "2026-10-13", overdue: true, days_overdue: 3, needs_personal: true,
  amount_cents: null, thanked_at: null, how: null, set_aside_at: null, set_aside_reason: null, ...over,
});
const queue = (over: Record<string, unknown> = {}, rows: unknown[] = [row()]) => ({
  status: "ok",
  data: parseThanksQueue({
    state: "ok", filter: "open", rows, total: rows.length, counts: { open: 3, overdue: 1, personal_open: 2, done: 4, set_aside: 1 },
    window_days: 2, amounts: false, today: "2026-10-16", can_manage: false, ...over,
  }),
});
const summary = { status: "ok", data: parseThanksSummary({ state: "ok", days: 90, window_days: 2, gifts: 8, thanked: 5, open: 3, overdue: 1, median_hours: 26, on_time_share: 0.6 }) };
const draw = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ThanksPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  session.kind = church;
  session.permissions = ["care.view"];
  session.isPlatformAdmin = false;
  answers.queue = queue();
  answers.summary = summary;
});

describe("the thank-yous page", () => {
  it("lists a gift to thank: the household by its card, what is due and what closes it, and the one-tap ways to thank", async () => {
    const html = await draw();
    expect(html).toContain("Member care: thank-yous");
    expect(html).toContain("Mensah, Ama");
    expect(html).toContain("GC-H-0041 · Austin · Ama Mensah");
    expect(html).toContain("Overdue by 3 days");
    expect(html).toContain("Needs a call, a visit, a card or a video");
    for (const w of ["Called", "Card sent", "Visited"]) expect(html).toContain(`>${w}<`);
    expect(html).not.toContain(">Emailed<");
    expect(html).toContain("No thanks needed");
  });

  it("offers an ordinary step the email and the text as well", async () => {
    answers.queue = queue({}, [row({ needs_personal: false, overdue: false, days_overdue: null })]);
    const html = await draw();
    expect(html).toContain(">Emailed<");
    expect(html).toContain(">Texted<");
    expect(html).toContain("The receipt or any thank-you will do");
  });

  it("says 'Thank them warmly' without an amount, and shows the amount to a role that sees it", async () => {
    expect(await draw()).toContain("A gift on 11 October 2026. Thank them warmly.");
    answers.queue = queue({ amounts: true }, [row({ amount_cents: 12000 })]);
    const html = await draw();
    expect(html).toContain("$120.00 gift on 11 October 2026");
    expect(html).not.toContain("Thank them warmly");
  });

  it("shows how fast gifts are thanked, in words", async () => {
    const html = await draw();
    expect(html).toContain("60% on time");
    expect(html).toContain("about 26 hours");
    expect(html).toContain("3 gifts to thank, 1 overdue");
  });

  it("shows a thanked gift with how it was closed, and a set-aside one with its reason and a way back", async () => {
    answers.queue = queue({ filter: "done" }, [row({ thanked_at: "2026-10-12T15:00:00Z", how: "receipt", overdue: false })]);
    const done = await draw({ show: "done" });
    expect(done).toContain("Receipt sent 12 October 2026");
    expect(done).not.toContain("No thanks needed</button>");
    answers.queue = queue({ filter: "set_aside" }, [row({ set_aside_at: "2026-10-13T10:00:00Z", set_aside_reason: "A test gift", overdue: false })]);
    const aside = await draw({ show: "set_aside" });
    expect(aside).toContain("Set aside: A test gift");
    expect(aside).toContain(">Reopen<");
  });

  it("says what to do before the rules are saved: a manager is sent to set them, anyone else is told who can", async () => {
    answers.queue = { status: "ok", data: parseThanksQueue({ state: "not_set_up", can_manage: true }) };
    const manager = await draw();
    expect(manager).toContain("Choose how gifts are thanked to start");
    expect(manager).toContain('href="/care/settings"');
    answers.queue = { status: "ok", data: parseThanksQueue({ state: "not_set_up", can_manage: false }) };
    const other = await draw();
    expect(other).toContain("Someone who manages Member care sets them.");
    expect(other).not.toContain('href="/care/settings"');
  });

  it("says so when Giving is off, never an empty list", async () => {
    answers.queue = { status: "ok", data: parseThanksQueue({ state: "giving_off" }) };
    expect(await draw()).toContain("Giving is off, so there are no gifts to thank.");
  });

  it("says 'You don't have access to this area' to a platform admin, and shows a failed read with a retry", async () => {
    session.permissions = ["people.view"];
    session.isPlatformAdmin = true;
    const denied = await draw();
    expect(denied).toContain("You don&#x27;t have access to this area");
    expect(denied).not.toContain("<li");
    session.permissions = ["care.view"];
    session.isPlatformAdmin = false;
    answers.queue = { status: "error", error: "the database could not be reached" };
    const failed = await draw({ show: "overdue" });
    expect(failed).toContain("Could not load the thank-yous");
    expect(failed).toContain("Try again");
  });
});

describe("the thank-you rules page", () => {
  const rules = (over: Record<string, unknown> = {}) => ({
    status: "ok",
    data: parseThanksSettings({ saved: false, thank_window_days: 2, first_gift_personal: true, personal_from_cents: null, count_fees: false, thanks_from: null, can_manage: true, ...over }),
  });

  it("shows the rules a manager can change, with the first-save choice before anything is saved", async () => {
    session.permissions = ["care.manage"];
    answers.settings = rules();
    const html = renderToStaticMarkup(await CareSettingsPage());
    expect(html).toContain("Member care: thank-you rules");
    expect(html).toContain("Thank a gift within (days)");
    expect(html).toContain("Include the last 30 days");
    expect(html).toContain("Save the rules");
  });

  it("shows the day thank-yous began once saved, and read-only rules to someone who cannot change them", async () => {
    answers.settings = rules({ saved: true, thanks_from: "2026-09-16", can_manage: false, personal_from_cents: 50000 });
    const html = renderToStaticMarkup(await CareSettingsPage());
    expect(html).toContain("Thank-yous began on 2026-09-16.");
    expect(html).not.toContain("Include the last 30 days");
    expect(html).toContain("Someone who manages this area can change the rules.");
    expect(html).not.toContain("Save the rules");
    expect(html).toContain('value="500.00"');
  });

  it("says a refusal in words, never an empty form", async () => {
    answers.settings = { status: "no_access" };
    expect(renderToStaticMarkup(await CareSettingsPage())).toContain("You don&#x27;t have access to this area");
  });
});

describe("the Care card's thank-yous waiting", () => {
  function card(thanks: CareCardLoad["thanks"]): CareCardLoad {
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
      thanks,
    };
  }
  const draw2 = (load: CareCardLoad) => renderToStaticMarkup(createElement(CareCard, { load, householdId: "h1", timeZone: "America/Chicago", retryHref: "/households/h1" }) as ReactElement);

  it("lists what is waiting, with the ways to thank, on the household's own card", () => {
    const html = draw2(card({ status: "ok", data: parseHouseholdThanks({ state: "ok", amounts: false, window_days: 2, open: [{ id: "s1", gift_on: "2026-10-11", due_on: "2026-10-13", overdue: true, needs_personal: true, amount_cents: null }] }) }));
    expect(html).toContain("Thank-yous waiting");
    expect(html).toContain("A gift on 11 October 2026. Thank them warmly.");
    expect(html).toContain(">Called<");
  });

  it("draws nothing when nothing is waiting, and says so when the read failed", () => {
    const none = draw2(card({ status: "ok", data: parseHouseholdThanks({ state: "ok", amounts: false, window_days: 2, open: [] }) }));
    expect(none).not.toContain("Thank-yous waiting");
    const failed = draw2(card({ status: "error", error: "the database could not be reached" }));
    expect(failed).toContain("Could not load this household");
    expect(failed).toContain("Reload the page to try again.");
    expect(draw2(card(null))).not.toContain("Thank-yous waiting");
  });
});
