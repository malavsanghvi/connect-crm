import { beforeEach, describe, expect, it, vi } from "vitest";

import { ASK_SENTENCE, askOutcome, askedLine, parseAskList, parseAskResult } from "@/lib/matching/ask";
import { emailReadinessFrom } from "@/lib/matching/send-ready";

// CatchTheMatch Phase 1, piece 0 (migration 0920): asking families for their employer. Pure words and parsing, the server's email
// readiness, and the Server Action that must refuse in words (and queue nothing) when email cannot leave.

const household = { id: "h1", name: "Mensah, Ama", number: "GC-H-0041", org_household_id: null, city: "Austin", zone: null, primary_member: "Ama Mensah", adults: [], merged: false };

describe("parsing the audience", () => {
  it("reads the counts, the people, the household card and how each can be reached", () => {
    const l = parseAskList({
      total: 1,
      rows: [{ person: { id: "p1", name: "Ama Mensah" }, household, email: true, app: false, last_asked: "2026-07-03T15:00:00Z" }],
      counts: { people: 8, to_ask: 6, email: 2, app: 1, nobody: 3, on_file: 1, withdrew: 1, recent: 0 },
      today: "2026-10-17",
      sandbox: true,
    });
    expect(l.total).toBe(1);
    expect(l.counts).toEqual({ people: 8, toAsk: 6, email: 2, app: 1, nobody: 3, onFile: 1, withdrew: 1, recent: 0 });
    expect(l.rows[0]).toMatchObject({ person: { id: "p1", name: "Ama Mensah" }, email: true, app: false, lastAsked: "2026-07-03T15:00:00Z" });
    expect(l.rows[0].household?.number).toBe("GC-H-0041");
    expect(l.sandbox).toBe(true);
  });

  it("survives an empty or odd answer", () => {
    const l = parseAskList(null);
    expect(l.rows).toEqual([]);
    expect(l.counts.toAsk).toBe(0);
    expect(l.sandbox).toBe(false);
  });
});

describe("what the screen says after an ask", () => {
  it("never calls queued sent, and says where the real outcome shows", () => {
    const o = askOutcome(parseAskResult({ asked: 3, email: 3, push: 1, not_queued: {}, nobody: 0, left: 0, not_in_audience: 0 }));
    expect(o.ok).toBe(true);
    const text = o.ok ? o.message : "";
    expect(text).toContain("Queued the request for 3 people (3 emails and 1 app notification)");
    expect(text).toContain("Settings › Email › Recent emails");
    expect(text).not.toMatch(/\bsent\b/i);
  });

  it("lists what could not be queued and how many are left", () => {
    const o = askOutcome(parseAskResult({ asked: 1, email: 1, push: 0, not_queued: { "The person opted out of these messages.": 2 }, nobody: 0, left: 5, not_in_audience: 0 }));
    expect(o.ok && o.message).toContain("Not queued: The person opted out of these messages. (2)");
    expect(o.ok && o.message).toContain("5 people more are waiting: ask again to continue.");
  });

  it("is an error, in words, when nothing was queued", () => {
    const sandbox = askOutcome(parseAskResult({ asked: 0, email: 0, push: 0, not_queued: { "This community is a sandbox: it messages only verified test recipients (Settings › Limits).": 1 }, nobody: 0, left: 0, not_in_audience: 0 }));
    expect(sandbox.ok).toBe(false);
    expect(!sandbox.ok && sandbox.error).toContain("nothing was queued");
    expect(!sandbox.ok && sandbox.error).toContain("sandbox");
    const gone = askOutcome(parseAskResult({ asked: 0, not_in_audience: 1 }));
    expect(!gone.ok && gone.error).toContain("not in the list any more");
    const nobody = askOutcome(parseAskResult({ asked: 0, nobody: 2 }));
    expect(!nobody.ok && nobody.error).toContain("2 people on the list have no email address or member app");
    const none = askOutcome(parseAskResult({}));
    expect(!none.ok && none.error).toContain("nobody is left to ask");
  });

  it("says when someone was asked before", () => {
    expect(askedLine(null, "America/Chicago")).toBe("Not asked yet");
    expect(askedLine("2026-07-03T15:00:00Z", "America/Chicago")).toBe("Asked before, on 3 July 2026");
  });

  it("keeps the owner's words", () => {
    expect(ASK_SENTENCE).toBe("You may be eligible to double the donation from your employer if you provide your employer information.");
  });
});

