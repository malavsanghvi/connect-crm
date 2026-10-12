// The guided event creator saves through the builder's own actions. saveEventDraftInPlace and createEventFromTemplateInPlace
// are the SAME bodies as saveEvent and createEventFromTemplate (same rules, same write, same sentences, same activity key); the
// only differences are that a new draft answers with its id instead of opening the builder, and that the creator never
// publishes. draftEventReminderAction is a thin wrapper over the messages.draft_reminder command.
import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ session: null as unknown, grants: [] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("@/lib/data/event-survey", () => ({ readSurveyNotices: vi.fn() }));
vi.mock("@/lib/commands/screen", () => ({ runScreenCommand: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  activityParts: (option: string | { key: string; entityFrom?: unknown; via?: unknown }) =>
    typeof option === "string" ? { key: option, opts: {} } : { key: option.key, opts: { entityFrom: option.entityFrom, via: option.via } },
  withActivity: vi.fn((_key: string, action: () => Promise<unknown>) => action()),
}));
vi.mock("@/lib/data/events", () => ({
  eventActionContext: async (check: (a: unknown) => boolean, denied: string) => {
    const { FormError } = await import("@/lib/events/forms");
    const s = held.session as { permissions: string[]; db: unknown; center: { id: string; time_zone: string }; userId: string };
    const access = { permissions: s.permissions, isPlatformAdmin: false, isOwner: false, grants: held.grants };
    if (!check(access)) throw new FormError(denied);
    return { session: s, access, db: s.db, centerId: s.center.id, tz: s.center.time_zone, userId: s.userId };
  },
}));

import { redirect } from "next/navigation";

import { createEventFromTemplate, createEventFromTemplateInPlace, saveEvent, saveEventDraftInPlace } from "@/app/(app)/events/actions";
import { draftEventReminderAction } from "@/app/(app)/events/new/actions";
import { withActivity } from "@/lib/activity/with-activity";
import { runScreenCommand } from "@/lib/commands/screen";
import { fixtureDraft } from "@/lib/event-creator/fixtures";
import { toEntries } from "@/lib/event-creator/mapping";

import { addEventsWorld, EV, recordInserts } from "./commands/events-world";
import { communityWithChildren, fakeDb, fakeSession } from "./commands/helpers";

const MANAGER = ["events.view", "events.manage"];

function as(permissions: string[], tweak?: (w: ReturnType<typeof communityWithChildren>) => void) {
  const world = addEventsWorld(communityWithChildren());
  world.tables.role_grants = [];
  world.rpc.create_event_from_template = EV.newEvent;
  tweak?.(world);
  const db = fakeDb(world);
  const inserts = recordInserts(db as unknown as { from: (t: string) => unknown });
  held.session = fakeSession({ db, permissions });
  held.grants = [];
  return { world, db, inserts };
}

/** The creator's form for a temple draft (what toFormData sends), optionally changed. */
function form(patch: Record<string, string | null> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of toEntries(fixtureDraft("temple", { saved: true }))) if (!(k in patch)) fd.append(k, v);
  for (const [k, v] of Object.entries(patch)) if (v !== null) fd.set(k, v);
  return fd;
}

const updates = (db: ReturnType<typeof fakeDb>) => db.calls.filter((c) => c.op === "update").map((c) => ({ table: c.table, patch: c.patch, ids: c.ids }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(withActivity).mockClear();
  vi.mocked(redirect).mockClear();
  vi.mocked(runScreenCommand).mockReset();
});

