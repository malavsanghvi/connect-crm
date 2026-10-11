import { beforeEach, describe, expect, it, vi } from "vitest";

import { databaseConversationLog, databaseUsageMeter, forgetWhatWasSaid, isMissingFunction, isMissingTable } from "@/lib/assistant/store";

import { fakeDb } from "../commands/helpers";

const CENTER = "c0000000-0000-4000-8000-000000000001";
const THREAD = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9999";
const missingFunction = { code: "PGRST202", message: "Could not find the function app.assistant_usage_check(p_center, p_cost) in the schema cache" };

beforeEach(() => {
  forgetWhatWasSaid();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the monthly limit", () => {
  it("counts one use for the community and reads the verdict", async () => {
    const db = fakeDb({ rpc: { assistant_usage_check: { allowed: true, used: 12, limit: 300, month: "2026-10-01" } } });
    expect(await databaseUsageMeter(db, CENTER).check()).toEqual({ state: "allowed", used: 12, limit: 300 });
    expect(db.rpcCalls).toEqual([{ fn: "assistant_usage_check", args: { p_center: CENTER, p_cost: 1 } }]);
  });

  it("reads a community with no limit", async () => {
    const db = fakeDb({ rpc: { assistant_usage_check: { allowed: true, used: 3, limit: null, month: "2026-10-01" } } });
    expect(await databaseUsageMeter(db, CENTER).check()).toEqual({ state: "allowed", used: 3, limit: null });
  });

  it("passes on the database's own sentence when the limit is reached", async () => {
    const reason = "Niva has used up this community's 300 actions for the month. It starts again on the 1st, or ask Community Connect to raise the limit.";
    const db = fakeDb({ rpc: { assistant_usage_check: { allowed: false, used: 300, limit: 300, month: "2026-10-01", reason } } });
    expect(await databaseUsageMeter(db, CENTER).check()).toEqual({ state: "blocked", used: 300, limit: 300, reason });
  });

  it("treats a database without the function as no limit yet, and says so once", async () => {
    const db = fakeDb({ failRpc: { assistant_usage_check: missingFunction } });
    const meter = databaseUsageMeter(db, CENTER);
    expect(await meter.check()).toEqual({ state: "unmetered" });
    expect(await meter.check()).toEqual({ state: "unmetered" });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls[0][0]).toMatch(/assistant_usage_check does not exist yet/);
  });

  it("says why when the check itself fails, in plain English", async () => {
    const denied = fakeDb({ failRpc: { assistant_usage_check: { code: "42501", message: "You don't have access to this area." } } });
    expect(await databaseUsageMeter(denied, CENTER).check()).toEqual({ state: "failed", error: "Could not start — You don't have access to this area." });
    const other = fakeDb({ failRpc: { assistant_usage_check: { code: "08006", message: "connection failure" } } });
    const verdict = await databaseUsageMeter(other, CENTER).check();
    expect(verdict.state).toBe("failed");
    const garbled = fakeDb({ rpc: { assistant_usage_check: "yes" } });
    expect(await databaseUsageMeter(garbled, CENTER).check()).toMatchObject({ state: "failed" });
  });

  it("reads the numbers without counting", async () => {
    const db = fakeDb({ rpc: { assistant_usage_status: { used: 40, limit: 300, month: "2026-10-01" } } });
    expect(await databaseUsageMeter(db, CENTER).status()).toEqual({ used: 40, limit: 300, month: "2026-10-01" });
    expect(await databaseUsageMeter(fakeDb({ failRpc: { assistant_usage_status: missingFunction } }), CENTER).status()).toBeNull();
  });
});

describe("the conversation log", () => {
  // The database answers newest first; the log puts them back in order.
  const rows = [
    { center_id: CENTER, thread_id: THREAD, role: "assistant", content: "Two events.", created_at: "3" },
    { center_id: CENTER, thread_id: THREAD, role: "user", content: "Show events", created_at: "2" },
    { center_id: CENTER, thread_id: THREAD, role: "tool", content: "Look at events: done", created_at: "2.5" },
    { center_id: CENTER, thread_id: "other", role: "user", content: "Someone else's thread", created_at: "1" },
    { center_id: CENTER, thread_id: THREAD, role: "assistant", content: "Hello! (an old line)", created_at: "0" },
  ];

  it("reads the person's own earlier turns in order, without tool lines, starting with the person's words", async () => {
    const db = fakeDb({ tables: { assistant_messages: rows } });
    expect(await databaseConversationLog(db, CENTER).history(THREAD)).toEqual([
      { role: "user", text: "Show events" },
      { role: "assistant", text: "Two events." },
    ]);
  });

  it("has no memory, and says so once, when the table is not there yet", async () => {
    const db = fakeDb({ failTables: { assistant_messages: { code: "PGRST205", message: "Could not find the table 'app.assistant_messages' in the schema cache" } } });
    const log = databaseConversationLog(db, CENTER);
    expect(await log.history(THREAD)).toEqual([]);
    expect(await log.history(THREAD)).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("adds a line as the person, with the command it was about", async () => {
    const db = fakeDb({ rpc: { assistant_log_message: "line-id" } });
    expect(await databaseConversationLog(db, CENTER).append(THREAD, "tool", "Look at events: done", "events.look")).toEqual({});
    expect(db.rpcCalls).toEqual([{ fn: "assistant_log_message", args: { p_center: CENTER, p_thread: THREAD, p_role: "tool", p_content: "Look at events: done", p_command_key: "events.look" } }]);
  });

  it("shortens a very long line and skips an empty one", async () => {
    const db = fakeDb({ rpc: { assistant_log_message: "id" } });
    const log = databaseConversationLog(db, CENTER);
    await log.append(THREAD, "assistant", "x".repeat(9000));
    await log.append(THREAD, "assistant", "   ");
    expect(db.rpcCalls).toHaveLength(1);
    const sent = String(db.rpcCalls[0].args.p_content);
    expect(sent.length).toBeLessThanOrEqual(8000);
    expect(sent).toMatch(/\(shortened\)$/);
  });

  it("carries on when the function is not there yet, and says so once", async () => {
    const db = fakeDb({ failRpc: { assistant_log_message: { code: "42883", message: "function app.assistant_log_message does not exist" } } });
    const log = databaseConversationLog(db, CENTER);
    expect(await log.append(THREAD, "user", "hi")).toEqual({});
    expect(await log.append(THREAD, "user", "hi again")).toEqual({});
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("stops the conversation when it belongs to someone else or is too long, and not for other trouble", async () => {
    const someoneElse = fakeDb({ failRpc: { assistant_log_message: { code: "P0001", message: "That conversation belongs to someone else." } } });
    expect(await databaseConversationLog(someoneElse, CENTER).append(THREAD, "user", "hi")).toEqual({ blocked: "That conversation belongs to someone else." });
    const long = fakeDb({ failRpc: { assistant_log_message: { code: "P0001", message: "This conversation is getting long. Start a new one." } } });
    expect(await databaseConversationLog(long, CENTER).append(THREAD, "user", "hi")).toEqual({ blocked: "This conversation is getting long. Start a new one." });
    const flaky = fakeDb({ failRpc: { assistant_log_message: { code: "08006", message: "connection failure" } } });
    expect(await databaseConversationLog(flaky, CENTER).append(THREAD, "user", "hi")).toEqual({});
  });
});

describe("telling a missing part from a failure", () => {
  it("knows a missing function and a missing table", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "42501" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "PGRST202" })).toBe(false);
  });
});
