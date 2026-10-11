import { describe, expect, it } from "vitest";

import { errorCodeOf, normalizeEvent, outcomeOfResult } from "@/lib/activity/event";
import { activityRecordingOn } from "@/lib/activity/enabled";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const ID = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";

describe("normalizeEvent", () => {
  it("keeps a clean action event", () => {
    const e = normalizeEvent(
      { key: "giving.record_payment", kind: "action", outcome: "ok", via: "screen", entity_kind: "payment", entity_id: ID, duration_ms: 412.6, seq: 3, session_id: "abcdef12-3456", platform: "web", at: "2026-10-10T11:59:00Z" },
      NOW,
    );
    expect(e).toEqual({
      key: "giving.record_payment",
      kind: "action",
      outcome: "ok",
      via: "screen",
      entity_kind: "payment",
      entity_id: ID,
      duration_ms: 413,
      seq: 3,
      session_id: "abcdef12-3456",
      platform: "web",
      at: "2026-10-10T11:59:00.000Z",
    });
  });

  it("works out the kind from the key", () => {
    expect(normalizeEvent({ key: "screen:/events/[id]", outcome: "ok", via: "screen" }, NOW)?.kind).toBe("screen");
    expect(normalizeEvent({ key: "events.save_event", outcome: "ok", via: "screen" }, NOW)?.kind).toBe("action");
    expect(normalizeEvent({ key: "events.save_event", kind: "screen", outcome: "ok", via: "screen" }, NOW)).toBeNull();
  });

  it("refuses keys that could carry free text or an id", () => {
    for (const key of ["", "save", "Giving.Record", "giving.record payment", "giving.record_payment?x=1", "a.b.c.d", `giving.${"x".repeat(60)}`, "screen:/events/417", `screen:/events/${ID}`, "screen:/a?b=1", "screen:events"]) {
      expect(normalizeEvent({ key, outcome: "ok", via: "screen" }, NOW), key).toBeNull();
    }
    expect(normalizeEvent({ key: 5, outcome: "ok", via: "screen" }, NOW)).toBeNull();
  });

  it("refuses an unknown outcome or way, and anything that is not an object", () => {
    expect(normalizeEvent({ key: "a.b", outcome: "maybe", via: "screen" }, NOW)).toBeNull();
    expect(normalizeEvent({ key: "a.b", outcome: "ok", via: "telepathy" }, NOW)).toBeNull();
    expect(normalizeEvent(null, NOW)).toBeNull();
    expect(normalizeEvent("giving.record_payment", NOW)).toBeNull();
    expect(normalizeEvent([], NOW)).toBeNull();
  });

  it("keeps an entity only as a kind word with a uuid, and never on a screen", () => {
    const base = { key: "a.b", outcome: "ok", via: "screen" };
    expect(normalizeEvent({ ...base, entity_kind: "payment", entity_id: "417" }, NOW)).toEqual({ key: "a.b", kind: "action", outcome: "ok", via: "screen" });
    expect(normalizeEvent({ ...base, entity_kind: "Priya Shah", entity_id: ID }, NOW)?.entity_id).toBeUndefined();
    expect(normalizeEvent({ ...base, entity_id: ID }, NOW)?.entity_id).toBeUndefined();
    expect(normalizeEvent({ key: "screen:/events/[id]", outcome: "ok", via: "screen", entity_kind: "event", entity_id: ID }, NOW)?.entity_id).toBeUndefined();
  });

  it("keeps an error code only for an error, and only as a word", () => {
    const base = { key: "a.b", via: "screen" };
    expect(normalizeEvent({ ...base, outcome: "error", error_code: "no_permission" }, NOW)?.error_code).toBe("no_permission");
    expect(normalizeEvent({ ...base, outcome: "ok", error_code: "no_permission" }, NOW)?.error_code).toBeUndefined();
    expect(normalizeEvent({ ...base, outcome: "error", error_code: "Could not record the payment — Priya's cheque" }, NOW)?.error_code).toBeUndefined();
  });

  it("drops values out of range instead of bending them", () => {
    const base = { key: "a.b", outcome: "ok", via: "screen" };
    expect(normalizeEvent({ ...base, duration_ms: -1 }, NOW)?.duration_ms).toBeUndefined();
    expect(normalizeEvent({ ...base, duration_ms: Number.NaN }, NOW)?.duration_ms).toBeUndefined();
    expect(normalizeEvent({ ...base, duration_ms: "12" }, NOW)?.duration_ms).toBeUndefined();
    expect(normalizeEvent({ ...base, duration_ms: 10 ** 12 }, NOW)?.duration_ms).toBe(24 * 60 * 60 * 1000);
    expect(normalizeEvent({ ...base, seq: -2 }, NOW)?.seq).toBeUndefined();
    expect(normalizeEvent({ ...base, seq: 1.5 }, NOW)?.seq).toBeUndefined();
    expect(normalizeEvent({ ...base, session_id: "has spaces and free text!" }, NOW)?.session_id).toBeUndefined();
    expect(normalizeEvent({ ...base, at: "2026-01-01T00:00:00Z" }, NOW)?.at).toBeUndefined();
    expect(normalizeEvent({ ...base, at: "2027-01-01T00:00:00Z" }, NOW)?.at).toBeUndefined();
    expect(normalizeEvent({ ...base, at: "yesterday" }, NOW)?.at).toBeUndefined();
  });

  it("passes on no field it does not know (names, amounts, free text)", () => {
    const e = normalizeEvent({ key: "a.b", outcome: "ok", via: "screen", name: "Priya Shah", amount_cents: 25100, note: "cheque 417", payload: { x: 1 } }, NOW);
    expect(Object.keys(e ?? {}).sort()).toEqual(["key", "kind", "outcome", "via"]);
  });
});

