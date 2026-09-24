import { describe, expect, it } from "vitest";

import { clientScreen, encodeAuditReason, newRequestId, traceHeaders, tracingFetch } from "@/lib/supabase/trace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("traceability headers", () => {
  it("always sends the app and request id", () => {
    const id = newRequestId();
    expect(id).toMatch(UUID);
    expect(traceHeaders({ requestId: id })).toEqual({ "x-client-app": "portal", "x-request-id": id });
  });
  it("makes a uuid on plain-http pages, where browsers hide randomUUID", () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 20 }, () => newRequestId()));
      expect(ids.size).toBe(20);
      for (const id of ids) expect(id).toMatch(UUID);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
  it("adds the screen and an encoded reason", () => {
    const h = traceHeaders({ requestId: "r", screen: "/giving/pledges", reason: "  Donor moved away — ask Treasurer  " });
    expect(h["x-client-screen"]).toBe("/giving/pledges");
    expect(decodeURIComponent(h["x-audit-reason"])).toBe("Donor moved away — ask Treasurer");
    expect(h["x-audit-reason"]).toMatch(/^[\x21-\x7e]+$/); // header-safe
  });
  it("omits a blank reason and screen", () => {
    const h = traceHeaders({ requestId: "r", screen: "", reason: "   " });
    expect(h).toEqual({ "x-client-app": "portal", "x-request-id": "r" });
  });
  it("caps the reason at 500 characters without splitting a character", () => {
    const long = "ॐ".repeat(600);
    expect(decodeURIComponent(encodeAuditReason(long))).toBe("ॐ".repeat(500));
    const emoji = "🙏".repeat(501);
    expect(Array.from(decodeURIComponent(encodeAuditReason(emoji))).length).toBe(500);
  });
  it("makes the screen header-safe and caps it at 200", () => {
    expect(clientScreen("/people/é")).toBe("/people/");
    expect(clientScreen("/" + "a".repeat(300))!.length).toBe(200);
    expect(clientScreen(null)).toBeNull();
  });
  it("tracingFetch sends a new request id on every call and keeps caller headers", async () => {
    const seen: Headers[] = [];
    const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response("{}");
    }) as typeof fetch;
    const f = tracingFetch(() => "/ops/e1/checkin", base);
    await f("https://x/rest/v1/a", { headers: { apikey: "k" } });
    await f("https://x/rest/v1/b");
    expect(seen[0].get("apikey")).toBe("k");
    expect(seen[0].get("x-client-app")).toBe("portal");
    expect(seen[0].get("x-client-screen")).toBe("/ops/e1/checkin");
    expect(seen[0].get("x-request-id")).toMatch(UUID);
    expect(seen[1].get("x-request-id")).toMatch(UUID);
    expect(seen[0].get("x-request-id")).not.toBe(seen[1].get("x-request-id"));
  });
});
