import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FOREIGN_ORIGIN,
  NOT_READY_MESSAGE,
  OFF_MESSAGE,
  UNREADABLE_REQUEST,
  allowedOrigins,
  answerHeaders,
  choicesReply,
  jsonReply,
  originAllowed,
  preflightReply,
  sessionReply,
  type AppSessionDeps,
} from "@/lib/demo-signin/app-api";
import { failCodeFor, type DemoChoices } from "@/lib/demo-signin/rules";
import type { StartResult } from "@/lib/demo-signin/start";

// The member app's two demo endpoints, without a server: what each answers in each situation (docs/MEMBER_APP_DEMO.md).

const TARA = "5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a51";
const RAJ = "6c4a2d8f-1e1d-4b9f-8b66-1a2e3d4c5b62";
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
    {
      kind: "neutral",
      name: "Riverside Club (Demo)",
      id: "9a1b2c3d-0e1f-4a2b-8c3d-4e5f6a7b8c02",
      slug: "riverside-demo",
      people: [{ id: RAJ, role: "Community member · Adult", name: "Raj Rao", story: "Looks at events.", area: "community" }],
    },
  ],
};
const SESSION = { access_token: "a.b.c", refresh_token: "r-1", expires_in: 3600, expires_at: 1_790_000_000, token_type: "bearer" as const };
const OK_START: StartResult = { ok: true, data: { centerSlug: "sunrise-demo", expiresAt: "2026-10-14T20:00:00+00:00", role: "Treasurer", name: "Tara Test" } };

