// The Content Server Actions that now run a command (publish or return an item in the approval queue, retire a Niva source) answer exactly
// as they did when they did the work themselves: the same ActionResult, the same sentences, the same permission asked with the same
// wording. The expectations below were first run against the actions BEFORE they became wrappers; they are `toStrictEqual`, so a screen
// reading the result sees no extra key.
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  session: null as unknown,
  db: null as unknown,
  refusal: null as string | null,
  state: null as unknown,
  asked: [] as { key: string; doing: string }[],
  reasons: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async (key: string, doing: string) => {
    stub.asked.push({ key, doing });
    return stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session };
  }),
  authorizeActionWhere: vi.fn(),
  loadSession: vi.fn(async () => stub.state ?? { status: "ok", session: stub.session }),
  dbWithReason: vi.fn(async (_session: unknown, reason: string) => {
    stub.reasons.push(reason);
    return stub.db;
  }),
}));

import { revalidatePath } from "next/cache";

import { decideContentAction } from "@/app/(app)/content/actions";
import { retireNivaSourceAction } from "@/app/(app)/content/niva/actions";

import { ALL_STAFF, contentStoreDb, csSession, SEEN, W } from "./commands/content-store-world";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

type Dict = Record<string, unknown>;

function setup(opts: { permissions?: string[]; failTables?: Record<string, { message: string }>; failUpdates?: Record<string, { message: string }>; failRpc?: Record<string, { message: string }>; modulesOff?: string[] } = {}) {
  const world = contentStoreDb({ failTables: opts.failTables, failUpdates: opts.failUpdates, failRpc: opts.failRpc });
  stub.db = world.db;
  stub.session = csSession(world.db, { permissions: opts.permissions ?? ALL_STAFF, ...(opts.modulesOff ? { modulesOff: opts.modulesOff } : {}) });
  stub.refusal = null;
  stub.state = null;
  stub.asked = [];
  stub.reasons = [];
  return world;
}
const row = (tables: Record<string, Dict[]>, id: string) => tables.content_items.find((r) => r.id === id) as Dict;
const NIVA_SEEN = "2026-10-07T15:00:00.250000+00:00";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
});

describe("decideContentAction", () => {
  const decide = (fields: Record<string, string>) => decideContentAction(null, form(fields));

  it("publishes the text that was read, and says so", async () => {
    const { tables } = setup();
    expect(await decide({ decision: "approve", id: W.ciFaq, seen: SEEN.faq })).toStrictEqual({ ok: true, message: '"Where do I park?" published.' });
    expect(row(tables, W.ciFaq)).toMatchObject({ status: "published", approved_by: "user-1" });
    expect(row(tables, W.ciFaq).published_at).toBeTruthy();
    expect(stub.asked[0]).toStrictEqual({ key: "contentApprove", doing: "publish the item" });
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toStrictEqual(["/content"]);
  });

  it("tries Niva's unanswered questions again after a Niva source is published", async () => {
    const { tables, db } = setup();
    expect(await decide({ decision: "approve", id: W.ciNiva, seen: NIVA_SEEN })).toStrictEqual({
      ok: true,
      message: '"Diwali dinner food" published. 3 unanswered questions will be tried again.',
    });
    expect(db.rpcCalls.find((c) => c.fn === "niva_retry_unanswered")?.args).toStrictEqual({ p_center: "center-1", p_limit: 100 });
    expect(row(tables, W.ciNiva).status).toBe("published");
    setup({ modulesOff: ["niva"] });
    expect(await decide({ decision: "approve", id: W.ciNiva, seen: NIVA_SEEN })).toStrictEqual({ ok: true, message: '"Diwali dinner food" published.' });
  });

  it("returns an item to its author with the reason on the audit entry", async () => {
    const { tables } = setup();
    expect(await decide({ decision: "return", id: W.ciFaq, reason: "Say where the overflow parking is." })).toStrictEqual({ ok: true, message: '"Where do I park?" returned to its author.' });
    expect(row(tables, W.ciFaq)).toMatchObject({ status: "draft", approved_by: null });
    expect(stub.reasons).toStrictEqual(["Say where the overflow parking is."]);
    expect(stub.asked[0]).toStrictEqual({ key: "contentApprove", doing: "return the item to its author" });
    // The reason is kept to 500 characters.
    setup();
    await decide({ decision: "return", id: W.ciFaq, reason: "x".repeat(600) });
    expect(stub.reasons[0]).toHaveLength(500);
  });

  it("refuses with the sentences it always had", async () => {
    setup();
    const cases: [Record<string, string>, string][] = [
      [{ decision: "approve", id: "nope", seen: SEEN.faq }, "Could not publish the item — the request was incomplete. Reload the queue and try again."],
      [{ decision: "approve", id: W.ciFaq }, "Could not publish the item — the request was incomplete. Reload the queue and try again."],
      [{ decision: "approve", id: W.ciFaq, seen: "yesterday" }, "Could not publish the item — the request was incomplete. Reload the queue and try again."],
      [{ decision: "return", id: W.ciFaq, seen: "yesterday", reason: "x" }, "Could not return the item to its author — the request was incomplete. Reload the queue and try again."],
      [{ decision: "maybe", id: W.ciFaq, seen: SEEN.faq }, "Could not publish the item — the request was incomplete. Reload the queue and try again."],
      [{ decision: "approve", id: W.ciMissing, seen: SEEN.faq }, "Could not publish the item — the item no longer exists, or you can't see it."],
      [{ decision: "approve", id: W.ciDraft, seen: SEEN.faq }, 'Could not publish the item — "A draft" is no longer awaiting approval.'],
      [{ decision: "return", id: W.ciFaq }, "Could not return the item to its author — say what the author should change."],
      [{ decision: "return", id: W.ciDraft, reason: "x" }, 'Could not return the item to its author — "A draft" is no longer awaiting approval.'],
      [
        { decision: "approve", id: W.ciFaq, seen: "2026-10-01T00:00:00.000000+00:00" },
        'Could not publish the item — "Where do I park?" was changed after you opened the queue, or is no longer awaiting approval. Reload the queue and read it again.',
      ],
    ];
    for (const [fields, error] of cases) expect(await decide(fields), error).toStrictEqual({ ok: false, error });
  });

  it("refuses a person who may not approve, or may not manage, in the same words", async () => {
    setup();
    stub.refusal = "Could not publish the item — you don't have permission (needs content.approve).";
    expect(await decide({ decision: "approve", id: W.ciFaq, seen: SEEN.faq })).toStrictEqual({ ok: false, error: stub.refusal });
    setup({ permissions: ["content.approve"] });
    expect(await decide({ decision: "approve", id: W.ciFaq, seen: SEEN.faq })).toStrictEqual({
      ok: false,
      error: "Could not publish the item — publishing also needs content.manage (the database only lets content managers change an item's status).",
    });
  });

  it("explains a database failure, and says the source was published when only trying the questions again failed", async () => {
    setup({ failTables: { content_items: { message: "boom" } } });
    expect(await decide({ decision: "approve", id: W.ciFaq, seen: SEEN.faq })).toStrictEqual({ ok: false, error: "Could not publish the item — boom." });
    const { tables } = setup({ failUpdates: { content_items: { message: "nope" } } });
    expect(await decide({ decision: "approve", id: W.ciFaq, seen: SEEN.faq })).toStrictEqual({ ok: false, error: "Could not publish the item — nope." });
    expect(row(tables, W.ciFaq).status).toBe("in_review");
    setup({ failRpc: { niva_retry_unanswered: { message: "rpc down" } } });
    expect(await decide({ decision: "approve", id: W.ciNiva, seen: NIVA_SEEN })).toStrictEqual({
      ok: false,
      error: '"Diwali dinner food" was published, but Niva could not try its unanswered questions again — rpc down.',
    });
  });
});

