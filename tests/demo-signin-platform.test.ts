import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The buttons call Server Actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/platform/setup/demo-signin-actions", () => ({
  setDemoSigninAction: vi.fn(),
  setupDemoSigninAction: vi.fn(),
  createDemoCommunityAction: vi.fn(),
  resetDemoCommunityAction: vi.fn(),
}));

const session = vi.hoisted(() => ({ state: { status: "signed_out" } as Record<string, unknown>, rpc: vi.fn(), reason: vi.fn() }));
vi.mock("@/lib/session", () => ({
  loadSession: async () => session.state,
  dbWithReason: async (_s: unknown, reason: string) => {
    session.reason(reason);
    return { rpc: session.rpc };
  },
}));

import { DemoSigninControls } from "@/app/(app)/platform/setup/demo-signin-controls";
import { DemoSigninPanel } from "@/app/(app)/platform/setup/demo-signin-panel";
// The real actions, not the mock above, for the tests of what they send to the database.
const actions = await vi.importActual<typeof import("@/app/(app)/platform/setup/demo-signin-actions")>("@/app/(app)/platform/setup/demo-signin-actions");

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const C1 = "5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a51";
const C2 = "6c4a2d8f-1e1d-4b9f-8b66-1a2e3d4c5b62";

const status = (over: Record<string, unknown> = {}) => ({
  enabled: false, reason: null, changed_at: null, changed_by: null, people_total: 47, people_ready: 0, live_sessions: 0, started_24h: 0, hours: 2,
  communities: [], ...over,
});
const two = [{ id: C1, name: "Sunrise Jain Temple (Demo)", kind: "faith" }, { id: C2, name: "Lakeside Neighbors Club (Demo)", kind: "neutral" }];

async function panel(rpcAnswer: { data: unknown; error: unknown }) {
  const s = { db: { rpc: vi.fn(async () => rpcAnswer) } } as unknown as Parameters<typeof DemoSigninPanel>[0]["session"];
  return render(await DemoSigninPanel({ session: s, tz: "America/Chicago" }));
}

describe("Platform › Setup › Demo sign-in (the kill switch)", () => {
  it("starts off, and says what to do first", async () => {
    const html = await panel({ data: status(), error: null });
    expect(html).toContain("Demo sign-in");
    expect(html).toContain('data-demo-state="off"');
    expect(html).toContain("Off — nobody can start a demo");
    expect(html).toContain("Create the two demo communities first");
    expect(html).toContain("Sign-ins ready: <b>0</b> of <b>47</b>");
    expect(html).toContain("Each demo session lasts 2 hours");
  });

  it("says when it is on, who changed it, when and why", async () => {
    const html = await panel({
      data: status({ enabled: true, communities: two, people_ready: 47, live_sessions: 3, started_24h: 12, reason: "Open for the board meeting", changed_by: "owner@weaverams.org", changed_at: "2026-10-11T15:00:00Z" }),
      error: null,
    });
    expect(html).toContain('data-demo-state="on"');
    expect(html).toContain("On — visitors can start a demo");
    expect(html).toContain("by owner@weaverams.org");
    expect(html).toContain("Open for the board meeting");
    expect(html).toContain("Running now: <b>3</b>");
    expect(html).toContain("last 24 hours: <b>12</b>");
    expect(html).toContain("Turn it off at any time");
  });

  it("shows a failure to load as a failure, with a way to try again", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await panel({ data: null, error: { message: "permission denied for function demo_signin_status", code: "42501" } });
    spy.mockRestore();
    expect(html).toContain("Could not load the demo sign-in");
    expect(html).toContain("/platform/setup");
    expect(html).not.toContain('data-demo-state');
  });

  it("offers Turn off (not Turn on) while it is on, and cannot be turned on before any sign-in exists", () => {
    const on = render(createElement(DemoSigninControls, { enabled: true, allReady: true, anyReady: true, kindsMissing: [], communities: two }));
    expect(on).toContain("Turn the demo off");
    expect(on).not.toContain("Turn the demo on");
    expect(on).toContain("Replace the passwords");
    expect(on).toContain("Start “Sunrise Jain Temple (Demo)” over");
    const none = render(createElement(DemoSigninControls, { enabled: false, allReady: false, anyReady: false, kindsMissing: ["faith", "neutral"], communities: [] }));
    expect(none).toContain("Create the faith-based demo");
    expect(none).toContain("Create the not faith-based demo");
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>Turn the demo on<\/button>/);
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>Set up the sign-ins<\/button>/);
    expect(none).not.toContain("Replace the passwords");
  });
});

