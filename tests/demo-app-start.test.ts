import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// startDemoForApp (src/lib/demo-signin/server.ts): the member app's start. Same core as the portal's page, with the database (the
// worker connection) and Supabase Auth replaced. Checked: the session comes back, the caller's cookies are never touched, nothing is
// signed out unless the session could not be recorded, and the limits of the database pass through.
vi.mock("server-only", () => ({}));

const st = vi.hoisted(() => {
  class DemoBusyError extends Error {}
  return {
    DemoBusyError,
    queries: [] as { text: string; params: unknown[] }[],
    answer: null as null | ((text: string, params: unknown[]) => unknown),
    signIn: vi.fn(),
    signOut: vi.fn(),
    rpc: vi.fn(),
    createClient: vi.fn(),
    serverClient: vi.fn(),
    cookies: vi.fn(),
    headers: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ cookies: st.cookies, headers: st.headers }));
vi.mock("@/lib/center-resolve", () => ({ CENTER_COOKIE: "cc_center", currentOrigin: async () => ({ protocol: "https:", host: "admin.weaverams.org" }) }));
vi.mock("@/lib/messaging/server-db", () => ({
  DemoBusyError: st.DemoBusyError,
  demoWorkerQuery: async (text: string, params: unknown[]) => {
    st.queries.push({ text, params });
    const r = st.answer?.(text, params);
    if (r instanceof Error) throw r;
    return [{ r }];
  },
}));
// The portal's own cookie-bound client must never be used by the app's start.
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: st.serverClient }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    st.createClient(...args);
    return { auth: { signInWithPassword: st.signIn, signOut: st.signOut }, rpc: st.rpc };
  },
}));

import { startDemoForApp } from "@/lib/demo-signin/server";

