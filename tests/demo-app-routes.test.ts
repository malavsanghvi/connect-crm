import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two route files, with the database and Supabase Auth replaced (src/lib/demo-signin/server.ts): what is checked is what each route
// answers, with which headers, and that no cookie is ever touched (docs/MEMBER_APP_DEMO.md).
const st = vi.hoisted(() => ({
  loadChoices: vi.fn(),
  start: vi.fn(),
}));
vi.mock("@/lib/demo-signin/server", () => ({ loadDemoChoices: st.loadChoices, startDemoForApp: st.start }));
// A route that read or set a cookie would call one of these.
const cookieJar = vi.hoisted(() => ({ touched: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    cookieJar.touched("cookies");
    return { get: cookieJar.touched, set: cookieJar.touched, delete: cookieJar.touched };
  },
  headers: async () => {
    cookieJar.touched("headers");
    return new Headers();
  },
}));

import { GET as getChoices, OPTIONS as optionsChoices } from "@/app/api/demo/choices/route";
import { OPTIONS as optionsSession, POST as postSession } from "@/app/api/demo/session/route";
import type { DemoChoices } from "@/lib/demo-signin/rules";

const APP = "https://app.weaverams.org";
const TARA = "5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a51";
const CHOICES: DemoChoices = {
  enabled: true,
  communities: [
    {
      kind: "faith",
      name: "Sunrise Worship Center (Demo)",
      id: "9a1b2c3d-0e1f-4a2b-8c3d-4e5f6a7b8c01",
      slug: "sunrise-demo",
      people: [{ id: TARA, role: "Treasurer", name: "Tara Test", story: "Matches the bank line.", area: "operations" }],
    },
  ],
};
const SESSION = { access_token: "a.b.c", refresh_token: "r-1", expires_in: 3600, expires_at: 1_790_000_000, token_type: "bearer" };
const STARTED = { result: { ok: true, data: { centerSlug: "sunrise-demo", expiresAt: "2026-10-14T20:00:00Z", role: "Treasurer", name: "Tara Test" } }, session: SESSION };

function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request("https://admin.weaverams.org/api/demo/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(body),
  });
}
const get = (headers: Record<string, string> = {}) => new Request("https://admin.weaverams.org/api/demo/choices", { headers });

