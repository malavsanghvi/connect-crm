import { describe, expect, it } from "vitest";

import { aiServiceFromHandler, aiServiceFromStatus } from "@/lib/ai-service";

const TZ = "America/Chicago";
const now = new Date("2026-10-02T15:00:00Z");

/** A handler entry as the worker's heartbeat writes it (worker/src/ai-status.ts + server.ts). */
const entry = (ai: Record<string, unknown>) => ({
  configured: true,
  ai: {
    state: "ok", since: null, last_ok_at: null, last_error_at: null, last_error_kind: null, last_error: null, paused_until: null,
    key_source: "environment", env_key_unused: false, ...ai,
  },
});

describe("aiServiceFromHandler", () => {
  it("says it is working, since when, and where the key comes from", () => {
    expect(aiServiceFromHandler(entry({ state: "ok", since: "2026-10-02T14:00:00Z" }), TZ, now)).toEqual({
      tone: "ok",
      label: "Working",
      detail: "Niva and the suggestions reach Anthropic (working since Oct 2, 2026, 9:00 AM).",
      key: "Key: from the background service's environment (ANTHROPIC_API_KEY); none is saved in Platform › Setup.",
      lastError: null,
    });
  });

  it("names the spending-limit pause and when it ends", () => {
    const v = aiServiceFromHandler(
      entry({
        state: "paused", since: "2026-10-02T14:30:00Z", last_ok_at: "2026-10-02T14:00:00Z", paused_until: "2026-11-01T00:00:00Z",
        last_error_at: "2026-10-02T14:45:00Z", last_error_kind: "quota", last_error: "400 invalid_request_error: You have reached your specified API usage limits.",
        key_source: "saved", env_key_unused: true,
      }),
      TZ,
      now,
    )!;
    expect(v.tone).toBe("bad");
    expect(v.label).toBe("Niva paused: AI spending limit until Oct 31, 2026, 7:00 PM");
    expect(v.detail).toContain("Anthropic stopped accepting calls at Oct 2, 2026, 9:30 AM because the account's spending limit or credit ran out.");
    expect(v.detail).toContain("Questions are kept and tried again automatically");
    expect(v.detail).toContain("The last call that worked was at Oct 2, 2026, 9:00 AM.");
    expect(v.key).toBe("Key: the one saved in Platform › Setup. The background service's environment also has one (ANTHROPIC_API_KEY), which is not used.");
    expect(v.lastError).toEqual({ at: "Oct 2, 2026, 9:45 AM", text: "400 invalid_request_error: You have reached your specified API usage limits." });
  });

  it("a pause with no end time, or one whose time has passed, says so", () => {
    const open = aiServiceFromHandler(entry({ state: "paused", since: "2026-10-02T14:30:00Z" }), TZ, now)!;
    expect(open.label).toBe("Niva paused: AI spending limit");
    expect(open.detail).toContain("Anthropic did not say when access comes back.");
    const passed = aiServiceFromHandler(entry({ state: "paused", since: "2026-10-01T14:30:00Z", paused_until: "2026-10-02T00:00:00Z" }), TZ, now)!;
    expect(passed.detail).toContain("That time has passed; Niva confirms access is back on its next try.");
  });

  it("a refused key, an account that cannot use the model, an unreachable service, and no call yet", () => {
    expect(aiServiceFromHandler(entry({ state: "key_refused", since: "2026-10-02T14:30:00Z" }), TZ, now)).toMatchObject({
      tone: "bad",
      label: "AI key refused",
      detail: expect.stringContaining("replace ANTHROPIC_API_KEY in Platform › Setup › AI"),
    });
    expect(aiServiceFromHandler(entry({ state: "unavailable" }), TZ, now)).toMatchObject({ tone: "bad", label: "AI account not set up for these requests" });
    expect(aiServiceFromHandler(entry({ state: "unreachable", since: "2026-10-02T14:30:00Z" }), TZ, now)).toMatchObject({
      tone: "warn",
      label: "AI service unreachable",
      detail: expect.stringContaining("Calls are tried again automatically."),
    });
    expect(aiServiceFromHandler(entry({ state: "untested" }), TZ, now)).toMatchObject({
      tone: null,
      label: "Not used yet",
      detail: expect.stringContaining("The next question or suggestion shows whether the key works"),
    });
  });

  it("with no key, says one is needed instead of waiting for a call that cannot happen", () => {
    const noKey = {
      tone: "warn",
      label: "No AI key",
      detail: "No Anthropic key is set, so Niva and the suggestions cannot run. A platform administrator needs to add ANTHROPIC_API_KEY in Platform › Setup › AI, then use Test there.",
      key: "Key: none is set, in Platform › Setup or in the background service's environment.",
    };
    expect(aiServiceFromHandler(entry({ state: "untested", key_source: "none" }), TZ, now)).toMatchObject(noKey);
    // A key removed after it was refused: what to do now is still to add one.
    expect(aiServiceFromHandler(entry({ state: "key_refused", key_source: "none", since: "2026-10-02T14:30:00Z" }), TZ, now)).toMatchObject(noKey);
  });

  it("shows nothing for a worker from before this report, or a state it does not know", () => {
    expect(aiServiceFromHandler({ configured: true }, TZ, now)).toBeNull();
    expect(aiServiceFromHandler(null, TZ, now)).toBeNull();
    expect(aiServiceFromHandler(entry({ state: "something_new" }), TZ, now)).toBeNull();
    expect(aiServiceFromHandler({ configured: true, ai: { state: "ok" } }, TZ, now)).toMatchObject({ label: "Working", key: null });
  });
});

describe("aiServiceFromStatus", () => {
  it("reads the first worker whose handlers carry an AI status", () => {
    const status = {
      state: "running",
      workers: [
        { worker: "old", handlers: { "niva.answer": { configured: true } } },
        { worker: "new", handlers: { "demo.ping": { configured: true }, "qbo.match_suggest_ai": entry({ state: "key_refused" }) } },
      ],
    };
    expect(aiServiceFromStatus(status, TZ, now)?.label).toBe("AI key refused");
    expect(aiServiceFromStatus({ state: "not_configured", workers: [] }, TZ, now)).toBeNull();
    expect(aiServiceFromStatus(null, TZ, now)).toBeNull();
  });
});
