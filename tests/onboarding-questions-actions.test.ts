import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions of Setup > Guided onboarding > Questions, with the session replaced by a stand-in and the database by a
// stand-in client: what each action sends to the functions of 0631, what it refuses to send, and what it answers the screen.
const stub = vi.hoisted(() => ({
  allowed: true,
  households: true,
  answers: {} as Record<string, { data?: unknown; error?: { code?: string; message: string; details?: string } }>,
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  activity: [] as string[],
  existing: { ok: true, data: { households: [] as unknown[], truncated: false, withoutNumber: 0 } } as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  withActivity: async (key: string, action: () => Promise<unknown>) => {
    stub.activity.push(key);
    return action();
  },
}));
vi.mock("@/lib/permissions", () => ({ canAccess: () => stub.households }));
vi.mock("@/lib/session", () => ({
  authorizeAction: async (_key: string, doing: string) => {
    if (!stub.allowed) return { ok: false, error: `Could not ${doing} — you don't have permission (needs people.manage).` };
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        stub.rpc.push({ name, args });
        const a = stub.answers[name] ?? {};
        return { data: a.data ?? null, error: a.error ?? null };
      },
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }),
    };
    return { ok: true, session: { db, center: { id: "c0000000-0000-4000-8000-000000000001", time_zone: "America/Chicago" } } };
  },
}));
vi.mock("@/app/(app)/setup/onboarding/actions", () => ({ loadExistingHouseholdsAction: async () => stub.existing }));

import { answerQuestionAction, deferQuestionAction, findMatchesAction, loadInboxAction, reopenQuestionAction } from "@/app/(app)/setup/onboarding/questions/actions";

const RUN = "a1111111-1111-4111-8111-111111111111";
const GROUP = "b2222222-2222-4222-8222-222222222222";
const ITEM = "c3333333-3333-4333-8333-333333333333";

const readyInbox = { status: "ready", stalled: false, record_count: 10, progress: { groups_total: 1, questions_left: 1, items_open: 2 }, groups: [] };

