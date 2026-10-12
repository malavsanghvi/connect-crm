// /events/new: New look only (the classic look is sent to the builder, unchanged), "You don't have access to this area" when the
// person may not create events, a short `s` for a new creator, and the builder's own actions handed to the creator.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ look: "v2" as string | undefined, load: null as unknown, creatorProps: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (held.look ? { value: held.look } : undefined) }) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/events/new",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ center: { id: "c-1" } }) }));
vi.mock("@/lib/event-creator/load", () => ({ loadCreator: vi.fn(async () => held.load) }));
vi.mock("@/app/(app)/events/actions", () => ({
  saveEventDraftInPlace: vi.fn(),
  createEventFromTemplateInPlace: vi.fn(),
  createShift: vi.fn(),
  generateLunchSlots: vi.fn(),
  addChecklistAction: vi.fn(),
}));
vi.mock("@/app/(app)/events/new/actions", () => ({ draftEventReminderAction: vi.fn() }));
vi.mock("@/components/event-creator/event-creator", () => ({
  EventCreator: (props: unknown) => {
    held.creatorProps = props;
    return null;
  },
}));

import NewEventPage from "@/app/(app)/events/new/page";
import { addChecklistAction, createEventFromTemplateInPlace, createShift, generateLunchSlots, saveEventDraftInPlace } from "@/app/(app)/events/actions";
import { draftEventReminderAction } from "@/app/(app)/events/new/actions";
import { loadCreator } from "@/lib/event-creator/load";

const ID = "8e400000-0000-4000-8000-000000000001";
const open = (sp: Record<string, string>) => NewEventPage({ searchParams: Promise.resolve(sp) });

beforeEach(() => {
  held.look = "v2";
  held.load = null;
  held.creatorProps = null;
  vi.mocked(loadCreator).mockClear();
});

describe("/events/new", () => {
  it("the classic look keeps the event builder", async () => {
    held.look = undefined;
    await expect(open({})).rejects.toThrow("REDIRECT /events/builder");
    await expect(open({ event: ID })).rejects.toThrow(`REDIRECT /events/builder?event=${ID}`);
    held.look = "classic";
    await expect(open({ s: "abc" })).rejects.toThrow("REDIRECT /events/builder");
  });

  it("a new creator gets its own short `s`, so a reload after card 1 stays the same creator", async () => {
    await expect(open({})).rejects.toThrow(/^REDIRECT \/events\/new\?s=[0-9a-f]{16}$/);
  });

  it("someone who may not create events is told so, not shown an empty form", async () => {
    held.load = { state: "no_access", reason: "new" };
    const html = renderToStaticMarkup(await open({ s: "abc" }));
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(loadCreator).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("a draft that is not there says so", async () => {
    held.load = { state: "missing" };
    expect(renderToStaticMarkup(await open({ event: ID }))).toContain("That draft was not found");
    expect(renderToStaticMarkup(await open({ event: "not-a-uuid" }))).toContain("That draft was not found");
  });

  it("a failed load says so with Try again", async () => {
    held.load = { state: "error", message: "Could not load the draft — the database did not answer. Try again in a moment." };
    expect(renderToStaticMarkup(await open({ event: ID }))).toContain("Could not load the draft");
  });

  it("hands the creator the builder's own actions", async () => {
    held.load = { state: "ok", ctx: { c: 1 }, draft: { id: ID }, existing: { shifts: [] } };
    renderToStaticMarkup(await open({ event: ID }));
    expect(loadCreator).toHaveBeenCalledWith(expect.anything(), ID);
    expect(held.creatorProps).toMatchObject({
      initialDraft: { id: ID },
      sessionParam: null,
      api: {
        save: saveEventDraftInPlace,
        fromTemplate: createEventFromTemplateInPlace,
        createShift,
        generateLunchSlots,
        addChecklistAction,
        draftReminder: draftEventReminderAction,
      },
    });
  });
});