function deps(over: Partial<AppSessionDeps> = {}) {
  const started: { persona: string; ip: string | null }[] = [];
  const d: AppSessionDeps = {
    loadChoices: async () => ({ ok: true, choices: CHOICES }),
    start: async (persona, ip) => {
      started.push({ persona, ip });
      return { result: OK_START, session: SESSION };
    },
    ...over,
  };
  return { d, started };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("who may read the answers (CORS)", () => {
  it("allows exactly the member app's address in production, and no local one", () => {
    expect(allowedOrigins(true, "weaverams.org")).toEqual(["https://app.weaverams.org"]);
  });

  it("also allows the local Expo addresses when not in production", () => {
    expect(allowedOrigins(false, "weaverams.org")).toEqual([
      "https://app.weaverams.org",
      "http://localhost:8081",
      "http://localhost:19006",
      "http://127.0.0.1:8081",
    ]);
  });

  it("follows the member app's configured address when that is another one (MEMBER_APP_URL), still by exact origin", () => {
    vi.stubEnv("NEXT_PUBLIC_MEMBER_APP_URL", "https://members.example.org/some/path/");
    expect(allowedOrigins(true, "weaverams.org")).toEqual(["https://app.weaverams.org", "https://members.example.org"]);
  });

  it("answers an allowed origin with the CORS headers, no credentials, and never caches", () => {
    const h = answerHeaders("https://app.weaverams.org", ["https://app.weaverams.org"]);
    expect(h["Access-Control-Allow-Origin"]).toBe("https://app.weaverams.org");
    expect(h["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
    expect(h["Access-Control-Allow-Headers"]).toBe("Content-Type");
    expect(h.Vary).toBe("Origin");
    expect(h["Cache-Control"]).toBe("no-store");
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("access-control-allow-credentials");
  });

  it("gives any other origin no CORS header at all (the browser refuses it), but still no-store and Vary", () => {
    for (const origin of ["https://evil.example", "https://app.weaverams.org.evil.example", "http://app.weaverams.org", "https://admin.weaverams.org", "null", "http://localhost:8081"]) {
      const h = answerHeaders(origin, ["https://app.weaverams.org"]);
      expect(Object.keys(h).filter((k) => k.toLowerCase().startsWith("access-control")), origin).toEqual([]);
      expect(h["Cache-Control"]).toBe("no-store");
      expect(h.Vary).toBe("Origin");
    }
    expect(Object.keys(answerHeaders(null, ["https://app.weaverams.org"])).filter((k) => k.toLowerCase().startsWith("access-control"))).toEqual([]);
  });

  it("lets a request with no Origin through (React Native) and refuses a named origin that is not allowed", () => {
    expect(originAllowed(null, ["https://app.weaverams.org"])).toBe(true);
    expect(originAllowed("https://app.weaverams.org", ["https://app.weaverams.org"])).toBe(true);
    expect(originAllowed("https://evil.example", ["https://app.weaverams.org"])).toBe(false);
    expect(originAllowed("", ["https://app.weaverams.org"])).toBe(false);
  });

  it("a preflight is 204 with the headers for the member app and 204 without them for anyone else", () => {
    vi.stubEnv("NODE_ENV", "production");
    const ok = preflightReply("https://app.weaverams.org");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.weaverams.org");
    expect(ok.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(ok.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const no = preflightReply("https://evil.example");
    expect(no.status).toBe(204);
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
    expect(no.headers.get("access-control-allow-methods")).toBeNull();
    const dev = preflightReply("http://localhost:8081");
    expect(dev.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("a JSON answer never sets a cookie", async () => {
    const res = jsonReply("https://app.weaverams.org", { status: 200, body: { ok: true } });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/demo/choices: what it says", () => {
  it("gives the people as the page lists them, and nothing else", () => {
    const r = choicesReply({ ok: true, choices: CHOICES });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, enabled: true, communities: CHOICES.communities });
    expect(JSON.stringify(r.body)).not.toMatch(/@|password|email/i);
  });

  it("gives every community its public id and slug (to open it as a guest) and every person their area", () => {
    const body = choicesReply({ ok: true, choices: CHOICES }).body as { communities: { id: string; slug: string; people: { area: string }[] }[] };
    expect(body.communities.map((c) => [c.id, c.slug])).toEqual([
      ["9a1b2c3d-0e1f-4a2b-8c3d-4e5f6a7b8c01", "sunrise-demo"],
      ["9a1b2c3d-0e1f-4a2b-8c3d-4e5f6a7b8c02", "riverside-demo"],
    ]);
    expect(body.communities.flatMap((c) => c.people.map((p) => p.area))).toEqual(["operations", "community"]);
  });

  it("says the demo is off, plainly, with no list", () => {
    const r = choicesReply({ ok: true, choices: { enabled: false, communities: CHOICES.communities } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, enabled: false, communities: [], message: OFF_MESSAGE });
    expect(OFF_MESSAGE).toMatch(/switched off/);
  });

  it("says when it is on but has no people yet", () => {
    const r = choicesReply({ ok: true, choices: { enabled: true, communities: [] } });
    expect(r.body).toEqual({ ok: true, enabled: true, communities: [], message: NOT_READY_MESSAGE });
  });

  it("says in plain words when the list cannot be loaded, never the technical reason", () => {
    const r = choicesReply({ ok: false, error: "Could not load the demo people — connect ECONNREFUSED 10.0.0.5:5432." });
    expect(r.status).toBe(503);
    expect(r.body.ok).toBe(false);
    expect(r.body.code).toBe("failed");
    expect(String(r.body.error)).toMatch(/^Could not load the demo — /);
    expect(String(r.body.error)).not.toMatch(/ECONNREFUSED|10\.0/);
  });
});

describe("POST /api/demo/session: the request", () => {
  it("starts through the shared core and returns the session and who the visitor is", async () => {
    const { d, started } = deps();
    const r = await sessionReply({ persona: TARA }, "203.0.113.9", d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      session: SESSION,
      demo: { ends_at: "2026-10-14T20:00:00.000Z", role: "Treasurer", name: "Tara Test", community: "Sunrise Worship Center (Demo)" },
    });
    expect(started).toEqual([{ persona: TARA, ip: "203.0.113.9" }]);
  });

  it("names the role the way the list did (the main adult is \"Community member · Adult\"), so the app says the same thing everywhere", async () => {
    const { d } = deps({ start: async () => ({ result: { ...OK_START, data: { ...OK_START.data!, role: "Primary adult", name: "Raj Rao" } } as StartResult, session: SESSION }) });
    const r = await sessionReply({ persona: RAJ }, null, d);
    expect(r.body.demo).toMatchObject({ role: "Community member · Adult", name: "Raj Rao", community: "Riverside Club (Demo)" });
  });

  it("hands over only the five fields of the session, whatever else the sign-in held", async () => {
    const { d } = deps({ start: async () => ({ result: OK_START, session: { ...SESSION, user: { email: "treasurer@demo.weaverams.org" }, provider_token: "x" } as typeof SESSION }) });
    const r = await sessionReply({ persona: TARA }, null, d);
    expect(Object.keys(r.body.session as object).sort()).toEqual(["access_token", "expires_at", "expires_in", "refresh_token", "token_type"]);
    expect(JSON.stringify(r.body)).not.toMatch(/demo\.weaverams\.org|provider_token|password/);
  });

  it("finds the person's community by id, whatever the letter case, and names the right one", async () => {
    const { d, started } = deps();
    const r = await sessionReply({ persona: RAJ.toUpperCase() }, null, d);
    expect((r.body.demo as { community: string }).community).toBe("Riverside Club (Demo)");
    expect(started[0]!.persona).toBe(RAJ);
  });

  it("keeps the database's own wording of the end time when it is not a time it can read", async () => {
    const { d } = deps({ start: async () => ({ result: { ...OK_START, data: { ...OK_START.data!, expiresAt: "soon" } } as StartResult, session: SESSION }) });
    expect(((await sessionReply({ persona: TARA }, null, d)).body.demo as { ends_at: string }).ends_at).toBe("soon");
  });

  it("refuses a body that is not an object, or has no person, or a person id that is not an id, without asking anything", async () => {
    for (const body of [null, undefined, "persona", 7, [TARA], {}, { persona: "" }, { persona: "treasurer" }, { persona: 5 }, { persona: { id: TARA } }, { person: TARA }]) {
      const { d, started } = deps({ loadChoices: vi.fn(async () => ({ ok: true as const, choices: CHOICES })) });
      const r = await sessionReply(body, null, d);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(["failed", "unknown_person"]).toContain(r.body.code);
      expect(String(r.body.error)).toMatch(/^Could not start the demo — /);
      expect(started).toEqual([]);
      expect(d.loadChoices).not.toHaveBeenCalled();
    }
    const { d } = deps();
    expect((await sessionReply({}, null, d)).body.error).toMatch(/choose a person to explore as first/);
    expect((await sessionReply("x", null, d)).body.error).toBe(UNREADABLE_REQUEST);
  });

  it("refuses a person who is not on the list the app was shown (unknown_person), before anything is started", async () => {
    const { d, started } = deps();
    const r = await sessionReply({ persona: "7d5b3e9a-2f2e-4c0a-8c77-2b3f4e5d6c73" }, "1.2.3.4", d);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ ok: false, error: "Could not start the demo — that demo person is not available. Choose another one.", code: "unknown_person" });
    expect(started).toEqual([]);
  });

  it("says the demo is off when it is, and starts nothing", async () => {
    const { d, started } = deps({ loadChoices: async () => ({ ok: true, choices: { ...CHOICES, enabled: false } }) });
    const r = await sessionReply({ persona: TARA }, null, d);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ ok: false, error: "Could not start the demo — the demo is switched off right now. Please try again later.", code: "off" });
    expect(started).toEqual([]);
  });

  it("says in plain words when the list of people cannot be loaded", async () => {
    const { d, started } = deps({ loadChoices: async () => ({ ok: false, error: "Could not load the demo people — the database could not be reached." }) });
    const r = await sessionReply({ persona: TARA }, null, d);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("failed");
    expect(String(r.body.error)).toMatch(/^Could not start the demo — the list of demo people could not be loaded/);
    expect(started).toEqual([]);
  });
});

describe("POST /api/demo/session: what the core says comes through", () => {
  const refusal = (code: Parameters<typeof failCodeFor>[0], error: string): StartResult => ({ ok: false, error, code: failCodeFor(code) });
  const cases: [string, StartResult, number, string, RegExp][] = [
    ["the database says off", refusal("off", "Could not start the demo — the demo is switched off right now. Please try again later."), 503, "off", /switched off/],
    ["the sign-ins are not set up", refusal("not_ready", "Could not start the demo — the demo is not ready yet. Its sign-ins have not been set up. Please try again later."), 503, "off", /not ready/],
    ["this visitor started too many", refusal("ip_limit", "Could not start the demo — you have started a lot of demos in the last hour. Please wait a while, then try again."), 429, "limit", /lot of demos in the last hour/],
    ["the platform is at its limit", refusal("busy", "Could not start the demo — the demo is very busy right now. Please try again in a few minutes."), 429, "limit", /very busy/],
    ["the database does not know the person", refusal("unknown_persona", "Could not start the demo — that demo person is not available. Choose another one."), 404, "unknown_person", /not available/],
    ["anything else", { ok: false, error: "Could not start the demo — the demo sign-in did not work. Please try again in a minute. If it keeps happening, tell the Weaver team.", code: "failed" }, 500, "failed", /did not work/],
  ];
  for (const [name, result, status, code, words] of cases) {
    it(`${name}: ${status} ${code}, with the same sentence the portal's page shows`, async () => {
      const { d } = deps({ start: async () => ({ result, session: null }) });
      const r = await sessionReply({ persona: TARA }, "198.51.100.7", d);
      expect(r.status).toBe(status);
      expect(r.body).toEqual({ ok: false, error: result.error, code });
      expect(String(r.body.error)).toMatch(/^Could not start the demo — /);
      expect(String(r.body.error)).toMatch(words);
      expect(JSON.stringify(r.body)).not.toContain("access_token");
    });
  }

  it("never hands over a session when the core failed, even if one was left behind", async () => {
    const { d } = deps({ start: async () => ({ result: { ok: false, error: "Could not start the demo — the session could not be recorded. Nothing was started. Please try again.", code: "failed" }, session: SESSION }) });
    const r = await sessionReply({ persona: TARA }, null, d);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain(SESSION.access_token);
    expect(JSON.stringify(r.body)).not.toContain(SESSION.refresh_token);
  });

  it("says so (and logs it) if a start succeeded but no session was kept", async () => {
    const { d } = deps({ start: async () => ({ result: OK_START, session: null }) });
    const r = await sessionReply({ persona: TARA }, null, d);
    expect(r.status).toBe(500);
    expect(r.body.code).toBe("failed");
    expect(console.error).toHaveBeenCalled();
  });
});

describe("the words", () => {
  it("has a sentence for the other site and an unreadable request", () => {
    expect(FOREIGN_ORIGIN).toMatch(/^Could not start the demo — /);
    expect(UNREADABLE_REQUEST).toMatch(/^Could not start the demo — /);
  });

  it("maps every refusal of the database to one of the four codes", () => {
    expect(failCodeFor("off")).toBe("off");
    expect(failCodeFor("not_ready")).toBe("off");
    expect(failCodeFor("ip_limit")).toBe("limit");
    expect(failCodeFor("busy")).toBe("limit");
    expect(failCodeFor("unknown_persona")).toBe("unknown_person");
  });
});