describe("whether this server can send email", () => {
  it("is ready with a provider key and the member app's address", () => {
    expect(emailReadinessFrom({ RESEND_API_KEY: "re_x", MEMBER_APP_URL: "https://app.example" }, { memberAppLink: true })).toEqual({ ok: true });
    expect(emailReadinessFrom({ RESEND_API_KEY: "re_x" }, { memberAppLink: false })).toEqual({ ok: true });
  });
  it("is not ready without the key, and says what is missing and that nothing was queued", () => {
    const r = emailReadinessFrom({}, { memberAppLink: true });
    expect(r.ok).toBe(false);
    const error = r.ok ? "" : r.error;
    expect(error).toContain("the Resend API key");
    expect(error).toContain("MEMBER_APP_URL");
    expect(error).toContain("nothing was sent or queued");
  });
  it("follows the chosen provider", () => {
    const r = emailReadinessFrom({ MESSAGING_EMAIL_PROVIDER: "postmark", RESEND_API_KEY: "re_x" }, { memberAppLink: false });
    expect(!r.ok && r.error).toContain("the Postmark server token");
    expect(emailReadinessFrom({ MESSAGING_EMAIL_PROVIDER: "postmark", POSTMARK_SERVER_TOKEN: "pm_x" }, { memberAppLink: false })).toEqual({ ok: true });
  });
});

// ── The Server Action ────────────────────────────────────────────────────────
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ manage: true, env: {} as Record<string, string | undefined> }));
vi.mock("@/lib/session", () => ({
  authorizeActionWhere: async (check: (s: unknown) => boolean) =>
    state.manage && check({ permissions: ["matching.manage"], isPlatformAdmin: false, modulesOff: [] })
      ? { ok: true, session: { center: { id: "c1" }, requestId: "r1", clientApp: "portal" } }
      : { ok: false, error: "Could not ask the families — you don't have permission (needs matching.manage)." },
  dbWithReason: async () => ({ rpc }),
}));
vi.mock("@/lib/platform-setup/server-config", () => ({ platformEnv: async () => state.env }));

import { askEmployersAction } from "@/app/(app)/giving/matching/actions";

const form = (...ids: string[]) => {
  const fd = new FormData();
  for (const id of ids) fd.append("person_id", id);
  return fd;
};
const UUID = "92000000-0000-4000-8000-0000000000a1";

describe("the Ask action", () => {
  beforeEach(() => {
    rpc.mockReset();
    state.manage = true;
    state.env = { RESEND_API_KEY: "re_x", MEMBER_APP_URL: "https://app.example" };
  });

  it("refuses in words, and queues nothing, when email is not set up", async () => {
    state.env = {};
    const r = await askEmployersAction(null, form());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Email sending is not set up");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses someone without matching.manage", async () => {
    state.manage = false;
    const r = await askEmployersAction(null, form());
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks everyone listed (no person named) up to 300, and reports 'queued', never 'sent'", async () => {
    rpc.mockResolvedValue({ data: { asked: 2, email: 2, push: 0, not_queued: {}, nobody: 0, left: 0, not_in_audience: 0 }, error: null });
    const r = await askEmployersAction(null, form());
    expect(rpc).toHaveBeenCalledWith("ask_match_employers", { p_center: "c1", p_people: undefined, p_limit: 300 });
    expect(r.ok).toBe(true);
    expect(r.ok && r.message).toContain("Queued the request for 2 people");
    expect(r.ok && r.message).not.toMatch(/\bsent\b/i);
  });

  it("asks one person", async () => {
    rpc.mockResolvedValue({ data: { asked: 1, email: 1, push: 0, not_queued: {}, nobody: 0, left: 0, not_in_audience: 0 }, error: null });
    await askEmployersAction(null, form(UUID));
    expect(rpc).toHaveBeenCalledWith("ask_match_employers", { p_center: "c1", p_people: [UUID], p_limit: 300 });
  });

  it("turns a refusal into words, and a database error into a plain sentence", async () => {
    rpc.mockResolvedValue({ data: { asked: 0, not_queued: { "This community is a sandbox: it messages only verified test recipients (Settings › Limits).": 1 } }, error: null });
    const refused = await askEmployersAction(null, form(UUID));
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain("sandbox");
    rpc.mockResolvedValue({ data: null, error: { message: "You don't have access to this area.", code: "42501" } });
    const failed = await askEmployersAction(null, form(UUID));
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.error).toMatch(/^Could not ask the families/);
  });

  it("rejects a bad id before calling the database", async () => {
    const r = await askEmployersAction(null, form("not-a-uuid"));
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