function noCookie(res: Response) {
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(res.headers.getSetCookie()).toEqual([]);
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  st.loadChoices.mockReset().mockResolvedValue({ ok: true, choices: CHOICES });
  st.start.mockReset().mockResolvedValue(STARTED);
  cookieJar.touched.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/demo/choices", () => {
  it("answers 200 with the people, for the member app, never cached, without a cookie", async () => {
    const res = await getChoices(get({ origin: APP }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, enabled: true, communities: CHOICES.communities });
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    noCookie(res);
    expect(cookieJar.touched).not.toHaveBeenCalled();
  });

  it("works for React Native (no Origin) and then carries no CORS header", async () => {
    const res = await getChoices(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("gives another site no CORS header, so its browser refuses to read it", async () => {
    const res = await getChoices(get({ origin: "https://evil.example" }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("allows the local Expo origins only outside production", async () => {
    expect((await getChoices(get({ origin: "http://localhost:8081" }))).headers.get("access-control-allow-origin")).toBeNull();
    vi.stubEnv("NODE_ENV", "development");
    for (const origin of ["http://localhost:8081", "http://localhost:19006", "http://127.0.0.1:8081"]) {
      expect((await getChoices(get({ origin }))).headers.get("access-control-allow-origin"), origin).toBe(origin);
    }
    expect((await getChoices(get({ origin: "http://localhost:3000" }))).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("says the demo is off with a plain message", async () => {
    st.loadChoices.mockResolvedValue({ ok: true, choices: { enabled: false, communities: CHOICES.communities } });
    const body = await (await getChoices(get({ origin: APP }))).json();
    expect(body).toMatchObject({ ok: true, enabled: false, communities: [] });
    expect(body.message).toMatch(/switched off/);
  });

  it("answers 503 with a plain sentence when the list cannot be loaded", async () => {
    st.loadChoices.mockResolvedValue({ ok: false, error: "Could not load the demo people — whatever" });
    const res = await getChoices(get({ origin: APP }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "failed", error: expect.stringMatching(/^Could not load the demo — /) });
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
  });
});

describe("POST /api/demo/session", () => {
  it("answers 200 with the session and the demo, never cached, and sets no cookie", async () => {
    const res = await postSession(post({ persona: TARA }, { origin: APP, "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      session: SESSION,
      demo: { ends_at: "2026-10-14T20:00:00.000Z", role: "Treasurer", name: "Tara Test", community: "Sunrise Worship Center (Demo)" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vary")).toBe("Origin");
    noCookie(res);
    // The visitor's address is the first of the forwarded ones, and nothing read or set a cookie.
    expect(st.start).toHaveBeenCalledWith(TARA, "203.0.113.9");
    expect(cookieJar.touched).not.toHaveBeenCalled();
  });

  it("does not need an Origin (React Native), and a request that carries cookies has them left alone", async () => {
    const res = await postSession(post({ persona: TARA }, { cookie: "sb-abc-auth-token=signedin; cc_center=sunrise-demo" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    noCookie(res);
    expect(cookieJar.touched).not.toHaveBeenCalled();
  });

  it("answers the preflight of the member app, and none for another site", () => {
    for (const options of [optionsSession, optionsChoices]) {
      const ok = options(new Request("https://admin.weaverams.org/api/demo/session", { method: "OPTIONS", headers: { origin: APP, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } }));
      expect(ok.status).toBe(204);
      expect(ok.headers.get("access-control-allow-origin")).toBe(APP);
      expect(ok.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
      expect(ok.headers.get("access-control-allow-headers")).toBe("Content-Type");
      expect(ok.headers.get("cache-control")).toBe("no-store");
      noCookie(ok);
      const no = options(new Request("https://admin.weaverams.org/api/demo/session", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } }));
      expect(no.status).toBe(204);
      expect(no.headers.get("access-control-allow-origin")).toBeNull();
      expect(no.headers.get("access-control-allow-methods")).toBeNull();
    }
  });

  it("does not start a demo for a page on another site, and does not let that page read the refusal", async () => {
    const res = await postSession(post({ persona: TARA }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: "failed", error: expect.stringMatching(/^Could not start the demo — /) });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(st.start).not.toHaveBeenCalled();
    expect(st.loadChoices).not.toHaveBeenCalled();
  });

  it("answers 400 to a body that is not JSON, empty, or too big, and starts nothing", async () => {
    for (const raw of ["not json", "", "{", "x".repeat(5000)]) {
      const res = await postSession(post(null, { origin: APP }, raw));
      expect(res.status, raw.slice(0, 10)).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, code: "failed", error: expect.stringMatching(/the request was not understood/) });
      expect(res.headers.get("access-control-allow-origin")).toBe(APP);
    }
    expect(st.start).not.toHaveBeenCalled();
  });

  it("answers 400 unknown_person when no person is given or the id is not an id", async () => {
    for (const body of [{}, { persona: "tara" }, { persona: 3 }, [], null]) {
      const res = await postSession(post(body, { origin: APP }));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(st.start).not.toHaveBeenCalled();
    }
    const res = await postSession(post({ persona: "tara" }, { origin: APP }));
    expect(await res.json()).toMatchObject({ code: "unknown_person", error: expect.stringMatching(/choose a person to explore as first/) });
  });

  it("answers 404 unknown_person for a person who is not on the list", async () => {
    const res = await postSession(post({ persona: "7d5b3e9a-2f2e-4c0a-8c77-2b3f4e5d6c73" }, { origin: APP }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Could not start the demo — that demo person is not available. Choose another one.", code: "unknown_person" });
    expect(st.start).not.toHaveBeenCalled();
  });

  it("passes the limits through: 429 limit with the portal's sentence, and no session in the answer", async () => {
    st.start.mockResolvedValue({
      result: { ok: false, error: "Could not start the demo — you have started a lot of demos in the last hour. Please wait a while, then try again.", code: "limit" },
      session: null,
    });
    const res = await postSession(post({ persona: TARA }, { origin: APP }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Could not start the demo — you have started a lot of demos in the last hour. Please wait a while, then try again.", code: "limit" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
    noCookie(res);
  });

  it("answers off when the demo is switched off, with a plain sentence", async () => {
    st.loadChoices.mockResolvedValue({ ok: true, choices: { ...CHOICES, enabled: false } });
    const res = await postSession(post({ persona: TARA }, { origin: APP }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "off", error: expect.stringMatching(/switched off/) });
  });

  it("answers 500 failed, in plain words and without detail, if something unexpected is thrown", async () => {
    st.start.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));
    const res = await postSession(post({ persona: TARA }, { origin: APP }));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/Could not start the demo — /);
    expect(text).not.toMatch(/ECONNREFUSED|hunter2|10\.0/);
    expect(console.error).toHaveBeenCalled();
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
  });
});
