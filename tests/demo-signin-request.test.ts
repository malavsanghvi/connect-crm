import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const st = vi.hoisted(() => {
  class DemoBusyError extends Error {}
  return {
    DemoBusyError,
    forwardedFor: "203.0.113.9" as string | null,
    queries: [] as { text: string; params: unknown[] }[],
    answer: null as null | ((text: string, params: unknown[]) => unknown),
    cookieSet: vi.fn(),
    cookieDelete: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    rpc: vi.fn(),
    claimsSub: null as string | null,
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers(st.forwardedFor ? { "x-forwarded-for": st.forwardedFor } : {}),
  cookies: async () => ({ set: st.cookieSet, delete: st.cookieDelete }),
}));
vi.mock("@/lib/center-resolve", () => ({
  CENTER_COOKIE: "cc_center",
  currentOrigin: async () => ({ protocol: "https:", host: "admin.weaverams.org" }),
}));
vi.mock("@/lib/messaging/server-db", () => ({
  DemoBusyError: st.DemoBusyError,
  demoWorkerQuery: async (text: string, params: unknown[]) => {
    st.queries.push({ text, params });
    const r = st.answer?.(text, params);
    if (r instanceof Error) throw r;
    return [{ r }];
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: st.claimsSub ? { claims: { sub: st.claimsSub } } : null, error: null }),
      signInWithPassword: st.signIn,
      signOut: st.signOut,
    },
    rpc: st.rpc,
  }),
}));

import { startDemoFromRequest } from "@/lib/demo-signin/server";

const PERSONA = "5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a51";
const DEMO_SESSION = "7d5b3e9a-2f2e-4c0a-8c77-2b3f4e5d6c73";
const AUTH_SESSION = "8e6c4f0b-3a3f-4d1b-9d88-3c4a5f6e7d84";
const token = () => {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "ES256" })}.${enc({ session_id: AUTH_SESSION })}.sig`;
};
const beginOk = { ok: true, demo_session_id: DEMO_SESSION, email: "treasurer@demo.weaverams.org", password: "p".repeat(64), center_slug: "sunrise-demo", role: "Treasurer", name: "Tara", expires_at: "2026-10-11T22:00:00Z" };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  st.forwardedFor = "203.0.113.9";
  st.queries.length = 0;
  st.claimsSub = null;
  st.answer = (text) => (text.includes("worker_demo_begin") ? beginOk : { ok: true });
  st.cookieSet.mockReset();
  st.cookieDelete.mockReset();
  st.signIn.mockReset().mockResolvedValue({ data: { session: { access_token: token() } }, error: null });
  st.signOut.mockReset().mockResolvedValue({ error: null });
  st.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const beginParams = () => st.queries.find((q) => q.text.includes("worker_demo_begin"))!.params as [string, string];

describe("starting a demo from a request", () => {
  it("asks the database as the background service, signs in, records the session and remembers the demo community", async () => {
    const res = await startDemoFromRequest(PERSONA);
    expect(res).toMatchObject({ ok: true, data: { centerSlug: "sunrise-demo" } });
    expect(st.signIn).toHaveBeenCalledWith({ email: "treasurer@demo.weaverams.org", password: "p".repeat(64) });
    expect(st.queries.map((q) => q.text.match(/worker_demo_\w+/)![0])).toEqual(["worker_demo_begin", "worker_demo_attach"]);
    expect(st.queries[1]!.params).toEqual([DEMO_SESSION, AUTH_SESSION]);
    expect(st.cookieSet).toHaveBeenCalledWith("cc_center", "sunrise-demo", expect.objectContaining({ httpOnly: true, maxAge: 7200, secure: true }));
  });

  it("gives the database a hash of the address, never the address", async () => {
    await startDemoFromRequest(PERSONA);
    const [persona, ipHash] = beginParams();
    expect(persona).toBe(PERSONA);
    expect(ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(st.queries)).not.toContain("203.0.113.9");
  });

  it("counts an IPv6 visitor by their /64: another address in the same /64 is the same visitor", async () => {
    st.forwardedFor = "2a02:c7f:1234:5678:1111:2222:3333:4444";
    await startDemoFromRequest(PERSONA);
    const a = beginParams()[1];
    st.queries.length = 0;
    st.forwardedFor = "2a02:c7f:1234:5678:ffff:eeee:dddd:cccc";
    await startDemoFromRequest(PERSONA);
    expect(beginParams()[1]).toBe(a);
    st.queries.length = 0;
    st.forwardedFor = "2a02:c7f:1234:5679::1";
    await startDemoFromRequest(PERSONA);
    expect(beginParams()[1]).not.toBe(a);
  });

  it("says the demo is busy, and signs nobody in, when the demo's one database connection is taken", async () => {
    st.answer = () => new st.DemoBusyError("busy");
    const res = await startDemoFromRequest(PERSONA);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Could not start the demo — the demo is very busy right now/);
    expect(st.signIn).not.toHaveBeenCalled();
    expect(st.cookieSet).not.toHaveBeenCalled();
  });

  it("only ends a previous demo session for someone who is signed in", async () => {
    await startDemoFromRequest(PERSONA);
    expect(st.rpc).not.toHaveBeenCalled();
    st.claimsSub = "u1";
    await startDemoFromRequest(PERSONA);
    expect(st.rpc).toHaveBeenCalledWith("demo_leave");
  });
});
