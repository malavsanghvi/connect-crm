import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

import {
  DEMO_EMAIL_DOMAIN,
  DEMO_SESSION_HOURS,
  endedNotice,
  ipLimitKey,
  isDemoClaims,
  isDemoEmail,
  isUuid,
  parseBanner,
  parseBegin,
  parseChoices,
  peopleByArea,
  refusalMessage,
  sessionIdFromAccessToken,
  timeLeftText,
} from "@/lib/demo-signin/rules";
import { nextStep, parseStatus } from "@/lib/demo-signin/status";
import { CENTER_COOKIE_NAME } from "@/lib/demo-signin/guard";

const ID1 = "5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a51";
const ID2 = "6c4a2d8f-1e1d-4b9f-8b66-1a2e3d4c5b62";

function token(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "ES256" })}.${enc(claims)}.signature`;
}

describe("the reserved demo address", () => {
  it("is exactly demo.weaverams.org, and the session is two hours", () => {
    expect(DEMO_EMAIL_DOMAIN).toBe("demo.weaverams.org");
    expect(DEMO_SESSION_HOURS).toBe(2);
  });

  it("accepts a demo person's address in any case, and nothing else", () => {
    expect(isDemoEmail("treasurer.sunrise@demo.weaverams.org")).toBe(true);
    expect(isDemoEmail("  Member@Demo.Weaverams.Org ")).toBe(true);
    for (const bad of [
      "x@weaverams.org",
      "x@demo.weaverams.org.evil.com",
      "x@evil.demo.weaverams.org",
      "x@notdemo.weaverams.org",
      "x@demo-weaverams.org",
      "demo.weaverams.org",
      "@demo.weaverams.org",
      "a b@demo.weaverams.org",
      "x@demo.weaverams.org\n@evil.com",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(isDemoEmail(bad), String(bad)).toBe(false);
    }
  });

  it("knows a uuid when it sees one", () => {
    expect(isUuid(ID1)).toBe(true);
    expect(isUuid(ID1.toUpperCase())).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(`${ID1}x`)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("keeps the proxy's copy of the switcher cookie name equal to the real one", async () => {
    const { CENTER_COOKIE } = await import("@/lib/center-resolve");
    expect(CENTER_COOKIE_NAME).toBe(CENTER_COOKIE);
  });
});

describe("the list of demo people (app.demo_choices)", () => {
  const person = (id: string, role: string, name: string, story = "A sentence.", area = "operations") => ({ id, role, name, story, area });
  const CID = "9a1b2c3d-0e1f-4a2b-8c3d-4e5f6a7b8c01";

  it("reads both communities, faith-based first, with their people", () => {
    const c = parseChoices({
      enabled: true,
      communities: [
        { kind: "neutral", name: "Lakeside Neighbors Club (Demo)", id: CID, slug: "lakeside-demo", people: [person(ID2, "Treasurer", "Tara Test")] },
        { kind: "faith", name: "Sunrise Worship Center (Demo)", id: CID, slug: "sunrise-demo", people: [person(ID1, "Administrator", "Asha Test")] },
      ],
    });
    expect(c.enabled).toBe(true);
    expect(c.communities.map((x) => x.kind)).toEqual(["faith", "neutral"]);
    expect(c.communities[0]!.people[0]).toEqual({ id: ID1, role: "Administrator", name: "Asha Test", story: "A sentence.", area: "operations" });
    expect(c.communities[0]).toMatchObject({ id: CID, slug: "sunrise-demo" });
  });

  it("is off unless the database says true, and never invents anything", () => {
    expect(parseChoices(null)).toEqual({ enabled: false, communities: [] });
    expect(parseChoices({ enabled: "yes", communities: "no" })).toEqual({ enabled: false, communities: [] });
    expect(parseChoices({ enabled: true }).communities).toEqual([]);
  });

  it("leaves out what it cannot read: an unknown kind, a person without an id or a role, a community with nobody", () => {
    const c = parseChoices({
      enabled: true,
      communities: [
        { kind: "chamber", name: "x", people: [person(ID1, "Administrator", "Asha")] },
        { kind: "faith", name: "F", id: CID, slug: "f", people: [person("nope", "Administrator", "Asha"), person(ID2, "", "Nobody"), person(ID2, "Member", "Mira")] },
        { kind: "neutral", name: "N", id: CID, slug: "n", people: [] },
        "garbage",
      ],
    });
    expect(c.communities).toHaveLength(1);
    expect(c.communities[0]!.people.map((p) => p.name)).toEqual(["Mira"]);
  });

  it("does not pass an e-mail address along even if one were sent", () => {
    const c = parseChoices({
      enabled: true,
      communities: [{ kind: "faith", name: "F", id: CID, slug: "f", people: [{ ...person(ID1, "Administrator", "Asha"), email: "asha@demo.weaverams.org" }] }],
    });
    expect(JSON.stringify(c)).not.toContain("weaverams.org");
  });

  it("reads each person's area (operations or community) and leaves out a person whose area is missing or unknown", () => {
    const c = parseChoices({
      enabled: true,
      communities: [
        { kind: "faith", name: "F", id: CID, slug: "f", people: [
          person(ID1, "Treasurer", "Tara", "x", "operations"),
          person(ID2, "Community member · Adult", "Tarun", "x", "community"),
          person("5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a53", "Teacher", "Tess", "x", "staff"),
          { id: "5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a54", role: "Event lead", name: "Eve", story: "x" },
        ] },
      ],
    });
    expect(c.communities[0]!.people.map((p) => [p.name, p.area])).toEqual([["Tara", "operations"], ["Tarun", "community"]]);
  });

  it("keeps a community's public id and slug, and leaves out one that has neither", () => {
    const c = parseChoices({
      enabled: true,
      communities: [
        { kind: "faith", name: "F", id: CID, slug: "sunrise-demo", people: [person(ID1, "Treasurer", "Tara")] },
        { kind: "neutral", name: "N", people: [person(ID2, "Treasurer", "Tara")] },
        { kind: "neutral", name: "N", id: "not-an-id", slug: "n", people: [person(ID2, "Treasurer", "Tara")] },
        { kind: "neutral", name: "N", id: CID, slug: "", people: [person(ID2, "Treasurer", "Tara")] },
      ],
    });
    expect(c.communities).toHaveLength(1);
    expect(c.communities[0]).toMatchObject({ kind: "faith", id: CID, slug: "sunrise-demo" });
  });

  it("arranges a community's people in the two areas, operations first, the database's order kept, an empty area left out", () => {
    const mk = (id: string, name: string, area: "operations" | "community") => ({ id, role: "R", name, story: "s", area });
    const groups = peopleByArea({ people: [mk(ID1, "A", "community"), mk(ID2, "B", "operations"), mk(ID1, "C", "operations")] });
    expect(groups.map((g) => [g.area, g.label, g.people.map((p) => p.name)])).toEqual([
      ["operations", "Community Admin Roles", ["B", "C"]],
      ["community", "Community Members", ["A"]],
    ]);
    expect(peopleByArea({ people: [mk(ID1, "A", "community")] }).map((g) => g.area)).toEqual(["community"]);
    expect(peopleByArea({ people: [] })).toEqual([]);
  });
});

describe("the answer to starting a session (app.worker_demo_begin)", () => {
  const ok = { ok: true, demo_session_id: ID1, email: "m@demo.weaverams.org", password: "p".repeat(64), center_slug: "sunrise-demo", role: "Member", name: "Mira", expires_at: "2026-10-11T20:00:00Z" };

  it("reads a good answer", () => {
    expect(parseBegin(ok)).toEqual({
      ok: true,
      demoSessionId: ID1,
      email: "m@demo.weaverams.org",
      password: "p".repeat(64),
      centerSlug: "sunrise-demo",
      role: "Member",
      name: "Mira",
      expiresAt: "2026-10-11T20:00:00Z",
    });
  });

  it("reads each refusal", () => {
    for (const code of ["off", "unknown_persona", "not_ready", "ip_limit", "busy"] as const) {
      expect(parseBegin({ ok: false, code })).toEqual({ ok: false, code });
    }
  });

  it("returns null for anything else: a missing part, an unknown code, a wrong shape", () => {
    expect(parseBegin({ ...ok, password: "" })).toBeNull();
    expect(parseBegin({ ...ok, demo_session_id: "x" })).toBeNull();
    expect(parseBegin({ ...ok, center_slug: undefined })).toBeNull();
    expect(parseBegin({ ok: false, code: "who_knows" })).toBeNull();
    expect(parseBegin({ ok: "true" })).toBeNull();
    expect(parseBegin(null)).toBeNull();
    expect(parseBegin([ok])).toBeNull();
  });

  it("says why in plain words, for every refusal", () => {
    expect(refusalMessage("off")).toMatch(/switched off/);
    expect(refusalMessage("ip_limit")).toMatch(/wait a while/);
    expect(refusalMessage("busy")).toMatch(/very busy/);
    expect(refusalMessage("not_ready")).toMatch(/not ready/);
    expect(refusalMessage("unknown_persona")).toMatch(/Choose another/);
    for (const code of ["off", "unknown_persona", "not_ready", "ip_limit", "busy"] as const) {
      expect(refusalMessage(code)).not.toMatch(/\b(rpc|sql|exception|postgres|null)\b/i);
    }
  });
});

describe("the Auth session behind an access token", () => {
  it("reads the session_id claim", () => {
    expect(sessionIdFromAccessToken(token({ sub: ID2, session_id: ID1 }))).toBe(ID1);
  });
  it("returns null when it is missing, not a uuid, or the token is broken", () => {
    expect(sessionIdFromAccessToken(token({ sub: ID2 }))).toBeNull();
    expect(sessionIdFromAccessToken(token({ session_id: "abc" }))).toBeNull();
    expect(sessionIdFromAccessToken("not.a.jwt")).toBeNull();
    expect(sessionIdFromAccessToken("onlyonepart")).toBeNull();
    expect(sessionIdFromAccessToken("")).toBeNull();
    expect(sessionIdFromAccessToken(null)).toBeNull();
  });
});

describe("what the demo page and banner say", () => {
  it("explains why a session ended", () => {
    expect(endedNotice("expired")).toMatch(/2-hour demo has ended/);
    expect(endedNotice("off")).toMatch(/switched off/);
    expect(endedNotice("unknown")).toMatch(/no longer active/);
    expect(endedNotice("error")).toMatch(/could not check/);
    expect(endedNotice("left")).toMatch(/left the demo/);
    expect(endedNotice("whatever")).toBeNull();
    expect(endedNotice(undefined)).toBeNull();
  });

  it("words the time left", () => {
    expect(timeLeftText(7200)).toBe("2 h 0 min left");
    expect(timeLeftText(6120)).toBe("1 h 42 min left");
    expect(timeLeftText(2100)).toBe("35 min left");
    expect(timeLeftText(59)).toBe("less than a minute left");
    expect(timeLeftText(-5)).toBe("less than a minute left");
  });

  it("reads the session state for the banner only when it is ok", () => {
    expect(parseBanner({ state: "ok", role: "Treasurer", name: "Tara", center_name: "Sunrise", seconds_left: 5400 })).toEqual({
      role: "Treasurer",
      name: "Tara",
      centerName: "Sunrise",
      secondsLeft: 5400,
    });
    expect(parseBanner({ state: "expired" })).toBeNull();
    expect(parseBanner({ state: "not_demo" })).toBeNull();
    expect(parseBanner(null)).toBeNull();
  });
});

describe("the platform panel's status (app.demo_signin_status)", () => {
  const base = {
    enabled: false, reason: "Not yet", changed_at: "2026-10-11T12:00:00Z", changed_by: "owner@example.org", people_total: 47, people_ready: 0,
    live_sessions: 0, started_24h: 3, hours: 2, communities: [],
  };

  it("reads the numbers and the communities", () => {
    const s = parseStatus({ ...base, people_ready: 47, communities: [{ id: ID1, name: "Sunrise", kind: "faith" }, { id: ID2, name: "Lakeside", kind: "neutral" }] })!;
    expect(s.peopleReady).toBe(47);
    expect(s.started24h).toBe(3);
    expect(s.communities.map((c) => c.kind)).toEqual(["faith", "neutral"]);
    expect(s.hours).toBe(2);
  });

  it("is off unless it is true, and null for a wrong shape", () => {
    expect(parseStatus({ ...base, enabled: "true" })!.enabled).toBe(false);
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus([])).toBeNull();
  });

  it("names the next step in order: communities, sign-ins, switching on, running", () => {
    expect(nextStep(parseStatus(base)!)).toMatch(/Create a demo community first/);
    // One demo community is enough: with only the faith-based one (or only the other) the next step is the sign-ins.
    expect(nextStep(parseStatus({ ...base, communities: [{ id: ID1, name: "S", kind: "faith" }] })!)).toMatch(/Set up the sign-ins/);
    expect(nextStep(parseStatus({ ...base, communities: [{ id: ID2, name: "L", kind: "neutral" }] })!)).toMatch(/Set up the sign-ins/);
    expect(nextStep(parseStatus({ ...base, communities: [{ id: ID1, name: "S", kind: "faith" }], people_ready: 47 })!)).toMatch(/Turn the demo on/);
    const two = [{ id: ID1, name: "S", kind: "faith" }, { id: ID2, name: "L", kind: "neutral" }];
    expect(nextStep(parseStatus({ ...base, communities: two, people_ready: 10 })!)).toMatch(/Set up the sign-ins/);
    expect(nextStep(parseStatus({ ...base, communities: two, people_ready: 47 })!)).toMatch(/Turn the demo on/);
    expect(nextStep(parseStatus({ ...base, communities: two, people_ready: 47, enabled: true })!)).toMatch(/running demos end at once|Turn it off at any time/);
  });
});

describe("a demo person's token", () => {
  it("is recognised by the demo address, or by the mark the database puts in app_metadata (a person cannot edit that)", () => {
    expect(isDemoClaims({ email: "treasurer@demo.weaverams.org" })).toBe(true);
    expect(isDemoClaims({ email: "someone@example.org", app_metadata: { demo: true } })).toBe(true);
    expect(isDemoClaims({ app_metadata: { demo: true } })).toBe(true);
  });

  it("is not guessed from anything looser", () => {
    for (const c of [
      null,
      undefined,
      {},
      { email: "ada@jsh.org" },
      { email: "ada@jsh.org", app_metadata: {} },
      { email: "ada@jsh.org", app_metadata: { demo: "true" } },
      { email: "ada@jsh.org", app_metadata: { demo: 1 } },
      { email: "ada@jsh.org", app_metadata: "demo" },
      { email: "x@demo.weaverams.org.evil.com" },
    ]) {
      expect(isDemoClaims(c), JSON.stringify(c)).toBe(false);
    }
  });
});

describe("what the per-visitor limit counts", () => {
  it("is the address itself for IPv4, and the /64 for IPv6, however it is written", () => {
    expect(ipLimitKey("203.0.113.9")).toBe("203.0.113.9");
    expect(ipLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipLimitKey("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipLimitKey("2001:0db8:0001:0002:0000:0000:0000:0001")).toBe("2001:db8:1:2::/64");
    expect(ipLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipLimitKey("2001:db8:0:0:1:2:3:4")).toBe("2001:db8:0:0::/64");
  });

  it("gives one household's whole /64 the same key, and another /64 a different one", () => {
    const a = ipLimitKey("2a02:c7f:1234:5678:1111:2222:3333:4444");
    expect(ipLimitKey("2a02:c7f:1234:5678:ffff:ffff:ffff:ffff")).toBe(a);
    expect(ipLimitKey("2a02:c7f:1234:5678::9")).toBe(a);
    expect(ipLimitKey("2a02:c7f:1234:5679:1111:2222:3333:4444")).not.toBe(a);
  });

  it("counts an IPv4-mapped IPv6 address as the IPv4 one", () => {
    expect(ipLimitKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipLimitKey("0:0:0:0:0:ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("does not guess at what it cannot read", () => {
    expect(ipLimitKey(null)).toBe("unknown");
    expect(ipLimitKey("  ")).toBe("unknown");
    expect(ipLimitKey("1:2:3")).toBe("1:2:3");
    expect(ipLimitKey("1::2::3")).toBe("1::2::3");
    expect(ipLimitKey("zz::1")).toBe("zz::1");
  });
});
