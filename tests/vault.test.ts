import { describe, expect, it } from "vitest";

import {
  backgroundServiceView,
  fingerprintLabel,
  isStepUpError,
  jobStatusView,
  secretNameProblem,
  secretValueProblem,
  vaultActionCopy,
} from "@/lib/vault";

describe("vault helpers", () => {
  it("recognises the step-up refusal by SQLSTATE or message", () => {
    expect(isStepUpError({ code: "CCSTP", message: "This needs a fresh 2FA check." })).toBe(true);
    expect(isStepUpError({ code: "P0001", message: "This needs a fresh 2FA check." })).toBe(true);
    expect(isStepUpError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isStepUpError(null)).toBe(false);
  });
  it("checks names and values the way the database does", () => {
    expect(secretNameProblem("api_key")).toBeNull();
    expect(secretNameProblem("OAuth.Refresh_Token")).toBeNull();
    expect(secretNameProblem("")).toMatch(/Give the secret a name/);
    expect(secretNameProblem("9lives")).toMatch(/starting with a letter/);
    expect(secretValueProblem("")).toMatch(/Paste/);
    expect(secretValueProblem("short")).toMatch(/at least 8/);
    expect(secretValueProblem(" sk_test_abcdef")).toMatch(/space/);
    expect(secretValueProblem("sk_test_abcdef")).toBeNull();
  });
  it("shows only the fingerprint", () => {
    expect(fingerprintLabel("1234")).toBe("••••1234");
    expect(fingerprintLabel(null)).toBe("—");
  });
  it("words each action plainly", () => {
    expect(vaultActionCopy("rotate", "api_key", "Stripe").title).toBe("Rotate api_key");
    expect(vaultActionCopy("disconnect", "api_key", "Stripe").confirm).toBe("Remove secret");
    expect(vaultActionCopy("add", "", "Stripe · Test").title).toBe("Add a secret to Stripe · Test");
  });
});

describe("background service tile", () => {
  it("reads 'not configured' when the worker never reported in", () => {
    const v = backgroundServiceView({ state: "not_configured", last_beat_at: null, age_seconds: null, workers: [], jobs: { queued: 2, scan_pending: 1 } });
    expect(v.label).toBe("Background service not configured");
    expect(v.detail).toMatch(/WORKER_DATABASE_URL/);
    expect(v.jobs).toEqual({ queued: 2, running: 0, failed24h: 0, done24h: 0, scanPending: 1 });
  });
  it("lists which handlers are configured, with the reason", () => {
    const v = backgroundServiceView({
      state: "running",
      last_beat_at: "2026-09-24T12:00:00Z",
      age_seconds: 20,
      workers: [{ worker: "w", handlers: { "storage.retention": { configured: false, reason: "SUPABASE_SECRET_KEY not set" }, "demo.ping": { configured: true } } }],
      jobs: {},
    });
    expect(v.tone).toBe("ok");
    expect(v.detail).toBe("Last heartbeat 20 seconds ago.");
    expect(v.handlers).toEqual([
      { kind: "demo.ping", configured: true, reason: null },
      { kind: "storage.retention", configured: false, reason: "SUPABASE_SECRET_KEY not set" },
    ]);
  });
  it("says when it stopped", () => {
    const v = backgroundServiceView({ state: "stopped", age_seconds: 7200, workers: [], jobs: {} });
    expect(v.tone).toBe("bad");
    expect(v.detail).toMatch(/2 hours ago and has stopped answering/);
    const clean = backgroundServiceView({ state: "stopped", age_seconds: 60, workers: [{ worker: "w", stopped_at: "2026-09-24T12:00:00Z" }], jobs: {} });
    expect(clean.detail).toMatch(/was stopped \(last heartbeat 60 seconds ago\)/);
    expect(backgroundServiceView(null).state).toBe("unknown");
  });
  it("describes job statuses, including a retry", () => {
    expect(jobStatusView("queued", 1, 3)).toEqual({ label: "Retrying (attempt 2 of 3)", tone: "warn" });
    expect(jobStatusView("queued", 0, 3).label).toBe("Waiting");
    expect(jobStatusView("failed", 3, 3).tone).toBe("bad");
  });
});
