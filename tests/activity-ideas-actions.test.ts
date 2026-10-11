import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/session", () => ({ authorizeAction: vi.fn(), loadSession: vi.fn(), dbWithReason: vi.fn() }));

import { revalidatePath } from "next/cache";

import { decideIdeaAction, giveActivityConsentAction, setActivitySharingAction, withdrawActivityConsentAction } from "@/app/(app)/settings/automation/actions";
import { setActivityRecordingAction } from "@/app/(app)/platform/centers/[id]/actions";
import { ACTIVITY_NOTICE_VERSION } from "@/lib/activity/consent";
import { authorizeAction, dbWithReason, loadSession } from "@/lib/session";

import { fakeDb, fakeSession, type FakeDbOptions } from "./commands/helpers";

const CENTER_ID = "center-1"; // the fake session's community
const IDEA = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";
const OTHER_CENTER = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(authorizeAction).mockReset();
  vi.mocked(loadSession).mockReset();
  vi.mocked(dbWithReason).mockReset();
});

// ── Settings › Automation ideas: answering an idea ───────────────────────────
describe("answering an automation idea", () => {
  function world(opts: FakeDbOptions = {}, status = "new") {
    const db = fakeDb({ tables: { automation_candidates: [{ id: IDEA, center_id: CENTER_ID, status }] }, ...opts });
    const session = fakeSession({ db });
    vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session });
    vi.mocked(dbWithReason).mockResolvedValue(db);
    return { db, session };
  }
  // The updates that changed a row (the fake records every attempt, also one that matched nothing).
  const changed = (db: ReturnType<typeof fakeDb>) => db.calls.filter((c) => c.op === "update" && c.ids.length > 0);
  const answer = (fields: Record<string, string> = {}) => decideIdeaAction(null, form({ id: IDEA, from: "new", decision: "accept", ...fields }));

  it("accepts a new idea with one status update, naming the community and the status the person saw", async () => {
    const { db } = world();
    const result = await answer();
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("Ideas you accepted") });
    expect(changed(db)).toEqual([{ table: "automation_candidates", op: "update", patch: { status: "accepted" }, ids: [IDEA] }]);
    expect(dbWithReason).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/settings/automation");
  });

  it("sets an idea aside, and the reason goes to the audit log with the change", async () => {
    const { db } = world();
    const result = await answer({ decision: "dismiss", reason: "  We already do this another way " });
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("set aside") });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "We already do this another way");
    expect(db.calls.find((c) => c.op === "update")?.patch).toEqual({ status: "dismissed" });
  });

  it("brings an idea back", async () => {
    world({}, "dismissed");
    expect(await answer({ from: "dismissed", decision: "restore" })).toMatchObject({ ok: true, message: expect.stringContaining("back in the list") });
  });

  it("refuses a person without the settings permission, in the words authorizeAction gave", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Could not save your answer — you don't have permission (needs settings.manage)." });
    const result = await answer();
    expect(result).toEqual({ ok: false, error: "Could not save your answer — you don't have permission (needs settings.manage)." });
    expect(authorizeAction).toHaveBeenCalledWith("centerSettings", "save your answer");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a form that is out of date", async () => {
    const { db } = world();
    const broken: Record<string, string>[] = [{ id: "not-an-id" }, { decision: "delete" }, { decision: "" }];
    for (const bad of broken) {
      const result = await answer(bad);
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^Could not save your answer — the page is out of date/) });
    }
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("refuses a move the state machine does not allow", async () => {
    const { db } = world({}, "dismissed");
    const result = await answer({ from: "dismissed", decision: "accept" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("can't be changed that way") });
    const built = await answer({ from: "built", decision: "dismiss" });
    expect(built.ok).toBe(false);
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("refuses a reason that is too long instead of cutting it", async () => {
    const { db } = world();
    const result = await answer({ reason: "x".repeat(501) });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("under 500 characters") });
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("says so, and changes nothing, when somebody answered the idea first", async () => {
    const { db } = world({}, "accepted"); // the page showed it as new; another administrator accepted it meanwhile
    const result = await answer({ decision: "dismiss" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/already answered, or it is no longer in the list/) });
    expect(changed(db)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not touch another community's idea", async () => {
    const db = fakeDb({ tables: { automation_candidates: [{ id: IDEA, center_id: OTHER_CENTER, status: "new" }] } });
    vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session: fakeSession({ db }) });
    expect(await answer()).toMatchObject({ ok: false, error: expect.stringContaining("already answered") });
    expect(changed(db)).toEqual([]);
  });

  it("explains a database refusal in plain English next to what the person did, and logs the detail", async () => {
    world({ failUpdates: { automation_candidates: { code: "42501", message: "new row violates row-level security policy for table \"automation_candidates\"" } } });
    const result = await answer();
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^Could not save your answer — /) });
    expect((result as { error: string }).error).not.toMatch(/row-level|automation_candidates|42501/);
    expect(console.error).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ── Platform › Centers: record how this community uses Weaver ────────────────
