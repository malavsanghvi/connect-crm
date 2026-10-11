import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/session", () => ({ authorizeAction: vi.fn(), authorizeActionWhere: vi.fn(), dbWithReason: vi.fn() }));
vi.mock("@/lib/commands/screen", () => ({ runScreenCommand: vi.fn() }));

import { audienceAtAction, draftCloneAction, draftEventChangeAction } from "@/app/(app)/events/[id]/workspace-actions";
import { runScreenCommand } from "@/lib/commands/screen";
import { runForPage } from "@/lib/events/workspace-load";

import { fakeSession } from "./commands/helpers";

// The new-look event page's Niva cards are thin wrappers over the Events commands (one code path with the palette and Niva), and
// the page itself only ever runs read and draft commands: a confirm-level command becomes a card in Niva's panel, never a page run.

const ID = "00000000-0000-4000-8000-00000000e001";

beforeEach(() => {
  vi.mocked(runScreenCommand).mockReset();
  vi.mocked(runScreenCommand).mockResolvedValue({ ok: true, data: { sample: true } } as never);
});

describe("the page's Server Actions", () => {
  it("drafts a change through events.draft_change with the action's own wording", async () => {
    const res = await draftEventChangeAction(ID, "venue", "Riverside Park pavilion");
    expect(res).toEqual({ ok: true, data: { sample: true } });
    expect(vi.mocked(runScreenCommand).mock.calls).toEqual([["events.draft_change", { event_id: ID, field: "venue", value: "Riverside Park pavilion" }, "show the change"]]);
  });

  it("prepares a copy through events.clone_draft, leaving a blank name out", async () => {
    await draftCloneAction(ID, "2027-11-06", "  ");
    await draftCloneAction(ID, "2027-11-06", " Harvest Supper 2027 ");
    expect(vi.mocked(runScreenCommand).mock.calls).toEqual([
      ["events.clone_draft", { event_id: ID, new_date: "2027-11-06" }, "prepare the copy"],
      ["events.clone_draft", { event_id: ID, new_date: "2027-11-06", name: "Harvest Supper 2027" }, "prepare the copy"],
    ]);
  });

  it("counts the reminder's audience at another time through events.audience_preview, now when no time is given", async () => {
    await audienceAtAction(ID, "2026-11-06T22:30");
    await audienceAtAction(ID, "");
    expect(vi.mocked(runScreenCommand).mock.calls).toEqual([
      ["events.audience_preview", { event_id: ID, who: "reminder", send_at: "2026-11-06T22:30" }, "count who the reminder would reach"],
      ["events.audience_preview", { event_id: ID, who: "reminder" }, "count who the reminder would reach"],
    ]);
  });

  it("passes a refusal on as it is", async () => {
    vi.mocked(runScreenCommand).mockResolvedValueOnce({ ok: false, error: "Could not show the change — you don't have permission (needs events.manage)." });
    expect(await draftEventChangeAction(ID, "venue", "x")).toEqual({ ok: false, error: "Could not show the change — you don't have permission (needs events.manage)." });
  });
});

describe("runForPage", () => {
  it("never runs a confirm-level command, even for someone who may", async () => {
    const owner = fakeSession({ isOwner: true, permissions: ["events.view", "events.manage"] });
    for (const key of ["events.set_field", "events.create_from_clone", "events.set_status"]) {
      const r = await runForPage(owner, key, { event_id: ID, field: "venue", value: "x" });
      expect(r, key).toEqual({ ok: false, error: `Weaver does not have a page action called "${key}".` });
    }
  });

  it("says why when the person's role does not allow the command", async () => {
    const r = await runForPage(fakeSession({ permissions: [] }), "events.audience_preview", { event_id: ID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Could not preview who a reminder would reach — you don't have permission/);
  });

  it("checks the input before anything is read", async () => {
    const r = await runForPage(fakeSession({ permissions: ["events.view"] }), "events.audience_preview", { event_id: "not-an-id" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Could not preview who a reminder would reach — /);
  });
});
