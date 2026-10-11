import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authCookieNames, endedRedirect, guardDemoSession } from "@/lib/demo-signin/guard";

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

const demo = { email: "treasurer@demo.weaverams.org" };

describe("the check on every request of a demo session", () => {
  it("lets a demo session through only when the database says ok", async () => {
    expect(await guardDemoSession(demo, async () => ({ state: "ok" }))).toEqual({ kind: "ok" });
  });

  it("ends it when the two hours are over", async () => {
    expect(await guardDemoSession(demo, async () => ({ state: "expired" }))).toEqual({ kind: "ended", reason: "expired" });
  });

  it("ends it when the switch is off (the kill switch takes hold on the next request)", async () => {
    expect(await guardDemoSession(demo, async () => ({ state: "off" }))).toEqual({ kind: "ended", reason: "off" });
  });

  it("ends a session the database does not know, and a demo address that is not a registered demo person", async () => {
    expect(await guardDemoSession(demo, async () => ({ state: "unknown" }))).toEqual({ kind: "ended", reason: "unknown" });
    expect(await guardDemoSession(demo, async () => ({ state: "not_demo" }))).toEqual({ kind: "ended", reason: "unknown" });
  });

  it("fails closed: an unreadable answer, no answer, or a check that fails ends the session", async () => {
    for (const answer of [null, undefined, "ok", 7, {}, { state: 1 }, { state: "OK" }, { state: "okay" }]) {
      expect(await guardDemoSession(demo, async () => answer), String(JSON.stringify(answer))).toMatchObject({ kind: "ended" });
    }
    const out = await guardDemoSession(demo, async () => {
      throw new Error("PostgREST is down");
    });
    expect(out).toEqual({ kind: "ended", reason: "error" });
    expect(errors).toHaveBeenCalled();
  });

  it("does not ask anything for a person who is not a demo person", async () => {
    const check = vi.fn(async () => ({ state: "expired" }));
    for (const claims of [{ email: "ada@jsh.org" }, { email: "x@demo.weaverams.org.evil.com" }, { email: null }, {}, null, undefined]) {
      expect(await guardDemoSession(claims, check)).toEqual({ kind: "not_demo" });
    }
    expect(check).not.toHaveBeenCalled();
  });
});

describe("where an ended session is sent", () => {
  it("to the demo page, with the reason", () => {
    expect(endedRedirect("/giving/pledges", "expired")).toEqual({ kind: "redirect", location: "/demo?ended=expired" });
    expect(endedRedirect("/", "off")).toEqual({ kind: "redirect", location: "/demo?ended=off" });
  });

  it("never away from the demo page itself, so a person can start again from it", () => {
    expect(endedRedirect("/demo", "expired")).toEqual({ kind: "stay" });
    expect(endedRedirect("/demo/anything", "off")).toEqual({ kind: "stay" });
    expect(endedRedirect("/demonstration", "off")).toEqual({ kind: "redirect", location: "/demo?ended=off" });
  });

  it("answers an API call with a refusal rather than a page", () => {
    expect(endedRedirect("/api/assistant/chat", "expired")).toEqual({ kind: "api" });
    expect(endedRedirect("/api", "unknown")).toEqual({ kind: "api" });
  });
});

describe("the cookies cleared when a demo session ends", () => {
  it("picks out Supabase Auth's session cookies, in chunks too, and nothing else", () => {
    expect(
      authCookieNames(["sb-abc-auth-token", "sb-abc-auth-token.0", "sb-abc-auth-token.1", "sb-abc-auth-token-code-verifier", "cc_center", "cc_look", "other", "sb-abc-something"]),
    ).toEqual(["sb-abc-auth-token", "sb-abc-auth-token.0", "sb-abc-auth-token.1", "sb-abc-auth-token-code-verifier"]);
  });
});