describe("the platform actions", () => {
  beforeEach(() => {
    session.rpc.mockReset();
    session.reason.mockReset();
    session.state = { status: "ok", session: { isPlatformAdmin: true, requestId: "r", clientApp: undefined } };
  });
  afterEach(() => vi.restoreAllMocks());

  it("turn the switch off with a reason, and say how many running demos ended", async () => {
    session.rpc.mockResolvedValue({ data: { enabled: false, ended: 3 }, error: null });
    const res = await actions.setDemoSigninAction(false, "  Too many visitors  ");
    expect(session.rpc).toHaveBeenCalledWith("set_demo_signin", { p_enabled: false, p_reason: "Too many visitors" });
    expect(session.reason).toHaveBeenCalledWith("Too many visitors");
    expect(res).toMatchObject({ ok: true });
    expect(res.message).toContain("3 running demos ended");
  });

  it("refuse without a reason, before asking the database anything", async () => {
    const res = await actions.setDemoSigninAction(true, "   ");
    expect(res).toEqual({ ok: false, error: "Could not turn the demo on — say why. The reason is kept in the audit log." });
    expect(session.rpc).not.toHaveBeenCalled();
  });

  it("refuse anyone who is not a platform admin, and a signed-out visitor", async () => {
    session.state = { status: "ok", session: { isPlatformAdmin: false } };
    const a = await actions.setDemoSigninAction(true, "Because");
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/only Weaver platform admins/);
    session.state = { status: "signed_out" };
    const b = await actions.setupDemoSigninAction("Because", false);
    expect(b.ok).toBe(false);
    expect(b.error).toMatch(/session has expired/);
    expect(session.rpc).not.toHaveBeenCalled();
  });

  it("ask for the fresh 2FA check when the database does (the step-up flag is passed on)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    session.rpc.mockResolvedValue({ data: null, error: { code: "CCSTP", message: "This needs a fresh 2FA check." } });
    const res = await actions.setDemoSigninAction(true, "Open it");
    expect(res.ok).toBe(false);
    expect(res.stepUp).toBe(true);
  });

  it("say out loud which sign-ins were left alone", async () => {
    session.rpc.mockResolvedValue({ data: { created: 46, rotated: 0, refused: [{ email: "teacher@demo.weaverams.org", why: "x" }] }, error: null });
    const res = await actions.setupDemoSigninAction("Set up", false);
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Set up 46 demo sign-ins");
    expect(res.message).toContain("NOT set up: teacher@demo.weaverams.org");
  });

  it("create only the two kinds of demo community, and reset only a community id", async () => {
    const bad = await actions.createDemoCommunityAction("chamber", "Because");
    expect(bad.ok).toBe(false);
    const bad2 = await actions.resetDemoCommunityAction("not-an-id", "Because");
    expect(bad2.ok).toBe(false);
    expect(session.rpc).not.toHaveBeenCalled();
    session.rpc.mockResolvedValue({ data: { created: true }, error: null });
    expect((await actions.createDemoCommunityAction("faith", "Create it")).ok).toBe(true);
    expect(session.rpc).toHaveBeenCalledWith("create_demo_community", { p_kind: "faith" });
    expect((await actions.resetDemoCommunityAction(C1, "Start over")).ok).toBe(true);
    expect(session.rpc).toHaveBeenCalledWith("reset_demo_community", { p_center: C1 });
  });
});
