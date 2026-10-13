import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The dev previews of "Add to an event" (/dev/people-slideover and /dev/people-family?tab=events): invented data for a neutral community,
// no database, never in production. The fake server uses the real plan and the real sentences, so what the previews draw is what the
// product would say.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (orig) => ({
  ...((await orig()) as object),
  usePathname: () => "/dev/people-slideover",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/event-add-actions", () => ({ addToEventAction: vi.fn(), loadAddToEventAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/(app)/search/find-actions", () => ({ findAction: vi.fn() }));
vi.mock("@/app/auth-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/(app)/people/saved-actions", () => ({ saveViewAction: vi.fn(), renameViewAction: vi.fn(), deleteViewAction: vi.fn(), setPinAction: vi.fn() }));
vi.mock("@/app/(app)/people/add-family-actions", () => ({ addFamilyAction: vi.fn(), findFamilyMatchesAction: vi.fn() }));
vi.mock("@/app/(app)/households/actions", () => ({ dismissDuplicateAction: vi.fn() }));

import PeopleFamilyPreview from "@/app/dev/people-family/page";
import PeopleSlideOverPreview from "@/app/dev/people-slideover/page";
import { EVENT_STATES, eventChoices, fakeEventAdd } from "@/app/dev/people-event-add/fixtures";
import { EVENT_STEPS } from "@/app/dev/people-event-add/script";

afterEach(() => vi.unstubAllEnvs());

const slide = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PeopleSlideOverPreview({ searchParams: Promise.resolve(sp) }));
const family = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PeopleFamilyPreview({ searchParams: Promise.resolve(sp) }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the previews", () => {
  it("are not found in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(PeopleSlideOverPreview({ searchParams: Promise.resolve({ events: "ok" }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(PeopleFamilyPreview({ searchParams: Promise.resolve({ tab: "events" }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("draw the person slide-over with the Events section, for every state and family the screenshots use", async () => {
    const variants: Record<string, string>[] = [{}, { family: "tanaka", person: "p-misaki" }, { person: "p-layla" }, { family: "empty" }, { mode: "page", person: "p-ines", family: "empty" }];
    // Every family and person once, with the default state; every state once, with the default family.
    for (const sp of variants) expect(await slide({ ...sp, open: "events" }), JSON.stringify(sp)).toBeTruthy();
    for (const events of EVENT_STATES) expect(await slide({ events, open: "events" }), events).toBeTruthy();
  }, 30000);

  it("draw the Family page's Events tab for every state, and the scripted steps are known", async () => {
    for (const events of EVENT_STATES) expect(await family({ tab: "events", events }), events).toBeTruthy();
    for (const step of EVENT_STEPS) expect(await family({ tab: "events", do: step }), step).toBeTruthy();
    for (const step of EVENT_STEPS) expect(await slide({ open: "events", do: step }), step).toBeTruthy();
  }, 30000);

  // The slide-over's frame portals into the page, so the page-level draw below uses the person's own page (mode=page), which draws the same sections.
  const own = { mode: "page", person: "p-samira" };

  it("show the section with this person's tickets, and only the Events section open when asked", async () => {
    const html = await slide({ ...own, open: "events" });
    const words = text(html);
    expect(html).toContain('data-section="events"');
    expect(words).toContain("Founders' Day lunch");
    expect(words).toContain("3 RSVPs · came to 1");
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
  });

  it("leave the section out when the Events module is off, and say 'no access' when the role cannot read events", async () => {
    expect(await slide({ ...own, events: "off", open: "all" })).not.toContain('data-section="events"');
    expect(text(await slide({ ...own, events: "noread", open: "events" }))).toContain("You don't have access to this area");
    expect(text(await slide({ ...own, events: "view-only", open: "events" }))).toContain("Adding someone to an event needs the event manager role");
    expect(text(await slide({ ...own, events: "ok", open: "events" }))).toContain("Not in a family yet, so they cannot be added to an event from here.");
    expect(text(await slide({ ...own, events: "readerror", open: "events" }))).toContain("Could not load this person's event tickets");
  });

  it("put the control above the Family page's Events table", async () => {
    const words = text(await family({ tab: "events" }));
    expect(words.indexOf("Add to an event")).toBeGreaterThan(-1);
    expect(words.indexOf("Add to an event")).toBeLessThan(words.indexOf("Founders' Day lunch"));
    expect(text(await family({ tab: "events", events: "off" }))).not.toContain("Founders' Day lunch");
  });
});

describe("the fake server", () => {
  const call = (eventId: string, personIds: string[]) => ({ householdId: "hh-hassan", eventId, personIds });

  it("lists the events with a full one, a nearly full one, a closed one and one with the family already on it", async () => {
    const r = await fakeEventAdd("already", "hassan").load({ householdId: "hh-hassan" });
    expect(r.ok && r.events.map((e) => e.name)).toEqual(["Spring Picnic", "Harvest Dinner", "Neighbourhood cleanup · 春の清掃", "Weekend camp", "Open day"]);
    expect(eventChoices("already", "hassan")[0].existing).toMatchObject({ status: "confirmed", personIds: ["p-samira"] });
    expect(eventChoices("empty", "hassan")).toEqual([]);
  });

  it("answers with the real plan's sentences", async () => {
    const server = fakeEventAdd("ok", "hassan");
    expect(await server.add(call("ev-picnic", ["p-samira", "p-layla"]))).toMatchObject({ ok: true, message: "Samira and Layla are on Spring Picnic." });
    expect(await server.add(call("ev-cleanup", ["p-samira"]))).toMatchObject({ ok: true, waitlisted: true, message: "Samira is on the waitlist for Neighbourhood cleanup · 春の清掃." });
    expect(await server.add(call("ev-camp", ["p-samira", "p-layla"]))).toMatchObject({ ok: false, kind: "full" });
  });

  it("can fail in each way the panel has words for", async () => {
    expect(await fakeEventAdd("error", "hassan").add(call("ev-picnic", ["p-samira"]))).toMatchObject({ ok: false, kind: "other" });
    expect(await fakeEventAdd("full", "hassan").add(call("ev-picnic", ["p-samira"]))).toMatchObject({ ok: false, kind: "full" });
    expect(await fakeEventAdd("noaccess", "hassan").load({ householdId: "hh-hassan" })).toMatchObject({ ok: false, kind: "access" });
    expect(await fakeEventAdd("loaderror", "hassan").load({ householdId: "hh-hassan" })).toMatchObject({ ok: false, kind: "other" });
  });
});
