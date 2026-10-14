import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for Supabase Auth and the database, as the proxy sees them: who is signed in, and what the demo check answers.
const fake = vi.hoisted(() => ({
  claims: null as null | Record<string, unknown>,
  rpc: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: fake.claims ? { claims: fake.claims } : null, error: null }), signOut: fake.signOut },
    rpc: fake.rpc,
  }),
}));

import { isDemoApiPath } from "@/lib/demo-signin/guard";
import { isPublicPath, updateSession } from "@/lib/supabase/proxy";

const ENV = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon", centerSlug: "jsh" };
const COOKIES = "sb-abc-auth-token=tokenvalue; cc_center=sunrise-demo; cc_look=v2";

function req(path: string) {
  return new NextRequest(`https://admin.weaverams.org${path}`, { headers: { cookie: COOKIES } });
}
const setCookies = (res: Response): string => (res.headers.getSetCookie?.() ?? []).join("\n");

beforeEach(() => {
  fake.claims = null;
  fake.rpc.mockReset();
  fake.signOut.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("the proxy and a demo session", () => {
  it("lets a demo session through while the database says ok", async () => {
    fake.claims = { sub: "u1", email: "treasurer@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: { state: "ok" }, error: null });
    const res = await updateSession(req("/giving"), ENV);
    expect(fake.rpc).toHaveBeenCalledWith("demo_session_state");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(fake.signOut).not.toHaveBeenCalled();
  });

  it("ends a session that ran out of its two hours: back to the demo page with the reason, its cookies and the demo community choice cleared", async () => {
    fake.claims = { sub: "u1", email: "treasurer@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: { state: "expired" }, error: null });
    const res = await updateSession(req("/giving/pledges"), ENV);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/demo?ended=expired");
    expect(fake.signOut).toHaveBeenCalledWith({ scope: "local" });
    const cookies = setCookies(res);
    expect(cookies).toMatch(/sb-abc-auth-token=;/);
    expect(cookies).toMatch(/cc_center=;/);
    expect(cookies).not.toMatch(/cc_look=;/);
  });

  it("ends a running session on its next request once the kill switch is off", async () => {
    fake.claims = { sub: "u1", email: "member@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: { state: "off" }, error: null });
    const res = await updateSession(req("/people"), ENV);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/demo?ended=off");
  });

  it("ends a session the database does not know", async () => {
    fake.claims = { sub: "u1", email: "member@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: { state: "unknown" }, error: null });
    const res = await updateSession(req("/"), ENV);
    expect(res.headers.get("location")).toContain("/demo?ended=unknown");
  });

  it("fails closed: if the check cannot be made, the session ends", async () => {
    fake.claims = { sub: "u1", email: "member@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: null, error: { message: "PostgREST is down" } });
    const res = await updateSession(req("/"), ENV);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/demo?ended=error");
  });

  it("never redirects the demo page itself, so a person can start again from it (and does not touch the cookies there)", async () => {
    fake.claims = { sub: "u1", email: "member@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: { state: "expired" }, error: null });
    const res = await updateSession(req("/demo"), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(setCookies(res)).not.toMatch(/sb-abc-auth-token=;/);
    expect(fake.signOut).not.toHaveBeenCalled();
  });

  it("answers an API call from an ended session with a plain 401, not a page", async () => {
    fake.claims = { sub: "u1", email: "member@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: { state: "expired" }, error: null });
    const res = await updateSession(req("/api/assistant/chat"), ENV);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Your demo session has ended. Start a new one at /demo." });
  });

  it("also ends a session marked demo by the database when its address is no longer a demo address", async () => {
    fake.claims = { sub: "u1", email: "visitor@example.org", app_metadata: { provider: "email", demo: true } };
    fake.rpc.mockResolvedValue({ data: { state: "unknown" }, error: null });
    const res = await updateSession(req("/people"), ENV);
    expect(fake.rpc).toHaveBeenCalledWith("demo_session_state");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/demo?ended=unknown");
  });

  it("does not even ask about a person who is not a demo person", async () => {
    fake.claims = { sub: "u2", email: "ada@jsh.org" };
    fake.rpc.mockResolvedValue({ data: { state: "expired" }, error: null });
    const res = await updateSession(req("/giving"), ENV);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("does not ask when nobody is signed in (and sends them to the sign-in page as before)", async () => {
    fake.claims = null;
    const res = await updateSession(req("/giving"), ENV);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets anyone open the demo page without signing in", async () => {
    fake.claims = null;
    const res = await updateSession(req("/demo"), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("the proxy and the member app's demo endpoints (/api/demo/*)", () => {
  it("knows the paths: only /api/demo and what is under it", () => {
    for (const p of ["/api/demo", "/api/demo/choices", "/api/demo/session"]) expect(isDemoApiPath(p), p).toBe(true);
    for (const p of ["/demo", "/api/demos", "/api/demonstrate", "/api", "/api/assistant/demo", "/x/api/demo"]) expect(isDemoApiPath(p), p).toBe(false);
    expect(isPublicPath("/api/demo/session")).toBe(true);
    expect(isPublicPath("/api/demo/choices")).toBe(true);
  });

  it("lets a call with no session through to the route: no redirect to sign-in, no session work, no cookie", async () => {
    fake.claims = null;
    for (const path of ["/api/demo/choices", "/api/demo/session"]) {
      const res = await updateSession(new NextRequest(`https://admin.weaverams.org${path}`), ENV);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
      expect(setCookies(res), path).toBe("");
    }
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("does not treat the caller's cookies as a demo session: an ended one is neither answered 401 nor signed out nor cleared", async () => {
    fake.claims = { sub: "u1", email: "treasurer@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: { state: "expired" }, error: null });
    for (const path of ["/api/demo/choices", "/api/demo/session"]) {
      const res = await updateSession(req(path), ENV);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
      expect(setCookies(res), path).toBe("");
    }
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.signOut).not.toHaveBeenCalled();
  });

  it("is also let through for a signed-in person of a real community (their cookies are left alone)", async () => {
    fake.claims = { sub: "u2", email: "ada@jsh.org" };
    const res = await updateSession(req("/api/demo/session"), ENV);
    expect(res.status).toBe(200);
    expect(setCookies(res)).toBe("");
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("leaves the other API paths as they were: an ended demo session still gets its 401", async () => {
    fake.claims = { sub: "u1", email: "member@demo.weaverams.org" };
    fake.rpc.mockResolvedValue({ data: { state: "expired" }, error: null });
    expect((await updateSession(req("/api/assistant/chat"), ENV)).status).toBe(401);
  });
});