const PERSONA = "5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a51";
const DEMO_SESSION = "7d5b3e9a-2f2e-4c0a-8c77-2b3f4e5d6c73";
const AUTH_SESSION = "8e6c4f0b-3a3f-4d1b-9d88-3c4a5f6e7d84";
const PASSWORD = "p".repeat(64);
const token = () => {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "ES256" })}.${enc({ session_id: AUTH_SESSION })}.sig`;
};
const beginOk = {
  ok: true,
  demo_session_id: DEMO_SESSION,
  email: "treasurer@demo.weaverams.org",
  password: PASSWORD,
  center_slug: "sunrise-demo",
  role: "Treasurer",
  name: "Tara Test",
  expires_at: "2026-10-14T20:00:00Z",
};
const authSession = () => ({
  access_token: token(),
  refresh_token: "refresh-1",
  expires_in: 3600,
  expires_at: 1_790_000_000,
  token_type: "bearer",
  user: { id: "u1", email: "treasurer@demo.weaverams.org" },
  provider_token: "should-not-travel",
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  st.queries.length = 0;
  st.answer = (text) => (text.includes("worker_demo_begin") ? beginOk : { ok: true });
  st.signIn.mockReset().mockResolvedValue({ data: { session: authSession() }, error: null });
  st.signOut.mockReset().mockResolvedValue({ error: null });
  st.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  st.createClient.mockReset();
  st.serverClient.mockReset();
  st.cookies.mockReset();
  st.headers.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const beginParams = () => st.queries.find((q) => q.text.includes("worker_demo_begin"))!.params as [string, string];

describe("starting a demo for the member app", () => {
  it("asks the database, signs in as the demo person, ties the session to the demo session, and returns the session", async () => {
    const { result, session } = await startDemoForApp(PERSONA, "203.0.113.9");
    expect(result).toEqual({ ok: true, data: { centerSlug: "sunrise-demo", expiresAt: "2026-10-14T20:00:00Z", role: "Treasurer", name: "Tara Test" } });
    expect(st.signIn).toHaveBeenCalledWith({ email: "treasurer@demo.weaverams.org", password: PASSWORD });
    expect(st.queries.map((q) => q.text.match(/worker_demo_\w+/)![0])).toEqual(["worker_demo_begin", "worker_demo_attach"]);
    expect(st.queries[1]!.params).toEqual([DEMO_SESSION, AUTH_SESSION]);
    // Supabase's own fields and nothing else: the user record and the provider token stay behind.
    expect(session).toEqual({ access_token: expect.stringMatching(/\./), refresh_token: "refresh-1", expires_in: 3600, expires_at: 1_790_000_000, token_type: "bearer" });
    expect(JSON.stringify(session)).not.toMatch(/should-not-travel|demo\.weaverams\.org/);
    expect(st.signOut).not.toHaveBeenCalled();
  });

  it("signs in on a client that keeps nothing, never the portal's cookie client, and touches no cookie or header of the caller", async () => {
    await startDemoForApp(PERSONA, "203.0.113.9");
    expect(st.serverClient).not.toHaveBeenCalled();
    expect(st.cookies).not.toHaveBeenCalled();
    expect(st.headers).not.toHaveBeenCalled();
    const [url, key, options] = st.createClient.mock.calls[0] as [string, string, { auth: Record<string, unknown> }];
    expect(url).toBe("https://example.supabase.co");
    expect(key).toBe("anon");
    expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  });

  it("ends no earlier demo session and signs nobody out on success (the app ends its own with demo_leave)", async () => {
    await startDemoForApp(PERSONA, null);
    expect(st.rpc).not.toHaveBeenCalled();
    expect(st.signOut).not.toHaveBeenCalled();
  });

  it("gives the database a hash of the visitor's address, never the address, and counts an IPv6 visitor by their /64", async () => {
    await startDemoForApp(PERSONA, "203.0.113.9");
    const [persona, ipHash] = beginParams();
    expect(persona).toBe(PERSONA);
    expect(ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(st.queries)).not.toContain("203.0.113.9");
    st.queries.length = 0;
    await startDemoForApp(PERSONA, "2a02:c7f:1234:5678:1111:2222:3333:4444");
    const a = beginParams()[1];
    st.queries.length = 0;
    await startDemoForApp(PERSONA, "2a02:c7f:1234:5678:ffff:eeee:dddd:cccc");
    expect(beginParams()[1]).toBe(a);
  });

  it("passes the database's limits through as a limit, and signs nobody in", async () => {
    for (const code of ["ip_limit", "busy"]) {
      st.signIn.mockClear();
      st.answer = () => ({ ok: false, code });
      const { result, session } = await startDemoForApp(PERSONA, "1.2.3.4");
      expect(result).toMatchObject({ ok: false, code: "limit" });
      expect(result.error).toMatch(/^Could not start the demo — /);
      expect(session).toBeNull();
      expect(st.signIn).not.toHaveBeenCalled();
    }
    st.answer = () => ({ ok: false, code: "ip_limit" });
    expect((await startDemoForApp(PERSONA, "1.2.3.4")).result.error).toMatch(/lot of demos in the last hour/);
  });

  it("says limit when the demo's one database connection is taken (nothing signed in)", async () => {
    st.answer = () => new st.DemoBusyError("busy");
    const { result, session } = await startDemoForApp(PERSONA, null);
    expect(result).toMatchObject({ ok: false, code: "limit" });
    expect(result.error).toMatch(/very busy/);
    expect(session).toBeNull();
    expect(st.signIn).not.toHaveBeenCalled();
  });

  it("tells off and unknown_person apart from the rest", async () => {
    st.answer = () => ({ ok: false, code: "off" });
    expect((await startDemoForApp(PERSONA, null)).result).toMatchObject({ ok: false, code: "off" });
    st.answer = () => ({ ok: false, code: "not_ready" });
    expect((await startDemoForApp(PERSONA, null)).result).toMatchObject({ ok: false, code: "off" });
    st.answer = () => ({ ok: false, code: "unknown_persona" });
    expect((await startDemoForApp(PERSONA, null)).result).toMatchObject({ ok: false, code: "unknown_person" });
    expect(st.signIn).not.toHaveBeenCalled();
  });

  it("returns no session when the sign-in does not work", async () => {
    st.signIn.mockResolvedValue({ data: { session: null }, error: { message: `Invalid login credentials for ${PASSWORD}` } });
    const { result, session } = await startDemoForApp(PERSONA, null);
    expect(result).toMatchObject({ ok: false, code: "failed" });
    expect(result.error).toMatch(/the demo sign-in did not work/);
    expect(result.error).not.toContain(PASSWORD);
    expect(session).toBeNull();
    expect(st.queries.some((q) => q.text.includes("worker_demo_attach"))).toBe(false);
  });

  it("signs the session out again, and returns none, when it cannot be recorded", async () => {
    st.answer = (text) => (text.includes("worker_demo_begin") ? beginOk : { ok: false, code: "mismatch" });
    const { result, session } = await startDemoForApp(PERSONA, null);
    expect(result).toMatchObject({ ok: false, code: "failed" });
    expect(result.error).toMatch(/could not be recorded/);
    expect(session).toBeNull();
    expect(st.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("fills in the end of the access token from its lifetime when Auth leaves it out", async () => {
    st.signIn.mockResolvedValue({ data: { session: { ...authSession(), expires_at: undefined, expires_in: 1800 } }, error: null });
    const before = Math.floor(Date.now() / 1000);
    const { session } = await startDemoForApp(PERSONA, null);
    expect(session!.expires_in).toBe(1800);
    expect(session!.expires_at).toBeGreaterThanOrEqual(before + 1800);
    expect(session!.expires_at).toBeLessThanOrEqual(before + 1802);
  });

  it("says plainly when the site is not configured, and asks nothing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { result, session } = await startDemoForApp(PERSONA, null);
    expect(result).toMatchObject({ ok: false, code: "failed" });
    expect(result.error).toMatch(/the site is not configured/);
    expect(session).toBeNull();
    expect(st.queries).toEqual([]);
  });

  it("refuses a person id that is not an id, with the portal's sentence, before the database is asked", async () => {
    const { result } = await startDemoForApp("treasurer", null);
    expect(result).toMatchObject({ ok: false, code: "unknown_person" });
    expect(result.error).toMatch(/choose a person to explore as first/);
    expect(st.queries).toEqual([]);
  });
});