beforeEach(() => {
  stub.allowed = true;
  stub.households = true;
  stub.answers = {};
  stub.rpc = [];
  stub.activity = [];
  stub.existing = { ok: true, data: { households: [], truncated: false, withoutNumber: 0 } };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("answering", () => {
  it("answers the item in front and hands the screen the inbox as it is now", async () => {
    stub.answers.resolve_answer = { data: { answered: 14, open_items: 0, status: "answered", remembered_as: "rule:x" } };
    stub.answers.resolve_inbox = { data: readyInbox };
    const res = await answerQuestionAction({ runId: RUN, groupId: GROUP, itemId: ITEM, answer: "separate", scope: "rest" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.outcome).toEqual({ answered: 14, openItems: 0, status: "answered", rememberedAs: "rule:x" });
    expect(res.data.view.status).toBe("ready");
    expect(stub.rpc[0]).toEqual({
      name: "resolve_answer",
      args: { p_group: GROUP, p_answer: "separate", p_item: ITEM, p_apply_rest: true, p_remember: true },
    });
    expect(stub.rpc[1].name).toBe("resolve_inbox");
    expect(stub.activity).toEqual(["onboarding.answer_question"]);
  });

  it("answers only the item when the scope is one", async () => {
    stub.answers.resolve_answer = { data: { answered: 1, open_items: 2, status: "open", remembered_as: null } };
    stub.answers.resolve_inbox = { data: readyInbox };
    await answerQuestionAction({ runId: RUN, groupId: GROUP, itemId: ITEM, answer: "same_household", scope: "one" });
    expect(stub.rpc[0].args.p_apply_rest).toBe(false);
  });

  it("sends nothing for a question or item it cannot make sense of", async () => {
    const res = await answerQuestionAction({ runId: "nope", groupId: GROUP, itemId: ITEM, answer: "separate", scope: "one" });
    expect(res).toEqual({ ok: false, error: "Could not record your answer — this page lost track of the question. Reload the page." });
    const bad = await answerQuestionAction({ runId: RUN, groupId: GROUP, itemId: ITEM, answer: "separate", scope: "everyone" as "one" });
    expect(bad.ok).toBe(false);
    expect(stub.rpc).toEqual([]);
  });

  it("says in plain words what went wrong, next to what the person did", async () => {
    stub.answers.resolve_answer = { error: { code: "P0001", message: "That is not one of the answers to this question." } };
    expect(await answerQuestionAction({ runId: RUN, groupId: GROUP, itemId: ITEM, answer: "separate", scope: "one" })).toEqual({
      ok: false,
      error: "Could not record your answer — That is not one of the answers to this question.",
    });
  });

  it("keeps the database's own sentence when a permission is missing, and says access is the cause", async () => {
    stub.answers.resolve_answer = { error: { code: "42501", message: "Answering questions about gifts needs one of these permissions: giving.manage." } };
    expect(await answerQuestionAction({ runId: RUN, groupId: GROUP, itemId: ITEM, answer: "same_gift", scope: "one" })).toEqual({
      ok: false,
      denied: true,
      error: "Could not record your answer — Answering questions about gifts needs one of these permissions: giving.manage.",
    });
  });

  it("says the answer was saved when only reading the inbox again failed", async () => {
    stub.answers.resolve_answer = { data: { answered: 1, open_items: 0, status: "answered", remembered_as: null } };
    stub.answers.resolve_inbox = { error: { message: "fetch failed" } };
    const res = await answerQuestionAction({ runId: RUN, groupId: GROUP, itemId: ITEM, answer: "separate", scope: "one" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Could not open the questions");
    expect(res.error).toContain("(what you did was saved)");
  });

  it("refuses a person who may not import, without touching the database", async () => {
    stub.allowed = false;
    const res = await answerQuestionAction({ runId: RUN, groupId: GROUP, itemId: ITEM, answer: "separate", scope: "one" });
    expect(res).toEqual({ ok: false, error: "Could not answer the question — you don't have permission (needs people.manage)." });
    expect(stub.rpc).toEqual([]);
  });
});

describe("later, skip, take back", () => {
  it("puts a question off or skips it, and hands back the inbox", async () => {
    stub.answers.resolve_inbox = { data: readyInbox };
    expect((await deferQuestionAction({ runId: RUN, groupId: GROUP, status: "postponed" })).ok).toBe(true);
    expect((await deferQuestionAction({ runId: RUN, groupId: GROUP, status: "skipped" })).ok).toBe(true);
    expect(stub.rpc.filter((c) => c.name === "resolve_set_group_status").map((c) => c.args.p_status)).toEqual(["postponed", "skipped"]);
    expect(stub.activity).toEqual(["onboarding.defer_question", "onboarding.defer_question"]);
  });

  it("does not pass a question on: that is coming soon, and the action will not send it", async () => {
    const res = await deferQuestionAction({ runId: RUN, groupId: GROUP, status: "sent" as "postponed" });
    expect(res).toEqual({ ok: false, error: "Could not put the question off — that is not something a question can be set to." });
    expect(stub.rpc).toEqual([]);
  });

  it("explains a failure to put a question off", async () => {
    stub.answers.resolve_set_group_status = { error: { code: "P0001", message: "This question is already answered. Reopen it first." } };
    expect(await deferQuestionAction({ runId: RUN, groupId: GROUP, status: "postponed" })).toEqual({
      ok: false,
      error: "Could not put the question off — This question is already answered. Reopen it first.",
    });
  });

  it("takes the answers back", async () => {
    stub.answers.resolve_inbox = { data: readyInbox };
    expect((await reopenQuestionAction({ runId: RUN, groupId: GROUP })).ok).toBe(true);
    expect(stub.rpc[0]).toEqual({ name: "resolve_reopen", args: { p_group: GROUP } });
    expect(stub.activity).toEqual(["onboarding.reopen_question"]);
  });
});

describe("looking for matches", () => {
  it("does not look at an import it cannot find, or one that is not a kind it checks", async () => {
    expect(await findMatchesAction("nope")).toEqual({ ok: false, error: "Could not look for matches — that import was not found." });
    stub.answers.import_run_get = { data: { entity: "events", file_name: "e.csv", run_number: 4, status: "staged" } };
    const res = await findMatchesAction(RUN);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("rows of this kind are not checked for matches yet");
  });

  it("reads an import that is not there as not found", async () => {
    stub.answers.import_run_get = { error: { code: "P0001", message: "That import was not found." } };
    expect(await findMatchesAction(RUN)).toEqual({ ok: false, error: "Could not look for matches — That import was not found." });
  });

  it("asks the database about the import first, records the action, and stops with a sentence when there are no rows", async () => {
    stub.households = false;
    stub.answers.import_run_get = { data: { entity: "people", file_name: "people.csv", run_number: 4, status: "staged" } };
    stub.answers.resolve_stage_records = { data: 1 };
    const res = await findMatchesAction(RUN);
    // The stand-in database has no rows to read, so the check stops there with a sentence, and nothing is staged.
    expect(res).toEqual({ ok: false, error: "Could not get the rows ready to look for matches — there are no rows." });
    expect(stub.rpc.some((c) => c.name === "resolve_stage_records")).toBe(false);
    expect(stub.rpc[0].name).toBe("import_run_get");
    expect(stub.activity).toEqual(["onboarding.find_matches"]);
  });
});

describe("reading", () => {
  it("opens the inbox", async () => {
    stub.answers.resolve_inbox = { data: readyInbox };
    const res = await loadInboxAction(RUN);
    expect(res.ok && res.data.status).toBe("ready");
    expect(await loadInboxAction("nope")).toEqual({ ok: false, error: "Could not open the questions — that import was not found." });
  });
});