describe("saveEventDraftInPlace is saveEvent's own save", () => {
  it("an update answers exactly as the builder does, with the same write", async () => {
    const a = as(MANAGER);
    const viaBuilder = await saveEvent(EV.diwali, null, form());
    const b = as(MANAGER);
    const viaCreator = await saveEventDraftInPlace(EV.diwali, form());
    // toStrictEqual: no extra keys, the same sentence.
    expect(viaCreator).toStrictEqual(viaBuilder);
    expect(viaBuilder).toStrictEqual({ ok: true, message: "Event saved" });
    expect(updates(b.db)).toStrictEqual(updates(a.db));
    expect(updates(b.db)[0].patch).toMatchObject({ name: "Diwali dinner and cultural program", venue: "Main hall", member_price_cents: 1200, lunch_seats_per_slot: 60 });
  });

  it("never publishes: an `intent` of publish is replaced by draft", async () => {
    const draftGarba = (w: ReturnType<typeof communityWithChildren>) => {
      w.tables.events.find((e) => e.id === EV.garba)!.status = "draft";
    };
    const b = as(MANAGER, draftGarba);
    expect(await saveEventDraftInPlace(EV.garba, form({ intent: "publish" }))).toStrictEqual({ ok: true, message: "Draft saved" });
    expect(b.world.tables.events.find((e) => e.id === EV.garba)!.status).toBe("draft");
    expect(updates(b.db)[0].patch).not.toHaveProperty("status");
    // The builder's own Publish still publishes (its sentence is not checked here: the fake database hands back the row itself,
    // so the update changes the status it read).
    const a = as(MANAGER, draftGarba);
    expect((await saveEvent(EV.garba, null, form({ intent: "publish" }))).ok).toBe(true);
    expect(updates(a.db)[0].patch).toMatchObject({ status: "published" });
  });

  it("a new draft: the same row as the builder's, but it answers with the id instead of opening the builder", async () => {
    const a = as(MANAGER);
    await saveEvent(null, null, form());
    expect(redirect).toHaveBeenCalledWith(`/events/builder?event=${EV.newEvent}&saved=draft`);
    vi.mocked(redirect).mockClear();
    const b = as(MANAGER);
    expect(await saveEventDraftInPlace(null, form())).toStrictEqual({ ok: true, message: "Draft saved", data: { id: EV.newEvent } });
    expect(redirect).not.toHaveBeenCalled();
    expect(b.inserts).toStrictEqual(a.inserts);
    expect(b.inserts[0].rows).toMatchObject({ status: "draft", center_id: "center-1", created_by: "user-1", name: "Diwali dinner and cultural program" });
  });

  it("problems read the same, word for word", async () => {
    as(MANAGER);
    const bad = form({ ends_at: "2026-11-08T17:00" });
    const viaBuilder = await saveEvent(null, null, bad);
    as(MANAGER);
    expect(await saveEventDraftInPlace(null, form({ ends_at: "2026-11-08T17:00" }))).toStrictEqual(viaBuilder);
    expect(viaBuilder).toStrictEqual({ ok: false, error: "Could not save the draft — the event must end after it starts." });
  });

  it("the same permission rule and sentence (only event managers create events)", async () => {
    as(["events.view"]);
    const viaBuilder = await saveEvent(null, null, form());
    as(["events.view"]);
    expect(await saveEventDraftInPlace(null, form())).toStrictEqual(viaBuilder);
    expect(viaBuilder).toStrictEqual({ ok: false, error: "Could not save the draft — only event managers can create events." });
  });

  it("the same activity key and entity", async () => {
    as(MANAGER);
    await saveEventDraftInPlace(EV.diwali, form());
    await saveEvent(EV.diwali, null, form());
    const calls = vi.mocked(withActivity).mock.calls.map((c) => [c[0], c[2]]);
    expect(calls[0]).toStrictEqual(calls[1]);
    expect(calls[0][0]).toBe("events.save");
  });
});

describe("createEventFromTemplateInPlace is the builder's template start", () => {
  function tplForm() {
    const fd = new FormData();
    fd.set("template_id", "tpl-festival");
    fd.set("name", "Diwali dinner");
    fd.set("starts_at", "2026-11-08T18:00");
    return fd;
  }

  it("the same RPC and defaults; it answers with the new draft's id", async () => {
    const a = as(MANAGER);
    await createEventFromTemplate(null, tplForm());
    expect(redirect).toHaveBeenCalledWith(`/events/builder?event=${EV.newEvent}&saved=template`);
    vi.mocked(redirect).mockClear();
    const b = as(MANAGER);
    expect(await createEventFromTemplateInPlace(tplForm())).toStrictEqual({ ok: true, message: "Draft created from the template", data: { id: EV.newEvent } });
    expect(redirect).not.toHaveBeenCalled();
    expect(b.db.rpcCalls).toStrictEqual(a.db.rpcCalls);
    expect(b.db.rpcCalls[0]).toMatchObject({ fn: "create_event_from_template", args: { p_template: "tpl-festival", p_name: "Diwali dinner" } });
  });

  it("the same refusal for someone who cannot create events", async () => {
    as(["events.view"]);
    const viaBuilder = await createEventFromTemplate(null, tplForm());
    as(["events.view"]);
    expect(await createEventFromTemplateInPlace(tplForm())).toStrictEqual(viaBuilder);
    expect(viaBuilder).toStrictEqual({ ok: false, error: "Could not create the event from the template — only event managers can create events." });
  });
});

describe("draftEventReminderAction", () => {
  it("runs messages.draft_reminder for every language and answers with exactly what the command answered", async () => {
    const answer = { ok: true as const, message: "Drafted", data: { event: { id: EV.diwali, name: "Diwali" }, drafts: [], sent: false as const, notes: [] } };
    vi.mocked(runScreenCommand).mockResolvedValue(answer);
    expect(await draftEventReminderAction(EV.diwali)).toBe(answer);
    expect(runScreenCommand).toHaveBeenCalledWith("messages.draft_reminder", { event_id: EV.diwali, kind: "event_reminder", language: "all" }, "draft the reminder");
  });
});