describe("switching activity recording on or off", () => {
  function world(opts: { platformAdmin?: boolean; failRpc?: FakeDbOptions["failRpc"] } = {}) {
    const db = fakeDb({ failRpc: opts.failRpc });
    vi.mocked(loadSession).mockResolvedValue({ status: "ok", session: fakeSession({ db, isPlatformAdmin: opts.platformAdmin ?? true }) });
    vi.mocked(dbWithReason).mockResolvedValue(db);
    return db;
  }
  const submit = (fields: Record<string, string> = {}) =>
    setActivityRecordingAction(null, form({ center: OTHER_CENTER, enable: "true", reason: "The board agreed on 9 October", ...fields }));

  it("switches recording on with the reason, through the database function", async () => {
    const db = world();
    const result = await submit();
    expect(result).toEqual({ ok: true, message: "Recording is now on for this community · audit logged" });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "The board agreed on 9 October");
    expect(db.rpcCalls).toEqual([{ fn: "set_activity_recording", args: { p_center: OTHER_CENTER, p_enabled: true } }]);
    expect(revalidatePath).toHaveBeenCalledWith(`/platform/centers/${OTHER_CENTER}`);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/automation");
  });

  it("switches it off", async () => {
    const db = world();
    expect(await submit({ enable: "false" })).toMatchObject({ ok: true, message: "Recording is now off for this community · audit logged" });
    expect(db.rpcCalls[0].args).toEqual({ p_center: OTHER_CENTER, p_enabled: false });
  });

  it("tells the person when the community's administrator has not agreed yet, and does not say it worked", async () => {
    world({ failRpc: { set_activity_recording: { code: "22023", message: "The community's administrator has not agreed yet." } } });
    const result = await submit();
    expect(result).toEqual({ ok: false, error: "Could not change activity recording — The community's administrator has not agreed yet." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("is for the Weaver team only", async () => {
    const db = world({ platformAdmin: false });
    const result = await submit();
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("only the Weaver team") });
    expect(db.rpcCalls).toEqual([]);
  });

  it("will not switch anything without a reason", async () => {
    const db = world();
    for (const reason of ["", "   "]) {
      expect(await submit({ reason })).toMatchObject({ ok: false, error: expect.stringContaining("say why") });
    }
    expect(await submit({ reason: "x".repeat(501) })).toMatchObject({ ok: false, error: expect.stringContaining("under 500 characters") });
    expect(db.rpcCalls).toEqual([]);
  });

  it("refuses a form that is out of date", async () => {
    const db = world();
    expect(await submit({ center: "nope" })).toMatchObject({ ok: false, error: expect.stringContaining("out of date") });
    expect(await submit({ enable: "maybe" })).toMatchObject({ ok: false, error: expect.stringContaining("out of date") });
    expect(db.rpcCalls).toEqual([]);
  });

  it("tells the person in plain English when the database refuses, never saying it worked", async () => {
    world({ failRpc: { set_activity_recording: { code: "42501", message: "Only the Weaver team can switch activity recording on or off." } } });
    const result = await submit();
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/^Could not change activity recording — /);
    expect(console.error).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ── Settings › Automation ideas: the community's agreement ───────────────────
describe("the community's agreement to activity recording", () => {
  const CCSTP = { code: "CCSTP", message: "A fresh 2FA check is needed for this." };

  /** A database whose rpc answers come from a queue (the last one repeats). */
  function rpcDb(...answers: Array<{ error: unknown } | "ok">) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    let i = 0;
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const a = answers[Math.min(i++, answers.length - 1)] ?? "ok";
        return a === "ok" ? { data: null, error: null } : { data: null, error: a.error };
      },
    };
    return { db, calls };
  }
  function admin(db: unknown, over: Record<string, unknown> = {}) {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session: fakeSession({ db, ...over }) });
  }
  const agree = (fields: Record<string, string> = {}) => giveActivityConsentAction(null, form({ notice_version: ACTIVITY_NOTICE_VERSION, ...fields }));

  it("records the agreement for this community with the version of the notice that was on screen (sharing off unless ticked)", async () => {
    const { db, calls } = rpcDb("ok");
    admin(db);
    const result = await agree();
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("only your own administrators see the results") });
    expect(calls).toEqual([{ fn: "give_activity_consent", args: { p_center: CENTER_ID, p_share_with_weaver: false, p_notice_version: ACTIVITY_NOTICE_VERSION } }]);
    expect(authorizeAction).toHaveBeenCalledWith("centerSettings", "record your agreement");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/automation");
  });

  it("passes the sharing choice only when the box was ticked", async () => {
    const { db, calls } = rpcDb("ok");
    admin(db);
    expect(await agree({ share: "on" })).toMatchObject({ ok: true, message: expect.stringContaining("Weaver staff can see counts") });
    expect(calls[0].args.p_share_with_weaver).toBe(true);
  });

  it("asks for the 2FA code: the first answer says so, and sending the same form again after the code works", async () => {
    const { db, calls } = rpcDb({ error: CCSTP }, "ok");
    admin(db);
    const fd = form({ notice_version: ACTIVITY_NOTICE_VERSION });
    const first = await giveActivityConsentAction(null, fd);
    expect(first).toMatchObject({ ok: false, stepUp: true, error: expect.stringMatching(/^Could not record your agreement — /) });
    expect(revalidatePath).not.toHaveBeenCalled();
    const second = await giveActivityConsentAction(null, fd);
    expect(second).toMatchObject({ ok: true });
    expect(calls.map((c) => c.fn)).toEqual(["give_activity_consent", "give_activity_consent"]);
    expect(calls[1].args).toEqual(calls[0].args);
  });

  it("records nothing when the notice changed after the page was opened", async () => {
    const { db, calls } = rpcDb("ok");
    admin(db);
    for (const stale of ["0", ""]) {
      expect(await agree({ notice_version: stale })).toMatchObject({ ok: false, error: expect.stringContaining("the notice changed") });
    }
    expect(calls).toEqual([]);
  });

  it("is for the community's own administrator: Weaver staff are told so, and so is someone without the permission", async () => {
    const { db, calls } = rpcDb("ok");
    admin(db, { isPlatformAdmin: true });
    expect(await agree()).toMatchObject({ ok: false, error: expect.stringContaining("only this community's own administrator can decide this, not the Weaver team") });
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Could not record your agreement — you don't have permission (needs settings.manage)." });
    expect(await agree()).toMatchObject({ ok: false, error: expect.stringContaining("you don't have permission") });
    expect(calls).toEqual([]);
  });

  it("explains a refusal from the database in plain English next to what the person did, and logs the detail", async () => {
    const { db } = rpcDb({ error: { code: "42501", message: "You don't have access to this area. Only the community's own administrator can decide this." } });
    admin(db);
    const result = await agree();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^Could not record your agreement — /) });
    expect((result as { error: string }).error).not.toMatch(/42501/);
    expect(console.error).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("withdraws the agreement", async () => {
    const { db, calls } = rpcDb("ok");
    admin(db);
    expect(await withdrawActivityConsentAction()).toEqual({ ok: true, message: "Your agreement is withdrawn. Weaver has stopped noting how your community uses it." });
    expect(calls).toEqual([{ fn: "withdraw_activity_consent", args: { p_center: CENTER_ID } }]);
    expect(authorizeAction).toHaveBeenCalledWith("centerSettings", "withdraw your agreement");
  });

  it("does not claim a withdrawal that failed", async () => {
    const { db } = rpcDb({ error: { code: "08006", message: "connection failure" } });
    admin(db);
    const result = await withdrawActivityConsentAction();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^Could not withdraw your agreement — /) });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("changes the sharing choice either way, with the 2FA code asked for the same way", async () => {
    const { db, calls } = rpcDb({ error: CCSTP }, "ok");
    admin(db);
    const fd = form({ share: "true" });
    expect(await setActivitySharingAction(null, fd)).toMatchObject({ ok: false, stepUp: true });
    expect(await setActivitySharingAction(null, fd)).toMatchObject({ ok: true, message: expect.stringContaining("can now see counts") });
    expect(await setActivitySharingAction(null, form({ share: "false" }))).toMatchObject({ ok: true, message: expect.stringContaining("can no longer see") });
    expect(calls.map((c) => c.args)).toEqual([
      { p_center: CENTER_ID, p_share: true },
      { p_center: CENTER_ID, p_share: true },
      { p_center: CENTER_ID, p_share: false },
    ]);
  });

  it("refuses a sharing form that is out of date, and says to agree first when the database does", async () => {
    const { db, calls } = rpcDb({ error: { code: "22023", message: "Agree to activity recording first." } });
    admin(db);
    expect(await setActivitySharingAction(null, form({ share: "maybe" }))).toMatchObject({ ok: false, error: expect.stringContaining("out of date") });
    expect(calls).toEqual([]);
    expect(await setActivitySharingAction(null, form({ share: "true" }))).toMatchObject({ ok: false, error: expect.stringContaining("Agree to activity recording first.") });
  });

  it("will not let Weaver staff answer an idea for the community", async () => {
    const db = fakeDb({ tables: { automation_candidates: [{ id: IDEA, center_id: CENTER_ID, status: "new" }] } });
    vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session: fakeSession({ db, isPlatformAdmin: true }) });
    const result = await decideIdeaAction(null, form({ id: IDEA, from: "new", decision: "accept" }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("only this community's own administrator") });
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
  });
});