describe("retireNivaSourceAction", () => {
  const retire = (id: string) => retireNivaSourceAction(null, form({ id }));

  it("retires a source, leaves its answers alone, and records the reason", async () => {
    const { tables } = setup();
    expect(await retire(W.ciPublished)).toStrictEqual({
      ok: true,
      message: '"Timings" retired: Niva no longer answers from it. Answers that already cite it stay until you press Regenerate on them.',
    });
    expect(row(tables, W.ciPublished).status).toBe("retired");
    expect(stub.reasons).toStrictEqual(["Retired from Niva on Content › Niva"]);
    expect(stub.asked[0]).toStrictEqual({ key: "contentManage", doing: "retire the source" });
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toStrictEqual(["/content"]);
  });

  it("only retires a source of this community that is not retired yet", async () => {
    setup();
    const gone = "Could not retire the source — it is already retired, or it is not one of this community's sources. Reload the page to see the current list.";
    expect(await retire(W.ciRetired)).toStrictEqual({ ok: false, error: gone });
    expect(await retire(W.ciMissing)).toStrictEqual({ ok: false, error: gone });
    expect(await retire(W.ciFaq)).toStrictEqual({ ok: false, error: gone }); // a FAQ is not a Niva source
    expect(await retire("not-an-id")).toStrictEqual({ ok: false, error: "Could not retire the source — no source was given. Reload the page and try again." });
    expect(await retire("")).toStrictEqual({ ok: false, error: "Could not retire the source — no source was given. Reload the page and try again." });
  });

  it("refuses a person who may not manage content, and explains a database failure", async () => {
    setup();
    stub.refusal = "Could not retire the source — you don't have permission (needs content.manage).";
    expect(await retire(W.ciPublished)).toStrictEqual({ ok: false, error: stub.refusal });
    const { tables } = setup({ failUpdates: { content_items: { message: "nope" } } });
    expect(await retire(W.ciPublished)).toStrictEqual({ ok: false, error: "Could not retire the source — nope." });
    expect(row(tables, W.ciPublished).status).toBe("published");
    setup({ failTables: { content_items: { message: "boom" } } });
    expect(await retire(W.ciPublished)).toStrictEqual({ ok: false, error: "Could not retire the source — boom." });
  });
});