describe("outcomes and error codes", () => {
  it("reads the outcome from the result's ok flag only", () => {
    expect(outcomeOfResult({ ok: true, message: "Saved" })).toEqual({ outcome: "ok" });
    expect(outcomeOfResult({ ok: false, error: "Could not save the event — enter a name." })).toEqual({ outcome: "error", error_code: "invalid_input" });
    expect(outcomeOfResult(undefined)).toEqual({ outcome: "ok" });
    expect(outcomeOfResult(null)).toEqual({ outcome: "ok" });
    expect(outcomeOfResult("done")).toEqual({ outcome: "ok" });
  });

  it("gives a word from a closed list, never the sentence", () => {
    expect(errorCodeOf({ error: "Could not record the payment — you don't have permission (needs giving.record)." })).toBe("no_permission");
    expect(errorCodeOf({ error: "Could not record the payment — your session has expired. Sign in again." })).toBe("session_expired");
    expect(errorCodeOf({ error: "x", stepUp: true })).toBe("step_up_required");
    expect(errorCodeOf({ error: "Could not save the profile — the person was not found." })).toBe("not_found");
    expect(errorCodeOf({ error: "Could not save — a record with the same key already exists." })).toBe("duplicate");
    expect(errorCodeOf({ error: "Could not save — the database could not be reached — check the connection and try again." })).toBe("unreachable");
    expect(errorCodeOf({ error: "Something odd happened to Priya Shah" })).toBe("failed");
    expect(errorCodeOf({})).toBe("failed");
    expect(errorCodeOf(undefined)).toBe("failed");
  });
});

describe("activityRecordingOn", () => {
  it("is on only when centers.rules.activity.enabled is true", () => {
    expect(activityRecordingOn({ activity: { enabled: true } })).toBe(true);
    expect(activityRecordingOn({ activity: { enabled: false } })).toBe(false);
    expect(activityRecordingOn({ activity: { enabled: "true" } })).toBe(false);
    expect(activityRecordingOn({ activity: {} })).toBe(false);
    expect(activityRecordingOn({ activity: null })).toBe(false);
    expect(activityRecordingOn({})).toBe(false);
    expect(activityRecordingOn(null)).toBe(false);
    expect(activityRecordingOn(undefined)).toBe(false);
    expect(activityRecordingOn([])).toBe(false);
  });
});
