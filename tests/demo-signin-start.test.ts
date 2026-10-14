import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

import { startDemoSession, type StartDeps } from "@/lib/demo-signin/start";
import { hashIp } from "@/lib/demo-signin/server";

const PERSONA = "5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a51";
const DEMO_SESSION = "7d5b3e9a-2f2e-4c0a-8c77-2b3f4e5d6c73";
const AUTH_SESSION = "8e6c4f0b-3a3f-4d1b-9d88-3c4a5f6e7d84";
const PASSWORD = "f".repeat(64);

function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "ES256" })}.${enc(claims)}.sig`;
}

const beginOk = {
  ok: true,
  demo_session_id: DEMO_SESSION,
  email: "treasurer@demo.weaverams.org",
  password: PASSWORD,
  center_slug: "sunrise-demo",
  role: "Treasurer",
  name: "Tara Test",
  expires_at: "2026-10-11T22:00:00Z",
};

// A fake of everything outside: the database (worker connection) and Supabase Auth (the password grant). `calls` is the order of events.
function fakes(over: Partial<StartDeps> = {}) {
  const calls: string[] = [];
  const signIns: { email: string; password: string }[] = [];
  const deps: StartDeps = {
    hashIp: (ip) => `hash(${ip})`,
    begin: async (persona, ipHash) => {
      calls.push(`begin:${persona}:${ipHash}`);
      return beginOk;
    },
    endPrevious: async () => {
      calls.push("endPrevious");
    },
    signIn: async (email, password) => {
      calls.push("signIn");
      signIns.push({ email, password });
      return { ok: true, accessToken: jwt({ sub: "u", session_id: AUTH_SESSION }) };
    },
    signOut: async () => {
      calls.push("signOut");
    },
    attach: async (demoId, authId) => {
      calls.push(`attach:${demoId}:${authId}`);
      return { ok: true };
    },
    ...over,
  };
  return { deps, calls, signIns };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("starting a demo session: the mechanism", () => {
  it("asks the database, signs in as the demo person it names, ties the new session to the demo session, and says where to go", async () => {
    const { deps, calls, signIns } = fakes();
    const res = await startDemoSession({ personaId: PERSONA, ip: "203.0.113.9" }, deps);
    expect(res).toEqual({ ok: true, data: { centerSlug: "sunrise-demo", expiresAt: "2026-10-11T22:00:00Z", role: "Treasurer", name: "Tara Test" } });
    expect(calls).toEqual([`begin:${PERSONA}:hash(203.0.113.9)`, "endPrevious", "signIn", `attach:${DEMO_SESSION}:${AUTH_SESSION}`]);
    expect(signIns).toEqual([{ email: "treasurer@demo.weaverams.org", password: PASSWORD }]);
  });

  it("only ever passes a hash of the visitor's address to the database", async () => {
    const { deps, calls } = fakes();
    await startDemoSession({ personaId: PERSONA, ip: "203.0.113.9" }, deps);
    expect(calls[0]).toBe(`begin:${PERSONA}:hash(203.0.113.9)`);
    const h = hashIp("203.0.113.9");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(hashIp("203.0.113.9")).toBe(h);
    expect(hashIp("203.0.113.10")).not.toBe(h);
    expect(hashIp(null)).toBe(hashIp(null));
  });

  it("does nothing without a real person id (nothing is asked, nothing is signed in)", async () => {
    for (const bad of [undefined, null, "", "treasurer", "not-a-uuid", 7, { id: PERSONA }]) {
      const { deps, calls } = fakes();
      const res = await startDemoSession({ personaId: bad, ip: null }, deps);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/choose a person/);
      expect(calls).toEqual([]);
    }
  });

  it("never signs in when the database refuses, and says why in words (switch off, limits, not ready, not a demo person)", async () => {
    const wording: Record<string, RegExp> = {
      off: /switched off/,
      ip_limit: /lot of demos in the last hour/,
      busy: /very busy/,
      not_ready: /not ready/,
      unknown_persona: /not available/,
    };
    for (const [code, re] of Object.entries(wording)) {
      const { deps, calls } = fakes({ begin: async () => ({ ok: false, code }) });
      const res = await startDemoSession({ personaId: PERSONA, ip: "1.2.3.4" }, deps);
      expect(res.ok, code).toBe(false);
      expect(res.error, code).toMatch(/^Could not start the demo — /);
      expect(res.error, code).toMatch(re);
      expect(calls, code).toEqual([]);
    }
  });

  it("refuses an answer that names anyone but a demo person, whatever the database says", async () => {
    for (const email of ["ada@jsh.org", "owner@weaverams.org", "x@demo.weaverams.org.evil.com", "x@evil.demo.weaverams.org"]) {
      const { deps, calls, signIns } = fakes({ begin: async () => ({ ...beginOk, email }) });
      const res = await startDemoSession({ personaId: PERSONA, ip: null }, deps);
      expect(res.ok, email).toBe(false);
      expect(res.error, email).toMatch(/not a demo person/);
      expect(signIns, email).toEqual([]);
      expect(calls.some((c) => c === "signIn" || c === "endPrevious"), email).toBe(false);
    }
  });

  it("reports an unreadable answer and a database that cannot be reached, without a sign-in", async () => {
    const a = fakes({ begin: async () => ({ ok: true, email: "m@demo.weaverams.org" }) });
    const unreadable = await startDemoSession({ personaId: PERSONA, ip: null }, a.deps);
    expect(unreadable.ok).toBe(false);
    expect(unreadable.error).toMatch(/could not read/);
    expect(a.signIns).toEqual([]);
    // Whatever was unreadable, the password in it is never written to a log.
    const b0 = fakes({ begin: async () => ({ ok: true, email: "m@demo.weaverams.org", password: PASSWORD }) });
    await startDemoSession({ personaId: PERSONA, ip: null }, b0.deps);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(PASSWORD);

    const b = fakes({
      begin: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      },
    });
    const down = await startDemoSession({ personaId: PERSONA, ip: null }, b.deps);
    expect(down.ok).toBe(false);
    expect(down.error).toMatch(/^Could not start the demo — /);
    expect(b.signIns).toEqual([]);
    expect(errors).toHaveBeenCalled();
  });

  it("ends the visitor's previous demo session first when they switch role, and goes ahead even if that fails", async () => {
    const { deps, calls } = fakes({
      endPrevious: async () => {
        calls.push("endPrevious");
        throw new Error("rpc failed");
      },
    });
    const res = await startDemoSession({ personaId: PERSONA, ip: null }, deps);
    expect(res.ok).toBe(true);
    expect(calls.indexOf("endPrevious")).toBeGreaterThan(calls.findIndex((c) => c.startsWith("begin:")));
    expect(calls.indexOf("endPrevious")).toBeLessThan(calls.indexOf("signIn"));
  });

  it("says plainly when the sign-in does not work, never repeats the password or the technical reason, and records nothing", async () => {
    const { deps, calls } = fakes({ signIn: async () => ({ ok: false, detail: { message: `Invalid login credentials for ${PASSWORD}` } }) });
    const res = await startDemoSession({ personaId: PERSONA, ip: null }, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Could not start the demo — the demo sign-in did not work/);
    expect(res.error).not.toContain(PASSWORD);
    expect(res.error).not.toMatch(/credentials/i);
    expect(calls.some((c) => c.startsWith("attach:"))).toBe(false);
  });

  it("signs the new session out again when it cannot be recorded (an unrecorded session would be refused on its first request anyway)", async () => {
    for (const attach of [async () => ({ ok: false, code: "mismatch" }), async () => null, async () => { throw new Error("db down"); }]) {
      const { deps, calls } = fakes({ attach });
      const res = await startDemoSession({ personaId: PERSONA, ip: null }, deps);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/could not be recorded/);
      expect(calls[calls.length - 1]).toBe("signOut");
    }
  });

  it("a token with no session claim is attached as nothing, and the database refuses it", async () => {
    const { deps, calls } = fakes({ signIn: async () => ({ ok: true, accessToken: jwt({ sub: "u" }) }), attach: async (_d, a) => { calls.push(`attach:${a}`); return { ok: false, code: "mismatch" }; } });
    const res = await startDemoSession({ personaId: PERSONA, ip: null }, deps);
    expect(res.ok).toBe(false);
    expect(calls).toContain("attach:null");
    expect(calls[calls.length - 1]).toBe("signOut");
  });

  it("lower-cases the person id before it goes to the database", async () => {
    const { deps, calls } = fakes();
    await startDemoSession({ personaId: PERSONA.toUpperCase(), ip: null }, deps);
    expect(calls[0]).toBe(`begin:${PERSONA}:hash(null)`);
  });
});
